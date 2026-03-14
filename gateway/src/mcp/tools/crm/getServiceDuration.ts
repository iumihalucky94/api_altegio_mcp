import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';
import { getServiceDurationSeconds } from '../../../altegio/slots';

const schema = z.object({
  company_id: z.number(),
  service_id: z.number()
});

export async function handleGetServiceDuration(ctx: ToolDispatchContext) {
  const { company_id, service_id } = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);
  const data = await altegio.listServices(ctx.mcpRequestId, company_id);
  const seconds = getServiceDurationSeconds(data, service_id);
  if (seconds == null) {
    const err: any = new Error('Service not found');
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }
  return { service_id, duration_seconds: seconds, duration_minutes: Math.round(seconds / 60) };
}
