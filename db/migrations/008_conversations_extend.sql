-- Extend conversations for scenario, review, and language tracking (nullable)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS detected_primary_language TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS current_scenario_code TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS review_status TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS review_score NUMERIC;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS review_comment TEXT;
