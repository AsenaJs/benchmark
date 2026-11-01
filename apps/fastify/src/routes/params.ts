import type { FastifyPluginAsync } from 'fastify';

const paramsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string; itemId: string } }>('/params/:id/items/:itemId', async (req) => {
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    return { id, itemId, sum: id + itemId };
  });
};

export default paramsRoutes;
