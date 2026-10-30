// Headless bot tournament. Duplicate Sets (main metric) and duplicate full games (sanity check),
// in 4- and 6-player modes, spread across CPU cores with worker_threads.
//
//   npm run tournament -- --a heuristic --b random            quick run (development)
//   npm run tournament -- --suite benchmark --full            final numbers
//
// Options: --a/--b bot ids, --suite <name>, --players 4,6, --quick | --full, --sets N, --games N,
//          --jobs N (default: cores - 1), --seed S
//
// Every result is appended to tournament-results/<time>.jsonl as it arrives, so a long run can be
// inspected partway:  npm run tournament -- --report tournament-results/<file>.jsonl

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../src/ai/tournament/entry.ts', import.meta.url));

/** Loads our TypeScript through vite-node (pinned in devDependencies). */
async function load() {
  const { createServer } = await import('vite');
  const { ViteNodeServer } = await import('vite-node/server');
  const { ViteNodeRunner } = await import('vite-node/client');
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    server: { hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.pluginContainer.buildStart({});
  const node = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule: (id) => node.fetchModule(id),
    resolveId: (id, importer) => node.resolveId(id, importer),
  });
  return { mod: await runner.executeFile(ENTRY), server };
}

if (!isMainThread) {
  // Worker: run tasks as the main thread hands them out.
  const { mod } = await load();
  parentPort.on('message', async (task) => {
    if (task === 'stop') process.exit(0);
    try {
      parentPort.postMessage({ ok: true, record: await mod.runTask(task) });
    } catch (e) {
      parentPort.postMessage({ ok: false, error: String(e?.stack ?? e), task });
    }
  });
  parentPort.postMessage({ ready: true });
} else {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => {
      if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
      return acc;
    }, []),
  );
  if (args.report) {
    // Re-summarize saved results (also works on a run that's still going).
    const results = readFileSync(args.report, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const { mod, server } = await load();
    const keys = [...new Set(results.map((r) => `${r.a}|${r.b}|${r.players}`))];
    for (const key of keys) {
      const mine = results.filter((r) => `${r.a}|${r.b}|${r.players}` === key);
      console.log(mod.formatReport(mod.summarize(mine.filter((r) => 'margin' in r), mine.filter((r) => 'aWins' in r))));
    }
    console.log(`\n${results.length} results from ${args.report}`);
    await server.close();
    process.exit(0);
  }
  const full = !!args.full;
  const sets = Number(args.sets ?? (full ? 3000 : 300));
  const games = Number(args.games ?? (full ? 300 : 20));
  const players = String(args.players ?? '4,6').split(',').map(Number);
  const seed0 = Number(args.seed ?? 1);
  const jobs = Math.max(1, Number(args.jobs ?? os.cpus().length - 1));
  const SUITES = {
    // heuristic vs heuristic checks the harness: it must come out at about zero.
    baseline: [['heuristic', 'random'], ['heuristic', 'heuristic']],
    benchmark: [['ismcts', 'heuristic'], ['ismcts', 'random'], ['heuristic', 'random']],
    budget: [['ismcts:100', 'ismcts:400'], ['ismcts:400', 'ismcts:1000'], ['ismcts:1000', 'ismcts:2000'], ['ismcts:100', 'heuristic'], ['ismcts:400', 'heuristic'], ['ismcts:1000', 'heuristic'], ['ismcts:2000', 'heuristic']],
  };
  const pairings = args.suite ? SUITES[args.suite] : [[args.a ?? 'heuristic', args.b ?? 'random']];
  if (!pairings) throw new Error(`Unknown suite ${args.suite}`);

  const tasks = [];
  for (const [a, b] of pairings)
    for (const p of players) {
      for (let i = 0; i < sets; i++) tasks.push({ kind: 'set', players: p, seed: seed0 + i, a, b });
      for (let i = 0; i < games; i++) tasks.push({ kind: 'game', players: p, seed: 1_000_000 + seed0 + i, a, b });
    }
  console.log(`${full ? 'Full' : 'Quick'} run: ${pairings.map((x) => x.join(' vs ')).join(', ')}; players ${players.join(',')}; ${sets} duplicate Sets and ${games} duplicate games each; ${jobs} workers.`);

  const results = [];
  const started = Date.now();
  mkdirSync('tournament-results', { recursive: true });
  const logFile = `tournament-results/${new Date(started).toISOString().replace(/[:.]/g, '-')}.jsonl`;
  console.log(`Saving results to ${logFile}`);
  let next = 0;
  let done = 0;
  let lastLog = 0;
  await new Promise((resolve, reject) => {
    let live = 0;
    for (let w = 0; w < Math.min(jobs, tasks.length); w++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      live++;
      const feed = () => (next < tasks.length ? worker.postMessage(tasks[next++]) : (worker.postMessage('stop'), --live === 0 && resolve()));
      worker.on('message', (m) => {
        if (m.ready) return feed();
        if (!m.ok) return reject(new Error(`Task ${JSON.stringify(m.task)} failed:\n${m.error}`));
        results.push(m.record);
        appendFileSync(logFile, JSON.stringify(m.record) + '\n');
        done++;
        if (Date.now() - lastLog > 5000) {
          lastLog = Date.now();
          console.log(`  ${done}/${tasks.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
        }
        feed();
      });
      worker.on('error', reject);
    }
  });

  const { mod, server } = await load();
  for (const [a, b] of pairings)
    for (const p of players) {
      const mine = results.filter((r) => r.a === a && r.b === b && r.players === p);
      const report = mod.summarize(mine.filter((r) => 'margin' in r), mine.filter((r) => 'aWins' in r));
      console.log(mod.formatReport(report));
    }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  await server.close();
  process.exit(0);
}
