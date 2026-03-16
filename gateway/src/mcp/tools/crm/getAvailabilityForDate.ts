/**
 * Check if there is any availability for a given date (any master, any service).
 * Used by orchestrator to answer "есть окошко на завтра?" without pre-fetching staff/services.
 * Resolves staff_id and service_id inside gateway (first from API or config defaults).
 */
import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import {
  toAltegioDate,
  parseScheduleToWorkingSlots,
  parseAppointmentIntervalsForStaff,
  computeFreeSlotStarts,
  getServiceDurationSeconds
} from '../../../altegio/slots';
import { getConfig } from '../../../config/resolver';

const schema = z.object({
  company_id: z.number(),
  date: z.string() // YYYY-MM-DD
});

export async function handleGetAvailabilityForDate(ctx: ToolDispatchContext) {
  const { company_id, date } = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  let staffId: number | null = null;
  let serviceId: number | null = null;

  try {
    const [staffData, servicesData] = await Promise.all([
      altegio.listTeamMembers(ctx.mcpRequestId, company_id),
      altegio.listServices(ctx.mcpRequestId, company_id)
    ]);
    const staffList = Array.isArray(staffData) ? staffData : (staffData as any)?.data ?? [];
    const servicesList = Array.isArray(servicesData) ? servicesData : (servicesData as any)?.data ?? [];
    const firstStaff = staffList[0];
    const firstService = servicesList[0];
    if (firstStaff != null) staffId = Number((firstStaff as any).id ?? firstStaff);
    if (firstService != null) serviceId = Number((firstService as any).id ?? firstService);
  } catch (_) {}

  if (staffId == null || serviceId == null) {
    const defaultStaff = await getConfig<number | string>('DEFAULT_STAFF_ID');
    const defaultService = await getConfig<number | string>('DEFAULT_SERVICE_ID');
    const dStaff = defaultStaff != null && defaultStaff !== '' ? Number(defaultStaff) : NaN;
    const dService = defaultService != null && defaultService !== '' ? Number(defaultService) : NaN;
    if ((staffId == null || !Number.isFinite(staffId)) && Number.isFinite(dStaff)) staffId = dStaff;
    if ((serviceId == null || !Number.isFinite(serviceId)) && Number.isFinite(dService)) serviceId = dService;
  }

  if (staffId == null || serviceId == null || !Number.isFinite(staffId) || !Number.isFinite(serviceId)) {
    return { date, free_slots: [], working_hours_count: 0, staff_id: null, service_id: null };
  }

  const startEnd = toAltegioDate(date);
  try {
    const [scheduleRaw, recordsRaw, servicesRaw] = await Promise.all([
      altegio.getSchedule(ctx.mcpRequestId, company_id, staffId, startEnd, startEnd),
      altegio.listAppointments(ctx.mcpRequestId, company_id, { start_date: date, end_date: date, page: 1, count: 500 }),
      altegio.listServices(ctx.mcpRequestId, company_id)
    ]);
    const workingSlots = parseScheduleToWorkingSlots(scheduleRaw, date);
    const appointments = parseAppointmentIntervalsForStaff(recordsRaw, staffId);
    const durationSec = getServiceDurationSeconds(servicesRaw, serviceId) ?? 3600;
    const starts = computeFreeSlotStarts(workingSlots, appointments, durationSec);
    const free_slots = starts.map((d) => d.toISOString());
    return {
      date,
      free_slots,
      working_hours_count: workingSlots.length,
      staff_id: staffId,
      service_id: serviceId
    };
  } catch (_) {
    return { date, free_slots: [], working_hours_count: 0, staff_id: staffId, service_id: serviceId };
  }
}
