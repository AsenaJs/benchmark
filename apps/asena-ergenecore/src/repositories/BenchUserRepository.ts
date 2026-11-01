import { BaseRepository, Repository } from '@asenajs/asena-drizzle';
import { asc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { benchUsers } from '../database/schemas/bench.schema';
import type Schemas from '../database/schemas';

const columns = {
  id: benchUsers.id,
  name: benchUsers.name,
  email: benchUsers.email,
  age: benchUsers.age,
  city: benchUsers.city,
};

@Repository({
  table: benchUsers,
  databaseService: 'BenchDatabase',
  name: 'BenchUserRepository',
})
export class BenchUserRepository extends BaseRepository<typeof benchUsers, BunSQLDatabase<typeof Schemas>> {
  public async findRowById(id: number) {
    const rows = await this.db.select(columns).from(benchUsers).where(eq(benchUsers.id, id)).limit(1);

    return rows[0] ?? null;
  }

  public findPage(limit: number, offset: number) {
    return this.db.select(columns).from(benchUsers).orderBy(asc(benchUsers.id)).limit(limit).offset(offset);
  }
}
