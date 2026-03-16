import type { Intent } from './intent';
import type { CancellationSpecialistResult } from '../types/contracts';
export interface CancellationSpecialistInput {
    intent: Intent;
    upcomingAppointments: Array<{
        id?: string;
        start?: string;
        service?: string;
        master?: string;
    }> | undefined;
    requiresAdminApproval: boolean;
    canExecuteMutating: boolean;
}
export declare function evaluateCancellation(input: CancellationSpecialistInput): CancellationSpecialistResult;
//# sourceMappingURL=cancellationSpecialist.d.ts.map