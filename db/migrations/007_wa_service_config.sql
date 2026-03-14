-- Optional config keys for wa-service (overrides ENV when set in admin_config).
-- wa-service reads: wa.orchestrator_ingest_url, wa.internal_token (fallback: ORCHESTRATOR_INGEST_URL, WA_INTERNAL_TOKEN).
INSERT INTO admin_config (key, value_json, updated_by) VALUES
  ('wa.orchestrator_ingest_url', '""', 'migration:007'),
  ('wa.internal_token', '""', 'migration:007')
ON CONFLICT (key) DO NOTHING;
