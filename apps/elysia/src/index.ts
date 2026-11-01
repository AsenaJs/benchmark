import { Elysia, t } from 'elysia'
import { staticPlugin } from '@elysiajs/static'
import { SQL } from 'bun'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 3005)

const sql = new SQL({ url: process.env.DATABASE_URL!, max: 20 })

const publicDir = join(import.meta.dir, '..', 'public')

interface OrderBody {
  customer: { id: number; name: string; email: string }
  items: { sku: string; qty: number; priceCents: number }[]
}

const app = new Elysia()
  .onError(({ code, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'validation_failed' }
    }
  })
  .get('/__bench/meta', () => ({
    app: 'elysia',
    framework: 'elysia',
    frameworkVersion: '1.4.30',
    dbLayer: 'Bun.SQL',
    validator: 'elysia-typebox',
  }))
  .get('/hello', () => 'Hello, World!')
  .get('/json', () => ({ message: 'Hello, World!' }))
  .get('/query', ({ query }) => {
    const name = query.name ?? 'anonymous'
    const page = Number(query.page ?? 1) || 1
    const size = Number(query.size ?? 10) || 10
    const sort = query.sort ?? 'asc'
    return { name, page, size, sort, offset: (page - 1) * size }
  })
  .get('/params/:id/items/:itemId', ({ params }) => {
    const id = Number(params.id)
    const itemId = Number(params.itemId)
    return { id, itemId, sum: id + itemId }
  })
  .post('/api/orders/:orderId/items', ({ params, query, headers, body }) => {
    const order = body as OrderBody
    {
      const lines = order.items.map((i) => ({
        sku: i.sku,
        qty: i.qty,
        lineTotalCents: i.qty * i.priceCents,
      }))
      const subtotalCents = lines.reduce((a, l) => a + l.lineTotalCents, 0)
      const taxCents = Math.round(subtotalCents * 0.08)
      return {
        orderId: Number(params.orderId),
        requestId: headers['x-request-id'] ?? '',
        currency: query.currency ?? 'USD',
        customer: { id: order.customer.id, name: order.customer.name },
        itemCount: order.items.length,
        totalQty: order.items.reduce((a, i) => a + i.qty, 0),
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        lines,
      }
    }
  })
  .post(
    '/validate/user',
    ({ body }) => ({
      ok: true,
      name: body.name,
      email: body.email,
      age: body.age,
      tagCount: body.tags.length,
      city: body.address.city,
    }),
    {
      body: t.Object({
        name: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ format: 'email' }),
        age: t.Integer({ minimum: 18, maximum: 120 }),
        tags: t.Array(t.String(), { minItems: 1, maxItems: 10 }),
        address: t.Object({
          city: t.String({ minLength: 1 }),
          zip: t.String({ minLength: 3 }),
        }),
      }),
    },
  )
  .get(
    '/db/user/:id',
    async ({ params, set }) => {
      const rows =
        await sql`SELECT id, name, email, age, city FROM bench_users WHERE id = ${Number(params.id)}`
      if (rows.length === 0) {
        set.status = 404
        return { error: 'not_found' }
      }
      return rows[0]
    },
  )
  .get(
    '/db/users',
    async ({ query }) => {
      const limit = Math.min(Number(query.limit ?? 20) || 20, 100)
      const offset = Number(query.offset ?? 0) || 0
      const items = await sql`
        SELECT id, name, email, age, city FROM bench_users
        ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`
      return { count: items.length, items }
    },
  )
  .post(
    '/db/user',
    async ({ body, set }) => {
      const b = body as { name: string; email: string; age: number; city: string }
      const [row] = await sql`
        INSERT INTO bench_writes (name, email, age, city)
        VALUES (${b.name}, ${b.email}, ${b.age}, ${b.city})
        RETURNING id`
      set.status = 201
      return { id: row.id, created: true } as const
    },
  )
  .use(staticPlugin({ prefix: '/static', assets: publicDir, alwaysStatic: false, etag: false }))
  .listen(PORT)

console.log(`elysia listening on :${app.server!.port}`)

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    app.stop()
    process.exit(0)
  })
}
