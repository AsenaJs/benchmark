# Work packet: `nest-express` — NestJS 11 on Express

You are building ONE benchmark application. Everything you need is in this directory.

## What this is

Eight web frameworks are being benchmarked against each other for the AsenaJS project.
For the comparison to mean anything, **every app must return byte-for-byte identical
responses to the same requests**. Your app is one of the eight. Other agents are
building the others right now, against the same contract.

## The rules

1. **The contract is READ-ONLY.** `contract-requests.ts` defines every endpoint, every
   request and every expected response byte. Do not change it. Do not invent endpoints,
   rename fields, change a status code, or "improve" a response shape. If something in
   the contract seems impossible in NestJS 11 on Express, STOP and write what you found into
   `BLOCKED.md` instead of improvising.
2. **JSON key order matters.** The comparison is on raw bytes, so build response object
   literals with the fields in exactly the contract's order.
3. **Do not touch `public/`.** Those fixtures are generated centrally and their sha256
   is checked.
4. **Pinned versions.** Use exactly the versions listed below. Do not upgrade anything.
   You have no network search — the versions here are correct as of the benchmark date.
5. **No logging on the hot path**, no compression, no CORS, no helmet, no rate limiting.
6. **Validation belongs to `POST /validate/user` and nowhere else.** Do not add a schema to
   `POST /api/orders/:orderId/items` — that endpoint must only parse, compute and respond.
   Returning the right bytes is not enough; every app must do the same amount of work.
6. **Single process.** No clustering, no worker threads.

## Your target

| | |
|---|---|
| App id | `nest-express` (this is what `/__bench/meta` must report as `app`) |
| Framework | NestJS 11 on Express |
| Port | 3003 (read from `process.env.PORT`, default 3003) |
| Runtimes | node + bun |
| Database layer | TypeORM 1.x over postgres |
| Validator | class-validator + ValidationPipe |

## Dependencies — exact versions

```json
{
  "dependencies": {
    "@nestjs/common": "11.2.1",
    "@nestjs/core": "11.2.1",
    "@nestjs/platform-express": "11.2.1",
    "@nestjs/typeorm": "latest",
    "typeorm": "1.1.0",
    "pg": "8.23.0",
    "class-validator": "0.15.1",
    "class-transformer": "latest",
    "reflect-metadata": "0.2.2",
    "rxjs": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/express": "latest",
    "typescript": "5.9.3"
  }
}
```

## package.json scripts — these exact names, the harness calls them

```json
{
  "build": "tsc -p tsconfig.json",
  "start:node": "node dist/main.js",
  "start:bun": "bun dist/main.js"
}
```

## Framework-specific requirements

- Bootstrap with `NestFactory.create(AppModule, { logger: false })`.
- Disable Express extras on the underlying instance: `app.getHttpAdapter().getInstance().disable("x-powered-by")` and `.set("etag", false)`.
- Validation: a global-free, route-level `ValidationPipe({ whitelist: true, transform: true })` on /validate/user only. `whitelist: true` implements the contract's "unknown keys stripped" rule.
- TypeORM: `TypeOrmModule.forRoot({ type: "postgres", url: process.env.DATABASE_URL, synchronize: false, logging: false, poolSize: 20, entities: [BenchUser, BenchWrite] })`. NEVER set synchronize:true — the schema is owned by the harness.
- Entity table names are exactly `bench_users` and `bench_writes`. `bench_writes.id` is GENERATED ALWAYS AS IDENTITY, so mark it `@PrimaryGeneratedColumn("identity", { generatedIdentity: "ALWAYS" })` or equivalent for your TypeORM version.
- Static: `@nestjs/serve-static` is NOT allowed (extra dependency and it wraps a different server). Use `app.useStaticAssets(publicDir, { prefix: "/static/", etag: false, lastModified: false })` from platform-express.
- requires `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig, and `import "reflect-metadata"` as the first line of main.ts.

## Database

Read the connection string from `process.env.DATABASE_URL` — always, never hardcode it.
`verify.ts` hands you an isolated database (`bench_nest_express`) so that
parallel builders do not collide; the real benchmark run passes a different one.

Two tables, already created and seeded by the harness — **your app must never create or
migrate them**:

```sql
bench_users  (id integer PK, name text, email text, age integer, city text)   -- 10,000 rows, read only
bench_writes (id integer GENERATED ALWAYS AS IDENTITY PK, name, email, age, city) -- insert target
```

Queries your app must run:

```sql
SELECT id, name, email, age, city FROM bench_users WHERE id = $1
SELECT id, name, email, age, city FROM bench_users ORDER BY id ASC LIMIT $1 OFFSET $2
INSERT INTO bench_writes (name, email, age, city) VALUES ($1,$2,$3,$4) RETURNING id
```

Connection pool size is **20**. Create the pool once at module scope, never per request.

## The meta endpoint

`GET /__bench/meta` → 200 JSON. `app` MUST be `"nest-express"`:

```json
{"app":"nest-express","framework":"...","frameworkVersion":"...","dbLayer":"...","validator":"..."}
```

## Reference implementation

`REFERENCE.ts` is a complete, verified implementation of the entire contract on plain
`Bun.serve`. It is **not** the style you should copy — write idiomatic NestJS 11 on Express —
but when you are unsure what an endpoint should return, it is the authoritative answer.

## How you know you are done

```bash
bun install
bun run build
bun verify.ts
```

`verify.ts` seeds the database, starts your server through your own `start` script,
fires all ~20 contract requests and diffs the response bytes. It must print
**`✅ CONFORMANT`**. 
Then prove the Node runtime too:

```bash
BENCH_START=start:node bun verify.ts
```

Iterate until green. A failing verify prints the exact expected and actual bytes.

## Deliverables

- `package.json` — the pinned deps and the exact script names above
- `tsconfig.json`
- `src/` — your implementation
- `dist/` — built output (gitignored, but must build cleanly)
- `bun verify.ts` printing `✅ CONFORMANT`

Do not create a README. Do not add tests beyond `verify.ts`. Do not modify
`contract-requests.ts`, `verify.ts`, `fixtures.manifest.json`, `REFERENCE.ts` or `public/`.
