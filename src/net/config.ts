// Everything about online play you might want to tune lives here.

export const NET_CONFIG = {
  /** Namespaces our rooms on the signaling network so other apps never see them. */
  appId: 'io.github.mind-matrix.lorris',

  /**
   * Nostr relays used only to find peers (game data goes directly peer to peer).
   * null = Trystero's built-in, rotating list of public relays, which is more resilient than
   * a fixed list because individual public relays come and go. Set an array to override.
   */
  relayUrls: null as string[] | null,

  /** Public STUN servers that help peers discover how to reach each other. */
  stunServers: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],

  /**
   * Optional TURN relays for networks that block direct connections. Empty by default because
   * free TURN services need an account. Format: { urls, username, credential }.
   */
  turnServers: [] as { urls: string | string[]; username?: string; credential?: string }[],

  /** How often clients ping the host. */
  heartbeatIntervalMs: 3_000,
  /** Silence after which a peer counts as "reconnecting". */
  peerTimeoutMs: 9_000,
  /** How long a disconnected player has before a bot plays their seat. */
  botTakeoverMs: 30_000,
  /** How long clients wait for a missing host before asking whether to keep waiting. */
  hostWaitMs: 180_000,
  /** How long to look for a room before telling the player it couldn't be found. */
  joinTimeoutMs: 20_000,
  /** How long a client waits for the host to answer an action. */
  actionTimeoutMs: 8_000,

  /** Largest message the host accepts from a client (clients only send small intents). */
  maxClientMessageBytes: 4 * 1024,
  /** Largest message a client accepts from the host (player views are a few KB). */
  maxHostMessageBytes: 64 * 1024,
  /** Per-peer rate limit: sustained messages per second, and burst size. */
  rateLimitPerSecond: 10,
  rateLimitBurst: 30,
  /** Drop a peer after this many rate-limited or invalid messages. */
  maxStrikes: 50,

  maxNameLength: 20,
};

export type NetConfig = typeof NET_CONFIG;
