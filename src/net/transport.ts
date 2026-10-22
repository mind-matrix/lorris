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
