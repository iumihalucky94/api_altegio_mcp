const E164_RE = /^\+?[1-9]\d{1,14}$/;

export function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '';
  return digits.startsWith('0') ? `+${digits.slice(1)}` : `+${digits}`;
}

export function isValidE164(phone: string): boolean {
  const n = normalizeE164(phone);
  return n.length > 0 && E164_RE.test(n);
}

export function formatForDisplay(phone: string): string {
  return normalizeE164(phone) || phone;
}
