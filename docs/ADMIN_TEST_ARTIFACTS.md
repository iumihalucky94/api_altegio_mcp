# Admin: Test Cases, Mutating Tools, Smoke Matrix

## 1. Test cases by language / scenario / policy gating

| # | Language | Scenario | allow_agent_to_reply | allow_agent_to_execute | allow_agent_to_create_handoff | Expected behaviour | Priority |
|---|----------|----------|----------------------|------------------------|------------------------------|--------------------|----------|
| 1 | de | booking | true | false | true | Reply in DE; no create_appointment; can handoff | P0 |
| 2 | de | booking | true | true | true | Reply in DE; can create appointment; can handoff | P0 |
| 3 | ru | booking | true | false | true | Reply in RU; no create; can handoff | P0 |
| 4 | en | booking | true | false | true | Reply in EN; no create; can handoff | P0 |
| 5 | mixed→de | booking | true | false | true | Resolved lang DE; reply; no create | P1 |
| 6 | de | reschedule | true | false | true | Reply in DE; no reschedule tool; can handoff | P0 |
| 7 | de | cancel | true | false | true | Reply in DE; no cancel tool; can handoff | P0 |
| 8 | de | faq | true | false | true | Reply only (no mutating tools) | P0 |
| 9 | ru | complaint | true | false | true | Reply in RU; handoff allowed | P0 |
| 10 | de | unknown | true | false | true | Reply in DE; conservative | P0 |
| 11 | de | booking | false | false | true | No reply to client; handoff only; generic_ack or handoff_ack | P1 |
| 12 | de | booking | true | false | false | Reply in DE; AI wants handoff but policy blocks → reply only, no handoff case | P1 |
| 13 | de | booking | true | true | true | Confidence < threshold → handoff with reason low_confidence | P0 |
| 14 | de | booking | true | true | true | Confidence ≥ threshold → RESPOND, execute if tool in mcp_calls | P0 |
| 15 | ru | late_arrival | true | false | true | Reply in RU; scenario late_arrival | P1 |

---

## 2. Mutating MCP tools (manual review)

| Tool | Description | Risk | Requires approval (gateway) | Manual review note |
|------|-------------|------|-----------------------------|---------------------|
| crm.create_appointment | Create new appointment | HIGH | Configurable | Slot must be from get_free_slots; no confirm without success |
| crm.reschedule_appointment | Reschedule existing | HIGH | Configurable | Validate new slot |
| crm.cancel_appointment.plan | Plan cancellation | MEDIUM | Yes | Creates approval flow |
| crm.cancel_appointment.apply | Apply cancellation | HIGH | Yes | After approval |
| admin.cancel_appointment_plan | Alias for plan | MEDIUM | Yes | — |
| admin.cancel_appointment_apply | Alias for apply | HIGH | Yes | — |
| handoff.create_case | Create handoff case | LOW | No | Orchestrator creates case |
| admin.update_client | Update client data | MEDIUM | Configurable | — |
| admin.update_appointment_services | Change services on appointment | HIGH | Configurable | — |

**Source:** `orchestrator/src/services/scenarioPolicy.ts` — `MUTATING_MCP_TOOLS`. Execute guards apply only to these; read-only tools (get_free_slots, list_services, validate_slot, etc.) are not gated by allow_agent_to_execute.

---

## 3. Smoke-test matrix: Handoff / Respond / Blocked execution

### 3.1 Handoff paths

| Trigger | reason_code | Condition | Expected Telegram / event |
|---------|-------------|-----------|---------------------------|
| Low confidence | low_confidence | result.confidence < threshold | Handoff; reason_code low_confidence; confidence in payload |
| AI decision HANDOFF | ai_handoff | result.decision === 'HANDOFF' | Handoff; reply_text sent if present; summary from AI |
| AI decision NEED_APPROVAL | need_approval | result.decision === 'NEED_APPROVAL' | Handoff; reply_text sent; summary |
| Agent call failed | ai_agent_failed | !result | Handoff; no reply_text |
| Booking API failed | booking_failed | create_appointment threw | Handoff; booking_failed message to client |
| Fake confirmation | fake_confirmation_blocked | reply looks confirmed but no create success | Handoff; booking_not_confirmed_fallback to client |
| Policy: handoff disallowed | — | allow_agent_to_create_handoff false | No handoff; reply only or generic_ack |
| Legacy (no AI) | legacy_handoff | Trigger words or force_handoff | Handoff with summary |

### 3.2 Respond paths

| Condition | Expected behaviour |
|-----------|--------------------|
| RESPOND, allow_agent_to_reply true, reply_text present | Send reply_text to client |
| RESPOND, allow_agent_to_reply true, no reply_text | Send generic_ack |
| RESPOND, allow_agent_to_reply false | Send generic_ack only (no AI text); reply_blocked event |
| RESPOND, mutating tool in mcp_calls, allow_agent_to_execute true | Execute tool; tool_succeeded / tool_failed event |
| RESPOND, mutating tool, allow_agent_to_execute false | Skip tool; execution_denied_by_policy event |

### 3.3 Blocked execution

| Scenario | allow_agent_to_execute | Tool in mcp_calls | Result |
|----------|------------------------|-------------------|--------|
| booking | false | crm.create_appointment | Tool skipped; execution_denied_by_policy; no create |
| booking | true | crm.create_appointment | Tool executed (if confidence + validation OK) |
| reschedule | false | crm.reschedule_appointment | Tool skipped |
| cancel | false | crm.cancel_appointment.apply | Tool skipped |
| any | — | get_free_slots (read-only) | Always executed (no guard) |
