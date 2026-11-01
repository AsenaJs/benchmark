import { Pool } from 'pg';

export type BenchUserRow = {
  id: number;
  name: string;
  email: string;
  age: number;
  city: string;
};

export type NewUserRow = {
  name: string;
  email: string;
  age: number;
  city: string;
};

export const pool = new Pool({ max: 20, connectionString: process.env.DATABASE_URL });

export async function findUser(id: number): Promise<BenchUserRow | undefined> {
  const { rows } = await pool.query<BenchUserRow>(
    'SELECT id, name, email, age, city FROM bench_users WHERE id = $1',
    [id],
  );
  return rows[0];
}

export async function listUsers(limit: number, offset: number): Promise<BenchUserRow[]> {
  const { rows } = await pool.query<BenchUserRow>(
    'SELECT id, name, email, age, city FROM bench_users ORDER BY id ASC LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return rows;
}

export async function createUser(user: NewUserRow): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO bench_writes (name, email, age, city) VALUES ($1,$2,$3,$4) RETURNING id',
    [user.name, user.email, user.age, user.city],
  );
  return rows[0]!.id;
}
