import type { FastifyPluginAsync } from 'fastify';

const helloRoutes: FastifyPluginAsync = async (app) => {
  app.get('/hello', async (_req, reply) => reply.type('text/plain').send('Hello, World!'));

  app.get('/json', async () => ({ message: 'Hello, World!' }));
};

export default helloRoutes;
