/**
 * wrk driver: generates the Lua scripts POST bodies need, runs wrk pinned to the
 * client cores, and parses its report into numbers.
 *
 * Latency values are normalised to milliseconds — wrk prints us/ms/s depending on
 * magnitude, and comparing a "900.00us" row against a "1.20ms" row as raw floats
 * would silently rank a fast target below a slow one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchRequest } from '../contract/requests.ts';
import type { Target } from '../contract/targets.ts';
import { CLIENT_CPUS } from './proc.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRIPT_DIR = join(ROOT, 'tools', 'wrk-scripts');

export interface Profile {
  name: string;
  threads: number;
  connections: number;
  duration: number;
  warmup: number;
  /** write scenarios are DB-bound; a 120s insert flood measures nothing extra */
  writeDuration: number;
}

export const PROFILES: Record<string, Profile> = {
  quick: { name: 'quick', threads: 8, connections: 128, duration: 15, warmup: 5, writeDuration: 10 },
  official: { name: 'official', threads: 12, connections: 400, duration: 120, warmup: 15, writeDuration: 30 },
};

export interface WrkResult {
  rps: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP90Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  totalRequests: number;
  durationSec: number;
  transferMBps: number;
  non2xx: number;
  socketErrors: number;
  raw: string;
}

function luaEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** One Lua script per non-GET request; GETs need none. */
export function scriptFor(r: BenchRequest): string | null {
  if (r.method === 'GET' && !r.headers) return null;
  mkdirSync(SCRIPT_DIR, { recursive: true });
  const path = join(SCRIPT_DIR, `${r.id}.lua`);
  const lines = [`wrk.method = "${r.method}"`];
  for (const [k, v] of Object.entries(r.headers ?? {})) {
    lines.push(`wrk.headers["${luaEscape(k)}"] = "${luaEscape(v)}"`);
  }
  if (r.body !== undefined) lines.push(`wrk.body = "${luaEscape(r.body)}"`);
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

const UNIT_MS: Record<string, number> = { us: 0.001, ms: 1, s: 1000, m: 60_000 };

function toMs(value: string): number {
  const m = /^([\d.]+)(us|ms|s|m)$/.exec(value.trim());
  if (!m) return NaN;
  return parseFloat(m[1]!) * (UNIT_MS[m[2]!] ?? 1);
}

function toMBps(value: string): number {
  const m = /^([\d.]+)(B|KB|MB|GB)$/.exec(value.trim());
  if (!m) return NaN;
  const mult: Record<string, number> = { B: 1 / 1_048_576, KB: 1 / 1024, MB: 1, GB: 1024 };
  return parseFloat(m[1]!) * (mult[m[2]!] ?? 1);
}

export function parse(out: string): WrkResult {
  const grab = (re: RegExp): string | null => re.exec(out)?.[1]?.trim() ?? null;

  const pct = (p: string): number => {
    const v = grab(new RegExp(`^\\s*${p}%\\s+([\\d.]+\\w+)`, 'm'));
    return v ? toMs(v) : NaN;
  };

  const socket = /Socket errors:\s*connect (\d+), read (\d+), write (\d+), timeout (\d+)/.exec(out);
  const latencyRow = /Latency\s+([\d.]+\w+)\s+[\d.]+\w+\s+([\d.]+\w+)/.exec(out);
  const totals = /(\d+) requests in ([\d.]+)(\w+),/.exec(out);

  return {
    rps: parseFloat(grab(/Requests\/sec:\s*([\d.]+)/) ?? 'NaN'),
    latencyAvgMs: latencyRow ? toMs(latencyRow[1]!) : NaN,
    latencyP50Ms: pct('50'),
    latencyP90Ms: pct('90'),
    latencyP99Ms: pct('99'),
    latencyMaxMs: latencyRow ? toMs(latencyRow[2]!) : NaN,
    totalRequests: totals ? Number(totals[1]) : NaN,
    durationSec: totals ? toMs(`${totals[2]}${totals[3]}`) / 1000 : NaN,
    transferMBps: toMBps(grab(/Transfer\/sec:\s*([\d.]+\w+)/) ?? 'NaN'),
    non2xx: Number(grab(/Non-2xx or 3xx responses:\s*(\d+)/) ?? 0),
    socketErrors: socket ? Number(socket[1]) + Number(socket[2]) + Number(socket[3]) + Number(socket[4]) : 0,
    raw: out,
  };
}

export async function run(
  target: Target,
  r: BenchRequest,
  profile: Profile,
  seconds: number,
  pin = true,
): Promise<WrkResult> {
  const script = scriptFor(r);
  const args = [
    'wrk',
    `-t${profile.threads}`,
    `-c${profile.connections}`,
    `-d${seconds}s`,
    '--latency',
    '--timeout', '10s',
  ];
  if (script) args.push('-s', script);
  args.push(`http://127.0.0.1:${target.port}${r.path}`);

  const cmd = pin ? ['taskset', '-c', CLIENT_CPUS, ...args] : args;
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`wrk exited ${code}: ${err.slice(-1000)}`);
  const parsed = parse(out);
  if (!Number.isFinite(parsed.rps)) throw new Error(`could not parse wrk output:\n${out}`);
  return parsed;
}
