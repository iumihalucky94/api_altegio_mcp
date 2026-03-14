import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import { getApprovalPolicy } from '../../../policy/engine';
import { createApproval, getApproval, linkApprovalToApply } from '../../../approvals/service';
import { executeWithIdempotency } from '../../../approvals/idempotency';

const baseSchema = z.object({
  payroll_run_id: z.number(),
  staff_ids: z.array(z.number()).optional(),
  period_from: z.string(),
  period_to: z.string()
});

export async function handlePlanApplySalaryResult(ctx: ToolDispatchContext) {
  const params = validateOrThrow(baseSchema, ctx.params);
  const db = ctx.db;
  const actionKey = 'payroll.apply_salary_result';

  const policy = await getApprovalPolicy(db, actionKey);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  // Use staff calculations as a read-only basis for the plan/diff
  const preview = await altegio.getStaffCalculations(ctx.mcpRequestId, {
    date_from: params.period_from,
    date_to: params.period_to,
    staff_id: params.staff_ids && params.staff_ids.length === 1 ? params.staff_ids[0] : undefined,
    page: 1,
    per_page: 500
  });

  let approvalId: string | undefined;
  if (policy.requireApproval) {
    const approval = await createApproval(db, {
      actionKey,
      planTool: 'payroll.plan_apply_salary_result',
      applyTool: 'payroll.apply_salary_result',
      planRequestId: ctx.mcpRequestId,
      details: { params, preview }
    });
    approvalId = approval.id;
  }

  return {
    action: actionKey,
    mode: 'plan',
    status: policy.requireApproval ? 'NEED_APPROVAL' : 'OK',
    requireApproval: policy.requireApproval,
    approvalId,
    params,
    preview
  };
}

export async function handleApplySalaryResult(ctx: ToolDispatchContext) {
  const params = validateOrThrow(baseSchema, ctx.params);
  const db = ctx.db;
  const actionKey = 'payroll.apply_salary_result';

  if (!ctx.idempotencyKey) {
    const err = new Error('IDEMPOTENCY_KEY_REQUIRED');
    (err as any).code = 'IDEMPOTENCY_KEY_REQUIRED';
    throw err;
  }

  const policy = await getApprovalPolicy(db, actionKey);
  let approvalId = ctx.approvalId;

  if (policy.requireApproval) {
    if (!approvalId) {
       const err = new Error('APPROVAL_REQUIRED');
       (err as any).code = 'APPROVAL_REQUIRED';
       throw err;
    }

    const approval = await getApproval(db, approvalId);
    if (!approval || approval.status !== 'APPROVED' || approval.action_key !== actionKey) {
      const err = new Error('APPROVAL_NOT_VALID');
      (err as any).code = 'APPROVAL_NOT_VALID';
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
    () => altegio.applySalaryResult(ctx.mcpRequestId, params)
  );

  if (policy.requireApproval && approvalId) {
    await linkApprovalToApply(db, approvalId, ctx.mcpRequestId);
  }

  return {
    action: actionKey,
    mode: 'apply',
    result
  };
}

