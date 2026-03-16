"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateReschedule = evaluateReschedule;
function evaluateReschedule(input) {
    const { intent, upcomingAppointments, freeSlots, policyAllowsExecute } = input;
    if (intent !== 'RESCHEDULE') {
        return {
            status: 'skipped',
            domainStatus: 'missing_current_appointment',
            reasonCode: 'reschedule_missing_current_appointment'
        };
    }
    if (!upcomingAppointments || upcomingAppointments.length === 0) {
        return {
            status: 'failed',
            domainStatus: 'missing_current_appointment',
            reasonCode: 'reschedule_missing_current_appointment'
        };
    }
    if (!freeSlots || freeSlots.length === 0) {
        return {
            status: 'failed',
            domainStatus: 'no_capacity',
            reasonCode: 'reschedule_no_capacity'
        };
    }
    if (!policyAllowsExecute) {
        return {
            status: 'needs_approval',
            domainStatus: 'restricted_by_policy',
            reasonCode: 'reschedule_restricted_by_policy'
        };
    }
    const domainStatus = 'execution_ready';
    return {
        status: 'ok',
        domainStatus,
        reasonCode: 'reschedule_execution_ready'
    };
}
//# sourceMappingURL=rescheduleSpecialist.js.map