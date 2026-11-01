import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3004);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  app.useStaticAssets({
    root: join(__dirname, '..', 'public'),
    prefix: '/static/',
    etag: false,
    lastModified: false,
  });
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
