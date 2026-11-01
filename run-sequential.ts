#!/usr/bin/env bun
/**
 * Sequential sweep: exactly one server runs at a time, on one logical CPU with a 2 GiB
 * hard memory cap, so no target ever shares the machine with another target.
 *
 *   bun run-sequential.ts               all jobs, resumes from results-seq/jobs.jsonl
 *   bun run-sequential.ts --assemble    rebuild results/*.json + REPORT.md from the job log
 *   SMOKE=1 bun run-sequential.ts       short profile, a few targets, separate log
 *
 * Every job also records a memory/CPU profile sampled from the server's own cgroup.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestsFor, type BenchRequest } from './contract/requests.ts';
import { TARGETS, type Target } from './contract/targets.ts';
import * as proc from './tools/proc.ts';
import * as db from './tools/db.ts';
import * as wrk from './tools/wrk.ts';
import * as report from './tools/markdown.ts';
import type { MemoryProfile, ScenarioResult, TargetResult } from './tools/types.ts';

const ROOT = new URL('.', import.meta.url).pathname;
const SMOKE = !!process.env.SMOKE;
const OUT = join(ROOT, 'results-seq');
const LOG = join(OUT, SMOKE ? 'smoke.jsonl' : 'jobs.jsonl');

export const SERVER_CPU = 9;
export const SERVER_IDLE_SIBLING = 25;
export const CLIENT_CPUS = '1,2,17,18';
const MEM_LIMIT = '2G';
const MEM_LIMIT_BYTES = 2 * 1024 ** 3;
const PORT = 21000;
const SAMPLE_MS = 1000;

const PROFILE: wrk.Profile = SMOKE
  ? { name: 'smoke', threads: 2, connections: 128, duration: 4, warmup: 10, writeDuration: 4 }
  : { name: 'seq-1cpu-2gb', threads: 2, connections: 128, duration: 180, warmup: 120, writeDuration: 180 };

interface JobRecord {
  target: string;
  scenario: string;
  ok: boolean;
  note?: string;
  stat?: Omit<wrk.WrkResult, 'raw' | 'durationSec'>;
  memory?: MemoryProfile;
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

function sh(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  return new TextDecoder().decode(r.stdout).trim();
}

function runtimeVersion(t: Target): string {
  return sh([t.runtime === 'node' ? 'node' : 'bun', '--version']).replace(/^v/, '');
}

function environment(): Record<string, unknown> {
  return {
    cpuModel: sh(['bash', '-c', "lscpu | sed -n 's/^Model name: *//p'"]),
    kernel: sh(['uname', '-r']),
    governor: sh(['cat', `/sys/devices/system/cpu/cpu${SERVER_CPU}/cpufreq/scaling_governor`]),
    smt: sh(['cat', '/sys/devices/system/cpu/smt/active']) === '1',
    bun: sh(['bun', '--version']),
    node: sh(['node', '--version']),
    wrk: sh(['bash', '-c', 'wrk -v 2>&1 | head -1']),
    postgres: sh(['docker', 'exec', 'postgres', 'postgres', '--version']),
    postgresCpuset: sh(['docker', 'inspect', 'postgres', '--format', '{{.HostConfig.CpusetCpus}}']),
    serverCpu: SERVER_CPU,
    serverIdleSibling: SERVER_IDLE_SIBLING,
    clientCpus: CLIENT_CPUS,
    serverLimits: `systemd scope: MemoryMax=${MEM_LIMIT}, MemorySwapMax=0, taskset 1 logical CPU`,
    wrkCommand: `taskset -c ${CLIENT_CPUS} wrk -t${PROFILE.threads} -c${PROFILE.connections} -d<N>s --latency --timeout 10s`,
    sampleIntervalMs: SAMPLE_MS,
  };
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
        ? { id: req.id, scenario: req.scenario, group: req.group, status: 'ok', reps: [j.stat], median: j.stat, rpsSpread: 0, memory: j.memory }
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
      meta: { ...(mine.find((r) => r.meta)?.meta ?? {}), environment: readEnv() },
      profile: PROFILE,
      reps: 1,
      startedAt: mine.map((r) => r.startedAt).sort()[0]!,
      finishedAt: mine.map((r) => r.finishedAt).sort().at(-1)!,
      scenarios,
    };
    writeFileSync(join(ROOT, 'results', `${t.id}.json`), JSON.stringify(res, null, 2) + '\n');
  }
}

const ENV_FILE = join(OUT, SMOKE ? 'smoke-environment.json' : 'environment.json');
function readEnv(): Record<string, unknown> {
  return existsSync(ENV_FILE) ? JSON.parse(readFileSync(ENV_FILE, 'utf8')) : {};
}

if (process.argv.includes('--assemble')) {
  assemble();
  await report.write();
  process.exit(0);
}

// ---- cgroup sampling ----

function readNum(path: string): number {
  try {
    return Number(readFileSync(path, 'utf8').trim());
  } catch {
    return NaN;
  }
}

function readKV(path: string): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const [k, v] = line.split(' ');
      if (k && v !== undefined) out[k] = Number(v);
    }
  } catch {
    /* scope gone */
  }
  return out;
}

function rssOf(pid: number): number {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) * 1024 : NaN;
  } catch {
    return NaN;
  }
}

function listenerPid(port: number): number {
  const m = /pid=(\d+)/.exec(sh(['ss', '-Hltnp', `sport = :${port}`]));
  return m ? Number(m[1]) : NaN;
}

async function cgroupDir(unit: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const cg = sh(['systemctl', '--user', 'show', '-P', 'ControlGroup', `${unit}.scope`]);
    if (cg) return `/sys/fs/cgroup${cg}`;
    await Bun.sleep(100);
  }
  throw new Error(`cgroup for ${unit} not found`);
}

interface Snapshot {
  rss: number;
  cgroup: number;
  anon: number;
  file: number;
  cpuUsec: number;
}

function snapshot(cg: string, pid: number): Snapshot {
  const stat = readKV(`${cg}/memory.stat`);
  return {
    rss: rssOf(pid),
    cgroup: readNum(`${cg}/memory.current`),
    anon: stat.anon ?? NaN,
    file: stat.file ?? NaN,
    cpuUsec: readKV(`${cg}/cpu.stat`).usage_usec ?? NaN,
  };
}

class Sampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly rss: number[] = [];
  readonly cgroup: number[] = [];
  readonly anon: number[] = [];
  constructor(private cg: string, private pid: number) {}
  start(): void {
    this.timer = setInterval(() => {
      const s = snapshot(this.cg, this.pid);
      if (Number.isFinite(s.rss)) this.rss.push(s.rss);
      if (Number.isFinite(s.cgroup)) this.cgroup.push(s.cgroup);
      if (Number.isFinite(s.anon)) this.anon.push(s.anon);
    }, SAMPLE_MS);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

function coreTicks(): number[] {
  const line = readFileSync('/proc/stat', 'utf8').split('\n').find((l) => l.startsWith(`cpu${SERVER_CPU} `))!;
  return line.split(/\s+/).slice(1, 9).map(Number);
}

/** Loopback TCP work runs in softirq on the server core and is not charged to the cgroup. */
function coreBusy(a: number[], b: number[]): { busy: number; softirq: number } {
  const d = b.map((v, i) => v - a[i]!);
  const total = d.reduce((s, v) => s + v, 0);
  const r = (v: number) => Math.round((v / total) * 1000) / 1000;
  return { busy: r(total - d[3]! - d[4]!), softirq: r(d[6]!) };
}

const MB = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);

// ---- targets: one server process per target, warmed once, then every scenario ----

interface Plan {
  target: Target;
  reqs: BenchRequest[];
}

let plans: Plan[] = TARGETS.map((target) => ({
  target,
  reqs: requestsFor(target.app).filter((r) => r.benchmark && !done.has(`${target.id}/${r.id}`)),
})).filter((p) => p.reqs.length > 0);
if (SMOKE) plans = plans.filter((p) => p.target.id === 'hono-bun' || p.target.id === 'nest-express-node');

mkdirSync(OUT, { recursive: true });
if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, JSON.stringify(environment(), null, 2) + '\n');

const jobCount = plans.reduce((n, p) => n + p.reqs.length, 0);
const etaSec = plans.length * (PROFILE.warmup + 15) + jobCount * (PROFILE.duration + 3);
console.log(
  `run-sequential: ${plans.length} target(s), ${jobCount} scenario(s) left (${done.size} done) · ` +
    `${PROFILE.warmup}s warmup once per server + ${PROFILE.duration}s per scenario · server cpu ${SERVER_CPU}, ${MEM_LIMIT} · ` +
    `ETA ~${(etaSec / 3600).toFixed(1)} h (${new Date(Date.now() + etaSec * 1000).toLocaleTimeString('tr-TR')})`,
);

await db.ensureDatabase();
if (done.size === 0) {
  await db.reset();
  console.log('database reset');
}
for (const t of TARGETS) await proc.build(t);
console.log('builds done');

let current: proc.AppHandle | null = null;
let aborted = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    aborted = true;
    Bun.spawnSync(['pkill', '-x', 'wrk']);
    if (current) await proc.stop(current).catch(() => {});
    if (!SMOKE) {
      assemble();
      await report.write().catch(() => {});
    }
    process.exit(130);
  });
}

function startServer(t: Target, unit: string): proc.AppHandle {
  const cmd =
    `exec systemd-run --user --scope -q --unit=${unit} -p MemoryMax=${MEM_LIMIT} -p MemorySwapMax=0 ` +
    `taskset -c ${SERVER_CPU} bun run ${t.startScript}`;
  const p = Bun.spawn(['setsid', 'bash', '-c', cmd], {
    cwd: t.dir,
    env: { ...(process.env as Record<string, string>), PORT: String(t.port), NODE_ENV: 'production', DATABASE_URL: db.url(), BENCH_APP: t.app },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  return { proc: p, pgid: p.pid, target: t };
}

async function wrkRun(t: Target, r: BenchRequest, seconds: number): Promise<wrk.WrkResult> {
  const script = wrk.scriptFor(r);
  const args = ['taskset', '-c', CLIENT_CPUS, 'wrk', `-t${PROFILE.threads}`, `-c${PROFILE.connections}`, `-d${seconds}s`, '--latency', '--timeout', '10s'];
  if (script) args.push('-s', script);
  args.push(`http://127.0.0.1:${t.port}${r.path}`);
  const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`wrk failed: ${err.slice(-500)}`);
  return wrk.parse(out);
}

interface Server {
  h: proc.AppHandle;
  cg: string;
  pid: number;
  meta: Record<string, unknown>;
  startupMs: number;
  idle: Snapshot;
  afterWarmup: Snapshot;
}

/** Warm-up cycles through every scenario so each route is JIT-warm before any measurement. */
async function bringUp(t: Target, reqs: BenchRequest[], warmupSec: number): Promise<Server> {
  await proc.reapPort(t.port);
  const unit = `bench-${t.id}-${Date.now()}`;
  const t0 = performance.now();
  const h = startServer(t, unit);
  current = h;
  const meta = await proc.waitHealthy(t, h);
  const startupMs = Math.round(performance.now() - t0);
  const cg = await cgroupDir(unit);
  const limit = readNum(`${cg}/memory.max`);
  const swap = readNum(`${cg}/memory.swap.max`);
  if (limit !== MEM_LIMIT_BYTES || swap !== 0) throw new Error(`cgroup limits not applied (memory.max=${limit}, swap.max=${swap})`);
  const pid = listenerPid(t.port);
  if (!Number.isFinite(pid)) throw new Error('listener pid not found');
  await Bun.sleep(2000);
  const idle = snapshot(cg, pid);
  const slice = Math.max(5, Math.round(warmupSec / reqs.length));
  for (const r of reqs) await wrkRun(t, r, slice).catch(() => {});
  return { h, cg, pid, meta, startupMs, idle, afterWarmup: snapshot(cg, pid) };
}

function alive(s: Server): boolean {
  return s.h.proc.exitCode === null && Number.isFinite(rssOf(s.pid));
}

async function measure(t: Target, s: Server, r: BenchRequest): Promise<void> {
  const rec: JobRecord = { target: t.id, scenario: r.id, ok: false, startedAt: new Date().toISOString(), finishedAt: '', meta: s.meta };
  const sampler = new Sampler(s.cg, s.pid);
  try {
    if (r.isWrite) await db.truncateWrites();
    const before = snapshot(s.cg, s.pid);
    const oomBefore = readKV(`${s.cg}/memory.events`).oom_kill ?? 0;
    sampler.start();
    const seconds = r.isWrite ? PROFILE.writeDuration : PROFILE.duration;
    const ticks0 = coreTicks();
    const res = await wrkRun(t, r, seconds);
    const core = coreBusy(ticks0, coreTicks());
    sampler.stop();
    const end = snapshot(s.cg, s.pid);
    const events = readKV(`${s.cg}/memory.events`);
    rec.memory = {
      startupMs: s.startupMs,
      listenerPid: s.pid,
      rssIdleMB: MB(s.idle.rss),
      rssAfterWarmupMB: MB(s.afterWarmup.rss),
      rssBeforeMB: MB(before.rss),
      rssAvgMB: MB(avg(sampler.rss)),
      rssPeakMB: MB(max(sampler.rss)),
      rssEndMB: MB(end.rss),
      cgroupIdleMB: MB(s.idle.cgroup),
      cgroupPeakMB: MB(max(sampler.cgroup)),
      cgroupAvgMB: MB(avg(sampler.cgroup)),
      anonAvgMB: MB(avg(sampler.anon)),
      anonPeakMB: MB(max(sampler.anon)),
      fileEndMB: MB(end.file),
      cpuUtilMeasure: Math.round(((end.cpuUsec - before.cpuUsec) / 1e6 / seconds) * 1000) / 1000,
      coreBusyMeasure: core.busy,
      coreSoftirqMeasure: core.softirq,
      oomKill: (events.oom_kill ?? 0) - oomBefore,
      memoryHighEvents: events.high ?? 0,
      samples: sampler.rss.length,
    };
    if (rec.memory.oomKill > 0) throw new Error(`OOM killed under the ${MEM_LIMIT} cap (${rec.memory.oomKill}x)`);
    if (!alive(s)) throw new Error('server process died during measurement');
    if (!Number.isFinite(res.rps)) throw new Error('unparseable wrk output');
    if (res.non2xx > 0 || res.socketErrors > 0) throw new Error(`${res.non2xx} non-2xx, ${res.socketErrors} socket errors`);
    const { raw: _r, durationSec: _d, ...stat } = res;
    rec.stat = stat;
    rec.ok = true;
  } catch (e) {
    rec.note = (e as Error).message.slice(0, 500);
  } finally {
    sampler.stop();
    rec.finishedAt = new Date().toISOString();
    appendFileSync(LOG, JSON.stringify(rec) + '\n');
    if (rec.ok) done.set(`${rec.target}/${rec.scenario}`, rec);
    const rps = rec.stat ? Math.round(rec.stat.rps).toLocaleString('en-US') : `✗ ${rec.note}`;
    const m = rec.memory;
    const mem = m ? ` · rss ${m.rssBeforeMB}→${m.rssPeakMB} MB · core ${m.coreBusyMeasure} (proc ${m.cpuUtilMeasure})` : '';
    console.log(`[${rec.finishedAt.slice(11, 19)}] ${t.id.padEnd(22)} ${r.id.padEnd(5)} ${rps}${mem}`);
  }
}

for (const plan of plans) {
  if (aborted) break;
  const t = { ...plan.target, port: PORT };
  let s: Server | null = null;
  try {
    s = await bringUp(t, plan.reqs, PROFILE.warmup);
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${t.id} up in ${s.startupMs} ms · rss idle ${MB(s.idle.rss)} MB → after warm-up ${MB(s.afterWarmup.rss)} MB`);
    for (const r of plan.reqs) {
      if (aborted) break;
      if (!alive(s)) {
        console.log(`  ${t.id} died, restarting with a 30s re-warm`);
        await proc.stop(s.h).catch(() => {});
        s = await bringUp(t, plan.reqs, 30);
      }
      await measure(t, s, r);
      await Bun.sleep(2000);
    }
  } catch (e) {
    console.log(`  ✗ ${t.id}: ${(e as Error).message.slice(0, 300)}`);
  } finally {
    if (s) await proc.stop(s.h).catch(() => {});
    current = null;
  }
}
if (SMOKE) process.exit(0);

assemble();
await report.write();
const failed = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JobRecord)
  .filter((r) => !r.ok && !done.has(`${r.target}/${r.scenario}`));
console.log(`\ndone · ${done.size} measured · ${failed.length} failed`);
for (const f of failed) console.log(`  ✗ ${f.target}/${f.scenario}: ${f.note}`);

