import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db';

interface UserRow {
  id: number;
  name: string;
  email: string;
  age: number;
  city: string;
}

interface WriteBody {
  name: string;
  email: string;
  age: number;
  city: string;
}

const SELECT_COLUMNS = 'SELECT id, name, email, age, city';

const dbRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/db/user/:id', async (req, reply) => {
    const { rows } = await pool.query<UserRow>(
      `${SELECT_COLUMNS} FROM bench_users WHERE id = $1`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(rows[0]);
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/db/users', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
    const offset = Number(req.query.offset ?? 0) || 0;
    const { rows } = await pool.query<UserRow>(
      `${SELECT_COLUMNS} FROM bench_users ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { count: rows.length, items: rows };
  });

  app.post<{ Body: WriteBody }>('/db/user', async (req, reply) => {
    const { name, email, age, city } = req.body;
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO bench_writes (name, email, age, city) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, age, city],
    );
    return reply.code(201).send({ id: rows[0].id, created: true });
  });
};

export default dbRoutes;
