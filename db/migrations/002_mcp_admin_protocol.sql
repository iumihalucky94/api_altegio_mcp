-- admin_config: DB overrides for config (config resolver: DB > ENV)
CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO admin_config (key, value_json, updated_by) VALUES
  ('slots_default_limit', '3', 'migration:002'),
  ('preferred_master_threshold', '0.8', 'migration:002'),
  ('cancel_policy_mode', '"always_approval"', 'migration:002')
ON CONFLICT (key) DO NOTHING;

-- conversation_messages: for conversation.append_messages (dedupe by message_id or ts+direction+hash)
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  message_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash CHAR(64),
  locale TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_dedup_id ON conversation_messages (conversation_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_ts ON conversation_messages (conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_client_phone ON conversation_messages (client_phone);

-- handoff_cases: for handoff.create_case
CREATE TABLE IF NOT EXISTS handoff_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_name TEXT,
  language TEXT NOT NULL,
  last_messages JSONB,
  summary TEXT NOT NULL,
  question_to_admin TEXT NOT NULL,
  related_audit_ids UUID[],
  admin_view TEXT,
  client_message_suggestion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handoff_cases_conversation_id ON handoff_cases (conversation_id);
CREATE INDEX IF NOT EXISTS idx_handoff_cases_created_at ON handoff_cases (created_at);

-- extend mcp_requests for envelope audit (request_id, company_id, actor, decision)
ALTER TABLE mcp_requests ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE mcp_requests ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE mcp_requests ADD COLUMN IF NOT EXISTS actor_json JSONB;
ALTER TABLE mcp_requests ADD COLUMN IF NOT EXISTS decision TEXT;
CREATE INDEX IF NOT EXISTS idx_mcp_requests_decision ON mcp_requests (decision);
CREATE INDEX IF NOT EXISTS idx_mcp_requests_company_id ON mcp_requests (company_id);
