export function isWithinBusinessHours(
  tz: string,
  start: string,
  end: string,
  date: Date = new Date()
): boolean {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const now = `${hour}:${minute}`;
  return now >= start && now <= end;
}

export function getNightMessage(
  tz: string,
  start: string,
  end: string,
  enabled: boolean
): string | null {
  if (!enabled) return null;
  if (isWithinBusinessHours(tz, start, end)) return null;
  return 'We are available 08:00–20:00. I forwarded your message to the administrator; they will get back to you as soon as possible.';
}
