-- Central append-only audit log for orchestrator + KB

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id TEXT,
  before_json JSONB,
  after_json JSONB,
  diff_json JSONB,
  correlation_id TEXT,
  request_id TEXT,
  conversation_id TEXT,
  client_phone TEXT,
  metadata_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts_desc ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_ts ON audit_log (action, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id ON audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_conversation_ts ON audit_log (conversation_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_client_phone_ts ON audit_log (client_phone, ts DESC);

