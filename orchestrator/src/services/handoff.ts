import type { DbPool } from '../db';
import { logAudit } from './audit';

export async function createHandoffCase(
  db: DbPool,
  params: {
    conversationId: string;
    clientPhone: string;
    summary: string;
    questionToAdmin: string;
    relatedAuditIds?: string[];
  }
): Promise<string> {
  const res = await db.query(
    `INSERT INTO handoff_cases (conversation_id, client_phone, summary, question_to_admin, language)
     VALUES ($1, $2, $3, $4, 'mixed')
     RETURNING id::text`,
    [params.conversationId, params.clientPhone, params.summary, params.questionToAdmin]
  );
  const id = res.rows[0]?.id ?? '';
  await logAudit(db, {
    actor: { actor_type: 'system', actor_id: 'orchestrator' },
    source: 'handoff',
    action: 'handoff.case.create',
    entity_table: 'handoff_cases',
    entity_id: id,
    before: null,
    after: {
      conversation_id: params.conversationId,
      client_phone: params.clientPhone,
      summary: params.summary
    },
    conversation_id: params.conversationId,
    client_phone: params.clientPhone
  });
  return id;
}

export async function addPendingAction(
  db: DbPool,
  params: {
    type: string;
    conversationId?: string;
    clientPhone: string;
    caseId?: string;
    approvalId?: string;
  }
) {
  await db.query(
    `INSERT INTO pending_admin_actions (type, conversation_id, client_phone, case_id, approval_id, status)
     VALUES ($1, $2, $3, $4::uuid, $5::uuid, 'OPEN')`,
    [
      params.type,
      params.conversationId ?? null,
      params.clientPhone,
      params.caseId ?? null,
      params.approvalId ?? null
    ]
  );
  await logAudit(db, {
    actor: { actor_type: 'system', actor_id: 'orchestrator' },
    source: 'pending_admin_actions',
    action: 'pending_action.create',
    entity_table: 'pending_admin_actions',
    entity_id: null,
    before: null,
    after: params,
    conversation_id: params.conversationId ?? null,
    client_phone: params.clientPhone
  });
}

export async function getOpenPendingActions(db: DbPool): Promise<
  Array<{
    id: string;
    type: string;
    conversation_id: string | null;
    client_phone: string;
    case_id: string | null;
    approval_id: string | null;
    created_at: string;
    last_reminded_at: string | null;
    reminder_count: number;
  }>
> {
  const res = await db.query(
    `SELECT id::text, type, conversation_id, client_phone, case_id::text, approval_id::text,
            created_at::text, last_reminded_at::text, reminder_count
     FROM pending_admin_actions WHERE status = 'OPEN' ORDER BY created_at ASC`
  );
  return res.rows as any;
}

export async function markPendingDone(db: DbPool, approvalId: string) {
  await db.query(
    `UPDATE pending_admin_actions SET status = 'DONE' WHERE approval_id = $1::uuid`,
    [approvalId]
  );
  await logAudit(db, {
    actor: { actor_type: 'system', actor_id: 'orchestrator' },
    source: 'pending_admin_actions',
    action: 'pending_action.approve',
    entity_table: 'pending_admin_actions',
    entity_id: null,
    before: null,
    after: { approval_id: approvalId, status: 'DONE' }
  });
}

export async function updateReminder(db: DbPool, id: string) {
  await db.query(
    `UPDATE pending_admin_actions SET last_reminded_at = now(), reminder_count = reminder_count + 1 WHERE id = $1::uuid`,
    [id]
  );
}

export async function getCase(db: DbPool, caseId: string) {
  const res = await db.query(
    `SELECT id::text, conversation_id, client_phone, status, summary, question_to_admin,
            related_audit_ids, admin_response, created_at::text, resolved_at::text
     FROM handoff_cases WHERE id = $1::uuid`,
    [caseId]
  );
  return res.rows[0] ?? null;
}

export async function getOpenHandoffCases(db: DbPool): Promise<
  Array<{ id: string; conversation_id: string; client_phone: string; summary: string; question_to_admin: string | null; created_at: string }>
> {
  const res = await db.query(
    `SELECT id::text, conversation_id, client_phone, summary, question_to_admin, created_at::text
     FROM handoff_cases WHERE status = 'OPEN' ORDER BY created_at ASC`
  );
  return res.rows as any;
}

export interface ContactNeedingAttention {
  client_phone: string;
  state: string;
  state_updated_at: string;
  open_cases: Array<{ id: string; summary: string; question_to_admin: string | null; created_at: string }>;
  pending_actions: Array<{ id: string; type: string; approval_id: string | null; created_at: string }>;
}

/** Список контактов, где нужна реакция админа: AWAITING_ADMIN, ADMIN_TAKEOVER + открытые кейсы и pending actions. */
export async function getContactsNeedingAttention(db: DbPool): Promise<ContactNeedingAttention[]> {
  const convRes = await db.query(
    `SELECT client_phone, state, state_updated_at::text
     FROM conversations
     WHERE state IN ('AWAITING_ADMIN', 'ADMIN_TAKEOVER')
     ORDER BY state_updated_at DESC`
  );
  const openCases = await getOpenHandoffCases(db);
  const pending = await getOpenPendingActions(db);
  const byPhone = new Map<string, ContactNeedingAttention>();
  for (const row of convRes.rows as Array<{ client_phone: string; state: string; state_updated_at: string }>) {
    byPhone.set(row.client_phone, {
      client_phone: row.client_phone,
      state: row.state,
      state_updated_at: row.state_updated_at,
      open_cases: [],
      pending_actions: []
    });
  }
  for (const c of openCases) {
    let entry = byPhone.get(c.client_phone);
    if (!entry) {
      entry = { client_phone: c.client_phone, state: '—', state_updated_at: '', open_cases: [], pending_actions: [] };
      byPhone.set(c.client_phone, entry);
    }
    entry.open_cases.push({ id: c.id, summary: c.summary, question_to_admin: c.question_to_admin, created_at: c.created_at });
  }
  for (const entry of byPhone.values()) {
    entry.open_cases.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  for (const p of pending) {
    let entry = byPhone.get(p.client_phone);
    if (!entry) {
      entry = { client_phone: p.client_phone, state: '—', state_updated_at: '', open_cases: [], pending_actions: [] };
      byPhone.set(p.client_phone, entry);
    }
    entry.pending_actions.push({
      id: p.id,
      type: p.type,
      approval_id: p.approval_id,
      created_at: p.created_at
    });
  }
  return Array.from(byPhone.values()).sort((a, b) => {
    const aT = new Date(a.state_updated_at || 0).getTime();
    const bT = new Date(b.state_updated_at || 0).getTime();
    return aT - bT;
  });
}
