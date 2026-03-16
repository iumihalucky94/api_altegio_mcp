import type { DbPool } from '../db';
import { loadPolicyForScenario, type ScenarioPolicy } from './scenarioPolicy';
import type { ScenarioCode, PolicyResult, DecisionPermissions } from '../types/contracts';

// Shared default threshold used previously in agentProcessor.
const BASE_CONFIDENCE_THRESHOLD = 0.97;

export async function evaluatePolicy(
  db: DbPool,
  scenarioCode: ScenarioCode
): Promise<{ safePolicy: ScenarioPolicy; result: PolicyResult }> {
  let policy: ScenarioPolicy | null = null;
  try {
    policy = await loadPolicyForScenario(db, scenarioCode);
  } catch (_) {}

  const safePolicy: ScenarioPolicy = policy ?? {
    scenario_id: 0,
    scenario_code: scenarioCode,
    autonomy_mode: 'ASSIST_ONLY',
    allow_agent_to_reply: true,
    allow_agent_to_execute: false,
    allow_agent_to_create_handoff: true,
    requires_admin_approval: true,
    confidence_threshold: BASE_CONFIDENCE_THRESHOLD,
    max_attempts_before_handoff: null,
    config_json: null
  };

  const permissions: DecisionPermissions = {
    canReply: safePolicy.allow_agent_to_reply,
    canExecuteMutating: safePolicy.allow_agent_to_execute,
    canCreateHandoff: safePolicy.allow_agent_to_create_handoff,
    requiresAdminApproval: safePolicy.requires_admin_approval,
    confidenceThreshold: Math.max(BASE_CONFIDENCE_THRESHOLD, safePolicy.confidence_threshold)
  };

  const result: PolicyResult = {
    scenarioCode: safePolicy.scenario_code as ScenarioCode,
    policy,
    permissions
  };

  return { safePolicy, result };
}

