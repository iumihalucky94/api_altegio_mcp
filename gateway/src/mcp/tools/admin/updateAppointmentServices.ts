import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  company_id: z.number(),
  appointment_id: z.number(),
  service_ids: z.array(z.number()).min(1),
  datetime: z.string().optional(),
  cost_per_service: z.array(z.number()).optional(),
  staff_id: z.number().optional(),
  client_phone: z.string().optional(),
  client_name: z.string().optional(),
  seance_length: z.number().optional()
});

export async function handleUpdateAppointmentServices(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const { company_id, appointment_id, service_ids, datetime, cost_per_service, staff_id, client_phone, client_name, seance_length } = params;
  const altegio = createAltegioClient(ctx.db, ctx.config);
  const services = (cost_per_service && Array.isArray(cost_per_service))
    ? service_ids.map((id, i) => ({ id, first_cost: cost_per_service[i] ?? 90, discount: 0, cost: cost_per_service[i] ?? 90 }))
    : service_ids.map((id) => ({ id, first_cost: 90, discount: 0, cost: 90 }));
  const body: any = { services };
  if (datetime) body.datetime = datetime;
  if (seance_length != null) body.seance_length = seance_length;
  if (staff_id != null) body.staff_id = staff_id;
  if (client_phone != null || client_name != null) {
    body.client = { phone: client_phone ?? '', name: client_name ?? '' };
  }
  const data = await altegio.updateRecord(ctx.mcpRequestId, company_id, appointment_id, body);
  return { updated: true, result: data };
}
