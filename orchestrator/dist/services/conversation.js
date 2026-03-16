"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateConversation = getOrCreateConversation;
exports.updateConversationLanguageAndScenario = updateConversationLanguageAndScenario;
exports.setConversationState = setConversationState;
exports.updateLastInbound = updateLastInbound;
exports.updateLastOutbound = updateLastOutbound;
exports.shouldBotRespond = shouldBotRespond;
exports.statePriority = statePriority;
exports.getConversation = getConversation;
exports.getConversationByPhone = getConversationByPhone;
const audit_1 = require("./audit");
const STATE_PRIORITY = {
    IGNORED: 5,
    ADMIN_TAKEOVER: 4,
    BOT_PAUSED: 3,
    AWAITING_ADMIN: 2,
    BOT_ACTIVE: 1
};
async function getOrCreateConversation(db, conversationId, clientPhone) {
    const res = await db.query(`INSERT INTO conversations (conversation_id, client_phone, state)
     VALUES ($1, $2, 'BOT_ACTIVE')
     ON CONFLICT (conversation_id) DO UPDATE SET conversation_id = conversations.conversation_id
     RETURNING conversation_id, client_phone, state, state_updated_at::text,
       last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json`, [conversationId, clientPhone]);
    if (res.rows.length > 0)
        return res.rows[0];
    const get = await db.query('SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json FROM conversations WHERE conversation_id = $1', [conversationId]);
    return get.rows[0];
}
/** Optionally update extended columns (detected_primary_language, current_scenario_code). No-op if columns missing. */
async function updateConversationLanguageAndScenario(db, conversationId, detectedPrimaryLanguage, currentScenarioCode) {
    try {
        await db.query(`UPDATE conversations SET detected_primary_language = $1, current_scenario_code = $2 WHERE conversation_id = $3`, [detectedPrimaryLanguage, currentScenarioCode, conversationId]);
    }
    catch (_) { }
}
async function setConversationState(db, conversationId, state, takeoverUntil) {
    const beforeRes = await db.query('SELECT conversation_id, client_phone, state FROM conversations WHERE conversation_id = $1', [conversationId]);
    const before = beforeRes.rows[0] ?? null;
    await db.query(`UPDATE conversations SET state = $1, state_updated_at = now(), takeover_until = $2
     WHERE conversation_id = $3`, [state, takeoverUntil ?? null, conversationId]);
    const afterRes = await db.query('SELECT conversation_id, client_phone, state FROM conversations WHERE conversation_id = $1', [conversationId]);
    const after = afterRes.rows[0] ?? null;
    if (after) {
        await (0, audit_1.logAudit)(db, {
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
async function updateLastInbound(db, conversationId) {
    await db.query('UPDATE conversations SET last_inbound_at = now() WHERE conversation_id = $1', [conversationId]);
}
async function updateLastOutbound(db, conversationId) {
    await db.query('UPDATE conversations SET last_outbound_at = now() WHERE conversation_id = $1', [conversationId]);
}
function shouldBotRespond(state, _now) {
    return state === 'BOT_ACTIVE';
}
function statePriority(state) {
    return STATE_PRIORITY[state] ?? 0;
}
async function getConversation(db, conversationId) {
    const res = await db.query('SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json FROM conversations WHERE conversation_id = $1', [conversationId]);
    return res.rows[0] ?? null;
}
async function getConversationByPhone(db, clientPhone) {
    const res = await db.query(`SELECT conversation_id, client_phone, state, state_updated_at::text, last_inbound_at::text, last_outbound_at::text, language_hint, takeover_until::text, metadata_json
     FROM conversations WHERE client_phone = $1 ORDER BY last_inbound_at DESC NULLS LAST LIMIT 1`, [clientPhone]);
    return res.rows[0] ?? null;
}
//# sourceMappingURL=conversation.js.map