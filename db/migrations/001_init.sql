-- Enable useful extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- MCP requests: one row per incoming MCP tool call
CREATE TABLE IF NOT EXISTS mcp_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  tool_name TEXT NOT NULL,
  request_body JSONB,
  response_body JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  idempotency_key TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mcp_requests_tool_name ON mcp_requests (tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_requests_created_at ON mcp_requests (created_at);

-- Altegio HTTP calls: one row per outgoing HTTP call
CREATE TABLE IF NOT EXISTS altegio_http_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mcp_request_id UUID REFERENCES mcp_requests (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  request_headers JSONB,
  request_body_masked JSONB,
  request_body_hash CHAR(64),
  response_status INTEGER,
  response_headers JSONB,
  response_body_masked JSONB,
  response_body_hash CHAR(64),
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_altegio_http_calls_mcp_request_id ON altegio_http_calls (mcp_request_id);
CREATE INDEX IF NOT EXISTS idx_altegio_http_calls_created_at ON altegio_http_calls (created_at);

-- Approvals lifecycle, linking plan/apply flows
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  plan_tool TEXT,
  apply_tool TEXT,
  plan_request_id UUID REFERENCES mcp_requests (id) ON DELETE SET NULL,
  apply_request_id UUID REFERENCES mcp_requests (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  approved_by TEXT,
  rejected_by TEXT,
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_approvals_action_key ON approvals (action_key);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);

-- Idempotency keys for apply_* and other dangerous operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key TEXT NOT NULL UNIQUE,
  action_key TEXT NOT NULL,
  first_request_id UUID REFERENCES mcp_requests (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | COMPLETED | FAILED
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_action_key ON idempotency_keys (action_key);

-- Approval policies registry
CREATE TABLE IF NOT EXISTS approval_policies (
  action_key TEXT PRIMARY KEY,
  require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_roles TEXT[] NOT NULL DEFAULT ARRAY['admin'],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Seed default policies for known dangerous actions
INSERT INTO approval_policies (action_key, require_approval, allowed_roles, updated_by)
VALUES
  ('crm.cancel_appointment', TRUE, ARRAY['admin'], 'migration:001_init'),
  ('payroll.apply_salary_result', TRUE, ARRAY['admin'], 'migration:001_init')
ON CONFLICT (action_key) DO NOTHING;

