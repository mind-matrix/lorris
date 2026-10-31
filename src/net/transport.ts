// A minimal message channel between peers in a room. Messages are JSON values; the transport
// doesn't interpret them. Validation happens in the protocol layer above.

export type PeerId = string;

export type TransportErrorKind =
  /** Couldn't reach the signaling network at all (offline, relays blocked). */
  | 'signaling-unreachable'
  /** Found a peer but couldn't open a direct connection (network blocks WebRTC). */
  | 'peer-connection-failed';

export interface TransportError {
  kind: TransportErrorKind;
  peer?: PeerId;
  detail?: string;
}

export interface Transport {
  /** This device's peer ID (changes on every page load). */
  readonly selfId: PeerId;
  /** Join a room. The password must match for peers to see each other. */
  connect(roomId: string, password: string): Promise<void>;
  send(to: PeerId, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (from: PeerId, message: unknown) => void): () => void;
  onPeerJoin(handler: (peer: PeerId) => void): () => void;
  onPeerLeave(handler: (peer: PeerId) => void): () => void;
  onError(handler: (error: TransportError) => void): () => void;
  /** Leave the room and drop all connections. connect() may be called again afterwards. */
  disconnect(): void;
  /** Voice messages and connection statistics, on transports that support them. */
  readonly voice?: VoiceLink;
}

/** Small helper for the handler lists every transport keeps. */
export class Emitter<Args extends unknown[]> {
  private handlers = new Set<(...args: Args) => void>();
  add(handler: (...args: Args) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(...args: Args): void {
    for (const h of [...this.handlers]) h(...args);
  }
}

/** Connection quality to one peer, read locally from WebRTC statistics. */
export interface LinkStats {
  /** Round-trip time in ms, or null if not known yet. */
  rttMs: number | null;
  /** Estimated outgoing bandwidth in kbps, or null if not known. */
  outgoingKbps: number | null;
}

/**
 * Voice messages: short recorded clips sent as binary data on their own channel, next to the
 * game protocol. Also connection statistics for deciding whether the network is too slow.
 */
export interface VoiceLink {
  /** Sends a clip (binary) with small JSON metadata, to one peer or several. */
  sendClip(data: ArrayBuffer, meta: unknown, to: PeerId | PeerId[]): void;
  onClip(handler: (from: PeerId, data: ArrayBuffer, meta: unknown) => void): () => void;
  /**
   * Quality of the connection to a peer, read from statistics the browser keeps anyway.
   * Sends nothing over the network (and so nothing through a relay).
   */
  linkStats(peer: PeerId): Promise<LinkStats | null>;
}
