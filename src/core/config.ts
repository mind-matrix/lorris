import { SUITS, type GameConfig, type Seat, type Team } from './types';

/** Player counts the rules support. Each player always gets 8 cards and plays 8 rounds. */
export const SUPPORTED_PLAYER_COUNTS = [4, 6] as const;

const CARDS_PER_PLAYER = 8;

export function makeConfig(playerCount: number, overrides: Partial<Pick<GameConfig, 'targetScore'>> = {}): GameConfig {
  if (!(SUPPORTED_PLAYER_COUNTS as readonly number[]).includes(playerCount)) {
    throw new Error(`Unsupported player count ${playerCount}; expected one of ${SUPPORTED_PLAYER_COUNTS.join(', ')}`);
  }
  // The deck holds exactly enough cards for everyone: the highest N ranks of each suit.
  // 4 players -> 8 per suit (7..A), 6 players -> 12 per suit (3..A).
  const ranksPerSuit = (playerCount * CARDS_PER_PLAYER) / SUITS.length;
  return {
    playerCount,
    cardsPerPlayer: CARDS_PER_PLAYER,
    tricksPerSet: CARDS_PER_PLAYER,
    lowestRank: 15 - ranksPerSuit,
    minBid: 4,
    maxBid: CARDS_PER_PLAYER,
    targetScore: 32,
    ...overrides,
  };
}

export function teamOf(seat: Seat): Team {
  return (seat % 2) as Team;
}

/** The next seat in anti-clockwise order (the direction of play). */
export function nextSeat(config: GameConfig, seat: Seat): Seat {
  return (seat + 1) % config.playerCount;
}

export function seatsOfTeam(config: GameConfig, team: Team): Seat[] {
  const seats: Seat[] = [];
  for (let s = team; s < config.playerCount; s += 2) seats.push(s);
  return seats;
}
