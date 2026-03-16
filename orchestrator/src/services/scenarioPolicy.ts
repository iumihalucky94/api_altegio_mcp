import type { DbPool } from '../db';
import type { Intent } from './intent';

/** MCP tools that mutate state; execute guards apply only to these. */
export const MUTATING_MCP_TOOLS = new Set<string>([
  'crm.create_appointment',
  'crm.reschedule_appointment',
  'crm.cancel_appointment.plan',
  'crm.cancel_appointment.apply',
  'admin.cancel_appointment_plan',
  'admin.cancel_appointment_apply',
  'handoff.create_case',
  'admin.update_client',
  'admin.update_appointment_services'
]);

export function isMutatingTool(tool: string): boolean {
  return MUTATING_MCP_TOOLS.has(tool);
}

export interface ScenarioPolicy {
  scenario_id: number;
  scenario_code: string;
  autonomy_mode: string;
  allow_agent_to_reply: boolean;
  allow_agent_to_execute: boolean;
  allow_agent_to_create_handoff: boolean;
  requires_admin_approval: boolean;
  confidence_threshold: number;
  max_attempts_before_handoff: number | null;
  config_json: Record<string, unknown> | null;
}

const INTENT_TO_SCENARIO: Record<Intent, string> = {
  BOOKING: 'booking',
  RESCHEDULE: 'reschedule',
  CANCEL_REQUEST: 'cancel',
  LATE_NOTICE: 'late_arrival',
  POLICY_QUESTION: 'refill_policy',
  COMPLAINT_OR_EMOTIONAL: 'complaint',
  SERVICE_NOT_PROVIDED: 'faq',
  UNKNOWN: 'unknown'
};

export function intentToScenarioCode(intent: Intent): string {
  return INTENT_TO_SCENARIO[intent] ?? 'unknown';
}

export async function loadPolicyForScenario(
  db: DbPool,
  scenarioCode: string
): Promise<ScenarioPolicy | null> {
  const res = await db.query(
    `SELECT sp.id AS scenario_id, s.code AS scenario_code, sp.autonomy_mode, sp.allow_agent_to_reply,
            sp.allow_agent_to_execute, sp.allow_agent_to_create_handoff, sp.requires_admin_approval,
            sp.confidence_threshold, sp.max_attempts_before_handoff, sp.config_json
     FROM scenario_policies sp
     JOIN scenarios s ON s.id = sp.scenario_id
     WHERE s.code = $1 AND s.is_active = true`,
    [scenarioCode]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    scenario_id: row.scenario_id,
    scenario_code: row.scenario_code,
    autonomy_mode: row.autonomy_mode ?? 'ASSIST_ONLY',
    allow_agent_to_reply: row.allow_agent_to_reply ?? true,
    allow_agent_to_execute: row.allow_agent_to_execute ?? false,
    allow_agent_to_create_handoff: row.allow_agent_to_create_handoff ?? true,
    requires_admin_approval: row.requires_admin_approval ?? true,
    confidence_threshold: Number(row.confidence_threshold) || 0.97,
    max_attempts_before_handoff: row.max_attempts_before_handoff != null ? Number(row.max_attempts_before_handoff) : null,
    config_json: row.config_json ?? null
  };
}
