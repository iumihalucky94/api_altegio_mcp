import { getConfig } from '../config';

const MCP_ENVELOPE = {
  actor: { agent_id: 'orchestrator', role: 'agent' }
};

export async function callMcp(
  tool: string,
  payload: Record<string, unknown>,
  companyId: number,
  requestId: string
): Promise<{ decision: string; result?: unknown; error?: { code: string; message: string }; next_steps?: unknown[] }> {
  const baseUrl = await getConfig<string>('MCP_GATEWAY_URL');
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
  const data = (await res.json()) as any;
  return {
    decision: data.decision ?? 'DENY',
    result: data.result,
    error: data.error,
    next_steps: data.next_steps
  };
}

export async function createHandoffViaMcp(
  conversationId: string,
  clientPhone: string,
  summary: string,
  questionToAdmin: string,
  lastMessages: Array<{ ts: string; from: string; text: string }>,
  companyId: number,
  requestId: string
) {
  return callMcp(
    'handoff.create_case',
    {
      conversation_id: conversationId,
      client_phone: clientPhone,
      language: 'mixed',
      summary,
      question_to_admin: questionToAdmin,
      last_messages: lastMessages,
      related_audit_ids: []
    },
    companyId,
    requestId
  );
}

export async function approveViaMcp(approvalId: string, adminKey: string, gatewayUrl: string) {
  const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'x-admin-approve-key': adminKey }
  });
  return res.ok;
}

export async function rejectApproval(_approvalId: string, _adminKey: string, _gatewayUrl: string) {
  return false;
}
