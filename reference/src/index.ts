/**
 * Reference implementation of the benchmark contract on plain Bun.serve.
 *
 * Not a competitor — it exists so run-all.ts can be proven end to end before the
 * eight real apps are built, and so an app agent has an unambiguous answer to
 * "what exactly should this endpoint return?".
 */
import { SQL } from 'bun';
import { z } from 'zod';
import { join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dir, '..', 'public');

const sql = new SQL({ url: process.env.DATABASE_URL!, max: 20 });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const CITIES = ['Istanbul', 'London', 'Paris', 'Berlin', 'Madrid', 'Rome', 'Vienna', 'Prague', 'Lisbon', 'Dublin'];

const userSchema = z.object({
  name: z.string().min(3).max(50),
  email: z.email(),
  age: z.number().int().min(18).max(120),
  tags: z.array(z.string()).min(1).max(10),
  address: z.object({ city: z.string().min(1), zip: z.string().min(3) }),
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};

async function serveStatic(req: Request): Promise<Response> {
  const rel = decodeURIComponent(new URL(req.url).pathname.slice('/static/'.length));
  const abs = normalize(join(PUBLIC, rel));
  if (!abs.startsWith(PUBLIC + '/')) return new Response('Forbidden', { status: 403 });
  const file = Bun.file(abs);
  if (!(await file.exists())) return new Response('Not Found', { status: 404 });
  const ext = abs.slice(abs.lastIndexOf('.'));
  return new Response(file, { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' } });
}

async function readOne(id: number): Promise<Response> {
  const rows = await sql`SELECT id, name, email, age, city FROM bench_users WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  return json(rows[0]);
}

async function readList(url: URL): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100);
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
  const items = await sql`
    SELECT id, name, email, age, city FROM bench_users
    ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`;
  return json({ count: items.length, items });
}

async function writeOne(req: Request): Promise<Response> {
  const b = (await req.json()) as { name: string; email: string; age: number; city: string };
  const [row] = await sql`
    INSERT INTO bench_writes (name, email, age, city)
    VALUES (${b.name}, ${b.email}, ${b.age}, ${b.city})
    RETURNING id`;
  return json({ id: row.id, created: true }, 201);
}

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  development: false,

  routes: {
    '/__bench/meta': json({
      app: 'reference',
      framework: 'Bun.serve',
      frameworkVersion: Bun.version,
      dbLayer: 'Bun.sql',
      validator: 'zod',
    }),

    '/hello': new Response('Hello, World!', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),

    '/json': () => json({ message: 'Hello, World!' }),

    '/query': (req: Request) => {
      const q = new URL(req.url).searchParams;
      const name = q.get('name') ?? 'anonymous';
      const page = Number(q.get('page') ?? 1) || 1;
      const size = Number(q.get('size') ?? 10) || 10;
      const sort = q.get('sort') ?? 'asc';
      return json({ name, page, size, sort, offset: (page - 1) * size });
    },

    '/params/:id/items/:itemId': (req: Bun.BunRequest<'/params/:id/items/:itemId'>) => {
      const id = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      return json({ id, itemId, sum: id + itemId });
    },

    '/api/orders/:orderId/items': {
      POST: async (req: Bun.BunRequest<'/api/orders/:orderId/items'>) => {
        const body = (await req.json()) as {
          customer: { id: number; name: string; email: string };
          items: { sku: string; qty: number; priceCents: number }[];
        };
        const lines = body.items.map((i) => ({
          sku: i.sku,
          qty: i.qty,
          lineTotalCents: i.qty * i.priceCents,
        }));
        const subtotalCents = lines.reduce((a, l) => a + l.lineTotalCents, 0);
        const taxCents = Math.round(subtotalCents * 0.08);
        return json({
          orderId: Number(req.params.orderId),
          requestId: req.headers.get('x-request-id') ?? '',
          currency: new URL(req.url).searchParams.get('currency') ?? 'USD',
          customer: { id: body.customer.id, name: body.customer.name },
          itemCount: body.items.length,
          totalQty: body.items.reduce((a, i) => a + i.qty, 0),
          subtotalCents,
          taxCents,
          totalCents: subtotalCents + taxCents,
          lines,
        });
      },
    },

    '/validate/user': {
      POST: async (req: Request) => {
        const parsed = userSchema.safeParse(await req.json());
        if (!parsed.success) return json({ error: 'validation_failed' }, 400);
        const d = parsed.data;
        return json({
          ok: true,
          name: d.name,
          email: d.email,
          age: d.age,
          tagCount: d.tags.length,
          city: d.address.city,
        });
      },
    },

    '/static/*': serveStatic,

    '/db/user/:id': (req: Bun.BunRequest<'/db/user/:id'>) => readOne(Number(req.params.id)),
    '/db/users': (req: Request) => readList(new URL(req.url)),
    '/db/user': { POST: writeOne },

    // The Asena apps back these with drizzle; here they mirror /db/* so the
    // harness can exercise the asena-only branch of the contract.
    '/db/orm/user/:id': (req: Bun.BunRequest<'/db/orm/user/:id'>) => readOne(Number(req.params.id)),
    '/db/orm/users': (req: Request) => readList(new URL(req.url)),
    '/db/orm/user': { POST: writeOne },
  },

  fetch: () => new Response('Not Found', { status: 404 }),
});

console.log(`reference listening on :${server.port}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.stop(true);
    process.exit(0);
  });
}
