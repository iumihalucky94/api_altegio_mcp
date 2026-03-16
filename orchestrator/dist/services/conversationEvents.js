"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendConversationEvent = appendConversationEvent;
async function appendConversationEvent(db, conversationId, eventType, payload) {
    await db.query(`INSERT INTO conversation_events (conversation_id, event_type, event_payload_json)
     VALUES ($1, $2, $3)`, [conversationId, eventType, payload != null ? JSON.stringify(payload) : null]);
}
//# sourceMappingURL=conversationEvents.js.map