-- Human review of conversation quality
CREATE TABLE IF NOT EXISTS conversation_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  reviewer_type TEXT NOT NULL,
  score_overall NUMERIC(3,2),
  score_language NUMERIC(3,2),
  score_accuracy NUMERIC(3,2),
  score_tone NUMERIC(3,2),
  score_policy_compliance NUMERIC(3,2),
  score_sales_quality NUMERIC(3,2),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_reviews_conversation_id ON conversation_reviews (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_reviews_created_at ON conversation_reviews (created_at);

-- Tags attached to a review
CREATE TABLE IF NOT EXISTS conversation_review_tags (
  id SERIAL PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES conversation_reviews(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_review_tags_review_id ON conversation_review_tags (review_id);
