import { Controller } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { type Context } from '@asenajs/ergenecore';
import { BenchUserOrmService } from '../services/BenchUserOrmService';
import type { NewBenchUserDto } from '../validators/BenchUserValidator';

const MAX_LIMIT = 100;

/** Same contract as DbController, served through Drizzle instead of raw SQL. */
@Controller('/db/orm')
export class DbOrmController {
  @Inject(BenchUserOrmService)
  private benchUserOrmService!: BenchUserOrmService;

  @Get('/user/:id')
  public async getById(context: Context) {
    const user = await this.benchUserOrmService.getById(Number(context.getParam('id')));

    if (!user) return context.send({ error: 'not_found' }, 404);

    return context.send(user, 200);
  }

  @Get('/users')
  public async list(context: Context) {
    const limit = Math.min(Number(await context.getQuery('limit')) || 20, MAX_LIMIT);
    const offset = Number(await context.getQuery('offset')) || 0;
    const items = await this.benchUserOrmService.getPage(limit, offset);

    return context.send({ count: items.length, items }, 200);
  }

  @Post('/user')
  public async create(context: Context) {
    const id = await this.benchUserOrmService.create(await context.getBody<NewBenchUserDto>());

    return context.send({ id, created: true }, 201);
  }
}
