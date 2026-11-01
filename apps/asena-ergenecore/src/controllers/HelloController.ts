import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { type Context } from '@asenajs/ergenecore';

@Controller('/')
export class HelloController {
  @Get('/hello')
  public hello(context: Context) {
    return context.send('Hello, World!', 200);
  }

  @Get('/json')
  public json(context: Context) {
    return context.send({ message: 'Hello, World!' }, 200);
  }
}
