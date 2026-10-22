import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryNetwork } from './inMemoryTransport';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('in-memory transport', () => {
  it('peers in the same room with the same password see each other and exchange messages', async () => {
    const net = new InMemoryNetwork({ latencyMs: 20 });
    const a = net.createTransport('a');
    const b = net.createTransport('b');
    const joined: string[] = [];
    const got: unknown[] = [];
    a.onPeerJoin((p) => joined.push(`a saw ${p}`));
    b.onPeerJoin((p) => joined.push(`b saw ${p}`));
    b.onMessage((from, m) => got.push({ from, m }));
    await a.connect('ROOM', 'pw');
    await b.connect('ROOM', 'pw');
    await vi.advanceTimersByTimeAsync(20);
    expect(joined.sort()).toEqual(['a saw b', 'b saw a']);
    a.send('b', { hello: 1 });
    await vi.advanceTimersByTimeAsync(19);
    expect(got).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual([{ from: 'a', m: { hello: 1 } }]);
  });

  it('a wrong password means no connection and an error', async () => {
    const net = new InMemoryNetwork();
    const a = net.createTransport('a');
    const b = net.createTransport('b');
    const errors: string[] = [];
    b.onError((e) => errors.push(e.kind));
    let joins = 0;
    b.onPeerJoin(() => joins++);
    await a.connect('ROOM', 'pw');
    await b.connect('ROOM', 'other');
    await vi.advanceTimersByTimeAsync(50);
    expect(joins).toBe(0);
    expect(errors).toEqual(['peer-connection-failed']);
  });

  it('messages are JSON copies, delivered in order even with varying latency', async () => {
    let lat = 100;
    const net = new InMemoryNetwork({ latencyMs: () => (lat -= 30) });
    const a = net.createTransport('a');
    const b = net.createTransport('b');
    const got: unknown[] = [];
    b.onMessage((_, m) => got.push(m));
    await a.connect('R', 'p');
    await b.connect('R', 'p');
    await vi.advanceTimersByTimeAsync(200);
    const payload = { n: 1, nested: { x: [1] } };
    a.send('b', payload);
    a.send('b', { n: 2 });
    payload.nested.x.push(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(got).toEqual([{ n: 1, nested: { x: [1] } }, { n: 2 }]);
  });

  it('can drop messages, stall a peer, and disconnect it', async () => {
    const net = new InMemoryNetwork({ latencyMs: 1, dropRate: 0.5, seed: 7 });
    const a = net.createTransport('a');
    const b = net.createTransport('b');
    const got: number[] = [];
    b.onMessage((_, m) => got.push(m as number));
    const left: string[] = [];
    a.onPeerLeave((p) => left.push(`a lost ${p}`));
    b.onPeerLeave((p) => left.push(`b lost ${p}`));
    await a.connect('R', 'p');
    await b.connect('R', 'p');
    await vi.advanceTimersByTimeAsync(5);
    for (let i = 0; i < 100; i++) a.send('b', i);
    await vi.advanceTimersByTimeAsync(5);
    expect(got.length).toBeGreaterThan(30);
    expect(got.length).toBeLessThan(70);

    net.dropRate = 0;
    got.length = 0;
    net.setStalled('b', true);
    a.send('b', 1);
    await vi.advanceTimersByTimeAsync(5);
    expect(got).toEqual([]);
    net.setStalled('b', false);
    a.send('b', 2);
    await vi.advanceTimersByTimeAsync(5);
    expect(got).toEqual([2]);

    net.disconnect('b');
    expect(left.sort()).toEqual(['a lost b', 'b lost a']);
    a.send('b', 3);
    await vi.advanceTimersByTimeAsync(5);
    expect(got).toEqual([2]);

    // b can come back.
    await b.connect('R', 'p');
    await vi.advanceTimersByTimeAsync(5);
    a.send('b', 4);
    await vi.advanceTimersByTimeAsync(5);
    expect(got).toEqual([2, 4]);
  });

  it('broadcast reaches every connected peer but not the sender', async () => {
    const net = new InMemoryNetwork({ latencyMs: 1 });
    const [a, b, c] = ['a', 'b', 'c'].map((id) => net.createTransport(id));
    const got: string[] = [];
    for (const t of [a, b, c]) t.onMessage((from) => got.push(`${t.selfId}<-${from}`));
    for (const t of [a, b, c]) await t.connect('R', 'p');
    await vi.advanceTimersByTimeAsync(5);
    a.broadcast('hi');
    await vi.advanceTimersByTimeAsync(5);
    expect(got.sort()).toEqual(['b<-a', 'c<-a']);
  });
});
