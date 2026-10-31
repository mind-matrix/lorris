// The host: holds the full game state, runs every bot, and talks to clients. Clients only
// ever get their own player view; every action they send is validated by the rules engine.

import { IN_GAME_BOT, createInGameBot, type Bot } from '../ai';
import { randomSeed, type Action, type GameConfig, type GameState, type PlayerView, type Seat, type Seed } from '../core';
import { BotRunner, DEFAULT_PACING, type BotPacing } from '../session/BotRunner';
import { GameHost } from '../session/GameHost';
import { createEnvelope, type SaveEnvelope, type SavedSeat } from '../save/envelope';
import { Autosaver, type SaveStore } from '../save/SaveStore';
import type { HostControls, LobbySnapshot, OnlineSession, SessionError, TableInfo, VoiceMessaging } from '../session/types';
import { VoiceRateLimiter, forwardedMeta, parseOutgoing, type ReceivedClip, type VoiceClip } from './voiceMessages';
import type { LinkStats } from './transport';
import { NET_CONFIG, type NetConfig } from './config';
import {
  DEFAULT_POLICY,
  HOST_SEAT,
  addBot,
  claimSeat,
  createLobby,
  formerSeatForToken,
  reclaimFormerSeat,
  freeSeat,
  kickSeat,
  openBotSeats,
  publicSeats,
  releaseSeat,
  renameSeat,
  seatForToken,
  setPolicy,
  startLobby,
  takeSeat,
  type Lobby,
} from './lobby';
import {
  Outbox,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostMessageBody,
  type JoinPolicy,
  type PauseState,
  type SeatDeniedReason,
  type SeatInfo,
  type TableEvent,
  type TableSummary,
} from './protocol';
import { RateLimiter } from './rateLimiter';
import { roomPassword } from './roomCode';
import { botName } from './lobby';
import type { PeerId, Transport } from './transport';
import { parseClientMessage, versionOf } from './validate';

/** The id of a hosted game's save: one per room, kept across save-and-resume. */
export const hostedSaveId = (roomCode: string) => `room-${roomCode}`;

interface PeerState {
  seat: Seat | null;
  /** Name from HELLO, kept for when a newcomer picks a seat. */
  name: string | null;
  /** This peer's own seat token (the host stores only hashes in the lobby and saves). */
  token: string | null;
  limiter: RateLimiter;
  strikes: number;
  lastSeq: number;
  lastSeen: number;
  blocked: boolean;
}

export interface HostOptions {
  transport: Transport;
  /** Where the game is autosaved after every move (omit to not save). */
  saves?: SaveStore;
  roomCode: string;
  /** Required for a new room; ignored when resuming. */
  config?: GameConfig;
  hostName?: string;
  /** Resume a saved game (validated) instead of starting a new room. */
  saved?: SaveEnvelope;
  /** Tests pass a fixed seed; real games get 128 bits from crypto. */
  seed?: Seed;
  pacing?: BotPacing;
  net?: NetConfig;
  makeBot?: (seat: Seat) => Bot;
  /** Test hook: called with every message sent, and the full state at that moment. */
  onSend?: (to: PeerId, message: unknown, state: GameState | null) => void;
}

const PAUSED_ERROR = { code: 'PAUSED', message: 'The game is paused.' };

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class HostSession implements OnlineSession, HostControls {
  readonly isHost = true;
  readonly seats = [HOST_SEAT];
  readonly roomCode: string;

  private transport: Transport;
  private saves: SaveStore | null;
  private autosaver: Autosaver | null;
  private net: NetConfig;
  private pacing: BotPacing;
  private makeBot: (seat: Seat) => Bot;
  private onSendHook: HostOptions['onSend'];
  private seed: Seed;

  private lobby: Lobby;
  private lobbyVersion: number;
  private game: GameHost | null = null;
  private runner: BotRunner | null = null;
  private bots = new Map<Seat, Bot>();

  private peers = new Map<PeerId, PeerState>();
  private seatPeer = new Map<Seat, PeerId>();
  /** Newcomers who said HELLO but have no seat yet (choosing one, or waiting for one to open). */
  private guests = new Set<PeerId>();
  /** When each human seat lost contact (null = connected). */
  private lostAt: (number | null)[];
  private botControlled: boolean[];
  private pause: PauseState = { paused: false, by: null, resuming: false };

  private outbox = new Outbox();
  private viewListeners = new Set<(view: PlayerView) => void>();
  private tableListeners = new Set<(t: TableInfo) => void>();
  private lobbyListeners = new Set<(l: LobbySnapshot) => void>();
  private eventListeners = new Set<(e: TableEvent) => void>();
  private clipListeners = new Set<(clip: ReceivedClip) => void>();
  private clipLimits = new Map<PeerId | 'host', VoiceRateLimiter>();
  private unsubscribers: (() => void)[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: HostOptions) {
    this.transport = opts.transport;
    this.saves = opts.saves ?? null;
    this.autosaver = this.saves ? new Autosaver(this.saves, 'host') : null;
    this.roomCode = opts.roomCode;
    this.net = opts.net ?? NET_CONFIG;
    this.pacing = opts.pacing ?? DEFAULT_PACING;
    this.makeBot = opts.makeBot ?? (() => createInGameBot());
    this.onSendHook = opts.onSend;
    this.seed = opts.seed ?? randomSeed();

    this.lobby = opts.saved ? HostSession.lobbyFromSave(opts.saved) : createLobby(opts.config!, opts.hostName!, newToken());
    this.lobbyVersion = opts.saved ? (opts.saved.online?.lobbyVersion ?? 0) + 1 : 1;
    // After a resume, every remote human starts out "reconnecting" with a full takeover grace period.
    const now = Date.now();
    this.lostAt = this.lobby.seats.map((s, seat) => (opts.saved && seat !== HOST_SEAT && s.kind === 'human' ? now : null));
    this.botControlled = this.lobby.seats.map(() => false);
    if (opts.saved) {
      // A resumed game starts paused, waiting for players to come back before the host continues.
      this.pause = { paused: true, by: HOST_SEAT, resuming: true };
      this.startGame(new GameHost(opts.saved.game));
    }
  }

  private static lobbyFromSave(save: SaveEnvelope): Lobby {
    return {
      config: save.game.state.config,
      started: true,
      policy: save.online?.policy ?? { ...DEFAULT_POLICY },
      seats: save.seats.map((s, seat) =>
        s.kind === 'human' && s.tokenHash
          ? { kind: 'human', name: s.name, tokenHash: s.tokenHash }
          : { kind: 'bot', name: s.kind === 'bot' ? s.name : botName(seat), tokenHash: null },
      ),
    };
  }

  /** Joins the room and starts listening. */
  async open(): Promise<void> {
    const t = this.transport;
    this.unsubscribers.push(
      t.onMessage((from, raw) => this.onMessage(from, raw)),
      t.onPeerJoin((peer) => this.peerState(peer)),
      t.onPeerLeave((peer) => this.onPeerLeave(peer)),
    );
    if (t.voice) this.unsubscribers.push(t.voice.onClip((from, data, meta) => this.onClip(from, data, meta)));
    await t.connect(this.roomCode, roomPassword(this.roomCode));
    this.heartbeat = setInterval(() => this.tick(), this.net.heartbeatIntervalMs);
    this.changed({ lobby: true });
  }

  // ---------- GameSession (the host's own seat) ----------

  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void {
    if (seat !== HOST_SEAT) return () => {};
    this.viewListeners.add(listener);
    if (this.game) listener(this.game.view(HOST_SEAT));
    return () => this.viewListeners.delete(listener);
  }

  subscribeTable(listener: (t: TableInfo) => void): () => void {
    this.tableListeners.add(listener);
    listener(this.tableInfo());
    return () => this.tableListeners.delete(listener);
  }

  subscribeEvents(listener: (e: TableEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ---------- Voice messages ----------

  voiceMessages(): VoiceMessaging | null {
    const link = this.transport.voice;
    if (!link) return null;
    return {
      send: (clip) => {
        if (!parseOutgoing(clip.data, { v: 1, mime: clip.mime, durationMs: clip.durationMs })) return false;
        if (!this.clipLimiter('host').allow(Date.now())) return false;
        link.sendClip(clip.data, forwardedMeta(clip, HOST_SEAT), this.seatedPeers());
        return true;
      },
      subscribe: (listener) => {
        this.clipListeners.add(listener);
        return () => this.clipListeners.delete(listener);
      },
      linkStats: async () => {
        // The host talks to everyone: typical round trip, and the weakest outgoing link.
        const all = (await Promise.all(this.seatedPeers().map((p) => link.linkStats(p)))).filter((s): s is LinkStats => s !== null);
        if (all.length === 0) return null;
        const rtts = all.map((s) => s.rttMs).filter((r): r is number => r !== null).sort((a, b) => a - b);
        const outs = all.map((s) => s.outgoingKbps).filter((k): k is number => k !== null);
        return { rttMs: rtts.length ? rtts[Math.floor(rtts.length / 2)] : null, outgoingKbps: outs.length ? Math.min(...outs) : null };
      },
    };
  }

  /** Peers currently seated and connected (they hear voice messages). */
  private seatedPeers(except?: PeerId): PeerId[] {
    const out: PeerId[] = [];
    for (const [seat, peer] of this.seatPeer) {
      const p = this.peers.get(peer);
      if (peer !== except && p && !p.blocked && p.seat === seat && this.lobby.seats[seat]?.kind === 'human') out.push(peer);
    }
    return out;
  }

  private clipLimiter(key: PeerId | 'host'): VoiceRateLimiter {
    let l = this.clipLimits.get(key);
    if (!l) this.clipLimits.set(key, (l = new VoiceRateLimiter()));
    return l;
  }

  /** A player's voice message: check it, stamp it with their seat, pass it to everyone else. */
  private onClip(from: PeerId, data: ArrayBuffer, meta: unknown): void {
    const p = this.peers.get(from);
    const seat = p?.seat ?? null;
    if (!p || p.blocked || seat === null || this.seatPeer.get(seat) !== from || this.lobby.seats[seat]?.kind !== 'human') return;
    const clip = parseOutgoing(data, meta);
    if (!clip || !this.clipLimiter(from).allow(Date.now())) return;
    this.transport.voice?.sendClip(clip.data, forwardedMeta(clip, seat), this.seatedPeers(from));
    for (const l of this.clipListeners) l({ ...clip, seat });
  }

  subscribeLobby(listener: (l: LobbySnapshot) => void): () => void {
    this.lobbyListeners.add(listener);
    listener(this.lobbySnapshot());
    return () => this.lobbyListeners.delete(listener);
  }

  async submit(seat: Seat, action: Action): Promise<SessionError | null> {
    if (seat !== HOST_SEAT || !this.game) return { code: 'INVALID_SEAT', message: 'That seat is not yours' };
    if (this.pause.paused) return PAUSED_ERROR;
    return this.game.submit(seat, action);
  }

  // ---------- Pause, save and resume ----------

  /** Pause now (the host's choice, or accepting `by`'s request). No moves, no bot thinking. */
  pauseGame(by: Seat = HOST_SEAT): void {
    if (!this.game || this.pause.paused || this.game.phase === 'gameOver') return;
    this.pause = { paused: true, by, resuming: false };
    this.runner?.setPaused(true);
    this.changed({ lobby: true });
  }

  /** Turn down a player's pause request. */
  declinePause(seat: Seat): void {
    const peer = this.seatPeer.get(seat);
    if (peer) this.send(peer, { type: 'EVENT', event: { kind: 'pause-declined' } });
  }

  /** Play on after a pause. Disconnect clocks start fresh: nobody loses a seat to the pause. */
  unpauseGame(): void {
    if (!this.pause.paused || this.pause.resuming) return;
    const now = Date.now();
    this.lostAt = this.lostAt.map((t) => (t === null ? null : now));
    this.pause = { paused: false, by: null, resuming: false };
    this.runner?.setPaused(false);
    this.changed({ lobby: true });
  }

  /**
   * After reopening a saved game: carry on. Players who haven't come back leave free bot seats
   * (a bot plays them, newcomers may take them); if they return while it's still a bot, it's theirs.
   */
  continueResumed(): void {
    if (!this.pause.resuming) return;
    for (const [seat, s] of this.lobby.seats.entries()) {
      if (seat !== HOST_SEAT && s.kind === 'human' && this.status(seat) !== 'connected') this.giveUpSeat(seat, true);
    }
    this.pause = { paused: true, by: HOST_SEAT, resuming: false };
    this.unpauseGame();
  }

  /** From the pause screen: save, tell everyone the game can be resumed later, and close the room. */
  async saveAndClose(): Promise<void> {
    if (!this.game) return;
    await this.saveNow();
    const host = this.lobby.seats[HOST_SEAT].name;
    const label = this.envelope().label.text;
    for (const peer of [...this.seatPeer.values(), ...this.guests]) {
      this.send(peer, { type: 'HOST_STATUS', status: 'saved', message: `Game saved. ${host} can resume it later.`, label });
    }
    setTimeout(() => this.close(), 300);
  }

  // ---------- Host controls ----------

  addBot(seat: Seat): void {
    this.setLobby(addBot(this.lobby, seat));
  }

  freeSeat(seat: Seat): void {
    const peer = this.seatPeer.get(seat);
    if (peer) this.detach(peer);
    this.setLobby(freeSeat(this.lobby, seat));
  }

  kick(seat: Seat): void {
    if (seat === HOST_SEAT || this.lobby.seats[seat]?.kind !== 'human') return;
    const peer = this.seatPeer.get(seat);
    if (peer) {
      this.send(peer, { type: 'REJECTED', reason: 'KICKED', hostVersion: PROTOCOL_VERSION });
      this.detach(peer);
      this.peers.get(peer)!.blocked = true;
    }
    this.lostAt[seat] = null;
    this.setLobby(kickSeat(this.lobby, seat));
    this.runner?.schedule();
  }

  setPolicy(policy: Partial<JoinPolicy>): void {
    this.setLobby(setPolicy(this.lobby, policy));
  }

  releaseSeat(seat: Seat): void {
    if (this.lobby.started && this.lobby.seats[seat]?.kind === 'human' && this.status(seat) !== 'connected') this.giveUpSeat(seat);
  }

  start(): void {
    if (this.lobby.started) return;
    this.lobby = startLobby(this.lobby);
    this.startGame(new GameHost(this.lobby.config, this.seed));
    this.changed({ lobby: true, game: true });
  }

  /** The host is leaving: end the game for everyone and forget the saved game. */
  leave(): void {
    for (const peer of [...this.seatPeer.values(), ...this.guests]) {
      this.send(peer, { type: 'HOST_STATUS', status: 'ended', message: 'The host ended the game.' });
    }
    void this.autosaver?.flush().then(() => this.saves?.delete(hostedSaveId(this.roomCode)));
    // Give the goodbye messages a moment to leave before dropping the connection.
    setTimeout(() => this.close(), 300);
  }

  /** The page is visible again: our timers were paused, so don't blame clients for the silence. */
  resume(): void {
    const now = Date.now();
    for (const p of this.peers.values()) p.lastSeen = now;
    this.lostAt = this.lostAt.map((t) => (t === null ? null : Math.max(t, now - this.net.peerTimeoutMs)));
    this.changed({ lobby: true, game: true });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.runner?.close();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribers.forEach((u) => u());
    this.transport.disconnect();
  }

  // ---------- Internals ----------

  private startGame(game: GameHost): void {
    this.game = game;
    this.unsubscribers.push(game.onChange(() => this.changed({ game: true })));
    this.runner = new BotRunner(game, (seat) => this.botFor(seat), this.pacing);
    this.runner.schedule();
  }

  /** The bot playing a seat right now, if any: bot seats, and humans who've been away too long. */
  private botFor(seat: Seat): Bot | null {
    const s = this.lobby.seats[seat];
    if (s.kind !== 'bot' && !(s.kind === 'human' && this.botControlled[seat])) return null;
    let bot = this.bots.get(seat);
    if (!bot) this.bots.set(seat, (bot = this.makeBot(seat)));
    return bot;
  }

  private status(seat: Seat): SeatInfo['status'] {
    if (this.botControlled[seat]) return 'bot-controlled';
    return this.lostAt[seat] === null ? 'connected' : 'reconnecting';
  }

  /** Time left on a disconnected player's reservation (mid-game), or null if they're here. */
  private reservedMs(seat: Seat): number | null {
    const lost = this.lostAt[seat];
    return lost === null ? null : Math.max(0, lost + this.net.seatReservationMs - Date.now());
  }

  private seatsInfo(): SeatInfo[] {
    const now = Date.now();
    return publicSeats(this.lobby, (seat) => this.status(seat), (seat) => this.reservedMs(seat)).map((s) =>
      s.reservedMs === undefined ? s : { ...s, reservedUntil: now + s.reservedMs },
    );
  }

  /** Public facts about the game for newcomers deciding where to sit. No cards. */
  private tableSummary(): TableSummary | null {
    if (!this.game) return null;
    const v = this.game.view(HOST_SEAT);
    return {
      setNumber: v.setNumber,
      phase: v.phase,
      scores: v.scores,
      tricksWon: v.tricksWon,
      trump: v.trump,
      contract: v.contract && { seat: v.contract.seat, value: v.contract.value },
      handCounts: v.handCounts,
      turn: v.turn,
    };
  }

  private tableInfo(): TableInfo {
    return { seats: this.seatsInfo(), connection: { kind: 'connected' }, pause: this.pause };
  }

  private lobbySnapshot(): LobbySnapshot {
    return {
      roomCode: this.roomCode,
      seats: this.seatsInfo(),
      started: this.lobby.started,
      mySeat: HOST_SEAT,
      isHost: true,
      connection: { kind: 'connected' },
      policy: this.lobby.policy,
      table: this.tableSummary(),
      notice: null,
      pause: this.pause,
    };
  }

  private setLobby(lobby: Lobby): void {
    if (lobby === this.lobby) return;
    this.lobby = lobby;
    this.changed({ lobby: true });
  }

  /** Pushes updates to clients and the host's own UI, and saves the game. */
  private changed(what: { lobby?: boolean; game?: boolean }): void {
    if (this.closed) return;
    if (what.lobby) {
      this.lobbyVersion++;
      for (const peer of [...this.seatPeer.values(), ...this.guests]) this.sendLobby(peer);
      const snap = this.lobbySnapshot();
      for (const l of this.lobbyListeners) l(snap);
      const table = this.tableInfo();
      for (const l of this.tableListeners) l(table);
    }
    if (what.game && this.game) {
      for (const [seat, peer] of this.seatPeer) this.sendView(peer, seat);
      const view = this.game.view(HOST_SEAT);
      for (const l of this.viewListeners) l(view);
    }
    this.save();
  }

  /** The save for this game: full state, seat names and hashed tokens, room details. */
  private envelope(): SaveEnvelope {
    const seats: SavedSeat[] = this.lobby.seats.map((s) =>
      s.kind === 'human' && s.tokenHash
        ? { name: s.name, kind: 'human', tokenHash: s.tokenHash }
        : { name: s.name || 'Bot', kind: 'bot', bot: { difficulty: IN_GAME_BOT } },
    );
    return createEnvelope({
      id: hostedSaveId(this.roomCode),
      savedAt: Date.now(),
      mode: 'online',
      game: this.game!.snapshot(),
      seats,
      online: {
        roomCode: this.roomCode,
        roomPassword: roomPassword(this.roomCode),
        hostName: this.lobby.seats[HOST_SEAT].name,
        policy: this.lobby.policy,
        lobbyVersion: this.lobbyVersion,
      },
    });
  }

  /** Autosave after every change once the game is under way; finished games leave the saved list. */
  private save(): void {
    if (!this.autosaver || !this.game) return;
    if (this.game.phase === 'gameOver') {
      void this.autosaver.flush().then(() => this.saves!.delete(hostedSaveId(this.roomCode)));
      return;
    }
    this.autosaver.request(this.envelope());
  }

  private async saveNow(): Promise<void> {
    this.save();
    await this.autosaver?.flush();
  }

  private send(peer: PeerId, body: HostMessageBody): void {
    const message = this.outbox.wrap(body);
    this.onSendHook?.(peer, message, this.game?.snapshot().state ?? null);
    this.transport.send(peer, message);
  }

  private sendLobby(peer: PeerId): void {
    // reservedUntil is local to this device; the wire carries only the relative reservedMs.
    const seats = this.seatsInfo().map(({ reservedUntil: _, ...s }) => s);
    this.send(peer, {
      type: 'LOBBY',
      lobbyVersion: this.lobbyVersion,
      seats,
      started: this.lobby.started,
      policy: this.lobby.policy,
      table: this.tableSummary(),
      pause: this.pause,
    });
  }

  /** The only place game state leaves the host: one seat's redacted view, to that seat's peer. */
  private sendView(peer: PeerId, seat: Seat): void {
    if (!this.game) return;
    this.send(peer, { type: 'VIEW', stateVersion: this.game.version, view: this.game.view(seat) });
  }

  private peerState(peer: PeerId): PeerState {
    let p = this.peers.get(peer);
    if (!p) {
      p = {
        seat: null,
        name: null,
        token: null,
        limiter: new RateLimiter(this.net.rateLimitPerSecond, this.net.rateLimitBurst),
        strikes: 0,
        lastSeq: 0,
        lastSeen: Date.now(),
        blocked: false,
      };
      this.peers.set(peer, p);
    }
    return p;
  }

  private strike(peer: PeerId, p: PeerState): void {
    if (++p.strikes < this.net.maxStrikes) return;
    // Persistent garbage or flooding: cut the peer off. Their seat is handled like a disconnect.
    this.send(peer, { type: 'REJECTED', reason: 'RATE_LIMITED', hostVersion: PROTOCOL_VERSION });
    this.detach(peer);
    p.blocked = true;
  }

  private onMessage(from: PeerId, raw: unknown): void {
    const p = this.peerState(from);
    if (p.blocked || this.closed) return;
    if (!p.limiter.take()) return this.strike(from, p);

    if (versionOf(raw) !== PROTOCOL_VERSION) {
      // HELLO's shape never changes, so we can always answer an outdated (or newer) app.
      if ((raw as { type?: unknown })?.type === 'HELLO') {
        this.send(from, { type: 'REJECTED', reason: 'VERSION_MISMATCH', hostVersion: PROTOCOL_VERSION });
      }
      return this.strike(from, p);
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return this.strike(from, p);
    const m = parsed.message;
    if (m.seq <= p.lastSeq) return; // duplicate or out of date
    p.lastSeq = m.seq;
    p.lastSeen = Date.now();
    if (p.seat !== null && this.lostAt[p.seat] !== null) this.reconnected(p.seat);
    this.handle(from, p, m);
  }

  private handle(from: PeerId, p: PeerState, m: ClientMessage): void {
    switch (m.type) {
      case 'HELLO':
        return this.hello(from, p, m.name, m.token);
      case 'ACTION': {
        if (p.seat === null || !this.game) {
          return this.send(from, { type: 'ACTION_RESULT', requestId: m.requestId, error: { code: 'NOT_SEATED', message: 'The game has not started' } });
        }
        if (this.pause.paused) return this.send(from, { type: 'ACTION_RESULT', requestId: m.requestId, error: PAUSED_ERROR });
        // The seat comes from who sent the message, never from the message itself.
        const error = this.game.submit(p.seat, m.action);
        return this.send(from, { type: 'ACTION_RESULT', requestId: m.requestId, error });
      }
      case 'RESYNC':
        if (p.seat !== null) {
          this.sendLobby(from);
          this.sendView(from, p.seat);
        } else if (this.guests.has(from)) {
          this.sendLobby(from);
        }
        return;
      case 'PAUSE_REQUEST':
        if (p.seat !== null && this.game && !this.pause.paused && p.seat !== HOST_SEAT) {
          const event: TableEvent = { kind: 'pause-requested', seat: p.seat, name: this.lobby.seats[p.seat].name };
          for (const l of this.eventListeners) l(event); // the host decides in their UI
        }
        return;
      case 'TAKE_SEAT': {
        if (p.seat !== null || !this.guests.has(from)) return;
        const reason = this.seatNewcomer(from, p, m.seat);
        if (reason) this.send(from, { type: 'SEAT_DENIED', reason });
        return;
      }
      case 'PING':
        return this.send(from, { type: 'PONG', t: m.t, stateVersion: this.game?.version ?? 0, lobbyVersion: this.lobbyVersion });
      case 'LEAVE':
        this.guests.delete(from);
        if (p.seat !== null) this.playerLeft(p.seat);
        this.detach(from);
        return;
    }
  }

  private hello(from: PeerId, p: PeerState, name: string, token: string | null): void {
    p.name = name;
    // Rejoining with a seat token: same seat, same hand.
    const seat = token ? seatForToken(this.lobby, token) : null;
    if (seat !== null && seat !== HOST_SEAT) {
      const old = this.seatPeer.get(seat);
      if (old && old !== from) this.detach(old);
      this.guests.delete(from);
      this.attach(from, p, seat, token!);
      if (!this.lobby.started) this.setLobby(renameSeat(this.lobby, seat, name));
      return;
    }
    // Back after the host resumed a saved game without them: their seat is theirs again if a bot still has it.
    const former = token ? formerSeatForToken(this.lobby, token) : null;
    if (former !== null && p.seat === null) {
      this.lobby = reclaimFormerSeat(this.lobby, former, name, token!);
      this.bots.delete(former);
      this.botControlled[former] = false;
      this.lostAt[former] = null;
      this.guests.delete(from);
      this.attach(from, p, former, token!);
      this.runner?.schedule();
      this.broadcastEvent({ kind: 'returned', seat: former, name });
      this.changed({ lobby: true });
      return;
    }
    if (p.seat !== null && p.token) return this.welcome(from, p.seat, p.token);

    // A newcomer (or someone whose reservation ran out). They become a guest who can see the
    // seats and the public table, and get seated now if the host's settings allow.
    if (!this.guests.has(from)) {
      if (this.guests.size >= this.net.maxGuests) {
        return this.send(from, { type: 'REJECTED', reason: 'ROOM_FULL', hostVersion: PROTOCOL_VERSION });
      }
      this.guests.add(from);
    }
    this.sendLobby(from);
    // They had a seat token, but that seat was given up while they were away: tell them why.
    if (token !== null && this.lobby.started) this.send(from, { type: 'SEAT_DENIED', reason: 'SEAT_EXPIRED' });
    if (this.autoSeating()) {
      const reason = this.seatNewcomer(from, p, null);
      if (reason) this.send(from, { type: 'SEAT_DENIED', reason });
    }
  }

  /** Whether newcomers are seated automatically right now. Before the start they always are. */
  private autoSeating(): boolean {
    return !this.lobby.started || (this.lobby.policy.midGameJoins && this.lobby.policy.autoAssign);
  }

  /**
   * Seats a guest: in a specific seat, or the first open one. Returns why not, or null on success.
   * Messages are handled one at a time, so two guests asking for the same seat can't both get it:
   * the first takes it, and the second finds a human there.
   */
  private seatNewcomer(from: PeerId, p: PeerState, wanted: Seat | null): SeatDeniedReason | null {
    const started = this.lobby.started;
    if (started && !this.lobby.policy.midGameJoins) return 'JOINS_DISABLED';
    const token = newToken();
    let lobby: Lobby | null;
    let seat: Seat;
    if (wanted === null) {
      if (started) {
        seat = openBotSeats(this.lobby)[0] ?? -1;
        lobby = seat < 0 ? null : takeSeat(this.lobby, seat, p.name!, token);
      } else {
        const claimed = claimSeat(this.lobby, p.name!, token);
        seat = claimed?.seat ?? -1;
        lobby = claimed?.lobby ?? null;
      }
      if (!lobby) return 'NO_OPEN_SEATS';
    } else {
      seat = wanted;
      const target = this.lobby.seats[seat];
      if (!target) return 'NOT_OPEN';
      if (target.kind === 'human') return seat !== HOST_SEAT && started && this.status(seat) !== 'connected' ? 'RESERVED' : 'SEAT_TAKEN';
      lobby = takeSeat(this.lobby, seat, p.name!, token);
      if (!lobby) return 'NOT_OPEN';
    }

    const tookBot = this.lobby.seats[seat].kind === 'bot';
    this.lobby = lobby;
    // The bot is out: any move it was about to make is dropped (BotRunner re-checks who controls
    // the seat before submitting), and the human now plays the seat's current hand.
    this.bots.delete(seat);
    this.botControlled[seat] = false;
    this.lostAt[seat] = null;
    this.guests.delete(from);
    this.attach(from, p, seat, token);
    this.runner?.schedule();
    if (started && tookBot) this.broadcastEvent({ kind: 'took-seat', seat, name: p.name! });
    this.changed({ lobby: true });
    return null;
  }

  private broadcastEvent(event: TableEvent): void {
    for (const peer of [...this.seatPeer.values(), ...this.guests]) this.send(peer, { type: 'EVENT', event });
    for (const l of this.eventListeners) l(event);
  }

  /** A human's seat becomes an open bot seat, and their token stops working (unless `keepClaim`). */
  private giveUpSeat(seat: Seat, keepClaim = false): void {
    const peer = this.seatPeer.get(seat);
    if (peer) this.peers.get(peer)!.seat = null;
    this.seatPeer.delete(seat);
    this.lostAt[seat] = null;
    this.botControlled[seat] = false;
    this.lobby = releaseSeat(this.lobby, seat, keepClaim);
    this.runner?.schedule();
    this.changed({ lobby: true });
  }

  private attach(peer: PeerId, p: PeerState, seat: Seat, token: string): void {
    p.seat = seat;
    p.token = token;
    this.seatPeer.set(seat, peer);
    this.welcome(peer, seat, token);
    this.reconnected(seat);
    this.sendLobby(peer);
    this.sendView(peer, seat);
  }

  private welcome(peer: PeerId, seat: Seat, token: string): void {
    this.send(peer, { type: 'WELCOME', seat, token, roomCode: this.roomCode, config: this.lobby.config });
  }

  private detach(peer: PeerId): void {
    const p = this.peers.get(peer);
    if (!p || p.seat === null) return;
    if (this.seatPeer.get(p.seat) === peer) {
      this.seatPeer.delete(p.seat);
      this.lostContact(p.seat);
    }
    p.seat = null;
  }

  private onPeerLeave(peer: PeerId): void {
    this.guests.delete(peer);
    const p = this.peers.get(peer);
    if (p?.seat != null && this.seatPeer.get(p.seat) === peer) this.lostContact(p.seat);
  }

  private lostContact(seat: Seat): void {
    if (this.lostAt[seat] !== null || this.lobby.seats[seat].kind !== 'human') return;
    this.lostAt[seat] = Date.now();
    this.changed({ lobby: true });
  }

  /** A seat's human is back: they play their own seat again, even mid-turn. */
  private reconnected(seat: Seat): void {
    if (this.lostAt[seat] === null && !this.botControlled[seat]) return;
    this.lostAt[seat] = null;
    this.botControlled[seat] = false;
    this.runner?.schedule();
    this.changed({ lobby: true });
  }

  /** Someone left on purpose: free their seat in the lobby, or make it an open bot seat in game. */
  private playerLeft(seat: Seat): void {
    if (!this.lobby.started) {
      this.seatPeer.delete(seat);
      this.lostAt[seat] = null;
      this.setLobby(freeSeat(this.lobby, seat));
    } else {
      this.giveUpSeat(seat);
    }
  }

  /** Heartbeat: notice silent peers, and hand long-gone players' seats to bots. */
  private tick(): void {
    const now = Date.now();
    for (const [seat, peer] of this.seatPeer) {
      const p = this.peers.get(peer)!;
      if (now - p.lastSeen > this.net.peerTimeoutMs) this.lostContact(seat);
    }
    let changed = false;
    this.lobby.seats.forEach((s, seat) => {
      const lost = this.lostAt[seat];
      // While paused, the takeover and reservation clocks are frozen (they restart on unpause).
      if (this.pause.paused) return;
      if (lost === null || s.kind !== 'human' || now - lost < this.net.botTakeoverMs) return;
      if (!this.lobby.started) {
        // In the lobby, a player who's been gone this long loses their seat.
        const peer = this.seatPeer.get(seat);
        if (peer) this.peers.get(peer)!.seat = null;
        this.seatPeer.delete(seat);
        this.lostAt[seat] = null;
        this.lobby = freeSeat(this.lobby, seat);
        changed = true;
      } else if (now - lost >= this.net.seatReservationMs) {
        // The reservation ran out: the seat becomes an open bot seat a newcomer can take.
        this.giveUpSeat(seat);
      } else if (!this.botControlled[seat]) {
        this.botControlled[seat] = true;
        changed = true;
      }
    });
    if (changed) {
      this.runner?.schedule();
      this.changed({ lobby: true });
    }
    this.serveGuests(now);
  }

  /** Drops guests who went quiet, and seats waiting guests when a seat has opened up. */
  private serveGuests(now: number): void {
    for (const peer of [...this.guests]) {
      const p = this.peers.get(peer);
      if (!p || now - p.lastSeen > 2 * this.net.peerTimeoutMs) {
        this.guests.delete(peer);
        continue;
      }
      if (this.autoSeating()) this.seatNewcomer(peer, p, null);
    }
  }
}
