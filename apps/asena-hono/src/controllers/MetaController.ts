import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { type Context } from '@asenajs/hono-adapter';

const meta = {
  app: 'asena-hono',
  framework: '@asenajs/hono-adapter',
  frameworkVersion: '5.0.2',
  dbLayer: 'Bun.sql + drizzle',
  validator: 'zod',
};

/** Identifies this app to the benchmark harness. Not measured. */
@Controller('/__bench')
export class MetaController {
  @Get('/meta')
  public describe(context: Context) {
    return context.send(meta, 200);
  }
}
