import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import { getApprovalPolicy } from '../../../policy/engine';
import { createApproval, getApproval, linkApprovalToApply } from '../../../approvals/service';
import { executeWithIdempotency } from '../../../approvals/idempotency';

const baseSchema = z.object({
  appointment_id: z.number(),
  reason: z.string().optional(),
  notify_client: z.boolean().default(true)
});

export async function handleCancelAppointmentPlan(ctx: ToolDispatchContext) {
  const params = validateOrThrow(baseSchema, ctx.params);
  const db = ctx.db;
  const actionKey = 'crm.cancel_appointment';

  const policy = await getApprovalPolicy(db, actionKey);

  let approvalId: string | undefined;
  if (policy.requireApproval) {
    const approval = await createApproval(db, {
      actionKey,
      planTool: 'crm.cancel_appointment.plan',
      applyTool: 'crm.cancel_appointment.apply',
      planRequestId: ctx.mcpRequestId,
      details: { params }
    });
    approvalId = approval.id;
  }

  return {
    action: actionKey,
    mode: 'plan',
    status: policy.requireApproval ? 'NEED_APPROVAL' : 'OK',
    requireApproval: policy.requireApproval,
    approvalId,
    approval_id: approvalId,
    impact_summary: `Cancel appointment ${params.appointment_id}. Reason: ${params.reason ?? 'not specified'}.`,
    client_message_suggestion: 'Your appointment has been requested for cancellation. We will confirm shortly.',
    params
  };
}

export async function handleCancelAppointmentApply(ctx: ToolDispatchContext) {
  const params = validateOrThrow(baseSchema, ctx.params);
  const db = ctx.db;
  const actionKey = 'crm.cancel_appointment';

  if (!ctx.idempotencyKey) {
    const err = new Error('idempotency_key required');
    (err as any).code = 'VALIDATION_ERROR';
    throw err;
  }

  const policy = await getApprovalPolicy(db, actionKey);
  let approvalId = ctx.approvalId;

  if (policy.requireApproval) {
    if (!approvalId) {
      const err = new Error('Approval required for this action');
      (err as any).code = 'APPROVAL_REQUIRED';
      throw err;
    }

    const approval = await getApproval(db, approvalId);
    if (!approval || approval.status !== 'APPROVED' || approval.action_key !== actionKey) {
      const err = new Error('Approval not found or invalid');
      (err as any).code = 'APPROVAL_INVALID';
      throw err;
    }
  }

  const altegio = createAltegioClient(ctx.db, ctx.config);

  const result = await executeWithIdempotency(
    db,
    {
      idempotencyKey: ctx.idempotencyKey,
      actionKey,
      mcpRequestId: ctx.mcpRequestId
    },
    () => altegio.cancelAppointment(ctx.mcpRequestId, params)
  );

  if (policy.requireApproval && approvalId) {
    await linkApprovalToApply(db, approvalId, ctx.mcpRequestId);
  }

  return {
    action: actionKey,
    mode: 'apply',
    result,
    appointment_status: (result as any)?.status ?? 'cancelled',
    summary_for_client: 'Your appointment has been cancelled.'
  };
}

