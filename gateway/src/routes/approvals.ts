import { FastifyInstance } from 'fastify';
import { markApprovalStatus, getApproval } from '../approvals/service';

export function registerApprovalRoutes(app: FastifyInstance) {
  app.post('/approvals/:id/approve', async (request, reply) => {
    const db = (app as any).db;
    const config = (app as any).config;
    const id = (request.params as any).id as string;
    const adminKey = request.headers['x-admin-approve-key'] as string | undefined;

    if (!adminKey || adminKey !== config.ADMIN_APPROVE_KEY) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid admin key' });
    }

    const approval = await getApproval(db, id);
    if (!approval) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Approval not found' });
    }
    if (approval.status === 'APPROVED') {
      return reply.send({ ok: true, approval });
    }

    await markApprovalStatus(db, id, 'APPROVED', 'admin');
    const updated = await getApproval(db, id);
    return reply.send({ ok: true, approval: updated });
  });
}


