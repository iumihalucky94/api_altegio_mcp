import { DbPool } from './db';

export async function createMcpRequest(
  db: DbPool,
  toolName: string,
  requestBody: unknown,
  idempotencyKey?: string,
  envelope?: { request_id?: string; company_id?: number; actor?: any }
): Promise<{ id: string; createdAt: string }> {
  const res = await db.query(
    `INSERT INTO mcp_requests (tool_name, request_body, idempotency_key, status, request_id, company_id, actor_json)
     VALUES ($1, $2, $3, 'PENDING', $4, $5, $6)
     RETURNING id::text, created_at::text`,
    [
      toolName,
      requestBody,
      idempotencyKey ?? null,
      envelope?.request_id ?? null,
      envelope?.company_id ?? null,
      envelope?.actor ? JSON.stringify(envelope.actor) : null
    ]
  );
  return { id: res.rows[0].id, createdAt: res.rows[0].created_at };
}

export async function completeMcpRequestSuccess(
  db: DbPool,
  id: string,
  responseBody: unknown,
  startedAt: number,
  decision?: string
) {
  const durationMs = Date.now() - startedAt;
  await db.query(
    `UPDATE mcp_requests
       SET response_body = $1,
           status = 'SUCCESS',
           completed_at = now(),
           duration_ms = $2,
           decision = $4
     WHERE id = $3::uuid`,
    [responseBody, durationMs, id, decision ?? null]
  );
}

export async function completeMcpRequestError(
  db: DbPool,
  id: string,
  error: Error,
  startedAt: number,
  decision?: string
) {
  const durationMs = Date.now() - startedAt;
  await db.query(
    `UPDATE mcp_requests
       SET status = 'ERROR',
           error_message = $1,
           completed_at = now(),
           duration_ms = $2,
           decision = $4
     WHERE id = $3::uuid`,
    [truncateError(error), durationMs, id, decision ?? null]
  );
}

function truncateError(error: Error): string {
  const msg = `${error.name}: ${error.message}`;
  return msg.length > 1000 ? msg.slice(0, 1000) + '...[truncated]' : msg;
}

