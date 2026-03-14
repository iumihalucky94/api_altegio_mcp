import type { FastifyInstance } from 'fastify';
import { getWaClient, getLastQr, sendWaMessage } from '../waClient';
import { getConfigString } from '../config';

export async function registerWhatsAppRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'wa-service' });
  });

  app.get('/whatsapp/qr', async (request, reply) => {
    const token = await getConfigString('wa.internal_token', process.env.WA_INTERNAL_TOKEN || '');
    const auth = (request.headers['x-internal-token'] as string) || '';
    if (token && auth !== token) return reply.code(401).send({ error: 'Unauthorized' });
    const client = getWaClient();
    if (client && !getLastQr()) return reply.code(204).send();
    const qr = getLastQr();
    if (!qr) return reply.code(204).send();
    return reply.send({ qr });
  });

  app.post<{
    Body: { to_phone_e164: string; text: string; conversation_id?: string | null };
  }>('/whatsapp/send', async (request, reply) => {
    const token = await getConfigString('wa.internal_token', process.env.WA_INTERNAL_TOKEN || '');
    const auth = (request.headers['x-internal-token'] as string) || '';
    if (token && auth !== token) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const body = request.body;
    if (!body?.to_phone_e164 || typeof body.text !== 'string') {
      return reply.code(400).send({ error: 'Missing to_phone_e164 or text' });
    }
    const client = getWaClient();
    if (!client) {
      return reply.code(503).send({ error: 'WhatsApp Web not ready' });
    }
    const providerMessageId = await sendWaMessage(body.to_phone_e164, body.text);
    return reply.send({ ok: true, provider_message_id: providerMessageId || undefined });
  });
}
