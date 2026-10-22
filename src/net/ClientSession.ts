// A client: joins a room, shows the views the host sends, and sends intents back.
// Never holds more than its own player view. Everything from the network is validated first.

import { getLegalActionsFromView, type Action, type PlayerView, type Seat } from '../core';
import { STORAGE_KEYS, type KeyValueStore } from '../session/storage';
import type { ConnectionState, LobbySnapshot, OnlineSession, SessionError, TableInfo } from '../session/types';
import { NET_CONFIG, type NetConfig } from './config';
import { Outbox, PROTOCOL_VERSION, type ClientMessageBody, type HostMessage, type RejectReason, type SeatInfo } from './protocol';
import { roomPassword } from './roomCode';
import type { PeerId, Transport } from './transport';
import { parseHostMessage, versionOf } from './validate';

export interface ClientOptions {
  transport: Transport;
  storage: KeyValueStore;
  roomCode: string;
  name: string;
  net?: NetConfig;
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
    void this.storage.delete(STORAGE_KEYS.seat(this.roomCode));
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
    if (!fromHost && m.type !== 'WELCOME' && !(m.type === 'REJECTED' && !this.welcomed)) return;
    if (fromHost || m.type === 'WELCOME') this.lastHostSeen = Date.now();
    this.handle(from, m);
  }

  private handle(from: PeerId, m: HostMessage): void {
    switch (m.type) {
      case 'WELCOME':
        if (m.roomCode !== this.roomCode) return;
        this.hostPeer = from;
        this.mySeat = m.seat;
        this.token = m.token;
        this.welcomed = true;
        // A host that resumed from its save may be a step behind what we last saw; take its word.
        this.stateVersion = 0;
        this.lobbyVersion = 0;
        this.lostAt = null;
        void this.storage.set(STORAGE_KEYS.seat(this.roomCode), { token: m.token, seat: m.seat } satisfies SavedSeat);
        this.setConnection({ kind: 'connected' });
        return;
      case 'REJECTED':
        if (m.reason === 'VERSION_MISMATCH') return this.versionMismatch(m.hostVersion);
        if (m.reason === 'KICKED') void this.storage.delete(STORAGE_KEYS.seat(this.roomCode));
        this.setConnection({ kind: 'rejected', message: REJECT_MESSAGES[m.reason], needsUpdate: false });
        return this.stop();
      case 'LOBBY':
        if (m.lobbyVersion <= this.lobbyVersion) return;
        this.lobbyVersion = m.lobbyVersion;
        this.seatInfo = m.seats;
        this.started = m.started;
        return this.notify({ lobby: true });
      case 'VIEW':
        if (m.stateVersion <= this.stateVersion || m.view.seat !== this.mySeat) return; // stale, or not ours
        this.stateVersion = m.stateVersion;
        this.view = m.view;
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
          void this.storage.delete(STORAGE_KEYS.seat(this.roomCode));
          this.setConnection({ kind: 'ended', message: m.message || MESSAGES.ended });
          this.stop();
        }
        return;
    }
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
    if (this.lostAt !== null || !this.welcomed) return;
    this.lostAt = Date.now();
    this.waitDeadline = this.lostAt + this.net.hostWaitMs;
    this.setConnection({ kind: 'reconnecting' });
  }

  private tick(): void {
    if (this.stopped) return;
    const now = Date.now();
    if (!this.welcomed) {
      // Still looking for the room: keep knocking, but don't leave anyone on a spinner forever.
      if (now - this.joinStartedAt > this.net.joinTimeoutMs) {
        return this.networkTrouble ? this.fail(MESSAGES.blocked) : this.fail(MESSAGES.notFound, false);
      }
      this.transport.broadcast(this.outbox.wrap(this.helloBody()));
      return;
    }
    if (now - this.lastHostSeen > this.net.peerTimeoutMs) this.lostHost();
    if (this.lostAt === null) {
      this.sendTo(this.hostPeer!, { type: 'PING', t: now });
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
    return { seats: this.seatInfo, connection: this.connection };
  }

  private lobbySnapshot(): LobbySnapshot {
    return {
      roomCode: this.roomCode,
      seats: this.seatInfo,
      started: this.started,
      mySeat: this.mySeat,
      isHost: false,
      connection: this.connection,
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
