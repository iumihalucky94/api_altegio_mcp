import type { Intent } from './intent';
import type { DeterministicResult } from './deterministicScheduling';
import { DETERMINISTIC_CODES } from './deterministicScheduling';
import type { BookingSpecialistResult, BookingDomainStatus } from '../types/contracts';
import type { DecisionReasonCode } from '../types/reasonCodes';

export interface BookingSpecialistInput {
  intent: Intent;
  deterministic?: DeterministicResult | null;
  freeSlots: string[];
}

export function evaluateBooking(input: BookingSpecialistInput): BookingSpecialistResult {
  const { intent, deterministic, freeSlots } = input;

  if (intent !== 'BOOKING') {
    return {
      status: 'skipped',
      domainStatus: 'missing_data',
      reasonCode: 'booking_missing_data'
    };
  }

  // If deterministic layer already answered the client, we treat booking as handled there.
  if (deterministic && deterministic.applied) {
    const hasAlternatives = (deterministic.alternativeSlots ?? []).length > 0;
    let domainStatus: BookingDomainStatus = 'day_closed';
    let reasonCode: DecisionReasonCode = 'booking_day_closed';
    if (deterministic.code === DETERMINISTIC_CODES.SLOTS_AVAILABLE) {
      domainStatus = 'exact_slot_available';
      reasonCode = 'booking_exact_slot_available';
    } else if (deterministic.code === DETERMINISTIC_CODES.WORKING_TIME_VIOLATION) {
      domainStatus = hasAlternatives ? 'alternatives_only' : 'no_capacity';
      reasonCode = hasAlternatives ? 'booking_alternatives_only' : 'booking_no_capacity';
    } else if (deterministic.code === DETERMINISTIC_CODES.REQUESTED_DATE_NOT_OPEN) {
      domainStatus = hasAlternatives ? 'day_closed' : 'day_closed';
      reasonCode = hasAlternatives ? 'booking_day_closed' : 'booking_day_closed';
    }
    return {
      status: 'ok',
      domainStatus,
      reasonCode,
      suggestedAlternatives: deterministic.alternativeSlots
    };
  }

  // No deterministic decision; look at FREE_SLOTS.
  if (freeSlots.length > 0) {
    return {
      status: 'ok',
      domainStatus: 'exact_slot_available',
      reasonCode: 'booking_exact_slot_available'
    };
  }

  return {
    status: 'failed',
    domainStatus: 'missing_data',
    reasonCode: 'booking_missing_data'
  };
}

