import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import { toAltegioDate, parseScheduleToWorkingSlots } from '../../../altegio/slots';

const schema = z.object({
  company_id: z.number(),
  staff_id: z.number(),
  date: z.string() // YYYY-MM-DD
});

export async function handleGetMasterWorkingHours(ctx: ToolDispatchContext) {
  const { company_id, staff_id, date } = validateOrThrow(schema, ctx.params);
  const startEnd = toAltegioDate(date);
  const altegio = createAltegioClient(ctx.db, ctx.config);
  const raw = await altegio.getSchedule(ctx.mcpRequestId, company_id, staff_id, startEnd, startEnd);
  const slots = parseScheduleToWorkingSlots(raw, date);
  const ranges = slots.map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString()
  }));
  return { staff_id, date, working_hours: ranges };
}
