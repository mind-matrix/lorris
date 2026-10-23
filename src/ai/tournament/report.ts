import { bootstrapMean, wilson, type Interval } from './stats';
import type { DuplicateGameRecord, DuplicateSetRecord, MoveTiming } from './match';

export interface BotSummary {
  calls: number;
  made: number;
  forced: number;
  callSum: number;
  undercalls: number;
  undercallKnown: number;
  timing: MoveTiming;
}

export interface PairingReport {
  a: string;
  b: string;
  players: number;
  sets: number;
  /** A's per-deal margin (points, both seatings), with a bootstrap 95% CI. */
  margin: Interval;
  bySituation: Record<string, Interval>;
  games: { pairs: number; aWins: Interval; unfinished: number } | null;
  bots: Record<string, BotSummary>;
}

export function summarize(sets: DuplicateSetRecord[], games: DuplicateGameRecord[]): PairingReport {
  const { a, b, players } = sets[0] ?? games[0];
  const bots: Record<string, BotSummary> = {};
  const bot = (id: string) => (bots[id] ??= { calls: 0, made: 0, forced: 0, callSum: 0, undercalls: 0, undercallKnown: 0, timing: { ms: 0, moves: 0 } });
  const situations: Record<string, number[]> = {};
  for (const r of sets) {
    (situations[r.situation] ??= []).push(r.margin);
    for (const g of r.games) {
      for (const [id, t] of Object.entries(g.timing)) {
        bot(id).timing.ms += t.ms;
        bot(id).timing.moves += t.moves;
      }
      if (!g.call) continue;
      const s = bot(g.teamBots[g.call.team]);
      s.calls++;
      s.callSum += g.call.value;
      if (g.call.made) s.made++;
      if (g.call.forced) s.forced++;
      if (g.undercall !== null) {
        s.undercallKnown++;
        if (g.undercall) s.undercalls++;
      }
    }
  }
  const bySituation = Object.fromEntries(Object.entries(situations).map(([k, v]) => [k, bootstrapMean(v, 7)]));
  const pairs = games.length;
  const aWins = games.reduce((t, g) => t + g.aWins, 0);
  const finished = games.reduce((t, g) => t + g.finished, 0);
  return {
    a,
    b,
    players,
    sets: sets.length,
    margin: bootstrapMean(sets.map((r) => r.margin), 11),
    bySituation,
    games: pairs ? { pairs, aWins: wilson(aWins, finished), unfinished: 2 * pairs - finished } : null,
    bots,
  };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '—');
const ci = (i: Interval, d = 2) => `${f(i.mean, d)} [${f(i.lo, d)}, ${f(i.hi, d)}]`;

export function formatReport(r: PairingReport): string {
  const lines: string[] = [];
  lines.push(`\n=== ${r.a} vs ${r.b} · ${r.players} players ===`);
  const verdict = r.margin.lo > 0 ? `${r.a} is significantly stronger` : r.margin.hi < 0 ? `${r.b} is significantly stronger` : 'no significant difference';
  lines.push(`Duplicate Sets: ${r.sets} deals × 2 seatings`);
  lines.push(`  ${r.a} margin per deal (points): ${ci(r.margin)}  → ${verdict}`);
  for (const [name, i] of Object.entries(r.bySituation)) lines.push(`    ${name.padEnd(28)} ${ci(i)}  (n=${i.n})`);
  if (r.games) {
    lines.push(`Full games: ${r.games.pairs} pairs; ${r.a} win rate ${pct(r.games.aWins.mean)} [${pct(r.games.aWins.lo)}, ${pct(r.games.aWins.hi)}]` + (r.games.unfinished ? `, ${r.games.unfinished} unfinished (move cap)` : ''));
  }
  lines.push('  bot          calls  success  avg call  forced  overcall  undercall*  ms/move');
  for (const [id, s] of Object.entries(r.bots)) {
    lines.push(
      `  ${id.padEnd(12)} ${String(s.calls).padStart(5)}  ${pct(s.made / s.calls).padStart(7)}  ${f(s.callSum / s.calls).padStart(8)}  ${pct(s.forced / s.calls).padStart(6)}  ${pct(1 - s.made / s.calls).padStart(8)}  ${pct(s.undercallKnown ? s.undercalls / s.undercallKnown : NaN).padStart(10)}  ${f(s.timing.ms / Math.max(1, s.timing.moves), 3).padStart(7)}`,
    );
  }
  lines.push('  * undercall is an ESTIMATE: made calls where the team would have won ≥1 more round than called,');
  lines.push('    from a harness-only playout of the rounds the engine skips once a Set is decided.');
  return lines.join('\n');
}
