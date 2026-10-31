import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupGame, until } from './testHarness';
import { VOICE_MAX_BYTES, VOICE_MAX_MS, VoiceRateLimiter, parseForwarded, parseOutgoing, type ReceivedClip } from './voiceMessages';

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill).buffer;
const clip = (n = 3000, durationMs = 2000, mime = 'audio/webm;codecs=opus') => ({ data: bytes(n), mime, durationMs });

describe('voice message checks', () => {
  it('accepts normal clips in the formats browsers record', () => {
    for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs="mp4a.40.2"', 'audio/ogg;codecs=opus']) {
      expect(parseOutgoing(bytes(1000), { v: 1, mime, durationMs: 1500 })).not.toBeNull();
    }
  });

  it('refuses anything too big, too long, too short, malformed or not audio', () => {
    const ok = { v: 1, mime: 'audio/webm', durationMs: 2000 };
    expect(parseOutgoing(bytes(VOICE_MAX_BYTES + 1), ok)).toBeNull();
    expect(parseOutgoing(bytes(0), ok)).toBeNull();
    for (const meta of [
      null,
      'x',
      { ...ok, v: 2 },
      { ...ok, durationMs: VOICE_MAX_MS + 5_000 },
      { ...ok, durationMs: 100 },
      { ...ok, durationMs: Number.NaN },
      { ...ok, mime: 'video/webm' },
      { ...ok, mime: 'text/html' },
      { ...ok, mime: 'audio/webm' + ' '.repeat(80) },
    ]) {
      expect(parseOutgoing(bytes(1000), meta)).toBeNull();
    }
  });

  it('a forwarded clip must carry a valid seat', () => {
    expect(parseForwarded(bytes(1000), { v: 1, mime: 'audio/mp4', durationMs: 1000, seat: 3 })?.seat).toBe(3);
    for (const seat of [undefined, -1, 6, 1.5, '2']) expect(parseForwarded(bytes(1000), { v: 1, mime: 'audio/mp4', durationMs: 1000, seat })).toBeNull();
  });

  it('rate limit: one clip per second, at most 20 a minute', () => {
    const r = new VoiceRateLimiter();
    expect(r.allow(0)).toBe(true);
    expect(r.allow(500)).toBe(false);
    let t = 1000;
    let allowed = 1;
    for (let i = 0; i < 40; i++, t += 1000) if (r.allow(t)) allowed++;
    expect(allowed).toBe(20); // within one minute
    expect(r.allow(70_000)).toBe(true); // a minute later, room again
  });
});

describe('voice messages through the host', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function table() {
    const game = await setupGame({ players: 4, clients: 2 });
    const heard = { host: [] as ReceivedClip[], c1: [] as ReceivedClip[], c2: [] as ReceivedClip[] };
    game.host.voiceMessages()!.subscribe((c) => heard.host.push(c));
    game.clients[0].voiceMessages()!.subscribe((c) => heard.c1.push(c));
    game.clients[1].voiceMessages()!.subscribe((c) => heard.c2.push(c));
    return { ...game, heard };
  }

  it("a player's clip reaches everyone else, stamped with their real seat, and not back to them", async () => {
    const { clients, heard } = await table();
    const seat = clients[0].seats[0];
    expect(clients[0].voiceMessages()!.send(clip(3000))).toBe(true);
    await until(() => heard.host.length === 1 && heard.c2.length === 1, 2000);
    expect(heard.host[0]).toMatchObject({ seat, mime: 'audio/webm;codecs=opus', durationMs: 2000 });
    expect(heard.c2[0].seat).toBe(seat);
    expect(new Uint8Array(heard.c2[0].data)).toEqual(new Uint8Array(bytes(3000)));
    expect(heard.c1).toHaveLength(0);
  });

  it("the host's clip reaches every player", async () => {
    const { host, heard } = await table();
    expect(host.voiceMessages()!.send(clip())).toBe(true);
    await until(() => heard.c1.length === 1 && heard.c2.length === 1, 2000);
    expect(heard.c1[0].seat).toBe(0);
    expect(heard.c2[0].seat).toBe(0);
    expect(heard.host).toHaveLength(0);
  });

  it("nobody can speak as someone else: the host ignores any seat in the sender's metadata", async () => {
    const { network, clients, heard } = await table();
    // A tampered client sends straight over the wire, claiming to be the host's seat.
    const raw = (clients[0] as unknown as { transport: { voice: { sendClip: Function } } }).transport.voice;
    raw.sendClip(bytes(2000), { v: 1, mime: 'audio/webm', durationMs: 1500, seat: 0 }, 'host');
    await until(() => heard.c2.length === 1, 2000);
    expect(heard.c2[0].seat).toBe(clients[0].seats[0]);
    void network;
  });

  it('players ignore clips that do not come from the host', async () => {
    const { clients, heard } = await table();
    const raw = (clients[0] as unknown as { transport: { voice: { sendClip: Function } } }).transport.voice;
    raw.sendClip(bytes(2000), { v: 1, mime: 'audio/webm', durationMs: 1500, seat: 0 }, 'client-2');
    await vi.advanceTimersByTimeAsync(500);
    expect(heard.c2).toHaveLength(0);
  });

  it('the host drops oversized, malformed and too-frequent clips', async () => {
    const { clients, heard } = await table();
    const raw = (clients[0] as unknown as { transport: { voice: { sendClip: Function } } }).transport.voice;
    raw.sendClip(bytes(VOICE_MAX_BYTES + 10), { v: 1, mime: 'audio/webm', durationMs: 1500 }, 'host');
    raw.sendClip(bytes(1000), { v: 1, mime: 'image/png', durationMs: 1500 }, 'host');
    await vi.advanceTimersByTimeAsync(500);
    expect(heard.host).toHaveLength(0);
    // Rate limit: the second clip within a second is dropped, even if the client didn't check.
    raw.sendClip(bytes(1000), { v: 1, mime: 'audio/webm', durationMs: 1500 }, 'host');
    raw.sendClip(bytes(1000), { v: 1, mime: 'audio/webm', durationMs: 1500 }, 'host');
    await vi.advanceTimersByTimeAsync(500);
    expect(heard.host).toHaveLength(1);
    expect(heard.c2).toHaveLength(1);
  });

  it('a client refuses to send an invalid clip, or too soon after the last one', async () => {
    const { clients } = await table();
    expect(clients[0].voiceMessages()!.send(clip(VOICE_MAX_BYTES + 1))).toBe(false);
    expect(clients[0].voiceMessages()!.send(clip(1000, 100))).toBe(false); // accidental tap
    expect(clients[0].voiceMessages()!.send(clip())).toBe(true);
    expect(clients[0].voiceMessages()!.send(clip())).toBe(false); // too soon after the last one
  });

  it('a disconnected player is not sent clips, and nothing breaks', async () => {
    const { network, host, heard } = await table();
    network.disconnect('client-2');
    await vi.advanceTimersByTimeAsync(200);
    expect(host.voiceMessages()!.send(clip())).toBe(true);
    await until(() => heard.c1.length === 1, 2000);
    expect(heard.c2).toHaveLength(0);
  });

  it('connection stats are read locally (nothing is sent)', async () => {
    const { network, host, clients } = await table();
    let sentDuring = 0;
    network.tap = () => sentDuring++;
    const clientStats = await clients[0].voiceMessages()!.linkStats();
    const hostStats = await host.voiceMessages()!.linkStats();
    expect(clientStats?.rttMs).toBe(20); // the test network's 10 ms each way
    expect(hostStats?.rttMs).toBe(20);
    expect(sentDuring).toBe(0);
  });
});
