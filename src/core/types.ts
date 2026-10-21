// Core types for Lorris. Everything here is plain, JSON-safe data.

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

/** Rank labels from lowest to highest. Numeric value = index + 2 (so A = 14). */
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type RankLabel = (typeof RANK_LABELS)[number];

/** A card id such as "AS", "10H", "3C", or "JK" for the Joker. */
export type Card = `${RankLabel}${Suit}` | 'JK';
export const JOKER: Card = 'JK';

/** Seats are numbered 0..playerCount-1 in anti-clockwise order: seat + 1 plays next. */
export type Seat = number;

/** There are always two teams; teammates sit in alternating seats (team = seat % 2). */
export type Team = 0 | 1;

export interface GameConfig {
  playerCount: number;
  cardsPerPlayer: number;
  tricksPerSet: number;
  /** Numeric value of the lowest rank in the deck (7 for 4 players, 3 for 6 players). */
  lowestRank: number;
  minBid: number;
  maxBid: number;
  targetScore: number;
}

export type Phase = 'bidding' | 'choosingTrump' | 'playing' | 'setOver' | 'gameOver';

export interface Bid {
  seat: Seat;
  /** A call value, or 'pass'. */
  bid: number | 'pass';
}

export interface Contract {
  seat: Seat;
  value: number;
  /** True if nobody called and the cutter was forced to take the minimum call. */
  forced: boolean;
}

export interface Play {
  seat: Seat;
  card: Card;
}

export interface Trick {
  leader: Seat;
  plays: Play[];
}

export interface CompletedTrick extends Trick {
  winner: Seat;
}

export interface SetResult {
  setNumber: number;
  contract: Contract;
  trump: Suit;
  bidTeam: Team;
  tricksWon: [number, number];
  made: boolean;
  /** Points added to the bidding team's score (negative on failure). */
  delta: number;
  /** Rounds actually played. Fewer than tricksPerSet if the set ended as soon as the result was decided. */
  roundsPlayed: number;
}

/** Public events for the current set, used by the UI for notifications and animations. */
export type GameEvent = { seq: number } & (
  | { type: 'SET_STARTED'; setNumber: number; dealer: Seat; cutter: Seat; cutIndex: number }
  | { type: 'MISDEAL'; team: Team; trump: Suit }
  | { type: 'BID'; seat: Seat; bid: number | 'pass' }
  | { type: 'FORCED_BID'; seat: Seat; value: number }
  | { type: 'TRUMP_CHOSEN'; seat: Seat; suit: Suit }
  | { type: 'CARD_PLAYED'; seat: Seat; card: Card }
  | { type: 'TRICK_WON'; seat: Seat; trickIndex: number }
  | { type: 'SET_SCORED'; result: SetResult }
  | { type: 'GAME_OVER'; winner: Team }
);

/** Everything every player is allowed to see. */
export interface PublicState {
  config: GameConfig;
  phase: Phase;
  /** 1-based number of the current set. */
  setNumber: number;
  dealer: Seat;
  cutter: Seat;
  /**
   * Seat expected to act next: bidder, trump chooser, card player, or (in setOver) the next dealer.
   * Null once the game is over.
   */
  turn: Seat | null;
  bids: Bid[];
  contract: Contract | null;
  trump: Suit | null;
  trick: Trick;
  completedTricks: CompletedTrick[];
  tricksWon: [number, number];
  scores: [number, number];
  /** Whether each team has already failed a call (the first failure costs double). */
  hasFailedBefore: [boolean, boolean];
  setHistory: SetResult[];
  winner: Team | null;
  /** Events of the current set only (reset when a new set is dealt). */
  log: GameEvent[];
  /** Next event sequence number; increases for the whole game. */
  nextSeq: number;
}

/** Full authoritative state. Only the host ever holds this. */
export interface GameState extends PublicState {
  /** Seeded RNG state. Stored here so applyAction stays a pure function. */
  rng: number;
  hands: Card[][];
}

/** What a single player may see. The UI and bots only ever receive this. */
export interface PlayerView extends PublicState {
  seat: Seat;
  myHand: Card[];
  handCounts: number[];
}

export type Action =
  | { type: 'BID'; value: number }
  | { type: 'PASS' }
  | { type: 'CHOOSE_TRUMP'; suit: Suit }
  | { type: 'PLAY_CARD'; card: Card }
  /** Deal the next set. Only the next dealer may do this. */
  | { type: 'NEXT_SET' };

export type ErrorCode =
  | 'INVALID_SEAT'
  | 'INVALID_ACTION'
  | 'GAME_OVER'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'BID_OUT_OF_RANGE'
  | 'BID_NOT_HIGHER'
  | 'INVALID_SUIT'
  | 'CARD_NOT_IN_HAND'
  | 'MUST_FOLLOW_SUIT'
  | 'MUST_PLAY_TRUMP';

export interface RuleError {
  code: ErrorCode;
  message: string;
}

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: RuleError };
