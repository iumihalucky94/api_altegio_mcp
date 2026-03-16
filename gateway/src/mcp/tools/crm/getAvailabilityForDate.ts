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

  const staffIds: number[] = [];
  let serviceId: number | null = null;

  try {
    const [staffData, servicesData] = await Promise.all([
      altegio.listTeamMembers(ctx.mcpRequestId, company_id),
      altegio.listServices(ctx.mcpRequestId, company_id)
    ]);
    const staffList = Array.isArray(staffData) ? staffData : (staffData as any)?.data ?? [];
    const servicesList = Array.isArray(servicesData) ? servicesData : (servicesData as any)?.data ?? [];
    for (const s of staffList) {
      const sid = Number((s as any).id ?? s);
      if (Number.isFinite(sid)) staffIds.push(sid);
    }
    const firstService = servicesList[0];
    if (firstService != null) serviceId = Number((firstService as any).id ?? firstService);
  } catch (_) {}

  let fallbackStaffId: number | null = null;
  if (staffIds.length === 0 || serviceId == null) {
    const defaultStaff = await getConfig<number | string>('DEFAULT_STAFF_ID');
    const defaultService = await getConfig<number | string>('DEFAULT_SERVICE_ID');
    const dStaff = defaultStaff != null && defaultStaff !== '' ? Number(defaultStaff) : NaN;
    const dService = defaultService != null && defaultService !== '' ? Number(defaultService) : NaN;
    if (staffIds.length === 0 && Number.isFinite(dStaff)) fallbackStaffId = dStaff;
    if ((serviceId == null || !Number.isFinite(serviceId)) && Number.isFinite(dService)) serviceId = dService;
  }

  if ((staffIds.length === 0 && fallbackStaffId == null) || serviceId == null || !Number.isFinite(serviceId)) {
    return { date, free_slots: [], working_hours_count: 0, staff_id: null, service_id: null };
  }

  const startEnd = toAltegioDate(date);
  const targetStaffIds = staffIds.length > 0 ? staffIds : [fallbackStaffId!];

  try {
    const [recordsRaw, servicesRaw] = await Promise.all([
      altegio.listAppointments(ctx.mcpRequestId, company_id, { start_date: date, end_date: date, page: 1, count: 500 }),
      altegio.listServices(ctx.mcpRequestId, company_id)
    ]);

    const durationSec = getServiceDurationSeconds(servicesRaw, serviceId) ?? 3600;
    const allWorkingSlots: any[] = [];
    const allFreeSlots: string[] = [];

    for (const sid of targetStaffIds) {
      if (!Number.isFinite(sid)) continue;
      const scheduleRaw = await altegio.getSchedule(ctx.mcpRequestId, company_id, sid, startEnd, startEnd);
      const workingSlots = parseScheduleToWorkingSlots(scheduleRaw, date);
      const appointments = parseAppointmentIntervalsForStaff(recordsRaw, sid);
      const starts = computeFreeSlotStarts(workingSlots, appointments, durationSec);
      allWorkingSlots.push(...workingSlots);
      allFreeSlots.push(...starts.map((d) => d.toISOString()));
    }

    return {
      date,
      free_slots: allFreeSlots,
      working_hours_count: allWorkingSlots.length,
      staff_id: targetStaffIds[0] ?? null,
      service_id: serviceId
    };
  } catch (_) {
    return {
      date,
      free_slots: [],
      working_hours_count: 0,
      staff_id: targetStaffIds[0] ?? null,
      service_id: serviceId
    };
  }
}
