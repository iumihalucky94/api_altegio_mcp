import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listPolicies, upsertApprovalPolicy } from '../policy/engine';
import { createMcpRequest, completeMcpRequestSuccess } from '../audit/writeMcpRequest';
import { validateOrThrow } from '../utils/validate';

const setPolicySchema = z.object({
  action_key: z.string(),
  require_approval: z.boolean(),
  allowed_roles: z.array(z.string()).optional()
});

export function registerAdminPolicyRoutes(app: FastifyInstance) {
  app.get('/admin/policies', async (request, reply) => {
    const db = (app as any).db;
    const config = (app as any).config;
    const adminKey = request.headers['x-admin-approve-key'] as string | undefined;

    if (!adminKey || adminKey !== config.ADMIN_APPROVE_KEY) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid admin key' });
    }

    const rows = await listPolicies(db);
    return reply.send({ ok: true, policies: rows });
  });

  app.post('/admin/policies/set', async (request, reply) => {
    const db = (app as any).db;
    const config = (app as any).config;
    const adminKey = request.headers['x-admin-approve-key'] as string | undefined;

    if (!adminKey || adminKey !== config.ADMIN_APPROVE_KEY) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid admin key' });
    }

    const startedAt = Date.now();
    const body = validateOrThrow(setPolicySchema, request.body);

    const mcpRow = await createMcpRequest(
      db,
      'admin.policy.set',
      { body },
      undefined
    );

    await upsertApprovalPolicy(
      db,
      body.action_key,
      body.require_approval,
      body.allowed_roles,
      'admin'
    );

    const result = { ok: true };
    await completeMcpRequestSuccess(db, mcpRow.id, result, startedAt);

    return reply.send(result);
  });
}


