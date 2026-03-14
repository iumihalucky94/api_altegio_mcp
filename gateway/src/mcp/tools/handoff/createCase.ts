import { z } from 'zod';
import { ToolDispatchContext } from '../../router';
import { validateOrThrow } from '../../../utils/validate';

const lastMessageSchema = z.object({
  ts: z.string(),
  from: z.enum(['client', 'agent']),
  text: z.string()
});

const schema = z.object({
  conversation_id: z.string(),
  client_phone: z.string(),
  client_name: z.string().nullable().optional(),
  language: z.enum(['ru', 'de', 'en', 'mixed']),
  last_messages: z.array(lastMessageSchema).optional(),
  summary: z.string(),
  question_to_admin: z.string(),
  related_audit_ids: z.array(z.string().uuid()).optional()
});

export async function handleCreateCase(ctx: ToolDispatchContext) {
  const payload = validateOrThrow(schema, ctx.params);
  const db = ctx.db;
  const res = await db.query(
    `INSERT INTO handoff_cases (conversation_id, client_phone, client_name, language, last_messages, summary, question_to_admin, related_audit_ids, admin_view, client_message_suggestion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id::text`,
    [
      payload.conversation_id,
      payload.client_phone,
      payload.client_name ?? null,
      payload.language,
      payload.last_messages ? JSON.stringify(payload.last_messages) : null,
      payload.summary,
      payload.question_to_admin,
      payload.related_audit_ids ?? [],
      `Handoff: ${payload.summary}\nQuestion: ${payload.question_to_admin}`,
      'Please contact the client to resolve.'
    ]
  );
  const caseId = res.rows[0].id;
  return {
    case_id: caseId,
    admin_view: `Handoff: ${payload.summary}\nQuestion: ${payload.question_to_admin}`,
    client_message_suggestion: 'Please contact the client to resolve.'
  };
}
