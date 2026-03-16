"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleDecisionSkeleton = assembleDecisionSkeleton;
// Skeleton assembler: creates a minimal DecisionObject without changing behaviour.
function assembleDecisionSkeleton(input) {
    const { scenario, context, policy, fallbackLanguage, bookingResult, rescheduleResult, cancellationResult } = input;
    const actionPlan = {
        reply: {
            text: null,
            language: fallbackLanguage
        },
        execution: {
            mcpCalls: []
        },
        handoff: null
    };
    const outcome = {
        type: 'SKIP',
        reasonCode: 'unknown',
        confidence: scenario.confidence
    };
    return {
        scenario,
        context,
        policy,
        schedule: undefined,
        bookingResult,
        rescheduleResult,
        cancellationResult,
        actionPlan,
        outcome
    };
}
//# sourceMappingURL=decisionAssembler.js.map