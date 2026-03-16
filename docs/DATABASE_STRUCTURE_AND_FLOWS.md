# Full Database Structure and Data Flows

This document describes **all tables**, **who uses them** (gateway vs orchestrator vs wa-service), **when rows are created/updated**, and **how the pieces connect**. It is for the idea architect: to see the full picture and how to extend the system without breaking it.

---

## 1. One database, three consumers

| Consumer | Role | Tables it **writes** | Tables it **reads** |
|----------|------|----------------------|----------------------|
| **Gateway** | MCP server, Altegio CRM, approvals | mcp_requests, altegio_http_calls, approvals, idempotency_keys, approval_policies (via admin API) | admin_config, mcp_requests, approvals, idempotency_keys, approval_policies |
| **Orchestrator** | Conversations, AI agent, handoff, reminders | conversations, conversation_messages, handoff_cases, pending_admin_actions, agent_ignore_phones, client_behavior_overrides, audit_log | admin_config, conversations, conversation_messages, handoff_cases, pending_admin_actions, agent_ignore_phones, client_behavior_overrides, agent_policies, agent_templates, agent_examples, agent_playbooks |
| **wa-service** | WhatsApp Web only | (none) | admin_config (for wa.orchestrator_ingest_url, wa.internal_token) |

Migrations are run by **gateway** on startup (it mounts `db/migrations` and runs them in order). So all tables live in the **same Postgres database**; gateway and orchestrator (and wa-service) connect to it with the same credentials (per docker-compose).

---

## 2. Tables by layer

### 2.1 Gateway layer (MCP, Altegio, approvals)

These tables are **owned** by the gateway: the gateway creates and updates rows; the orchestrator does not touch them.

| Table | Purpose | Key columns | When rows are created/updated |
|-------|---------|-------------|-------------------------------|
| **mcp_requests** | One row per incoming `POST /mcp` call (tool invocation). Audit trail for every MCP request. | id, tool_name, request_body, response_body, status, idempotency_key, request_id, company_id, actor_json, decision, completed_at, duration_ms | **Insert** at start of each /mcp request (writeMcpRequest). **Update** on success (response_body, status, completed_at, duration) or on error (error_message, response_body, status). |
| **altegio_http_calls** | One row per HTTP call from gateway to Altegio API (made inside tool handlers). | id, mcp_request_id (FK → mcp_requests), method, url, request_body_masked, response_status, response_body_masked, duration_ms | **Insert** from gateway whenever a tool performs an Altegio HTTP request (writeHttpCall). mcp_request_id links the call to the MCP request that triggered it. |
| **approvals** | Plan/apply flow for dangerous actions (e.g. cancel appointment, apply salary). One row per approval request. | id, action_key, status (PENDING \| APPROVED \| REJECTED), plan_tool, apply_tool, plan_request_id (FK → mcp_requests), apply_request_id (FK → mcp_requests), details (JSONB), approved_by, approved_at | **Insert** when a plan tool runs and policy says require_approval (createApproval). **Update** when admin calls POST /approvals/:id/approve (markApprovalStatus) or when apply runs (linkApprovalToApply). |
| **idempotency_keys** | Ensures apply operations are idempotent: same idempotency_key cannot be applied twice. | idempotency_key (unique), action_key, first_request_id (FK → mcp_requests), status (PENDING \| COMPLETED \| FAILED), response_body | **Insert** on first apply with a given key (executeWithIdempotency). **Update** when apply completes (status, response_body, last_seen_at). |
| **approval_policies** | Registry: per action_key, whether approval is required and allowed_roles. | action_key (PK), require_approval, allowed_roles[] | **Read** by gateway when running plan/apply tools. **Written** by gateway admin route POST /admin/policies/set (upsertApprovalPolicy). Seeded in 001 for crm.cancel_appointment, payroll.apply_salary_result. |

**Flow (gateway):** Client/orchestrator calls `POST /mcp` with tool X → insert mcp_requests → if tool does Altegio HTTP → insert altegio_http_calls → if tool is plan and policy require_approval → insert approvals → later apply with idempotency_key → check/insert idempotency_keys → if approval needed, check approvals → update mcp_requests, approvals, idempotency_keys.

---

### 2.2 Shared config (all three consumers read)

| Table | Purpose | Key columns | When rows are created/updated |
|-------|---------|-------------|-------------------------------|
| **admin_config** | Key-value config; overrides ENV. DB wins over env when key exists. | key (PK), value_json (JSONB), updated_at, updated_by | **Read** by gateway (config resolver), orchestrator (config.ts), wa-service (config.ts). **Written** only via migrations and (if you add it) an admin API. Seeds: slots, business_hours, whatsapp debounce, agent confidence, wa-service URL/token (007), etc. |

No application code in this repo writes admin_config at runtime except migrations; it is the central place for operational and feature config.

---

### 2.3 Orchestrator layer (conversations, messages, handoff, behavior)

These tables are **owned** by the orchestrator: only the orchestrator writes to them (and reads them).

| Table | Purpose | Key columns | When rows are created/updated |
|-------|---------|-------------|-------------------------------|
| **conversations** | One row per dialogue (one per channel + client). For WhatsApp Web: conversation_id = `wa_web_{phone_digits}`, client_phone = E.164. | conversation_id (PK), client_phone, state (BOT_ACTIVE \| BOT_PAUSED \| ADMIN_TAKEOVER \| AWAITING_ADMIN \| IGNORED), state_updated_at, last_inbound_at, last_outbound_at, language_hint, takeover_until, metadata_json | **Insert** on first message from a client (getOrCreateConversation in ingest). **Update** state when handoff/pause/resume (setConversationState), last_inbound_at when message saved (updateLastInbound), last_outbound_at when bot sends (updateLastOutbound). **Read** in processBatch to decide if bot should respond and to pass language_hint to AI. |
| **conversation_messages** | Every message in a conversation (in and out). Backup of the dialogue for context and audit. | id, conversation_id, client_phone, ts, direction (in/out), author (client/agent/admin), text, message_id (provider id), text_hash, locale, metadata | **Insert** from orchestrator: (1) ingest: every incoming message (persistMessage, direction=in, author=client); (2) after sendWhatsAppMessage: every outgoing bot message (persistMessage, direction=out, author=agent). Dedup by (conversation_id, message_id) or (conversation_id, ts, direction, text_hash). **Read** when building context for AI (getLastMessages). |
| **handoff_cases** | When the bot escalates to a human: one row per case. | id, conversation_id, client_phone, client_name, language, last_messages (JSONB), summary, question_to_admin, status (OPEN/CLOSED etc.), resolved_at, admin_response, case_id (UUID, same as id), related_audit_ids, admin_view, client_message_suggestion, created_at | **Insert** when orchestrator creates a handoff (createHandoffCase in handoff.ts). **Update** when admin resolves (status, resolved_at, admin_response) — if you add an admin API or Telegram flow. **Read** by orchestrator and Telegram bot to list open cases and show details. |
| **pending_admin_actions** | Reminder queue: things that need admin attention (handoff case, approval from gateway, etc.). | id, type, conversation_id, client_phone, case_id (FK → handoff_cases.id), approval_id (UUID, can point to gateway approvals), status (OPEN/DONE), last_reminded_at, reminder_count | **Insert** when handoff is created or when orchestrator records “approval needed” (addPendingAction). **Update** when reminder is sent (last_reminded_at, reminder_count) or when action is done (status=DONE by approval_id). **Read** by reminder worker and Telegram bot. |
| **agent_ignore_phones** | Per-phone override: do not let the agent process this number, or only notify admin. | phone (PK), mode (IGNORE \| ADMIN_ONLY), reason, created_by | **Read** in ingest: if IGNORE → save message but do not enqueue; if ADMIN_ONLY → save, notify Telegram, do not enqueue. **Written** by admin (ignoreList.setIgnore, unignore) — e.g. via API or Telegram. |
| **client_behavior_overrides** | Per-phone tuning: language preference, force handoff, notes for agent, blocked topics. | phone (PK), language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics (JSONB), updated_by | **Read** in processBatch: if force_handoff → create handoff and skip AI. Other fields can be passed to AI context. **Written** by admin (behaviorOverrides). |
| **audit_log** | Append-only log of important changes (who did what, to which entity). | id, ts, actor_type, actor_id, source, action, entity_table, entity_id, before_json, after_json, diff_json, correlation_id, conversation_id, client_phone, metadata_json | **Insert** from orchestrator when: handoff created, pending action created/done, conversation state changed, client_behavior_overrides changed, agent_ignore_phones changed, KB changes (policies, templates, examples, playbooks). **Read** for debugging and analytics. Retention: cleanup job deletes old rows (auditCleanup worker). |
| **agent_global_state** | Simple feature flags / global state (e.g. bot enabled/disabled). | key (PK), value_bool | **Read** (e.g. to disable bot). Seeded: enabled=true. Rarely updated (could be via admin). |
| **telegram_admins** | Allowlist of Telegram users who can use admin commands and see logs. | telegram_user_id (PK), display_name, is_enabled | **Read** by Telegram bot to allow/deny commands. **Written** when you add/remove admins (admin flow or seed). |

**Flow (orchestrator):** Ingest receives message → getOrCreateConversation (conversations) → persistMessage (conversation_messages, in) → check agent_ignore_phones → if ok, enqueue. Later processBatch → getConversation, getBehaviorOverride (client_behavior_overrides) → maybe createHandoffCase (handoff_cases) + addPendingAction (pending_admin_actions) + setConversationState (conversations) → or call AI → send reply → persistMessage (conversation_messages, out) + updateLastOutbound (conversations). All important mutations also log to audit_log.

---

### 2.4 Knowledge Base (orchestrator reads; admin/KB API writes)

| Table | Purpose | Key columns | When rows are created/updated |
|-------|---------|-------------|-------------------------------|
| **agent_policies** | Hard rules: key + scope (global or per phone) + value_json. E.g. business_hours, cancellation always approval, handoff on discount. | key, scope, phone (composite PK), value_json, priority, is_enabled, description | **Read** by orchestrator KB layer (getKbContext) to build context for the AI. **Written** via KB admin API (orchestrator routes/kb.ts) or seed (005, KB_STARTER_PACK). |
| **agent_templates** | Reply templates per intent and language. | id, name, intent, language, body, tags, is_enabled, weight | **Read** by KB for templates block in prompt. **Written** via KB API / seed. |
| **agent_examples** | Good/bad dialogue examples per intent and language. | id, intent, language, label (GOOD/BAD), client_text, agent_text, explanation, tags, weight, is_enabled | **Read** by KB for examples in prompt. **Written** via KB API / seed. |
| **agent_playbooks** | Scenario-level instructions (e.g. forbidden phrases, edge cases). | id, scenario_key (unique), language, instruction, priority, is_enabled, tags | **Read** by KB for playbooks in prompt. **Written** via KB API / seed. |

The orchestrator never writes these during a chat; it only reads them when building the AI prompt. Writes happen from admin (KB API) or migrations/seeds.

---

## 3. Cross-cutting relationships (FK and logical links)

- **conversation_id** is the main join key for “this dialogue”:
  - **conversations.conversation_id** = primary row for the dialogue.
  - **conversation_messages.conversation_id** = all messages in that dialogue.
  - **handoff_cases.conversation_id** = handoff cases for that dialogue.
  - **pending_admin_actions.conversation_id** = optional link to the conversation for the pending action.
  - **audit_log.conversation_id** = optional link for filtering audit by conversation.

- **client_phone** (E.164) appears in: conversations, conversation_messages, handoff_cases, pending_admin_actions, agent_ignore_phones, client_behavior_overrides, audit_log. It is the stable client identifier.

- **Gateway approvals** are not FK to orchestrator tables. **pending_admin_actions.approval_id** is a UUID that can point to **gateway’s approvals.id** only by convention (same DB); the gateway does not reference orchestrator tables. So: handoff_cases and pending_admin_actions are orchestrator’s view of “work for admin”; approvals and idempotency_keys are gateway’s view of “plan/apply and idempotency”. They coexist in one DB but are used by different services.

- **mcp_requests** has no FK to conversations. The link is logical: the orchestrator calls the gateway with a request_id and optional conversation_id in the envelope; the gateway stores them in mcp_requests (request_id, actor_json). So you can correlate MCP calls to conversations only via application logic (e.g. request_id or actor metadata), not by a DB FK.

---

## 4. When and where: end-to-end flow

1. **Client sends WhatsApp message**  
   wa-service receives it, does **not** write to DB; it POSTs to orchestrator `/ingest/whatsapp-web`.

2. **Orchestrator ingest**  
   - Reads: admin_config (MCP_INTERNAL_TOKEN equivalent), agent_ignore_phones, client_behavior_overrides (indirectly via allowlist logic).  
   - Writes: **conversations** (getOrCreateConversation), **conversation_messages** (persistMessage, in), **conversations** (updateLastInbound).  
   - Then enqueues to in-memory debounce (no DB write).

3. **Debounce fires → processBatch**  
   - Reads: **conversations** (getConversation, shouldBotRespond), **client_behavior_overrides** (force_handoff), **admin_config** (business_hours, OPENAI key, etc.), **agent_policies**, **agent_templates**, **agent_examples**, **agent_playbooks** (getKbContext), **conversation_messages** (getLastMessages).  
   - May write: **handoff_cases**, **pending_admin_actions**, **conversations** (setConversationState), **audit_log**.  
   - Or: calls gateway **POST /mcp** (create_appointment, get_free_slots, etc.) — gateway then writes **mcp_requests**, **altegio_http_calls**, **approvals**, **idempotency_keys** as needed.  
   - Then: **conversation_messages** (persistMessage, out), **conversations** (updateLastOutbound), **audit_log**.

4. **Gateway MCP**  
   - Reads: **admin_config** (config resolver), **approval_policies**, **approvals**, **idempotency_keys**.  
   - Writes: **mcp_requests**, **altegio_http_calls**, **approvals**, **idempotency_keys**.

5. **Admin / Telegram**  
   - Reads: **handoff_cases**, **pending_admin_actions**, **conversations**, **telegram_admins**.  
   - Writes (if you add flows): **handoff_cases** (resolve), **pending_admin_actions** (mark done), **agent_ignore_phones**, **client_behavior_overrides**, **audit_log**.

6. **wa-service**  
   - Reads only: **admin_config** (wa.orchestrator_ingest_url, wa.internal_token) to know where to forward messages and which token to send.

---

## 5. How to extend without breaking (for the architect)

- **New orchestrator-driven feature (e.g. scenario_policies, conversation_events, reviews):**  
  Add **new tables** with FK to **conversations.conversation_id** (and optionally conversation_messages.id). Run new migrations from the same `db/migrations` (gateway already runs them). Only orchestrator code should write to these tables; gateway and wa-service stay unchanged.

- **New config keys:**  
  Add rows to **admin_config** (migration or admin API). All three consumers can read them; only orchestrator or gateway need to interpret them in code.

- **New gateway-side audit or policy:**  
  Extend **mcp_requests** (e.g. new columns) or add new tables with FK to mcp_requests.id. Keep orchestrator agnostic of gateway internals.

- **Preserve contracts:**  
  - Ingest: body shape and 200 OK behavior.  
  - Conversation identity: conversation_id = `wa_web_{digits}` for WhatsApp.  
  - Message backup: every in/out through orchestrator must still write to **conversation_messages** and update **conversations** (last_inbound_at / last_outbound_at, state) so the rest of the system (handoff, reminders, future review) stays consistent.

This document is the single place that describes the full database structure, who uses what, and when and where data is written and read, so the idea architect can develop the approach and next steps (e.g. staged implementation plan) in an integrated way.
