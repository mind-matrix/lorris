import {
  SUITS,
  beats,
  highestBid,
  isJoker,
  leadRequirement,
  rankOf,
  suitOf,
  teamOf,
  trickWinner,
  type Action,
  type Card,
  type PlayerView,
  type Suit,
} from '../core';
import type { Bot } from './bot';
import { countSuit, isTopOfSuit, unseenCards } from './knowledge';

/**
 * A simple rule-of-thumb player:
 * - Calls based on an estimate of the rounds its hand can win (plus a little for teammates).
 * - Picks the trump suit that maximizes that estimate.
 * - Wins rounds as cheaply as possible, doesn't waste cards when a teammate is winning,
 *   and throws its least useful card when it can't win.
 */
export class HeuristicBot implements Bot {
  readonly name = 'Heuristic';

  async chooseAction(view: PlayerView, legal: Action[]): Promise<Action> {
    if (legal.length === 1) return legal[0];

    switch (view.phase) {
      case 'bidding':
        return chooseBid(view, legal);
      case 'choosingTrump':
        return { type: 'CHOOSE_TRUMP', suit: bestTrump(view.myHand, view.config.playerCount).suit };
      case 'playing':
        return { type: 'PLAY_CARD', card: chooseCard(view, legal) };
      default:
        return legal[0];
    }
  }
}

// ---------- Bidding ----------

/** Rough number of rounds this hand wins with `trump` as the trump suit. */
export function estimateTricks(hand: Card[], trump: Suit, playerCount: number): number {
  // With more players, side-suit winners are more likely to be trumped.
  const sideAceValue = playerCount >= 6 ? 0.55 : 0.8;
  let tricks = hand.includes('JK') ? 1 : 0;

  const trumps = hand.filter((c) => suitOf(c) === trump).map(rankOf).sort((a, b) => b - a);
  const honour: Record<number, number> = { 14: 1, 13: 0.75, 12: 0.5, 11: 0.3 };
  trumps.forEach((rank, i) => {
    // An honour only counts if there are enough small trumps to protect it.
    if (i < 4 && trumps.length > i) tricks += honour[rank] ?? 0;
  });
  if (trumps.length > 2) tricks += 0.5 * (trumps.length - 2); // long trumps win by trumping

  for (const suit of SUITS) {
    if (suit === trump) continue;
    const ranks = hand.filter((c) => suitOf(c) === suit).map(rankOf);
    if (ranks.includes(14)) tricks += sideAceValue;
    if (ranks.includes(13) && ranks.length >= 2) tricks += 0.3;
    if (ranks.length === 0 && trumps.length >= 3) tricks += 0.3; // void: can trump this suit
  }
  return tricks;
}

export function bestTrump(hand: Card[], playerCount: number): { suit: Suit; tricks: number } {
  let best = { suit: SUITS[0] as Suit, tricks: -1 };
  for (const suit of SUITS) {
    const tricks = estimateTricks(hand, suit, playerCount);
    if (tricks > best.tricks) best = { suit, tricks };
  }
  return best;
}

function chooseBid(view: PlayerView, legal: Action[]): Action {
  const { config } = view;
  const teammates = config.playerCount / 2 - 1;
  // Teammates are unknown; assume each wins about one round on average.
  const estimate = bestTrump(view.myHand, config.playerCount).tricks + teammates * 1.0;
  const current = highestBid(view);
  const currentBid = view.bids.find((b) => b.bid === current);
  const teammateHolds = currentBid !== undefined && teamOf(currentBid.seat) === teamOf(view.seat);

  const target = Math.max(config.minBid, current + 1);
  // Don't overcall a teammate unless we're clearly stronger than their call.
  const margin = teammateHolds ? 1.5 : 0;
  if (target <= config.maxBid && Math.floor(estimate - margin) >= target) {
    return legal.find((a) => a.type === 'BID' && a.value === target) ?? { type: 'PASS' };
  }
  return { type: 'PASS' };
}

// ---------- Card play ----------

/** Lower = less valuable to keep. Trumps and especially the Joker are kept for later. */
function keepValue(card: Card, trump: Suit): number {
  if (isJoker(card)) return 100;
  return (suitOf(card) === trump ? 50 : 0) + rankOf(card);
}

const cheapest = (cards: Card[], trump: Suit) => cards.reduce((a, b) => (keepValue(b, trump) < keepValue(a, trump) ? b : a));

function chooseCard(view: PlayerView, legal: Action[]): Card {
  const cards = legal.flatMap((a) => (a.type === 'PLAY_CARD' ? [a.card] : []));
  const trump = view.trump!;
  const unseen = unseenCards(view);
  return view.trick.plays.length === 0 ? chooseLead(view, cards, trump, unseen) : chooseFollow(view, cards, trump, unseen);
}

function chooseLead(view: PlayerView, cards: Card[], trump: Suit, unseen: Card[]): Card {
  const onCallingTeam = view.contract !== null && teamOf(view.contract.seat) === teamOf(view.seat);
  const opponentsMayHaveTrump = unseen.some((c) => suitOf(c) === trump);
  const myTrumps = cards.filter((c) => suitOf(c) === trump);

  // The calling team leads the Joker to pull out the opponents' trumps.
  if (onCallingTeam && cards.includes('JK') && opponentsMayHaveTrump && myTrumps.length >= 1) return 'JK';

  // Lead a top trump to draw trumps if we're the calling team.
  const topTrump = myTrumps.find((c) => isTopOfSuit(c, unseen));
  if (onCallingTeam && topTrump && opponentsMayHaveTrump) return topTrump;

  // Lead a side-suit winner.
  const sideWinners = cards.filter((c) => !isJoker(c) && suitOf(c) !== trump && isTopOfSuit(c, unseen));
  if (sideWinners.length > 0) return sideWinners.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));

  // Otherwise lead low from the longest side suit, keeping trumps.
  const side = cards.filter((c) => !isJoker(c) && suitOf(c) !== trump);
  if (side.length > 0) {
    const longest = SUITS.filter((s) => s !== trump).reduce((a, b) => (countSuit(side, b) > countSuit(side, a) ? b : a));
    return cheapest(side.filter((c) => suitOf(c) === longest), trump);
  }
  return cheapest(cards, trump);
}

function chooseFollow(view: PlayerView, cards: Card[], trump: Suit, unseen: Card[]): Card {
  const { trick, config } = view;
  const required = leadRequirement(trick, trump);
  const winnerSeat = trickWinner(trick, trump);
  const winningCard = trick.plays.find((p) => p.seat === winnerSeat)!.card;
  const lastToPlay = trick.plays.length === config.playerCount - 1;

  // If a teammate is winning with a card nobody can beat (or we're last), don't waste anything.
  const teammateWinning = teamOf(winnerSeat) === teamOf(view.seat);
  const teammateSafe = isJoker(winningCard) || lastToPlay ||
    (suitOf(winningCard) === trump ? isTopOfSuit(winningCard, unseen) : isTopOfSuit(winningCard, unseen) && !unseen.includes('JK'));
  if (teammateWinning && teammateSafe) return cheapestNonJoker(cards, trump);

  const winners = cards.filter((c) => beats(c, winningCard, trump, required));
  if (winners.length > 0) {
    // Prefer a non-Joker winner; save the Joker unless it's the only way to win.
    const nonJoker = winners.filter((c) => !isJoker(c));
    return nonJoker.length > 0 ? cheapest(nonJoker, trump) : 'JK';
  }
  return cheapestNonJoker(cards, trump);
}

function cheapestNonJoker(cards: Card[], trump: Suit): Card {
  const rest = cards.filter((c) => !isJoker(c));
  return cheapest(rest.length > 0 ? rest : cards, trump);
}
