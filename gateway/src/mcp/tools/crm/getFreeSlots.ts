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

const schema = z.object({
  company_id: z.number(),
  staff_id: z.number(),
  service_id: z.number(),
  date: z.string() // YYYY-MM-DD
});

export async function handleGetFreeSlots(ctx: ToolDispatchContext) {
  const { company_id, staff_id, service_id, date } = validateOrThrow(schema, ctx.params);
  const startEnd = toAltegioDate(date);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const [scheduleRaw, recordsRaw, servicesRaw] = await Promise.all([
    altegio.getSchedule(ctx.mcpRequestId, company_id, staff_id, startEnd, startEnd),
    altegio.listAppointments(ctx.mcpRequestId, company_id, { start_date: date, end_date: date, page: 1, count: 500 }),
    altegio.listServices(ctx.mcpRequestId, company_id)
  ]);

  const workingSlots = parseScheduleToWorkingSlots(scheduleRaw, date);
  const appointments = parseAppointmentIntervalsForStaff(recordsRaw, staff_id);
  const durationSec = getServiceDurationSeconds(servicesRaw, service_id) ?? 3600;

  const starts = computeFreeSlotStarts(workingSlots, appointments, durationSec);
  const start_times = starts.map((d) => d.toISOString());

  return { staff_id, service_id, date, duration_seconds: durationSec, free_slots: start_times };
}
