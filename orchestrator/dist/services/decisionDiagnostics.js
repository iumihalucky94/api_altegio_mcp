"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistDecisionSnapshot = persistDecisionSnapshot;
const conversationEvents_1 = require("./conversationEvents");
async function persistDecisionSnapshot(db, conversationId, decision, options = {}) {
    const maxTextLength = options.maxTextLength ?? 500;
    const replyText = decision.actionPlan.reply.text || '';
    const trimmedReply = replyText.length > maxTextLength ? replyText.slice(0, maxTextLength) : replyText;
    const payload = {
        scenario: {
            intent: decision.scenario.intent,
            code: decision.scenario.scenarioCode,
            confidence: decision.scenario.confidence
        },
        policy: {
            scenarioCode: decision.policy.scenarioCode,
            permissions: decision.policy.permissions
        },
        specialists: {
            booking: decision.bookingResult
                ? {
                    status: decision.bookingResult.status,
                    domainStatus: decision.bookingResult.domainStatus,
                    reasonCode: decision.bookingResult.reasonCode
                }
                : null,
            reschedule: decision.rescheduleResult
                ? {
                    status: decision.rescheduleResult.status,
                    domainStatus: decision.rescheduleResult.domainStatus,
                    reasonCode: decision.rescheduleResult.reasonCode
                }
                : null,
            cancellation: decision.cancellationResult
                ? {
                    status: decision.cancellationResult.status,
                    domainStatus: decision.cancellationResult.domainStatus,
                    reasonCode: decision.cancellationResult.reasonCode
                }
                : null
        },
        handoff: decision.actionPlan.handoff
            ? {
                reasonCode: decision.actionPlan.handoff.reasonCode,
                priority: decision.actionPlan.handoff.priority,
                summary: decision.actionPlan.handoff.summary.slice(0, maxTextLength)
            }
            : null,
        reply: {
            text: trimmedReply,
            language: decision.actionPlan.reply.language
        },
        execution: {
            mcpCalls: (decision.actionPlan.execution.mcpCalls || []).map((c) => ({
                tool: c.tool,
                mutating: c.mutating,
                status: c.status,
                note: c.note
            }))
        },
        outcome: decision.outcome,
        writer: decision.writer ?? null,
        replyQa: decision.replyQa ?? null
    };
    try {
        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'decision_object_enriched', payload);
    }
    catch {
        // Best-effort only: diagnostics must not affect runtime flow.
    }
}
//# sourceMappingURL=decisionDiagnostics.js.map