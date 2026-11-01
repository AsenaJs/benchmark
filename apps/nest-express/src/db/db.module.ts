import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BenchUser } from '../entities/bench-user.entity';
import { BenchWrite } from '../entities/bench-write.entity';
import { DbController } from './db.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BenchUser, BenchWrite])],
  controllers: [DbController],
})
export class DbModule {}
