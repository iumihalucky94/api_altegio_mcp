// Shared reason/status codes used across decision flow, handoff, schedule and reviews.
// Centralizing them here avoids divergent string literals in different modules.

// High-level decision outcomes for the orchestration layer.
export type DecisionReasonCode =
  | 'ok'
  | 'booking_missing_data'
  | 'booking_exact_slot_available'
  | 'booking_alternatives_only'
  | 'booking_day_closed'
  | 'booking_no_capacity'
  | 'booking_execution_ready'
  | 'booking_execution_blocked'
  | 'low_confidence'
  | 'policy_denied_execute'
  | 'policy_denied_reply'
  | 'policy_denied_handoff'
  | 'ai_agent_failed'
  | 'booking_failed'
  | 'booking_not_confirmed'
  | 'fake_confirmation_blocked'
  | 'schedule_working_day_closed'
  | 'schedule_no_slots_on_requested_day'
  | 'schedule_slots_available'
  | 'handoff_requested_by_ai'
  | 'handoff_need_approval'
  | 'handoff_legacy'
  | 'handoff_manual'
  | 'client_force_handoff'
  | 'unknown';

// More precise schedule-related statuses (used by deterministic scheduling).
export type ScheduleStatus =
  | 'requested_date_resolved'
  | 'working_day_closed'
  | 'working_day_open'
  | 'slots_available'
  | 'no_slots_on_requested_day'
  | 'alternative_slots_found'
  | 'no_alternatives';

// Handoff reasons (aligns with HandoffContext in agentProcessor).
export type HandoffReasonCode =
  | 'ai_agent_failed'
  | 'low_confidence'
  | 'ai_handoff'
  | 'need_approval'
  | 'booking_failed'
  | 'fake_confirmation_blocked'
  | 'legacy_handoff'
  | 'manual_handoff'
  | 'policy_forced_handoff'
  | 'schedule_violation'
  | 'other';

// Handoff priority — can be extended later and used in pending_admin_actions / Telegram.
export type HandoffPriority = 'low' | 'normal' | 'high' | 'critical';

