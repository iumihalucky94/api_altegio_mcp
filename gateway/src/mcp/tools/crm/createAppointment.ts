import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import {
  toAltegioDate,
  parseScheduleToWorkingSlots,
  parseAppointmentIntervalsForStaff,
  validateSlot,
  getServiceDurationSeconds
} from '../../../altegio/slots';

const schema = z.object({
  company_id: z.number(),
  staff_id: z.number(),
  service_id: z.number(),
  cost: z.number(),
  datetime: z.string(), // ISO with offset, e.g. 2026-03-20T15:00:00+01:00
  seance_length: z.number().default(3600),
  client_phone: z.string(),
  client_name: z.string().default(''),
  client_email: z.string().optional(),
  comment: z.string().optional()
});

export async function handleCreateAppointment(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const startDate = new Date(params.datetime);
  if (isNaN(startDate.getTime())) {
    const err: any = new Error('Invalid datetime');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const dateYmd = params.datetime.slice(0, 10);
  const startEnd = toAltegioDate(dateYmd);
  const durationSec = params.seance_length;

  const [scheduleRaw, recordsRaw, servicesRaw] = await Promise.all([
    altegio.getSchedule(ctx.mcpRequestId, params.company_id, params.staff_id, startEnd, startEnd),
    altegio.listAppointments(ctx.mcpRequestId, params.company_id, {
      start_date: dateYmd,
      end_date: dateYmd,
      page: 1,
      count: 500
    }),
    altegio.listServices(ctx.mcpRequestId, params.company_id)
  ]);

  const workingSlots = parseScheduleToWorkingSlots(scheduleRaw, dateYmd);
  const serviceDuration = getServiceDurationSeconds(servicesRaw, params.service_id);
  const durationToUse = Number(serviceDuration ?? params.seance_length ?? 3600);
  const appointments = parseAppointmentIntervalsForStaff(recordsRaw, params.staff_id);

  const validation = validateSlot(startDate, durationToUse, workingSlots, appointments);
  if (!validation.ok) {
    const err: any = new Error(
      validation.reason === 'REQUESTED_TIME_OUTSIDE_MASTER_SCHEDULE'
        ? 'The selected time is outside the master working hours. Please choose a time within the schedule.'
        : 'The selected time is not available. Please choose a different time.'
    );
    err.code = 'SLOT_VALIDATION_FAILED';
    err.meta = { reason: validation.reason, conflict: true };
    throw err;
  }

  const body = {
    staff_id: params.staff_id,
    services: [
      {
        id: params.service_id,
        first_cost: params.cost,
        discount: 0,
        cost: params.cost
      }
    ],
    client: {
      phone: params.client_phone,
      name: params.client_name,
      email: params.client_email ?? ''
    },
    save_if_busy: false,
    datetime: params.datetime,
    seance_length: params.seance_length,
    send_sms: true,
    comment: params.comment ?? '',
    sms_remain_hours: 2,
    email_remain_hours: 0,
    attendance: 0
  };

  try {
    const data = await altegio.createAppointment(ctx.mcpRequestId, params.company_id, body);
    return { created: true, appointment: data };
  } catch (e: any) {
    const msg = e?.message ?? '';
    const res = e?.response;
    const status = res?.status ?? (msg.includes('409') ? 409 : 0);
    const meta = res?.meta ?? res;
    const conflictMsg = meta?.message ?? 'The selected time is not available. Please choose a different time.';
    if (status === 409 || (meta && meta.conflict) || msg.includes('409')) {
      const err: any = new Error(conflictMsg);
      err.code = 'Altegio HTTP 409';
      err.response = { success: false, data: null, meta: { message: conflictMsg, conflict: true } };
      throw err;
    }
    throw e;
  }
}

