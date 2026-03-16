import fastify from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createDbPool, runMigrations } from './audit/db';
import { registerHealthRoutes } from './routes/health';
import { registerMcpRoutes } from './routes/mcp';
import { registerApprovalRoutes } from './routes/approvals';
import { registerAdminPolicyRoutes } from './routes/adminPolicies';
import { initConfigService } from './config/resolver';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  GATEWAY_PORT: z.coerce.number().default(3030),
  LOG_LEVEL: z.string().default('info'),

  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),

  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),

  RATE_LIMIT_ENABLED: z.coerce.boolean().default(true),
  RATE_LIMIT_RPS: z.coerce.number().default(2),
  RATE_LIMIT_RPM: z.coerce.number().default(60),
  RATE_LIMIT_BURST: z.coerce.number().default(5),

  GATEWAY_REQUEST_TIMEOUT_MS: z.coerce.number().default(15000),
  ALTEGIO_HTTP_TIMEOUT_MS: z.coerce.number().default(8000),
  OPERATION_BUDGET_MS: z.coerce.number().default(20000),

  ADMIN_APPROVE_KEY: z.string(),

  ALTEGIO_BASE_URL: z.string(),
  ALTEGIO_API_VERSION: z.string().default('v1'),
  ALTEGIO_PARTNER_TOKEN: z.string(),
  ALTEGIO_USER_TOKEN: z.string()
});

const env = envSchema.parse(process.env);

async function main() {
  const app = fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  const db = await createDbPool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD
  });

  await runMigrations(db, app.log);

  initConfigService(db, {
    'slots_default_limit': 3,
    'preferred_master_threshold': 0.8,
    'cancel_policy_mode': 'always_approval',
    'ratelimit.enabled': env.RATE_LIMIT_ENABLED,
    'ratelimit.per_agent.rps': env.RATE_LIMIT_RPS,
    'ratelimit.per_agent.rpm': env.RATE_LIMIT_RPM,
    'ratelimit.burst': env.RATE_LIMIT_BURST,
    'ratelimit.retry_after_seconds': 10,
    'ratelimit.key_mode': 'actor_agent_id',
    'timeouts.gateway_request_ms': env.GATEWAY_REQUEST_TIMEOUT_MS,
    'timeouts.altegios_http_ms': env.ALTEGIO_HTTP_TIMEOUT_MS,
    'timeouts.operation_budget_ms': env.OPERATION_BUDGET_MS,
    'timeouts.on_timeout_decision': 'NEED_HUMAN',
    'logging.correlation_id_source': 'request_id',
    'logging.include_actor': true,
    'logging.include_tool': true,
    'config.cache_ttl_ms': 10000,
    'redis.host': env.REDIS_HOST ?? '',
    'redis.port': env.REDIS_PORT ?? 6379,
    DEFAULT_STAFF_ID: process.env.DEFAULT_STAFF_ID ?? '',
    DEFAULT_SERVICE_ID: process.env.DEFAULT_SERVICE_ID ?? ''
  });

  app.decorate('db', db);
  app.decorate('config', env);

  registerHealthRoutes(app);
  registerMcpRoutes(app);
  registerApprovalRoutes(app);
  registerAdminPolicyRoutes(app);

  try {
    await app.listen({ port: env.GATEWAY_PORT, host: '0.0.0.0' });
    app.log.info(`Altegio MCP Gateway listening on ${env.GATEWAY_PORT}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();

