import { isJoker, suitOf } from './cards';
import { nextSeat } from './config';
import { dealCards, startSet } from './deal';
import { highestBid } from './legal';
import { decidedWinner, leadRequirement, misdealTeam, trickWinner } from './rules';
import { finishSet } from './scoring';
import { cloneState, pushEvent } from './state';
import { SUITS, type Action, type ActionResult, type ErrorCode, type GameState, type Seat } from './types';

function fail(code: ErrorCode, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * The only way to change game state. Pure: never mutates `state`, and returns
 * either the new state or a typed error explaining why the action was rejected.
 */
export function applyAction(state: GameState, seat: Seat, action: Action): ActionResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.config.playerCount) {
    return fail('INVALID_SEAT', `No seat ${seat}`);
  }
  if (state.phase === 'gameOver') return fail('GAME_OVER', 'The game is over');

  switch (action?.type) {
    case 'BID':
    case 'PASS':
      if (state.phase !== 'bidding') return fail('WRONG_PHASE', 'Not bidding now');
      if (state.turn !== seat) return fail('NOT_YOUR_TURN', `It is seat ${state.turn}'s turn`);
      return bid(state, seat, action.type === 'PASS' ? 'pass' : action.value);
    case 'CHOOSE_TRUMP':
      if (state.phase !== 'choosingTrump') return fail('WRONG_PHASE', 'Not choosing trump now');
      if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'Only the highest caller chooses trump');
      return chooseTrump(state, action.suit);
    case 'PLAY_CARD':
      if (state.phase !== 'playing') return fail('WRONG_PHASE', 'Not playing cards now');
      if (state.turn !== seat) return fail('NOT_YOUR_TURN', `It is seat ${state.turn}'s turn`);
      return playCard(state, seat, action.card);
    case 'NEXT_SET':
      if (state.phase !== 'setOver') return fail('WRONG_PHASE', 'The set is not over');
      if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'Only the next dealer can deal');
      return nextSet(state);
    default:
      return fail('INVALID_ACTION', `Unknown action ${JSON.stringify(action)}`);
  }
}

function bid(state: GameState, seat: Seat, value: number | 'pass'): ActionResult {
  const { config } = state;
  if (value !== 'pass') {
    if (!Number.isInteger(value) || value < config.minBid || value > config.maxBid) {
      return fail('BID_OUT_OF_RANGE', `Calls must be between ${config.minBid} and ${config.maxBid}`);
    }
    if (value <= highestBid(state)) return fail('BID_NOT_HIGHER', `Must call higher than ${highestBid(state)}`);
  }

  const s = cloneState(state);
  s.bids.push({ seat, bid: value });
  pushEvent(s, { type: 'BID', seat, bid: value });

  // Bidding goes around the table once. It also ends early on the maximum call,
  // since nobody could go higher.
  const everyoneSpoke = s.bids.length === config.playerCount;
  if (value === config.maxBid || everyoneSpoke) {
    const best = highestBid(s);
    if (best === 0) {
      // Nobody called: the cutter is forced to take the minimum call.
      s.contract = { seat: s.cutter, value: config.minBid, forced: true };
      pushEvent(s, { type: 'FORCED_BID', seat: s.cutter, value: config.minBid });
    } else {
      const winner = s.bids.find((b) => b.bid === best)!;
      s.contract = { seat: winner.seat, value: best, forced: false };
    }
    s.phase = 'choosingTrump';
    s.turn = s.contract.seat;
  } else {
    s.turn = nextSeat(config, seat);
  }
  return { ok: true, state: s };
}

function chooseTrump(state: GameState, suit: unknown): ActionResult {
  if (!SUITS.includes(suit as never)) return fail('INVALID_SUIT', `Unknown suit ${String(suit)}`);
  const trump = suit as (typeof SUITS)[number];

  const s = cloneState(state);
  s.trump = trump;
  pushEvent(s, { type: 'TRUMP_CHOSEN', seat: s.contract!.seat, suit: trump });

  // Rule 6: a team holding every trump and the Joker cancels the set; re-deal with the same dealer.
  const team = misdealTeam(s.config, s.hands, trump);
  if (team !== null) {
    pushEvent(s, { type: 'MISDEAL', team, trump });
    dealCards(s);
    return { ok: true, state: s };
  }

  s.phase = 'playing';
  s.turn = s.cutter;
  s.trick = { leader: s.cutter, plays: [] };
  return { ok: true, state: s };
}

function playCard(state: GameState, seat: Seat, card: unknown): ActionResult {
  const hand = state.hands[seat];
  if (typeof card !== 'string' || !hand.includes(card as never)) {
    return fail('CARD_NOT_IN_HAND', `You don't have ${String(card)}`);
  }
  const c = card as (typeof hand)[number];

  // Follow-suit rules (rules 2-4). The Joker is always allowed.
  const required = leadRequirement(state.trick, state.trump!);
  if (required !== null && !isJoker(c) && suitOf(c) !== required && hand.some((h) => suitOf(h) === required)) {
    const ledJoker = isJoker(state.trick.plays[0].card);
    return ledJoker
      ? fail('MUST_PLAY_TRUMP', 'The Joker was led: you must play a trump card')
      : fail('MUST_FOLLOW_SUIT', 'You must follow the suit that was led');
  }

  const s = cloneState(state);
  s.hands[seat] = hand.filter((h) => h !== c);
  s.trick.plays.push({ seat, card: c });
  pushEvent(s, { type: 'CARD_PLAYED', seat, card: c });

  if (s.trick.plays.length < s.config.playerCount) {
    s.turn = nextSeat(s.config, seat);
    return { ok: true, state: s };
  }

  // Trick complete: the winner takes it and leads the next one (rule 5).
  const winner = trickWinner(s.trick, s.trump!);
  s.completedTricks.push({ ...s.trick, winner });
  s.tricksWon[winner % 2]++;
  pushEvent(s, { type: 'TRICK_WON', seat: winner, trickIndex: s.completedTricks.length - 1 });
  s.trick = { leader: winner, plays: [] };
  s.turn = winner;

  // The set ends as soon as its result is decided: the calling team has made its call, or
  // can no longer make it. Remaining rounds wouldn't change the score, so they aren't played.
  const contract = s.contract!;
  const decided = decidedWinner(s.config, contract.seat, contract.value, s.tricksWon, s.completedTricks.length);
  if (decided !== null) finishSet(s);
  return { ok: true, state: s };
}

function nextSet(state: GameState): ActionResult {
  const s = cloneState(state);
  s.dealer = nextSeat(s.config, s.dealer);
  startSet(s);
  return { ok: true, state: s };
}
