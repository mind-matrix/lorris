import { describe, expect, it } from 'vitest';
import { forwardingPlan, parseHostMessage, parsePlayerMessage } from './voiceProtocol';

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const cand = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.2 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 };

describe('voice messages', () => {
  it('accepts well-formed messages each way', () => {
    expect(parseHostMessage({ v: 2, t: 'offer', sdp: SDP, mic: '0', slots: { '1': 0, '2': 2 } })).toMatchObject({ t: 'offer', slots: { '1': 0, '2': 2 } });
    expect(parseHostMessage({ v: 2, t: 'ice', candidate: cand })).toMatchObject({ t: 'ice' });
    expect(parseHostMessage({ v: 2, t: 'ice', candidate: null })).toEqual({ v: 2, t: 'ice', candidate: null });
    expect(parseHostMessage({ v: 2, t: 'talk', seat: 3, on: true })).toEqual({ v: 2, t: 'talk', seat: 3, on: true });
    expect(parsePlayerMessage({ v: 2, t: 'answer', sdp: SDP })).toMatchObject({ t: 'answer' });
    expect(parsePlayerMessage({ v: 2, t: 'talk', on: false })).toEqual({ v: 2, t: 'talk', on: false });
  });

  it('refuses anything malformed, oversized, or from another version', () => {
    for (const bad of [
      null,
      'x',
      { v: 1, t: 'talk', seat: 1, on: true },
      { v: 2, t: 'talk', seat: 9, on: true },
      { v: 2, t: 'talk', seat: 1, on: 'yes' },
      { v: 2, t: 'offer', sdp: 'not sdp', mic: '0', slots: {} },
      { v: 2, t: 'offer', sdp: SDP + 'x'.repeat(40_000), mic: '0', slots: {} },
      { v: 2, t: 'offer', sdp: SDP, mic: '0', slots: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 0 } },
      { v: 2, t: 'offer', sdp: SDP, mic: '0', slots: { '1': 7 } },
      { v: 2, t: 'ice', candidate: { ...cand, candidate: 'x'.repeat(2000) } },
      { v: 2, t: 'ice', candidate: { ...cand, sdpMLineIndex: -1 } },
      { v: 2, t: 'nope' },
    ]) {
      expect(parseHostMessage(bad)).toBeNull();
    }
    expect(parsePlayerMessage({ v: 2, t: 'talk', seat: 0, on: true })).toEqual({ v: 2, t: 'talk', on: true }); // seat claims ignored
    expect(parsePlayerMessage({ v: 2, t: 'offer', sdp: SDP })).toBeNull(); // players never send offers
  });
});

describe('forwarding plan', () => {
  const listeners = new Map([
    ['p1', 1],
    ['p2', 2],
    ['p3', 3],
  ] as const);

  it('nobody talking: every slot is paused (no packets anywhere)', () => {
    const plan = forwardingPlan(listeners, new Set(), new Map([[0, 'host-mic']]), 4);
    for (const slots of plan.values()) for (const v of slots.values()) expect(v).toBeNull();
  });

  it("a talker's voice goes to everyone else, never back to them", () => {
    const sources = new Map<number, string>([[1, 'from-p1']]);
    const plan = forwardingPlan(listeners, new Set([1]), sources, 4);
    expect(plan.get('p2')!.get(1)).toBe('from-p1');
    expect(plan.get('p3')!.get(1)).toBe('from-p1');
    expect(plan.get('p1')!.has(1)).toBe(false); // no slot for your own seat
    expect([...plan.get('p2')!.entries()].filter(([, v]) => v !== null)).toHaveLength(1);
  });

  it('two people talking at once: both are heard by the others', () => {
    const sources = new Map<number, string>([
      [0, 'host-mic'],
      [2, 'from-p2'],
    ]);
    const plan = forwardingPlan(listeners, new Set([0, 2]), sources, 4);
    expect(plan.get('p1')!.get(0)).toBe('host-mic');
    expect(plan.get('p1')!.get(2)).toBe('from-p2');
    expect(plan.get('p2')!.get(0)).toBe('host-mic');
    expect(plan.get('p2')!.has(2)).toBe(false);
  });

  it("talking before the talker's audio has arrived: the slot stays paused", () => {
    const plan = forwardingPlan(listeners, new Set([3]), new Map(), 4);
    expect(plan.get('p1')!.get(3)).toBeNull();
  });

  it('six players: five slots each', () => {
    const six = new Map([['a', 1], ['b', 5]] as const);
    const plan = forwardingPlan(six, new Set(), new Map(), 6);
    expect([...plan.get('a')!.keys()]).toEqual([0, 2, 3, 4, 5]);
    expect([...plan.get('b')!.keys()]).toEqual([0, 1, 2, 3, 4]);
  });
});
