// Duplicate matches: every deal is played twice with the teams' bots swapped, so card luck cancels.

import {
  applyAction,
  createGame,
  getLegalActions,
  getPlayerView,
  legalCards,
  makeConfig,
  teamOf,
  trickWinner,
  type Action,
  type GameState,
  type Seat,
} from '../../core';
import type { Bot } from '../bot';
import type { BotSpec } from './bots';
import { setStart } from './scenarios';

export interface MoveTiming {
  ms: number;
  moves: number;
}

export interface SetRecord {
  /** Which bot id played each team. */
  teamBots: [string, string];
  /** Points each team gained or lost this Set. */
  deltas: [number, number];
  call: { team: 0 | 1; value: number; forced: boolean; made: boolean } | null;
  /**
   * Estimate (harness only): for a made call, would the calling team have won at least one more
   * round than it called, if the remaining rounds were played out? Null when not applicable.
   */
  undercall: boolean | null;
  timing: Record<string, MoveTiming>;
}

export interface DuplicateSetRecord {
  seed: number;
  players: number;
  situation: string;
  a: string;
  b: string;
  /** A's points minus B's points, summed over both seatings. */
  margin: number;
  games: [SetRecord, SetRecord];
}

export interface DuplicateGameRecord {
  seed: number;
  players: number;
  a: string;
  b: string;
  /** Games won by A (0, 1 or 2) out of the pair; unfinished games count for neither. */
  aWins: number;
  finished: number;
}

const botSeed = (dealSeed: number, seat: Seat, round: number) => (Math.imul(dealSeed + 1, 2654435761) ^ (seat * 97 + round * 7919)) >>> 0;

function time(timing: Record<string, MoveTiming>, id: string, ms: number) {
  const t = (timing[id] ??= { ms: 0, moves: 0 });
  t.ms += ms;
  t.moves++;
}

async function decide(bot: Bot, state: GameState, seat: Seat, legal: Action[]): Promise<Action> {
  const action = await bot.chooseAction(getPlayerView(state, seat), legal);
  if (!legal.some((a) => JSON.stringify(a) === JSON.stringify(action))) throw new Error(`${bot.name} chose an illegal action ${JSON.stringify(action)}`);
  return action;
}

/** Plays one Set from `start` with `teamSpecs[team]` playing each team's seats. */
export async function playSet(start: GameState, teamSpecs: [BotSpec, BotSpec], dealSeed: number, round: number): Promise<SetRecord> {
  const n = start.config.playerCount;
  const ids: [string, string] = [teamSpecs[0].id, teamSpecs[1].id];
  const bots = Array.from({ length: n }, (_, seat) => teamSpecs[teamOf(seat)].create(botSeed(dealSeed, seat, round)));
  const timing: Record<string, MoveTiming> = {};
  const before = [...start.scores];
  const startSet = start.setNumber;
  let s = start;
  for (let guard = 0; s.phase !== 'setOver' && s.phase !== 'gameOver'; guard++) {
    if (guard > 2000) throw new Error('Set did not finish');
    const seat = s.turn!;
    const legal = getLegalActions(s, seat);
    const t0 = performance.now();
    const action = legal.length === 1 ? legal[0] : await decide(bots[seat], s, seat, legal);
    time(timing, ids[teamOf(seat)], performance.now() - t0);
    const r = applyAction(s, seat, action);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
    if (s.setNumber !== startSet) throw new Error('moved past the Set');
  }
  const result = s.setHistory.at(-1)!;
  const deltas: [number, number] = [s.scores[0] - before[0], s.scores[1] - before[1]];
  let undercall: boolean | null = null;
  if (result.made && result.roundsPlayed < s.config.tricksPerSet) {
    const maximizers = Array.from({ length: n }, (_, seat) => teamSpecs[teamOf(seat)].createRoundsMaximizer(botSeed(dealSeed, seat, round + 50)));
    const won = await finishRounds(s, maximizers);
    undercall = won[result.bidTeam] >= result.contract.value + 1;
  } else if (result.made) {
    undercall = result.tricksWon[result.bidTeam] >= result.contract.value + 1;
  }
  return {
    teamBots: ids,
    deltas,
    call: { team: result.bidTeam, value: result.contract.value, forced: result.contract.forced, made: result.made },
    undercall,
    timing,
  };
}

/**
 * Harness-only: after the engine ended a Set early (its outcome was decided), play the remaining
 * rounds on a private copy, using the engine's own card rules, to see how many rounds the
 * calling team could have won. Never touches real game state or scoring.
 */
async function finishRounds(end: GameState, bots: Bot[]): Promise<[number, number]> {
  const n = end.config.playerCount;
  const last = end.completedTricks.at(-1)!;
  let s: GameState = {
    ...end,
    phase: 'playing',
    winner: null,
    hands: end.hands.map((h) => h.slice()),
    completedTricks: end.completedTricks.slice(),
    tricksWon: [end.tricksWon[0], end.tricksWon[1]],
    trick: { leader: last.winner, plays: [] },
    turn: last.winner,
  };
  while (s.completedTricks.length < s.config.tricksPerSet) {
    const seat = s.turn!;
    const legal = legalCards(s.hands[seat], s.trick, s.trump!).map((card): Action => ({ type: 'PLAY_CARD', card }));
    const action = legal.length === 1 ? legal[0] : await decide(bots[seat], s, seat, legal);
    const card = (action as Extract<Action, { type: 'PLAY_CARD' }>).card;
    const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h));
    const trick = { leader: s.trick.leader, plays: [...s.trick.plays, { seat, card }] };
    if (trick.plays.length < n) {
      s = { ...s, hands, trick, turn: (seat + 1) % n };
      continue;
    }
    const winner = trickWinner(trick, s.trump!);
    const tricksWon: [number, number] = [s.tricksWon[0], s.tricksWon[1]];
    tricksWon[teamOf(winner)]++;
    s = { ...s, hands, tricksWon, completedTricks: [...s.completedTricks, { ...trick, winner }], trick: { leader: winner, plays: [] }, turn: winner };
  }
  return s.tricksWon;
}

export async function duplicateSet(players: number, seed: number, a: BotSpec, b: BotSpec): Promise<DuplicateSetRecord> {
  const { state, situation } = setStart(makeConfig(players), seed);
  const g1 = await playSet(state, [a, b], seed, 0);
  const g2 = await playSet(state, [b, a], seed, 1);
  const margin = g1.deltas[0] - g1.deltas[1] + (g2.deltas[1] - g2.deltas[0]);
  return { seed, players, situation: situation.name, a: a.id, b: b.id, margin, games: [g1, g2] };
}

async function playGame(players: number, seed: number, teamSpecs: [BotSpec, BotSpec], round: number, maxActions: number): Promise<0 | 1 | null> {
  const n = players;
  const bots = Array.from({ length: n }, (_, seat) => teamSpecs[teamOf(seat)].create(botSeed(seed, seat, round)));
  let s = createGame(makeConfig(players), seed);
  for (let i = 0; i < maxActions && s.phase !== 'gameOver'; i++) {
    const seat = s.turn!;
    const legal = getLegalActions(s, seat);
    const action = legal.length === 1 ? legal[0] : await decide(bots[seat], s, seat, legal);
    const r = applyAction(s, seat, action);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
  }
  return s.winner;
}

/** A full game, twice, with the teams swapped (same deal sequence from the same seed). */
export async function duplicateGame(players: number, seed: number, a: BotSpec, b: BotSpec, maxActions = 20_000): Promise<DuplicateGameRecord> {
  const w1 = await playGame(players, seed, [a, b], 0, maxActions);
  const w2 = await playGame(players, seed, [b, a], 1, maxActions);
  return {
    seed,
    players,
    a: a.id,
    b: b.id,
    aWins: (w1 === 0 ? 1 : 0) + (w2 === 1 ? 1 : 0),
    finished: (w1 !== null ? 1 : 0) + (w2 !== null ? 1 : 0),
  };
}
