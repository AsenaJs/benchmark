import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { type Context } from '@asenajs/hono-adapter';

@Controller('/')
export class QueryController {
  @Get('/query')
  public async query(context: Context) {
    const name = (await context.getQuery('name')) || 'anonymous';
    const page = Number(await context.getQuery('page')) || 1;
    const size = Number(await context.getQuery('size')) || 10;
    const sort = (await context.getQuery('sort')) || 'asc';

    return context.send({ name, page, size, sort, offset: (page - 1) * size }, 200);
  }

  @Get('/params/:id/items/:itemId')
  public params(context: Context) {
    const id = Number(context.getParam('id'));
    const itemId = Number(context.getParam('itemId'));

    return context.send({ id, itemId, sum: id + itemId }, 200);
  }
}
