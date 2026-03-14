import fastify from 'fastify';
import pino from 'pino';
import { registerHealthRoutes } from '../routes/health';

// Minimal smoke test using Fastify's inject.

async function main() {
  const app = fastify({ logger: pino({ level: 'silent' }) }) as any;
  app.decorate('db', {
    query: async () => ({ rows: [{ '?column?': 1 }] })
  });

  registerHealthRoutes(app);

  const res = await app.inject({ method: 'GET', url: '/health' });
  if (res.statusCode !== 200) {
    console.error('Health check failed', res.statusCode, res.body);
    process.exit(1);
  }
  console.log('Health route smoke test passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

