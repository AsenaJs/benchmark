import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3002);

const app = buildApp();

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`fastify listening on :${port}`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
