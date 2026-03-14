type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const SENSITIVE_KEYS = ['authorization', 'token', 'password', 'secret', 'api_key', 'apikey'];
const MAX_BODY_LENGTH = 4000; // bytes-ish, for logging safety

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

export function redactHeaders(headers: Record<string, any> | null | undefined) {
  if (!headers) return null;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactBody(body: any): JsonValue | null {
  if (body == null) return null;

  let json: JsonValue;
  try {
    json = typeof body === 'string' ? (JSON.parse(body) as JsonValue) : (body as JsonValue);
  } catch {
    // Невалидный JSON (например, HTML/текст) — для безопасности и
    // упрощения хранения просто не сохраняем тело, оставляем только хеш.
    return null;
  }

  const truncated = truncateJson(json, MAX_BODY_LENGTH);
  return maskSensitiveFields(truncated);
}

function maskSensitiveFields(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((v) => maskSensitiveFields(v));
  }
  if (value && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = maskSensitiveFields(v as JsonValue);
      }
    }
    return out;
  }
  return value;
}

function estimateSize(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function truncateJson(value: JsonValue, maxBytes: number): JsonValue {
  const size = estimateSize(value);
  if (size <= maxBytes) return value;

  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      const candidate = [...out, item];
      if (estimateSize(candidate as any) > maxBytes) {
        out.push('...[truncated]' as any);
        break;
      }
      out.push(item);
    }
    return out;
  }

  if (value && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) {
      const candidate = { ...out, [k]: v };
      if (estimateSize(candidate as any) > maxBytes) {
        out['__truncated__'] = true;
        break;
      }
      out[k] = v as JsonValue;
    }
    return out;
  }

  const str = JSON.stringify(value);
  if (!str) return value;
  const truncated = str.slice(0, maxBytes);
  return (JSON.parse(truncated) as JsonValue) ?? null;
}

