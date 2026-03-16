"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistMessage = persistMessage;
exports.getLastMessages = getLastMessages;
const crypto_1 = __importDefault(require("crypto"));
async function persistMessage(db, params) {
    const textHash = crypto_1.default.createHash('sha256').update(params.text).digest('hex');
    if (params.messageId) {
        const existing = await db.query('SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND message_id = $2', [params.conversationId, params.messageId]);
        if (existing.rows.length > 0)
            return false;
    }
    else {
        const existing = await db.query('SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND ts = $2 AND direction = $3 AND text_hash = $4', [params.conversationId, params.ts, params.direction, textHash]);
        if (existing.rows.length > 0)
            return false;
    }
    await db.query(`INSERT INTO conversation_messages (conversation_id, client_phone, ts, direction, author, text, message_id, text_hash, locale, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
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
    ]);
    return true;
}
async function getLastMessages(db, conversationId, limit) {
    const res = await db.query(`SELECT ts::text, direction, author, text FROM conversation_messages
     WHERE conversation_id = $1 ORDER BY ts DESC LIMIT $2`, [conversationId, limit]);
    return res.rows.reverse();
}
//# sourceMappingURL=messageStore.js.map