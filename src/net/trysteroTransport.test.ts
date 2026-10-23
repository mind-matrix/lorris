import { afterEach, describe, expect, it, vi } from 'vitest';

const joinRoom = vi.fn(() => ({
  makeAction: () => ({ send: vi.fn(async () => {}), onMessage: null }),
  leave: vi.fn(async () => {}),
  onPeerJoin: null,
  onPeerLeave: null,
}));
vi.mock('trystero', () => ({ joinRoom, selfId: 'me' }));

let release: (servers: unknown[]) => void = () => {};
vi.mock('./iceServers', () => ({
  getIceServers: () => new Promise((r) => (release = r)),
  invalidateIceServers: vi.fn(),
}));

const { TrysteroTransport } = await import('./trysteroTransport');

afterEach(() => joinRoom.mockClear());

describe('TrysteroTransport and ICE servers', () => {
  it('joins with the fetched ICE servers', async () => {
    const t = new TrysteroTransport();
    const connecting = t.connect('ROOM', 'pw');
    expect(joinRoom).not.toHaveBeenCalled(); // waits for the list first
    release([{ urls: ['stun:s'] }, { urls: 'turn:r:3478', username: 'u', credential: 'c' }]);
    await connecting;
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect((joinRoom.mock.calls[0] as unknown as [{ rtcConfig: unknown }])[0].rtcConfig).toEqual({
      iceServers: [{ urls: ['stun:s'] }, { urls: 'turn:r:3478', username: 'u', credential: 'c' }],
    });
  });

  it('disconnecting while still waiting for the list means it never joins', async () => {
    const t = new TrysteroTransport();
    const connecting = t.connect('ROOM', 'pw');
    t.disconnect();
    release([{ urls: ['stun:s'] }]);
    await connecting;
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it('a newer connect() wins over an older one still waiting', async () => {
    const t = new TrysteroTransport();
    const first = t.connect('OLD', 'pw');
    const releaseFirst = release;
    const second = t.connect('NEW', 'pw');
    releaseFirst([]);
    release([]);
    await Promise.all([first, second]);
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect((joinRoom.mock.calls[0] as unknown as [unknown, string])[1]).toBe('NEW');
  });
});
