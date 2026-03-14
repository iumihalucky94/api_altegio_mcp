-- Orchestrator: conversations FSM
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  client_phone TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'BOT_ACTIVE',
  state_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  language_hint TEXT,
  takeover_until TIMESTAMPTZ,
  metadata_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_phone ON conversations (client_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations (state);

-- conversation_messages: dedupe index (message_id unique already in 002)
CREATE INDEX IF NOT EXISTS idx_conv_msg_conv_ts_hash ON conversation_messages (conversation_id, COALESCE(text_hash, ''), ts);

-- handoff_cases: add status, resolved_at, admin_response
ALTER TABLE handoff_cases ADD COLUMN IF NOT EXISTS case_id UUID;
UPDATE handoff_cases SET case_id = id WHERE case_id IS NULL;
ALTER TABLE handoff_cases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE handoff_cases ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE handoff_cases ADD COLUMN IF NOT EXISTS admin_response TEXT;
CREATE INDEX IF NOT EXISTS idx_handoff_cases_status ON handoff_cases (status);

-- agent_ignore_phones
CREATE TABLE IF NOT EXISTS agent_ignore_phones (
  phone TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'admin'
);

-- client_behavior_overrides
CREATE TABLE IF NOT EXISTS client_behavior_overrides (
  phone TEXT PRIMARY KEY,
  language_preference TEXT,
  tone_profile TEXT,
  force_handoff BOOLEAN NOT NULL DEFAULT false,
  notes_for_agent TEXT,
  blocked_topics JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

-- pending_admin_actions
CREATE TABLE IF NOT EXISTS pending_admin_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,
  conversation_id TEXT,
  client_phone TEXT NOT NULL,
  case_id UUID,
  approval_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reminded_at TIMESTAMPTZ,
  reminder_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN'
);

CREATE INDEX IF NOT EXISTS idx_pending_admin_status ON pending_admin_actions (status);
CREATE INDEX IF NOT EXISTS idx_pending_admin_created ON pending_admin_actions (created_at);

-- agent_global_state
CREATE TABLE IF NOT EXISTS agent_global_state (
  key TEXT PRIMARY KEY,
  value_bool BOOLEAN NOT NULL
);

INSERT INTO agent_global_state (key, value_bool) VALUES ('enabled', true) ON CONFLICT (key) DO NOTHING;

-- telegram_admins allowlist
CREATE TABLE IF NOT EXISTS telegram_admins (
  telegram_user_id BIGINT PRIMARY KEY,
  display_name TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- admin_config seeds for orchestrator
INSERT INTO admin_config (key, value_json, updated_by) VALUES
  ('business_hours.timezone', '"Europe/Vienna"', 'migration:004'),
  ('business_hours.start', '"08:00"', 'migration:004'),
  ('business_hours.end', '"20:00"', 'migration:004'),
  ('business_hours.night_message_enabled', 'true', 'migration:004'),
  ('whatsapp.debounce_ms', '20000', 'migration:004'),
  ('whatsapp.quiet_ms', '5000', 'migration:004'),
  ('whatsapp.max_buffered_messages', '10', 'migration:004'),
  ('whatsapp.max_debounce_total_ms', '60000', 'migration:004'),
  ('takeover.auto_enabled', 'true', 'migration:004'),
  ('takeover.auto_ttl_minutes', '240', 'migration:004'),
  ('takeover.auto_sender_detection_mode', '"webhook_best_effort"', 'migration:004'),
  ('admin_reminder.enabled', 'true', 'migration:004'),
  ('admin_reminder.first_after_minutes', '10', 'migration:004'),
  ('admin_reminder.repeat_every_minutes', '15', 'migration:004'),
  ('admin_reminder.max_reminders', '20', 'migration:004'),
  ('agent.confidence_threshold', '0.95', 'migration:004'),
  ('agent.max_clarifying_questions', '4', 'migration:004')
ON CONFLICT (key) DO NOTHING;
