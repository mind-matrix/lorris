// Checks that a production build contains exactly the TURN relay settings it should.
//
//   node scripts/check-relay-build.mjs              check dist/ against the current VITE_* env (CI)
//   node scripts/check-relay-build.mjs --self-test  build twice (no relays / dummy relays) and check both
//
// Fails when a relay is half-configured, or a configured value is missing from the build
// (e.g. a secret not passed to the build step), so a misconfigured build never ships.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VARS = ['VITE_METERED_APP', 'VITE_METERED_API_KEY', 'VITE_TURN_URLS', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL'];

function bundleText(dir) {
  let text = '';
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|webmanifest)$/.test(f)) text += readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return text;
}

/** Problems with `dir` given relay settings `env` (null result = all good). */
function check(dir, env) {
  const val = (k) => (env[k] ?? '').trim();
  const problems = [];
  const own = ['VITE_TURN_URLS', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL'];
  const met = ['VITE_METERED_APP', 'VITE_METERED_API_KEY'];
  for (const group of [own, met]) {
    const set = group.filter((k) => val(k));
    if (set.length && set.length < group.length) problems.push(`half-configured relay: ${set.join(', ')} set but ${group.filter((k) => !val(k)).join(', ')} missing`);
  }
  const text = bundleText(dir);
  for (const k of VARS) {
    const v = k === 'VITE_METERED_APP' ? val(k).toLowerCase() : val(k);
    const parts = k === 'VITE_TURN_URLS' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v ? [v] : [];
    for (const p of parts) if (!text.includes(p)) problems.push(`${k} is set but its value is not in the build`);
  }
  return { problems, text };
}

if (process.argv.includes('--self-test')) {
  const DUMMY = {
    VITE_METERED_APP: 'selftestapp',
    VITE_METERED_API_KEY: 'KEY_selftest_8f3a1c',
    VITE_TURN_URLS: 'turn:relay.selftest.invalid:3478,turns:relay.selftest.invalid:5349',
    VITE_TURN_USERNAME: 'user_selftest_42',
    VITE_TURN_CREDENTIAL: 'PW_selftest_9d7e2b',
  };
  const build = (env) => {
    const dir = mkdtempSync(join(tmpdir(), 'lorris-relay-'));
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
    const r = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { env: { ...clean, ...env }, stdio: 'ignore' });
    if (r.status !== 0) throw new Error('build failed');
    return dir;
  };
  const without = build({});
  const leaked = Object.values(DUMMY).flatMap((v) => v.split(',')).filter((v) => check(without, {}).text.includes(v));
  const withRelays = build(DUMMY);
  const { problems } = check(withRelays, DUMMY);
  rmSync(without, { recursive: true, force: true });
  rmSync(withRelays, { recursive: true, force: true });
  if (leaked.length) throw new Error(`build without relay variables contains: ${leaked.join(', ')}`);
  if (problems.length) throw new Error(`build with relay variables: ${problems.join('; ')}`);
  console.log('Relay build self-test passed: no credentials without the variables; all of them with.');
} else {
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist';
  const { problems } = check(dir, process.env);
  const configured = VARS.filter((k) => (process.env[k] ?? '').trim());
  if (problems.length) {
    console.error(`Relay build check FAILED:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(configured.length ? `Relay build check passed (${configured.join(', ')} built in).` : 'Relay build check passed (no TURN relays configured).');
}
