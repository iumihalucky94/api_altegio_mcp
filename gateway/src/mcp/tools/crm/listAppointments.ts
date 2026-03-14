import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  company_id: z.number(),
  date: z.string() // YYYY-MM-DD
});

export async function handleListAppointments(ctx: ToolDispatchContext) {
  const { company_id, date } = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const filters = {
    start_date: date,
    end_date: date,
    page: 1,
    count: 200
  };

  const data = await altegio.listAppointments(ctx.mcpRequestId, company_id, filters);
  return { appointments: data };
}

