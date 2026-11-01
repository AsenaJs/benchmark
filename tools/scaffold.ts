/**
 * Builds the per-app work packet.
 *
 * A GLM builder agent is confined to its own apps/<id>/ directory (external_directory
 * is denied), so everything it needs must live inside that directory: the contract
 * data, a working reference implementation, the static fixtures, and a self-contained
 * verifier it can run in a loop until green.
 */
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

interface AppBrief {
  app: string;
  framework: string;
  port: number;
  runtimes: string[];
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
  dbLayer: string;
  validator: string;
  notes: string[];
}

const BRIEFS: AppBrief[] = [
  {
    app: 'express',
    framework: 'Express 5',
    port: 3001,
    runtimes: ['node', 'bun'],
    deps: { express: '5.2.1', zod: '4.4.3', pg: '8.23.0' },
    devDeps: { '@types/express': 'latest', '@types/node': 'latest', '@types/pg': 'latest', typescript: '5.9.3' },
    scripts: { build: 'tsc -p tsconfig.json', 'start:node': 'node dist/main.js', 'start:bun': 'bun dist/main.js' },
    dbLayer: 'pg (node-postgres Pool, raw SQL)',
    validator: 'zod 4',
    notes: [
      'MUST call `app.disable("x-powered-by")` and `app.set("etag", false)` — ETag hashing is CPU work no other framework in this benchmark does.',
      'Use `express.json()` only on the routes that need a body, not globally, so GET routes do not pay for it.',
      'Static: `express.static(publicDir, { etag: false, lastModified: false })` mounted at `/static`.',
      'DB: a single `pg.Pool({ max: 20 })` created once at module scope. Never per request.',
      'Express 5 changed the wildcard syntax: use `/static` mount + `app.use`, and `/{*splat}` style params if you need a catch-all.',
    ],
  },
  {
    app: 'fastify',
    framework: 'Fastify 5',
    port: 3002,
    runtimes: ['node', 'bun'],
    deps: { fastify: '5.12.1', '@fastify/static': 'latest', pg: '8.23.0' },
    devDeps: { '@types/node': 'latest', '@types/pg': 'latest', typescript: '5.9.3' },
    scripts: { build: 'tsc -p tsconfig.json', 'start:node': 'node dist/main.js', 'start:bun': 'bun dist/main.js' },
    dbLayer: 'pg (node-postgres Pool, raw SQL)',
    validator: "Fastify's built-in JSON Schema validation (ajv) — NOT zod",
    notes: [
      'Create the server with `Fastify({ logger: false })`.',
      'Validation MUST use the route `schema: { body: {...} }` option so ajv does it — that is Fastify\'s native path and the thing being measured.',
      'ajv strips unknown keys only with `removeAdditional: "all"` in the ajv options; set it so the contract\'s "unknown keys are stripped" rule holds.',
      'A failed schema validation returns 400 automatically. Do not add a custom error handler that changes the status.',
      'Static: `@fastify/static` with `prefix: "/static/"`, `etag: false`, `lastModified: false`.',
      'DB: a single `pg.Pool({ max: 20 })` at module scope.',
    ],
  },
  {
    app: 'nest-express',
    framework: 'NestJS 11 on Express',
    port: 3003,
    runtimes: ['node', 'bun'],
    deps: {
      '@nestjs/common': '11.2.1', '@nestjs/core': '11.2.1', '@nestjs/platform-express': '11.2.1',
      '@nestjs/typeorm': 'latest', typeorm: '1.1.0', pg: '8.23.0',
      'class-validator': '0.15.1', 'class-transformer': 'latest',
      'reflect-metadata': '0.2.2', rxjs: 'latest',
    },
    devDeps: { '@types/node': 'latest', '@types/express': 'latest', typescript: '5.9.3' },
    scripts: { build: 'tsc -p tsconfig.json', 'start:node': 'node dist/main.js', 'start:bun': 'bun dist/main.js' },
    dbLayer: 'TypeORM 1.x over postgres',
    validator: 'class-validator + ValidationPipe',
    notes: [
      'Bootstrap with `NestFactory.create(AppModule, { logger: false })`.',
      'Disable Express extras on the underlying instance: `app.getHttpAdapter().getInstance().disable("x-powered-by")` and `.set("etag", false)`.',
      'Validation: a global-free, route-level `ValidationPipe({ whitelist: true, transform: true })` on /validate/user only. `whitelist: true` implements the contract\'s "unknown keys stripped" rule.',
      'TypeORM: `TypeOrmModule.forRoot({ type: "postgres", url: process.env.DATABASE_URL, synchronize: false, logging: false, poolSize: 20, entities: [BenchUser, BenchWrite] })`. NEVER set synchronize:true — the schema is owned by the harness.',
      'Entity table names are exactly `bench_users` and `bench_writes`. `bench_writes.id` is GENERATED ALWAYS AS IDENTITY, so mark it `@PrimaryGeneratedColumn("identity", { generatedIdentity: "ALWAYS" })` or equivalent for your TypeORM version.',
      'Static: `@nestjs/serve-static` is NOT allowed (extra dependency and it wraps a different server). Use `app.useStaticAssets(publicDir, { prefix: "/static/", etag: false, lastModified: false })` from platform-express.',
      'requires `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig, and `import "reflect-metadata"` as the first line of main.ts.',
    ],
  },
  {
    app: 'nest-fastify',
    framework: 'NestJS 11 on Fastify',
    port: 3004,
    runtimes: ['node', 'bun'],
    deps: {
      '@nestjs/common': '11.2.1', '@nestjs/core': '11.2.1', '@nestjs/platform-fastify': '11.2.1',
      '@nestjs/typeorm': 'latest', typeorm: '1.1.0', pg: '8.23.0',
      'class-validator': '0.15.1', 'class-transformer': 'latest',
      'reflect-metadata': '0.2.2', rxjs: 'latest',
    },
    devDeps: { '@types/node': 'latest', typescript: '5.9.3' },
    scripts: { build: 'tsc -p tsconfig.json', 'start:node': 'node dist/main.js', 'start:bun': 'bun dist/main.js' },
    dbLayer: 'TypeORM 1.x over postgres',
    validator: 'class-validator + ValidationPipe',
    notes: [
      'Bootstrap with `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false })`.',
      'MUST call `await app.listen(port, "0.0.0.0")` — the Fastify adapter binds to localhost only by default.',
      'Validation: route-level `ValidationPipe({ whitelist: true, transform: true })` on /validate/user. Keep class-validator, do NOT switch to Fastify JSON Schema — this app measures the Nest validation path.',
      'Static: `app.useStaticAssets({ root: publicDir, prefix: "/static/", etag: false, lastModified: false })` (the platform-fastify signature takes an options object, unlike platform-express).',
      'TypeORM config identical to nest-express. synchronize MUST stay false.',
      'requires `experimentalDecorators` + `emitDecoratorMetadata` and `import "reflect-metadata"` first in main.ts.',
    ],
  },
  {
    app: 'elysia',
    framework: 'Elysia 1.4',
    port: 3005,
    runtimes: ['bun'],
    deps: { elysia: '1.4.29', '@elysiajs/static': 'latest' },
    devDeps: { '@types/bun': 'latest', typescript: '5.9.3' },
    scripts: { 'start:bun': 'bun src/index.ts' },
    dbLayer: "Bun's native SQL (`new SQL(...)` from `bun`) — raw SQL, NOT an ORM",
    validator: "Elysia's own TypeBox validation (`t.Object`) — NOT zod",
    notes: [
      'Validation MUST use Elysia\'s `body: t.Object({...})` schema on the route. That is the native path being measured.',
      'TypeBox strips unknown keys by default in Elysia; keep that behaviour.',
      'A failed `t.Object` validation returns 422 by default in Elysia — the contract requires **400**. Add `.onError` mapping `VALIDATION` to status 400, or set the route `error` handler. Verify with `bun verify.ts`.',
      'Static: `@elysiajs/static` with `prefix: "/static"`, `assets: publicDir`.',
      'DB: `import { SQL } from "bun"` and one `new SQL({ url: process.env.DATABASE_URL, max: 20 })` at module scope.',
      'Elysia returns objects as JSON automatically; make sure the key order in the object literal matches the contract exactly.',
    ],
  },
  {
    app: 'hono',
    framework: 'Hono 4',
    port: 3006,
    runtimes: ['bun'],
    deps: { hono: '4.13.3', '@hono/zod-validator': 'latest', zod: '4.4.3' },
    devDeps: { '@types/bun': 'latest', typescript: '5.9.3' },
    scripts: { 'start:bun': 'bun src/index.ts' },
    dbLayer: "Bun's native SQL (`new SQL(...)` from `bun`) — raw SQL, NOT an ORM",
    validator: '@hono/zod-validator + zod 4',
    notes: [
      'Export `default { port, fetch: app.fetch }` or use `Bun.serve({ port, fetch: app.fetch })`. Bind hostname "0.0.0.0".',
      'Validation: `zValidator("json", schema)` middleware. Its default failure status is 400 — good, that matches the contract. Use `.strip()` semantics so unknown keys are removed (zod strips by default on `z.object`).',
      'Static: `serveStatic` from `hono/bun` with `root: "./public"` mounted so `/static/index.html` maps to `public/index.html`. Watch the `rewriteRequestPath` option — get the mapping right and verify with `bun verify.ts`.',
      'DB: `import { SQL } from "bun"`, one `new SQL({ url: process.env.DATABASE_URL, max: 20 })` at module scope.',
      'Use `c.json(obj)` for JSON and `c.text()` for /hello.',
    ],
  },
  {
    app: 'asena-hono',
    framework: 'Asena + hono-adapter',
    port: 3007,
    runtimes: ['bun'],
    deps: {
      '@asenajs/asena': '0.10.2', '@asenajs/hono-adapter': '3.2.0',
      '@asenajs/asena-drizzle': '3.0.0', 'drizzle-orm': '0.45.2',
      hono: '4.13.3', zod: '4.4.3', 'reflect-metadata': '0.2.2',
    },
    devDeps: { '@types/bun': 'latest', typescript: '5.9.3' },
    scripts: { build: 'asena build', 'start:bun': 'bun src/index.ts' },
    dbLayer: 'Bun.sql raw (/db/*) + drizzle (/db/orm/*)',
    validator: 'ValidationService + zod 4',
    notes: [],
  },
  {
    app: 'asena-ergenecore',
    framework: 'Asena + ergenecore',
    port: 3008,
    runtimes: ['bun'],
    deps: {
      '@asenajs/asena': '0.10.2', '@asenajs/ergenecore': '3.2.1',
      '@asenajs/asena-drizzle': '3.0.0', 'drizzle-orm': '0.45.2',
      zod: '4.4.3', 'reflect-metadata': '0.2.2',
    },
    devDeps: { '@types/bun': 'latest', typescript: '5.9.3' },
    scripts: { build: 'asena build', 'start:bun': 'bun src/index.ts' },
    dbLayer: 'Bun.sql raw (/db/*) + drizzle (/db/orm/*)',
    validator: 'ValidationService + zod 4',
    notes: [],
  },
];

const VERIFY_TEMPLATE = await readFile(join(ROOT, 'tools/templates/verify.ts.tpl'), 'utf8');

function taskMd(b: AppBrief): string {
  return `# Work packet: \`${b.app}\` — ${b.framework}

You are building ONE benchmark application. Everything you need is in this directory.

## What this is

Eight web frameworks are being benchmarked against each other for the AsenaJS project.
For the comparison to mean anything, **every app must return byte-for-byte identical
responses to the same requests**. Your app is one of the eight. Other agents are
building the others right now, against the same contract.

## The rules

1. **The contract is READ-ONLY.** \`contract-requests.ts\` defines every endpoint, every
   request and every expected response byte. Do not change it. Do not invent endpoints,
   rename fields, change a status code, or "improve" a response shape. If something in
   the contract seems impossible in ${b.framework}, STOP and write what you found into
   \`BLOCKED.md\` instead of improvising.
2. **JSON key order matters.** The comparison is on raw bytes, so build response object
   literals with the fields in exactly the contract's order.
3. **Do not touch \`public/\`.** Those fixtures are generated centrally and their sha256
   is checked.
4. **Pinned versions.** Use exactly the versions listed below. Do not upgrade anything.
   You have no network search — the versions here are correct as of the benchmark date.
5. **No logging on the hot path**, no compression, no CORS, no helmet, no rate limiting.
6. **Validation belongs to \`POST /validate/user\` and nowhere else.** Do not add a schema to
   \`POST /api/orders/:orderId/items\` — that endpoint must only parse, compute and respond.
   Returning the right bytes is not enough; every app must do the same amount of work.
6. **Single process.** No clustering, no worker threads.

## Your target

| | |
|---|---|
| App id | \`${b.app}\` (this is what \`/__bench/meta\` must report as \`app\`) |
| Framework | ${b.framework} |
| Port | ${b.port} (read from \`process.env.PORT\`, default ${b.port}) |
| Runtimes | ${b.runtimes.join(' + ')} |
| Database layer | ${b.dbLayer} |
| Validator | ${b.validator} |

## Dependencies — exact versions

\`\`\`json
${JSON.stringify({ dependencies: b.deps, devDependencies: b.devDeps }, null, 2)}
\`\`\`

## package.json scripts — these exact names, the harness calls them

\`\`\`json
${JSON.stringify(b.scripts, null, 2)}
\`\`\`

## Framework-specific requirements

${b.notes.map((n) => `- ${n}`).join('\n')}

## Database

Read the connection string from \`process.env.DATABASE_URL\` — always, never hardcode it.
\`verify.ts\` hands you an isolated database (\`bench_${b.app.replace(/-/g, '_')}\`) so that
parallel builders do not collide; the real benchmark run passes a different one.

Two tables, already created and seeded by the harness — **your app must never create or
migrate them**:

\`\`\`sql
bench_users  (id integer PK, name text, email text, age integer, city text)   -- 10,000 rows, read only
bench_writes (id integer GENERATED ALWAYS AS IDENTITY PK, name, email, age, city) -- insert target
\`\`\`

Queries your app must run:

\`\`\`sql
SELECT id, name, email, age, city FROM bench_users WHERE id = $1
SELECT id, name, email, age, city FROM bench_users ORDER BY id ASC LIMIT $1 OFFSET $2
INSERT INTO bench_writes (name, email, age, city) VALUES ($1,$2,$3,$4) RETURNING id
\`\`\`

Connection pool size is **20**. Create the pool once at module scope, never per request.

## The meta endpoint

\`GET /__bench/meta\` → 200 JSON. \`app\` MUST be \`"${b.app}"\`:

\`\`\`json
{"app":"${b.app}","framework":"...","frameworkVersion":"...","dbLayer":"...","validator":"..."}
\`\`\`

## Reference implementation

\`REFERENCE.ts\` is a complete, verified implementation of the entire contract on plain
\`Bun.serve\`. It is **not** the style you should copy — write idiomatic ${b.framework} —
but when you are unsure what an endpoint should return, it is the authoritative answer.

## How you know you are done

\`\`\`bash
bun install
${b.scripts.build ? 'bun run build\n' : ''}bun verify.ts
\`\`\`

\`verify.ts\` seeds the database, starts your server through your own \`start\` script,
fires all ${'~'}20 contract requests and diffs the response bytes. It must print
**\`✅ CONFORMANT\`**. ${b.runtimes.includes('node') ? `\nThen prove the Node runtime too:\n\n\`\`\`bash\nBENCH_START=start:node bun verify.ts\n\`\`\`\n` : ''}
Iterate until green. A failing verify prints the exact expected and actual bytes.

## Deliverables

- \`package.json\` — the pinned deps and the exact script names above
- \`tsconfig.json\`
- \`src/\` — your implementation
- ${b.scripts.build ? '`dist/` — built output (gitignored, but must build cleanly)\n- ' : ''}\`bun verify.ts\` printing \`✅ CONFORMANT\`

Do not create a README. Do not add tests beyond \`verify.ts\`. Do not modify
\`contract-requests.ts\`, \`verify.ts\`, \`fixtures.manifest.json\`, \`REFERENCE.ts\` or \`public/\`.
`;
}

const only = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : null;

for (const b of BRIEFS) {
  if (only && b.app !== only) continue;
  const dir = join(ROOT, 'apps', b.app);
  await mkdir(join(dir, 'src'), { recursive: true });
  await copyFile(join(ROOT, 'contract/requests.ts'), join(dir, 'contract-requests.ts'));
  await copyFile(join(ROOT, 'contract/fixtures.manifest.json'), join(dir, 'fixtures.manifest.json'));
  await copyFile(join(ROOT, 'reference/src/index.ts'), join(dir, 'REFERENCE.ts'));
  await writeFile(
    join(dir, 'verify.ts'),
    VERIFY_TEMPLATE.replace(/__APP__/g, b.app).replace(/__PORT__/g, String(b.port)),
  );
  await writeFile(join(dir, 'TASK.md'), taskMd(b));
  console.log(`scaffolded apps/${b.app}`);
}
