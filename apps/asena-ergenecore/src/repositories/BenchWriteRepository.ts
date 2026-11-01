import { BaseRepository, Repository } from '@asenajs/asena-drizzle';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { benchWrites } from '../database/schemas/bench.schema';
import type Schemas from '../database/schemas';
import type { NewBenchUserDto } from '../validators/BenchUserValidator';

@Repository({
  table: benchWrites,
  databaseService: 'BenchDatabase',
  name: 'BenchWriteRepository',
})
export class BenchWriteRepository extends BaseRepository<typeof benchWrites, BunSQLDatabase<typeof Schemas>> {
  public async insertRow(dto: NewBenchUserDto): Promise<number> {
    const [row] = await this.db.insert(benchWrites).values(dto).returning({ id: benchWrites.id });

    return row!.id;
  }
}
