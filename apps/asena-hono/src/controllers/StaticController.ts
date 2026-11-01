import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { PublicStaticServe } from '../statics/PublicStaticServe';

@Controller('/static')
export class StaticController {
  @Get({ path: '/*', staticServe: PublicStaticServe })
  public static() {}
}
