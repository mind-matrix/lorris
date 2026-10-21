import { isJoker, rankOf, suitOf, cardsOfSuit } from './cards';
import { teamOf } from './config';
import type { Card, GameConfig, Seat, Suit, Team, Trick } from './types';

/**
 * The suit everyone must follow in this trick, or 'TRUMP' when the Joker was led
 * (rule 4: then everyone must play trump if they can). Null if nothing has been led.
 */
export function leadRequirement(trick: Trick, trump: Suit): Suit | null {
  if (trick.plays.length === 0) return null;
  const led = trick.plays[0].card;
  return isJoker(led) ? trump : suitOf(led);
}

/**
 * Cards a player may play into the current trick.
 * - Leading: anything.
 * - Otherwise, follow the required suit if possible (the Joker may always be played).
 * - If you cannot follow, play anything.
 */
export function legalCards(hand: Card[], trick: Trick, trump: Suit): Card[] {
  const required = leadRequirement(trick, trump);
  if (required === null) return hand.slice();
  const following = hand.filter((c) => suitOf(c) === required);
  if (following.length === 0) return hand.slice();
  return hand.filter((c) => isJoker(c) || suitOf(c) === required);
}

/**
 * Winner of a complete (or partial) trick: the Joker beats everything, then the
 * highest trump, then the highest card of the led suit. Off-suit cards never win.
 */
export function trickWinner(trick: Trick, trump: Suit): Seat {
  const required = leadRequirement(trick, trump);
  let best = trick.plays[0];
  for (const play of trick.plays.slice(1)) {
    if (beats(play.card, best.card, trump, required)) best = play;
  }
  return best.seat;
}

/** Does `card` beat the currently winning `best` card? */
export function beats(card: Card, best: Card, trump: Suit, required: Suit | null): boolean {
  if (isJoker(best)) return false;
  if (isJoker(card)) return true;
  const cardSuit = suitOf(card);
  const bestSuit = suitOf(best);
  if (cardSuit === trump && bestSuit !== trump) return true;
  if (cardSuit !== bestSuit) return false;
  // Same suit: only matters if it's trump or the required suit (best is always one of those).
  if (cardSuit !== trump && cardSuit !== required) return false;
  return rankOf(card) > rankOf(best);
}

/**
 * Rule 6: if one team holds every trump card AND the Joker, the set is cancelled
 * and re-dealt. Returns that team, or null.
 */
export function misdealTeam(config: GameConfig, hands: Card[][], trump: Suit): Team | null {
  const needed = [...cardsOfSuit(config, trump), 'JK' as Card];
  for (const team of [0, 1] as Team[]) {
    const teamCards = new Set(hands.filter((_, seat) => teamOf(seat) === team).flat());
    if (needed.every((c) => teamCards.has(c))) return team;
  }
  return null;
}

/**
 * Whether the set's outcome is decided. Returns the team that came out ahead
 * (the callers once they've made their call, the other team once the callers
 * can no longer make it), or null if still open. The set ends at that point.
 */
export function decidedWinner(
  config: GameConfig,
  bidSeat: Seat,
  callValue: number,
  tricksWon: [number, number],
  tricksPlayed: number,
): Team | null {
  const bidTeam = teamOf(bidSeat);
  const remaining = config.tricksPerSet - tricksPlayed;
  if (tricksWon[bidTeam] >= callValue) return bidTeam;
  if (tricksWon[bidTeam] + remaining < callValue) return (1 - bidTeam) as Team;
  return null;
}
