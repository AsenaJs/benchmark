import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { QueryController } from './query/query.controller';
import { ParamsController } from './params/params.controller';
import { OrdersController } from './orders/orders.controller';
import { ValidateController } from './validate/validate.controller';
import { DbController } from './db/db.controller';
import { DbService } from './db/db.service';
import { BenchUser } from './db/entities/bench-user.entity';
import { BenchWrite } from './db/entities/bench-write.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [BenchUser, BenchWrite],
      synchronize: false,
      poolSize: 20,
    }),
    TypeOrmModule.forFeature([BenchUser, BenchWrite]),
  ],
  controllers: [
    AppController,
    QueryController,
    ParamsController,
    OrdersController,
    ValidateController,
    DbController,
  ],
  providers: [DbService],
})
export class AppModule {}
