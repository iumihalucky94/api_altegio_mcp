# Booking logic — SISI Beauty Bar AI Agent

## Containers

- **gateway**: MCP server, Altegio B2B client (env: `ALTEGIO_*`), tools: `crm.*`, `admin.*`, `handoff.*`. Orchestrator calls gateway via `POST /mcp`.
- **wa-service**: WhatsApp Web only. Forwards incoming messages to orchestrator ingest; exposes `POST /whatsapp/send` for orchestrator replies. Isolated from gateway so MCP/Altegio load cannot affect WhatsApp.

---

## Flow (high level)

1. User sends a message (date, optional time, optional master, service).
2. Orchestrator fetches: services, staff, and **free slots** (for today and tomorrow, first staff + first service) via `crm.get_free_slots`.
3. Context passed to the AI includes **FREE_SLOTS** (ISO start times). The AI may **only** suggest or confirm times from this list.
4. If the user confirms a time, the AI returns `mcp_calls` with `crm.create_appointment` and `datetime` **exactly** one of the FREE_SLOTS.
5. Gateway **validates** the slot (working hours + no overlap) before calling Altegio. If validation fails or Altegio returns 409, the gateway throws; orchestrator does **not** send a “confirmed” message and **escalates** to the admin.

---

## Validation rules (strict)

- **Suggested/confirmed time** must be in the list returned by `crm.get_free_slots` (i.e. inside master working window, free, and fitting service duration).
- **Before create:** Gateway checks:
  - `requested_start` is inside a working slot from `crm.get_master_working_hours` (schedule API),
  - `requested_start + duration` ≤ end of that working slot,
  - No overlap with existing appointments (from `crm.list_appointments`).
- If any check fails → do **not** create; return clear error (e.g. `SLOT_VALIDATION_FAILED`, `REQUESTED_TIME_OUTSIDE_MASTER_SCHEDULE`, or `ALTEGIO_CONFLICT`).
- Timezone for all times: **Europe/Vienna**.

---

## MCP tools (gateway)

| Tool | Purpose |
|------|--------|
| `crm.get_service_duration` | `company_id`, `service_id` → duration in seconds/minutes. |
| `crm.get_master_working_hours` | `company_id`, `staff_id`, `date` (YYYY-MM-DD) → `[{start, end}]` (ISO). |
| `crm.get_free_slots` | `company_id`, `staff_id`, `service_id`, `date` → `free_slots: string[]` (ISO start times). |
| `crm.validate_slot` | `company_id`, `staff_id`, `service_id`, `date`, `start_time` (ISO) → ok or throw. |
| `crm.create_appointment` | Validates slot then creates; on 409 or validation failure throws (orchestrator escalates). |

---

## Behaviour by scenario

| Scenario | Expected behaviour |
|----------|--------------------|
| User asks for time outside working hours (e.g. 18:00, master works until 17:00) | Do **not** offer 18:00. Explain working hours, suggest only times from FREE_SLOTS or another day; if user insists → “I’ll check with the master” and HANDOFF. |
| Requested time at edge of shift (e.g. 16:30, duration 90 min, shift ends 17:00) | Invalid (16:30+90 > 17:00). Suggest earlier slot or another day. |
| Requested time in hours but slot occupied | Suggest other free slots from FREE_SLOTS. |
| No free slots that day | Explain master’s hours and “no free places”; suggest other days or alternatives. |
| `create_appointment` fails (validation or Altegio 409) | Orchestrator does **not** say “confirmed”. Sends neutral “technical issue, forwarded to team” and creates handoff. |
| User insists on forbidden time (e.g. “only 18:00”) | Reply that you need to check with the master, forward to admin, HANDOFF. |

---

## Examples

- **FREE_SLOTS in context:** `["2026-03-18T10:00:00+01:00", "2026-03-18T11:00:00+01:00"]`  
  → AI may only suggest/confirm 10:00 or 11:00 on that day for that master/service.

- **No FREE_SLOTS:** Do not confirm a specific time; ask for preferences and say you will check availability, or escalate.

- **Create failed:** User gets: “Leider ist bei der Buchung etwas schiefgelaufen. Ich habe Ihre Anfrage an unser Team weitergeleitet – wir melden uns in Kürze bei Ihnen.” and the conversation is handed off.
