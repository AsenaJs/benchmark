import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BenchUser } from './entities/bench-user.entity';
import { BenchWrite } from './entities/bench-write.entity';
import { CoreController } from './core/core.controller';
import { MetaController } from './meta/meta.controller';
import { ValidationController } from './validation/validation.controller';
import { DbModule } from './db/db.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
      logging: false,
      poolSize: 20,
      entities: [BenchUser, BenchWrite],
    }),
    DbModule,
  ],
  controllers: [MetaController, CoreController, ValidationController],
})
export class AppModule {}
