-- When admin corrects an agent reply (for review loop / training)
CREATE TABLE IF NOT EXISTS conversation_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  original_agent_output TEXT NOT NULL,
  corrected_admin_output TEXT NOT NULL,
  correction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_corrections_conversation_id ON conversation_corrections (conversation_id);
