import { legalCards } from './rules';
import { SUITS, type Action, type Card, type GameState, type PlayerView, type PublicState, type Seat } from './types';

/** Highest call so far in this set, or 0 if nobody has called. */
export function highestBid(pub: PublicState): number {
  let best = 0;
  for (const b of pub.bids) if (b.bid !== 'pass' && b.bid > best) best = b.bid;
  return best;
}

/**
 * Legal actions for a seat, computed only from public information plus that seat's own hand.
 * This means the same function works on full state (host) and on a player view (UI, bots).
 */
export function legalActionsFor(pub: PublicState, seat: Seat, hand: Card[]): Action[] {
  const actions: Action[] = [];
  const myTurn = pub.turn === seat;

  switch (pub.phase) {
    case 'bidding':
      if (myTurn) {
        actions.push({ type: 'PASS' });
        for (let v = Math.max(pub.config.minBid, highestBid(pub) + 1); v <= pub.config.maxBid; v++) {
          actions.push({ type: 'BID', value: v });
        }
      }
      break;
    case 'choosingTrump':
      if (myTurn) for (const suit of SUITS) actions.push({ type: 'CHOOSE_TRUMP', suit });
      break;
    case 'playing':
      if (myTurn) for (const card of legalCards(hand, pub.trick, pub.trump!)) actions.push({ type: 'PLAY_CARD', card });
      break;
    case 'setOver':
      if (myTurn) actions.push({ type: 'NEXT_SET' });
      break;
    case 'gameOver':
      break;
  }
  return actions;
}

export function getLegalActions(state: GameState, seat: Seat): Action[] {
  return legalActionsFor(state, seat, state.hands[seat] ?? []);
}

export function getLegalActionsFromView(view: PlayerView): Action[] {
  return legalActionsFor(view, view.seat, view.myHand);
}
