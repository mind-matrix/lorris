import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  formatRoomCode,
  generateRoomCode,
  inviteLink,
  normalizeRoomCode,
  roomCodeFromHash,
} from './roomCode';

describe('room codes', () => {
  it('uses no confusable characters', () => {
    for (const ch of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it('generates valid 6-character codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it('is unbiased enough to spread over the alphabet', () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateRoomCode()).join(''));
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('normalizes typed input', () => {
    expect(normalizeRoomCode(' abc-def ')).toBe('ABCDEF');
    expect(normalizeRoomCode('ab cd ef')).toBe('ABCDEF');
    expect(normalizeRoomCode('ABCDE')).toBeNull();
    expect(normalizeRoomCode('ABCDE0')).toBeNull();
    expect(normalizeRoomCode('ABCDEO')).toBeNull();
  });

  it('formats for display', () => {
    expect(formatRoomCode('ABCDEF')).toBe('ABC-DEF');
  });

  it('builds and reads invite links', () => {
    const link = inviteLink('ABCDEF', 'https://mind-matrix.github.io/lorris/#something');
    expect(link).toBe('https://mind-matrix.github.io/lorris/#join=ABCDEF');
    expect(roomCodeFromHash(new URL(link).hash)).toBe('ABCDEF');
    expect(roomCodeFromHash('#join=abc-def')).toBe('ABCDEF');
    expect(roomCodeFromHash('#join=nope')).toBeNull();
    expect(roomCodeFromHash('')).toBeNull();
  });
});
