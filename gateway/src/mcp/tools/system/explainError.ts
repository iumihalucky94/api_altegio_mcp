import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
const schema = z.object({ audit_id: z.string().uuid() });

const EXPLANATIONS: Record<string, { explanation: string; suggested_fix: Record<string, unknown>; next_steps: unknown[] }> = {
  VALIDATION_ERROR: { explanation: 'Request payload failed schema validation.', suggested_fix: { fix: 'Correct payload fields and retry' }, next_steps: [{ type: 'RETRY' }] },
  MULTIPLE_CLIENTS_FOUND: { explanation: 'More than one client matches the phone number.', suggested_fix: { fix: 'Use handoff.create_case for human to resolve' }, next_steps: [{ type: 'HANDOFF' }] },
  CLIENT_NOT_FOUND: { explanation: 'No client found for the given identifier.', suggested_fix: { fix: 'Verify phone or create client first' }, next_steps: [] },
  APPOINTMENT_NOT_FOUND: { explanation: 'Appointment not found or already cancelled.', suggested_fix: { fix: 'Verify appointment_id' }, next_steps: [] },
  POLICY_DENY: { explanation: 'Operation forbidden by policy.', suggested_fix: {}, next_steps: [] },
  APPROVAL_REQUIRED: { explanation: 'This operation requires admin approval.', suggested_fix: { fix: 'Request approval then call apply tool' }, next_steps: [{ type: 'APPROVE' }] },
  APPROVAL_INVALID: { explanation: 'Approval missing or invalid.', suggested_fix: { fix: 'Obtain valid approval_id from plan step' }, next_steps: [] },
  RATE_LIMIT: { explanation: 'Too many requests; rate limited.', suggested_fix: { fix: 'Retry after delay' }, next_steps: [{ type: 'RETRY' }] },
  UPSTREAM_ALTEGIO_ERROR: { explanation: 'Altegio API returned an error.', suggested_fix: { fix: 'Check Altegio status; retry or handoff' }, next_steps: [] },
  INTERNAL_ERROR: { explanation: 'Internal server error.', suggested_fix: { fix: 'Retry or handoff' }, next_steps: [] }
};

export async function handleExplainError(ctx: ToolDispatchContext) {
  const { audit_id } = validateOrThrow(schema, ctx.params);
  const res = await ctx.db.query(
    'SELECT error_message, response_body FROM mcp_requests WHERE id = $1::uuid',
    [audit_id]
  );
  if (res.rows.length === 0) {
    throw Object.assign(new Error('Audit record not found'), { code: 'INTERNAL_ERROR' });
  }
  const row = res.rows[0];
  const errMsg = row.error_message || '';
  const responseBody = row.response_body as any;
  let code = 'INTERNAL_ERROR';
  if (responseBody?.error?.code) code = responseBody.error.code;
  else if (errMsg.includes('VALIDATION')) code = 'VALIDATION_ERROR';
  else if (errMsg.includes('MULTIPLE_CLIENTS')) code = 'MULTIPLE_CLIENTS_FOUND';
  const entry = EXPLANATIONS[code] || EXPLANATIONS.INTERNAL_ERROR;
  return {
    explanation: entry.explanation,
    suggested_fix: entry.suggested_fix,
    next_steps: entry.next_steps
  };
}
