/**
 * Extract date and staff preference from user message for booking.
 * Used to fetch free_slots for the correct day and master (Europe/Vienna).
 */

const TZ = 'Europe/Vienna';

/** Russian month names (genitive for "18 марта") */
const RU_MONTHS: Record<string, number> = {
  января: 1, феврал: 2, марта: 3, апрел: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};

/** German month names */
const DE_MONTHS: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, marz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12
};

/** English month names */
const EN_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

const TZ_DEFAULT = 'Europe/Vienna';

/**
 * Resolve relative date expressions to YYYY-MM-DD (and optional time) in salon timezone.
 * Handles: завтра/послезавтра, tomorrow/day after tomorrow, morgen/übermorgen,
 * в понедельник / next Monday / nächsten Montag (and other weekdays).
 * Returns { date, time? } or null if no relative expression found.
 */
export function resolveRelativeDate(
  text: string,
  timezone: string = TZ_DEFAULT
): { date: string; time?: string } | null {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  const now = new Date();
  const todayYmd = now.toLocaleDateString('en-CA', { timeZone: timezone });

  const addDays = (ymd: string, days: number): string => {
    const d = new Date(ymd + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA', { timeZone: timezone });
  };

  const relativeDay: Record<string, number> = {
    завтра: 1, послезавтра: 2,
    tomorrow: 1, 'day after tomorrow': 2, 'day after': 2,
    morgen: 1, übermorgen: 2, uebermorgen: 2
  };
  for (const [phrase, days] of Object.entries(relativeDay)) {
    if (t.includes(phrase)) {
      const date = addDays(todayYmd, days);
      return { date };
    }
  }

  const weekdaysRu: Record<string, number> = {
    понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6, воскресенье: 0
  };
  const weekdaysEn: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0
  };
  const weekdaysDe: Record<string, number> = {
    montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0
  };

  const matchWeekday = (map: Record<string, number>): number | null => {
    for (const [name, dow] of Object.entries(map)) {
      if (t.includes(name)) return dow;
    }
    return null;
  };

  let targetDow: number | null = matchWeekday(weekdaysRu) ?? matchWeekday(weekdaysEn) ?? matchWeekday(weekdaysDe);
  const hasNext = /\b(следующ|next|nächsten|naechsten|на)\b/i.test(t) || /в (о)?\s*(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)/i.test(t);
  if (targetDow == null) {
    const ruAccusative: Record<string, number> = { понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 0 };
    for (const [name, dow] of Object.entries(ruAccusative)) {
      if (t.includes(name)) {
        targetDow = dow;
        break;
      }
    }
  }
  if (targetDow != null) {
    const today = new Date(todayYmd + 'T12:00:00');
    const currentDow = today.getDay();
    let daysAhead = (targetDow - currentDow + 7) % 7;
    if (daysAhead === 0 && hasNext) daysAhead = 7;
    else if (daysAhead === 0 && !hasNext) daysAhead = 0;
    const date = addDays(todayYmd, daysAhead);
    return { date };
  }

  return null;
}

/**
 * Extract a date from message text. Returns YYYY-MM-DD or null.
 * Handles: "18 марта", "18.03", "18.03.2026", "18 марта 2026", "March 18", "18th March", "на 18"
 */
export function extractDateFromMessage(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  const now = new Date();
  const year = now.getFullYear();

  const dd = (d: number) => String(d).padStart(2, '0');
  const mm = (m: number) => String(m).padStart(2, '0');

  const tryParse = (day: number, month: number, y?: number): string | null => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const yr = y ?? year;
    const d = new Date(yr, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return `${yr}-${mm(month)}-${dd(day)}`;
  };

  const lower = t.toLowerCase();

  for (const [key, month] of Object.entries(RU_MONTHS)) {
    const re = new RegExp(`(\\d{1,2})\\s*${key}(?:\\s*(\\d{4}))?`, 'i');
    const m = t.match(re);
    if (m) {
      const day = parseInt(m[1], 10);
      const y = m[2] ? parseInt(m[2], 10) : year;
      return tryParse(day, month, y);
    }
  }
  for (const [key, month] of Object.entries(DE_MONTHS)) {
    const re = new RegExp(`(\\d{1,2})\\s*${key}(?:\\s*(\\d{4}))?`, 'i');
    const m = lower.match(re);
    if (m) {
      const day = parseInt(m[1], 10);
      const y = m[2] ? parseInt(m[2], 10) : year;
      return tryParse(day, month, y);
    }
  }
  for (const [key, month] of Object.entries(EN_MONTHS)) {
    const re = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*${key}(?:\\s*(\\d{4}))?`, 'i');
    const m = lower.match(re);
    if (m) {
      const day = parseInt(m[1], 10);
      const y = m[2] ? parseInt(m[2], 10) : year;
      return tryParse(day, month, y);
    }
    const re2 = new RegExp(`${key}\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(\\d{4}))?`, 'i');
    const m2 = lower.match(re2);
    if (m2) {
      const day = parseInt(m2[1], 10);
      const y = m2[2] ? parseInt(m2[2], 10) : year;
      return tryParse(day, month, y);
    }
  }

  const ddmmyy = t.match(/\b(\d{1,2})[./\-](\d{1,2})(?:[./\-](\d{2,4}))?\b/);
  if (ddmmyy) {
    const a = parseInt(ddmmyy[1], 10);
    const b = parseInt(ddmmyy[2], 10);
    const c = ddmmyy[3] ? parseInt(ddmmyy[3], 10) : null;
    let day: number, month: number, y: number;
    if (a > 12) {
      day = a;
      month = b;
      y = c ?? year;
    } else if (b > 12) {
      day = b;
      month = a;
      y = c ?? year;
    } else {
      day = a;
      month = b;
      y = c ?? year;
    }
    if (y < 100) y = 2000 + y;
    return tryParse(day, month, y);
  }

  return null;
}

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function transliterateCyrToLat(s: string): string {
  return s.toLowerCase().split('').map((c) => CYR_TO_LAT[c] ?? c).join('');
}

/**
 * Match staff by name from message. Returns staff_id or null.
 * Handles "к Адель", "к Adel", "to Adel", "Адель", "Adel" (Cyrillic/Latin).
 */
export function matchStaffFromMessage(
  text: string,
  staff: Array<{ id: number; name?: string }>
): number | null {
  if (!text || !staff.length) return null;
  const lower = text.toLowerCase().trim();
  const lowerCyrLat = transliterateCyrToLat(text);
  for (const s of staff) {
    const name = (s.name ?? '').trim();
    if (!name || name.length < 2) continue;
    const nameLat = name.toLowerCase();
    const nameCyrLat = transliterateCyrToLat(name);
    if (lower.includes(nameLat) || lower.includes(name) || lowerCyrLat.includes(nameLat) || lowerCyrLat.includes(nameCyrLat)) return s.id;
    const nameWords = name.split(/\s+/).filter((w) => w.length >= 2);
    for (const part of nameWords) {
      const partLat = part.toLowerCase();
      const partCyrLat = transliterateCyrToLat(part);
      if (lower.includes(partLat) || lower.includes(part) || lowerCyrLat.includes(partLat) || lowerCyrLat.includes(partCyrLat)) return s.id;
    }
  }
  const preK = /\b(?:к|когда|to|with)\s+([a-zа-яё\s]+?)(?:\s|$|,|\.)/iu;
  const m = text.match(preK);
  if (m) {
    const namePart = m[1].trim();
    if (namePart.length >= 2) {
      const namePartLat = transliterateCyrToLat(namePart);
      for (const s of staff) {
        const name = (s.name ?? '').toLowerCase();
        const nameCyrLat = transliterateCyrToLat(s.name ?? '');
        if (name.includes(namePart) || namePart.includes(name) || nameCyrLat.includes(namePartLat) || namePartLat.includes(nameCyrLat)) return s.id;
      }
    }
  }
  return null;
}

/**
 * Return list of dates to fetch free_slots for: extracted date from message (if any and in range),
 * plus today and tomorrow as fallback. Max 5 dates to avoid too many calls.
 */
export function getDatesToFetch(text: string): string[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrow = new Date(Date.now() + 86400 * 1000).toLocaleDateString('en-CA', { timeZone: TZ });
  const extracted = extractDateFromMessage(text);
  const out: string[] = [];
  const seen = new Set<string>();
  if (extracted) {
    const ext = new Date(extracted + 'T12:00:00');
    const now = new Date();
    const daysAhead = Math.ceil((ext.getTime() - now.getTime()) / (86400 * 1000));
    if (daysAhead >= 0 && daysAhead <= 60) {
      out.push(extracted);
      seen.add(extracted);
    }
  }
  for (const d of [today, tomorrow]) {
    if (!seen.has(d)) {
      out.push(d);
      seen.add(d);
    }
  }
  return out.slice(0, 5);
}
