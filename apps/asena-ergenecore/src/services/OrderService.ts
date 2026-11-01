import { Service } from '@asenajs/asena/decorators';

export interface OrderItem {
  sku: string;
  qty: number;
  priceCents: number;
}

export interface OrderDto {
  customer: { id: number; name: string; email: string };
  items: OrderItem[];
  note: string;
}

const TAX_RATE = 0.08;

@Service('OrderService')
export class OrderService {
  public summarise(orderId: number, requestId: string, currency: string, dto: OrderDto) {
    const lines = dto.items.map((item) => ({
      sku: item.sku,
      qty: item.qty,
      lineTotalCents: item.qty * item.priceCents,
    }));

    const subtotalCents = lines.reduce((total, line) => total + line.lineTotalCents, 0);
    const taxCents = Math.round(subtotalCents * TAX_RATE);

    return {
      orderId,
      requestId,
      currency,
      customer: { id: dto.customer.id, name: dto.customer.name },
      itemCount: dto.items.length,
      totalQty: dto.items.reduce((total, item) => total + item.qty, 0),
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      lines,
    };
  }
}
