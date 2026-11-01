import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BenchUser } from '../entities/bench-user.entity';
import { BenchWrite } from '../entities/bench-write.entity';

interface WriteBody {
  name: string;
  email: string;
  age: number;
  city: string;
}

@Controller('db')
export class DbController {
  constructor(
    @InjectRepository(BenchUser)
    private readonly users: Repository<BenchUser>,
    @InjectRepository(BenchWrite)
    private readonly writes: Repository<BenchWrite>,
  ) {}

  @Get('user/:id')
  async readOne(@Param('id') id: string): Promise<BenchUser> {
    const user = await this.users.findOneBy({ id: Number(id) });
    if (!user) throw new NotFoundException({ error: 'not_found' });
    return user;
  }

  @Get('users')
  async readList(
    @Query() q: Record<string, string | undefined>,
  ): Promise<{ count: number; items: BenchUser[] }> {
    const limit = Math.min(Number(q.limit ?? 20) || 20, 100);
    const offset = Number(q.offset ?? 0) || 0;
    const items = await this.users.find({
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });
    return { count: items.length, items };
  }

  @Post('user')
  @HttpCode(201)
  async writeOne(@Body() b: WriteBody): Promise<{ id: number; created: boolean }> {
    const result = await this.writes.insert(b);
    return { id: result.identifiers[0].id as number, created: true };
  }
}
