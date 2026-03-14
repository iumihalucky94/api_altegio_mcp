import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import {
  toAltegioDate,
  parseScheduleToWorkingSlots,
  parseAppointmentIntervalsForStaff,
  validateSlot as validateSlotLogic,
  getServiceDurationSeconds
} from '../../../altegio/slots';

const schema = z.object({
  company_id: z.number(),
  staff_id: z.number(),
  service_id: z.number(),
  date: z.string(), // YYYY-MM-DD
  start_time: z.string() // ISO datetime e.g. 2026-03-18T18:00:00+01:00
});

export async function handleValidateSlot(ctx: ToolDispatchContext) {
  const { company_id, staff_id, service_id, date, start_time } = validateOrThrow(schema, ctx.params);
  const startDate = new Date(start_time);
  if (isNaN(startDate.getTime())) {
    const err: any = new Error('Invalid start_time');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

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

  const result = validateSlotLogic(startDate, durationSec, workingSlots, appointments);
  if (result.ok) {
    return { ok: true, message: 'Slot is valid and free.' };
  }
  const err: any = new Error(result.reason);
  err.code = result.reason;
  err.meta = { reason: result.reason };
  throw err;
}
