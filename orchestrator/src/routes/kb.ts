import type { FastifyInstance } from 'fastify';
import { getKbContext } from '../services/kb';
import { logAudit } from '../services/audit';

function getInternalToken(request: any): string | undefined {
  const hdr = (request.headers['x-internal-token'] as string) || undefined;
  const auth = (request.headers['authorization'] as string) || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return hdr || bearer || undefined;
}

export async function registerKbRoutes(app: FastifyInstance) {
  const db = (app as any).db;

  function ensureAuth(request: any, reply: any): string | null {
    const token = getInternalToken(request);
    const expected = (app as any).kbInternalToken as string | undefined;
    if (expected && token !== expected) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }
    return token ?? null;
  }

  (app as any).kbInternalToken = async () =>
    (await (app as any).getConfigString?.('KB_INTERNAL_TOKEN', '')) ||
    (await (app as any).getConfigString?.('MCP_INTERNAL_TOKEN', '')) ||
    '';

  // GET /kb/context
  app.get('/kb/context', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const intent = (request.query as any)?.intent || 'UNKNOWN';
    const language = (request.query as any)?.lang || 'de';
    const phone = (request.query as any)?.phone || null;

    const templatesLimit = Number(
      (await (app as any).getConfigNumber?.('KB_CONTEXT_LIMIT_TEMPLATES', 3)) || 3
    );
    const goodLimit = Number(
      (await (app as any).getConfigNumber?.('KB_CONTEXT_LIMIT_GOOD_EXAMPLES', 3)) || 3
    );
    const badLimit = Number(
      (await (app as any).getConfigNumber?.('KB_CONTEXT_LIMIT_BAD_EXAMPLES', 1)) || 1
    );

    const context = await getKbContext(db, {
      intent,
      language,
      phone,
      messageText: (request.query as any)?.q || '',
      limits: {
        templates: templatesLimit,
        goodExamples: goodLimit,
        badExamples: badLimit
      }
    });
    return reply.send(context);
  });

  // Helper to get updated_by from header
  function getUpdatedBy(request: any): string {
    return (
      (request.headers['x-updated-by'] as string) ||
      (request.headers['x-admin-user'] as string) ||
      'admin'
    );
  }

  // Simple CRUD: policies
  app.post('/kb/policies', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `INSERT INTO agent_policies (key, scope, phone, value_json, priority, is_enabled, description, updated_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),$7,$8)
       ON CONFLICT DO UPDATE SET
         value_json = EXCLUDED.value_json,
         priority = EXCLUDED.priority,
         is_enabled = EXCLUDED.is_enabled,
         description = EXCLUDED.description,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING key, scope, phone, value_json, priority, is_enabled, description, updated_at, updated_by`,
      [
        body.key,
        body.scope || 'global',
        body.phone || null,
        body.value_json,
        body.priority ?? 100,
        body.is_enabled,
        body.description || null,
        updatedBy
      ]
    );
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.policies',
      action: 'kb.policy.create',
      entity_table: 'agent_policies',
      entity_id: row.key,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.patch('/kb/policies', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_policies
       SET
         value_json = COALESCE($4, value_json),
         priority = COALESCE($5, priority),
         is_enabled = COALESCE($6, is_enabled),
         description = COALESCE($7, description),
         updated_at = now(),
         updated_by = $8
       WHERE key = $1 AND scope = COALESCE($2, scope) AND (phone = COALESCE($3, phone) OR (phone IS NULL AND $3 IS NULL))
       RETURNING key, scope, phone, value_json, priority, is_enabled, description, updated_at, updated_by`,
      [
        body.key,
        body.scope || null,
        body.phone || null,
        body.value_json ?? null,
        body.priority ?? null,
        body.is_enabled ?? null,
        body.description ?? null,
        updatedBy
      ]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Policy not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.policies',
      action: 'kb.policy.update',
      entity_table: 'agent_policies',
      entity_id: row.key,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.delete('/kb/policies', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_policies
       SET is_enabled = FALSE, updated_at = now(), updated_by = $4
       WHERE key = $1 AND scope = COALESCE($2, scope) AND (phone = COALESCE($3, phone) OR (phone IS NULL AND $3 IS NULL))
       RETURNING key, scope, phone, value_json, priority, is_enabled, description, updated_at, updated_by`,
      [body.key, body.scope || null, body.phone || null, updatedBy]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Policy not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.policies',
      action: 'kb.policy.disable',
      entity_table: 'agent_policies',
      entity_id: row.key,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  // Templates
  app.post('/kb/templates', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `INSERT INTO agent_templates (name, intent, language, body, tags, is_enabled, weight, updated_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),COALESCE($7,1.0),$8)
       RETURNING *`,
      [
        body.name,
        body.intent,
        body.language,
        body.body,
        body.tags || null,
        body.is_enabled,
        body.weight,
        updatedBy
      ]
    );
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.templates',
      action: 'kb.template.create',
      entity_table: 'agent_templates',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.patch('/kb/templates/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_templates
       SET
         name = COALESCE($2, name),
         intent = COALESCE($3, intent),
         language = COALESCE($4, language),
         body = COALESCE($5, body),
         tags = COALESCE($6, tags),
         is_enabled = COALESCE($7, is_enabled),
         weight = COALESCE($8, weight),
         updated_at = now(),
         updated_by = $9
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.name ?? null,
        body.intent ?? null,
        body.language ?? null,
        body.body ?? null,
        body.tags ?? null,
        body.is_enabled ?? null,
        body.weight ?? null,
        updatedBy
      ]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Template not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.templates',
      action: 'kb.template.update',
      entity_table: 'agent_templates',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.delete('/kb/templates/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_templates
       SET is_enabled = FALSE, updated_at = now(), updated_by = $2
       WHERE id = $1
       RETURNING *`,
      [id, updatedBy]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Template not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.templates',
      action: 'kb.template.disable',
      entity_table: 'agent_templates',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  // Examples
  app.post('/kb/examples', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `INSERT INTO agent_examples (intent, language, label, client_text, agent_text, explanation, tags, weight, is_enabled, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,1.0),COALESCE($9,TRUE),$10)
       RETURNING *`,
      [
        body.intent,
        body.language,
        body.label,
        body.client_text,
        body.agent_text,
        body.explanation || null,
        body.tags || null,
        body.weight,
        body.is_enabled,
        updatedBy
      ]
    );
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.examples',
      action: 'kb.example.create',
      entity_table: 'agent_examples',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.patch('/kb/examples/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_examples
       SET
         intent = COALESCE($2, intent),
         language = COALESCE($3, language),
         label = COALESCE($4, label),
         client_text = COALESCE($5, client_text),
         agent_text = COALESCE($6, agent_text),
         explanation = COALESCE($7, explanation),
         tags = COALESCE($8, tags),
         weight = COALESCE($9, weight),
         is_enabled = COALESCE($10, is_enabled),
         updated_at = now(),
         updated_by = $11
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.intent ?? null,
        body.language ?? null,
        body.label ?? null,
        body.client_text ?? null,
        body.agent_text ?? null,
        body.explanation ?? null,
        body.tags ?? null,
        body.weight ?? null,
        body.is_enabled ?? null,
        updatedBy
      ]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Example not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.examples',
      action: 'kb.example.update',
      entity_table: 'agent_examples',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.delete('/kb/examples/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_examples
       SET is_enabled = FALSE, updated_at = now(), updated_by = $2
       WHERE id = $1
       RETURNING *`,
      [id, updatedBy]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Example not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.examples',
      action: 'kb.example.disable',
      entity_table: 'agent_examples',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  // Playbooks
  app.post('/kb/playbooks', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `INSERT INTO agent_playbooks (scenario_key, language, instruction, priority, is_enabled, tags, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,100),COALESCE($5,TRUE),$6,$7)
       ON CONFLICT (scenario_key) DO UPDATE SET
         language = EXCLUDED.language,
         instruction = EXCLUDED.instruction,
         priority = EXCLUDED.priority,
         is_enabled = EXCLUDED.is_enabled,
         tags = EXCLUDED.tags,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [
        body.scenario_key,
        body.language || 'de',
        body.instruction,
        body.priority,
        body.is_enabled,
        body.tags || null,
        updatedBy
      ]
    );
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.playbooks',
      action: 'kb.playbook.create',
      entity_table: 'agent_playbooks',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.patch('/kb/playbooks/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const body = request.body as any;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_playbooks
       SET
         scenario_key = COALESCE($2, scenario_key),
         language = COALESCE($3, language),
         instruction = COALESCE($4, instruction),
         priority = COALESCE($5, priority),
         is_enabled = COALESCE($6, is_enabled),
         tags = COALESCE($7, tags),
         updated_at = now(),
         updated_by = $8
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.scenario_key ?? null,
        body.language ?? null,
        body.instruction ?? null,
        body.priority ?? null,
        body.is_enabled ?? null,
        body.tags ?? null,
        updatedBy
      ]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Playbook not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.playbooks',
      action: 'kb.playbook.update',
      entity_table: 'agent_playbooks',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });

  app.delete('/kb/playbooks/:id', async (request, reply) => {
    const ok = ensureAuth(request, reply);
    if (ok === null) return;
    const id = (request.params as any)?.id;
    const updatedBy = getUpdatedBy(request);
    const res = await db.query(
      `UPDATE agent_playbooks
       SET is_enabled = FALSE, updated_at = now(), updated_by = $2
       WHERE id = $1
       RETURNING *`,
      [id, updatedBy]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Playbook not found' });
    const row = res.rows[0];
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: updatedBy },
      source: 'kb.playbooks',
      action: 'kb.playbook.disable',
      entity_table: 'agent_playbooks',
      entity_id: row.id,
      before: null,
      after: row,
      correlation_id: (request as any).correlationId,
      request_id: (request as any).requestId
    });
    return reply.send(row);
  });
}

