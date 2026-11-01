import { Controller } from '@asenajs/asena/decorators';
import { Post } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { type Context } from '@asenajs/hono-adapter';
import { OrderService, type OrderDto } from '../services/OrderService';

@Controller('/api/orders')
export class OrderController {
  @Inject(OrderService)
  private orderService!: OrderService;

  @Post('/:orderId/items')
  public async addItems(context: Context) {
    const dto = await context.getBody<OrderDto>();
    const orderId = Number(context.getParam('orderId'));
    const requestId = context.headers['x-request-id'] ?? '';
    const currency = (await context.getQuery('currency')) || 'USD';

    return context.send(this.orderService.summarise(orderId, requestId, currency, dto), 200);
  }
}
