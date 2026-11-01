import type { FastifyPluginAsync } from 'fastify';

interface UserBody {
  name: string;
  email: string;
  age: number;
  tags: string[];
  address: { city: string; zip: string };
}

const validateUserRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: UserBody }>(
    '/validate/user',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 3, maxLength: 50 },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer', minimum: 18, maximum: 120 },
            tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
            address: {
              type: 'object',
              properties: {
                city: { type: 'string', minLength: 1 },
                zip: { type: 'string', minLength: 3 },
              },
              required: ['city', 'zip'],
            },
          },
          required: ['name', 'email', 'age', 'tags', 'address'],
        },
      },
    },
    async (req) => {
      const { name, email, age, tags, address } = req.body;
      return { ok: true, name, email, age, tagCount: tags.length, city: address.city };
    },
  );
};

export default validateUserRoutes;
