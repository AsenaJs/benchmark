import { Controller, Get } from '@nestjs/common';
import { version as frameworkVersion } from '@nestjs/common/package.json';

@Controller()
export class AppController {
  @Get('/__bench/meta')
  getMeta() {
    return {
      app: 'nest-fastify',
      framework: 'NestJS (Fastify)',
      frameworkVersion,
      dbLayer: 'TypeORM 1.x',
      validator: 'class-validator',
    };
  }

  @Get('/hello')
  getHello(): string {
    return 'Hello, World!';
  }

  @Get('/json')
  getJson() {
    return { message: 'Hello, World!' };
  }
}
