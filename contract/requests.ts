/**
 * THE CONTRACT — single source of truth for every request in the benchmark.
 *
 * conformance.ts, run-all.ts and tools/lua.ts all read this file. An app is
 * conformant when it returns `expectBody` byte-for-byte. Nothing here may be
 * changed by an app agent.
 */

export const CITIES = [
  'Istanbul', 'London', 'Paris', 'Berlin', 'Madrid',
  'Rome', 'Vienna', 'Prague', 'Lisbon', 'Dublin',
] as const;

/** The seed formula. Apps re-implement this in SQL; here it builds expected bodies. */
export function benchUser(id: number) {
  return {
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    age: 18 + (id % 50),
    city: CITIES[id % 10],
  };
}

export type Method = 'GET' | 'POST';

export interface BenchRequest {
  /** stable id, used in filenames and report tables */
  id: string;
  /** human label for the report */
  scenario: string;
  group: 's1' | 's2' | 's3' | 's4' | 's5' | 's6';
  method: Method;
  /** path including query string */
  path: string;
  headers?: Record<string, string>;
  /** exact request bytes */
  body?: string;
  expectStatus: number;
  /** exact response bytes; omitted means "not compared" */
  expectBody?: string;
  /** prefix match against the Content-Type header */
  expectContentType?: string;
  /** for binary fixtures, compared instead of expectBody */
  expectSha256?: 'fixture:index.html' | 'fixture:app.js' | 'fixture:logo.png';
  /** included in the wrk sweep (false = conformance-only) */
  benchmark: boolean;
  /** only asena-hono / asena-ergenecore serve this; others must 404 */
  asenaOnly?: boolean;
  /** inserts rows — bench_writes is truncated before every rep */
  isWrite?: boolean;
  /** response carries a generated id; compared structurally, not byte-wise */
  dynamicId?: boolean;
}

const ORDER_BODY = JSON.stringify({
  customer: { id: 77, name: 'Ada Lovelace', email: 'ada@example.com' },
  items: [
    { sku: 'SKU-1', qty: 2, priceCents: 1999 },
    { sku: 'SKU-2', qty: 1, priceCents: 550 },
    { sku: 'SKU-3', qty: 4, priceCents: 225 },
  ],
  note: 'benchmark payload',
});

const ORDER_EXPECTED = JSON.stringify({
  orderId: 1001,
  requestId: 'bench-fixed-id',
  currency: 'EUR',
  customer: { id: 77, name: 'Ada Lovelace' },
  itemCount: 3,
  totalQty: 7,
  subtotalCents: 5448,
  taxCents: 436,
  totalCents: 5884,
  lines: [
    { sku: 'SKU-1', qty: 2, lineTotalCents: 3998 },
    { sku: 'SKU-2', qty: 1, lineTotalCents: 550 },
    { sku: 'SKU-3', qty: 4, lineTotalCents: 900 },
  ],
});

const VALIDATE_BODY = JSON.stringify({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  age: 36,
  tags: ['math', 'engineering'],
  address: { city: 'London', zip: 'NW1 6XE' },
});

const VALIDATE_EXPECTED = JSON.stringify({
  ok: true,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  age: 36,
  tagCount: 2,
  city: 'London',
});

const VALIDATE_INVALID = JSON.stringify({
  name: 'A',
  email: 'not-an-email',
  age: 15,
  tags: [],
  address: { city: '', zip: 'X' },
});

const DB_WRITE_BODY = JSON.stringify({
  name: 'Bench User',
  email: 'bench@example.com',
  age: 30,
  city: 'Istanbul',
});

const USERS_PAGE_1 = JSON.stringify({
  count: 20,
  items: Array.from({ length: 20 }, (_, i) => benchUser(i + 1)),
});

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** db read/list/write, parameterised so the raw and drizzle variants stay identical */
function dbRequests(prefix: '/db' | '/db/orm', suffix: string, asenaOnly: boolean): BenchRequest[] {
  return [
    {
      id: `s6a${suffix}`,
      scenario: `db read${suffix ? ' (drizzle)' : ''}`,
      group: 's6',
      method: 'GET',
      path: `${prefix}/user/4242`,
      expectStatus: 200,
      expectBody: JSON.stringify(benchUser(4242)),
      expectContentType: 'application/json',
      benchmark: true,
      asenaOnly,
    },
    {
      id: `s6b${suffix}`,
      scenario: `db list${suffix ? ' (drizzle)' : ''}`,
      group: 's6',
      method: 'GET',
      path: `${prefix}/users?limit=20&offset=0`,
      expectStatus: 200,
      expectBody: USERS_PAGE_1,
      expectContentType: 'application/json',
      benchmark: true,
      asenaOnly,
    },
    {
      id: `s6c${suffix}`,
      scenario: `db write${suffix ? ' (drizzle)' : ''}`,
      group: 's6',
      method: 'POST',
      path: `${prefix}/user`,
      headers: JSON_HEADERS,
      body: DB_WRITE_BODY,
      expectStatus: 201,
      expectContentType: 'application/json',
      benchmark: true,
      isWrite: true,
      dynamicId: true,
      asenaOnly,
    },
    {
      id: `s6a${suffix}-404`,
      scenario: `db read miss${suffix ? ' (drizzle)' : ''}`,
      group: 's6',
      method: 'GET',
      path: `${prefix}/user/999999`,
      expectStatus: 404,
      expectBody: JSON.stringify({ error: 'not_found' }),
      benchmark: false,
      asenaOnly,
    },
  ];
}

export const REQUESTS: BenchRequest[] = [
  // ---- S1 hello world ----
  {
    id: 's1a',
    scenario: 'plaintext',
    group: 's1',
    method: 'GET',
    path: '/hello',
    expectStatus: 200,
    expectBody: 'Hello, World!',
    expectContentType: 'text/plain',
    benchmark: true,
  },
  {
    id: 's1b',
    scenario: 'json serialize',
    group: 's1',
    method: 'GET',
    path: '/json',
    expectStatus: 200,
    expectBody: JSON.stringify({ message: 'Hello, World!' }),
    expectContentType: 'application/json',
    benchmark: true,
  },

  // ---- S2 query & params ----
  {
    id: 's2a',
    scenario: 'query parse',
    group: 's2',
    method: 'GET',
    path: '/query?name=asena&page=3&size=25&sort=desc',
    expectStatus: 200,
    expectBody: JSON.stringify({ name: 'asena', page: 3, size: 25, sort: 'desc', offset: 50 }),
    expectContentType: 'application/json',
    benchmark: true,
  },
  {
    id: 's2a-defaults',
    scenario: 'query defaults',
    group: 's2',
    method: 'GET',
    path: '/query',
    expectStatus: 200,
    expectBody: JSON.stringify({ name: 'anonymous', page: 1, size: 10, sort: 'asc', offset: 0 }),
    benchmark: false,
  },
  {
    id: 's2b',
    scenario: 'path params',
    group: 's2',
    method: 'GET',
    path: '/params/42/items/7',
    expectStatus: 200,
    expectBody: JSON.stringify({ id: 42, itemId: 7, sum: 49 }),
    expectContentType: 'application/json',
    benchmark: true,
  },

  // ---- S3 comprehensive api ----
  {
    id: 's3',
    scenario: 'full api',
    group: 's3',
    method: 'POST',
    path: '/api/orders/1001/items?currency=EUR',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'bench-fixed-id',
      Authorization: 'Bearer benchmark-token',
    },
    body: ORDER_BODY,
    expectStatus: 200,
    expectBody: ORDER_EXPECTED,
    expectContentType: 'application/json',
    benchmark: true,
  },

  // ---- S4 static ----
  {
    id: 's4a',
    scenario: 'static 4KB',
    group: 's4',
    method: 'GET',
    path: '/static/index.html',
    expectStatus: 200,
    expectSha256: 'fixture:index.html',
    expectContentType: 'text/html',
    benchmark: true,
  },
  {
    id: 's4b',
    scenario: 'static 256KB',
    group: 's4',
    method: 'GET',
    path: '/static/logo.png',
    expectStatus: 200,
    expectSha256: 'fixture:logo.png',
    expectContentType: 'image/png',
    benchmark: true,
  },
  {
    id: 's4c',
    scenario: 'static 64KB',
    group: 's4',
    method: 'GET',
    path: '/static/app.js',
    expectStatus: 200,
    expectSha256: 'fixture:app.js',
    benchmark: false,
  },
  {
    id: 's4-traversal',
    scenario: 'static traversal guard',
    group: 's4',
    method: 'GET',
    path: '/static/../package.json',
    // 403 or 404; conformance accepts either, see conformance.ts
    expectStatus: 404,
    benchmark: false,
  },

  // ---- S5 validation ----
  {
    id: 's5',
    scenario: 'validation',
    group: 's5',
    method: 'POST',
    path: '/validate/user',
    headers: JSON_HEADERS,
    body: VALIDATE_BODY,
    expectStatus: 200,
    expectBody: VALIDATE_EXPECTED,
    expectContentType: 'application/json',
    benchmark: true,
  },
  {
    id: 's5-invalid',
    scenario: 'validation reject',
    group: 's5',
    method: 'POST',
    path: '/validate/user',
    headers: JSON_HEADERS,
    body: VALIDATE_INVALID,
    expectStatus: 400,
    // error body shape is validator-specific and deliberately NOT compared
    benchmark: false,
  },

  // ---- S6 database ----
  ...dbRequests('/db', '', false),
  ...dbRequests('/db/orm', '-orm', true),
];

export const BENCHMARKED = REQUESTS.filter((r) => r.benchmark);

export function requestsFor(appId: string): BenchRequest[] {
  const isAsena = appId.startsWith('asena-') || appId === 'reference';
  return REQUESTS.filter((r) => !r.asenaOnly || isAsena);
}

export function urlFor(port: number, r: BenchRequest): string {
  return `http://127.0.0.1:${port}${r.path}`;
}
