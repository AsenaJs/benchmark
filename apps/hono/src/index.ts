import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SQL } from 'bun';

const port = Number(process.env.PORT ?? 3006);

const sql = new SQL({ url: process.env.DATABASE_URL!, max: 20 });

const app = new Hono();

// ---- meta ----
app.get('/__bench/meta', (c) =>
  c.json({
    app: 'hono',
    framework: 'Hono',
    frameworkVersion: '4.13.14',
    dbLayer: 'bun:sql',
    validator: '@hono/zod-validator',
  })
);

// ---- S1 hello world ----
app.get('/hello', (c) => c.text('Hello, World!'));
app.get('/json', (c) => c.json({ message: 'Hello, World!' }));

// ---- S2 query & params ----
app.get('/query', (c) => {
  const q = c.req.query();
  const name = q.name ?? 'anonymous';
  const page = Number(q.page ?? 1) || 1;
  const size = Number(q.size ?? 10) || 10;
  const sort = q.sort ?? 'asc';
  return c.json({ name, page, size, sort, offset: (page - 1) * size });
});

app.get('/params/:id/items/:itemId', (c) => {
  const id = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  return c.json({ id, itemId, sum: id + itemId });
});

// ---- S3 comprehensive api ----
interface OrderBody {
  customer: { id: number; name: string; email: string };
  items: { sku: string; qty: number; priceCents: number }[];
}

app.post('/api/orders/:orderId/items', async (c) => {
  const { customer, items } = await c.req.json<OrderBody>();
  const lines = items.map((i) => ({
    sku: i.sku,
    qty: i.qty,
    lineTotalCents: i.qty * i.priceCents,
  }));
  const subtotalCents = lines.reduce((a, l) => a + l.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * 0.08);
  return c.json({
    orderId: Number(c.req.param('orderId')),
    requestId: c.req.header('X-Request-Id') ?? '',
    currency: c.req.query('currency') ?? 'USD',
    customer: { id: customer.id, name: customer.name },
    itemCount: items.length,
    totalQty: items.reduce((a, i) => a + i.qty, 0),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    lines,
  });
});

// ---- S4 static ----
app.use(
  '/static/*',
  serveStatic({
    root: './public',
    rewriteRequestPath: (path) => path.replace(/^\/static/, ''),
  })
);

// ---- S5 validation ----
const userSchema = z.object({
  name: z.string().min(3).max(50),
  email: z.email(),
  age: z.number().int().min(18).max(120),
  tags: z.array(z.string()).min(1).max(10),
  address: z.object({ city: z.string().min(1), zip: z.string().min(3) }),
});

app.post('/validate/user', zValidator('json', userSchema), (c) => {
  const d = c.req.valid('json');
  return c.json({
    ok: true,
    name: d.name,
    email: d.email,
    age: d.age,
    tagCount: d.tags.length,
    city: d.address.city,
  });
});

// ---- S6 database ----
app.get('/db/user/:id', async (c) => {
  const rows = await sql`SELECT id, name, email, age, city FROM bench_users WHERE id = ${Number(c.req.param('id'))}`;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json(rows[0]);
});

app.get('/db/users', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 100);
  const offset = Number(c.req.query('offset') ?? 0) || 0;
  const items = await sql`SELECT id, name, email, age, city FROM bench_users ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`;
  return c.json({ count: items.length, items });
});

app.post('/db/user', async (c) => {
  const b = (await c.req.json()) as { name: string; email: string; age: number; city: string };
  const [row] = await sql`
    INSERT INTO bench_writes (name, email, age, city)
    VALUES (${b.name}, ${b.email}, ${b.age}, ${b.city})
    RETURNING id`;
  return c.json({ id: row.id, created: true }, 201);
});

export default {
  port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
} satisfies Bun.ServeOptions;
