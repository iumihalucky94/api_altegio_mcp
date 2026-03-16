import type { Intent } from './intent';
import type { DeterministicResult } from './deterministicScheduling';
import type { BookingSpecialistResult } from '../types/contracts';
export interface BookingSpecialistInput {
    intent: Intent;
    deterministic?: DeterministicResult | null;
    freeSlots: string[];
}
export declare function evaluateBooking(input: BookingSpecialistInput): BookingSpecialistResult;
//# sourceMappingURL=bookingSpecialist.d.ts.map