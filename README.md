# AsenaJS Benchmark Suite

Eight web frameworks, twelve app × runtime targets, one frozen contract. Every app returns
**byte-for-byte identical responses** to the same requests, which is what makes the numbers
comparable. The published page is [asena.sh/docs/benchmarks](https://asena.sh/docs/benchmarks).

| Framework | Runtime(s) | Database layer | Validator |
|---|---|---|---|
| Asena + Ergenecore | Bun | `Bun.sql` + drizzle | zod |
| Asena + hono-adapter | Bun | `Bun.sql` + drizzle | zod |
| Elysia 1.4 | Bun | `Bun.sql` | TypeBox |
| Hono 4 | Bun | `Bun.sql` | zod |
| Fastify 5 | Node, Bun | `pg` | ajv |
| Express 5 | Node, Bun | `pg` | zod |
| NestJS 11 + Fastify | Node, Bun | TypeORM | class-validator |
| NestJS 11 + Express | Node, Bun | TypeORM | class-validator |

[`contract/requests.ts`](./contract/requests.ts) is the contract: every endpoint, every request
body, every expected response byte.

| Scenario | What a request does |
|---|---|
| `s1a` plaintext | a 13-byte `text/plain` response |
| `s1b` JSON | a small object built and serialized per request |
| `s2a` query | four query parameters read, coerced, defaulted, one arithmetic result |
| `s2b` path params | two path parameters parsed and summed |
| `s3` full API | path param + query + one header + nested JSON body, reshaped and re-serialized |
| `s4a` / `s4b` static | a 4 KB HTML / 256 KB PNG file through the stack's recommended static setup |
| `s5` validation | a JSON body validated with the stack's own validator, then reshaped |
| `s6a` / `s6b` / `s6c` database | read by id / 20-row page / insert, on a 10,000-row table |
| `s6a-orm` … `s6c-orm` | the same three through drizzle (Asena apps only) |

The contract also carries negative cases (`s2a-defaults`, `s4c`, `s4-traversal`, `s5-invalid`)
that every app must pass in conformance but that are not benchmarked.

## How a sweep runs

`run-sequential.ts` measures one server at a time:

1. **Isolation.** The server runs alone on one logical CPU (`taskset`) inside a systemd scope with
   `MemoryMax=2G` and no swap. `wrk` and PostgreSQL sit on other cores. The harness reads the
   cgroup back and refuses to measure if the limits are not in place.
2. **Conformance gate.** The live process is checked byte-for-byte against the whole contract
   before anything is measured.
3. **Warm-up.** Every benchmarked route gets the same warm-up (10 s each), discarded.
4. **Measurement.** Each scenario runs for 180 s with `wrk -t2 -c128` on the same process. A run
   counts only with zero non-2xx responses, zero socket errors, no OOM kill and the process
   still alive.
5. **Profile.** Every second the harness samples the listener's RSS, the cgroup's memory
   (anon/file), and the server core's busy and softirq time from `/proc/stat`. Loopback TCP work
   runs in softirq and is not charged to the cgroup, so core busy is the real saturation signal.
6. **Repetitions.** `REPS=3` runs three passes, rotating which target goes first, and reports
   the median with its spread.

Every job record carries a code fingerprint (git HEAD plus a hash of uncommitted changes to
anything measured). A resume reuses only records of the exact same code.

## Requirements

- Linux with cgroup v2 and a systemd user session (`systemd-run --user --scope`)
- Bun 1.4+, Node 26+, `wrk`, `taskset`, `ss`
- PostgreSQL on `localhost:5432` as `postgres:postgres`, in a Docker container named `postgres`
- CPU numbers in `run-sequential.ts` (`SERVER_CPU`, `CLIENT_CPUS`) match a 16-core / 32-thread
  machine. Change them for yours: the server needs a core whose SMT sibling nothing else uses.

## Run

```bash
bun install
bun tools/gen-fixtures.ts                 # deterministic public/ files for every app
bun tools/conformance.ts                  # every app must be green
SMOKE=1 bun run-sequential.ts             # ~3 min check of the harness itself
REPS=3 bun run-sequential.ts              # the publishable sweep; ETA is printed at start
bun run-sequential.ts --assemble          # rebuild results/ from results-seq/jobs.jsonl
bun tools/website-page.ts ../Website      # regenerate the asena.sh page from results/
```

`run-all.ts` (fresh process per scenario) and `run-parallel.ts` (several 1-CPU servers at once)
are older orchestrators kept for comparison. The published numbers come from `run-sequential.ts`.

## Working on one app

```bash
cd apps/hono
bun install
bun verify.ts                             # seeds its own database, starts the app, diffs bytes
BENCH_START=start:node bun verify.ts      # Node-capable apps only
```

## Layout

| Path | What |
|---|---|
| `contract/` | the frozen contract and the 12 targets |
| `apps/<id>/` | one framework each, self-contained |
| `reference/` | the whole contract on plain `Bun.serve`, used to prove the harness |
| `tools/` | db, process, wrk, conformance, report and website-page rendering |
| `run-sequential.ts` | the orchestrator behind the published numbers |
| `results/` | `REPORT.md`, `report.json`, one JSON per target |
| `results-seq/` | raw job log, environment snapshot, conformance evidence |

## Rules that keep the numbers honest

- Single process per app. No clustering, no worker threads.
- No logging on the hot path, no compression, no CORS, no ETag hashing.
- Responses are built per request; nothing is precomputed or cached by the app.
- Handlers read only what they use: one header by name, the query object once.
- DB pool size 20 everywhere; `synchronous_commit = off`; write table truncated before each
  write scenario.
- Validation runs on one route only (`s5`), with each framework's own validator.

## Known asymmetries

These are disclosed rather than removed, because removing them would stop measuring what each
stack actually ships:

- **The database layer differs** (`pg`, `Bun.sql`, TypeORM, drizzle). `Bun.sql` prepares and
  caches statements; `pg` and TypeORM send unnamed statements.
- **Static files use each stack's recommended setup**, and those do different work per request.
  `@elysiajs/static` registers HTML files as constant routes at startup; Ergenecore keeps small
  files' descriptors and headers open and re-reads the bytes; the Asena Hono adapter wraps
  `hono/serve-static` with a synchronous stat; Hono's `hono/bun` stats asynchronously; Express,
  Fastify and NestJS stat and open a read stream per request.
- **NestJS bundles its own Express and Fastify**, slightly older than the standalone apps'.
- **No app checks `Authorization`** on `s3`; the scenario measures parsing and reshaping.

## Results history

`results/` holds the 2026-11-01 sweep (commit `8ff308b`): one pass, 120 s of warm-up split over
each target's routes. The harness and handler fixes after that commit (equal per-route warm-up,
conformance gate, rotation, single-header and single-query reads) apply from the next sweep on.
