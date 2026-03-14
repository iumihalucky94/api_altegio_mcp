import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateOrThrow } from '../utils/validate';
import { createMcpRequest, completeMcpRequestSuccess, completeMcpRequestError } from '../audit/writeMcpRequest';
import { dispatchTool } from '../mcp/router';
import { buildEnvelope } from '../mcp/envelope';
import { decisionFromResult, decisionFromError } from '../mcp/decision';
import { mcpError, isAllowedErrorCode } from '../mcp/errors';
import { getConfig } from '../config/resolver';
import { checkAgentRateLimit } from '../rateLimit/agentRateLimit';

const legacySchema = z.object({
  tool: z.string(),
  params: z.record(z.any()).default({}),
  idempotencyKey: z.string().optional(),
  approvalId: z.string().optional()
});

const envelopeSchema = z.object({
  request_id: z.string(),
  actor: z.object({ agent_id: z.string(), role: z.string() }),
  company_id: z.number(),
  tool: z.string(),
  intent: z.string().optional(),
  dry_run: z.boolean().optional(),
  payload: z.record(z.any()).default({}),
  conversation_id: z.string().optional(),
  client_phone: z.string().optional(),
  locale: z.string().optional()
});

function isEnvelope(body: any): body is z.infer<typeof envelopeSchema> {
  return body && typeof body.request_id === 'string' && body.actor && body.company_id != null && body.payload !== undefined;
}

export function registerMcpRoutes(app: FastifyInstance) {
  app.post('/mcp', async (request, reply) => {
    const startedAt = Date.now();
    const db = (app as any).db;
    const config = (app as any).config;
    const body = request.body as any;
    let tool: string;
    let params: any;
    let requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let companyId: number | undefined;
    let actor: any = { agent_id: 'legacy', role: 'agent' };
    let idempotencyKey: string | undefined;
    let approvalId: string | undefined;

    if (isEnvelope(body)) {
      const parsed = envelopeSchema.parse(body);
      requestId = parsed.request_id;
      tool = parsed.tool;
      params = parsed.payload;
      companyId = parsed.company_id;
      actor = parsed.actor;
      idempotencyKey = params.idempotency_key ?? params.idempotencyKey;
      approvalId = params.approval_id ?? params.approvalId;
    } else {
      const parsed = validateOrThrow(legacySchema, body);
      tool = parsed.tool;
      params = parsed.params;
      companyId = params.company_id;
      idempotencyKey = parsed.idempotencyKey;
      approvalId = parsed.approvalId;
    }

    let mcpRowId: string | undefined;
    const envelopeOpts = { request_id: requestId, company_id: companyId, actor };

    const corrSource =
      (await getConfig<string>('logging.correlation_id_source')) ?? 'request_id';
    const correlationId =
      requestId && corrSource === 'request_id'
        ? requestId
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const baseLogger = app.log.child({
      request_id: correlationId,
      agent_id: actor?.agent_id ?? null,
      tool: undefined
    });

    try {
      const created = await createMcpRequest(
        db,
        tool,
        isEnvelope(body) ? body : { tool, params, idempotencyKey, approvalId },
        idempotencyKey,
        envelopeOpts
      );
      mcpRowId = created.id;

      const reqLogger = baseLogger.child({ audit_id: mcpRowId, tool });

      const rate = await checkAgentRateLimit({
        agentId: actor?.agent_id ?? 'anonymous',
        tool,
        requestId: correlationId,
        logger: reqLogger
      });

      if (!rate.allowed) {
        const retryAfterDefault =
          (await getConfig<number>('ratelimit.retry_after_seconds')) ?? 10;
        const retryAfter = rate.retryAfterSeconds ?? retryAfterDefault;

        reqLogger.warn(
          {
            request_id: correlationId,
            audit_id: mcpRowId,
            agent_id: actor?.agent_id ?? null,
            tool,
            retry_after_seconds: retryAfter
          },
          'Rate limit exceeded'
        );

        const errorBody = mcpError('RATE_LIMIT', 'Rate limit exceeded', {
          retry_after_seconds: retryAfter
        });

        await completeMcpRequestError(
          db,
          mcpRowId,
          Object.assign(new Error('Rate limit exceeded'), { code: 'RATE_LIMIT' } as any),
          startedAt,
          'DENY'
        );
        await db.query(
          'UPDATE mcp_requests SET response_body = $1 WHERE id = $2::uuid',
          [{ error: errorBody, decision: 'DENY' }, mcpRowId]
        );

        reply.header('Retry-After', String(retryAfter));
        const response = buildEnvelope(correlationId, mcpRowId, 'DENY', {}, {
          error: errorBody,
          next_steps: []
        });
        return reply.status(429).send(response);
      }

      const gatewayTimeout =
        (await getConfig<number>('timeouts.gateway_request_ms')) ?? 15000;
      const opBudget =
        (await getConfig<number>('timeouts.operation_budget_ms')) ?? 20000;
      const timeoutMs = Math.min(gatewayTimeout, opBudget);
      const timeoutDecision =
        (await getConfig<string>('timeouts.on_timeout_decision')) ?? 'NEED_HUMAN';

      const operationPromise = (async () => {
        const result = await dispatchTool({
          tool,
          params,
          idempotencyKey,
          approvalId,
          companyId,
          db,
          config,
          logger: reqLogger,
          mcpRequestId: mcpRowId!
        });

        const { decision, next_steps } = decisionFromResult(result, tool);
        await completeMcpRequestSuccess(db, mcpRowId!, result, startedAt, decision);

        const response = buildEnvelope(correlationId, mcpRowId!, decision, result, {
          next_steps
        });
        return response;
      })();

      let response;
      if (timeoutMs > 0) {
        response = await Promise.race([
          operationPromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              const elapsed = Date.now() - startedAt;
              const err: any = new Error('Operation timeout');
              err.code = 'INTERNAL_ERROR';
              err.__timeout = true;
              err.__timeout_decision = timeoutDecision;
              err.__elapsed_ms = elapsed;
              reject(err);
            }, timeoutMs);
          })
        ]);
      } else {
        response = await operationPromise;
      }

      return reply.send(response);
    } catch (err: any) {
      const isTimeout = err && err.__timeout;
      const logger = mcpRowId
        ? baseLogger.child({ audit_id: mcpRowId, tool })
        : baseLogger.child({ tool });

      if (isTimeout) {
        const elapsedMs = err.__elapsed_ms ?? Date.now() - startedAt;
        logger.error(
          {
            request_id: correlationId,
            audit_id: mcpRowId,
            agent_id: actor?.agent_id ?? null,
            tool,
            elapsed_ms: elapsedMs
          },
          'Operation timeout'
        );
      } else {
        logger.error({ err }, 'MCP tool execution failed');
      }

      let decision: any;
      let code: any;
      if (isTimeout) {
        decision = err.__timeout_decision || 'NEED_HUMAN';
        code = 'INTERNAL_ERROR';
      } else {
        const d = decisionFromError(err);
        decision = d.decision;
        code = d.code;
      }

      const errorBody = mcpError(
        isAllowedErrorCode(code) ? code : 'INTERNAL_ERROR',
        isTimeout ? 'Operation timeout' : err?.message || 'Internal error',
        err?.details
      );
      if (mcpRowId) {
        await completeMcpRequestError(db, mcpRowId, err, startedAt, decision);
        await db.query(
          'UPDATE mcp_requests SET response_body = $1 WHERE id = $2::uuid',
          [{ error: errorBody, decision }, mcpRowId]
        );
      }

      const response = buildEnvelope(
        correlationId,
        mcpRowId ?? '00000000-0000-0000-0000-000000000000',
        decision,
        {},
        { error: errorBody, next_steps: decision === 'NEED_HUMAN' ? [{ type: 'HANDOFF' }] : [] }
      );
      const statusCode = code === 'VALIDATION_ERROR' ? 400 : 500;
      return reply.status(statusCode).send(response);
    }
  });
}
