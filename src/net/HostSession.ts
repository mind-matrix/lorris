// The host: holds the full game state, runs every bot, and talks to clients. Clients only
// ever get their own player view; every action they send is validated by the rules engine.

import { HeuristicBot, type Bot } from '../ai';
import type { Action, GameConfig, GameState, PlayerView, Seat } from '../core';
import { BotRunner, DEFAULT_PACING, type BotPacing } from '../session/BotRunner';
import { GameHost } from '../session/GameHost';
import { STORAGE_KEYS, type KeyValueStore } from '../session/storage';
import type { HostControls, LobbySnapshot, OnlineSession, SessionError, TableInfo } from '../session/types';
import { NET_CONFIG, type NetConfig } from './config';
import {
  HOST_SEAT,
  addBot,
  claimSeat,
  createLobby,
  freeSeat,
  kickSeat,
  publicSeats,
  renameSeat,
  seatForToken,
  startLobby,
  type Lobby,
} from './lobby';
import { Outbox, PROTOCOL_VERSION, type ClientMessage, type HostMessageBody, type SeatInfo } from './protocol';
import { RateLimiter } from './rateLimiter';
import { roomPassword } from './roomCode';
import type { PeerId, Transport } from './transport';
import { parseClientMessage, versionOf } from './validate';

/** Everything the host saves after each change, so it can resume after the app is closed. */
export interface SavedHostGame {
  roomCode: string;
  lobby: Lobby;
  lobbyVersion: number;
  game: { state: GameState; version: number } | null;
}

interface PeerState {
  seat: Seat | null;
  limiter: RateLimiter;
  strikes: number;
  lastSeq: number;
  lastSeen: number;
  blocked: boolean;
}

export interface HostOptions {
  transport: Transport;
  storage: KeyValueStore;
  roomCode: string;
  /** Required for a new room; ignored when resuming. */
  config?: GameConfig;
  hostName?: string;
  /** Resume a saved game instead of starting a new room. */
  saved?: SavedHostGame;
  seed?: number;
  pacing?: BotPacing;
  net?: NetConfig;
  makeBot?: (seat: Seat) => Bot;
  /** Test hook: called with every message sent, and the full state at that moment. */
  onSend?: (to: PeerId, message: unknown, state: GameState | null) => void;
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class HostSession implements OnlineSession, HostControls {
  readonly isHost = true;
  readonly seats = [HOST_SEAT];
  readonly roomCode: string;

  private transport: Transport;
  private storage: KeyValueStore;
  private net: NetConfig;
  private pacing: BotPacing;
  private makeBot: (seat: Seat) => Bot;
  private onSendHook: HostOptions['onSend'];
  private seed: number;

  private lobby: Lobby;
  private lobbyVersion: number;
  private game: GameHost | null = null;
  private runner: BotRunner | null = null;
  private bots = new Map<Seat, Bot>();

  private peers = new Map<PeerId, PeerState>();
  private seatPeer = new Map<Seat, PeerId>();
  /** When each human seat lost contact (null = connected). */
  private lostAt: (number | null)[];
  private botControlled: boolean[];

  private outbox = new Outbox();
  private viewListeners = new Set<(view: PlayerView) => void>();
  private tableListeners = new Set<(t: TableInfo) => void>();
  private lobbyListeners = new Set<(l: LobbySnapshot) => void>();
  private unsubscribers: (() => void)[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: HostOptions) {
    this.transport = opts.transport;
    this.storage = opts.storage;
    this.roomCode = opts.roomCode;
    this.net = opts.net ?? NET_CONFIG;
    this.pacing = opts.pacing ?? DEFAULT_PACING;
    this.makeBot = opts.makeBot ?? (() => new HeuristicBot());
    this.onSendHook = opts.onSend;
    this.seed = opts.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];

    this.lobby = opts.saved?.lobby ?? createLobby(opts.config!, opts.hostName!, newToken());
    this.lobbyVersion = opts.saved ? opts.saved.lobbyVersion + 1 : 1;
    // After a resume, every remote human starts out "reconnecting" with a full takeover grace period.
    const now = Date.now();
    this.lostAt = this.lobby.seats.map((s, seat) => (opts.saved && seat !== HOST_SEAT && s.kind === 'human' ? now : null));
    this.botControlled = this.lobby.seats.map(() => false);
    if (opts.saved?.game) this.startGame(new GameHost(opts.saved.game));
  }

  /** Joins the room and starts listening. */
  async open(): Promise<void> {
    const t = this.transport;
    this.unsubscribers.push(
      t.onMessage((from, raw) => this.onMessage(from, raw)),
      t.onPeerJoin((peer) => this.peerState(peer)),
      t.onPeerLeave((peer) => this.onPeerLeave(peer)),
    );
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

  subscribeLobby(listener: (l: LobbySnapshot) => void): () => void {
    this.lobbyListeners.add(listener);
    listener(this.lobbySnapshot());
    return () => this.lobbyListeners.delete(listener);
  }

  async submit(seat: Seat, action: Action): Promise<SessionError | null> {
    if (seat !== HOST_SEAT || !this.game) return { code: 'INVALID_SEAT', message: 'That seat is not yours' };
    return this.game.submit(seat, action);
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

  start(): void {
    if (this.lobby.started) return;
    this.lobby = startLobby(this.lobby);
    this.startGame(new GameHost(this.lobby.config, this.seed));
    this.changed({ lobby: true, game: true });
  }

  /** The host is leaving: end the game for everyone and forget the saved game. */
  leave(): void {
    for (const peer of this.seatPeer.values()) {
      this.send(peer, { type: 'HOST_STATUS', status: 'ended', message: 'The host ended the game.' });
    }
    void this.storage.delete(STORAGE_KEYS.hostedGame(this.roomCode));
    void this.storage.delete(STORAGE_KEYS.currentHosted);
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

  private seatsInfo(): SeatInfo[] {
    return publicSeats(this.lobby, (seat) => this.status(seat));
  }

  private tableInfo(): TableInfo {
    return { seats: this.seatsInfo(), connection: { kind: 'connected' } };
  }

  private lobbySnapshot(): LobbySnapshot {
    return {
      roomCode: this.roomCode,
      seats: this.seatsInfo(),
      started: this.lobby.started,
      mySeat: HOST_SEAT,
      isHost: true,
      connection: { kind: 'connected' },
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
      for (const peer of this.seatPeer.values()) this.sendLobby(peer);
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
    void this.save();
  }

  private async save(): Promise<void> {
    const saved: SavedHostGame = {
      roomCode: this.roomCode,
      lobby: this.lobby,
      lobbyVersion: this.lobbyVersion,
      game: this.game?.snapshot() ?? null,
    };
    await this.storage.set(STORAGE_KEYS.hostedGame(this.roomCode), saved);
    await this.storage.set(STORAGE_KEYS.currentHosted, this.roomCode);
  }

  private send(peer: PeerId, body: HostMessageBody): void {
    const message = this.outbox.wrap(body);
    this.onSendHook?.(peer, message, this.game?.snapshot().state ?? null);
    this.transport.send(peer, message);
  }

  private sendLobby(peer: PeerId): void {
    this.send(peer, { type: 'LOBBY', lobbyVersion: this.lobbyVersion, seats: this.seatsInfo(), started: this.lobby.started });
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
        // The seat comes from who sent the message, never from the message itself.
        const error = this.game.submit(p.seat, m.action);
        return this.send(from, { type: 'ACTION_RESULT', requestId: m.requestId, error });
      }
      case 'RESYNC':
        if (p.seat !== null) {
          this.sendLobby(from);
          this.sendView(from, p.seat);
        }
        return;
      case 'PING':
        return this.send(from, { type: 'PONG', t: m.t, stateVersion: this.game?.version ?? 0, lobbyVersion: this.lobbyVersion });
      case 'LEAVE':
        if (p.seat !== null) this.playerLeft(p.seat);
        this.detach(from);
        return;
    }
  }

  private hello(from: PeerId, p: PeerState, name: string, token: string | null): void {
    // Rejoining with a seat token: same seat, same hand.
    const seat = token ? seatForToken(this.lobby, token) : null;
    if (seat !== null && seat !== HOST_SEAT) {
      const old = this.seatPeer.get(seat);
      if (old && old !== from) this.detach(old);
      this.attach(from, p, seat, token!);
      if (!this.lobby.started) this.setLobby(renameSeat(this.lobby, seat, name));
      return;
    }
    if (p.seat !== null) return this.welcome(from, p.seat, this.lobby.seats[p.seat].token!);
    if (this.lobby.started) {
      return this.send(from, { type: 'REJECTED', reason: 'GAME_IN_PROGRESS', hostVersion: PROTOCOL_VERSION });
    }
    const claimed = claimSeat(this.lobby, name, newToken());
    if (!claimed) return this.send(from, { type: 'REJECTED', reason: 'ROOM_FULL', hostVersion: PROTOCOL_VERSION });
    this.lobby = claimed.lobby;
    this.attach(from, p, claimed.seat, claimed.lobby.seats[claimed.seat].token!);
    this.changed({ lobby: true });
  }

  private attach(peer: PeerId, p: PeerState, seat: Seat, token: string): void {
    p.seat = seat;
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

  /** Someone left on purpose: free their seat in the lobby, or hand it to a bot right away in game. */
  private playerLeft(seat: Seat): void {
    if (!this.lobby.started) {
      this.seatPeer.delete(seat);
      this.lostAt[seat] = null;
      this.setLobby(freeSeat(this.lobby, seat));
    } else {
      this.botControlled[seat] = true;
      this.runner?.schedule();
      this.changed({ lobby: true });
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
      if (lost === null || s.kind !== 'human' || now - lost < this.net.botTakeoverMs) return;
      if (!this.lobby.started) {
        // In the lobby, a player who's been gone this long loses their seat.
        const peer = this.seatPeer.get(seat);
        if (peer) this.peers.get(peer)!.seat = null;
        this.seatPeer.delete(seat);
        this.lostAt[seat] = null;
        this.lobby = freeSeat(this.lobby, seat);
        changed = true;
      } else if (!this.botControlled[seat]) {
        this.botControlled[seat] = true;
        changed = true;
      }
    });
    if (changed) {
      this.runner?.schedule();
      this.changed({ lobby: true });
    }
  }
}
