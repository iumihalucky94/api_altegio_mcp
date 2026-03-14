import type { FastifyInstance } from 'fastify';
import { getConversationByPhone, setConversationState } from '../services/conversation';
import { normalizeE164, isValidE164 } from '../lib/e164';

/** POST /admin/resume — вернуть диалог в BOT_ACTIVE (чтобы ИИ снова отвечал). Защищён x-internal-token. */
export async function registerAdminRoutes(app: FastifyInstance) {
  const db = (app as any).db;

  app.post<{
    Body: { client_phone_e164?: string }
  }>('/admin/resume', async (request, reply) => {
    const token = (request.headers['x-internal-token'] as string) || (request.headers['authorization']?.replace(/^Bearer\s+/i, ''));
    const expectedToken = await (app as any).getMcpInternalToken?.();
    if (expectedToken && token !== expectedToken) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const phoneRaw = request.body?.client_phone_e164 ?? '';
    const phone = normalizeE164(phoneRaw.trim());
    if (!isValidE164(phone)) {
      return reply.code(400).send({ error: 'Invalid client_phone_e164', usage: 'POST /admin/resume body: { "client_phone_e164": "+4367762665083" }' });
    }

    const conv = await getConversationByPhone(db, phone);
    if (!conv) {
      return reply.code(404).send({ error: 'No conversation found for this phone', phone });
    }

    await setConversationState(db, conv.conversation_id, 'BOT_ACTIVE');
    return reply.send({ ok: true, conversation_id: conv.conversation_id, state: 'BOT_ACTIVE', message: 'Bot can respond again for this chat.' });
  });
}
