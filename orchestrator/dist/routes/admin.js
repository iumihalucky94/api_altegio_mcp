"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminRoutes = registerAdminRoutes;
const conversation_1 = require("../services/conversation");
const e164_1 = require("../lib/e164");
const conversationReview_1 = require("../services/conversationReview");
function requireAdminToken(request, app) {
    const token = request.headers['x-internal-token'] || (request.headers['authorization']?.replace(/^Bearer\s+/i, ''));
    return app.getMcpInternalToken?.().then((expected) => (expected && token !== expected ? null : token));
}
/** POST /admin/resume — вернуть диалог в BOT_ACTIVE (чтобы ИИ снова отвечал). Защищён x-internal-token. */
async function registerAdminRoutes(app) {
    const db = app.db;
    app.post('/admin/resume', async (request, reply) => {
        const token = await requireAdminToken(request, app);
        if (token === null)
            return reply.code(401).send({ error: 'Unauthorized' });
        const phoneRaw = request.body?.client_phone_e164 ?? '';
        const phone = (0, e164_1.normalizeE164)(phoneRaw.trim());
        if (!(0, e164_1.isValidE164)(phone)) {
            return reply.code(400).send({ error: 'Invalid client_phone_e164', usage: 'POST /admin/resume body: { "client_phone_e164": "+4367762665083" }' });
        }
        const conv = await (0, conversation_1.getConversationByPhone)(db, phone);
        if (!conv) {
            return reply.code(404).send({ error: 'No conversation found for this phone', phone });
        }
        await (0, conversation_1.setConversationState)(db, conv.conversation_id, 'BOT_ACTIVE');
        return reply.send({ ok: true, conversation_id: conv.conversation_id, state: 'BOT_ACTIVE', message: 'Bot can respond again for this chat.' });
    });
    /** POST /admin/conversations/:conversationId/review — сохранить оценку качества диалога. Защищён x-internal-token. */
    app.post('/admin/conversations/:conversationId/review', async (request, reply) => {
        if (await requireAdminToken(request, app) === null) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        const conversationId = request.params.conversationId?.trim();
        if (!conversationId) {
            return reply.code(400).send({ error: 'Missing conversationId' });
        }
        const body = request.body ?? {};
        const reviewerType = body.reviewer_type ?? 'admin';
        const scores = {
            score_overall: body.score_overall,
            score_language: body.score_language,
            score_accuracy: body.score_accuracy,
            score_tone: body.score_tone,
            score_policy_compliance: body.score_policy_compliance,
            score_sales_quality: body.score_sales_quality
        };
        const reviewId = await (0, conversationReview_1.createReview)(db, conversationId, reviewerType, scores, body.comment ?? null);
        const tags = Array.isArray(body.tags) ? body.tags : [];
        for (const tag of tags) {
            if (typeof tag === 'string' && tag.trim())
                await (0, conversationReview_1.addTag)(db, reviewId, tag.trim());
        }
        return reply.send({ ok: true, review_id: reviewId, conversation_id: conversationId });
    });
    /** GET /admin/conversations/:conversationId/reviews — список оценок по диалогу. Защищён x-internal-token. */
    app.get('/admin/conversations/:conversationId/reviews', async (request, reply) => {
        if (await requireAdminToken(request, app) === null) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        const conversationId = request.params.conversationId?.trim();
        if (!conversationId) {
            return reply.code(400).send({ error: 'Missing conversationId' });
        }
        const reviews = await (0, conversationReview_1.getReviewsByConversation)(db, conversationId);
        return reply.send({ reviews });
    });
    /** GET /admin/conversations/:conversationId/last-handoff — причина последней передачи (confidence, решение ИИ, ответ агента). Защищён x-internal-token. */
    app.get('/admin/conversations/:conversationId/last-handoff', async (request, reply) => {
        if (await requireAdminToken(request, app) === null) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        const conversationId = request.params.conversationId?.trim();
        if (!conversationId) {
            return reply.code(400).send({ error: 'Missing conversationId' });
        }
        const res = await db.query(`SELECT id::text, event_type, event_payload_json, created_at::text
       FROM conversation_events
       WHERE conversation_id = $1 AND event_type = 'handoff_created'
       ORDER BY created_at DESC LIMIT 1`, [conversationId]);
        const row = res.rows[0];
        if (!row) {
            return reply.send({ handoff: null, message: 'No handoff_created event for this conversation' });
        }
        const payload = row.event_payload_json || {};
        return reply.send({
            handoff: {
                event_id: row.id,
                created_at: row.created_at,
                reason_code: payload.reason_code ?? null,
                confidence: payload.confidence ?? null,
                decision: payload.decision ?? null,
                summary: payload.summary ?? null,
                reply_text_preview: payload.reply_text_preview ?? null,
                tags: payload.tags ?? null
            }
        });
    });
}
//# sourceMappingURL=admin.js.map