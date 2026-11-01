#!/usr/bin/env bun
/**
 * The orchestrator. One command produces the whole report.
 *
 *   bun run-all.ts                              official profile, all 12 targets
 *   bun run-all.ts --profile quick              fast sanity sweep
 *   bun run-all.ts --only asena-ergenecore,hono subset (app id or target id)
 *   bun run-all.ts --skip nest-express --reps 5
 *   bun run-all.ts --resume                     skip targets that already have a result
 *   bun run-all.ts --duration 60                override the profile duration
 *
 * Per target: reset the database → build → conformance gate → measure every scenario
 * → write results/<target>.json → re-render results/REPORT.md. The report is rewritten
 * after every target so a sweep that dies halfway still leaves usable output.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BENCHMARKED, requestsFor } from './contract/requests.ts';
import { resolveTargets, ALL_TARGETS, type Target } from './contract/targets.ts';
import * as proc from './tools/proc.ts';
import * as db from './tools/db.ts';
import * as wrk from './tools/wrk.ts';
import * as report from './tools/markdown.ts';
import { checkRunning } from './tools/conformance.ts';
import { medianRep, type RepStat, type ScenarioResult, type SkipRecord, type TargetResult } from './tools/types.ts';

const ROOT = new URL('.', import.meta.url).pathname;
const RESULTS = join(ROOT, 'results');

// ---- args ----

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const list = (name: string): string[] | undefined => flag(name)?.split(',').map((s) => s.trim()).filter(Boolean);

const profileName = flag('profile') ?? 'official';
const profile = { ...wrk.PROFILES[profileName]! };
if (!wrk.PROFILES[profileName]) {
  console.error(`unknown profile "${profileName}" — expected one of: ${Object.keys(wrk.PROFILES).join(', ')}`);
  process.exit(1);
}
const durationOverride = flag('duration');
if (durationOverride) profile.duration = Number(durationOverride);
const REPS = Number(flag('reps') ?? 3);
const PIN = !has('no-pin');
const RESUME = has('resume');
const only = list('only');
const skipList = list('skip');

const targets: Target[] = only
  ? ALL_TARGETS.filter((t) => only.includes(t.app) || only.includes(t.id)).filter(
      (t) => !skipList?.includes(t.app) && !skipList?.includes(t.id),
    )
  : resolveTargets(undefined, skipList);

if (targets.length === 0) {
  console.error('run-all: no targets matched');
  process.exit(1);
}

// --estimate: wall-clock arithmetic before committing a night to a sweep
if (has('estimate')) {
  let secs = 0;
  let runs = 0;
  for (const t of targets) {
    for (const r of requestsFor(t.app).filter((x) => x.benchmark)) {
      const d = r.isWrite ? profile.writeDuration : profile.duration;
      secs += REPS * (profile.warmup + d + 5 + 2); // warmup + measure + cooldown + start/stop
      runs += REPS;
    }
    secs += 30; // build + db reset + conformance
  }
  console.log(
    `${targets.length} target(s) · profile ${profile.name} ` +
      `(${profile.threads}t/${profile.connections}c/${profile.duration}s, write ${profile.writeDuration}s) · ` +
      `${REPS} reps\n${runs} wrk runs · roughly ${(secs / 3600).toFixed(1)} h`,
  );
  process.exit(0);
}

// ---- state ----

const skips: SkipRecord[] = existsSync(join(RESULTS, 'skips.json'))
  ? JSON.parse(await readFile(join(RESULTS, 'skips.json'), 'utf8'))
  : [];

let current: proc.AppHandle | null = null;
let aborted = false;

async function recordSkip(target: string, reason: string): Promise<void> {
  const i = skips.findIndex((s) => s.target === target);
  const rec = { target, reason };
  if (i >= 0) skips[i] = rec;
  else skips.push(rec);
  await writeFile(join(RESULTS, 'skips.json'), JSON.stringify(skips, null, 2) + '\n');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (aborted) process.exit(130);
    aborted = true;
    console.log(`\n\n${sig} — stopping the current server and writing the report…`);
    if (current) await proc.stop(current).catch(() => {});
    await report.write().catch(() => {});
    console.log('report written. re-run with --resume to continue.');
    process.exit(130);
  });
}

function runtimeVersion(target: Target): string {
  const bin = target.runtime === 'node' ? 'node' : 'bun';
  const r = Bun.spawnSync([bin, '--version']);
  return new TextDecoder().decode(r.stdout).trim().replace(/^v/, '');
}

const bar = (s: string) => console.log(`\n${'━'.repeat(72)}\n${s}\n${'━'.repeat(72)}`);

// ---- measurement ----

async function measure(target: Target): Promise<TargetResult> {
  const startedAt = new Date().toISOString();
  const mine = requestsFor(target.app).filter((r) => r.benchmark);
  const scenarios: Record<string, ScenarioResult> = {};

  // --- conformance gate: no bytes, no numbers ---
  process.stdout.write('  conformance… ');
  await proc.reapPort(target.port);
  await proc.build(target);
  current = await proc.start(target, PIN);
  let meta: Record<string, unknown>;
  try {
    meta = await proc.waitHealthy(target, current);
    const c = await checkRunning(target, meta);
    if (!c.ok) {
      const detail = c.failures.map((f) => `${f.request}: ${f.reason}`).join('; ');
      throw new Error(`conformance failed — ${detail}`);
    }
    console.log(`✅ ${c.checked} requests`);
  } finally {
    await proc.stop(current);
    current = null;
  }

  // --- scenarios ---
  for (const r of mine) {
    const seconds = r.isWrite ? profile.writeDuration : profile.duration;
    const reps: RepStat[] = [];
    let note: string | undefined;
    process.stdout.write(`  ${r.id.padEnd(9)} ${r.scenario.padEnd(22)}`);

    for (let rep = 1; rep <= REPS; rep++) {
      if (aborted) break;
      try {
        if (r.isWrite) await db.truncateWrites();
        current = await proc.start(target, PIN);
        await proc.waitHealthy(target, current);
        await wrk.run(target, r, profile, profile.warmup, PIN); // warmup, discarded
        const res = await wrk.run(target, r, profile, seconds, PIN);
        if (res.non2xx > 0 || res.socketErrors > 0) {
          throw new Error(`${res.non2xx} non-2xx, ${res.socketErrors} socket errors`);
        }
        const { raw: _raw, durationSec: _d, ...stat } = res;
        reps.push(stat);
        process.stdout.write(` ${Math.round(res.rps).toLocaleString('en-US')}`);
      } catch (e) {
        note = (e as Error).message;
        process.stdout.write(` ✗`);
      } finally {
        if (current) await proc.stop(current).catch(() => {});
        current = null;
        await Bun.sleep(5_000); // cooldown
      }
    }

    if (reps.length === 0) {
      scenarios[r.id] = { id: r.id, scenario: r.scenario, group: r.group, status: 'failed', note, reps: [] };
      console.log(`  FAILED (${note})`);
    } else {
      const med = medianRep(reps);
      const rpsValues = reps.map((x) => x.rps);
      const spread = (Math.max(...rpsValues) - Math.min(...rpsValues)) / med.rps;
      scenarios[r.id] = { id: r.id, scenario: r.scenario, group: r.group, status: 'ok', note, reps, median: med, rpsSpread: spread };
      console.log(`  → ${Math.round(med.rps).toLocaleString('en-US')} rps (±${(spread * 100).toFixed(1)}%)`);
    }
  }

  return {
    target: target.id,
    app: target.app,
    framework: target.framework,
    runtime: target.runtime,
    runtimeVersion: runtimeVersion(target),
    dbLayer: target.dbLayer,
    validator: target.validator,
    meta,
    profile,
    reps: REPS,
    startedAt,
    finishedAt: new Date().toISOString(),
    scenarios,
  };
}

// ---- sweep ----

await mkdir(RESULTS, { recursive: true });
await db.ensureDatabase();

const benchCount = BENCHMARKED.length;
console.log(
  `run-all: ${targets.length} target(s) · profile ${profile.name} ` +
    `(${profile.threads}t/${profile.connections}c/${profile.duration}s) · ${REPS} reps · ` +
    `up to ${benchCount} scenarios · pinning ${PIN ? `server ${proc.SERVER_CPUS}, client ${proc.CLIENT_CPUS}` : 'off'}`,
);

for (const target of targets) {
  if (aborted) break;
  const out = join(RESULTS, `${target.id}.json`);
  if (RESUME && existsSync(out)) {
    console.log(`\n▸ ${target.id} — already measured, skipping (--resume)`);
    continue;
  }

  bar(`▸ ${target.id}  ·  ${target.framework}  ·  ${target.runtime}  ·  port ${target.port}`);

  try {
    process.stdout.write('  database reset… ');
    await db.reset();
    console.log(`✅ ${db.SEED_ROWS.toLocaleString('en-US')} rows`);

    const result = await measure(target);
    await writeFile(out, JSON.stringify(result, null, 2) + '\n');
    await report.write();
    console.log(`\n  saved → results/${target.id}.json · report updated`);
  } catch (e) {
    const reason = (e as Error).message;
    console.log(`\n  ✗ ${target.id} skipped: ${reason}`);
    await recordSkip(target.id, reason);
    await report.write();
    if (current) await proc.stop(current).catch(() => {});
    current = null;
  }
}

await report.write();
bar(`done — results/REPORT.md`);
