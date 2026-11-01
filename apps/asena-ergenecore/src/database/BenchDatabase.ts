import { AsenaDatabaseService, Database } from '@asenajs/asena-drizzle';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type Schemas from './schemas';

@Database({
  type: 'bun-sql',
  config: { connectionString: process.env.DATABASE_URL, pool: { max: 20 } },
  name: 'BenchDatabase',
})
export class BenchDatabase extends AsenaDatabaseService<BunSQLDatabase<typeof Schemas>> {}
