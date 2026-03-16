import type { DbPool } from '../db';

export interface ReviewScores {
  score_overall?: number;
  score_language?: number;
  score_accuracy?: number;
  score_tone?: number;
  score_policy_compliance?: number;
  score_sales_quality?: number;
}

export interface ReviewRecord {
  id: string;
  conversation_id: string;
  reviewer_type: string;
  score_overall: number | null;
  score_language: number | null;
  score_accuracy: number | null;
  score_tone: number | null;
  score_policy_compliance: number | null;
  score_sales_quality: number | null;
  comment: string | null;
  created_at: string;
  tags: string[];
}

export async function createReview(
  db: DbPool,
  conversationId: string,
  reviewerType: string,
  scores: ReviewScores,
  comment?: string | null
): Promise<string> {
  const res = await db.query(
    `INSERT INTO conversation_reviews (
      conversation_id, reviewer_type,
      score_overall, score_language, score_accuracy, score_tone, score_policy_compliance, score_sales_quality,
      comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      conversationId,
      reviewerType,
      scores.score_overall ?? null,
      scores.score_language ?? null,
      scores.score_accuracy ?? null,
      scores.score_tone ?? null,
      scores.score_policy_compliance ?? null,
      scores.score_sales_quality ?? null,
      comment ?? null
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

export async function addTag(db: DbPool, reviewId: string, tag: string): Promise<void> {
  await db.query(
    `INSERT INTO conversation_review_tags (review_id, tag) VALUES ($1::uuid, $2)`,
    [reviewId, tag]
  );
}

export async function getReviewsByConversation(db: DbPool, conversationId: string): Promise<ReviewRecord[]> {
  const res = await db.query(
    `SELECT id::text, conversation_id, reviewer_type,
            score_overall, score_language, score_accuracy, score_tone, score_policy_compliance, score_sales_quality,
            comment, created_at::text
     FROM conversation_reviews
     WHERE conversation_id = $1
     ORDER BY created_at DESC`,
    [conversationId]
  );
  const reviews: ReviewRecord[] = [];
  for (const row of res.rows as any[]) {
    const tagRes = await db.query(
      `SELECT tag FROM conversation_review_tags WHERE review_id = $1::uuid ORDER BY id`,
      [row.id]
    );
    const tags = (tagRes.rows as { tag: string }[]).map((r) => r.tag);
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
