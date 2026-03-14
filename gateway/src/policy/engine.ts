import { DbPool } from '../audit/db';
import { isDeleteLikeAction } from './rules';

export interface ApprovalPolicy {
  actionKey: string;
  requireApproval: boolean;
  allowedRoles: string[];
}

export async function getApprovalPolicy(
  db: DbPool,
  actionKey: string
): Promise<ApprovalPolicy> {
  const res = await db.query(
    'SELECT action_key, require_approval, allowed_roles FROM approval_policies WHERE action_key = $1',
    [actionKey]
  );

  if (res.rows.length) {
    const row = res.rows[0];
    const requireApproval = actionKey.includes('cancel') ? true : row.require_approval;
    return {
      actionKey: row.action_key,
      requireApproval,
      allowedRoles: row.allowed_roles ?? ['admin']
    };
  }

  const requireApproval = isDeleteLikeAction(actionKey) || actionKey.includes('cancel');
  return {
    actionKey,
    requireApproval,
    allowedRoles: ['admin']
  };
}

export async function upsertApprovalPolicy(
  db: DbPool,
  actionKey: string,
  requireApproval: boolean,
  allowedRoles: string[] | undefined,
  updatedBy: string
) {
  await db.query(
    `INSERT INTO approval_policies (action_key, require_approval, allowed_roles, updated_by, updated_at)
     VALUES ($1, $2, COALESCE($3, ARRAY['admin']), $4, now())
     ON CONFLICT (action_key) DO UPDATE
       SET require_approval = EXCLUDED.require_approval,
           allowed_roles = EXCLUDED.allowed_roles,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [actionKey, requireApproval, allowedRoles ?? null, updatedBy]
  );
}

export async function listPolicies(db: DbPool) {
  const res = await db.query(
    'SELECT action_key, require_approval, allowed_roles, updated_at, updated_by FROM approval_policies ORDER BY action_key'
  );
  return res.rows;
}

