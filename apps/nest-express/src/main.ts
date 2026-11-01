import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });

  const express = app.getHttpAdapter().getInstance() as import('express').Express;
  express.disable('x-powered-by');
  express.set('etag', false);

  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/static/',
    etag: false,
    lastModified: false,
  });

  const port = Number(process.env.PORT ?? 3003);
  await app.listen(port);
}

void bootstrap();
