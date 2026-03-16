import type { Intent } from '../services/intent';
import type { ConversationState, ConversationRow } from '../services/conversation';
import type { BehaviorOverride } from '../services/behaviorOverrides';
import type { ScenarioPolicy } from '../services/scenarioPolicy';
import type { ResolvedLanguage } from '../services/localization';
import type { HandoffReasonCode, HandoffPriority, DecisionReasonCode, ScheduleStatus } from './reasonCodes';

// ---------- Scenario layer ----------

// Matches codes used in the `scenarios` table and `intentToScenarioCode`.
export type ScenarioCode =
  | 'booking'
  | 'reschedule'
  | 'cancel'
  | 'faq'
  | 'complaint'
  | 'refill_policy'
  | 'pricing'
  | 'late_arrival'
  | 'unknown';

export interface ScenarioRouterResult {
  intent: Intent;
  scenarioCode: ScenarioCode;
  confidence: number;
  secondarySignals?: Record<string, unknown>;
}

export type ScenarioConfidence = number;

// ---------- Client context layer ----------

export interface UpcomingAppointmentSummary {
  count: number;
  nearestDate?: string; // ISO date or datetime string
}

export interface LastAppointmentSummary {
  date?: string | null; // ISO date
  serviceName?: string | null;
  staffName?: string | null;
}

export type BehaviorOverrideSnapshot = BehaviorOverride | null;

export interface ConversationSnapshot {
  row: ConversationRow;
  lastMessages: Array<{ ts: string; from: 'client' | 'agent' | 'admin'; text: string }>;
  upcomingSummary?: UpcomingAppointmentSummary;
  lastAppointment?: LastAppointmentSummary;
}

export interface ClientContext {
  phoneE164: string;
  conversation: ConversationSnapshot;
  behaviorOverride: BehaviorOverrideSnapshot;
  language: {
    detected: ResolvedLanguage;
    hint: string | null;
  };
  kbContextSummary?: string; // collapsed KB text (already built)
}

// ---------- Schedule layer ----------

export interface DateResolution {
  requestedText: string;
  resolvedDate?: string; // YYYY-MM-DD
  timezone: string;
}

export interface TimePreference {
  // Future extension: morning / evening / exact time.
  rawText?: string;
}

export interface ScheduleInterpretationResult {
  status: ScheduleStatus;
  requestedDate: string;
  timezone: string;
  freeSlotsOnRequestedDay: string[]; // ISO datetimes
  alternativeSlots: string[]; // ISO datetimes on later days
  alternativeDays: string[]; // YYYY-MM-DD with free slots
}

export interface AmbiguityFlags {
  dateAmbiguous?: boolean;
  timeAmbiguous?: boolean;
}

// ---------- Booking / reschedule / cancellation layer ----------

export type SpecialistStatus = 'ok' | 'needs_handoff' | 'needs_approval' | 'failed' | 'skipped';

export type BookingDomainStatus =
  | 'missing_data'
  | 'exact_slot_available'
  | 'alternatives_only'
  | 'day_closed'
  | 'no_capacity'
  | 'needs_handoff'
  | 'execution_ready'
  | 'execution_blocked';

export interface BookingSpecialistResult {
  status: SpecialistStatus;
  domainStatus: BookingDomainStatus;
  reasonCode: DecisionReasonCode;
  createdAppointmentId?: string;
  suggestedAlternatives?: string[]; // ISO datetimes
}

export type RescheduleDomainStatus =
  | 'missing_current_appointment'
  | 'missing_new_time'
  | 'exact_slot_available'
  | 'alternatives_only'
  | 'day_closed'
  | 'no_capacity'
  | 'restricted_by_policy'
  | 'needs_handoff'
  | 'execution_ready'
  | 'execution_blocked';

export interface RescheduleSpecialistResult {
  status: SpecialistStatus;
  domainStatus: RescheduleDomainStatus;
  reasonCode: DecisionReasonCode;
  rescheduledAppointmentId?: string;
}

export interface CancellationSpecialistResult {
  status: SpecialistStatus;
  domainStatus: CancellationDomainStatus;
  reasonCode: DecisionReasonCode;
  approvalId?: string; // gateway approvals.id if applicable
}

export type CancellationDomainStatus =
  | 'missing_current_appointment'
  | 'approval_required'
  | 'reschedule_first'
  | 'safe_to_cancel'
  | 'restricted_by_policy'
  | 'needs_handoff'
  | 'execution_ready'
  | 'execution_blocked';

// ---------- Policy layer ----------

export interface DecisionPermissions {
  canReply: boolean;
  canExecuteMutating: boolean;
  canCreateHandoff: boolean;
  requiresAdminApproval: boolean;
  confidenceThreshold: number;
}

export interface PolicyResult {
  scenarioCode: ScenarioCode;
  policy: ScenarioPolicy | null;
  permissions: DecisionPermissions;
}

export type ApprovalRequirement = 'none' | 'required' | 'already_pending';

export interface HandoffPermission {
  allowed: boolean;
  reason?: string;
}

// ---------- Handoff layer ----------

export interface HandoffPreparationResult {
  shouldHandoff: boolean;
  reasonCode: HandoffReasonCode;
  priority: HandoffPriority;
  summary: string;
  questionToAdmin: string;
  tags?: string[];
}

// ---------- Decision layer ----------

export interface ReplyPlan {
  text: string | null;
  language: ResolvedLanguage;
}

export interface ExecutionPlan {
  mcpCalls: Array<{
    tool: string;
    payload: Record<string, unknown>;
    mutating: boolean;
    status?: 'planned' | 'executed' | 'skipped' | 'failed';
    note?: string;
  }>;
}

export interface ActionPlan {
  reply: ReplyPlan;
  execution: ExecutionPlan;
  handoff?: HandoffPreparationResult | null;
}

export type DecisionOutcomeType = 'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL' | 'SKIP';

export interface DecisionOutcome {
  type: DecisionOutcomeType;
  reasonCode: DecisionReasonCode;
  confidence: number;
}

// ---------- Diagnostics / enrichment metadata ----------

export interface WriterMetadata {
  usedFallback: boolean;
}

export interface ReplyQaIssueSummary {
  code: string;
}

export interface ReplyQaMetadata {
  fallbackUsed: boolean;
  issues: ReplyQaIssueSummary[];
}

export interface DecisionObject {
  scenario: ScenarioRouterResult;
  context: ClientContext;
  policy: PolicyResult;
  schedule?: ScheduleInterpretationResult;
  bookingResult?: BookingSpecialistResult;
  rescheduleResult?: RescheduleSpecialistResult;
  cancellationResult?: CancellationSpecialistResult;
  actionPlan: ActionPlan;
  outcome: DecisionOutcome;
  writer?: WriterMetadata;
  replyQa?: ReplyQaMetadata;
}

