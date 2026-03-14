-- Knowledge Base subsystem for AI agent
-- Tables:
-- - agent_policies
-- - agent_templates
-- - agent_examples
-- - agent_playbooks

-- A) Hard policies (strict rules)
CREATE TABLE IF NOT EXISTS agent_policies (
  key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global', -- 'global' or 'phone'
  phone TEXT NOT NULL DEFAULT '',
  value_json JSONB NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin',
  PRIMARY KEY (key, scope, phone)
);

CREATE INDEX IF NOT EXISTS idx_agent_policies_scope_phone ON agent_policies (scope, phone);
CREATE INDEX IF NOT EXISTS idx_agent_policies_priority ON agent_policies (priority DESC);

-- B) Templates
CREATE TABLE IF NOT EXISTS agent_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  intent TEXT NOT NULL,
  language TEXT NOT NULL,
  body TEXT NOT NULL,
  tags JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weight REAL NOT NULL DEFAULT 1.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_agent_templates_intent_lang ON agent_templates (intent, language);
CREATE INDEX IF NOT EXISTS idx_agent_templates_weight ON agent_templates (weight DESC);

-- C) Dialogue examples
CREATE TABLE IF NOT EXISTS agent_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  intent TEXT NOT NULL,
  language TEXT NOT NULL,
  label TEXT NOT NULL, -- GOOD | BAD
  client_text TEXT NOT NULL,
  agent_text TEXT NOT NULL,
  explanation TEXT,
  tags JSONB,
  weight REAL NOT NULL DEFAULT 1.0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_agent_examples_intent_lang_label ON agent_examples (intent, language, label);
CREATE INDEX IF NOT EXISTS idx_agent_examples_weight ON agent_examples (weight DESC);

-- D) Scenario playbooks (edge-case instructions)
CREATE TABLE IF NOT EXISTS agent_playbooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_key TEXT UNIQUE NOT NULL,
  language TEXT NOT NULL DEFAULT 'de',
  instruction TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  tags JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_agent_playbooks_priority ON agent_playbooks (priority DESC);

-- Seed initial policies based on existing salon rules
INSERT INTO agent_policies (key, scope, phone, value_json, priority, description, updated_by)
VALUES
  ('business_hours', 'global', '', '{"timezone":"Europe/Vienna","start":"08:00","end":"20:00"}', 100, 'Business hours for the salon', 'seed'),
  ('cancellation.always_approval', 'global', '', 'true', 200, 'All cancellations require admin approval', 'seed'),
  ('late.handoff_minutes', 'global', '', '15', 150, 'If client is >=15 minutes late, escalate to admin', 'seed'),
  ('refill.max_days', 'global', '', '21', 150, 'Refill allowed up to 21 days (normal)', 'seed'),
  ('refill.max_days_goodwill', 'global', '', '23', 140, 'Refill allowed up to 23 days as goodwill', 'seed'),
  ('topic.fee.discussion_handoff', 'global', '', 'true', 180, 'Any fee / ausfallgebühr discussion -> handoff', 'seed'),
  ('topic.discount.handoff', 'global', '', 'true', 180, 'Any discount request -> handoff', 'seed'),
  ('topic.complaint.handoff', 'global', '', 'true', 200, 'Any complaint -> handoff', 'seed')
ON CONFLICT DO NOTHING;

-- Seed forbidden phrases as a playbook (anti-patterns)
INSERT INTO agent_playbooks (scenario_key, language, instruction, priority, tags, updated_by)
VALUES
  (
    'forbidden_phrases',
    'de',
    E'- Niemals говорить клиенту, что это их проблема.\n- Не говорить, что \"Regeln sind Regeln\" без объяснения.\n- Не использовать фразы, что другие клиентки справляются, а вы нет.\n- Не перекладывать ответственность на клиента.\n- Если чувствуешь риск конфликта — сразу HANDOFF.',
    200,
    '["forbidden","tone","escalation"]'::jsonb,
    'seed'
  )
ON CONFLICT DO NOTHING;

