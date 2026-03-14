-- admin_config hardening: ensure schema matches MCP_ADMIN_PROTOCOL_V1
CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

-- Backfill NULL updated_by, if any, to keep NOT NULL constraint safe
UPDATE admin_config
SET updated_by = 'admin'
WHERE updated_by IS NULL;

