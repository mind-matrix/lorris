// What the tournament script runs (in each worker thread, through vite-node).

import { botSpec } from './bots';
import { duplicateGame, duplicateSet, type DuplicateGameRecord, type DuplicateSetRecord } from './match';
export { formatReport, summarize } from './report';

export interface Task {
  kind: 'set' | 'game';
  players: number;
  seed: number;
  a: string;
  b: string;
}

export async function runTask(t: Task): Promise<DuplicateSetRecord | DuplicateGameRecord> {
  const a = botSpec(t.a);
  const b = botSpec(t.b);
  return t.kind === 'set' ? duplicateSet(t.players, t.seed, a, b) : duplicateGame(t.players, t.seed, a, b);
}
