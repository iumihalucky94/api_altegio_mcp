import 'dotenv/config';
import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { createDbPool } from './db';
import { initConfig } from './config';
import { registerIngestRoutes } from './routes/ingest';
import { registerKbRoutes } from './routes/kb';
import { registerAdminRoutes } from './routes/admin';
import { setDebounceProcessor } from './services/debounce';
import { processBatch } from './services/agentProcessor';
import { getConfigString, getConfigNumber } from './config';
import { startTelegramBot } from './telegram/bot';
import { startReminderWorker } from './workers/reminder';
import { startAuditCleanupWorker } from './workers/auditCleanup';

const log = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

async function main() {
  const db = await createDbPool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'altegio',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  initConfig(db, {
    MCP_GATEWAY_URL: process.env.MCP_GATEWAY_URL || process.env.MCP_URL || 'http://localhost:3030',
    WA_SEND_URL: process.env.WA_SEND_URL || '',
    MCP_INTERNAL_TOKEN: process.env.MCP_INTERNAL_TOKEN || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    DEFAULT_COMPANY_ID: process.env.DEFAULT_COMPANY_ID || 1169276,
    'telegram.logs_group_chat_id': process.env.TG_LOGS_GROUP_CHAT_ID || '',
    'telegram.summary_group_chat_id': process.env.TG_SUMMARY_GROUP_CHAT_ID || '',
    ADMIN_APPROVE_KEY: process.env.ADMIN_APPROVE_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.AI_AGENT_API_KEY || '',
    AI_AGENT_API_BASE_URL: process.env.AI_AGENT_API_BASE_URL || '',
    AI_AGENT_MODEL: process.env.AI_AGENT_MODEL || 'gpt-4o-mini',
    ALLOW_ONLY_LISTED_PHONES: process.env.ALLOW_ONLY_LISTED_PHONES === 'true' || process.env.ALLOW_ONLY_LISTED_PHONES === '1',
    ALLOWED_PHONE_LIST: process.env.ALLOWED_PHONE_LIST || '',
    KB_INTERNAL_TOKEN: process.env.KB_INTERNAL_TOKEN || process.env.MCP_INTERNAL_TOKEN || '',
    KB_MODE: process.env.KB_MODE || 'embedded',
    KB_CONTEXT_LIMIT_TEMPLATES: Number(process.env.KB_CONTEXT_LIMIT_TEMPLATES || 3),
    KB_CONTEXT_LIMIT_GOOD_EXAMPLES: Number(process.env.KB_CONTEXT_LIMIT_GOOD_EXAMPLES || 3),
    KB_CONTEXT_LIMIT_BAD_EXAMPLES: Number(process.env.KB_CONTEXT_LIMIT_BAD_EXAMPLES || 1)
  });

  const app = Fastify({ logger: log });
  (app as any).db = db;
  const companyId = Number(await getConfigNumber('DEFAULT_COMPANY_ID', 1169276));

  let sendToSummary: (msg: string) => Promise<void> = async () => {};
  let sendToLogsGroup: (payload: object) => Promise<void> = async () => {};
  const token = await getConfigString('TELEGRAM_BOT_TOKEN', '');
  if (token) {
    const botApi = await startTelegramBot(db, token, log);
    sendToSummary = botApi.sendSummary;
    sendToLogsGroup = botApi.sendLogs;
  }
  (app as any).sendToSummary = sendToSummary;
  (app as any).sendToLogsGroup = sendToLogsGroup;
  (app as any).getMcpInternalToken = async () => (await getConfigString('MCP_INTERNAL_TOKEN', '')) || '';
  (app as any).getConfigString = getConfigString;
  (app as any).getConfigNumber = getConfigNumber;

  app.addHook('onRequest', async (request, reply) => {
    let correlationId = request.headers['x-correlation-id'] as string | undefined;
    if (!correlationId) {
      correlationId = `corr-${randomUUID()}`;
      reply.header('x-correlation-id', correlationId);
    }
    (request as any).correlationId = correlationId;
    const requestId = `req-${randomUUID()}`;
    (request as any).requestId = requestId;
    (request as any).actor = {
      actor_type: 'system',
      actor_id: 'orchestrator'
    };
  });

  setDebounceProcessor((batch) => processBatch(db, batch, log, sendToSummary, companyId));

  app.get('/health', (_: any, reply: any) => reply.send({ status: 'ok' }));
  await registerIngestRoutes(app);
  await registerKbRoutes(app);
  await registerAdminRoutes(app);

  const port = Number(process.env.ORCHESTRATOR_PORT || 3031);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'Orchestrator listening');

  void startReminderWorker(db, log, sendToSummary);
}

main().catch((e: Error) => { console.error(e); process.exit(1); });
