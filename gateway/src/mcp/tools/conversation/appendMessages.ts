import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { sha256Hex } from '../../../utils/hash';

const MESSAGES_LIMIT = 100;
const TOTAL_TEXT_LIMIT = 50000;

const messageSchema = z.object({
  ts: z.string(),
  direction: z.enum(['in', 'out']),
  author: z.enum(['client', 'agent', 'admin']),
  text: z.string(),
  locale: z.enum(['ru', 'de', 'en', 'mixed']).optional(),
  metadata: z.record(z.any()).optional(),
  id: z.string().optional()
});

const schema = z.object({
  conversation_id: z.string(),
  client_phone: z.string(),
  messages: z.array(messageSchema).max(MESSAGES_LIMIT)
});

export async function handleAppendMessages(ctx: ToolDispatchContext) {
  const { conversation_id, client_phone, messages } = validateOrThrow(schema, ctx.params);
  let totalLen = 0;
  for (const m of messages) {
    totalLen += (m.text || '').length;
    if (totalLen > TOTAL_TEXT_LIMIT) throw Object.assign(new Error('Body size limit exceeded'), { code: 'VALIDATION_ERROR' });
  }
  const db = ctx.db;
  let inserted = 0;
  for (const msg of messages) {
    const messageId = (msg as any).id ?? null;
    const textHash = sha256Hex(msg.text || '');
    if (messageId) {
      const existing = await db.query(
        'SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND message_id = $2',
        [conversation_id, messageId]
      );
      if (existing.rows.length > 0) continue;
    } else {
      const existing = await db.query(
        'SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND ts = $2::timestamptz AND direction = $3 AND text_hash = $4',
        [conversation_id, msg.ts, msg.direction, textHash]
      );
      if (existing.rows.length > 0) continue;
    }
    await db.query(
      `INSERT INTO conversation_messages (conversation_id, client_phone, message_id, ts, direction, author, text, text_hash, locale, metadata)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)`,
      [
        conversation_id,
        client_phone,
        messageId,
        msg.ts,
        msg.direction,
        msg.author,
        msg.text,
        textHash,
        (msg as any).locale ?? null,
        msg.metadata ? JSON.stringify(msg.metadata) : null
      ]
    );
    inserted++;
  }
  return { appended: inserted, total: messages.length };
}
