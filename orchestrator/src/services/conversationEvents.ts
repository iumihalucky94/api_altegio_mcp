import type { DbPool } from '../db';

export async function appendConversationEvent(
  db: DbPool,
  conversationId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO conversation_events (conversation_id, event_type, event_payload_json)
     VALUES ($1, $2, $3)`,
    [conversationId, eventType, payload != null ? JSON.stringify(payload) : null]
  );
}
