export type Decision = 'ALLOW' | 'NEED_APPROVAL' | 'NEED_HUMAN' | 'DENY';

export interface NextStep {
  type: 'APPROVE' | 'HANDOFF' | 'RETRY' | 'CLARIFY';
  approval_id?: string;
  case_id?: string;
  suggested_fix?: Record<string, unknown>;
}

export interface McpErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface McpEnvelopeResponse {
  request_id: string;
  audit_id: string;
  decision: Decision;
  result: Record<string, unknown>;
  actions: unknown[];
  policy_reason: string | null;
  error: McpErrorBody | null;
  next_steps: NextStep[];
}

export function buildEnvelope(
  requestId: string,
  auditId: string,
  decision: Decision,
  result: Record<string, unknown>,
  opts: {
    policy_reason?: string | null;
    error?: McpErrorBody | null;
    next_steps?: NextStep[];
  } = {}
): McpEnvelopeResponse {
  return {
    request_id: requestId,
    audit_id: auditId,
    decision,
    result,
    actions: [],
    policy_reason: opts.policy_reason ?? null,
    error: opts.error ?? null,
    next_steps: opts.next_steps ?? []
  };
}
