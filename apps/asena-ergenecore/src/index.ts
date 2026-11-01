import 'reflect-metadata';
import { AsenaServerFactory } from '@asenajs/asena';
import { createErgenecoreAdapter } from '@asenajs/ergenecore';
import { logger } from './logger/logger';

const adapter = createErgenecoreAdapter({ logger });

const server = await AsenaServerFactory.create({
  adapter,
  logger,
  port: Number(process.env.PORT ?? 3008),
});

await server.start();
