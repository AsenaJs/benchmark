#!/usr/bin/env bun
/**
 * Self-contained conformance check for this app. Seeds the database, starts the
 * server through its own package.json script, fires every contract request, and
 * compares the response BYTES.
 *
 *   bun verify.ts                # uses start:bun
 *   BENCH_START=start:node bun verify.ts
 *
 * Green here means the app is ready to be measured. Nothing else counts.
 */
import { SQL } from 'bun';
import { readFile } from 'node:fs/promises';
import { REQUESTS, requestsFor, CITIES, type BenchRequest } from './contract-requests.ts';

const APP = 'asena-hono';
const PORT = Number(process.env.PORT ?? 3007);
const START = process.env.BENCH_START ?? 'start:bun';
// Each app verifies against its OWN database: several builder agents iterate in
// parallel, and a shared database would have them dropping each other's tables.
const DB_NAME = process.env.BENCH_DB ?? ('bench_' + APP.replace(/-/g, '_'));
const DATABASE_URL = process.env.DATABASE_URL ?? ('postgres://postgres:postgres@localhost:5432/' + DB_NAME);

// ---------- database ----------

const CITY_LITERAL = CITIES.map((c) => "'" + c + "'").join(',');

async function seed(): Promise<void> {
  const admin = new SQL({ url: 'postgres://postgres:postgres@localhost:5432/postgres', max: 1 });
  const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
  if (rows.length === 0) await admin.unsafe('CREATE DATABASE ' + DB_NAME);
  await admin.close();

  const sql = new SQL({ url: DATABASE_URL, max: 1 });
  await sql.unsafe(`
    DROP TABLE IF EXISTS bench_users;
    DROP TABLE IF EXISTS bench_writes;
    CREATE TABLE bench_users (
      id integer PRIMARY KEY, name text NOT NULL, email text NOT NULL,
      age integer NOT NULL, city text NOT NULL);
    CREATE TABLE bench_writes (
      id integer GENERATED ALWAYS AS IDENTITY (START WITH 1) PRIMARY KEY,
      name text NOT NULL, email text NOT NULL, age integer NOT NULL, city text NOT NULL);
  `);
  await sql.unsafe(`
    INSERT INTO bench_users (id, name, email, age, city)
    SELECT i, 'User ' || i, 'user' || i || '@example.com', 18 + (i % 50),
           (ARRAY[${CITY_LITERAL}])[(i % 10) + 1]
    FROM generate_series(1, 10000) AS i;
  `);
  await sql.close();
}

// ---------- server ----------

let child: Bun.Subprocess | null = null;

async function start(): Promise<void> {
  child = Bun.spawn(['setsid', 'bash', '-c', 'exec bun run ' + START], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATABASE_URL },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited during startup (code ' + child.exitCode + ')');
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/__bench/meta', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await Bun.sleep(200);
  }
  throw new Error('server did not become healthy in 40s');
}

function stop(): void {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  child = null;
}

// ---------- checks ----------

const cut = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '… (' + s.length + ' bytes)' : s);
const failures: string[] = [];
const fail = (id: string, msg: string, exp?: string, act?: string) => {
  let line = '  ✗ ' + id + ': ' + msg;
  if (exp !== undefined) line += '\n      expected: ' + exp;
  if (act !== undefined) line += '\n      actual:   ' + act;
  failures.push(line);
};

const manifest: Record<string, { bytes: number; sha256: string }> = JSON.parse(
  await readFile(new URL('./fixtures.manifest.json', import.meta.url), 'utf8'),
);

async function check(r: BenchRequest, expectMissing: boolean): Promise<void> {
  let res: Response;
  try {
    res = await fetch('http://127.0.0.1:' + PORT + r.path, {
      method: r.method, headers: r.headers, body: r.body,
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    fail(r.id, 'request failed: ' + (e as Error).message);
    return;
  }

  if (expectMissing) {
    if (res.status !== 404) fail(r.id, 'this route belongs to the Asena apps only and must 404 here', '404', String(res.status));
    await res.arrayBuffer();
    return;
  }

  const statusOk = r.id === 's4-traversal' ? [403, 404].includes(res.status) : res.status === r.expectStatus;
  if (!statusOk) fail(r.id, 'status mismatch', r.id === 's4-traversal' ? '403 or 404' : String(r.expectStatus), String(res.status));

  if (r.expectContentType) {
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.startsWith(r.expectContentType.toLowerCase())) fail(r.id, 'content-type mismatch', r.expectContentType, ct || '(none)');
  }

  const bytes = Buffer.from(await res.arrayBuffer());

  if (r.expectSha256) {
    const m = manifest[r.expectSha256.slice('fixture:'.length)]!;
    const got = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (got !== m.sha256) fail(r.id, 'static file bytes differ', m.sha256 + ' (' + m.bytes + 'B)', got + ' (' + bytes.length + 'B)');
  } else if (r.dynamicId) {
    let o: { id?: unknown; created?: unknown };
    try { o = JSON.parse(bytes.toString('utf8')); } catch { fail(r.id, 'response is not JSON', undefined, cut(bytes.toString('utf8'))); return; }
    const keys = Object.keys(o);
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'created') fail(r.id, 'write response shape', '{"id":<int>,"created":true}', cut(bytes.toString('utf8')));
    if (!Number.isInteger(o.id) || (o.id as number) < 1) fail(r.id, 'generated id must be a positive integer', undefined, String(o.id));
    if (o.created !== true) fail(r.id, '"created" must be true', undefined, String(o.created));
  } else if (r.expectBody !== undefined) {
    const actual = bytes.toString('utf8');
    if (actual !== r.expectBody) fail(r.id, 'body bytes differ', cut(r.expectBody), cut(actual));
  }
}

// ---------- run ----------

process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

console.log('seeding database…');
await seed();
console.log('starting ' + APP + ' via "' + START + '" on :' + PORT + '…');
await start();

const mine = requestsFor(APP);
const notMine = REQUESTS.filter((r) => !mine.includes(r));

for (const r of mine) await check(r, false);
if (notMine.length) await check(notMine[0]!, true);

try {
  const meta = await (await fetch('http://127.0.0.1:' + PORT + '/__bench/meta')).json();
  if (meta.app !== APP) fail('__bench/meta', 'meta.app must be the app id', APP, String(meta.app));
} catch (e) {
  fail('__bench/meta', 'could not read meta: ' + (e as Error).message);
}

stop();

if (failures.length === 0) {
  console.log('\n✅ CONFORMANT — ' + mine.length + ' contract requests, all bytes match.');
  process.exit(0);
}
console.log('\n❌ ' + failures.length + ' FAILURE(S):\n');
console.log(failures.join('\n'));
process.exit(1);
