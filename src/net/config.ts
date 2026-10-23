// Everything about online play you might want to tune lives here.

/** A build-time variable (from .env.local or CI secrets), trimmed; '' when unset. */
const env = (name: keyof ImportMetaEnv): string => {
  const v = (import.meta as { env?: Record<string, unknown> }).env?.[name];
  return typeof v === 'string' ? v.trim() : '';
};

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
   * Optional TURN relays for networks that block direct WebRTC connections (common on mobile
   * data). Both are configured at build time and both are optional; see .env.example.
   * These values are built into the app and visible to anyone who opens it.
   */
  turn: {
    /** Open Relay by Metered: the subdomain of <app>.metered.live, and its API key. */
    meteredApp: env('VITE_METERED_APP').toLowerCase(),
    meteredApiKey: env('VITE_METERED_API_KEY'),
    /** Our own coturn relay: comma-separated turn:/turns: URLs, plus its username and password. */
    urls: env('VITE_TURN_URLS')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    username: env('VITE_TURN_USERNAME'),
    credential: env('VITE_TURN_CREDENTIAL'),
  },
  /** Give up on fetching Metered credentials after this long (play continues without them). */
  iceFetchTimeoutMs: 4_000,
  /** Keep a fetched ICE server list this long (shorter if Metered says its credentials expire sooner). */
  iceCacheMs: 60 * 60_000,
  /** After a failed fetch (or a failed connection), wait at least this long before fetching again. */
  iceRetryMs: 60_000,
  /** Every ICE server makes connection setup slower: keep the list lean. */
  maxIceServers: 8,
  maxMeteredServers: 6,

  /** How often clients ping the host. */
  heartbeatIntervalMs: 3_000,
  /** Silence after which a peer counts as "reconnecting". */
  peerTimeoutMs: 9_000,
  /** How long a disconnected player has before a bot plays their seat. */
  botTakeoverMs: 30_000,
  /**
   * How long a disconnected player's seat stays reserved for them. After that it becomes an
   * open bot seat that a newcomer can take, and their seat token stops working.
   */
  seatReservationMs: 120_000,
  /** Most newcomers (not yet seated) the host keeps track of at once. */
  maxGuests: 12,
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
