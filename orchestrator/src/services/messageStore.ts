import type { DbPool } from '../db';
import crypto from 'crypto';

export async function persistMessage(
  db: DbPool,
  params: {
    conversationId: string;
    clientPhone: string;
    ts: Date;
    direction: 'in' | 'out';
    author: 'client' | 'agent' | 'admin';
    text: string;
    messageId?: string | null;
    locale?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<boolean> {
  const textHash = crypto.createHash('sha256').update(params.text).digest('hex');
  if (params.messageId) {
    const existing = await db.query(
      'SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND message_id = $2',
      [params.conversationId, params.messageId]
    );
    if (existing.rows.length > 0) return false;
  } else {
    const existing = await db.query(
      'SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND ts = $2 AND direction = $3 AND text_hash = $4',
      [params.conversationId, params.ts, params.direction, textHash]
    );
    if (existing.rows.length > 0) return false;
  }
  await db.query(
    `INSERT INTO conversation_messages (conversation_id, client_phone, ts, direction, author, text, message_id, text_hash, locale, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.conversationId,
      params.clientPhone,
      params.ts,
      params.direction,
      params.author,
      params.text,
      params.messageId ?? null,
      textHash,
      params.locale ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ]
  );
  return true;
}

export async function getLastMessages(
  db: DbPool,
  conversationId: string,
  limit: number
): Promise<Array<{ ts: string; direction: string; author: string; text: string }>> {
  const res = await db.query(
    `SELECT ts::text, direction, author, text FROM conversation_messages
     WHERE conversation_id = $1 ORDER BY ts DESC LIMIT $2`,
    [conversationId, limit]
  );
  return (res.rows as any).reverse();
}
