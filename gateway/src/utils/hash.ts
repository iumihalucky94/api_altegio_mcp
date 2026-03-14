import crypto from 'crypto';

export function sha256Hex(payload: unknown): string {
  const hash = crypto.createHash('sha256');
  const data =
    typeof payload === 'string'
      ? payload
      : JSON.stringify(payload ?? null);
  hash.update(data);
  return hash.digest('hex');
}

