/**
 * Extract date and staff preference from user message for booking.
 * Used to fetch free_slots for the correct day and master (Europe/Vienna).
 */
/**
 * Resolve relative date expressions to YYYY-MM-DD (and optional time) in salon timezone.
 * Handles: завтра/послезавтра, tomorrow/day after tomorrow, morgen/übermorgen,
 * в понедельник / next Monday / nächsten Montag (and other weekdays).
 * Returns { date, time? } or null if no relative expression found.
 */
export declare function resolveRelativeDate(text: string, timezone?: string): {
    date: string;
    time?: string;
} | null;
/**
 * Extract a date from message text. Returns YYYY-MM-DD or null.
 * Handles: "18 марта", "18.03", "18.03.2026", "18 марта 2026", "March 18", "18th March", "на 18"
 */
export declare function extractDateFromMessage(text: string): string | null;
/**
 * Match staff by name from message. Returns staff_id or null.
 * Handles "к Адель", "к Adel", "to Adel", "Адель", "Adel" (Cyrillic/Latin).
 */
export declare function matchStaffFromMessage(text: string, staff: Array<{
    id: number;
    name?: string;
}>): number | null;
/**
 * Return list of dates to fetch free_slots for: extracted date from message (if any and in range),
 * plus today and tomorrow as fallback. Max 5 dates to avoid too many calls.
 */
export declare function getDatesToFetch(text: string): string[];
//# sourceMappingURL=bookingContext.d.ts.map