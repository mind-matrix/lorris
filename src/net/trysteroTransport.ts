// Real transport: WebRTC data channels via Trystero, using public Nostr relays only to find
// peers. Signaling data is encrypted with the room password.

import { joinRoom, selfId, type Room } from 'trystero';
import { NET_CONFIG } from './config';
import { getIceServers, invalidateIceServers } from './iceServers';
import { Emitter, type PeerId, type Transport, type TransportError } from './transport';

export class TrysteroTransport implements Transport {
  readonly selfId: PeerId = selfId;
  private room: Room | null = null;
  private sendRaw: ((data: never, options?: { target?: string }) => Promise<void>) | null = null;
  private messages = new Emitter<[PeerId, unknown]>();
  private joins = new Emitter<[PeerId]>();
  private leaves = new Emitter<[PeerId]>();
  private errors = new Emitter<[TransportError]>();
  /** Bumped by every connect() and disconnect(), so a connect() still waiting can tell it's stale. */
  private attempt = 0;

  async connect(roomId: string, password: string): Promise<void> {
    this.disconnect();
    const attempt = this.attempt;
    // STUN + our relay + Metered relays. Bounded by a short timeout, and usually cached already.
    const iceServers = await getIceServers();
    // disconnect() (or another connect()) happened while we waited: don't join after all.
    if (attempt !== this.attempt) return;
    const room = joinRoom(
      {
        appId: NET_CONFIG.appId,
        password,
        maxReceiveBytes: NET_CONFIG.maxHostMessageBytes,
        ...(NET_CONFIG.relayUrls ? { relayConfig: { urls: NET_CONFIG.relayUrls } } : {}),
        rtcConfig: { iceServers },
      },
      roomId,
      {
        // Fires on a wrong password, a failed handshake, or when WebRTC can't connect at all
        // (usually a network that blocks peer-to-peer traffic).
        onJoinError: (details) => {
          // Maybe the relay credentials expired: fetch fresh ones next time (rate-limited).
          invalidateIceServers();
          this.errors.emit({ kind: 'peer-connection-failed', peer: details.peerId, detail: details.error });
        },
      },
    );
    // One action carries every protocol message; the protocol layer tells them apart.
    const action = room.makeAction('lorris');
    action.onMessage = (data, { peerId }) => this.messages.emit(peerId, data);
    room.onPeerJoin = (peer) => this.joins.emit(peer);
    room.onPeerLeave = (peer) => this.leaves.emit(peer);
    this.room = room;
    this.sendRaw = action.send as never;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.errors.emit({ kind: 'signaling-unreachable', detail: 'offline' });
    }
  }

  send(to: PeerId, message: unknown): void {
    this.sendRaw?.(message as never, { target: to }).catch(() => {});
  }

  broadcast(message: unknown): void {
    this.sendRaw?.(message as never).catch(() => {});
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
    this.attempt++;
    this.room?.leave().catch(() => {});
    this.room = null;
    this.sendRaw = null;
  }
}
