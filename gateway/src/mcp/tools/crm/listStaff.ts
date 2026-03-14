import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  company_id: z.number()
});

export async function handleListStaff(ctx: ToolDispatchContext) {
  const { company_id } = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const data = await altegio.listTeamMembers(ctx.mcpRequestId, company_id);
  return { staff: data };
}

