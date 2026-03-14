1. ROLE OF MCP

This MCP is a secure business gateway between:
AI Administrator Agent (WhatsApp-facing)
Altegio CRM

MCP is NOT a thinking system.
MCP is a deterministic execution and policy enforcement layer.

It must:
Be deny-by-default.
Expose only allowlisted business tools.
Log everything (full audit trail).
Support approval workflow.
Support manual handoff mode.
Be fully configurable via ENV + admin_config (DB overrides).


2. GLOBAL MCP CONTRACT
2.1 Request Envelope (REQUIRED)
{
  "request_id": "uuid",
  "actor": {
    "agent_id": "string",
    "role": "string"
  },
  "company_id": 123,
  "tool": "string",
  "intent": "string",
  "dry_run": true,
  "payload": {},
  "conversation_id": "string (optional)",
  "client_phone": "string (optional)",
  "locale": "ru|de|en (optional)"
}

2.2 Response Envelope (ALWAYS RETURNED)
{
  "request_id": "uuid",
  "audit_id": "uuid",
  "decision": "ALLOW | NEED_APPROVAL | NEED_HUMAN | DENY",
  "result": {},
  "actions": [],
  "policy_reason": "string|null",
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  } | null,
  "next_steps": []
}

3. DECISION SEMANTICS

Agent MUST follow these strictly:

ALLOW

Operation is valid.
If dry_run=true → simulate.
If dry_run=false → executed.

NEED_APPROVAL

Operation requires admin approval.
MCP must return:
next_steps = [
  { "type": "APPROVE", "approval_id": "uuid" }
]
Agent must:
    Stop
    Request approval
    Then call corresponding apply tool

NEED_HUMAN
    Manual mode required.
    Agent MUST:
        Stop
        Call handoff.create_case
        Not guess or retry blindly

DENY

    Forbidden by policy.
    Agent must stop.
    No workaround allowed.

4. ERROR TAXONOMY (FIXED)
Allowed error codes:
    VALIDATION_ERROR
    MULTIPLE_CLIENTS_FOUND
    CLIENT_NOT_FOUND
    APPOINTMENT_NOT_FOUND
    POLICY_DENY
    APPROVAL_REQUIRED
    APPROVAL_INVALID
    RATE_LIMIT
    UPSTREAM_ALTEGIO_ERROR
    INTERNAL_ERROR

No other arbitrary error codes allowed.

Allowed error codes:
    VALIDATION_ERROR
    MULTIPLE_CLIENTS_FOUND
    CLIENT_NOT_FOUND
    APPOINTMENT_NOT_FOUND
    POLICY_DENY
    APPROVAL_REQUIRED
    APPROVAL_INVALID
    RATE_LIMIT
    UPSTREAM_ALTEGIO_ERROR
    INTERNAL_ERROR

No other arbitrary error codes allowed.


6. SYSTEM TOOLS
6.1 system.get_capabilities

Purpose: Self-describing MCP.

Payload: {}

Result: {
  "schema_version": "v1",
  "tools": [
    {
      "name": "admin.book_appointment",
      "risk_level": "SAFE|MODERATE|HIGH",
      "requires_approval": false,
      "input_schema_id": "AdminBookAppointmentInput",
      "output_schema_id": "AdminBookAppointmentOutput"
    }
  ],
  "config_snapshot": {
    "slots_default_limit": 3,
    "preferred_master_threshold": 0.8,
    "cancel_policy_mode": "always_approval"
  }
}

6.2 system.explain_error

Payload:{
  "audit_id": "uuid"
}

Result:{
  "explanation": "string",
  "suggested_fix": {},
  "next_steps": []
}

7. AUDIT TOOLS
7.1 audit.get_request

Payload:{ "audit_id": "uuid" }

Returns:
    request
    response
    altegio_calls[]

All redacted.

7.2 audit.search

Payload:{
  "filters": {
    "phone": "string?",
    "tool": "string?",
    "decision": "string?",
    "date_from": "YYYY-MM-DD?",
    "date_to": "YYYY-MM-DD?"
  },
  "limit": 50
}

8. CONVERSATION STORAGE
8.1 conversation.append_messages

Purpose:
Persist WhatsApp history in MCP DB.

Payload:{
  "conversation_id": "string",
  "client_phone": "string",
  "messages": [
    {
      "ts": "ISO-8601",
      "direction": "in|out",
      "author": "client|agent|admin",
      "text": "string",
      "locale": "ru|de|en|mixed?",
      "metadata": {}
    }
  ]
}

Rules:
    Deduplicate by message id if provided.
    Otherwise dedupe by (timestamp + direction + hash(text)).
    Enforce body size limit.

9. HANDOFF (MANUAL MODE)
9.1 handoff.create_case

Payload:{
  "conversation_id": "string",
  "client_phone": "string",
  "client_name": "string|null",
  "language": "ru|de|en|mixed",
  "last_messages": [
    { "ts": "ISO-8601", "from": "client|agent", "text": "string" }
  ],
  "summary": "string",
  "question_to_admin": "string",
  "related_audit_ids": ["uuid"]
}

Returns:{
  "case_id": "uuid",
  "admin_view": "string",
  "client_message_suggestion": "string"
}

10. ADMIN CRM TOOLS
10.1 admin.find_or_create_client_by_phone

Payload:{
  "phone": "string",
  "create_if_missing": true,
  "new_client": {
    "first_name": "string",
    "last_name": "string",
    "email": "string|null",
    "birth_date": "YYYY-MM-DD|null",
    "language": "ru|de|en|null",
    "note": "string|null"
  }
}

Rules:

2+ clients → NEED_HUMAN (MULTIPLE_CLIENTS_FOUND)
If client missing and insufficient data → return missing_fields[]
Email and birth_date optional.

10.2 admin.get_client_context

Payload:{
  "phone": "string"
}

Returns:
    last 10 visits
    preferred_master (if >= 80%)
    upcoming_appointments
    flags

10.3 admin.get_upcoming_appointments_by_phone

Payload:{
  "phone": "string",
  "from_date": "YYYY-MM-DD?",
  "limit": 5
}
Returns:
    appointments[]
Agent must clarify if multiple exist.

10.4 admin.find_slots

Payload:{
  "service_ids": ["string"],
  "preferred_master_id": "string|null",
  "time_preferences": [
    {
      "mode": "after_time|before_time|morning|evening|specific_date|weekday|any",
      "date": "YYYY-MM-DD|null",
      "weekday": "Mon|Tue|Wed|Thu|Fri|Sat|Sun|null",
      "time": "HH:MM|null"
    }
  ],
  "limit": 3
}

Returns:
    3 best slots
    explanation

10.5 admin.book_appointment

Payload:{
  "client_id": "string",
  "service_ids": ["string"],
  "master_id": "string",
  "datetime": "ISO-8601",
  "note": "string|null"
}
Returns:
    appointment_id
    summary_for_client


10.6 admin.reschedule_appointment

Payload:

{
  "appointment_id": "string",
  "new_datetime": "ISO-8601",
  "new_master_id": "string|null"
}

No approval required.

10.7 admin.update_appointment_services

Payload:

{
  "appointment_id": "string",
  "service_ids": ["string"]
}

Allowed:

Add/remove services.
Not allowed:

Override prices.

Modify payments.

Apply discounts.


11. CANCEL FLOW (STAGE 1 POLICY)

Cancellation ALWAYS requires approval.

11.1 admin.cancel_appointment_plan

Payload:

{
  "appointment_id": "string",
  "reason": "string",
  "requested_by": "client|agent"
}

Decision:
NEED_APPROVAL

Returns:

approval_id

impact_summary

client_message_suggestion

11.2 admin.cancel_appointment_apply

Payload:

{
  "approval_id": "uuid",
  "idempotency_key": "string"
}

Returns:

appointment_status

summary_for_client

12. FORBIDDEN OPERATIONS

The following MUST NOT be implemented as tools:

Modify price

Modify discount

Modify payment status

Financial mutations

Hard delete records

If requested → DENY

END OF SPECIFICATION