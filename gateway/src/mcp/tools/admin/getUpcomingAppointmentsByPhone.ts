import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

const schema = z.object({
  phone: z.string(),
  from_date: z.string().optional(),
  limit: z.number().min(1).max(20).default(5)
});

export async function handleGetUpcomingAppointmentsByPhone(ctx: ToolDispatchContext) {
  const { phone, from_date, limit } = validateOrThrow(schema, ctx.params);
  const company_id = ctx.companyId ?? ctx.params.company_id;
  if (company_id == null) {
    const err: any = new Error('company_id required (envelope or payload)');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const altegio = createAltegioClient(ctx.db, ctx.config);
  const searchBody = {
    page: 1,
    page_size: 20,
    operation: 'AND' as const,
    filters: [{ type: 'quick_search' as const, state: { value: phone } }]
  };
  const clientsRes = await altegio.searchClients(ctx.mcpRequestId, company_id, searchBody);
  const data = clientsRes?.data ?? clientsRes;
  const list = Array.isArray(data) ? data : data?.data ?? [];
  const clients = Array.isArray(list) ? list : [];
  if (clients.length > 1) {
    const err: any = new Error('Multiple clients found for this phone');
    err.code = 'MULTIPLE_CLIENTS_FOUND';
    err.decision = 'NEED_HUMAN';
    throw err;
  }
  if (clients.length === 0) {
    const err: any = new Error('Client not found');
    err.code = 'CLIENT_NOT_FOUND';
    throw err;
  }
  const client = clients[0];
  const clientId = client?.id ?? client?.data?.id;
  if (!clientId) {
    const err: any = new Error('Client not found');
    err.code = 'CLIENT_NOT_FOUND';
    throw err;
  }
  const from = from_date ?? new Date().toISOString().slice(0, 10);
  const filters: Record<string, any> = {
    start_date: from,
    page: 1,
    count: limit
  };
  const recordsRes = await altegio.listAppointments(ctx.mcpRequestId, company_id, { ...filters, client_id: clientId });
  const recordsData = recordsRes?.data ?? recordsRes;
  const recordsList = Array.isArray(recordsData) ? recordsData : recordsData?.data ?? [];
  const appointments = Array.isArray(recordsList) ? recordsList : [];
  return { appointments };
}
