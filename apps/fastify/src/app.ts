import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { pool } from './db';
import metaRoutes from './routes/meta';
import helloRoutes from './routes/hello';
import queryRoutes from './routes/query';
import paramsRoutes from './routes/params';
import orderRoutes from './routes/orders';
import validateUserRoutes from './routes/validate-user';
import dbRoutes from './routes/db';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.register(metaRoutes);
  app.register(helloRoutes);
  app.register(queryRoutes);
  app.register(paramsRoutes);
  app.register(orderRoutes);
  app.register(validateUserRoutes);
  app.register(dbRoutes);

  app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/static/',
    etag: false,
    lastModified: false,
  });

  return app;
}
