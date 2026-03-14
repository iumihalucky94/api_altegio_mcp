import { DbPool } from '../audit/db';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRecord {
  id: string;
  action_key: string;
  status: ApprovalStatus;
  plan_tool: string | null;
  apply_tool: string | null;
}

export async function createApproval(
  db: DbPool,
  input: {
    actionKey: string;
    planTool: string;
    applyTool: string;
    planRequestId: string;
    details?: any;
  }
): Promise<ApprovalRecord> {
  const res = await db.query(
    `INSERT INTO approvals (action_key, status, plan_tool, apply_tool, plan_request_id, details)
     VALUES ($1, 'PENDING', $2, $3, $4::uuid, $5)
     RETURNING id::text, action_key, status, plan_tool, apply_tool`,
    [input.actionKey, input.planTool, input.applyTool, input.planRequestId, input.details ?? null]
  );
  return res.rows[0];
}

export async function markApprovalStatus(
  db: DbPool,
  id: string,
  status: ApprovalStatus,
  actor: string
) {
  const nowColumn = status === 'APPROVED' ? 'approved_at' : status === 'REJECTED' ? 'rejected_at' : 'updated_at';

  await db.query(
    `UPDATE approvals
       SET status = $1,
           ${nowColumn} = now(),
           updated_at = now(),
           approved_by = CASE WHEN $1 = 'APPROVED' THEN $2 ELSE approved_by END,
           rejected_by = CASE WHEN $1 = 'REJECTED' THEN $2 ELSE rejected_by END
     WHERE id = $3::uuid`,
    [status, actor, id]
  );
}

export async function getApproval(db: DbPool, id: string): Promise<any | null> {
  const res = await db.query('SELECT * FROM approvals WHERE id = $1::uuid', [id]);
  return res.rows[0] ?? null;
}

export async function linkApprovalToApply(
  db: DbPool,
  approvalId: string,
  applyRequestId: string
) {
  await db.query(
    `UPDATE approvals
       SET apply_request_id = $1::uuid,
           updated_at = now()
     WHERE id = $2::uuid`,
    [applyRequestId, approvalId]
  );
}

