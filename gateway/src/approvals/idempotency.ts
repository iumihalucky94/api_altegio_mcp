import { DbPool } from '../audit/db';

export type IdempotencyStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export async function executeWithIdempotency<T>(
  db: DbPool,
  input: {
    idempotencyKey: string;
    actionKey: string;
    mcpRequestId: string;
  },
  fn: () => Promise<T>
): Promise<T> {
  const existing = await db.query(
    'SELECT id, status, response_body FROM idempotency_keys WHERE idempotency_key = $1',
    [input.idempotencyKey]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.status === 'COMPLETED') {
      return row.response_body as T;
    }
    if (row.status === 'PENDING') {
      const err = new Error('IDEMPOTENT_REQUEST_IN_PROGRESS');
      (err as any).code = 'IDEMPOTENT_REQUEST_IN_PROGRESS';
      throw err;
    }
    // FAILED: allow retry with same key
  } else {
    await db.query(
      `INSERT INTO idempotency_keys (idempotency_key, action_key, first_request_id, status)
       VALUES ($1, $2, $3::uuid, 'PENDING')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.idempotencyKey, input.actionKey, input.mcpRequestId]
    );
  }

  try {
    const result = await fn();
    await db.query(
      `UPDATE idempotency_keys
         SET status = 'COMPLETED',
             response_body = $1,
             last_seen_at = now()
       WHERE idempotency_key = $2`,
      [result as any, input.idempotencyKey]
    );
    return result;
  } catch (err) {
    await db.query(
      `UPDATE idempotency_keys
         SET status = 'FAILED',
             last_seen_at = now()
       WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    throw err;
  }
}

