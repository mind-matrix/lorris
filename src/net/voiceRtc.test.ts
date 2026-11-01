// The voice connection logic with a stand-in for the browser's RTCPeerConnection. The real
// audio path (forwarding, zero packets while idle, bitrates) was verified in Chromium with live
// WebRTC connections; these tests cover the decisions and the rules around them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceAccess } from '../session/types';
import { MAX_TALK_MS } from './voiceProtocol';
import { VoiceGuest, VoiceHost, type VoiceRtcDeps } from './voiceRtc';

// Node has no MediaStream; the host only needs to construct one for each forwarding slot.
(globalThis as { MediaStream?: unknown }).MediaStream ??= class {};

class FakeSender {
  track: unknown = null;
  async replaceTrack(t: unknown) {
    this.track = t;
  }
  getParameters() {
    return { encodings: [{}] } as unknown as RTCRtpSendParameters;
  }
  async setParameters() {}
}
class FakeTransceiver {
  mid: string | null = null;
  sender = new FakeSender();
  constructor(public direction: string) {}
}
class FakePC {
  static all: FakePC[] = [];
  transceivers: FakeTransceiver[] = [];
  localSdp: string | null = null;
  remoteSdp: string | null = null;
  closed = false;
  connectionState = 'new';
  onicecandidate: ((e: unknown) => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  candidates: unknown[] = [];
  constructor() {
    FakePC.all.push(this);
  }
  addTransceiver(_kind: string, init: { direction: string }) {
    const t = new FakeTransceiver(init.direction);
    this.transceivers.push(t);
    return t;
  }
  getTransceivers() {
    return this.transceivers;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0\r\no=offer\r\n' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0\r\no=answer\r\n' };
  }
  async setLocalDescription(d: { sdp: string }) {
    this.localSdp = d.sdp;
    this.transceivers.forEach((t, i) => (t.mid ??= String(i)));
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteSdp = d.sdp;
    // An offer from the host: create matching transceivers on the player's side.
    if (d.type === 'offer' && this.transceivers.length === 0) {
      for (let i = 0; i < 4; i++) {
        const t = new FakeTransceiver('recvonly');
        t.mid = String(i);
        this.transceivers.push(t);
      }
    }
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  close() {
    this.closed = true;
  }
  /** Simulates the remote side's audio arriving on a transceiver. */
  receive(t: FakeTransceiver, track: unknown) {
    this.ontrack?.({ transceiver: t, track });
  }
}

type Handler = (from: string, m: unknown) => void;
function network() {
  const handlers = new Map<string, Handler[]>();
  const leaves = new Map<string, ((p: string) => void)[]>();
  const link = (self: string) => ({
    send(m: unknown, to: string | string[]) {
      for (const peer of Array.isArray(to) ? to : [to]) queueMicrotask(() => handlers.get(peer)?.forEach((h) => h(self, structuredClone(m))));
    },
    onMessage(h: Handler) {
      handlers.set(self, [...(handlers.get(self) ?? []), h]);
      return () => {};
    },
    linkStats: async () => null,
  });
  const onPeerLeave = (self: string) => (h: (p: string) => void) => {
    leaves.set(self, [...(leaves.get(self) ?? []), h]);
    return () => {};
  };
  return { link, onPeerLeave, leave: (who: string) => leaves.forEach((hs) => hs.forEach((h) => h(who))), raw: (from: string, to: string, m: unknown) => handlers.get(to)?.forEach((h) => h(from, m)) };
}

function deps(access: VoiceAccess, played: unknown[] = []): VoiceRtcDeps {
  return {
    access,
    createPeer: () => new FakePC() as unknown as RTCPeerConnection,
    iceServers: async () => [],
    getMic: async () => ({ getAudioTracks: () => [{ readyState: 'live', stop() {} }], getTracks: () => [] }) as unknown as MediaStream,
    play: (seat, track) => (played.push([seat, track]), () => {}),
    keepFlowing: () => () => {},
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function table() {
  const net = network();
  const seated = new Map([
    ['A', 1],
    ['B', 2],
  ] as [string, 1 | 2][]);
  const host = new VoiceHost(deps({ link: net.link('H'), isHost: true, playerCount: 4, mySeat: () => 0, seatedPeers: () => seated, hostPeer: () => null, onPeerLeave: net.onPeerLeave('H') }));
  const guest = (id: string, seat: number) =>
    new VoiceGuest(deps({ link: net.link(id), isHost: false, playerCount: 4, mySeat: () => seat as 1, seatedPeers: () => new Map(), hostPeer: () => 'H', onPeerLeave: net.onPeerLeave(id) }));
  return { net, host, A: guest('A', 1), B: guest('B', 2), seated };
}

describe('voice connections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakePC.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it('the first talk sets up one connection per seated player, each with a mic slot and a slot per other seat', async () => {
    const { host, A } = table();
    expect(FakePC.all).toHaveLength(0); // nothing is set up until someone talks
    await A.startTalking();
    await settle();
    const hostSide = FakePC.all.filter((pc) => pc.transceivers[0]?.direction === 'recvonly' && pc.transceivers.length === 4);
    expect(hostSide).toHaveLength(2); // to A and to B
    for (const pc of hostSide) expect(pc.transceivers.slice(1).every((t) => t.direction === 'sendonly')).toBe(true);
    expect(host.state().talking.has(1)).toBe(true);
  });

  it('the player answers with the low-data settings and sends their mic only while talking', async () => {
    const { A } = table();
    await A.startTalking();
    await settle();
    const guestPc = FakePC.all.find((pc) => pc.remoteSdp?.includes('o=offer'))!;
    const mic = guestPc.transceivers.find((t) => t.direction === 'sendonly')!;
    expect(mic.sender.track).not.toBeNull();
    A.stopTalking();
    await settle();
    expect(mic.sender.track).toBeNull(); // detached: no packets
  });

  it("forwards a talker's audio to the other players only while they talk", async () => {
    const { A } = table();
    await A.startTalking();
    await settle();
    const [toA, toB] = FakePC.all.slice(0, 2);
    const voiceA = { id: 'voice-of-A' };
    toA.receive(toA.transceivers[0], voiceA); // A's audio reaches the host
    await settle();
    // B's slot for seat 1 carries A's voice; nobody gets their own.
    expect(toB.transceivers.slice(1).map((t) => t.sender.track)).toContain(voiceA);
    expect(toA.transceivers.slice(1).map((t) => t.sender.track)).not.toContain(voiceA);
    A.stopTalking();
    await settle();
    expect(toB.transceivers.slice(1).every((t) => t.sender.track === null)).toBe(true);
  });

  it('only seated players can talk; anyone else is ignored', async () => {
    const { net, host } = table();
    net.raw('X', 'H', { v: 2, t: 'talk', on: true });
    await settle();
    expect(host.state().talking.size).toBe(0);
    expect(FakePC.all).toHaveLength(0);
  });

  it('players accept voice messages only from the host', async () => {
    const { net, B } = table();
    net.raw('A', 'B', { v: 2, t: 'talk', seat: 0, on: true });
    net.raw('A', 'B', { v: 2, t: 'offer', sdp: 'v=0\r\n', mic: '0', slots: { '1': 0 } });
    await settle();
    expect(B.state().talking.size).toBe(0);
    expect(FakePC.all).toHaveLength(0);
  });

  it('everyone learns who is talking', async () => {
    const { A, B } = table();
    await A.startTalking();
    await settle();
    expect(B.state().talking.has(1)).toBe(true);
    expect(A.state().selfTalking).toBe(true);
    A.stopTalking();
    await settle();
    expect(B.state().talking.size).toBe(0);
  });

  it('the host stops forwarding after 2 minutes, and the player is told to stop', async () => {
    const { host, A } = table();
    let forced = false;
    A.onForcedStop = () => (forced = true);
    await A.startTalking();
    await settle();
    await vi.advanceTimersByTimeAsync(MAX_TALK_MS + 10);
    await settle();
    expect(host.state().talking.has(1)).toBe(false);
    expect(forced).toBe(true);
    expect(A.state().selfTalking).toBe(false);
  });

  it('a player leaving closes their connection and they stop counting as talking', async () => {
    const { net, host, A, seated } = table();
    await A.startTalking();
    await settle();
    const toA = FakePC.all[0];
    seated.delete('A');
    net.leave('A');
    await settle();
    expect(toA.closed).toBe(true);
    expect(host.state().talking.has(1)).toBe(false);
  });

  it('the host talking reaches everyone without any player talking first', async () => {
    const { host, B } = table();
    await host.startTalking();
    await settle();
    expect(B.state().talking.has(0)).toBe(true);
    const toB = FakePC.all[1];
    expect(toB.transceivers.slice(1).some((t) => t.sender.track !== null)).toBe(true);
    host.stopTalking();
    await settle();
    expect(toB.transceivers.slice(1).every((t) => t.sender.track === null)).toBe(true);
  });
});
