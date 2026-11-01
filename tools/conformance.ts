/**
 * The trust anchor. Until an app returns every contract response byte-for-byte,
 * its throughput numbers are meaningless — so run-all.ts refuses to measure a
 * target that is not green here.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REQUESTS, requestsFor, urlFor, type BenchRequest } from '../contract/requests.ts';
import { resolveTargets, ALL_TARGETS, type Target } from '../contract/targets.ts';
import * as proc from './proc.ts';
import * as db from './db.ts';

const ROOT = new URL('..', import.meta.url).pathname;

export interface Failure {
  request: string;
  reason: string;
  expected?: string;
  actual?: string;
}

export interface ConformanceResult {
  target: string;
  ok: boolean;
  checked: number;
  failures: Failure[];
  meta?: Record<string, unknown>;
}

let manifestCache: Record<string, { bytes: number; sha256: string }> | null = null;
async function manifest() {
  manifestCache ??= JSON.parse(await readFile(join(ROOT, 'contract/fixtures.manifest.json'), 'utf8'));
  return manifestCache!;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}… (${s.length} bytes)` : s;
}

async function checkOne(target: Target, r: BenchRequest, expectMissing: boolean): Promise<Failure[]> {
  const failures: Failure[] = [];
  let res: Response;
  try {
    res = await fetch(urlFor(target.port, r), {
      method: r.method,
      headers: r.headers,
      body: r.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return [{ request: r.id, reason: `request failed: ${(e as Error).message}` }];
  }

  // Non-Asena apps must not serve /db/orm/* at all.
  if (expectMissing) {
    if (res.status !== 404) {
      failures.push({ request: r.id, reason: `asena-only route must 404 here`, expected: '404', actual: String(res.status) });
    }
    await res.arrayBuffer();
    return failures;
  }

  // The traversal guard may legitimately answer 403 or 404.
  const okStatus = r.id === 's4-traversal' ? [403, 404].includes(res.status) : res.status === r.expectStatus;
  if (!okStatus) {
    failures.push({
      request: r.id,
      reason: 'status mismatch',
      expected: r.id === 's4-traversal' ? '403 or 404' : String(r.expectStatus),
      actual: String(res.status),
    });
  }

  if (r.expectContentType) {
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    // app.js is served as text/javascript by some, application/javascript by others
    if (!ct.startsWith(r.expectContentType.toLowerCase())) {
      failures.push({ request: r.id, reason: 'content-type mismatch', expected: r.expectContentType, actual: ct || '(none)' });
    }
  }

  const bytes = Buffer.from(await res.arrayBuffer());

  if (r.expectSha256) {
    const name = r.expectSha256.slice('fixture:'.length);
    const m = (await manifest())[name]!;
    const got = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (got !== m.sha256) {
      failures.push({ request: r.id, reason: `static fixture bytes differ`, expected: `${m.sha256} (${m.bytes}B)`, actual: `${got} (${bytes.length}B)` });
    }
  } else if (r.dynamicId) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      failures.push({ request: r.id, reason: 'response is not JSON', actual: truncate(bytes.toString('utf8')) });
      return failures;
    }
    const o = parsed as { id?: unknown; created?: unknown };
    const keys = Object.keys(o as object);
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'created') {
      failures.push({ request: r.id, reason: 'write response shape', expected: '{"id":<int>,"created":true}', actual: truncate(bytes.toString('utf8')) });
    }
    if (!Number.isInteger(o.id) || (o.id as number) < 1) {
      failures.push({ request: r.id, reason: 'generated id must be a positive integer', actual: String(o.id) });
    }
    if (o.created !== true) {
      failures.push({ request: r.id, reason: '"created" must be true', actual: String(o.created) });
    }
  } else if (r.expectBody !== undefined) {
    const actual = bytes.toString('utf8');
    if (actual !== r.expectBody) {
      failures.push({ request: r.id, reason: 'body bytes differ', expected: truncate(r.expectBody), actual: truncate(actual) });
    }
  }

  return failures;
}

/** Fires the whole contract at an already-running server. */
export async function checkRunning(target: Target, meta?: Record<string, unknown>): Promise<ConformanceResult> {
  const mine = requestsFor(target.app);
  const notMine = REQUESTS.filter((r) => !mine.includes(r));
  const failures: Failure[] = [];

  for (const r of mine) failures.push(...(await checkOne(target, r, false)));
  // only probe one absent route; hammering all four adds nothing
  if (notMine.length) failures.push(...(await checkOne(target, notMine[0]!, true)));

  if (meta && meta.app !== target.app) {
    failures.push({ request: '__bench/meta', reason: 'meta.app mismatch', expected: target.app, actual: String(meta.app) });
  }

  return { target: target.id, ok: failures.length === 0, checked: mine.length + (notMine.length ? 1 : 0), failures, meta };
}

/** Builds, starts, checks and stops a target. Used by the CLI and by run-all.ts. */
export async function checkTarget(target: Target): Promise<ConformanceResult> {
  await proc.reapPort(target.port);
  await proc.build(target);
  const handle = await proc.start(target);
  try {
    const meta = await proc.waitHealthy(target, handle);
    return await checkRunning(target, meta);
  } finally {
    await proc.stop(handle);
  }
}

function printResult(r: ConformanceResult): void {
  if (r.ok) {
    console.log(`  ✅ ${r.target.padEnd(24)} ${r.checked} requests`);
    return;
  }
  console.log(`  ❌ ${r.target.padEnd(24)} ${r.failures.length} failure(s)`);
  for (const f of r.failures) {
    console.log(`     · ${f.request}: ${f.reason}`);
    if (f.expected !== undefined) console.log(`       expected: ${f.expected}`);
    if (f.actual !== undefined) console.log(`       actual:   ${f.actual}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--app');
  const only = idx >= 0 ? args[idx + 1]!.split(',') : undefined;
  const targets = only ? ALL_TARGETS.filter((t) => only.includes(t.app) || only.includes(t.id)) : resolveTargets();
  // one runtime per app is enough — conformance is about bytes, not speed
  const seen = new Set<string>();
  const unique = targets.filter((t) => (seen.has(t.app) ? false : (seen.add(t.app), true)));

  if (unique.length === 0) {
    console.error('conformance: no targets matched');
    process.exit(1);
  }

  await db.reset();
  console.log(`conformance: ${unique.length} app(s)\n`);
  const results: ConformanceResult[] = [];
  for (const t of unique) {
    try {
      const r = await checkTarget(t);
      results.push(r);
      printResult(r);
    } catch (e) {
      const r: ConformanceResult = { target: t.id, ok: false, checked: 0, failures: [{ request: '(startup)', reason: (e as Error).message }] };
      results.push(r);
      printResult(r);
    }
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} green`);
  process.exit(bad.length ? 1 : 0);
}
