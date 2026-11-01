import express from 'express';
import { join } from 'node:path';
import { pool } from './db';
import dbRouter from './routes/db';
import validationRouter from './routes/validation';

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_DIR = join(__dirname, '..', 'public');
const { version: expressVersion } = require('express/package.json') as { version: string };

type OrderBody = {
  customer: { id: number; name: string; email: string };
  items: { sku: string; qty: number; priceCents: number }[];
};

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

app.get('/__bench/meta', (_req, res) => {
  res.json({
    app: 'express',
    framework: 'express',
    frameworkVersion: expressVersion,
    dbLayer: 'pg',
    validator: 'zod',
  });
});

app.get('/hello', (_req, res) => {
  res.type('text/plain').send('Hello, World!');
});

app.get('/json', (_req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.get('/query', (req, res) => {
  // Express 5 re-parses the query string on every req.query read
  const q = req.query;
  const name = q.name ?? 'anonymous';
  const page = Number(q.page ?? 1) || 1;
  const size = Number(q.size ?? 10) || 10;
  const sort = q.sort ?? 'asc';
  res.json({ name, page, size, sort, offset: (page - 1) * size });
});

app.get('/params/:id/items/:itemId', (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  res.json({ id, itemId, sum: id + itemId });
});

app.post('/api/orders/:orderId/items', express.json(), (req, res) => {
  const body = req.body as OrderBody;
  const lines = body.items.map((item) => ({
    sku: item.sku,
    qty: item.qty,
    lineTotalCents: item.qty * item.priceCents,
  }));
  const subtotalCents = lines.reduce((acc, line) => acc + line.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * 0.08);
  res.json({
    orderId: Number(req.params.orderId),
    requestId: req.get('x-request-id') ?? '',
    currency: (req.query.currency as string | undefined) ?? 'USD',
    customer: { id: body.customer.id, name: body.customer.name },
    itemCount: body.items.length,
    totalQty: body.items.reduce((acc, item) => acc + item.qty, 0),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    lines,
  });
});

app.use('/validate', validationRouter);
app.use('/db', dbRouter);
app.use('/static', express.static(PUBLIC_DIR, { etag: false, lastModified: false }));

const server = app.listen(PORT, () => {
  console.log(`express listening on :${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
