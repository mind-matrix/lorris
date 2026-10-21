import { JOKER, RANK_LABELS, SUITS, type Card, type GameConfig, type RankLabel, type Suit } from './types';

export function isJoker(card: Card): boolean {
  return card === JOKER;
}

/** Suit of a card, or null for the Joker. */
export function suitOf(card: Card): Suit | null {
  return isJoker(card) ? null : (card.slice(-1) as Suit);
}

/** Numeric rank 2..14 (A = 14). The Joker has no rank and returns 0. */
export function rankOf(card: Card): number {
  if (isJoker(card)) return 0;
  return RANK_LABELS.indexOf(card.slice(0, -1) as RankLabel) + 2;
}

export function makeCard(rank: number, suit: Suit): Card {
  return `${RANK_LABELS[rank - 2]}${suit}` as Card;
}

/**
 * Builds the deck for a config: the highest ranks of every suit, with the lowest
 * Spade replaced by the Joker (7S for 4 players, 3S for 6 players).
 */
export function buildDeck(config: GameConfig): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = config.lowestRank; rank <= 14; rank++) {
      if (suit === 'S' && rank === config.lowestRank) continue;
      deck.push(makeCard(rank, suit));
    }
  }
  deck.push(JOKER);
  return deck;
}

/** All cards of a suit that exist in this config's deck, highest first. */
export function cardsOfSuit(config: GameConfig, suit: Suit): Card[] {
  const cards: Card[] = [];
  for (let rank = 14; rank >= config.lowestRank; rank--) {
    if (suit === 'S' && rank === config.lowestRank) continue;
    cards.push(makeCard(rank, suit));
  }
  return cards;
}
