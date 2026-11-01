import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('/api/orders')
export class OrdersController {
  @Post(':orderId/items')
  @HttpCode(HttpStatus.OK)
  createOrder(
    @Param('orderId') orderId: string,
    @Query('currency') currency: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: CreateOrderDto,
  ) {
    const lines = body.items.map((item) => ({
      sku: item.sku,
      qty: item.qty,
      lineTotalCents: item.qty * item.priceCents,
    }));
    const subtotalCents = lines.reduce((acc, line) => acc + line.lineTotalCents, 0);
    const taxCents = Math.round(subtotalCents * 0.08);
    return {
      orderId: Number(orderId),
      requestId: requestId ?? '',
      currency: currency ?? 'USD',
      customer: { id: body.customer.id, name: body.customer.name },
      itemCount: body.items.length,
      totalQty: body.items.reduce((acc, item) => acc + item.qty, 0),
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      lines,
    };
  }
}
