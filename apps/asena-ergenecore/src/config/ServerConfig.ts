import { Config } from '@asenajs/asena/decorators';
import { isHttpException, isValidationError } from '@asenajs/asena/adapter';
import { ConfigService, type Context } from '@asenajs/ergenecore';

@Config()
export class ServerConfig extends ConfigService {
  public onError(error: Error, context: Context) {
    if (isValidationError(error)) return context.send({ error: 'validation_failed' }, 400);

    if (isHttpException(error)) return error.getResponse?.() ?? context.send({ error: 'http' }, 500);

    return context.send({ error: 'internal' }, 500);
  }
}
