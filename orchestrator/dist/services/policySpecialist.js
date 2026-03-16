"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePolicy = evaluatePolicy;
const scenarioPolicy_1 = require("./scenarioPolicy");
// Shared default threshold used previously in agentProcessor.
const BASE_CONFIDENCE_THRESHOLD = 0.97;
async function evaluatePolicy(db, scenarioCode) {
    let policy = null;
    try {
        policy = await (0, scenarioPolicy_1.loadPolicyForScenario)(db, scenarioCode);
    }
    catch (_) { }
    const safePolicy = policy ?? {
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
    const permissions = {
        canReply: safePolicy.allow_agent_to_reply,
        canExecuteMutating: safePolicy.allow_agent_to_execute,
        canCreateHandoff: safePolicy.allow_agent_to_create_handoff,
        requiresAdminApproval: safePolicy.requires_admin_approval,
        confidenceThreshold: Math.max(BASE_CONFIDENCE_THRESHOLD, safePolicy.confidence_threshold)
    };
    const result = {
        scenarioCode: safePolicy.scenario_code,
        policy,
        permissions
    };
    return { safePolicy, result };
}
//# sourceMappingURL=policySpecialist.js.map