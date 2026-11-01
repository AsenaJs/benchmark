import { StaticServe } from '@asenajs/asena/decorators';
import { StaticServeService } from '@asenajs/hono-adapter';
import path from 'node:path';

@StaticServe({ root: path.join(process.cwd(), 'public') })
export class PublicStaticServe extends StaticServeService {
  public rewriteRequestPath(reqPath: string): string {
    return reqPath.replace(/^\/static\/?/, '').replace(/\.\./g, '');
  }
}
