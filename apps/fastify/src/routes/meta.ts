import type { FastifyPluginAsync } from 'fastify';

const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/__bench/meta', async () => ({
    app: 'fastify',
    framework: 'Fastify',
    frameworkVersion: app.version,
    dbLayer: 'pg',
    validator: 'ajv',
  }));
};

export default metaRoutes;
