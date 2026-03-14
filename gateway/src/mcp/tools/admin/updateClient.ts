import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  company_id: z.number(),
  client_id: z.number(),
  name: z.string().optional(),
  surname: z.string().optional(),
  phone: z.string()
});

export async function handleUpdateClient(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);
  const body: any = { phone: params.phone };
  if (params.name !== undefined) body.name = params.name;
  if (params.surname !== undefined) body.surname = params.surname;
  const data = await altegio.updateClient(ctx.mcpRequestId, params.company_id, params.client_id, body);
  return { updated: true, result: data };
}
