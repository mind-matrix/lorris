// What one player can work out about hidden cards, from their PlayerView only (never full state).

import {
  SUITS,
  buildDeck,
  isJoker,
  leadRequirement,
  rankOf,
  suitOf,
  teamOf,
  type Card,
  type GameConfig,
  type PlayerView,
  type Seat,
  type Suit,
  type Team,
} from '../../core';
import { KNOWLEDGE_CONFIG } from './config';

export type JokerStatus = 'played' | 'mine' | 'unseen';

export interface Knowledge {
  me: Seat;
  config: GameConfig;
  myTeam: Team;
  trump: Suit | null;
  /** The team that made the call this Set, once bidding is over. */
  callingTeam: Team | null;
  played: Set<Card>;
  jokerStatus: JokerStatus;
  /** Cards that are in other players' hands (not played, not mine). */
  unseen: Card[];
  handCounts: number[];
  /** voids[seat][suit index in SUITS]: that seat certainly holds no card of that suit. */
  voids: boolean[][];
  /** Soft likelihood multiplier for `seat` holding `card` (1 = no information). */
  weight(seat: Seat, card: Card): number;
}

const suitIndex = (s: Suit) => SUITS.indexOf(s);

export function buildKnowledge(view: PlayerView, cfg = KNOWLEDGE_CONFIG): Knowledge {
  const n = view.config.playerCount;
  const played = new Set<Card>();
  const voids = Array.from({ length: n }, () => [false, false, false, false]);

  // Every round of this Set, finished or in progress, from the public table.
  const rounds = [...view.completedTricks, view.trick];
  for (const round of rounds) {
    for (const p of round.plays) played.add(p.card);
    if (!view.trump || round.plays.length === 0) continue;
    const required = leadRequirement({ leader: round.leader, plays: round.plays.slice(0, 1) }, view.trump);
    for (const p of round.plays.slice(1)) {
      // Not following the required suit (and not the Joker, which is always allowed) proves a void.
      // When the Joker was led, the required suit is trump: not playing trump proves no trumps.
      if (required && !isJoker(p.card) && suitOf(p.card) !== required) voids[p.seat][suitIndex(required)] = true;
    }
  }

  const mine = new Set(view.myHand);
  const unseen = buildDeck(view.config).filter((c) => !played.has(c) && !mine.has(c));
  const jokerStatus: JokerStatus = played.has('JK') ? 'played' : mine.has('JK') ? 'mine' : 'unseen';
  const callingTeam = view.contract && view.phase !== 'bidding' ? teamOf(view.contract.seat) : null;

  // Soft signals from this Set's bidding. Precompute per-seat factors.
  const minBid = view.config.minBid;
  const highCardBoost = Array<number>(n).fill(1);
  const trumpBoost = Array<number>(n).fill(1);
  const jokerBoost = Array<number>(n).fill(1);
  for (const b of view.bids) {
    if (b.bid === 'pass') {
      highCardBoost[b.seat] *= cfg.passerHighCard;
      jokerBoost[b.seat] *= cfg.passerJoker;
    } else {
      const level = b.bid - minBid + 1;
      highCardBoost[b.seat] *= 1 + cfg.callerHighCardPerLevel * level;
      jokerBoost[b.seat] *= 1 + cfg.callerJokerPerLevel * level;
      trumpBoost[b.seat] *= 1 + cfg.callerHighCardPerLevel * level;
    }
  }
  const chooser = view.contract && view.trump ? view.contract.seat : null;

  const weight = (seat: Seat, card: Card): number => {
    if (isJoker(card)) return jokerBoost[seat];
    let w = 1;
    const suit = suitOf(card)!;
    if (rankOf(card) >= 12) w *= highCardBoost[seat];
    if (view.trump && suit === view.trump) {
      w *= trumpBoost[seat];
      if (seat === chooser) w *= cfg.trumpChooserTrump;
    }
    return w;
  };

  return {
    me: view.seat,
    config: view.config,
    myTeam: teamOf(view.seat),
    trump: view.trump,
    callingTeam,
    played,
    jokerStatus,
    unseen,
    handCounts: view.handCounts,
    voids,
    weight,
  };
}
