"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReview = createReview;
exports.addTag = addTag;
exports.getReviewsByConversation = getReviewsByConversation;
async function createReview(db, conversationId, reviewerType, scores, comment) {
    const res = await db.query(`INSERT INTO conversation_reviews (
      conversation_id, reviewer_type,
      score_overall, score_language, score_accuracy, score_tone, score_policy_compliance, score_sales_quality,
      comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`, [
        conversationId,
        reviewerType,
        scores.score_overall ?? null,
        scores.score_language ?? null,
        scores.score_accuracy ?? null,
        scores.score_tone ?? null,
        scores.score_policy_compliance ?? null,
        scores.score_sales_quality ?? null,
        comment ?? null
    ]);
    return res.rows[0].id;
}
async function addTag(db, reviewId, tag) {
    await db.query(`INSERT INTO conversation_review_tags (review_id, tag) VALUES ($1::uuid, $2)`, [reviewId, tag]);
}
async function getReviewsByConversation(db, conversationId) {
    const res = await db.query(`SELECT id::text, conversation_id, reviewer_type,
            score_overall, score_language, score_accuracy, score_tone, score_policy_compliance, score_sales_quality,
            comment, created_at::text
     FROM conversation_reviews
     WHERE conversation_id = $1
     ORDER BY created_at DESC`, [conversationId]);
    const reviews = [];
    for (const row of res.rows) {
        const tagRes = await db.query(`SELECT tag FROM conversation_review_tags WHERE review_id = $1::uuid ORDER BY id`, [row.id]);
        const tags = tagRes.rows.map((r) => r.tag);
        reviews.push({
            id: row.id,
            conversation_id: row.conversation_id,
            reviewer_type: row.reviewer_type,
            score_overall: row.score_overall,
            score_language: row.score_language,
            score_accuracy: row.score_accuracy,
            score_tone: row.score_tone,
            score_policy_compliance: row.score_policy_compliance,
            score_sales_quality: row.score_sales_quality,
            comment: row.comment,
            created_at: row.created_at,
            tags
        });
    }
    return reviews;
}
//# sourceMappingURL=conversationReview.js.map