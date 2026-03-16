# Staged Implementation Plan — Altegio Agent Evolution

This document breaks the GPT prompt goals into **ordered stages and sub-tasks**, integrated with the existing DB and code. Each stage is implementable on its own; dependencies are explicit. At the end there is a **self-review** so you can rate the plan and we can proceed.

---

## Principles (non‑negotiable)

- **Do not break:** ingest contract (`POST /ingest/whatsapp-web`), AI response shape (decision, reply_text, handoff, mcp_calls), debounce/processBatch flow, wa-service ↔ orchestrator.
- **Extend, do not replace:** Use existing `conversations`, `conversation_messages`, `handoff_cases`. Add new tables with FK to existing; add columns where needed; do not rename or drop current tables for this plan.
- **One focus per stage:** Each stage has a clear outcome and a limited set of files/migrations so it can be implemented and tested without touching everything.
- **GPT intent preserved:** Language lock, scenario-level policies, audit trail, review loop, and “no slot confirm without tool” remain goals; they are just split across stages.

---

## Stage 1 — Language & localization (quick win)

**Goal:** All customer-facing system messages (AI path and legacy/non-AI path) respect the client’s language. No hardcoded German (or any single language) in code.

**Scope:** Orchestrator only. No DB schema change if we use in-code or `admin_config` for template keys.

| # | Sub-task | What to do | Files / place |
|---|----------|------------|----------------|
| 1.1 | Add localization module | Create module with `getSystemMessage(key, lang)` and **resolveReplyLanguage(batchText, languageHint?, languagePreference?)**. For `language=mixed`: do **not** blindly fallback to `de`; resolve in order: (1) `language_preference` (client_behavior_overrides), (2) `conversations.language_hint`, (3) heuristics from latest message; only then default (e.g. `de`). | New: `orchestrator/src/services/localization.ts`. |
| 1.2 | Define message keys | Keys: `booking_failed`, `booking_not_confirmed_fallback`, `handoff_ack`, `generic_ack`, **`upcoming_appointments`**, **`generic_reply`** (legacy path). Default texts for `de`, `ru`, `en`. | Same module or `admin_config`. |
| 1.3 | Replace hardcoded strings (AI path) | After `detectLanguage`, if result is `mixed` call `resolveReplyLanguage(batchText, conv.language_hint, overrides?.language_preference)`. Use effective lang for all system messages. Replace German strings and handoff ack with `getSystemMessage(key, effectiveLang)`. | `orchestrator/src/services/agentProcessor.ts` (AI path). |
| 1.4 | Replace hardcoded strings (legacy path) | Legacy/non-AI path (upcoming appointments, generic reply): resolve language the same way; use `getSystemMessage('upcoming_appointments', lang)` and `getSystemMessage('generic_reply', lang)`. | `orchestrator/src/services/agentProcessor.ts` (legacy path ~119, 124). |
| 1.5 | System prompt note | Add one line that system fallbacks are supplied by the code in the client’s language. | `orchestrator/src/prompts/aiAgentSystemPrompt.ts`. |

**Exit criterion:** All customer-facing replies (AI and legacy) go through localization; for `mixed`, effective language from preference/hint/heuristics, not blind `de`.

**No change:** Ingest, AI JSON contract, gateway, wa-service.

---

## Stage 2 — Data model extensions (DB only)

**Goal:** Add tables needed for scenario policies, conversation events, and later review — without renaming or replacing existing ones.

**Scope:** Migrations only. Application code that *uses* these tables comes in Stage 3–5.

| # | Sub-task | What to do | Migration / table |
|---|----------|------------|-------------------|
| 2.1 | Extend `conversations` (optional) | Add columns only if needed later: e.g. `detected_primary_language TEXT`, `current_scenario_code TEXT`, `review_status TEXT`, `review_score NUMERIC`, `review_comment TEXT`. All nullable. | New migration e.g. `008_conversations_extend.sql`. |
| 2.2 | Add `scenarios` | Table: `id` (serial or UUID), `code` (e.g. booking, reschedule, cancel, faq, unknown), `name`, `description`, `is_active`, `created_at`, `updated_at`. Seed rows for booking, reschedule, cancel, faq, complaint, unknown. | Same or new migration `009_scenarios.sql`. |
| 2.3 | Add `scenario_policies` | Same columns. **Seed default policies conservatively:** do **not** enable mutating autonomy by default. Example: `allow_agent_to_reply` true, `allow_agent_to_execute` **false** for booking/reschedule/cancel, `requires_admin_approval` true for mutating. Explicit policy change required to enable execute. | Same migration. |
| 2.4 | Add `conversation_events` | Table: `id`, `conversation_id` **NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE**, `event_type`, `event_payload_json` (JSONB), `created_at`. Index on (conversation_id, created_at). Use FK for referential integrity. | Same or `010_conversation_events.sql`. |
| 2.5 | Add `conversation_reviews` | Table: `id`, `conversation_id`, `reviewer_type`, `score_overall`, `score_language`, `score_accuracy`, `comment`, `created_at`. Optional: `conversation_review_tags` (review_id, tag). | Migration `011_conversation_reviews.sql`. |
| 2.6 | Add `conversation_corrections` (optional, for later) | Table: `id`, `conversation_id`, `message_id` (FK to conversation_messages.id if you add it), `original_agent_output`, `corrected_admin_output`, `correction_reason`, `created_at`. Can be Stage 5 or 6. | Same or later migration. |

**Exit criterion:** Migrations run cleanly; existing app still works (no code uses new tables yet).

**No change:** Existing columns in `conversations` / `conversation_messages`; ingest or AI contract.

---

## Stage 3 — Scenario policies & decision guards

**Goal:** Before executing **mutating** tools or sending a reply, the orchestrator checks scenario policy. **Execute** is allowed only when: policy permission + sufficient context + successful validation; confidence_threshold is an additional safeguard, not a standalone permission.

**Scope:** Orchestrator: intent → scenario mapping, policy load, **mutating vs read-only tool list**, guards in `agentProcessor`.

| # | Sub-task | What to do | Files / place |
|---|----------|------------|----------------|
| 3.1 | Map intent to scenario | Reuse `classifyIntent`; map intent to a scenario `code` (e.g. booking → booking, cancel → cancel). Store in conversation or pass through to policy loader. | `orchestrator/src/services/intent.ts` or new `orchestrator/src/services/scenarioPolicy.ts`. |
| 3.2 | Policy loader | Function: given scenario code (and optionally conversation_id), load one row from `scenario_policies`. Return autonomy_mode, allow_agent_to_reply, allow_agent_to_execute, allow_agent_to_create_handoff, requires_admin_approval, confidence_threshold. | New: `orchestrator/src/services/scenarioPolicy.ts` (+ repository or direct query). |
| 3.3 | Guard: reply | Before sending the AI’s reply_text (or fallback), check `allow_agent_to_reply`. If false, do not send; optionally create handoff or send a single “we’ll get back to you” message (via localization). | `agentProcessor.ts`: where you call `sendAndLog` for the main reply. |
| 3.3b | Mutating vs read-only tools | Explicit list: mutating = e.g. `crm.create_appointment`, `crm.reschedule_appointment`, `crm.cancel_appointment.apply`. Read-only = get_free_slots, list_services, get_upcoming_appointments_by_phone, validate_slot, search_clients, etc. Export `isMutatingTool(tool)`. Apply execute guards **only to mutating tools**; read-only always allowed. | `scenarioPolicy.ts` or tools config. |
| 3.4 | Guard: execute (mutating only) | Before each **mutating** MCP call, check `allow_agent_to_execute`. Execute allowed only when: (1) policy.allow_agent_to_execute true, (2) sufficient context (slot/params validated), (3) tool validation succeeded, (4) confidence >= threshold as **additional safeguard** (not a substitute for (1)–(3)). | `agentProcessor.ts`: around `callMcp` for mutating tools only. |
| 3.5 | Guard: handoff | If policy says “allow_agent_to_create_handoff” is false but the AI returned handoff, treat as “reply only” or “approval required” (do not create handoff case; optionally notify). If true, keep current handoff flow. | `agentProcessor.ts`: where you call `createHandoffAndPause*`. |
| 3.6 | Persist scenario / policy snapshot | When you determine scenario and load policy, optionally write to `conversation_events` (event_type = scenario_selected, policy_applied) and store current_scenario_code on conversation if you added the column. | Same flow; use `conversation_events` from Stage 2. |

**Exit criterion:** Mutating tools gated by policy; read-only tools always allowed when invoked. Execute never allowed by confidence alone — requires policy + context + validation.

**No change:** Ingest, AI response shape; only *when* we execute (mutating) or send is gated.

---

## Stage 4 — Conversation events & audit

**Goal:** Important decisions and actions are recorded in `conversation_events` so you have an audit trail (language_detected, intent_detected, tool_called, tool_failed, handoff_created, reply_sent, etc.).

**Scope:** Orchestrator: add event writes next to existing logic (no new flows).

| # | Sub-task | What to do | Files / place |
|---|----------|------------|----------------|
| 4.1 | Event writer helper | Function: `appendConversationEvent(db, conversationId, eventType, payload)`. Inserts into `conversation_events`. | New: `orchestrator/src/services/conversationEvents.ts` (or under audit.ts). |
| 4.2 | Emit events at key points | Call the helper after: language detection (language_detected), intent classification (intent_detected), scenario selection (scenario_selected if you have it), before/after MCP tool call (tool_called, tool_succeeded, tool_failed), handoff creation (handoff_created), before sendAndLog (reply_sent). Payload can include minimal data (e.g. intent, tool name, success/fail). | `agentProcessor.ts`, and anywhere handoff is created. |
| 4.3 | Optional: update conversation columns | If you added `detected_primary_language` or `current_scenario_code` on `conversations`, update them when you detect language or scenario. | `conversation.ts` or agentProcessor. |

**Exit criterion:** For a full dialogue, querying `conversation_events` shows a chronological list of event_type and payload for that conversation.

**No change:** Ingest or AI contract; only additive logging.

---

## Stage 5 — Review loop foundation

**Goal:** Humans can attach a review (scores, comment, tags) to a conversation. Data is stored and can be used later for analytics or training (not implemented in this plan).

**Scope:** DB already has `conversation_reviews` (and optionally `conversation_review_tags`). Add minimal API and, if needed, a simple UI or Telegram command to submit a review.

| # | Sub-task | What to do | Files / place |
|---|----------|------------|----------------|
| 5.1 | Review repository | Functions: createReview(conversationId, reviewerType, scores, comment), addTag(reviewId, tag), getReviewsByConversation(conversationId). | New: `orchestrator/src/services/conversationReview.ts`. |
| 5.2 | API or admin action | Option A: POST endpoint e.g. `/admin/conversations/:id/review` (protected by admin key) with body { score_overall, score_language, score_accuracy, comment, tags[] }. Option B: Telegram bot command e.g. `/review <conversation_id> <score> <comment>`. | `orchestrator/src/routes/admin.ts` or telegram bot. |
| 5.3 | Optional: conversation_corrections | If you added the table, add a way to store a corrected reply (original_agent_output, corrected_admin_output, reason) for a given message. Can be same admin API or separate. | Same or new route. |

**Exit criterion:** An admin can submit a review for a conversation; it is stored and retrievable. No need for a full UI in this stage.

**No change:** Ingest or main agent flow; only new read/write for reviews.

---

## Stage 6 — Optional refinements (later)

**Goal:** Things from the GPT prompt that are useful but not required for the first iteration.

| Item | Description | When |
|------|-------------|------|
| prompt_versions | Table storing prompt text by version; agent uses “active” version. | When you want to A/B test or roll back prompts without deploy. |
| policy_versions | Snapshot of scenario_policies at a point in time for auditing. | When you need “which policy was active when this conversation happened”. |
| Slot guard reinforcement | Code already uses get_free_slots and validate_slot; add an explicit check in agentProcessor that we never send a “confirmed” style reply unless create_appointment succeeded (you already have a variant of this). | Can be a small task inside Stage 1 or 3. |
| Centralized “response writer” module | Single place that takes (reply_text, lang, policy) and applies any last-mile formatting or template. | When you have many reply types and want one place for sanitization. |

These are listed so the plan stays bounded; they are not part of the mandatory sequence.

---

## Dependencies (order of execution)

```
Stage 1 (language)     → no dependency; do first.
Stage 2 (DB)           → no dependency; do second (or in parallel with 1 if different people).
Stage 3 (policies)      → requires Stage 2 (scenarios + scenario_policies tables).
Stage 4 (events)       → requires Stage 2 (conversation_events table); can run in parallel with Stage 3.
Stage 5 (review)       → requires Stage 2 (conversation_reviews); can run after 3 and 4.
Stage 6                 → anytime later.
```

Recommended order: **1 → 2 → 3 → 4 → 5**, with 3 and 4 possibly in parallel after 2.

---

## Self-review: what this plan is and is not

**What I did**

- Turned the GPT prompt (architecture, data model, skills, review loop, language, policies) into **six stages** with **concrete sub-tasks**, each with a clear “what to do” and “where (file or migration)”.
- Kept **existing tables and contracts** intact: extended `conversations` only with optional columns; added new tables with FK to existing; did not rename or drop anything.
- Preserved **GPT’s intent**: language lock (Stage 1), scenario policies and decision guards (Stage 2 + 3), audit trail (Stage 4), review loop (Stage 5), and left slot validation as “already in place; reinforce if needed” (Stage 6).
- Added **constraints**: no change to ingest, AI response shape, or debounce/processBatch; one clear focus per stage so you can implement and test incrementally.
- Documented **dependencies** so you can schedule (e.g. Stage 1 first, then 2, then 3 and 4 in parallel if desired).

**What’s in scope**

- Orchestrator-only changes for language, policies, events, reviews (and DB migrations in gateway’s migration list if that’s where you run them).
- No change to wa-service or gateway MCP/approvals beyond what’s already there; no new tools.

**What’s deferred or optional**

- prompt_versions / policy_versions (Stage 6).
- Full “skills” refactor (e.g. renaming intent → “intent skill”); the plan reuses existing classifyIntent, detectLanguage, handoff, bookingContext and only adds policy checks and event writes.
- Any UI for reviews beyond a minimal API or Telegram command.
- Localization source: plan allows either in-code map or `admin_config`; you can choose when implementing Stage 1.

**How you can use this**

- **Rate the plan:** Check whether the stages and sub-tasks match your priorities and whether anything important is missing or over-specified.
- **Implement top to bottom:** Stage 1 → 2 → 3 → 4 → 5 (with 3/4 in parallel after 2 if you want).
- **Per stage:** Use the sub-task table as a checklist; for each, implement the file/migration and then verify the exit criterion before moving on.

If you tell me your rating and what you’d like to adjust (e.g. drop Stage 5 for now, or add a specific sub-task), we can refine the plan and then start with Stage 1 implementation details (e.g. exact localization API and keys).

---

## Pre-implementation clarifications (approved)

1. **Stage 1 scope:** Localize **all** customer-facing replies — AI path and legacy/non-AI path (e.g. `upcoming_appointments`, `generic_reply`).
2. **language=mixed:** Do **not** blindly fallback to `de`. Resolve effective language using: `language_preference` (client_behavior_overrides), `conversation.language_hint`, heuristics from latest message; only then default (e.g. `de`).
3. **conversation_events:** Use FK `conversation_id REFERENCES conversations(conversation_id)` with ON DELETE CASCADE where appropriate.
4. **Seed default policies:** Conservative — no mutating autonomy by default (`allow_agent_to_execute` false for booking/reschedule/cancel); explicit policy change to enable.
5. **Stage 3 tools:** Explicitly separate **mutating** vs **read-only** MCP tools; apply execute guards only to mutating tools; read-only tools always allowed when invoked.
6. **Execute permission:** Confidence threshold is **not** a standalone permission. Execute requires: **policy permission** (allow_agent_to_execute) **+** sufficient context **+** successful validation; confidence ≥ threshold is an additional safeguard, not a substitute.
