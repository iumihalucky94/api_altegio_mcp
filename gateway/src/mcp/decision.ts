import type { McpErrorCode } from './errors';
import type { Decision } from './envelope';

export function decisionFromResult(result: any, tool: string): { decision: Decision; next_steps: any[] } {
  const status = result?.status ?? result?.requireApproval;
  if (status === 'NEED_APPROVAL' && result?.approvalId) {
    return {
      decision: 'NEED_APPROVAL',
      next_steps: [{ type: 'APPROVE' as const, approval_id: result.approvalId }]
    };
  }
  return { decision: 'ALLOW', next_steps: [] };
}

export function decisionFromError(err: any): { decision: Decision; code: McpErrorCode } {
  const code = err?.code ?? 'INTERNAL_ERROR';
  const allowed: McpErrorCode[] = [
    'VALIDATION_ERROR', 'MULTIPLE_CLIENTS_FOUND', 'CLIENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND',
    'POLICY_DENY', 'APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'RATE_LIMIT',
    'UPSTREAM_ALTEGIO_ERROR', 'INTERNAL_ERROR'
  ];
  const normalizedCode: McpErrorCode = allowed.includes(code as McpErrorCode) ? (code as McpErrorCode) : 'INTERNAL_ERROR';
  if (normalizedCode === 'MULTIPLE_CLIENTS_FOUND') return { decision: 'NEED_HUMAN', code: normalizedCode };
  if (['POLICY_DENY', 'APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'VALIDATION_ERROR', 'CLIENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND', 'RATE_LIMIT', 'UPSTREAM_ALTEGIO_ERROR', 'INTERNAL_ERROR'].includes(normalizedCode))
    return { decision: 'DENY', code: normalizedCode };
  return { decision: 'DENY', code: 'INTERNAL_ERROR' };
}
