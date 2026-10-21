// What a player can work out from their own view: which cards are gone and which are still unseen.
import { buildDeck, isJoker, rankOf, suitOf, type Card, type PlayerView, type Suit } from '../core';

export function playedCards(view: PlayerView): Set<Card> {
  const played = new Set<Card>();
  for (const t of view.completedTricks) for (const p of t.plays) played.add(p.card);
  for (const p of view.trick.plays) played.add(p.card);
  return played;
}

/** Cards that could be in someone else's hand. */
export function unseenCards(view: PlayerView): Card[] {
  const played = playedCards(view);
  const mine = new Set(view.myHand);
  return buildDeck(view.config).filter((c) => !played.has(c) && !mine.has(c));
}

/** True if no unseen card of the same suit outranks this card (ignores trumps and the Joker). */
export function isTopOfSuit(card: Card, unseen: Card[]): boolean {
  if (isJoker(card)) return true;
  const suit = suitOf(card);
  return !unseen.some((c) => suitOf(c) === suit && rankOf(c) > rankOf(card));
}

export function countSuit(cards: Card[], suit: Suit): number {
  return cards.filter((c) => suitOf(c) === suit).length;
}
