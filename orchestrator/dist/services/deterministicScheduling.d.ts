/**
 * Deterministic scheduling: check if there is any availability for the requested date.
 * Uses gateway tool crm.get_availability_for_date (gateway resolves staff/service internally).
 * Replies from this layer are not subject to confidence threshold and do not trigger handoff.
 */
import type { ResolvedLanguage } from './localization';
/** Controlled response codes for deterministic scheduling outcomes. */
export declare const DETERMINISTIC_CODES: {
    readonly REQUESTED_DATE_NOT_OPEN: "REQUESTED_DATE_NOT_OPEN";
    readonly WORKING_DAY_VIOLATION: "WORKING_DAY_VIOLATION";
    readonly WORKING_TIME_VIOLATION: "WORKING_TIME_VIOLATION";
    readonly SERVICE_DOES_NOT_FIT_SLOT: "SERVICE_DOES_NOT_FIT_SLOT";
    readonly ALTERNATIVE_SLOTS_OFFERED: "ALTERNATIVE_SLOTS_OFFERED";
    readonly SLOTS_AVAILABLE: "SLOTS_AVAILABLE";
    readonly SERVICE_TYPE_CLARIFICATION: "SERVICE_TYPE_CLARIFICATION";
};
export interface DeterministicResult {
    applied: true;
    reply: string;
    code: string;
    alternativeSlots: string[];
    events: Array<{
        event_type: string;
        payload?: Record<string, unknown>;
    }>;
}
export interface DeterministicNoResult {
    applied: false;
}
/**
 * Try deterministic scheduling reply: one call "is there any window for this date?".
 * Does not require staff/services from orchestrator; gateway resolves them.
 * Optional preferredStaffName: when showing slots, mention this master if provided.
 */
export declare function tryDeterministicSchedulingReply(params: {
    batchText: string;
    companyId: number;
    requestId: string;
    effectiveLang: ResolvedLanguage;
    timezone: string;
    /** If set, slots reply will mention this master (e.g. "У Светланы на четверг..."). */
    preferredStaffName?: string;
}): Promise<DeterministicResult | DeterministicNoResult>;
//# sourceMappingURL=deterministicScheduling.d.ts.map