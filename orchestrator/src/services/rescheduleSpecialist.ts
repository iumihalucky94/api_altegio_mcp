import type { Intent } from './intent';
import type { RescheduleSpecialistResult, RescheduleDomainStatus } from '../types/contracts';

export interface RescheduleSpecialistInput {
  intent: Intent;
  upcomingAppointments: Array<{ id?: string; start?: string; service?: string; master?: string }> | undefined;
  freeSlots: string[];
  policyAllowsExecute: boolean;
}

export function evaluateReschedule(input: RescheduleSpecialistInput): RescheduleSpecialistResult {
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

  const domainStatus: RescheduleDomainStatus = 'execution_ready';

  return {
    status: 'ok',
    domainStatus,
    reasonCode: 'reschedule_execution_ready'
  };
}

