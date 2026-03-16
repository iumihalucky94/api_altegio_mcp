"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const crypto_1 = require("crypto");
const db_1 = require("./db");
const config_1 = require("./config");
const ingest_1 = require("./routes/ingest");
const kb_1 = require("./routes/kb");
const admin_1 = require("./routes/admin");
const debounce_1 = require("./services/debounce");
const agentProcessor_1 = require("./services/agentProcessor");
const config_2 = require("./config");
const bot_1 = require("./telegram/bot");
const reminder_1 = require("./workers/reminder");
const log = require('pino')({ level: process.env.LOG_LEVEL || 'info' });
async function main() {
    const db = await (0, db_1.createDbPool)({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'altegio',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || ''
    });
    (0, config_1.initConfig)(db, {
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
    const app = (0, fastify_1.default)({ logger: log });
    app.db = db;
    const companyId = Number(await (0, config_2.getConfigNumber)('DEFAULT_COMPANY_ID', 1169276));
    let sendToSummary = async () => { };
    let sendToLogsGroup = async () => { };
    const token = await (0, config_2.getConfigString)('TELEGRAM_BOT_TOKEN', '');
    if (token) {
        const botApi = await (0, bot_1.startTelegramBot)(db, token, log);
        sendToSummary = botApi.sendSummary;
        sendToLogsGroup = botApi.sendLogs;
    }
    app.sendToSummary = sendToSummary;
    app.sendToLogsGroup = sendToLogsGroup;
    app.getMcpInternalToken = async () => (await (0, config_2.getConfigString)('MCP_INTERNAL_TOKEN', '')) || '';
    app.getConfigString = config_2.getConfigString;
    app.getConfigNumber = config_2.getConfigNumber;
    app.addHook('onRequest', async (request, reply) => {
        let correlationId = request.headers['x-correlation-id'];
        if (!correlationId) {
            correlationId = `corr-${(0, crypto_1.randomUUID)()}`;
            reply.header('x-correlation-id', correlationId);
        }
        request.correlationId = correlationId;
        const requestId = `req-${(0, crypto_1.randomUUID)()}`;
        request.requestId = requestId;
        request.actor = {
            actor_type: 'system',
            actor_id: 'orchestrator'
        };
    });
    (0, debounce_1.setDebounceProcessor)((batch) => (0, agentProcessor_1.processBatch)(db, batch, log, sendToSummary, companyId));
    app.get('/health', (_, reply) => reply.send({ status: 'ok' }));
    await (0, ingest_1.registerIngestRoutes)(app);
    await (0, kb_1.registerKbRoutes)(app);
    await (0, admin_1.registerAdminRoutes)(app);
    const port = Number(process.env.ORCHESTRATOR_PORT || 3031);
    await app.listen({ port, host: '0.0.0.0' });
    log.info({ port }, 'Orchestrator listening');
    void (0, reminder_1.startReminderWorker)(db, log, sendToSummary);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=server.js.map