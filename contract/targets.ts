/**
 * The 12 measurement targets = 8 apps, four of which run on both Node and Bun.
 *
 * The harness never hardcodes how an app builds or starts: it calls the app's own
 * package.json scripts. That keeps every framework's real production entrypoint
 * intact and stops the harness from silently advantaging one of them.
 */

export type Runtime = 'node' | 'bun';

export interface Target {
  /** `<app>-<runtime>`, used for result filenames */
  id: string;
  app: string;
  dir: string;
  framework: string;
  runtime: Runtime;
  port: number;
  /** package.json script that produces the runnable artifact; null = nothing to build */
  buildScript: string | null;
  /** package.json script that starts the server on $PORT */
  startScript: string;
  /** what backs /db/* — printed in the report, because it is NOT uniform */
  dbLayer: string;
  validator: string;
}

interface AppSpec {
  app: string;
  framework: string;
  port: number;
  runtimes: Runtime[];
  buildScript: string | null;
  dbLayer: string;
  validator: string;
}

const APPS: AppSpec[] = [
  { app: 'express',          framework: 'Express 5',            port: 3001, runtimes: ['node', 'bun'], buildScript: 'build', dbLayer: 'pg',      validator: 'zod' },
  { app: 'fastify',          framework: 'Fastify 5',            port: 3002, runtimes: ['node', 'bun'], buildScript: 'build', dbLayer: 'pg',      validator: 'ajv (JSON Schema)' },
  { app: 'nest-express',     framework: 'NestJS 11 + Express',  port: 3003, runtimes: ['node', 'bun'], buildScript: 'build', dbLayer: 'TypeORM', validator: 'class-validator' },
  { app: 'nest-fastify',     framework: 'NestJS 11 + Fastify',  port: 3004, runtimes: ['node', 'bun'], buildScript: 'build', dbLayer: 'TypeORM', validator: 'class-validator' },
  { app: 'elysia',           framework: 'Elysia 1.4',           port: 3005, runtimes: ['bun'],         buildScript: null,    dbLayer: 'Bun.sql', validator: 'TypeBox' },
  { app: 'hono',             framework: 'Hono 4',               port: 3006, runtimes: ['bun'],         buildScript: null,    dbLayer: 'Bun.sql', validator: 'zod' },
  { app: 'asena-hono',       framework: 'Asena + hono-adapter', port: 3007, runtimes: ['bun'],         buildScript: 'build', dbLayer: 'Bun.sql + drizzle', validator: 'zod' },
  { app: 'asena-ergenecore', framework: 'Asena + ergenecore',   port: 3008, runtimes: ['bun'],         buildScript: 'build', dbLayer: 'Bun.sql + drizzle', validator: 'zod' },
];

/** Harness smoke target: a plain Bun.serve app implementing the whole contract. */
const REFERENCE: AppSpec = {
  app: 'reference', framework: 'Bun.serve (reference)', port: 3000,
  runtimes: ['bun'], buildScript: null, dbLayer: 'Bun.sql + drizzle', validator: 'zod',
};

function expand(spec: AppSpec, dirBase: string): Target[] {
  return spec.runtimes.map((runtime) => ({
    id: `${spec.app}-${runtime}`,
    app: spec.app,
    dir: `${dirBase}/${spec.app}`,
    framework: spec.framework,
    runtime,
    port: spec.port,
    buildScript: spec.buildScript,
    startScript: runtime === 'node' ? 'start:node' : 'start:bun',
    dbLayer: spec.dbLayer,
    validator: spec.validator,
  }));
}

export const TARGETS: Target[] = APPS.flatMap((s) => expand(s, 'apps'));
export const REFERENCE_TARGET: Target = expand(REFERENCE, '.')[0]!;

export const ALL_TARGETS: Target[] = [REFERENCE_TARGET, ...TARGETS];

export function resolveTargets(only?: string[], skip?: string[]): Target[] {
  let list = TARGETS;
  if (only?.length) {
    list = ALL_TARGETS.filter((t) => only.includes(t.app) || only.includes(t.id));
  }
  if (skip?.length) {
    list = list.filter((t) => !skip.includes(t.app) && !skip.includes(t.id));
  }
  return list;
}
