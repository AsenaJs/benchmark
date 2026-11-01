import 'reflect-metadata';
import { AsenaServerFactory } from '@asenajs/asena';
import { createHonoAdapter } from '@asenajs/hono-adapter';
import { logger } from './logger/logger';

const [adapter] = createHonoAdapter({ logger });

const server = await AsenaServerFactory.create({
  adapter,
  logger,
  port: Number(process.env.PORT ?? 3007),
});

await server.start();
