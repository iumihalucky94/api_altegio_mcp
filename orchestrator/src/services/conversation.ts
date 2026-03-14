import type { DbPool } from '../db';
import { logAudit } from './audit';

export type ConversationState =
  | 'BOT_ACTIVE'
  | 'BOT_PAUSED'
  | 'ADMIN_TAKEOVER'
  | 'AWAITING_ADMIN'
  | 'IGNORED';

const STATE_PRIORITY: Record<ConversationState, number> = {
  IGNORED: 5,
  ADMIN_TAKEOVER: 4,
  BOT_PAUSED: 3,
  AWAITING_ADMIN: 2,
  BOT_ACTIVE: 1
};

export interface ConversationRow {
  conversation_id: string;
  client_phone: string;
  state: ConversationState;
  state_updated_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  language_hint: string | null;
  takeover_until: string | null;
  metadata_json: Record<string, unknown> | null;
}

export async function getOrCreateConversation(
  db: DbPool,
  conversationId: string,
  clientPhone: string
): Promise<ConversationRow> {
  const res = await db.query(
    `INSERT INTO conversations (conversation_id, client_phone, state)
     VALUES ($1, $2, 'BOT_ACTIVE')
     ON CONFLICT (conversation_id) DO UPDATE SET conversation_id = conversations.conversation_id
     RETURNING conversation_id, client_phone, state, state_updated_at::text,
       last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json`,
    [conversationId, clientPhone]
  );
  if (res.rows.length > 0) return res.rows[0] as ConversationRow;
  const get = await db.query(
    'SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json FROM conversations WHERE conversation_id = $1',
    [conversationId]
  );
  return get.rows[0] as ConversationRow;
}

export async function setConversationState(
  db: DbPool,
  conversationId: string,
  state: ConversationState,
  takeoverUntil?: Date | null
) {
  const beforeRes = await db.query(
    'SELECT conversation_id, client_phone, state FROM conversations WHERE conversation_id = $1',
    [conversationId]
  );
  const before = beforeRes.rows[0] ?? null;
  await db.query(
    `UPDATE conversations SET state = $1, state_updated_at = now(), takeover_until = $2
     WHERE conversation_id = $3`,
    [state, takeoverUntil ?? null, conversationId]
  );
  const afterRes = await db.query(
    'SELECT conversation_id, client_phone, state FROM conversations WHERE conversation_id = $1',
    [conversationId]
  );
  const after = afterRes.rows[0] ?? null;
  if (after) {
    await logAudit(db, {
      actor: { actor_type: 'system', actor_id: 'orchestrator' },
      source: 'conversation',
      action: 'conversation.state.update',
      entity_table: 'conversations',
      entity_id: conversationId,
      before,
      after,
      conversation_id: conversationId,
      client_phone: after.client_phone ?? null
    });
  }
}

export async function updateLastInbound(db: DbPool, conversationId: string) {
  await db.query(
    'UPDATE conversations SET last_inbound_at = now() WHERE conversation_id = $1',
    [conversationId]
  );
}

export async function updateLastOutbound(db: DbPool, conversationId: string) {
  await db.query(
    'UPDATE conversations SET last_outbound_at = now() WHERE conversation_id = $1',
    [conversationId]
  );
}

export function shouldBotRespond(state: ConversationState, _now?: Date): boolean {
  return state === 'BOT_ACTIVE';
}

export function statePriority(state: ConversationState): number {
  return STATE_PRIORITY[state] ?? 0;
}

export async function getConversation(db: DbPool, conversationId: string): Promise<ConversationRow | null> {
  const res = await db.query(
    'SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json FROM conversations WHERE conversation_id = $1',
    [conversationId]
  );
  return (res.rows[0] as ConversationRow) ?? null;
}

export async function getConversationByPhone(db: DbPool, clientPhone: string): Promise<ConversationRow | null> {
  const res = await db.query(
    `SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json
     FROM conversations WHERE client_phone = $1 ORDER BY last_inbound_at DESC NULLS LAST LIMIT 1`,
    [clientPhone]
  );
  return (res.rows[0] as ConversationRow) ?? null;
}
