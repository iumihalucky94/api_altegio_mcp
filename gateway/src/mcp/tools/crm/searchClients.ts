import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  company_id: z.number(),
  quick_search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  page_size: z.coerce.number().min(1).max(200).default(25)
});

export async function handleSearchClients(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const body: any = {
    page: params.page,
    page_size: params.page_size
  };

  if (params.quick_search) {
    body.operation = 'AND';
    body.filters = [
      {
        type: 'quick_search',
        state: { value: params.quick_search }
      }
    ];
  }

  const data = await altegio.searchClients(ctx.mcpRequestId, params.company_id, body);
  return { clients: data };
}

