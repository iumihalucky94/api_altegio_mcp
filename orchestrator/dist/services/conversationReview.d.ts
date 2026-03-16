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
export declare function createReview(db: DbPool, conversationId: string, reviewerType: string, scores: ReviewScores, comment?: string | null): Promise<string>;
export declare function addTag(db: DbPool, reviewId: string, tag: string): Promise<void>;
export declare function getReviewsByConversation(db: DbPool, conversationId: string): Promise<ReviewRecord[]>;
//# sourceMappingURL=conversationReview.d.ts.map