"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHandoffCase = createHandoffCase;
exports.addPendingAction = addPendingAction;
exports.getOpenPendingActions = getOpenPendingActions;
exports.markPendingDone = markPendingDone;
exports.updateReminder = updateReminder;
exports.getCase = getCase;
exports.getOpenHandoffCases = getOpenHandoffCases;
exports.getContactsNeedingAttention = getContactsNeedingAttention;
const audit_1 = require("./audit");
async function createHandoffCase(db, params) {
    const res = await db.query(`INSERT INTO handoff_cases (conversation_id, client_phone, summary, question_to_admin, language)
     VALUES ($1, $2, $3, $4, 'mixed')
     RETURNING id::text`, [params.conversationId, params.clientPhone, params.summary, params.questionToAdmin]);
    const id = res.rows[0]?.id ?? '';
    await (0, audit_1.logAudit)(db, {
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
async function addPendingAction(db, params) {
    await db.query(`INSERT INTO pending_admin_actions (type, conversation_id, client_phone, case_id, approval_id, status)
     VALUES ($1, $2, $3, $4::uuid, $5::uuid, 'OPEN')`, [
        params.type,
        params.conversationId ?? null,
        params.clientPhone,
        params.caseId ?? null,
        params.approvalId ?? null
    ]);
    await (0, audit_1.logAudit)(db, {
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
async function getOpenPendingActions(db) {
    const res = await db.query(`SELECT id::text, type, conversation_id, client_phone, case_id::text, approval_id::text,
            created_at::text, last_reminded_at::text, reminder_count
     FROM pending_admin_actions WHERE status = 'OPEN' ORDER BY created_at ASC`);
    return res.rows;
}
async function markPendingDone(db, approvalId) {
    await db.query(`UPDATE pending_admin_actions SET status = 'DONE' WHERE approval_id = $1::uuid`, [approvalId]);
    await (0, audit_1.logAudit)(db, {
        actor: { actor_type: 'system', actor_id: 'orchestrator' },
        source: 'pending_admin_actions',
        action: 'pending_action.approve',
        entity_table: 'pending_admin_actions',
        entity_id: null,
        before: null,
        after: { approval_id: approvalId, status: 'DONE' }
    });
}
async function updateReminder(db, id) {
    await db.query(`UPDATE pending_admin_actions SET last_reminded_at = now(), reminder_count = reminder_count + 1 WHERE id = $1::uuid`, [id]);
}
async function getCase(db, caseId) {
    const res = await db.query(`SELECT id::text, conversation_id, client_phone, status, summary, question_to_admin,
            related_audit_ids, admin_response, created_at::text, resolved_at::text
     FROM handoff_cases WHERE id = $1::uuid`, [caseId]);
    return res.rows[0] ?? null;
}
async function getOpenHandoffCases(db) {
    const res = await db.query(`SELECT id::text, conversation_id, client_phone, summary, question_to_admin, created_at::text
     FROM handoff_cases WHERE status = 'OPEN' ORDER BY created_at ASC`);
    return res.rows;
}
/** Список контактов, где нужна реакция админа: AWAITING_ADMIN, ADMIN_TAKEOVER + открытые кейсы и pending actions. */
async function getContactsNeedingAttention(db) {
    const convRes = await db.query(`SELECT client_phone, state, state_updated_at::text
     FROM conversations
     WHERE state IN ('AWAITING_ADMIN', 'ADMIN_TAKEOVER')
     ORDER BY state_updated_at DESC`);
    const openCases = await getOpenHandoffCases(db);
    const pending = await getOpenPendingActions(db);
    const byPhone = new Map();
    for (const row of convRes.rows) {
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
//# sourceMappingURL=handoff.js.map