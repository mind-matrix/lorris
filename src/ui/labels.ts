import { isJoker, rankOf, suitOf, teamOf, type Card, type Seat, type Suit, type Team } from '../core';

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const isRed = (suit: Suit) => suit === 'H' || suit === 'D';

export const TEAM_NAME: Record<Team, string> = { 0: 'Team A', 1: 'Team B' };
export const teamName = (seat: Seat) => TEAM_NAME[teamOf(seat)];

export function cardLabel(card: Card): string {
  if (isJoker(card)) return 'Joker';
  const rank = card.slice(0, -1);
  const names: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
  return `${names[rank] ?? rank} of ${SUIT_NAME[suitOf(card)!]}`;
}

/** Hand order: Joker first, then trump, then the other suits alternating colours; high to low. */
export function sortHand(cards: Card[], trump: Suit | null): Card[] {
  const base: Suit[] = ['S', 'H', 'C', 'D'];
  const order = trump ? [trump, ...base.filter((s) => s !== trump)] : base;
  const key = (c: Card) => (isJoker(c) ? -1 : order.indexOf(suitOf(c)!) * 100 - rankOf(c));
  return cards.slice().sort((a, b) => key(a) - key(b));
}
