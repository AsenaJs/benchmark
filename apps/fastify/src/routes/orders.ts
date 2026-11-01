import type { FastifyPluginAsync } from 'fastify';

interface OrderItem {
  sku: string;
  qty: number;
  priceCents: number;
}

interface OrderBody {
  customer: { id: number; name: string; email: string };
  items: OrderItem[];
}

const orderRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { orderId: string }; Querystring: { currency?: string }; Body: OrderBody }>(
    '/api/orders/:orderId/items',
    async (req) => {
      const { customer, items } = req.body;
      const lines = items.map((item) => ({
        sku: item.sku,
        qty: item.qty,
        lineTotalCents: item.qty * item.priceCents,
      }));
      const subtotalCents = lines.reduce((acc, line) => acc + line.lineTotalCents, 0);
      const taxCents = Math.round(subtotalCents * 0.08);
      return {
        orderId: Number(req.params.orderId),
        requestId: req.headers['x-request-id'] ?? '',
        currency: req.query.currency ?? 'USD',
        customer: { id: customer.id, name: customer.name },
        itemCount: items.length,
        totalQty: items.reduce((acc, item) => acc + item.qty, 0),
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        lines,
      };
    },
  );
};

export default orderRoutes;
