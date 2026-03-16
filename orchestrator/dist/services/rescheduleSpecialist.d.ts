import type { Intent } from './intent';
import type { RescheduleSpecialistResult } from '../types/contracts';
export interface RescheduleSpecialistInput {
    intent: Intent;
    upcomingAppointments: Array<{
        id?: string;
        start?: string;
        service?: string;
        master?: string;
    }> | undefined;
    freeSlots: string[];
    policyAllowsExecute: boolean;
}
export declare function evaluateReschedule(input: RescheduleSpecialistInput): RescheduleSpecialistResult;
//# sourceMappingURL=rescheduleSpecialist.d.ts.map