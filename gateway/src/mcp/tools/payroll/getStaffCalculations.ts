import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  staff_id: z.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  per_page: z.coerce.number().min(1).max(100).default(50)
});

export async function handleGetStaffCalculations(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const data = await altegio.getStaffCalculations(ctx.mcpRequestId, params);
  return { calculations: data };
}

