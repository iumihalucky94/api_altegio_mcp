import type { DbPool } from '../db';
import type { Intent } from './intent';
/** MCP tools that mutate state; execute guards apply only to these. */
export declare const MUTATING_MCP_TOOLS: Set<string>;
export declare function isMutatingTool(tool: string): boolean;
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
export declare function intentToScenarioCode(intent: Intent): string;
export declare function loadPolicyForScenario(db: DbPool, scenarioCode: string): Promise<ScenarioPolicy | null>;
//# sourceMappingURL=scenarioPolicy.d.ts.map