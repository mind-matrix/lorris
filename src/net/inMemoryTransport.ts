// An in-process network for tests. Peers join rooms on a shared InMemoryNetwork, which can
// add latency, drop messages, stall a peer silently, or disconnect it abruptly. Messages are
// JSON round-tripped, exactly like a real wire, and delivered in order per pair of peers.

import { mulberry32 } from '../core';
import { Emitter, type PeerId, type Transport, type TransportError } from './transport';

export interface NetworkTapEvent {
  from: PeerId;
  to: PeerId;
  message: unknown;
  dropped: boolean;
}

export interface InMemoryNetworkOptions {
  /** Delivery delay in ms (fixed or per message). Default 5. */
  latencyMs?: number | ((from: PeerId, to: PeerId) => number);
  /** Probability (0-1) that a message is silently lost. Default 0. */
  dropRate?: number;
  /** Seed for the drop decisions, so tests are repeatable. */
  seed?: number;
}

interface Member {
  transport: InMemoryTransport;
  password: string;
}

export class InMemoryNetwork {
  latencyMs: number | ((from: PeerId, to: PeerId) => number);
  dropRate: number;
  /** Observes every message sent (including dropped ones). */
  tap: ((event: NetworkTapEvent) => void) | null = null;

  private rooms = new Map<string, Map<PeerId, Member>>();
  private stalled = new Set<PeerId>();
  private lastDelivery = new Map<string, number>();
  private rng: number;
  private nextId = 0;

  constructor(options: InMemoryNetworkOptions = {}) {
    this.latencyMs = options.latencyMs ?? 5;
    this.dropRate = options.dropRate ?? 0;
    this.rng = options.seed ?? 1;
  }

  createTransport(id?: PeerId): InMemoryTransport {
    return new InMemoryTransport(this, id ?? `peer-${++this.nextId}`);
  }

  /** Abruptly cut a peer off: everyone (including the peer) sees the others leave. */
  disconnect(peer: PeerId): void {
    for (const [roomId, members] of this.rooms) {
      const member = members.get(peer);
      if (!member) continue;
      members.delete(peer);
      for (const other of members.values()) {
        other.transport._peerLeft(peer);
        member.transport._peerLeft(other.transport.selfId);
      }
      if (members.size === 0) this.rooms.delete(roomId);
    }
  }

  /** Silently stop (or resume) all traffic to and from a peer, without any leave events. */
  setStalled(peer: PeerId, stalled: boolean): void {
    if (stalled) this.stalled.add(peer);
    else this.stalled.delete(peer);
  }

  peersIn(roomId: string): PeerId[] {
    return [...(this.rooms.get(roomId)?.keys() ?? [])];
  }

  // ---- used by InMemoryTransport ----

  _join(roomId: string, transport: InMemoryTransport, password: string): void {
    let members = this.rooms.get(roomId);
    if (!members) this.rooms.set(roomId, (members = new Map()));
    const others = [...members.values()];
    members.set(transport.selfId, { transport, password });
    for (const other of others) {
      if (other.password !== password) {
        // Like a wrong room password in Trystero: the handshake fails.
        this.later(() => transport._error({ kind: 'peer-connection-failed', peer: other.transport.selfId, detail: 'password' }), 0);
        continue;
      }
      const delay = this.latency(transport.selfId, other.transport.selfId);
      this.later(() => {
        if (!this.connected(roomId, transport.selfId, other.transport.selfId)) return;
        other.transport._peerJoined(transport.selfId);
        transport._peerJoined(other.transport.selfId);
      }, delay);
    }
  }

  _leave(roomId: string, transport: InMemoryTransport): void {
    const members = this.rooms.get(roomId);
    if (!members?.delete(transport.selfId)) return;
    for (const other of members.values()) other.transport._peerLeft(transport.selfId);
  }

  _send(roomId: string, from: PeerId, to: PeerId, message: unknown): void {
    let dropped = this.stalled.has(from) || this.stalled.has(to) || !this.connected(roomId, from, to);
    if (!dropped && this.dropRate > 0) {
      let r: number;
      [r, this.rng] = mulberry32(this.rng);
      dropped = r < this.dropRate;
    }
    this.tap?.({ from, to, message, dropped });
    if (dropped) return;

    const wire = JSON.stringify(message);
    // Keep per-pair ordering, like a reliable ordered data channel.
    const key = `${from}>${to}`;
    const now = Date.now();
    const at = Math.max(now + this.latency(from, to), this.lastDelivery.get(key) ?? 0);
    this.lastDelivery.set(key, at);
    this.later(() => {
      if (!this.connected(roomId, from, to) || this.stalled.has(to)) return;
      this.rooms.get(roomId)!.get(to)!.transport._receive(from, JSON.parse(wire));
    }, at - now);
  }

  _broadcastTargets(roomId: string, from: PeerId): PeerId[] {
    return this.peersIn(roomId).filter((p) => p !== from && this.samePassword(roomId, from, p));
  }

  private connected(roomId: string, a: PeerId, b: PeerId): boolean {
    const members = this.rooms.get(roomId);
    return !!members?.has(a) && !!members.has(b) && this.samePassword(roomId, a, b);
  }

  private samePassword(roomId: string, a: PeerId, b: PeerId): boolean {
    const members = this.rooms.get(roomId);
    return members?.get(a)?.password === members?.get(b)?.password;
  }

  private latency(from: PeerId, to: PeerId): number {
    return typeof this.latencyMs === 'function' ? this.latencyMs(from, to) : this.latencyMs;
  }

  private later(fn: () => void, ms: number): void {
    setTimeout(fn, ms);
  }
}

export class InMemoryTransport implements Transport {
  private roomId: string | null = null;
  private messages = new Emitter<[PeerId, unknown]>();
  private joins = new Emitter<[PeerId]>();
  private leaves = new Emitter<[PeerId]>();
  private errors = new Emitter<[TransportError]>();
  private peers = new Set<PeerId>();

  constructor(
    private network: InMemoryNetwork,
    readonly selfId: PeerId,
  ) {}

  async connect(roomId: string, password: string): Promise<void> {
    if (this.roomId) this.disconnect();
    this.roomId = roomId;
    this.network._join(roomId, this, password);
  }

  send(to: PeerId, message: unknown): void {
    if (this.roomId && this.peers.has(to)) this.network._send(this.roomId, this.selfId, to, message);
  }

  broadcast(message: unknown): void {
    if (!this.roomId) return;
    for (const to of this.network._broadcastTargets(this.roomId, this.selfId)) {
      if (this.peers.has(to)) this.network._send(this.roomId, this.selfId, to, message);
    }
  }

  onMessage(handler: (from: PeerId, message: unknown) => void) {
    return this.messages.add(handler);
  }
  onPeerJoin(handler: (peer: PeerId) => void) {
    return this.joins.add(handler);
  }
  onPeerLeave(handler: (peer: PeerId) => void) {
    return this.leaves.add(handler);
  }
  onError(handler: (error: TransportError) => void) {
    return this.errors.add(handler);
  }

  disconnect(): void {
    if (!this.roomId) return;
    this.network._leave(this.roomId, this);
    this.roomId = null;
    this.peers.clear();
  }

  // ---- called by the network ----
  _receive(from: PeerId, message: unknown) {
    if (this.peers.has(from)) this.messages.emit(from, message);
  }
  _peerJoined(peer: PeerId) {
    if (this.peers.has(peer)) return;
    this.peers.add(peer);
    this.joins.emit(peer);
  }
  _peerLeft(peer: PeerId) {
    if (!this.peers.delete(peer)) return;
    this.leaves.emit(peer);
  }
  _error(error: TransportError) {
    this.errors.emit(error);
  }
}
