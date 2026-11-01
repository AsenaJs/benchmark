# Work packet: `elysia` — Elysia 1.4

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
   the contract seems impossible in Elysia 1.4, STOP and write what you found into
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
| App id | `elysia` (this is what `/__bench/meta` must report as `app`) |
| Framework | Elysia 1.4 |
| Port | 3005 (read from `process.env.PORT`, default 3005) |
| Runtimes | bun |
| Database layer | Bun's native SQL (`new SQL(...)` from `bun`) — raw SQL, NOT an ORM |
| Validator | Elysia's own TypeBox validation (`t.Object`) — NOT zod |

## Dependencies — exact versions

```json
{
  "dependencies": {
    "elysia": "1.4.29",
    "@elysiajs/static": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "5.9.3"
  }
}
```

## package.json scripts — these exact names, the harness calls them

```json
{
  "start:bun": "bun src/index.ts"
}
```

## Framework-specific requirements

- Validation MUST use Elysia's `body: t.Object({...})` schema on the route. That is the native path being measured.
- TypeBox strips unknown keys by default in Elysia; keep that behaviour.
- A failed `t.Object` validation returns 422 by default in Elysia — the contract requires **400**. Add `.onError` mapping `VALIDATION` to status 400, or set the route `error` handler. Verify with `bun verify.ts`.
- Static: `@elysiajs/static` with `prefix: "/static"`, `assets: publicDir`.
- DB: `import { SQL } from "bun"` and one `new SQL({ url: process.env.DATABASE_URL, max: 20 })` at module scope.
- Elysia returns objects as JSON automatically; make sure the key order in the object literal matches the contract exactly.

## Database

Read the connection string from `process.env.DATABASE_URL` — always, never hardcode it.
`verify.ts` hands you an isolated database (`bench_elysia`) so that
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

`GET /__bench/meta` → 200 JSON. `app` MUST be `"elysia"`:

```json
{"app":"elysia","framework":"...","frameworkVersion":"...","dbLayer":"...","validator":"..."}
```

## Reference implementation

`REFERENCE.ts` is a complete, verified implementation of the entire contract on plain
`Bun.serve`. It is **not** the style you should copy — write idiomatic Elysia 1.4 —
but when you are unsure what an endpoint should return, it is the authoritative answer.

## How you know you are done

```bash
bun install
bun verify.ts
```

`verify.ts` seeds the database, starts your server through your own `start` script,
fires all ~20 contract requests and diffs the response bytes. It must print
**`✅ CONFORMANT`**. 
Iterate until green. A failing verify prints the exact expected and actual bytes.

## Deliverables

- `package.json` — the pinned deps and the exact script names above
- `tsconfig.json`
- `src/` — your implementation
- `bun verify.ts` printing `✅ CONFORMANT`

Do not create a README. Do not add tests beyond `verify.ts`. Do not modify
`contract-requests.ts`, `verify.ts`, `fixtures.manifest.json`, `REFERENCE.ts` or `public/`.
