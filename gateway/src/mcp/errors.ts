export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'MULTIPLE_CLIENTS_FOUND',
  'CLIENT_NOT_FOUND',
  'APPOINTMENT_NOT_FOUND',
  'POLICY_DENY',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'RATE_LIMIT',
  'UPSTREAM_ALTEGIO_ERROR',
  'INTERNAL_ERROR'
] as const;

export type McpErrorCode = (typeof ERROR_CODES)[number];

export function isAllowedErrorCode(code: string): code is McpErrorCode {
  return ERROR_CODES.includes(code as McpErrorCode);
}

export interface McpErrorBody {
  code: McpErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function mcpError(code: McpErrorCode, message: string, details?: Record<string, unknown>): McpErrorBody {
  return { code, message, details: details ?? {} };
}
