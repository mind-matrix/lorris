import { describe, expect, it } from 'vitest';
import { getLegalActions } from './legal';
import { applyAction } from './reducer';
import { legalCards, trickWinner } from './rules';
import { act, expectError, playingGame, playTrick } from './testUtils';
import type { Action, Card } from './types';

const cardsOf = (actions: Action[]) => actions.flatMap((a) => (a.type === 'PLAY_CARD' ? [a.card] : []));

describe('playing cards', () => {
  const hands: Card[][] = [
    ['AH', '7D', 'KC'],
    ['KH', 'JK', '8S'],
    ['9H', 'AD', '10C'],
    ['8D', 'AC', 'QS'],
  ];

  it('the leader may play anything', () => {
    const s = playingGame({ hands, trump: 'S' });
    expect(cardsOf(getLegalActions(s, 1))).toEqual(['KH', 'JK', '8S']);
  });

  it('only the player whose turn it is may play, and only cards they hold', () => {
    const s = playingGame({ hands, trump: 'S' });
    expectError(s, 2, { type: 'PLAY_CARD', card: '9H' }, 'NOT_YOUR_TURN');
    expectError(s, 1, { type: 'PLAY_CARD', card: 'AH' }, 'CARD_NOT_IN_HAND');
    expectError(s, 1, { type: 'PLAY_CARD', card: 'ZZ' as Card }, 'CARD_NOT_IN_HAND');
  });

  it('rule 2: you must follow the led suit if you can', () => {
    const s = act(playingGame({ hands, trump: 'S' }), 1, { type: 'PLAY_CARD', card: 'KH' });
    expect(cardsOf(getLegalActions(s, 2))).toEqual(['9H']);
    expectError(s, 2, { type: 'PLAY_CARD', card: 'AD' }, 'MUST_FOLLOW_SUIT');
  });

  it('rule 2 exception: the Joker may be played even when you hold the led suit', () => {
    const h: Card[][] = [['AH'], ['KH', 'JK'], [], []];
    const s = act(playingGame({ hands: h, trump: 'S', leader: 0 }), 0, { type: 'PLAY_CARD', card: 'AH' });
    expect(cardsOf(getLegalActions(s, 1))).toEqual(['KH', 'JK']);
    expect(act(s, 1, { type: 'PLAY_CARD', card: 'JK' }).trick.plays).toHaveLength(2);
  });

  it('rule 3: with no card of the led suit, anything (including trump) may be played', () => {
    const s = act(playingGame({ hands, trump: 'S' }), 1, { type: 'PLAY_CARD', card: 'KH' });
    const s2 = act(s, 2, { type: 'PLAY_CARD', card: '9H' });
    expect(cardsOf(getLegalActions(s2, 3))).toEqual(['8D', 'AC', 'QS']);
  });

  it('rule 4: when the Joker is led, others must play trump if they have it', () => {
    const s = act(playingGame({ hands, trump: 'D' }), 1, { type: 'PLAY_CARD', card: 'JK' });
    expect(cardsOf(getLegalActions(s, 2))).toEqual(['AD']);
    expectError(s, 2, { type: 'PLAY_CARD', card: '9H' }, 'MUST_PLAY_TRUMP');
  });

  it('rule 4: when the Joker is led and you have no trump, anything may be played', () => {
    const s = act(playingGame({ hands, trump: 'S' }), 1, { type: 'PLAY_CARD', card: 'JK' });
    expect(cardsOf(getLegalActions(s, 2))).toEqual(['9H', 'AD', '10C']);
  });

  it('legalCards and the reducer agree', () => {
    const s = act(playingGame({ hands, trump: 'S' }), 1, { type: 'PLAY_CARD', card: 'KH' });
    for (const card of s.hands[2]) {
      const legal = legalCards(s.hands[2], s.trick, 'S').includes(card);
      expect(applyAction(s, 2, { type: 'PLAY_CARD', card }).ok).toBe(legal);
    }
  });
});

describe('winning a round', () => {
  const t = (leader: number, cards: Card[]) => ({ leader, plays: cards.map((card, i) => ({ seat: (leader + i) % 4, card })) });

  it('highest card of the led suit wins when no trump is played', () => {
    expect(trickWinner(t(0, ['9H', 'AH', 'KH', '7H']), 'S')).toBe(1);
  });

  it('off-suit cards never win, even if higher', () => {
    expect(trickWinner(t(0, ['9H', 'AD', '7H', 'AC']), 'S')).toBe(0);
  });

  it('any trump beats any card of the led suit; highest trump wins', () => {
    expect(trickWinner(t(0, ['AH', '7S', 'KH', 'QH']), 'S')).toBe(1);
    expect(trickWinner(t(0, ['AH', '8S', '10S', 'QH']), 'S')).toBe(2);
  });

  it('the Joker beats everything, including trump', () => {
    expect(trickWinner(t(0, ['AS', 'KS', 'JK', 'QS']), 'S')).toBe(2);
    expect(trickWinner(t(3, ['JK', 'AS', 'KS', 'QS']), 'S')).toBe(3);
  });

  it('trump led: highest trump wins', () => {
    expect(trickWinner(t(0, ['8D', '9D', 'AH', 'QD']), 'D')).toBe(3);
  });

  it('rule 5: the winner takes the round and leads the next', () => {
    const hands: Card[][] = [['7H', 'AC'], ['AH', 'KC'], ['8H', 'QC'], ['9H', 'JC']];
    let s = playingGame({ hands, trump: 'S', leader: 0 });
    s = playTrick(s, ['7H', 'AH', '8H', '9H']);
    expect(s.completedTricks).toHaveLength(1);
    expect(s.completedTricks[0].winner).toBe(1);
    expect(s.tricksWon).toEqual([0, 1]);
    expect(s.turn).toBe(1);
    expect(s.trick).toEqual({ leader: 1, plays: [] });
    expect(s.log.at(-1)).toMatchObject({ type: 'TRICK_WON', seat: 1 });
  });

  it('6 players: tricks need all six cards and the winner leads', () => {
    const hands: Card[][] = [['3H'], ['4H'], ['5H'], ['AH'], ['6H'], ['3C']];
    let s = playingGame({ playerCount: 6, hands, trump: 'S', leader: 0, tricksPerSet: 2, contract: { seat: 1, value: 2 } });
    s = playTrick(s, ['3H', '4H', '5H', 'AH', '6H']);
    expect(s.completedTricks).toHaveLength(0);
    s = act(s, 5, { type: 'PLAY_CARD', card: '3C' });
    expect(s.completedTricks[0].winner).toBe(3);
    expect(s.tricksWon).toEqual([0, 1]);
    expect(s.turn).toBe(3);
  });
});
