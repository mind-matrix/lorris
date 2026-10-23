import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NET_CONFIG } from './config';
import { getIceServers, invalidateIceServers, prefetchIceServers, resetIceServerCache, sanitizeMetered, settingsFromConfig, type IceSettings } from './iceServers';

const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const base: IceSettings = { stunServers: STUN, ownRelay: null, metered: null, fetchTimeoutMs: 4000, cacheMs: 3_600_000, retryMs: 60_000, maxServers: 8, maxMetered: 6 };
const own = { urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:5349'], username: 'lorris', credential: 's3cret' };
const metered = { app: 'lorris-test', apiKey: 'key with&odd=chars' };
const turnEntry = (i: number) => ({ urls: `turn:a.relay.metered.ca:${80 + i}`, username: `u${i}`, credential: `c${i}` });

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response);

beforeEach(() => resetIceServerCache());
afterEach(() => vi.useRealTimers());

describe('ICE server list', () => {
  it('no relays configured: only STUN, and no network request', async () => {
    const fetch = vi.fn();
    expect(await getIceServers({ settings: base, fetch })).toEqual([{ urls: STUN }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('includes our own coturn relay after STUN', async () => {
    const list = await getIceServers({ settings: { ...base, ownRelay: own }, fetch: vi.fn() });
    expect(list).toEqual([{ urls: STUN }, own]);
  });

  it('adds Metered TURN servers after our own relay, with the API key URL-encoded', async () => {
    const fetch = respond([turnEntry(0), turnEntry(1)]);
    const list = await getIceServers({ settings: { ...base, ownRelay: own, metered }, fetch });
    expect(list).toEqual([{ urls: STUN }, own, turnEntry(0), turnEntry(1)]);
    const url = (fetch.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe('https://lorris-test.metered.live/api/v1/turn/credentials?apiKey=key%20with%26odd%3Dchars');
  });

  for (const [name, fetch] of [
    ['throws', vi.fn(async () => Promise.reject(new TypeError('network down')))],
    ['returns a non-OK status', respond([turnEntry(0)], false)],
    ['returns invalid JSON', vi.fn(async () => ({ ok: true, json: async () => JSON.parse('{nope') }) as unknown as Response)],
  ] as const) {
    it(`falls back to the other servers when Metered ${name}`, async () => {
      expect(await getIceServers({ settings: { ...base, ownRelay: own, metered }, fetch: fetch as unknown as typeof globalThis.fetch })).toEqual([{ urls: STUN }, own]);
    });
  }

  it('a Metered request that never answers is aborted after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never resolves, even when aborted
    });
    const pending = getIceServers({ settings: { ...base, metered, fetchTimeoutMs: 4000 }, fetch: fetch as unknown as typeof globalThis.fetch });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual([{ urls: STUN }]);
    expect(signal?.aborted).toBe(true);
  });

  it('several connections at once share one fetch, and later ones use the cache', async () => {
    const fetch = respond([turnEntry(0)]);
    const settings = { ...base, metered };
    const [a, b, c] = await Promise.all([getIceServers({ settings, fetch }), getIceServers({ settings, fetch }), getIceServers({ settings, fetch })]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    await getIceServers({ settings, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches for the cache time, or until the credentials expire if sooner', async () => {
    let now = 1_000_000;
    const fetch = respond([{ ...turnEntry(0), ttl: 600 }]); // 10 minutes
    const settings = { ...base, metered };
    await getIceServers({ settings, fetch, now: () => now });
    now += 9 * 60_000;
    await getIceServers({ settings, fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await getIceServers({ settings, fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch is retried after about a minute, not hours later', async () => {
    let now = 5_000_000;
    let ok = false;
    const fetch = vi.fn(async () => ({ ok, json: async () => [turnEntry(0)] }) as unknown as Response);
    const settings = { ...base, metered };
    expect(await getIceServers({ settings, fetch, now: () => now })).toHaveLength(1);
    ok = true;
    now += 30_000;
    expect(await getIceServers({ settings, fetch, now: () => now })).toHaveLength(1); // still within the retry delay
    now += 31_000;
    expect(await getIceServers({ settings, fetch, now: () => now })).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed connection invalidates the cache, but never sooner than the retry delay after a fetch', async () => {
    let now = 9_000_000;
    const fetch = respond([turnEntry(0)]);
    const settings = { ...base, metered };
    await getIceServers({ settings, fetch, now: () => now });
    invalidateIceServers(now + 10_000, 60_000); // a connection failed 10 s later
    now += 20_000;
    await getIceServers({ settings, fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(1); // too soon: still cached
    now += 45_000;
    await getIceServers({ settings, fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(2); // fresh credentials
  });

  it('prefetch starts the fetch in the background', async () => {
    const fetch = respond([turnEntry(0)]);
    prefetchIceServers({ settings: { ...base, metered }, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    await getIceServers({ settings: { ...base, metered }, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('removes duplicate URLs across sources and caps the total at 8', async () => {
    const dup = { urls: own.urls[0], username: 'x', credential: 'y' }; // same URL as our relay
    const many = Array.from({ length: 6 }, (_, i) => turnEntry(i));
    const list = await getIceServers({ settings: { ...base, ownRelay: own, metered, maxServers: 5 }, fetch: respond([dup, ...many]) });
    const urls = list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(new Set(urls).size).toBe(urls.length);
    expect(list).toHaveLength(5);
    expect(list[1]).toEqual(own);
  });
});

describe('sanitizing the Metered response', () => {
  it('keeps only TURN entries with credentials; drops STUN, non-ICE URLs and wrong types', () => {
    const { servers } = sanitizeMetered(
      [
        { urls: 'stun:stun.relay.metered.ca:80' }, // STUN: we have our own
        { urls: 'turn:ok.example:80', username: 'u', credential: 'c' },
        { urls: ['https://evil.example', 'javascript:alert(1)', 'turns:ok2.example:443'], username: 'u', credential: 'c' },
        { urls: 'turn:nocreds.example:80' },
        { urls: 'turn:badtypes.example:80', username: 5, credential: {} },
        { urls: 42, username: 'u', credential: 'c' },
        'turn:not-an-object',
        null,
        { urls: `turn:${'x'.repeat(600)}`, username: 'u', credential: 'c' },
        { urls: 'turn:long.example:80', username: 'u', credential: 'c'.repeat(600) },
      ],
      6,
    );
    expect(servers).toEqual([
      { urls: ['turn:ok.example:80'], username: 'u', credential: 'c' },
      { urls: ['turns:ok2.example:443'], username: 'u', credential: 'c' },
    ]);
  });

  it('rejects anything that is not an array, and caps the number of servers', () => {
    for (const raw of [null, {}, 'turn:x', { iceServers: [turnEntry(0)] }, 7]) expect(sanitizeMetered(raw, 6).servers).toEqual([]);
    expect(sanitizeMetered(Array.from({ length: 20 }, (_, i) => turnEntry(i)), 6).servers).toHaveLength(6);
  });
});

describe('settings from the build environment', () => {
  const cfg = (turn: Partial<typeof NET_CONFIG.turn>) => ({ ...NET_CONFIG, turn: { ...NET_CONFIG.turn, meteredApp: '', meteredApiKey: '', urls: [], username: '', credential: '', ...turn } });

  it('skips half-configured relays and invalid app names', () => {
    expect(settingsFromConfig(cfg({ urls: ['turn:x:1'], username: 'u' })).ownRelay).toBeNull();
    expect(settingsFromConfig(cfg({ meteredApp: 'app' })).metered).toBeNull();
    expect(settingsFromConfig(cfg({ meteredApp: 'evil.com/x?', meteredApiKey: 'k' })).metered).toBeNull();
    expect(settingsFromConfig(cfg({ urls: ['https://x'], username: 'u', credential: 'c' })).ownRelay).toBeNull();
  });

  it('uses complete relays', () => {
    const s = settingsFromConfig(cfg({ meteredApp: 'lorris', meteredApiKey: 'k', urls: ['turn:x:1'], username: 'u', credential: 'c' }));
    expect(s.metered).toEqual({ app: 'lorris', apiKey: 'k' });
    expect(s.ownRelay).toEqual({ urls: ['turn:x:1'], username: 'u', credential: 'c' });
    expect(s.maxServers).toBe(8);
    expect(s.maxMetered).toBe(6);
    expect(s.cacheMs).toBe(3_600_000);
  });

  it('this build has no relays configured (no .env in the repo)', () => {
    const s = settingsFromConfig();
    expect(s.ownRelay).toBeNull();
    expect(s.metered).toBeNull();
  });
});
