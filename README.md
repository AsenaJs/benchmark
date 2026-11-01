# AsenaJS Benchmark Suite

Eight web frameworks, six scenario groups, one frozen contract. Every app returns
**byte-for-byte identical responses** to the same requests — that is what makes the
throughput numbers comparable.

Read [`BENCHMARK_PLAN.md`](./BENCHMARK_PLAN.md) for the contract: every endpoint, every
request body, every expected response byte.

## Requirements

- Bun 1.4+, Node 26+ (the Node-side apps are measured on both)
- `wrk` on PATH
- PostgreSQL on `localhost:5432` as `postgres:postgres` (a Docker container is fine)

## Run everything

```bash
bun install
bun tools/gen-fixtures.ts          # deterministic public/ files for every app
bun tools/conformance.ts           # every app must be green before measuring
bun run-all.ts --profile quick     # ~30 min sanity sweep
bun run-all.ts --profile official  # the publishable sweep, several hours
```

Results land in `results/REPORT.md`, rewritten after every target — so the report is
readable while the sweep is still running, and a sweep that dies halfway still leaves
usable output. Continue with `bun run-all.ts --resume`.

## Working on one app

```bash
cd apps/hono
bun install
bun verify.ts                      # seeds its own database, starts the app, diffs bytes
BENCH_START=start:node bun verify.ts   # Node-capable apps only
```

`verify.ts` prints the exact expected and actual bytes on failure. Green means the app is
ready to be measured; nothing else counts.

## Layout

| Path | What |
|---|---|
| `contract/requests.ts` | the frozen contract — paths, request bytes, expected bytes |
| `contract/targets.ts` | the 12 app × runtime targets |
| `run-all.ts` | the orchestrator: DB reset → conformance → measure → report |
| `tools/` | db, process, wrk, conformance, report rendering, scaffolding |
| `reference/` | the whole contract on plain `Bun.serve`, used to prove the harness |
| `apps/<id>/` | one framework each, self-contained work packet |
| `results/` | `REPORT.md`, `report.json`, per-target JSON |

## Rules that keep the numbers honest

- Single process per app. No clustering, no worker threads.
- No logging on the hot path, no compression, no CORS, no ETag hashing.
- DB pool size 20 everywhere; `synchronous_commit = off` on the bench database.
- Fresh server process per repetition; 3 reps; median reported with the spread.
- Server pinned to cores 0-7, `wrk` to 16-31.
- `/db/*` is each stack's idiomatic layer (`pg`, `Bun.sql`, TypeORM, drizzle) and is
  **not** uniform — every report table labels it.
