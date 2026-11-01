import { Controller, Get } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: frameworkVersion } = require('@nestjs/common/package.json');

@Controller('__bench/meta')
export class MetaController {
  @Get()
  getMeta(): Record<string, string> {
    return {
      app: 'nest-express',
      framework: '@nestjs/platform-express',
      frameworkVersion,
      dbLayer: 'typeorm',
      validator: 'class-validator',
    };
  }
}
