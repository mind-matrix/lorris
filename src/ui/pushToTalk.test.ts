import { describe, expect, it } from 'vitest';
import { HOLD_MS, PushToTalk } from './pushToTalk';

function setup() {
  let t = 0;
  const log: string[] = [];
  const ptt = new PushToTalk({ start: (latched) => log.push(latched ? 'start(tap)' : 'start'), stop: () => log.push('stop'), abort: () => log.push('abort') }, () => t);
  return { ptt, log, wait: (ms: number) => (t += ms) };
}

describe('mic button gestures', () => {
  it('press and hold: records from the moment of pressing, sends on release', () => {
    const { ptt, log, wait } = setup();
    ptt.down();
    expect(log).toEqual(['start']);
    wait(HOLD_MS + 500);
    ptt.up();
    expect(log).toEqual(['start', 'stop']);
  });

  it('tap: keeps recording after release; the next tap sends', () => {
    const { ptt, log, wait } = setup();
    ptt.down();
    wait(120);
    ptt.up();
    expect(log).toEqual(['start', 'start(tap)']);
    wait(5000);
    ptt.down(); // stops straight away
    expect(log).toEqual(['start', 'start(tap)', 'stop']);
    wait(80);
    ptt.up(); // nothing more
    expect(log).toEqual(['start', 'start(tap)', 'stop']);
  });

  it('after a tap stops, the button works again for holding', () => {
    const { ptt, log, wait } = setup();
    ptt.down(); wait(100); ptt.up(); // tap on
    ptt.down(); wait(100); ptt.up(); // tap off
    log.length = 0;
    ptt.down(); wait(HOLD_MS); ptt.up(); // hold
    expect(log).toEqual(['start', 'stop']);
  });

  it('an interrupted press (pointer cancelled, app hidden) throws the recording away', () => {
    const { ptt, log } = setup();
    ptt.down();
    ptt.cancel();
    expect(log).toEqual(['start', 'abort']);
    ptt.up(); // stray release after cancel: ignored
    expect(log).toEqual(['start', 'abort']);
  });

  it('cancel while tapped on also throws it away', () => {
    const { ptt, log, wait } = setup();
    ptt.down(); wait(50); ptt.up();
    ptt.cancel();
    expect(log.at(-1)).toBe('abort');
  });

  it('cancel when nothing is happening does nothing', () => {
    const { ptt, log } = setup();
    ptt.cancel();
    expect(log).toEqual([]);
  });

  it('reset after recording ended elsewhere: the next tap starts again', () => {
    const { ptt, log, wait } = setup();
    ptt.down(); wait(50); ptt.up(); // tapped on
    ptt.reset(); // e.g. it hit the length limit
    log.length = 0;
    ptt.down();
    expect(log).toEqual(['start']);
  });

  it('a stray release or a second press while held does nothing extra', () => {
    const { ptt, log } = setup();
    ptt.up();
    expect(log).toEqual([]);
    ptt.down();
    ptt.down();
    expect(log).toEqual(['start']);
  });
});
