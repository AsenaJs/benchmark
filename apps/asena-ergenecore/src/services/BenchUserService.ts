import { Service } from '@asenajs/asena/decorators';
import { SQL } from 'bun';
import type { NewBenchUserDto } from '../validators/BenchUserValidator';

export interface BenchUser {
  id: number;
  name: string;
  email: string;
  age: number;
  city: string;
}

/** Reads and writes over Bun's native SQL client — no ORM in this path. */
@Service('BenchUserService')
export class BenchUserService {
  private sql = new SQL({ url: process.env.DATABASE_URL, max: 20 });

  public async getById(id: number): Promise<BenchUser | null> {
    const rows = await this.sql`SELECT id, name, email, age, city FROM bench_users WHERE id = ${id}`;

    return (rows[0] as BenchUser) ?? null;
  }

  public getPage(limit: number, offset: number): Promise<BenchUser[]> {
    return this.sql`
      SELECT id, name, email, age, city FROM bench_users
      ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`;
  }

  public async create(dto: NewBenchUserDto): Promise<number> {
    const [row] = await this.sql`
      INSERT INTO bench_writes (name, email, age, city)
      VALUES (${dto.name}, ${dto.email}, ${dto.age}, ${dto.city})
      RETURNING id`;

    return row.id as number;
  }
}
