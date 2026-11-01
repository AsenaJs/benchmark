/**
 * Generates the asena.sh benchmark page from results/report.json.
 *
 * The page is generated, never hand-edited: a number on the site that nobody can
 * trace back to a run is worse than no number. Re-run this after every sweep.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// usage: bun tools/website-page.ts <path-to-Website-checkout>
const SITE = process.argv[2] ?? process.env.WEBSITE_DIR;
if (!SITE) throw new Error('pass the Website checkout directory as the first argument (or set WEBSITE_DIR)');
const OUT_MD = join(SITE, 'docs/benchmarks.md');
const OUT_CSS = join(SITE, '.vitepress/theme/benchmarks.css');

interface Mem {
  startupMs: number; rssIdleMB: number; rssAfterWarmupMB: number; rssAvgMB: number; rssPeakMB: number;
  cgroupPeakMB: number; coreBusyMeasure: number; coreSoftirqMeasure: number; oomKill: number;
}

interface Target {
  target: string; app: string; framework: string; runtime: string; runtimeVersion: string;
  dbLayer: string; validator: string; profile: any; reps: number; meta: Record<string, any>;
  scenarios: Record<string, { median?: { rps: number; latencyAvgMs: number; latencyP99Ms: number }; rpsSpread?: number; status: string; memory?: Mem }>;
}

const R: Target[] = JSON.parse(readFileSync(join(ROOT, 'results/report.json'), 'utf8'));
const T = (app: string, rt: string) => R.find((t) => t.app === app && t.runtime === rt);
const rps = (app: string, rt: string, s: string) => T(app, rt)?.scenarios[s]?.median?.rps ?? NaN;
const p99 = (app: string, rt: string, s: string) => T(app, rt)?.scenarios[s]?.median?.latencyP99Ms ?? NaN;

/** One server process serves every scenario of a target, so idle/warm-up/startup are per target. */
function mem(app: string, rt: string) {
  const ms = Object.values(T(app, rt)?.scenarios ?? {}).map((s) => s.memory).filter((m): m is Mem => !!m);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    startup: ms[0]!.startupMs,
    idle: ms[0]!.rssIdleMB,
    warm: ms[0]!.rssAfterWarmupMB,
    avg: mean(ms.map((m) => m.rssAvgMB)),
    peak: Math.max(...ms.map((m) => m.rssPeakMB)),
    oom: ms.reduce((a, m) => a + m.oomKill, 0),
    coreMin: Math.min(...ms.map((m) => m.coreBusyMeasure)),
    softirq: mean(ms.map((m) => m.coreSoftirqMeasure)),
  };
}
const ENV: Record<string, any> = R[0]!.meta.environment ?? {};

const LABEL: Record<string, string> = {
  'asena-ergenecore': 'Asena <span class="bm-adapter">Ergenecore</span>',
  'asena-hono': 'Asena <span class="bm-adapter">Hono</span>',
  elysia: 'Elysia', hono: 'Hono', fastify: 'Fastify', express: 'Express',
  'nest-express': 'NestJS <span class="bm-adapter">Express</span>',
  'nest-fastify': 'NestJS <span class="bm-adapter">Fastify</span>',
};
const ASENA = new Set(['asena-ergenecore', 'asena-hono']);
const NEST = new Set(['nest-express', 'nest-fastify']);
const APPS = ['elysia', 'hono', 'asena-ergenecore', 'asena-hono', 'fastify', 'express', 'nest-fastify', 'nest-express'];
const NODE_APPS = ['fastify', 'express', 'nest-fastify', 'nest-express'];

// Every chart carries both runtimes for the Node-based stacks. Bun-only rows would flatter
// NestJS with a runtime almost nobody deploys it on.
const ROWS = [
  ...APPS.map((app) => ({ app, rt: 'bun' })),
  ...NODE_APPS.map((app) => ({ app, rt: 'node' })),
];

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const x = (a: number, b: number) => (a / b).toFixed(2);
const rtTag = (rt: string) =>
  `<span class="bm-rt${rt === 'node' ? ' bm-rt-node' : ''}">${rt === 'bun' ? 'Bun' : 'Node'}</span>`;

// The NestJS apps read through TypeORM, so the database comparison uses Asena's ORM route
// (drizzle), not raw Bun.sql — ORM against ORM.
const ASENA_SIDE: Record<string, string> = { s6a: 's6a-orm' };
const asenaBest = (s: string) => rps('asena-ergenecore', 'bun', ASENA_SIDE[s] ?? s);
const BADGE_LABEL: Record<string, string> = {
  s5: 'Validation · Zod vs class-validator',
  s6a: 'DB read · Drizzle vs TypeORM',
};
/** this sweep split one warm-up budget over the routes; later sweeps give every route the same seconds */
const LEGACY_WARMUP = !!ENV.warmupNote;
// `nest new` gives you Express on Node. That default is the headline comparison; Fastify and
// Bun are the two upgrades a NestJS team can reach for, so each card prints both.
const DEFAULT_NEST = 'nest-express';
const TUNED_NEST = 'nest-fastify';
const vs = (s: string, app: string, rt: string) => x(asenaBest(s), rps(app, rt, s));

function chart(scenario: string): string {
  const rows = ROWS.map((r) => ({ ...r, v: rps(r.app, r.rt, scenario) }))
    .filter((r) => Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v);
  const max = rows[0]!.v;

  const html = rows.map((r, i) => {
    const pct = Math.max((r.v / max) * 100, 4);
    const cls = ['bm-row'];
    if (i === 0) cls.push('is-first');
    if (ASENA.has(r.app)) cls.push('is-asena');
    if (NEST.has(r.app)) cls.push('is-nest');
    const inside = i === 0;
    return `  <div class="${cls.join(' ')}">
    <div class="bm-label">${LABEL[r.app]}${rtTag(r.rt)}</div>
    <div class="bm-track">
      <div class="bm-bar" style="width:${pct.toFixed(1)}%">${inside ? `<span class="bm-in">${n(r.v)} req/s</span>` : ''}</div>
      ${inside ? '' : `<span class="bm-out">${n(r.v)}</span>`}
    </div>
  </div>`;
  }).join('\n');

  return `<div class="bm-chart">\n${html}\n</div>`;
}

const best = (s: string) =>
  ROWS.map((r) => ({ app: r.app, v: rps(r.app, r.rt, s) })).sort((a, b) => b.v - a.v)[0]!.app;

/** Lower is better: the smallest footprint is drawn first and gets the highlight. */
function memChart(pick: (m: ReturnType<typeof mem>) => number): string {
  const rows = ROWS.map((r) => ({ ...r, v: pick(mem(r.app, r.rt)) })).sort((a, b) => a.v - b.v);
  const max = rows.at(-1)!.v;
  const html = rows.map((r, i) => {
    const cls = ['bm-row'];
    if (i === 0) cls.push('is-first');
    if (ASENA.has(r.app)) cls.push('is-asena');
    if (NEST.has(r.app)) cls.push('is-nest');
    return `  <div class="${cls.join(' ')}">
    <div class="bm-label">${LABEL[r.app]}${rtTag(r.rt)}</div>
    <div class="bm-track">
      <div class="bm-bar" style="width:${Math.max((r.v / max) * 100, 4).toFixed(1)}%"></div>
      <span class="bm-out">${r.v.toFixed(0)} MB</span>
    </div>
  </div>`;
  }).join('\n');
  return `<div class="bm-chart">\n${html}\n</div>`;
}

const plain = (app: string) => LABEL[app]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function nestBunSlower(): string[] {
  return ['s1a', 's5', 's6a', 's3'].flatMap((s) =>
    ['nest-express', 'nest-fastify']
      .filter((app) => rps(app, 'bun', s) < rps(app, 'node', s))
      .map((app) => `${plain(app)} on ${SCENARIOS[s]!.title.toLowerCase()}`),
  );
}

function versusNest(scenario: string): string {
  const row = (app: string, rt: string, name: string) =>
    `      <div${app === 'asena-ergenecore' ? ' class="is-me"' : ''}><b>${n(app === 'asena-ergenecore' ? asenaBest(scenario) : rps(app, rt, scenario))}</b><span>${name}</span></div>`;
  return `<div class="bm-vs-card">
    <div class="bm-vs-scenario">${SCENARIOS[scenario]!.title}</div>
    <div class="bm-vs-big">${vs(scenario, DEFAULT_NEST, 'node')}<span>×</span></div>
    <div class="bm-vs-sub">faster than <strong>NestJS + Express</strong> on Node <span class="bm-paren">(${vs(scenario, DEFAULT_NEST, 'bun')}× on Bun)</span></div>
    <div class="bm-vs-alt"><b>${vs(scenario, TUNED_NEST, 'node')}×</b> against <strong>NestJS + Fastify</strong> on Node <span class="bm-paren">(${vs(scenario, TUNED_NEST, 'bun')}× on Bun)</span></div>
    <div class="bm-vs-detail">
${[
  row('asena-ergenecore', 'bun', `Asena · Ergenecore · Bun${ASENA_SIDE[scenario] ? ' · Drizzle' : ''}`),
  row('nest-express', 'node', 'NestJS · Express · Node'),
  row('nest-express', 'bun', 'NestJS · Express · Bun'),
  row('nest-fastify', 'node', 'NestJS · Fastify · Node'),
  row('nest-fastify', 'bun', 'NestJS · Fastify · Bun'),
].join('\n')}
    </div>
  </div>`;
}

const SCENARIOS: Record<string, { title: string; blurb: string }> = {
  s1a: { title: 'Plaintext', blurb: 'A 13-byte <code>text/plain</code> response. Nothing but the HTTP layer and the router.' },
  s1b: { title: 'JSON serialization', blurb: 'A small object built and serialized per request — no caching, no precomputed body.' },
  s2a: { title: 'Query string parsing', blurb: 'Four query parameters read, coerced to numbers, defaults applied, one arithmetic result.' },
  s2b: { title: 'Path parameters', blurb: 'Two path parameters parsed from the route and summed.' },
  s3: { title: 'Full API endpoint', blurb: 'Path param + query + custom header + a nested JSON body parsed, reshaped and re-serialized. Integer cents only, so no float formatting can diverge.' },
  s4a: { title: 'Static file · 4 KB', blurb: 'Each stack serves the file the way its own documentation tells you to.' },
  s4b: { title: 'Static file · 256 KB', blurb: 'The large-payload path. Bandwidth-bound, and the noisiest scenario in the suite.' },
  s5: { title: 'Request validation', blurb: 'Each framework runs its own validator: Zod for Asena and Hono, TypeBox for Elysia, ajv for Fastify, class-validator for NestJS.' },
  s6a: { title: 'Database · read by id', blurb: 'One indexed <code>SELECT</code> against a 10,000-row table, connection pool of 20.' },
  s6b: { title: 'Database · paged list', blurb: 'Twenty rows, ordered and paginated, serialized as JSON.' },
  s6c: { title: 'Database · insert', blurb: 'One <code>INSERT … RETURNING id</code>. Database-bound — this measures the driver more than the framework.' },
};

// ---------- page ----------

const P = R[0]!.profile;
const HERO = 's1a';
const BADGES = ['s5', 's6a', 's3'];
const CARDS = ['s1a', 's5', 's6a', 's3'];
const HEAD = ['s1a', 's1b', 's2a', 's2b', 's3', 's5', 's6a', 's4a'];

const md = `---
title: Benchmarks
description: How Asena performs against Elysia, Hono, Fastify, Express and NestJS across eight scenarios and two runtimes, on identical, byte-verified workloads.
outline: deep
llms: false
---

# Benchmarks

Eight frameworks, two runtimes, eleven scenarios, one frozen contract. Every application
returns **byte-for-byte identical responses** to byte-for-byte identical requests, verified
mechanically on the exact builds that were measured. Without that, a benchmark compares
implementations, not frameworks.

The harness, every app and every raw result are public in
[AsenaJs/benchmark](https://github.com/AsenaJs/benchmark): clone it and run the same sweep on
your own machine.

::: info Read the charts honestly: Elysia and Hono are right there
Elysia and Hono are minimal routers, and on a minimal application they are excellent
choices. On most charts the top three — Elysia, Hono and Asena · Ergenecore — sit within a
few percent of each other, and Elysia leads ${HEAD.filter((s) => best(s) === 'elysia').length} of the
${HEAD.length} headline scenarios. If your service is a handful of routes, any of the three will do.

Asena is built for the application after that one: controllers, injected services,
middleware, validation, lifecycle hooks, a container that wires it together. That is the
shape NestJS gives you, and NestJS is the comparison this page is really about.
:::

<div class="bm-hero">
  <div class="bm-hero-num">${vs(HERO, DEFAULT_NEST, 'node')}<span>×</span></div>
  <div class="bm-hero-txt">
    <strong>Asena outruns NestJS out of the box</strong>
    <span>Plaintext — ${n(asenaBest(HERO))} vs ${n(rps(DEFAULT_NEST, 'node', HERO))} req/s.</span>
  </div>
</div>

<div class="bm-hero-badges">
${BADGES.map((s) => `  <div class="bm-badge"><b>${vs(s, DEFAULT_NEST, 'node')}×</b><span>${BADGE_LABEL[s] ?? SCENARIOS[s]!.title}</span></div>`).join('\n')}
</div>

<div class="bm-badges-note">Asena · Ergenecore vs NestJS · Express · Node. Each stack runs its own validator and data
layer, so those two badges compare the stacks you get, libraries included.</div>

## Asena vs NestJS

NestJS is the framework Asena is most often compared to: both are decorator-driven, both
put an IoC container at the centre, both ask you to write controllers and inject services.
The difference is what runs underneath.

<div class="bm-vs-grid">
${CARDS.map(versusNest).join('\n')}
</div>

::: tip How to read the four numbers on each card
\`nest new\` gives you NestJS on Express, running on Node. Nothing is chosen, nothing is tuned,
and that is what the headline divides by — the configuration you actually get. The three
smaller figures are the escapes, applied one at a time: swap Express for Fastify, move Node
to Bun, or do both. None of them closes the gap, and every raw req/s behind them is printed
on the card so you can check the arithmetic. On the database card Asena reads through Drizzle,
because NestJS reads through TypeORM: ORM against ORM.

${nestBunSlower().length
  ? `Moving to Bun is not a free win everywhere: ${nestBunSlower().join(', ')} ${nestBunSlower().length > 1 ? 'are' : 'is'} slower on Bun
than on Node, so on those cards the Bun figure is the wider one.`
  : 'Moving NestJS to Bun helps on every card, but nowhere near enough to close the gap.'}
:::

${HEAD.map((s) => `## ${SCENARIOS[s]!.title}

${SCENARIOS[s]!.blurb}

${chart(s)}
`).join('\n')}

::: warning What the static numbers actually measure
The static scenario measures each stack's **official static middleware**, not the framework,
and those middlewares do different amounts of work per request:

- **Elysia** (\`@elysiajs/static\`) registers every HTML file as its own constant route at
  startup, so the 4 KB page skips the per-request filesystem lookup entirely.
- **Asena · Ergenecore** stats the file on every request but keeps small files' descriptors,
  MIME type and headers open between requests and reads fresh bytes through them.
- **Asena · Hono adapter** ships its own wrapper around \`hono/serve-static\`: a synchronous
  stat, then a \`Bun.file()\` response.
- **Hono** uses \`serveStatic\` from \`hono/bun\`: an asynchronous stat plus an existence check,
  then a \`Bun.file()\` response.
- **Express, Fastify and both NestJS stacks** stat the file asynchronously and open a new read
  stream on every request; on Node that goes through the libuv thread pool, on the same core.

On the 256 KB file Elysia and Ergenecore fall back to the per-request path too, and the ranking
follows synchronous against asynchronous stat. Read both static charts as "what each
framework's recommended static setup costs on one core", not as equal work.
:::

## Node vs Bun

The four Node-based frameworks were measured twice, running the **same compiled
\`dist/main.js\`** on both runtimes. Only the runtime changes, measured on plaintext.
${(() => {
  const gain = NODE_APPS.filter((a) => rps(a, 'bun', 's1a') >= rps(a, 'node', 's1a'));
  return gain.length === NODE_APPS.length
    ? 'All four are faster on Bun — yet none of them reaches the Bun-native stacks, which is the framework cost the runtime cannot remove.'
    : `${gain.map(plain).join(', ')} gain on Bun; ${NODE_APPS.filter((a) => !gain.includes(a)).map(plain).join(', ')} lose ground — which is why every card above prints its Bun variant alongside the Node one.`;
})()}

<div class="bm-runtime-grid">
${['express', 'fastify', 'nest-express', 'nest-fastify'].map((app) => {
  const nd = rps(app, 'node', 's1a'), bn = rps(app, 'bun', 's1a');
  return `  <div class="bm-runtime-card">
    <div class="bm-rc-name">${LABEL[app]}</div>
    <div class="bm-rc-gain">${bn >= nd ? '+' : '−'}${Math.abs(Math.round((bn / nd - 1) * 100))}%</div>
    <div class="bm-rc-rows"><span>Node ${n(nd)}</span><span>Bun ${n(bn)}</span></div>
  </div>`;
}).join('\n')}
</div>

## Asena's two adapters

Identical application code — the same controllers, services, validators and repositories.
Only the adapter import changes.

| Scenario | Ergenecore | Hono adapter |
|:---|--:|--:|
${['s1a', 's1b', 's3', 's5', 's6a', 's4a'].map((s) =>
  `| ${SCENARIOS[s]!.title} | ${n(rps('asena-ergenecore', 'bun', s))} | ${n(rps('asena-hono', 'bun', s))} |`).join('\n')}

Ergenecore leads on raw throughput; on the body-heavy API endpoint and the database read the
two are level. The static gap is the two adapters' different file-serving strategies (see the
warning above), not routing. Pick Ergenecore for speed, the Hono adapter when you want Hono's
middleware ecosystem.

## What an ORM costs

Asena exposes the same three database operations twice: once over raw \`Bun.sql\`, once over
\`@asenajs/asena-drizzle\`. Same tables, same response bytes, the same \`Bun.sql\` driver, each
path with its own pool of 20 connections. The cost column is everything the ORM path adds:
Drizzle building the statement on every call (the read by id also gets a \`LIMIT 1\`), mapping
rows back to objects, and the repository resolving its connection per access.

| Operation | Raw \`Bun.sql\` | Drizzle | Cost |
|:---|--:|--:|--:|
${[['s6a', 's6a-orm'], ['s6b', 's6b-orm'], ['s6c', 's6c-orm']].map(([raw, orm]) => {
  const a = rps('asena-ergenecore', 'bun', raw!), b = rps('asena-ergenecore', 'bun', orm!);
  return `| ${SCENARIOS[raw!]!.title.replace('Database · ', '')} | ${n(a)} | ${n(b)} | −${Math.round((1 - b / a) * 100)}% |`;
}).join('\n')}

## Memory

Resident memory (RSS) of the listening process, sampled once a second by the harness.
Lower is better. Every server ran under the same hard cap of
${(ENV.serverLimits?.match(/MemoryMax=(\S+?),/)?.[1] ?? '2G').replace('G', ' GB')} with swap disabled;
${ROWS.every((r) => mem(r.app, r.rt).oom === 0) ? 'no server came anywhere near it and none was ever killed for memory' : 'see the table for the targets that hit it'}.

### Peak under load

The highest RSS seen across all of a target's scenarios. For Elysia, Hono and Asena ·
Ergenecore that is the first scenario after warm-up, before the garbage collector has given back
what the warm-up allocated; Asena · Hono adapter peaks on an ORM route only Asena serves; for
the Node-based stacks it is the 256 KB static file or the validation route. Asena's figures
include its second (Drizzle) connection pool.

${memChart((m) => m.peak)}

### Idle, right after startup

${memChart((m) => m.idle)}

| Framework | Runtime | Ready by | Idle | After warm-up | Avg under load | Peak |
|:---|:---|--:|--:|--:|--:|--:|
${ROWS.map(({ app, rt }) => {
  const m = mem(app, rt);
  return `| ${plain(app)} | ${rt === 'bun' ? 'Bun' : 'Node'} | ${m.startup} ms | ${m.idle.toFixed(0)} MB | ${m.warm.toFixed(0)} MB | ${m.avg.toFixed(0)} MB | ${m.peak.toFixed(0)} MB |`;
}).join('\n')}

- **Ready by** is wall time from spawning the process to the first successful response,
  including the runtime's own boot. The harness polls once immediately and then every 150 ms,
  so the number is only as fine as that step: everything except NestJS answered on the second
  poll (~150 ms), NestJS on the third (~300 ms).
- **RSS** counts the pages the process actually holds in memory, including the runtime's own
  code. That is why a Bun process starts above 30 MB before the application has done anything.
- **After warm-up** follows traffic on every route: JIT-compiled code, connection pools and
  caches are all resident by then. It is the number to size a container by.

## Full results

Every measured number, req/s.

| Framework | Runtime | ${HEAD.map((s) => SCENARIOS[s]!.title.replace('Database · ', 'DB ').replace('Static file · ', 'Static ')).join(' | ')} |
|:---|:---|${HEAD.map(() => '--:').join('|')}|
${ROWS.map(({ app, rt }) => `| ${LABEL[app].replace(/<[^>]+>/g, ' ').trim()} | ${rt === 'bun' ? 'Bun' : 'Node'} | ${HEAD.map((s) => n(rps(app, rt, s))).join(' | ')} |`).join('\n')}

## Methodology

| | |
|---|---|
| Hardware | ${ENV.cpuModel ?? 'AMD Ryzen 9 9950X3D'} · 16C/32T · 60 GB RAM · Linux ${ENV.kernel ?? ''} · CPU governor \`${ENV.governor ?? 'performance'}\` |
| Runtimes | Bun ${ENV.bun ?? R.find((t) => t.runtime === 'bun')?.runtimeVersion} · Node ${String(ENV.node ?? R.find((t) => t.runtime === 'node')?.runtimeVersion).replace(/^v/, '')} · ${ENV.postgres?.replace(/\s*\(Debian.*$/, '').replace('postgres (PostgreSQL)', 'PostgreSQL') ?? 'PostgreSQL'} |
| Server budget | **1 CPU, ${ENV.serverLimits?.match(/MemoryMax=(\S+?),/)?.[1]?.replace('G', ' GB') ?? '2 GB'} RAM** per server — pinned to one logical core (no other benchmark work is placed on it or its SMT sibling), inside a cgroup with a hard memory cap and no swap |
| Order | **strictly sequential** — exactly one server runs at a time; nothing else is benchmarked alongside it |
| Server lifecycle | one fresh process per framework, reused for all of its scenarios |
| Warm-up | ${LEGACY_WARMUP ? `${P.warmup}s per process before the first measurement, split evenly over every route so each is JIT-warm` : `${P.warmup}s on every route before the first measurement`}; discarded |
| Measurement | ${P.duration}s per scenario, back to back, ${R[0]!.reps} run each |
| Load generator | \`wrk\`, ${P.threads} threads, ${P.connections} connections, on two physical cores of their own (\`${ENV.wrkCommand ?? ''}\`) |
| Database | PostgreSQL in a container pinned to five cores of its own, pool size 20 in every app, 10,000 seeded rows, \`synchronous_commit = off\`; write tables truncated before every write scenario |
| Quiet machine | unrelated containers stopped for the run; the orchestrator pinned to its own core |
| Logging | disabled in every application; no compression, no CORS, no ETag hashing |

### Versions

| Framework | Version | Runtime(s) | Database layer | Validator |
|:---|:---|:---|:---|:---|
${APPS.map((app) => {
  const ts = R.filter((t) => t.app === app);
  const t = ts[0]!;
  return `| ${plain(app)} | ${t.meta.frameworkVersion ?? ''} | ${ts.map((x) => (x.runtime === 'bun' ? 'Bun' : 'Node')).join(', ')} | ${t.dbLayer} | ${t.validator} |`;
}).join('\n')}

**Byte-level conformance is the gate.** Every app must return the exact expected bytes for all
eleven contract requests plus the negative cases.
${LEGACY_WARMUP
  ? 'For this sweep the check ran on the exact builds that were measured, right after the sweep, and all eight apps passed; the harness now runs it against every server process before its warm-up.'
  : 'The harness checks every server process before its warm-up; a process that fails is not measured.'}

**Validation runs on one route only.** Adding a schema elsewhere would make some apps measure
"parse + validate" and others "parse" while still returning identical bytes.

**Every result is checked, not just collected.** A run counts only if \`wrk\` saw zero non-2xx
responses and zero socket errors, the cgroup memory cap was verified in place, and the
process was still alive at the end. All ${R.reduce((n, t) => n + Object.values(t.scenarios).filter((s) => s.status === 'ok').length, 0)} runs passed.

**The server core was the bottleneck, not the load generator.** The harness reads the server
core's own counters during every measurement, and it never dropped below
${Math.floor(Math.min(...ROWS.map((r) => mem(r.app, r.rt).coreMin)) * 1000) / 10}% busy.
Part of that core goes to the kernel's network stack (softirq) rather than the framework —
from ${Math.round(Math.min(...ROWS.map((r) => mem(r.app, r.rt).softirq)) * 100)}% on the slowest stacks
to ${Math.round(Math.max(...ROWS.map((r) => mem(r.app, r.rt).softirq)) * 100)}% on the fastest. It is a
fixed cost per request, so the faster a framework is, the larger its share; every framework pays
it at the same rate. In a spot check, raising \`wrk\` from 2 to 8 threads did not change the numbers.

### Where these numbers are soft

- **The database layer is not uniform.** Each stack uses its idiomatic choice —
  \`pg\` for Express and Fastify, \`Bun.sql\` for Elysia, Hono and Asena, TypeORM for NestJS.
  The clean framework-to-framework database signal is the set of rows sharing one layer.
- **Prepared statements differ by driver.** \`Bun.sql\` prepares and caches per connection;
  \`pg\` and TypeORM issue unnamed statements and re-parse on every call. This favours the
  four \`Bun.sql\` applications on the database reads.
- **The static scenarios rank file-serving strategies**, not routers — see the warning under the
  charts. The 256 KB file in particular follows synchronous against asynchronous stat.
- **Scenarios share a process.** Each framework serves all of its scenarios from one process,
  in the same order for every framework, the way a real service would. Memory a route leaves
  behind is visible to the routes measured after it.
${LEGACY_WARMUP ? `- **Warm-up was split across routes.** The ${P.warmup}s budget was divided evenly over a target's
  routes: about ${Math.round(P.warmup / 11)}s each for most stacks, ${Math.round(P.warmup / 14)}s for
  Asena, which also serves the three ORM routes. Bun and Node are warm within seconds, so this
  is not expected to move results, but it is not identical. The harness now gives every route
  the same seconds.
` : ''}${R[0]!.reps === 1 ? `- **Frameworks ran in a fixed order** (Express, Fastify, NestJS, Elysia, Hono, Asena), one run
  each. Drift in machine state over the ${(() => { const ts = R.flatMap((t) => [Date.parse((t as any).startedAt), Date.parse((t as any).finishedAt)]); return ((Math.max(...ts) - Math.min(...ts)) / 3_600_000).toFixed(1); })()}-hour sweep is not averaged out.
` : ''}${LEGACY_WARMUP ? `- **Handler code was equivalent, with four small exceptions**, all fixed in the apps since:
  standalone Express read \`req.query\` field by field, which re-runs its query parser each time
  (query and list routes); on the full API route Asena and Elysia built the whole header map to
  read one header (the Asena Hono adapter also sorts it); the NestJS + Express validation DTO
  lacked one \`@IsDefined()\` the Fastify variant has. Each is worth at most a few percent on its
  route.
` : ''}- **No app checks \`Authorization\`** on the full API route. It is sent, but the scenario
  measures parsing, arithmetic and reshaping, not authentication.
- **NestJS bundles its own Express and Fastify.** Under NestJS they resolve to Express 5.2.1 and
  Fastify 5.11.3, slightly older than the standalone apps' versions.
- **The load generator shares the machine** with the server. The server sits alone on one CPU
  chiplet with its own L3 cache; \`wrk\` and PostgreSQL run on the other chiplet. Memory bandwidth
  and the I/O die are still shared.
${R[0]!.reps === 1
  ? `- **One run per scenario.** Differences of a few percent are within run-to-run noise; read
  close rows as a tie. On plaintext the top three are ${['asena-ergenecore', 'elysia', 'hono'].map((a) => n(rps(a, 'bun', 's1a'))).join(', ')} req/s — a tie.`
  : `- **${R[0]!.reps} runs per scenario**, median shown. Differences inside the spread are a tie.`}

The full contract, the harness, every app and every raw result are in
[AsenaJs/benchmark](https://github.com/AsenaJs/benchmark).
`;

const css = `/* Benchmark page — generated by tools/website-page.ts, edit that instead */

.bm-chart { margin: 28px 0 40px; }

.bm-row { display: flex; align-items: center; gap: 20px; padding: 6px 0; }

.bm-label {
  flex: 0 0 232px; text-align: right; font-size: 19px; font-weight: 500;
  color: var(--vp-c-text-1); letter-spacing: -0.01em; line-height: 1.25;
}
.bm-adapter {
  font-size: 12px; font-weight: 500; color: var(--vp-c-text-3);
  margin-left: 6px; letter-spacing: 0;
}
.bm-rt {
  display: inline-block; margin-left: 7px; padding: 1px 8px; vertical-align: 2px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: none;
  border-radius: 999px; color: var(--vp-c-text-3); background: var(--vp-c-bg-soft);
}
.bm-rt-node { color: #a3652a; background: rgba(203,132,64,.16); }

.bm-track { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; }

.bm-bar {
  height: 32px; border-radius: 999px; background: var(--vp-c-bg-soft);
  display: flex; align-items: center; justify-content: flex-end;
  transition: width .5s cubic-bezier(.22,1,.36,1); min-width: 32px;
}
.bm-out { font-size: 15px; font-weight: 500; color: var(--vp-c-text-2); white-space: nowrap; }
.bm-in {
  font-size: 15px; font-weight: 700; color: #fff; padding-right: 18px; white-space: nowrap;
}

.bm-row.is-first .bm-bar { background: linear-gradient(90deg, #a8e063 0%, #0dc6c4 100%); }
.bm-row.is-asena .bm-label { font-weight: 700; color: #0aa8a6; }
.bm-row.is-asena .bm-bar { background: linear-gradient(90deg, rgba(13,198,196,.28), rgba(13,198,196,.55)); }
.bm-row.is-asena.is-first .bm-bar { background: linear-gradient(90deg, #a8e063 0%, #0dc6c4 100%); }
.bm-row.is-asena .bm-out { color: #0aa8a6; font-weight: 700; }
.bm-row.is-nest .bm-label { color: var(--vp-c-text-2); }

.dark .bm-bar { background: var(--vp-c-bg-alt); }
.dark .bm-rt { background: var(--vp-c-bg-alt); }
.dark .bm-rt-node { color: #e6ab6d; background: rgba(203,132,64,.18); }
.dark .bm-row.is-asena .bm-label { color: #2ee6e4; }
.dark .bm-row.is-asena .bm-out { color: #2ee6e4; }

/* hero */
.bm-hero {
  display: flex; align-items: center; gap: 26px; margin: 34px 0 14px; padding: 26px 30px;
  border-radius: 18px; border: 1px solid var(--vp-c-divider);
  background: linear-gradient(120deg, rgba(168,224,99,.10), rgba(13,198,196,.12));
}
.bm-hero-num {
  font-size: 62px; font-weight: 800; line-height: 1; letter-spacing: -0.04em;
  background: linear-gradient(90deg, #7fc93a, #0dc6c4);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.bm-hero-num span { font-size: 34px; margin-left: 2px; }
.bm-hero-txt { display: flex; flex-direction: column; gap: 5px; }
.bm-hero-txt strong { font-size: 19px; }
.bm-hero-txt span { color: var(--vp-c-text-2); font-size: 15px; line-height: 1.5; }

.bm-hero-badges { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 10px; }
.bm-badge {
  display: flex; align-items: baseline; gap: 8px;
  padding: 7px 16px; border-radius: 999px;
  border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft);
}
.bm-badge b {
  font-size: 19px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
  background: linear-gradient(90deg, #7fc93a, #0dc6c4);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.bm-badge span { font-size: 13px; color: var(--vp-c-text-2); }
.bm-badges-note { font-size: 12.5px; color: var(--vp-c-text-3); margin: 0 0 42px; }

/* asena vs nest cards */
.bm-vs-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px; margin: 28px 0 34px;
}
.bm-vs-card {
  border: 1px solid var(--vp-c-divider); border-radius: 14px; padding: 20px;
  background: var(--vp-c-bg-soft);
}
.bm-vs-scenario { font-size: 13px; font-weight: 600; color: var(--vp-c-text-2); text-transform: uppercase; letter-spacing: .04em; }
.bm-vs-big {
  font-size: 46px; font-weight: 800; line-height: 1.1; margin: 8px 0 2px; letter-spacing: -0.03em;
  background: linear-gradient(90deg, #7fc93a, #0dc6c4);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.bm-vs-big span { font-size: 26px; }
.bm-vs-sub { font-size: 13px; color: var(--vp-c-text-2); line-height: 1.5; }
.bm-vs-sub strong { color: var(--vp-c-text-1); font-weight: 700; }
.bm-paren { color: var(--vp-c-text-3); white-space: nowrap; }
.bm-vs-alt {
  font-size: 12.5px; color: var(--vp-c-text-3); line-height: 1.5;
  margin: 10px 0 14px; padding-top: 10px; border-top: 1px dashed var(--vp-c-divider);
}
.bm-vs-alt b { font-size: 15px; font-weight: 700; color: var(--vp-c-text-2); font-variant-numeric: tabular-nums; }
.bm-vs-alt strong { color: var(--vp-c-text-2); font-weight: 700; }
.bm-vs-detail { display: flex; flex-direction: column; gap: 7px; border-top: 1px solid var(--vp-c-divider); padding-top: 13px; }
.bm-vs-detail div { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.bm-vs-detail b { font-size: 15px; font-variant-numeric: tabular-nums; }
.bm-vs-detail span { font-size: 12px; color: var(--vp-c-text-3); text-align: right; }
.bm-vs-detail .is-me b { color: #0aa8a6; font-weight: 700; }
.dark .bm-vs-detail .is-me b { color: #2ee6e4; }

/* node vs bun */
.bm-runtime-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px; margin: 26px 0 32px;
}
.bm-runtime-card {
  border: 1px solid var(--vp-c-divider); border-radius: 14px; padding: 18px;
  background: var(--vp-c-bg-soft);
}
.bm-rc-name { font-size: 16px; font-weight: 600; }
.bm-rc-gain {
  font-size: 34px; font-weight: 800; letter-spacing: -0.03em; margin: 6px 0 10px;
  background: linear-gradient(90deg, #7fc93a, #0dc6c4);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.bm-rc-rows { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--vp-c-text-2); font-variant-numeric: tabular-nums; }

@media (max-width: 700px) {
  .bm-label { flex-basis: 132px; font-size: 14px; }
  .bm-adapter { margin-left: 4px; }
  .bm-rt { margin-left: 5px; padding: 0 6px; font-size: 10px; }
  .bm-row { gap: 12px; }
  .bm-hero { flex-direction: column; align-items: flex-start; gap: 14px; }
  .bm-hero-num { font-size: 48px; }
}
`;

// Markdown turns any line indented four spaces or more into a code block, which splits
// the HTML block and leaves Vue staring at an unclosed <div>. Emit the markup flat.
const flat = md.replace(/^[ \t]+(?=<)/gm, '');

writeFileSync(OUT_MD, flat);
writeFileSync(OUT_CSS, css);
console.log(`written:\n  ${OUT_MD}\n  ${OUT_CSS}`);
