-- Scenarios: list of conversation scenario codes
CREATE TABLE IF NOT EXISTS scenarios (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scenario policies: per-scenario autonomy and permissions (conservative defaults)
CREATE TABLE IF NOT EXISTS scenario_policies (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  autonomy_mode TEXT NOT NULL DEFAULT 'ASSIST_ONLY',
  allow_agent_to_reply BOOLEAN NOT NULL DEFAULT true,
  allow_agent_to_execute BOOLEAN NOT NULL DEFAULT false,
  allow_agent_to_create_handoff BOOLEAN NOT NULL DEFAULT true,
  requires_admin_approval BOOLEAN NOT NULL DEFAULT true,
  confidence_threshold NUMERIC(5,4) NOT NULL DEFAULT 0.97,
  max_attempts_before_handoff INT,
  config_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scenario_policies_scenario_id ON scenario_policies (scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_code ON scenarios (code);
CREATE INDEX IF NOT EXISTS idx_scenarios_is_active ON scenarios (is_active);

-- Seed scenarios
INSERT INTO scenarios (code, name, description, is_active) VALUES
  ('booking', 'Booking', 'New appointment / refill / removal', true),
  ('reschedule', 'Reschedule', 'Change existing appointment', true),
  ('cancel', 'Cancel', 'Cancel appointment', true),
  ('faq', 'FAQ', 'General questions', true),
  ('complaint', 'Complaint', 'Complaint or emotional', true),
  ('refill_policy', 'Refill policy', 'Refill timing / policy', true),
  ('pricing', 'Pricing', 'Prices / discounts', true),
  ('late_arrival', 'Late arrival', 'Client running late', true),
  ('unknown', 'Unknown', 'Unclear intent', true)
ON CONFLICT (code) DO NOTHING;

-- Seed conservative policies: allow_agent_to_reply true, allow_agent_to_execute false for mutating scenarios
INSERT INTO scenario_policies (scenario_id, autonomy_mode, allow_agent_to_reply, allow_agent_to_execute, allow_agent_to_create_handoff, requires_admin_approval)
SELECT s.id, 'ASSIST_ONLY', true, false, true, true
FROM scenarios s
WHERE s.code IN ('booking', 'reschedule', 'cancel', 'complaint', 'refill_policy', 'pricing', 'late_arrival', 'unknown', 'faq')
ON CONFLICT (scenario_id) DO NOTHING;
