// A client: joins a room, shows the views the host sends, and sends intents back.
// Never holds more than its own player view. Everything from the network is validated first.

import { getLegalActionsFromView, type Action, type PlayerView, type Seat } from '../core';
import { STORAGE_KEYS, type ClientGameRef, type KeyValueStore } from '../session/storage';
import type { ConnectionState, LobbySnapshot, OnlineSession, SessionError, TableInfo } from '../session/types';
import { NET_CONFIG, type NetConfig } from './config';
import { DEFAULT_POLICY } from './lobby';
import {
  Outbox,
  PROTOCOL_VERSION,
  type ClientMessageBody,
  type HostMessage,
  type JoinPolicy,
  type PauseState,
  type RejectReason,
  type SeatDeniedReason,
  type SeatInfo,
  type TableEvent,
  type TableSummary,
} from './protocol';
import { roomPassword } from './roomCode';
import type { PeerId, Transport } from './transport';
import { parseHostMessage, versionOf } from './validate';

export interface ClientOptions {
  transport: Transport;
  storage: KeyValueStore;
  roomCode: string;
  name: string;
  net?: NetConfig;
  /**
   * Rejoining a game the host saved: if they haven't reopened it yet, wait for them (showing
   * "waiting for <hostName> to resume") instead of giving up after the join timeout.
   */
  waitForHost?: string;
}

interface SavedSeat {
  token: string;
  seat: Seat;
}

const MESSAGES = {
  notFound: "Couldn't find that game. Check the code, or ask the host to keep Lorris open on their device.",
  blocked:
    "Couldn't connect to the other players. Your network may be blocking the connection. Try switching between Wi-Fi and mobile data, then try again.",
  offline: "You're offline. Connect to the internet and try again.",
  ended: 'The host ended the game.',
};

const DENIED_MESSAGES: Record<SeatDeniedReason, string> = {
  SEAT_TAKEN: 'Someone else just took that seat. Pick another one.',
  RESERVED: 'That seat is being kept for a player who lost their connection.',
  NOT_OPEN: "That seat isn't available.",
  JOINS_DISABLED: "The host isn't letting new players join right now.",
  NO_OPEN_SEATS: 'This game is full. You can wait for the next game or ask the host.',
  SEAT_EXPIRED: 'Your old seat was given up after you were away. Pick a seat to keep playing.',
};

const REJECT_MESSAGES: Record<RejectReason, string> = {
  VERSION_MISMATCH: '',
  ROOM_FULL: 'That game is full.',
  GAME_IN_PROGRESS: 'That game has already started.',
  KICKED: 'The host removed you from the game.',
  RATE_LIMITED: 'You were disconnected for sending too many messages.',
};

export class ClientSession implements OnlineSession {
  readonly isHost = false;
  readonly roomCode: string;

  private transport: Transport;
  private storage: KeyValueStore;
  private net: NetConfig;
  private name: string;
  private token: string | null = null;

  private hostPeer: PeerId | null = null;
  private mySeat: Seat | null = null;
  private view: PlayerView | null = null;
  private stateVersion = 0;
  private lobbyVersion = 0;
  private seatInfo: SeatInfo[] = [];
  private started = false;
  private policy: JoinPolicy = { ...DEFAULT_POLICY };
  private table: TableSummary | null = null;
  private notice: string | null = null;
  private pause: PauseState = { paused: false, by: null, resuming: false };
  private waitForHost: string | null;
  private eventListeners = new Set<(e: TableEvent) => void>();
  private connection: ConnectionState = { kind: 'connecting' };
  private welcomed = false;
  private networkTrouble = false;

  private joinStartedAt = 0;
  private lastHostSeen = 0;
  private lostAt: number | null = null;
  private waitDeadline = 0;
  private lastResyncAt = 0;

  private outbox = new Outbox();
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (e: SessionError | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private viewListeners = new Set<(v: PlayerView) => void>();
  private tableListeners = new Set<(t: TableInfo) => void>();
  private lobbyListeners = new Set<(l: LobbySnapshot) => void>();
  private unsubscribers: (() => void)[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(opts: ClientOptions) {
    this.transport = opts.transport;
    this.storage = opts.storage;
    this.roomCode = opts.roomCode;
    this.name = opts.name;
    this.net = opts.net ?? NET_CONFIG;
    this.waitForHost = opts.waitForHost ?? null;
  }

  get seats(): Seat[] {
    return this.mySeat === null ? [] : [this.mySeat];
  }

  /** Joins the room (reclaiming our old seat if we have a token for it) and starts heartbeats. */
  async open(): Promise<void> {
    const saved = await this.storage.get<SavedSeat>(STORAGE_KEYS.seat(this.roomCode));
    this.token = saved?.token ?? null;
    const t = this.transport;
    this.unsubscribers.push(
      t.onMessage((from, raw) => this.onMessage(from, raw)),
      // Every peer in the room gets a HELLO; only the host answers.
      t.onPeerJoin((peer) => this.sendTo(peer, this.helloBody())),
      t.onPeerLeave((peer) => peer === this.hostPeer && this.lostHost()),
      t.onError((e) => {
        this.networkTrouble = true;
        if (e.kind === 'signaling-unreachable' && !this.welcomed) this.fail(MESSAGES.offline);
      }),
    );
    await this.connect();
    this.heartbeat = setInterval(() => this.tick(), this.net.heartbeatIntervalMs);
  }

  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void {
    if (seat !== this.mySeat) return () => {};
    this.viewListeners.add(listener);
    if (this.view) listener(this.view);
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

  /** Ask the host to pause. They decide; if they say no we hear 'pause-declined'. */
  requestPause(): void {
    if (this.hostPeer && this.mySeat !== null && !this.pause.paused) this.sendTo(this.hostPeer, { type: 'PAUSE_REQUEST' });
  }

  /** Ask for a seat in a game in progress (null = any open seat). The answer is WELCOME or SEAT_DENIED. */
  takeSeat(seat: Seat | null): void {
    if (!this.hostPeer || this.mySeat !== null) return;
    this.notice = null;
    this.sendTo(this.hostPeer, { type: 'TAKE_SEAT', seat });
    this.notify({ lobby: true });
  }

  subscribeLobby(listener: (l: LobbySnapshot) => void): () => void {
    this.lobbyListeners.add(listener);
    listener(this.lobbySnapshot());
    return () => this.lobbyListeners.delete(listener);
  }

  submit(seat: Seat, action: Action): Promise<SessionError | null> {
    if (seat !== this.mySeat || !this.hostPeer) return Promise.resolve({ code: 'NOT_SEATED', message: 'Not connected to the game' });
    if (this.connection.kind !== 'connected') {
      return Promise.resolve({ code: 'OFFLINE', message: 'Reconnecting… try again in a moment.' });
    }
    // Cheap local check first, so obvious mistakes don't need a round trip.
    if (this.view && !getLegalActionsFromView(this.view).some((a) => JSON.stringify(a) === JSON.stringify(action))) {
      return Promise.resolve({ code: 'ILLEGAL', message: "That move isn't allowed right now" });
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ code: 'TIMEOUT', message: "The host didn't respond. Try again." });
      }, this.net.actionTimeoutMs);
      this.pending.set(requestId, { resolve, timer });
      this.sendTo(this.hostPeer!, { type: 'ACTION', requestId, action });
    });
  }

  /** The page is visible again: check on the host now, and rebuild the connection if it's gone. */
  resume(): void {
    if (this.stopped) return;
    if (this.hostPeer && Date.now() - this.lastHostSeen < this.net.peerTimeoutMs) {
      this.sendTo(this.hostPeer, { type: 'PING', t: Date.now() });
      return;
    }
    void this.connect();
  }

  /** After "the host is taking a while": wait another full period. */
  keepWaiting(): void {
    if (this.connection.kind !== 'host-timeout') return;
    this.waitDeadline = Date.now() + this.net.hostWaitMs;
    this.setConnection({ kind: 'waiting-for-host', deadline: this.waitDeadline });
  }

  /** After a failure: start over. */
  async retry(): Promise<void> {
    this.stopped = false;
    this.welcomed = false;
    this.networkTrouble = false;
    this.setConnection({ kind: 'connecting' });
    await this.connect();
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.tick(), this.net.heartbeatIntervalMs);
  }

  leave(): void {
    if (this.hostPeer) this.sendTo(this.hostPeer, { type: 'LEAVE' });
    void this.forgetGame();
    setTimeout(() => this.close(), 300);
  }

  close(): void {
    this.stop();
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }

  // ---------- Internals ----------

  private async connect(): Promise<void> {
    this.joinStartedAt = Date.now();
    await this.transport.connect(this.roomCode, roomPassword(this.roomCode));
  }

  private stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer);
      resolve({ code: 'OFFLINE', message: 'Disconnected' });
    }
    this.pending.clear();
    this.transport.disconnect();
  }

  private helloBody(): ClientMessageBody {
    return { type: 'HELLO', name: this.name, token: this.token };
  }

  private sendTo(peer: PeerId, body: ClientMessageBody): void {
    if (!this.stopped) this.transport.send(peer, this.outbox.wrap(body));
  }

  private fail(message: string, canRetry = true): void {
    this.setConnection({ kind: 'failed', message, canRetry });
    this.stop();
  }

  private onMessage(from: PeerId, raw: unknown): void {
    if (this.stopped) return;
    // Once we know the host, ignore everyone else (other clients are in the same room).
    // While reconnecting, a resumed host may come back with a new peer ID, so accept a WELCOME.
    const fromHost = from === this.hostPeer;
    if (versionOf(raw) !== PROTOCOL_VERSION) {
      // REJECTED's shape never changes, so we can read it from any protocol version.
      const r = raw as { type?: unknown; hostVersion?: unknown };
      if (r?.type === 'REJECTED' && typeof r.hostVersion === 'number') this.versionMismatch(r.hostVersion);
      return;
    }
    const parsed = parseHostMessage(raw);
    if (!parsed.ok) return;
    const m = parsed.message;
    if (!fromHost) {
      // Before we know the host (or after losing it), the first WELCOME or LOBBY tells us who it is.
      const looking = this.hostPeer === null || this.lostAt !== null;
      if (!looking) return;
      if (m.type === 'REJECTED' && !this.welcomed) return this.handle(from, m);
      if (m.type !== 'WELCOME' && m.type !== 'LOBBY') return;
      this.adoptHost(from);
    }
    this.lastHostSeen = Date.now();
    this.handle(from, m);
  }

  private adoptHost(peer: PeerId): void {
    this.hostPeer = peer;
    // A host that resumed from its save may be a step behind what we last saw; take its word.
    this.stateVersion = 0;
    this.lobbyVersion = 0;
    this.lostAt = null;
    this.setConnection({ kind: 'connected' });
  }

  private handle(from: PeerId, m: HostMessage): void {
    switch (m.type) {
      case 'WELCOME':
        if (m.roomCode !== this.roomCode) return;
        this.hostPeer = from;
        this.mySeat = m.seat;
        this.token = m.token;
        this.welcomed = true;
        this.notice = null;
        void this.storage.set(STORAGE_KEYS.seat(this.roomCode), { token: m.token, seat: m.seat } satisfies SavedSeat);
        this.setConnection({ kind: 'connected' });
        return;
      case 'REJECTED':
        if (m.reason === 'VERSION_MISMATCH') return this.versionMismatch(m.hostVersion);
        if (m.reason === 'KICKED') void this.forgetGame();
        this.setConnection({ kind: 'rejected', message: REJECT_MESSAGES[m.reason], needsUpdate: false });
        return this.stop();
      case 'LOBBY': {
        if (m.lobbyVersion <= this.lobbyVersion) return;
        this.lobbyVersion = m.lobbyVersion;
        const now = Date.now();
        this.seatInfo = m.seats.map((seat) => (seat.reservedMs === undefined ? seat : { ...seat, reservedUntil: now + seat.reservedMs }));
        this.started = m.started;
        this.policy = m.policy;
        this.table = m.table;
        this.pause = m.pause;
        if (this.welcomed && m.started && this.table?.phase !== 'gameOver') this.rememberGame(false);
        return this.notify({ lobby: true });
      }
      case 'SEAT_DENIED':
        if (m.reason === 'SEAT_EXPIRED') {
          // Our seat is gone; we're a newcomer again and can pick a seat (or be auto-seated).
          this.token = null;
          this.mySeat = null;
          this.welcomed = false;
          this.view = null;
          this.stateVersion = 0;
          void this.storage.delete(STORAGE_KEYS.seat(this.roomCode));
        }
        this.notice = DENIED_MESSAGES[m.reason];
        return this.notify({ lobby: true });
      case 'EVENT':
        for (const l of this.eventListeners) l(m.event);
        return;
      case 'VIEW':
        if (m.stateVersion <= this.stateVersion || m.view.seat !== this.mySeat) return; // stale, or not ours
        this.stateVersion = m.stateVersion;
        this.view = m.view;
        if (m.view.phase === 'gameOver') void this.storage.delete(STORAGE_KEYS.clientRef(this.roomCode)); // finished games aren't kept
        return this.notify({ view: true });
      case 'ACTION_RESULT': {
        const p = this.pending.get(m.requestId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.requestId);
        return p.resolve(m.error);
      }
      case 'PONG': {
        // Behind the host? We missed a message; ask for everything again (at most once a second).
        const behind = m.stateVersion > this.stateVersion || m.lobbyVersion > this.lobbyVersion;
        if (behind && Date.now() - this.lastResyncAt > 1000) {
          this.lastResyncAt = Date.now();
          this.sendTo(from, { type: 'RESYNC' });
        }
        return;
      }
      case 'HOST_STATUS':
        if (m.status === 'ended') {
          void this.forgetGame();
          this.setConnection({ kind: 'ended', message: m.message || MESSAGES.ended });
          this.stop();
        } else if (m.status === 'saved') {
          // Keep our seat token and a reference, so we can rejoin when the host resumes.
          this.rememberGame(true, m.label);
          this.setConnection({ kind: 'ended', message: m.message });
          this.stop();
        }
        return;
    }
  }

  /** Our seat token and game reference are no longer useful: the game ended, or we left or were removed. */
  private async forgetGame(): Promise<void> {
    await this.storage.delete(STORAGE_KEYS.seat(this.roomCode));
    await this.storage.delete(STORAGE_KEYS.clientRef(this.roomCode));
  }

  /** Keeps a small reference to this game (names and score only) for the start screen. */
  private rememberGame(savedByHost: boolean, label?: string): void {
    if (this.mySeat === null || !this.started) return;
    const t = this.table;
    const humans = this.seatInfo.filter((s) => s.kind === 'human' || s.kind === 'reserved').map((s) => s.name);
    const bots = this.seatInfo.length - humans.length;
    const fallback = `${humans.join(', ')}${bots ? ` + ${bots} bot${bots > 1 ? 's' : ''}` : ''}${t ? ` · ${t.scores[0]}–${t.scores[1]} · Set ${t.setNumber}` : ''}`;
    const ref: ClientGameRef = {
      roomCode: this.roomCode,
      hostName: this.seatInfo[0]?.name || 'the host',
      label: label ?? fallback,
      savedAt: Date.now(),
      savedByHost,
    };
    void this.storage.set(STORAGE_KEYS.clientRef(this.roomCode), ref);
  }

  private versionMismatch(hostVersion: number): void {
    const message =
      hostVersion > PROTOCOL_VERSION
        ? 'This game needs a newer version of Lorris. Please update the app (reload the page) and try again.'
        : "The host is using an older version of Lorris. Ask them to update the app (reload the page).";
    this.setConnection({ kind: 'rejected', message, needsUpdate: hostVersion > PROTOCOL_VERSION });
    this.stop();
  }

  private lostHost(): void {
    if (this.lostAt !== null || !this.hostPeer) return;
    this.lostAt = Date.now();
    this.waitDeadline = this.lostAt + this.net.hostWaitMs;
    this.setConnection({ kind: 'reconnecting' });
  }

  private tick(): void {
    if (this.stopped) return;
    const now = Date.now();
    if (!this.hostPeer) {
      // Still looking for the room: keep knocking, but don't leave anyone on a spinner forever.
      if (this.waitForHost !== null) {
        // A saved game the host hasn't reopened yet: keep knocking until they do.
        if (this.connection.kind !== 'waiting-to-resume') this.setConnection({ kind: 'waiting-to-resume', hostName: this.waitForHost });
        this.transport.broadcast(this.outbox.wrap(this.helloBody()));
        return;
      }
      if (now - this.joinStartedAt > this.net.joinTimeoutMs) {
        return this.networkTrouble ? this.fail(MESSAGES.blocked) : this.fail(MESSAGES.notFound, false);
      }
      this.transport.broadcast(this.outbox.wrap(this.helloBody()));
      return;
    }
    if (now - this.lastHostSeen > this.net.peerTimeoutMs) this.lostHost();
    if (this.lostAt === null) {
      // Seated or still choosing a seat: either way, keep the host aware we're here.
      this.sendTo(this.hostPeer, { type: 'PING', t: now });
      return;
    }
    // Lost the host: knock with our token. A host that comes back (even as a new peer) will seat us again.
    this.transport.broadcast(this.outbox.wrap(this.helloBody()));
    if (this.connection.kind === 'reconnecting' && now - this.lostAt > 2 * this.net.peerTimeoutMs) {
      this.setConnection({ kind: 'waiting-for-host', deadline: this.waitDeadline });
    } else if (this.connection.kind === 'waiting-for-host' && now > this.waitDeadline) {
      this.setConnection({ kind: 'host-timeout' });
    }
  }

  private setConnection(c: ConnectionState): void {
    this.connection = c;
    this.notify({ lobby: true });
  }

  private tableInfo(): TableInfo {
    return { seats: this.seatInfo, connection: this.connection, pause: this.pause };
  }

  private lobbySnapshot(): LobbySnapshot {
    return {
      roomCode: this.roomCode,
      seats: this.seatInfo,
      started: this.started,
      mySeat: this.mySeat,
      isHost: false,
      connection: this.connection,
      policy: this.policy,
      table: this.table,
      notice: this.notice,
      pause: this.pause,
    };
  }

  private notify(what: { lobby?: boolean; view?: boolean }): void {
    if (what.lobby) {
      const t = this.tableInfo();
      for (const l of this.tableListeners) l(t);
      const snap = this.lobbySnapshot();
      for (const l of this.lobbyListeners) l(snap);
    }
    if (what.view && this.view) for (const l of this.viewListeners) l(this.view);
  }
}
