import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  appointment_id: z.number(),
  new_start_at: z.string(), // ISO datetime
  comment: z.string().optional(),
  notify_client: z.boolean().default(true)
});

export async function handleRescheduleAppointment(ctx: ToolDispatchContext) {
  const payload = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  // Rescheduling is explicitly NOT delete-like and must not require approval
  const data = await altegio.rescheduleAppointment(ctx.mcpRequestId, payload);
  return { rescheduled: true, result: data };
}

