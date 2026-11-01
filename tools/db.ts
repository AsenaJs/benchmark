/**
 * Database lifecycle for the benchmark. run-all.ts calls reset() before every
 * target and truncateWrites() before every write repetition.
 */
import { SQL } from 'bun';
import { CITIES } from '../contract/requests.ts';

export const PG_HOST = process.env.PGHOST ?? 'localhost';
export const PG_PORT = Number(process.env.PGPORT ?? 5432);
export const PG_USER = process.env.PGUSER ?? 'postgres';
export const PG_PASSWORD = process.env.PGPASSWORD ?? 'postgres';
export const PG_DATABASE = process.env.PGDATABASE ?? 'benchmark';

export const SEED_ROWS = 10_000;

export function url(database = PG_DATABASE): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${database}`;
}

const CITY_LITERAL = CITIES.map((c) => `'${c}'`).join(',');

const SCHEMA = `
DROP TABLE IF EXISTS bench_users;
DROP TABLE IF EXISTS bench_writes;

CREATE TABLE bench_users (
  id    integer PRIMARY KEY,
  name  text    NOT NULL,
  email text    NOT NULL,
  age   integer NOT NULL,
  city  text    NOT NULL
);

CREATE TABLE bench_writes (
  id    integer GENERATED ALWAYS AS IDENTITY (START WITH 1) PRIMARY KEY,
  name  text    NOT NULL,
  email text    NOT NULL,
  age   integer NOT NULL,
  city  text    NOT NULL
);
`;

/** The seed formula, expressed in SQL. Must match benchUser() in contract/requests.ts. */
const SEED = `
INSERT INTO bench_users (id, name, email, age, city)
SELECT i,
       'User ' || i,
       'user' || i || '@example.com',
       18 + (i % 50),
       (ARRAY[${CITY_LITERAL}])[(i % 10) + 1]
FROM generate_series(1, ${SEED_ROWS}) AS i;
`;

/** Creates the database if missing and turns off fsync-per-commit for the write scenario. */
export async function ensureDatabase(): Promise<void> {
  const admin = new SQL({ url: url('postgres'), max: 1 });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${PG_DATABASE}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE ${PG_DATABASE}`);
    }
    // Write throughput would otherwise measure the disk, not the driver.
    await admin.unsafe(`ALTER DATABASE ${PG_DATABASE} SET synchronous_commit = off`);
  } finally {
    await admin.close();
  }
}

/** Full reset: schema recreated, 10k deterministic rows seeded, writes table empty. */
export async function reset(): Promise<void> {
  await ensureDatabase();
  const sql = new SQL({ url: url(), max: 1 });
  try {
    await sql.unsafe(SCHEMA);
    await sql.unsafe(SEED);
    await sql.unsafe('ANALYZE bench_users');
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM bench_users`;
    if (count !== SEED_ROWS) {
      throw new Error(`seed failed: expected ${SEED_ROWS} rows, got ${count}`);
    }
  } finally {
    await sql.close();
  }
}

/** Called before every write repetition so each rep starts from an empty table. */
export async function truncateWrites(): Promise<void> {
  const sql = new SQL({ url: url(), max: 1 });
  try {
    await sql.unsafe('TRUNCATE bench_writes RESTART IDENTITY');
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  const t0 = performance.now();
  await reset();
  console.log(`db: reset + ${SEED_ROWS} rows in ${Math.round(performance.now() - t0)}ms`);
}
