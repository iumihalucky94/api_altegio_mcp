import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';
import { createAltegioClient } from '../../../altegio/client';

// Pure read/compute operation: we reuse staff calculations endpoint and
// allow the agent to see aggregated results without mutating Altegio.

const schema = z.object({
  staff_id: z.number(),
  date_from: z.string(),
  date_to: z.string()
});

export async function handleComputeStaffSalary(ctx: ToolDispatchContext) {
  const params = validateOrThrow(schema, ctx.params);
  const altegio = createAltegioClient(ctx.db, ctx.config);

  const raw = await altegio.getStaffCalculations(ctx.mcpRequestId, {
    staff_id: params.staff_id,
    date_from: params.date_from,
    date_to: params.date_to,
    page: 1,
    per_page: 500
  });

  // We don't know exact Altegio schema; we therefore just return raw plus
  // a minimal synthetic total if recognizable fields exist.
  let total = 0;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const payout = (row as any).payout ?? (row as any).amount ?? 0;
      if (typeof payout === 'number') total += payout;
    }
  }

  return {
    staff_id: params.staff_id,
    period: { from: params.date_from, to: params.date_to },
    total,
    raw
  };
}

