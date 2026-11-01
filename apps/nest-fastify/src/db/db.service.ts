import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BenchUser } from './entities/bench-user.entity';
import { BenchWrite } from './entities/bench-write.entity';

export interface WriteBody {
  name: string;
  email: string;
  age: number;
  city: string;
}

@Injectable()
export class DbService {
  constructor(
    @InjectRepository(BenchUser)
    private readonly users: Repository<BenchUser>,
    @InjectRepository(BenchWrite)
    private readonly writes: Repository<BenchWrite>,
  ) {}

  findUser(id: number): Promise<BenchUser | null> {
    return this.users.findOneBy({ id });
  }

  listUsers(limit: number, offset: number): Promise<BenchUser[]> {
    return this.users.find({ order: { id: 'ASC' }, take: limit, skip: offset });
  }

  async createUser(body: WriteBody): Promise<number> {
    const result = await this.writes.insert(body);

    return result.identifiers[0].id as number;
  }
}
