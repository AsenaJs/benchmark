#!/usr/bin/env bun
/**
 * Parallel sweep: every (target, scenario) is one job on its own 1-CPU / 1 GB server.
 *
 *   bun run-parallel.ts                 all targets, resumes from results-par/jobs.jsonl
 *   bun run-parallel.ts --assemble      only rebuild results/*.json from the job log
 *
 * Slot i: server on logical CPU SERVER_CPUS[i] (CCD1, SMT sibling left idle) inside a
 * systemd scope with MemoryMax=1G, wrk on one full CCD0 core. Postgres and this process
 * live on cores 0 and 8. DB jobs are capped (shared Postgres), writes run one at a time.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestsFor, type BenchRequest } from './contract/requests.ts';
import { TARGETS, type Target } from './contract/targets.ts';
import * as proc from './tools/proc.ts';
import * as db from './tools/db.ts';
import * as wrk from './tools/wrk.ts';
import * as report from './tools/markdown.ts';
import type { ScenarioResult, TargetResult } from './tools/types.ts';

const ROOT = new URL('.', import.meta.url).pathname;
const SMOKE = !!process.env.SMOKE;
const OUT = join(ROOT, 'results-par');
const LOG = join(OUT, SMOKE ? 'smoke.jsonl' : 'jobs.jsonl');

const SERVER_CPUS = [9, 10, 11, 12, 13, 14, 15];
const CLIENT_CPUS = ['1,17', '2,18', '3,19', '4,20', '5,21', '6,22', '7,23'];
const MAX_DB = 3;
const MAX_WRITE = 1;
const PROFILE: wrk.Profile = SMOKE
  ? { name: 'smoke', threads: 2, connections: 128, duration: 3, warmup: 2, writeDuration: 3 }
  : { name: '1cpu-1gb', threads: 2, connections: 128, duration: 180, warmup: 60, writeDuration: 180 };

interface JobRecord {
  target: string;
  scenario: string;
  slot: number;
  ok: boolean;
  note?: string;
  stat?: Omit<wrk.WrkResult, 'raw' | 'durationSec'>;
  meta?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
}

const done = new Map<string, JobRecord>();
if (existsSync(LOG)) {
  for (const line of readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as JobRecord;
    if (r.ok) done.set(`${r.target}/${r.scenario}`, r);
  }
}

function assemble(): void {
  const all = [...done.values()];
  for (const t of TARGETS) {
    const mine = all.filter((r) => r.target === t.id);
    if (mine.length === 0) continue;
    const scenarios: Record<string, ScenarioResult> = {};
    for (const req of requestsFor(t.app).filter((r) => r.benchmark)) {
      const j = mine.find((r) => r.scenario === req.id);
      scenarios[req.id] = j?.stat
        ? { id: req.id, scenario: req.scenario, group: req.group, status: 'ok', reps: [j.stat], median: j.stat, rpsSpread: 0 }
        : { id: req.id, scenario: req.scenario, group: req.group, status: 'failed', note: 'not measured', reps: [] };
    }
    const res: TargetResult = {
      target: t.id,
      app: t.app,
      framework: t.framework,
      runtime: t.runtime,
      runtimeVersion: runtimeVersion(t),
      dbLayer: t.dbLayer,
      validator: t.validator,
      meta: mine.find((r) => r.meta)?.meta ?? {},
      profile: PROFILE,
      reps: 1,
      startedAt: mine.map((r) => r.startedAt).sort()[0]!,
      finishedAt: mine.map((r) => r.finishedAt).sort().at(-1)!,
      scenarios,
    };
    writeFileSync(join(ROOT, 'results', `${t.id}.json`), JSON.stringify(res, null, 2) + '\n');
  }
}

function runtimeVersion(t: Target): string {
  const r = Bun.spawnSync([t.runtime === 'node' ? 'node' : 'bun', '--version']);
  return new TextDecoder().decode(r.stdout).trim().replace(/^v/, '');
}

if (process.argv.includes('--assemble')) {
  assemble();
  await report.write();
  process.exit(0);
}

// ---- jobs ----

interface Job {
  target: Target;
  req: BenchRequest;
  isDb: boolean;
}

const jobs: Job[] = [];
for (const t of TARGETS) {
  for (const req of requestsFor(t.app).filter((r) => r.benchmark)) {
    if (done.has(`${t.id}/${req.id}`)) continue;
    jobs.push({ target: t, req, isDb: req.group === 's6' });
  }
}
// DB jobs are the bottleneck resource: start them first so they never trail the sweep.
jobs.sort((a, b) => Number(b.isDb) - Number(a.isDb));
if (SMOKE) jobs.splice(0, jobs.length, ...jobs.filter((j) => j.target.app.startsWith('asena') || j.target.runtime === 'node'));

console.log(`run-parallel: ${jobs.length} job(s) left (${done.size} done) · ${SERVER_CPUS.length} slots · ` +
  `${PROFILE.warmup}s warmup + ${PROFILE.duration}s measure · 1 CPU / 1 GB per server`);

await db.ensureDatabase();
if (done.size === 0) {
  await db.reset();
  console.log('database reset');
}

for (const t of TARGETS) {
  await proc.build(t);
}
console.log('builds done');

let dbRunning = 0;
let writeRunning = 0;
const handles = new Set<proc.AppHandle>();
let aborted = false;

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    aborted = true;
    for (const h of handles) await proc.stop(h).catch(() => {});
    assemble();
    await report.write().catch(() => {});
    process.exit(130);
  });
}

function startServer(t: Target, cpu: number): proc.AppHandle {
  const cmd =
    `exec systemd-run --user --scope -q -p MemoryMax=1G -p MemorySwapMax=0 ` +
    `taskset -c ${cpu} bun run ${t.startScript}`;
  const p = Bun.spawn(['setsid', 'bash', '-c', cmd], {
    cwd: t.dir,
    env: { ...(process.env as Record<string, string>), PORT: String(t.port), NODE_ENV: 'production', DATABASE_URL: db.url(), BENCH_APP: t.app },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  return { proc: p, pgid: p.pid, target: t };
}

async function wrkRun(t: Target, r: BenchRequest, seconds: number, cpus: string): Promise<wrk.WrkResult> {
  const script = wrk.scriptFor(r);
  const args = ['taskset', '-c', cpus, 'wrk', `-t${PROFILE.threads}`, `-c${PROFILE.connections}`, `-d${seconds}s`, '--latency', '--timeout', '10s'];
  if (script) args.push('-s', script);
  args.push(`http://127.0.0.1:${t.port}${r.path}`);
  const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`wrk failed: ${err.slice(-500)}`);
  return wrk.parse(out);
}

async function runJob(job: Job, slot: number): Promise<void> {
  const t = { ...job.target, port: 21000 + slot };
  const startedAt = new Date().toISOString();
  const rec: JobRecord = { target: t.id, scenario: job.req.id, slot, ok: false, startedAt, finishedAt: '' };
  let h: proc.AppHandle | null = null;
  try {
    await proc.reapPort(t.port);
    if (job.req.isWrite) await db.truncateWrites();
    h = startServer(t, SERVER_CPUS[slot]!);
    handles.add(h);
    rec.meta = await proc.waitHealthy(t, h);
    await wrkRun(t, job.req, PROFILE.warmup, CLIENT_CPUS[slot]!);
    const res = await wrkRun(t, job.req, PROFILE.duration, CLIENT_CPUS[slot]!);
    if (!Number.isFinite(res.rps)) throw new Error('unparseable wrk output');
    if (res.non2xx > 0 || res.socketErrors > 0) throw new Error(`${res.non2xx} non-2xx, ${res.socketErrors} socket errors`);
    const { raw: _r, durationSec: _d, ...stat } = res;
    rec.stat = stat;
    rec.ok = true;
  } catch (e) {
    rec.note = (e as Error).message.slice(0, 500);
  } finally {
    if (h) {
      await proc.stop(h).catch(() => {});
      handles.delete(h);
    }
    rec.finishedAt = new Date().toISOString();
    appendFileSync(LOG, JSON.stringify(rec) + '\n');
    if (rec.ok) done.set(`${rec.target}/${rec.scenario}`, rec);
    const rps = rec.stat ? Math.round(rec.stat.rps).toLocaleString('en-US') : `✗ ${rec.note}`;
    console.log(`[${rec.finishedAt.slice(11, 19)}] slot ${slot} ${t.id.padEnd(22)} ${job.req.id.padEnd(8)} ${rps}`);
  }
}

function takeJob(): Job | undefined {
  const i = jobs.findIndex((j) => (!j.isDb || dbRunning < MAX_DB) && (!j.req.isWrite || writeRunning < MAX_WRITE));
  return i >= 0 ? jobs.splice(i, 1)[0] : undefined;
}

async function worker(slot: number): Promise<void> {
  while (!aborted && jobs.length > 0) {
    const job = takeJob();
    if (!job) {
      await Bun.sleep(1000);
      continue;
    }
    if (job.isDb) dbRunning++;
    if (job.req.isWrite) writeRunning++;
    try {
      await runJob(job, slot);
    } finally {
      if (job.isDb) dbRunning--;
      if (job.req.isWrite) writeRunning--;
    }
    await Bun.sleep(2000);
  }
}

mkdirSync(OUT, { recursive: true });
await Promise.all(SERVER_CPUS.map((_, i) => worker(i)));
if (SMOKE) process.exit(0);

assemble();
await report.write();
const failed = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JobRecord)
  .filter((r) => !r.ok && !done.has(`${r.target}/${r.scenario}`));
console.log(`\ndone · ${done.size} measured · ${failed.length} failed`);
for (const f of failed) console.log(`  ✗ ${f.target}/${f.scenario}: ${f.note}`);
