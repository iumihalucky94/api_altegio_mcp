import { DbPool } from './db';
import { redactBody, redactHeaders } from './redactor';
import { sha256Hex } from '../utils/hash';

export interface HttpCallAuditInput {
  mcpRequestId?: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, any>;
  requestBody?: any;
  responseStatus?: number;
  responseHeaders?: Record<string, any>;
  responseBody?: any;
  startedAt: number;
}

export async function writeHttpCall(db: DbPool, input: HttpCallAuditInput) {
  const durationMs = Date.now() - input.startedAt;

  const maskedReqHeaders = redactHeaders(input.requestHeaders ?? null);
  const maskedReqBody = redactBody(input.requestBody ?? null);
  const maskedResHeaders = redactHeaders(input.responseHeaders ?? null);
  const maskedResBody = redactBody(input.responseBody ?? null);

  const reqHash = input.requestBody ? sha256Hex(input.requestBody) : null;
  const resHash = input.responseBody ? sha256Hex(input.responseBody) : null;

  await db.query(
    `INSERT INTO altegio_http_calls (
       mcp_request_id,
       method,
       url,
       request_headers,
       request_body_masked,
       request_body_hash,
       response_status,
       response_headers,
       response_body_masked,
       response_body_hash,
       duration_ms
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.mcpRequestId ? input.mcpRequestId : null,
      input.method,
      input.url,
      maskedReqHeaders,
      maskedReqBody,
      reqHash,
      input.responseStatus ?? null,
      maskedResHeaders,
      maskedResBody,
      resHash,
      durationMs
    ]
  );
}

