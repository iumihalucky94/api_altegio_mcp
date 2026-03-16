"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callMcp = callMcp;
exports.createHandoffViaMcp = createHandoffViaMcp;
exports.approveViaMcp = approveViaMcp;
exports.rejectApproval = rejectApproval;
const config_1 = require("../config");
const MCP_ENVELOPE = {
    actor: { agent_id: 'orchestrator', role: 'agent' }
};
async function callMcp(tool, payload, companyId, requestId) {
    const baseUrl = await (0, config_1.getConfig)('MCP_GATEWAY_URL');
    if (!baseUrl) {
        throw new Error('MCP_GATEWAY_URL not configured');
    }
    const body = {
        request_id: requestId,
        ...MCP_ENVELOPE,
        company_id: companyId,
        tool,
        payload
    };
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = (await res.json());
    return {
        decision: data.decision ?? 'DENY',
        result: data.result,
        error: data.error,
        next_steps: data.next_steps
    };
}
async function createHandoffViaMcp(conversationId, clientPhone, summary, questionToAdmin, lastMessages, companyId, requestId) {
    return callMcp('handoff.create_case', {
        conversation_id: conversationId,
        client_phone: clientPhone,
        language: 'mixed',
        summary,
        question_to_admin: questionToAdmin,
        last_messages: lastMessages,
        related_audit_ids: []
    }, companyId, requestId);
}
async function approveViaMcp(approvalId, adminKey, gatewayUrl) {
    const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/approvals/${approvalId}/approve`, {
        method: 'POST',
        headers: { 'x-admin-approve-key': adminKey }
    });
    return res.ok;
}
async function rejectApproval(_approvalId, _adminKey, _gatewayUrl) {
    return false;
}
//# sourceMappingURL=mcpClient.js.map