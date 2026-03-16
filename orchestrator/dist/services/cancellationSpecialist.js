"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCancellation = evaluateCancellation;
function evaluateCancellation(input) {
    const { intent, upcomingAppointments, requiresAdminApproval, canExecuteMutating } = input;
    if (intent !== 'CANCEL_REQUEST') {
        return {
            status: 'skipped',
            domainStatus: 'missing_current_appointment',
            reasonCode: 'cancellation_missing_current_appointment'
        };
    }
    if (!upcomingAppointments || upcomingAppointments.length === 0) {
        return {
            status: 'failed',
            domainStatus: 'missing_current_appointment',
            reasonCode: 'cancellation_missing_current_appointment'
        };
    }
    if (!canExecuteMutating) {
        return {
            status: 'needs_approval',
            domainStatus: 'restricted_by_policy',
            reasonCode: 'cancellation_restricted_by_policy'
        };
    }
    if (requiresAdminApproval) {
        return {
            status: 'needs_approval',
            domainStatus: 'approval_required',
            reasonCode: 'cancellation_approval_required'
        };
    }
    const domainStatus = 'execution_ready';
    return {
        status: 'ok',
        domainStatus,
        reasonCode: 'cancellation_execution_ready'
    };
}
//# sourceMappingURL=cancellationSpecialist.js.map