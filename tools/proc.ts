/**
 * Process lifecycle for benchmark targets.
 *
 * Every server is started under `setsid` and killed by process GROUP: `bun run start`
 * spawns a grandchild, and signalling only the parent leaves the real listener holding
 * the port — the next target then dies with EADDRINUSE halfway through a sweep.
 */
import type { Target } from '../contract/targets.ts';
import { url as pgUrl } from './db.ts';

export const SERVER_CPUS = process.env.BENCH_SERVER_CPUS ?? '0-7';
export const CLIENT_CPUS = process.env.BENCH_CLIENT_CPUS ?? '16-31';

export interface AppHandle {
  proc: Bun.Subprocess;
  pgid: number;
  target: Target;
}

function envFor(target: Target): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PORT: String(target.port),
    NODE_ENV: 'production',
    DATABASE_URL: pgUrl(),
    BENCH_APP: target.app,
  };
}

export async function build(target: Target): Promise<void> {
  if (!target.buildScript) return;
  const proc = Bun.spawn(['bun', 'run', target.buildScript], {
    cwd: target.dir,
    env: envFor(target),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr as ReadableStream).text();
    throw new Error(`build failed for ${target.id} (exit ${code})\n${err.slice(-2000)}`);
  }
}

export async function start(target: Target, pin = true): Promise<AppHandle> {
  const runner = target.runtime === 'node' ? 'bun' : 'bun'; // scripts pick the runtime themselves
  const inner = `${runner} run ${target.startScript}`;
  const cmd = pin ? `exec taskset -c ${SERVER_CPUS} ${inner}` : `exec ${inner}`;
  const proc = Bun.spawn(['setsid', 'bash', '-c', cmd], {
    cwd: target.dir,
    env: envFor(target),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { proc, pgid: proc.pid, target };
}

export async function waitHealthy(target: Target, handle: AppHandle, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (handle.proc.exitCode !== null) {
      const err = await new Response(handle.proc.stderr as ReadableStream).text();
      throw new Error(`${target.id} exited during startup (code ${handle.proc.exitCode})\n${err.slice(-2000)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${target.port}/__bench/meta`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return (await res.json()) as Record<string, unknown>;
      lastErr = `meta returned ${res.status}`;
    } catch (e) {
      lastErr = String((e as Error).message ?? e);
    }
    await Bun.sleep(150);
  }
  throw new Error(`${target.id} did not become healthy in ${timeoutMs}ms (${lastErr})`);
}

export async function stop(handle: AppHandle): Promise<void> {
  try {
    process.kill(-handle.pgid, 'SIGTERM');
  } catch {
    /* group already gone */
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && handle.proc.exitCode === null) await Bun.sleep(50);
  if (handle.proc.exitCode === null) {
    try {
      process.kill(-handle.pgid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  await waitPortFree(handle.target.port);
}

export async function waitPortFree(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return;
    await Bun.sleep(100);
  }
  throw new Error(`port ${port} is still held after ${timeoutMs}ms`);
}

export async function portInUse(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port,
      socket: { data() {} },
    });
    server.stop(true);
    return false;
  } catch {
    return true;
  }
}

/** Belt and braces for a sweep that was killed mid-run and left a listener behind. */
export async function reapPort(port: number): Promise<void> {
  if (!(await portInUse(port))) return;
  Bun.spawnSync(['bash', '-c', `fuser -k ${port}/tcp 2>/dev/null || true`]);
  await Bun.sleep(300);
}
