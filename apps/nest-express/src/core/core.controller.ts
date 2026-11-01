import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  Header,
  Headers,
  HttpCode,
} from '@nestjs/common';

interface OrderItem {
  sku: string;
  qty: number;
  priceCents: number;
}

interface OrderBody {
  customer: { id: number; name: string; email: string };
  items: OrderItem[];
  note?: string;
}

@Controller()
export class CoreController {
  @Get('hello')
  @Header('Content-Type', 'text/plain')
  hello(): string {
    return 'Hello, World!';
  }

  @Get('json')
  json(): { message: string } {
    return { message: 'Hello, World!' };
  }

  @Get('query')
  query(@Query() q: Record<string, string | undefined>): {
    name: string;
    page: number;
    size: number;
    sort: string;
    offset: number;
  } {
    const name = q.name ?? 'anonymous';
    const page = Number(q.page ?? 1) || 1;
    const size = Number(q.size ?? 10) || 10;
    const sort = q.sort ?? 'asc';
    return { name, page, size, sort, offset: (page - 1) * size };
  }

  @Get('params/:id/items/:itemId')
  params(@Param('id') id: string, @Param('itemId') itemId: string): {
    id: number;
    itemId: number;
    sum: number;
  } {
    const nId = Number(id);
    const nItemId = Number(itemId);
    return { id: nId, itemId: nItemId, sum: nId + nItemId };
  }

  @Post('api/orders/:orderId/items')
  @HttpCode(200)
  createOrder(
    @Param('orderId') orderId: string,
    @Query('currency') currency: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: OrderBody,
  ): Record<string, unknown> {
    const lines = body.items.map((i) => ({
      sku: i.sku,
      qty: i.qty,
      lineTotalCents: i.qty * i.priceCents,
    }));
    const subtotalCents = lines.reduce((a, l) => a + l.lineTotalCents, 0);
    const taxCents = Math.round(subtotalCents * 0.08);
    return {
      orderId: Number(orderId),
      requestId: requestId ?? '',
      currency: currency ?? 'USD',
      customer: { id: body.customer.id, name: body.customer.name },
      itemCount: body.items.length,
      totalQty: body.items.reduce((a, i) => a + i.qty, 0),
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      lines,
    };
  }
}
