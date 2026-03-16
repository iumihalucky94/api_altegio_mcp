/**
 * Deterministic scheduling: check if there is any availability for the requested date.
 * Uses gateway tool crm.get_availability_for_date (gateway resolves staff/service internally).
 * Replies from this layer are not subject to confidence threshold and do not trigger handoff.
 */

import { resolveRelativeDate, extractDateFromMessage } from './bookingContext';
import { callMcp } from './mcpClient';
import { getSystemMessage } from './localization';
import type { ResolvedLanguage } from './localization';

/** Controlled response codes for deterministic scheduling outcomes. */
export const DETERMINISTIC_CODES = {
  REQUESTED_DATE_NOT_OPEN: 'REQUESTED_DATE_NOT_OPEN',
  WORKING_DAY_VIOLATION: 'WORKING_DAY_VIOLATION',
  WORKING_TIME_VIOLATION: 'WORKING_TIME_VIOLATION',
  SERVICE_DOES_NOT_FIT_SLOT: 'SERVICE_DOES_NOT_FIT_SLOT',
  ALTERNATIVE_SLOTS_OFFERED: 'ALTERNATIVE_SLOTS_OFFERED',
  SLOTS_AVAILABLE: 'SLOTS_AVAILABLE'
} as const;

export interface DeterministicResult {
  applied: true;
  reply: string;
  code: string;
  alternativeSlots: string[];
  events: Array<{ event_type: string; payload?: Record<string, unknown> }>;
}

export interface DeterministicNoResult {
  applied: false;
}

const MAX_ALTERNATIVE_DAYS = 5;
const MAX_ALTERNATIVE_SLOTS = 10;

function getRequestedDateFromMessage(text: string, timezone: string): string | null {
  const relative = resolveRelativeDate(text, timezone);
  if (relative?.date) return relative.date;
  return extractDateFromMessage(text);
}

/** Ask gateway: is there any window for this date? (gateway resolves staff/service). */
async function getAvailabilityForDate(
  companyId: number,
  date: string,
  requestId: string
): Promise<{ free_slots: string[]; working_hours_count: number }> {
  try {
    const res = await callMcp(
      'crm.get_availability_for_date',
      { company_id: companyId, date },
      companyId,
      requestId
    );
    const r = res.result as { free_slots?: string[]; working_hours_count?: number };
    return {
      free_slots: Array.isArray(r?.free_slots) ? r.free_slots : [],
      working_hours_count: typeof r?.working_hours_count === 'number' ? r.working_hours_count : 0
    };
  } catch {
    return { free_slots: [], working_hours_count: 0 };
  }
}

function addDays(ymd: string, days: number, timezone: string = 'Europe/Vienna'): string {
  const d = new Date(ymd + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: timezone });
}

function formatSlotsForMessage(slots: string[], maxItems: number = 8): string {
  const taken = slots.slice(0, maxItems);
  const parts = taken.map((s) => {
    const d = new Date(s);
    const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  });
  return parts.join(', ');
}

function formatDateLabel(ymd: string, lang: ResolvedLanguage): string {
  const d = new Date(ymd + 'T12:00:00');
  if (lang === 'ru') return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (lang === 'de') return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

/**
 * Try deterministic scheduling reply: one call "is there any window for this date?".
 * Does not require staff/services from orchestrator; gateway resolves them.
 */
export async function tryDeterministicSchedulingReply(params: {
  batchText: string;
  companyId: number;
  requestId: string;
  effectiveLang: ResolvedLanguage;
  timezone: string;
}): Promise<DeterministicResult | DeterministicNoResult> {
  const { batchText, companyId, requestId, effectiveLang, timezone } = params;
  const events: Array<{ event_type: string; payload?: Record<string, unknown> }> = [];

  const requestedDate = getRequestedDateFromMessage(batchText, timezone);
  if (!requestedDate) return { applied: false };

  events.push({ event_type: 'relative_date_resolved', payload: { requested_date: requestedDate } });

  const { free_slots: slotsOnRequested, working_hours_count: workingHoursCount } = await getAvailabilityForDate(
    companyId,
    requestedDate,
    requestId
  );

  if (workingHoursCount === 0) {
    events.push({ event_type: 'working_day_violation', payload: { requested_date: requestedDate } });
    const alternativeSlots: string[] = [];
    const alternativeDatesWithSlots: string[] = [];
    for (let i = 1; i <= MAX_ALTERNATIVE_DAYS; i++) {
      const nextDate = addDays(requestedDate, i, timezone);
      const { free_slots } = await getAvailabilityForDate(companyId, nextDate, requestId);
      if (free_slots.length > 0) {
        alternativeSlots.push(...free_slots);
        alternativeDatesWithSlots.push(nextDate);
      }
      if (alternativeSlots.length >= MAX_ALTERNATIVE_SLOTS) break;
    }
    events.push({ event_type: 'alternative_slots_found', payload: { count: alternativeSlots.length } });
    const base = getSystemMessage('requested_date_not_open', effectiveLang);
    if (alternativeDatesWithSlots.length > 0) {
      const daysLabel = formatDayList(alternativeDatesWithSlots, effectiveLang);
      const follow = getSystemMessage('day_alternatives', effectiveLang, { days: daysLabel });
      const reply = base + '\n\n' + follow;
      events.push({ event_type: 'deterministic_reply_sent', payload: { code: DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN } });
      return { applied: true, reply, code: DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN, alternativeSlots, events };
    }
    const reply = base;
    events.push({ event_type: 'deterministic_reply_sent', payload: { code: DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN } });
    return { applied: true, reply, code: DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN, alternativeSlots: [], events };
  }

  events.push({ event_type: 'requested_datetime_validated', payload: { requested_date: requestedDate, working_hours_count: workingHoursCount } });

  if (slotsOnRequested.length > 0) {
    const slotsText = formatSlotsForMessage(slotsOnRequested);
    const dateLabel = formatDateLabel(requestedDate, effectiveLang);
    const reply = getSystemMessage('slots_available', effectiveLang, { date: dateLabel, slots: slotsText });
    events.push({ event_type: 'alternative_slots_found', payload: { count: slotsOnRequested.length } });
    events.push({ event_type: 'deterministic_reply_sent', payload: { code: DETERMINISTIC_CODES.SLOTS_AVAILABLE } });
    return { applied: true, reply, code: DETERMINISTIC_CODES.SLOTS_AVAILABLE, alternativeSlots: slotsOnRequested, events };
  }

  events.push({ event_type: 'working_time_violation', payload: { requested_date: requestedDate } });
  const alternativeSlots: string[] = [];
  for (let i = 1; i <= MAX_ALTERNATIVE_DAYS; i++) {
    const nextDate = addDays(requestedDate, i, timezone);
    const { free_slots } = await getAvailabilityForDate(companyId, nextDate, requestId);
    alternativeSlots.push(...free_slots);
    if (alternativeSlots.length >= MAX_ALTERNATIVE_SLOTS) break;
  }
  events.push({ event_type: 'alternative_slots_found', payload: { count: alternativeSlots.length } });
  const slotsText = formatSlotsForMessage(alternativeSlots);
  const reply = alternativeSlots.length > 0
    ? getSystemMessage('working_time_violation', effectiveLang, { slots: slotsText })
    : getSystemMessage('working_time_violation_no_slots', effectiveLang);
  events.push({ event_type: 'deterministic_reply_sent', payload: { code: DETERMINISTIC_CODES.WORKING_TIME_VIOLATION } });
  return { applied: true, reply, code: DETERMINISTIC_CODES.WORKING_TIME_VIOLATION, alternativeSlots, events };
}

function formatDayList(ymdList: string[], lang: ResolvedLanguage): string {
  const unique = Array.from(new Set(ymdList));
  const labels = unique.map((ymd) => {
    const d = new Date(ymd + 'T12:00:00');
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long' };
    if (lang === 'ru') return d.toLocaleDateString('ru-RU', opts);
    if (lang === 'de') return d.toLocaleDateString('de-DE', opts);
    return d.toLocaleDateString('en-GB', opts);
  });
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} / ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} / ${labels[labels.length - 1]}`;
}
