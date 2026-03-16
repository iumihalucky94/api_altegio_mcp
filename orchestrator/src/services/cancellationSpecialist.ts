import type { Intent } from './intent';
import type { CancellationSpecialistResult, CancellationDomainStatus } from '../types/contracts';

export interface CancellationSpecialistInput {
  intent: Intent;
  upcomingAppointments: Array<{ id?: string; start?: string; service?: string; master?: string }> | undefined;
  requiresAdminApproval: boolean;
  canExecuteMutating: boolean;
}

export function evaluateCancellation(input: CancellationSpecialistInput): CancellationSpecialistResult {
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

  const domainStatus: CancellationDomainStatus = 'execution_ready';

  return {
    status: 'ok',
    domainStatus,
    reasonCode: 'cancellation_execution_ready'
  };
}

