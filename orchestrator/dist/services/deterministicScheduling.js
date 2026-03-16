"use strict";
/**
 * Deterministic scheduling: check if there is any availability for the requested date.
 * Uses gateway tool crm.get_availability_for_date (gateway resolves staff/service internally).
 * Replies from this layer are not subject to confidence threshold and do not trigger handoff.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETERMINISTIC_CODES = void 0;
exports.tryDeterministicSchedulingReply = tryDeterministicSchedulingReply;
const bookingContext_1 = require("./bookingContext");
const mcpClient_1 = require("./mcpClient");
const localization_1 = require("./localization");
/** Controlled response codes for deterministic scheduling outcomes. */
exports.DETERMINISTIC_CODES = {
    REQUESTED_DATE_NOT_OPEN: 'REQUESTED_DATE_NOT_OPEN',
    WORKING_DAY_VIOLATION: 'WORKING_DAY_VIOLATION',
    WORKING_TIME_VIOLATION: 'WORKING_TIME_VIOLATION',
    SERVICE_DOES_NOT_FIT_SLOT: 'SERVICE_DOES_NOT_FIT_SLOT',
    ALTERNATIVE_SLOTS_OFFERED: 'ALTERNATIVE_SLOTS_OFFERED',
    SLOTS_AVAILABLE: 'SLOTS_AVAILABLE',
    SERVICE_TYPE_CLARIFICATION: 'SERVICE_TYPE_CLARIFICATION'
};
const MAX_ALTERNATIVE_DAYS = 5;
const MAX_ALTERNATIVE_SLOTS = 10;
function isGenericLashBooking(text) {
    if (!text)
        return false;
    const t = text.toLowerCase();
    return /\b(реснич|ресниц|wimpern|lashes?|lash)\b/.test(t);
}
function hasExplicitServiceType(text) {
    if (!text)
        return false;
    const t = text.toLowerCase();
    // Corrections / refills / full set markers in RU/DE/EN.
    return /\b(коррекц|refill|auff[üu]llung|full set|neues set|new set|полное наращивани|новое наращивани)\b/.test(t);
}
function getRequestedDateFromMessage(text, timezone) {
    const relative = (0, bookingContext_1.resolveRelativeDate)(text, timezone);
    if (relative?.date)
        return relative.date;
    return (0, bookingContext_1.extractDateFromMessage)(text);
}
/** Ask gateway: is there any window for this date? (gateway resolves staff/service). */
async function getAvailabilityForDate(companyId, date, requestId) {
    try {
        const res = await (0, mcpClient_1.callMcp)('crm.get_availability_for_date', { company_id: companyId, date }, companyId, requestId);
        const r = res.result;
        return {
            free_slots: Array.isArray(r?.free_slots) ? r.free_slots : [],
            working_hours_count: typeof r?.working_hours_count === 'number' ? r.working_hours_count : 0
        };
    }
    catch {
        return { free_slots: [], working_hours_count: 0 };
    }
}
function addDays(ymd, days, timezone = 'Europe/Vienna') {
    const d = new Date(ymd + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA', { timeZone: timezone });
}
function formatSlotsForMessage(slots, maxItems = 3) {
    const taken = slots.slice(0, maxItems);
    const parts = taken.map((s) => {
        const d = new Date(s);
        const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return time;
    });
    return parts.join('\n');
}
function formatDateLabel(ymd, lang) {
    const d = new Date(ymd + 'T12:00:00');
    if (lang === 'ru')
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    if (lang === 'de')
        return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
/**
 * Try deterministic scheduling reply: one call "is there any window for this date?".
 * Does not require staff/services from orchestrator; gateway resolves them.
 * Optional preferredStaffName: when showing slots, mention this master if provided.
 */
async function tryDeterministicSchedulingReply(params) {
    const { batchText, companyId, requestId, effectiveLang, timezone, preferredStaffName } = params;
    const events = [];
    const requestedDate = getRequestedDateFromMessage(batchText, timezone);
    if (!requestedDate)
        return { applied: false };
    events.push({ event_type: 'relative_date_resolved', payload: { requested_date: requestedDate } });
    // For generic lash booking without explicit service type, ask clarification first instead of showing slots.
    if (isGenericLashBooking(batchText) && !hasExplicitServiceType(batchText)) {
        const reply = (0, localization_1.getSystemMessage)('lash_service_clarification', effectiveLang);
        events.push({
            event_type: 'deterministic_reply_sent',
            payload: { code: exports.DETERMINISTIC_CODES.SERVICE_TYPE_CLARIFICATION }
        });
        return { applied: true, reply, code: exports.DETERMINISTIC_CODES.SERVICE_TYPE_CLARIFICATION, alternativeSlots: [], events };
    }
    const { free_slots: slotsOnRequested, working_hours_count: workingHoursCount } = await getAvailabilityForDate(companyId, requestedDate, requestId);
    if (workingHoursCount === 0) {
        events.push({ event_type: 'working_day_violation', payload: { requested_date: requestedDate } });
        const alternativeSlots = [];
        const alternativeDatesWithSlots = [];
        for (let i = 1; i <= MAX_ALTERNATIVE_DAYS; i++) {
            const nextDate = addDays(requestedDate, i, timezone);
            const { free_slots } = await getAvailabilityForDate(companyId, nextDate, requestId);
            if (free_slots.length > 0) {
                alternativeSlots.push(...free_slots);
                alternativeDatesWithSlots.push(nextDate);
            }
            if (alternativeSlots.length >= MAX_ALTERNATIVE_SLOTS)
                break;
        }
        events.push({ event_type: 'alternative_slots_found', payload: { count: alternativeSlots.length } });
        const base = (0, localization_1.getSystemMessage)('requested_date_not_open', effectiveLang);
        if (alternativeDatesWithSlots.length > 0) {
            const daysLabel = formatDayList(alternativeDatesWithSlots, effectiveLang);
            const follow = (0, localization_1.getSystemMessage)('day_alternatives', effectiveLang, { days: daysLabel });
            const reply = base + '\n\n' + follow;
            events.push({ event_type: 'deterministic_reply_sent', payload: { code: exports.DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN } });
            return { applied: true, reply, code: exports.DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN, alternativeSlots, events };
        }
        const reply = base;
        events.push({ event_type: 'deterministic_reply_sent', payload: { code: exports.DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN } });
        return { applied: true, reply, code: exports.DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN, alternativeSlots: [], events };
    }
    events.push({ event_type: 'requested_datetime_validated', payload: { requested_date: requestedDate, working_hours_count: workingHoursCount } });
    if (slotsOnRequested.length > 0) {
        const slotsText = formatSlotsForMessage(slotsOnRequested);
        const dateLabel = formatDateLabel(requestedDate, effectiveLang);
        const reply = preferredStaffName
            ? (0, localization_1.getSystemMessage)('slots_available_with_master', effectiveLang, { masterName: preferredStaffName, date: dateLabel, slots: slotsText })
            : (0, localization_1.getSystemMessage)('slots_available', effectiveLang, { date: dateLabel, slots: slotsText });
        events.push({ event_type: 'alternative_slots_found', payload: { count: slotsOnRequested.length } });
        events.push({ event_type: 'deterministic_reply_sent', payload: { code: exports.DETERMINISTIC_CODES.SLOTS_AVAILABLE } });
        return { applied: true, reply, code: exports.DETERMINISTIC_CODES.SLOTS_AVAILABLE, alternativeSlots: slotsOnRequested, events };
    }
    events.push({ event_type: 'working_time_violation', payload: { requested_date: requestedDate } });
    const alternativeSlots = [];
    for (let i = 1; i <= MAX_ALTERNATIVE_DAYS; i++) {
        const nextDate = addDays(requestedDate, i, timezone);
        const { free_slots } = await getAvailabilityForDate(companyId, nextDate, requestId);
        alternativeSlots.push(...free_slots);
        if (alternativeSlots.length >= MAX_ALTERNATIVE_SLOTS)
            break;
    }
    events.push({ event_type: 'alternative_slots_found', payload: { count: alternativeSlots.length } });
    const slotsText = formatSlotsForMessage(alternativeSlots);
    const reply = alternativeSlots.length > 0
        ? (0, localization_1.getSystemMessage)('working_time_violation', effectiveLang, { slots: slotsText })
        : (0, localization_1.getSystemMessage)('working_time_violation_no_slots', effectiveLang);
    events.push({ event_type: 'deterministic_reply_sent', payload: { code: exports.DETERMINISTIC_CODES.WORKING_TIME_VIOLATION } });
    return { applied: true, reply, code: exports.DETERMINISTIC_CODES.WORKING_TIME_VIOLATION, alternativeSlots, events };
}
function formatDayList(ymdList, lang) {
    const unique = Array.from(new Set(ymdList));
    const labels = unique.map((ymd) => {
        const d = new Date(ymd + 'T12:00:00');
        const opts = { weekday: 'long' };
        if (lang === 'ru')
            return d.toLocaleDateString('ru-RU', opts);
        if (lang === 'de')
            return d.toLocaleDateString('de-DE', opts);
        return d.toLocaleDateString('en-GB', opts);
    });
    if (labels.length <= 1)
        return labels[0] ?? '';
    if (labels.length === 2)
        return `${labels[0]} / ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} / ${labels[labels.length - 1]}`;
}
//# sourceMappingURL=deterministicScheduling.js.map