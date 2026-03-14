import fastify from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';
import { Pool } from 'pg';
import { setConfigPool } from './config';
import { initWaClient } from './waClient';
import { registerWhatsAppRoutes } from './routes/whatsapp';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  WA_SERVICE_PORT: z.coerce.number().default(3032),
  LOG_LEVEL: z.string().default('info'),
  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  ORCHESTRATOR_INGEST_URL: z.string().optional(),
  WA_INTERNAL_TOKEN: z.string().optional()
});

const env = envSchema.parse(process.env);

async function main() {
  const app = fastify({
    logger: { level: env.LOG_LEVEL }
  });

  const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD
  });
  setConfigPool(pool);

  registerWhatsAppRoutes(app);

  void initWaClient(undefined, app.log).catch((err) => {
    app.log.error(err, 'WhatsApp Web init failed');
  });

  try {
    await app.listen({ port: env.WA_SERVICE_PORT, host: '0.0.0.0' });
    app.log.info(`wa-service listening on ${env.WA_SERVICE_PORT}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
