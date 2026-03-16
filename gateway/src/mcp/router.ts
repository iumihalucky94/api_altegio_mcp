import { DbPool } from '../audit/db';
import { handleSearchClients } from './tools/crm/searchClients';
import { handleSearchAppointments } from './tools/crm/searchAppointments';
import { handleListStaff } from './tools/crm/listStaff';
import { handleListAppointments } from './tools/crm/listAppointments';
import { handleCreateAppointment } from './tools/crm/createAppointment';
import { handleRescheduleAppointment } from './tools/crm/rescheduleAppointment';
import { handleCancelAppointmentPlan, handleCancelAppointmentApply } from './tools/crm/cancelAppointment';
import { handleGetStaffCalculations } from './tools/payroll/getStaffCalculations';
import { handleComputeStaffSalary } from './tools/payroll/computeStaffSalary';
import {
  handlePlanApplySalaryResult,
  handleApplySalaryResult
} from './tools/payroll/applySalaryResult';
import { handleGetCapabilities } from './tools/system/getCapabilities';
import { handleExplainError } from './tools/system/explainError';
import { handleAppendMessages } from './tools/conversation/appendMessages';
import { handleGetUpcomingAppointmentsByPhone } from './tools/admin/getUpcomingAppointmentsByPhone';
import { handleUpdateClient } from './tools/admin/updateClient';
import { handleUpdateAppointmentServices } from './tools/admin/updateAppointmentServices';
import { handleCreateCase } from './tools/handoff/createCase';
import { handleListServices } from './tools/crm/listServices';
import { handleGetServiceDuration } from './tools/crm/getServiceDuration';
import { handleGetMasterWorkingHours } from './tools/crm/getMasterWorkingHours';
import { handleGetFreeSlots } from './tools/crm/getFreeSlots';
import { handleGetAvailabilityForDate } from './tools/crm/getAvailabilityForDate';
import { handleValidateSlot } from './tools/crm/validateSlot';

type EnvConfig = any;

export interface ToolDispatchContext {
  tool: string;
  params: any;
  idempotencyKey?: string;
  approvalId?: string;
  companyId?: number;
  db: DbPool;
  config: EnvConfig;
  logger: any;
  mcpRequestId: string;
}

type ToolHandler = (ctx: ToolDispatchContext) => Promise<any>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  'system.get_capabilities': handleGetCapabilities,
  'system.explain_error': handleExplainError,
  'conversation.append_messages': handleAppendMessages,
  'admin.get_upcoming_appointments_by_phone': handleGetUpcomingAppointmentsByPhone,
  'admin.update_client': handleUpdateClient,
  'admin.update_appointment_services': handleUpdateAppointmentServices,
  'handoff.create_case': handleCreateCase,
  'crm.list_services': handleListServices,
  'crm.get_service_duration': handleGetServiceDuration,
  'crm.get_master_working_hours': handleGetMasterWorkingHours,
  'crm.get_free_slots': handleGetFreeSlots,
  'crm.get_availability_for_date': handleGetAvailabilityForDate,
  'crm.validate_slot': handleValidateSlot,
  'crm.search_clients': handleSearchClients,
  'crm.search_appointments': handleSearchAppointments,
  'crm.list_staff': handleListStaff,
  'crm.list_appointments': handleListAppointments,
  'crm.create_appointment': handleCreateAppointment,
  'crm.reschedule_appointment': handleRescheduleAppointment,
  'crm.cancel_appointment.plan': handleCancelAppointmentPlan,
  'crm.cancel_appointment.apply': handleCancelAppointmentApply,
  'admin.cancel_appointment_plan': handleCancelAppointmentPlanAlias,
  'admin.cancel_appointment_apply': handleCancelAppointmentApplyAlias,
  'payroll.get_staff_calculations': handleGetStaffCalculations,
  'payroll.compute_staff_salary': handleComputeStaffSalary,
  'payroll.plan_apply_salary_result': handlePlanApplySalaryResult,
  'payroll.apply_salary_result': handleApplySalaryResult
};

async function handleCancelAppointmentPlanAlias(ctx: ToolDispatchContext) {
  const { appointment_id, reason, requested_by } = ctx.params;
  return handleCancelAppointmentPlan({ ...ctx, params: { appointment_id: Number(appointment_id), reason, notify_client: true } });
}

async function handleCancelAppointmentApplyAlias(ctx: ToolDispatchContext) {
  const approvalId = ctx.params.approval_id ?? ctx.approvalId;
  const idempotencyKey = ctx.params.idempotency_key ?? ctx.idempotencyKey;
  if (!approvalId || !idempotencyKey) {
    const err: any = new Error('approval_id and idempotency_key required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const { getApproval } = await import('../approvals/service');
  const approval = await getApproval(ctx.db, approvalId);
  if (!approval?.details?.params) {
    const err: any = new Error('Approval not found or invalid');
    err.code = 'APPROVAL_INVALID';
    throw err;
  }
  const detailsParams = approval.details.params;
  const params = { appointment_id: Number(detailsParams.appointment_id), reason: detailsParams.reason, notify_client: true };
  return handleCancelAppointmentApply({
    ...ctx,
    params,
    approvalId,
    idempotencyKey
  });
}

export async function dispatchTool(ctx: ToolDispatchContext): Promise<any> {
  const handler = TOOL_HANDLERS[ctx.tool];
  if (!handler) {
    const err = new Error(`Tool not allowed: ${ctx.tool}`);
    (err as any).code = 'TOOL_NOT_ALLOWED';
    throw err;
  }
  return handler(ctx);
}

