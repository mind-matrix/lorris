// The ICE server list for WebRTC: our STUN servers, our own TURN relay (if configured), then
// Metered's Open Relay TURN servers (if configured, fetched at runtime). Online play never
// waits long for, or fails because of, Metered: any problem just means no Metered servers.

import { NET_CONFIG, type NetConfig } from './config';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceSettings {
  stunServers: string[];
  ownRelay: { urls: string[]; username: string; credential: string } | null;
  metered: { app: string; apiKey: string } | null;
  fetchTimeoutMs: number;
  cacheMs: number;
  retryMs: number;
  maxServers: number;
  maxMetered: number;
}

const MAX_STRING = 512;
const MAX_URLS_PER_ENTRY = 8;
const TURN_URL = /^turns?:/i;
const APP_NAME = /^[a-z0-9-]{1,63}$/;

const devWarn = (msg: string) => {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.warn(`[lorris] ${msg}`);
};

/** Reads the relay settings, skipping (with a dev-only warning) anything half-configured. */
export function settingsFromConfig(cfg: NetConfig = NET_CONFIG): IceSettings {
  const t = cfg.turn;
  let ownRelay: IceSettings['ownRelay'] = null;
  const ownParts = [t.urls.length > 0, !!t.username, !!t.credential];
  if (ownParts.every(Boolean)) {
    const urls = t.urls.filter((u) => TURN_URL.test(u) && u.length <= MAX_STRING);
    if (urls.length) ownRelay = { urls, username: t.username, credential: t.credential };
    else devWarn('VITE_TURN_URLS has no turn:/turns: URLs; own relay not used.');
  } else if (ownParts.some(Boolean)) {
    devWarn('Own TURN relay is half-configured (need VITE_TURN_URLS, VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL); not used.');
  }
  let metered: IceSettings['metered'] = null;
  if (t.meteredApp && t.meteredApiKey) {
    if (APP_NAME.test(t.meteredApp)) metered = { app: t.meteredApp, apiKey: t.meteredApiKey };
    else devWarn('VITE_METERED_APP must be just the subdomain (letters, digits, dashes); Metered not used.');
  } else if (t.meteredApp || t.meteredApiKey) {
    devWarn('Metered is half-configured (need VITE_METERED_APP and VITE_METERED_API_KEY); not used.');
  }
  return {
    stunServers: cfg.stunServers,
    ownRelay,
    metered,
    fetchTimeoutMs: cfg.iceFetchTimeoutMs,
    cacheMs: cfg.iceCacheMs,
    retryMs: cfg.iceRetryMs,
    maxServers: cfg.maxIceServers,
    maxMetered: cfg.maxMeteredServers,
  };
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_STRING;

/** An expiry hint from a Metered entry (epoch seconds or ms, or a ttl in seconds), as epoch ms. */
function expiryOf(e: Record<string, unknown>, now: number): number | null {
  const ttl = e.ttl;
  if (typeof ttl === 'number' && ttl > 0) return now + ttl * 1000;
  for (const key of ['expiresAt', 'expiry', 'expires', 'expiration']) {
    const v = e[key];
    if (typeof v === 'number' && v > 0) return v > 1e12 ? v : v * 1000;
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  }
  return null;
}

/**
 * Treats a Metered response as untrusted: only an array; only TURN entries (we have our own
 * STUN); only turn:/turns: URLs; string username and credential required; lengths and counts capped.
 */
export function sanitizeMetered(raw: unknown, max: number, now = Date.now()): { servers: IceServer[]; expiresAt: number | null } {
  if (!Array.isArray(raw)) return { servers: [], expiresAt: null };
  const servers: IceServer[] = [];
  let expiresAt: number | null = null;
  for (const e of raw.slice(0, 50)) {
    if (servers.length >= max) break;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) continue;
    const entry = e as Record<string, unknown>;
    const list = typeof entry.urls === 'string' ? [entry.urls] : Array.isArray(entry.urls) ? entry.urls : [];
    const urls = list.filter((u): u is string => isStr(u) && TURN_URL.test(u)).slice(0, MAX_URLS_PER_ENTRY);
    if (urls.length === 0 || !isStr(entry.username) || !isStr(entry.credential)) continue;
    servers.push({ urls, username: entry.username, credential: entry.credential });
    const exp = expiryOf(entry, now);
    if (exp !== null) expiresAt = expiresAt === null ? exp : Math.min(expiresAt, exp);
  }
  return { servers, expiresAt };
}

/** Removes URLs already listed by an earlier server, drops emptied entries, and caps the count. */
function dedupe(servers: IceServer[], max: number): IceServer[] {
  const seen = new Set<string>();
  const out: IceServer[] = [];
  for (const s of servers) {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !seen.has(u.toLowerCase()));
    urls.forEach((u) => seen.add(u.toLowerCase()));
    if (urls.length && out.length < max) out.push({ ...s, urls: urls.length === 1 ? urls[0] : urls });
  }
  return out;
}

async function fetchMetered(s: IceSettings, fetchFn: typeof fetch, now: number): Promise<{ servers: IceServer[]; expiresAt: number | null } | null> {
  if (!s.metered) return { servers: [], expiresAt: null };
  const url = `https://${s.metered.app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(s.metered.apiKey)}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), s.fetchTimeoutMs);
  try {
    const res = await Promise.race([
      fetchFn(url, { signal: abort.signal, credentials: 'omit', cache: 'no-store' }),
      // Belt and braces: even a fetch that ignores the abort signal can't hold us up.
      new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    if (!res.ok) return null;
    return sanitizeMetered(await res.json(), s.maxMetered, now);
  } catch {
    return null; // network error, timeout, or invalid JSON
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Cache (in memory, per page) ----------

let cached: { servers: IceServer[]; expiresAt: number; fetchedAt: number } | null = null;
let inFlight: Promise<IceServer[]> | null = null;

export interface IceOptions {
  settings?: IceSettings;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The ICE servers to use now. Never rejects; returns quickly from cache once fetched. */
export function getIceServers(opts: IceOptions = {}): Promise<IceServer[]> {
  const now = (opts.now ?? Date.now)();
  if (cached && now < cached.expiresAt) return Promise.resolve(cached.servers);
  // Several connections at once share one fetch.
  if (inFlight) return inFlight;
  const settings = opts.settings ?? settingsFromConfig();
  const fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  inFlight = (async () => {
    const metered = await fetchMetered(settings, fetchFn, now);
    const servers = dedupe(
      [
        ...(settings.stunServers.length ? [{ urls: settings.stunServers }] : []),
        ...(settings.ownRelay ? [settings.ownRelay] : []),
        ...(metered?.servers ?? []),
      ],
      settings.maxServers,
    );
    // A failed Metered fetch is retried soon; a good list is kept for the cache time, or until
    // Metered's own expiry if that's sooner.
    const keep = metered === null ? settings.retryMs : Math.min(settings.cacheMs, (metered.expiresAt ?? Infinity) - now);
    cached = { servers, expiresAt: now + Math.max(0, keep), fetchedAt: now };
    return servers;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Start fetching in the background (when online play opens), so the first connection rarely waits. */
export function prefetchIceServers(opts?: IceOptions): void {
  void getIceServers(opts);
}

/**
 * A peer connection failed: maybe the cached credentials expired. Fetch fresh ones next time,
 * but never sooner than the retry delay after the last fetch, so failures can't hammer Metered.
 */
export function invalidateIceServers(now = Date.now(), retryMs = NET_CONFIG.iceRetryMs): void {
  if (cached) cached.expiresAt = Math.min(cached.expiresAt, Math.max(now, cached.fetchedAt + retryMs));
}

/** Tests only. */
export function resetIceServerCache(): void {
  cached = null;
  inFlight = null;
}
