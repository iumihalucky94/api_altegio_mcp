import type { FastifyInstance } from 'fastify';
import { getOrCreateConversation, updateLastInbound } from '../services/conversation';
import { getIgnoreMode } from '../services/ignoreList';
import { persistMessage } from '../services/messageStore';
import { enqueue } from '../services/debounce';
import { normalizeE164, isValidE164 } from '../lib/e164';
import { getConfigBoolean, getConfigString } from '../config';

const PROVIDER = 'whatsapp-web';

/** Conversation id for WhatsApp Web: single channel per client phone */
function conversationIdFor(clientPhone: string): string {
  return `wa_web_${clientPhone.replace(/\D/g, '')}`;
}

export interface IngestWhatsAppWebBody {
  provider: string;
  provider_message_id?: string;
  client_phone_e164: string;
  text: string;
  ts_iso: string;
  raw_json?: unknown;
}

export async function registerIngestRoutes(app: FastifyInstance) {
  const db = (app as any).db;

  app.post<{ Body: IngestWhatsAppWebBody }>('/ingest/whatsapp-web', async (request, reply) => {
    const correlationId = (request.headers['x-request-id'] as string) ?? `ingest-${Date.now()}`;
    const log = (app as any).log.child({ request_id: correlationId });

    const token = (request.headers['x-internal-token'] as string) || (request.headers['authorization']?.replace(/^Bearer\s+/i, ''));
    const expectedToken = await (app as any).getMcpInternalToken?.();
    if (expectedToken && token !== expectedToken) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body;
    if (!body || body.provider !== PROVIDER) {
      return reply.code(400).send({ error: 'Invalid body or provider' });
    }

    const phone = normalizeE164(body.client_phone_e164 || '');
    if (!isValidE164(phone)) {
      log.warn({ client_phone_e164: body.client_phone_e164 }, 'Invalid E.164, skipping');
      return reply.code(400).send({ error: 'Invalid client_phone_e164' });
    }

    const conversationId = conversationIdFor(phone);
    const ts = body.ts_iso ? new Date(body.ts_iso) : new Date();
    const text = typeof body.text === 'string' ? body.text : '';
    const messageId = body.provider_message_id || '';

    await getOrCreateConversation(db, conversationId, phone);
    const inserted = await persistMessage(db, {
      conversationId,
      clientPhone: phone,
      ts,
      direction: 'in',
      author: 'client',
      text,
      messageId: messageId || undefined,
      locale: undefined
    });
    if (inserted) await updateLastInbound(db, conversationId);

    const ignoreMode = await getIgnoreMode(db, phone);
    if (ignoreMode === 'IGNORE') {
      return reply.send({ ok: true });
    }
    if (ignoreMode === 'ADMIN_ONLY') {
      const notify = await getConfigBoolean('telegram.admin_only_ping', true);
      if (notify) (app as any).sendToLogsGroup?.({ event: 'ADMIN_ONLY', provider: PROVIDER, client_phone: phone, text: text.slice(0, 100) });
      return reply.send({ ok: true });
    }

    const allowOnlyListed = await getConfigBoolean('ALLOW_ONLY_LISTED_PHONES', false);
    if (allowOnlyListed) {
      const listRaw = await getConfigString('ALLOWED_PHONE_LIST', '');
      const allowedSet = new Set(
        listRaw
          .split(',')
          .map((s) => normalizeE164(s.trim()))
          .filter((p) => isValidE164(p))
      );
      if (!allowedSet.has(phone)) {
        log.info({ phone }, 'Phone not in ALLOWED_PHONE_LIST, skipping agent processing');
        return reply.send({ ok: true });
      }
    }

    log.info({ conversationId, clientPhone: phone, textPreview: text.slice(0, 50) }, 'Ingest: enqueueing for agent');
    await enqueue(conversationId, {
      clientPhone: phone,
      ts,
      text,
      messageId: messageId || undefined,
      locale: undefined
    }, log);

    return reply.send({ ok: true });
  });
}
