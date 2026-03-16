"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIngestRoutes = registerIngestRoutes;
const conversation_1 = require("../services/conversation");
const ignoreList_1 = require("../services/ignoreList");
const messageStore_1 = require("../services/messageStore");
const debounce_1 = require("../services/debounce");
const e164_1 = require("../lib/e164");
const config_1 = require("../config");
const PROVIDER = 'whatsapp-web';
/** Conversation id for WhatsApp Web: single channel per client phone */
function conversationIdFor(clientPhone) {
    return `wa_web_${clientPhone.replace(/\D/g, '')}`;
}
async function registerIngestRoutes(app) {
    const db = app.db;
    app.post('/ingest/whatsapp-web', async (request, reply) => {
        const correlationId = request.headers['x-request-id'] ?? `ingest-${Date.now()}`;
        const log = app.log.child({ request_id: correlationId });
        const token = request.headers['x-internal-token'] || (request.headers['authorization']?.replace(/^Bearer\s+/i, ''));
        const expectedToken = await app.getMcpInternalToken?.();
        if (expectedToken && token !== expectedToken) {
            log.warn({ hasToken: !!token }, 'Ingest: 401 Unauthorized (token mismatch)');
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        const body = request.body;
        if (!body || body.provider !== PROVIDER) {
            return reply.code(400).send({ error: 'Invalid body or provider' });
        }
        const phone = (0, e164_1.normalizeE164)(body.client_phone_e164 || '');
        if (!(0, e164_1.isValidE164)(phone)) {
            log.warn({ client_phone_e164: body.client_phone_e164 }, 'Invalid E.164, skipping');
            return reply.code(400).send({ error: 'Invalid client_phone_e164' });
        }
        const conversationId = conversationIdFor(phone);
        const ts = body.ts_iso ? new Date(body.ts_iso) : new Date();
        const text = typeof body.text === 'string' ? body.text : '';
        const messageId = body.provider_message_id || '';
        log.info({ conversationId, clientPhone: phone, textPreview: text.slice(0, 60) }, 'Ingest: request received');
        await (0, conversation_1.getOrCreateConversation)(db, conversationId, phone);
        const inserted = await (0, messageStore_1.persistMessage)(db, {
            conversationId,
            clientPhone: phone,
            ts,
            direction: 'in',
            author: 'client',
            text,
            messageId: messageId || undefined,
            locale: undefined
        });
        if (inserted)
            await (0, conversation_1.updateLastInbound)(db, conversationId);
        const ignoreMode = await (0, ignoreList_1.getIgnoreMode)(db, phone);
        if (ignoreMode === 'IGNORE') {
            log.info({ phone }, 'Ingest: skipped (IGNORE)');
            return reply.send({ ok: true });
        }
        if (ignoreMode === 'ADMIN_ONLY') {
            log.info({ phone }, 'Ingest: skipped (ADMIN_ONLY)');
            const notify = await (0, config_1.getConfigBoolean)('telegram.admin_only_ping', true);
            if (notify)
                app.sendToLogsGroup?.({ event: 'ADMIN_ONLY', provider: PROVIDER, client_phone: phone, text: text.slice(0, 100) });
            return reply.send({ ok: true });
        }
        const allowOnlyListed = await (0, config_1.getConfigBoolean)('ALLOW_ONLY_LISTED_PHONES', false);
        if (allowOnlyListed) {
            const listRaw = await (0, config_1.getConfigString)('ALLOWED_PHONE_LIST', '');
            const allowedSet = new Set(listRaw
                .split(',')
                .map((s) => (0, e164_1.normalizeE164)(s.trim()))
                .filter((p) => (0, e164_1.isValidE164)(p)));
            if (!allowedSet.has(phone)) {
                log.info({ phone }, 'Phone not in ALLOWED_PHONE_LIST, skipping agent processing');
                return reply.send({ ok: true });
            }
        }
        log.info({ conversationId, clientPhone: phone, textPreview: text.slice(0, 50) }, 'Ingest: enqueueing for agent');
        await (0, debounce_1.enqueue)(conversationId, {
            clientPhone: phone,
            ts,
            text,
            messageId: messageId || undefined,
            locale: undefined
        }, log);
        return reply.send({ ok: true });
    });
}
//# sourceMappingURL=ingest.js.map