import type { FastifyPluginAsync } from 'fastify';

interface QueryValues {
  name?: string;
  page?: string;
  size?: string;
  sort?: string;
}

const queryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: QueryValues }>('/query', async (req) => {
    const name = req.query.name ?? 'anonymous';
    const page = Number(req.query.page ?? 1) || 1;
    const size = Number(req.query.size ?? 10) || 10;
    const sort = req.query.sort ?? 'asc';

    return { name, page, size, sort, offset: (page - 1) * size };
  });
};

export default queryRoutes;
