import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  client_id: z.number().optional(),
  staff_id: z.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

export async function handleSearchAppointments(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const data = await altegio.searchAppointments(ctx.mcpRequestId, params);
  return { appointments: data };
}

