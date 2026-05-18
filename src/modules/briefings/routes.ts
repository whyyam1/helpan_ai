/**
 * /v1/briefings routes.
 *
 *   POST   /briefings                — createBriefing
 *   GET    /briefings                — listBriefings
 *   GET    /briefings/:briefing_id   — getBriefing
 *   PATCH  /briefings/:briefing_id   — updateBriefing
 *   DELETE /briefings/:briefing_id   — revokeBriefing (soft delete; audit-logged)
 *
 * The plugin chain ahead of these handlers (registered in src/app.ts):
 *
 *   requestId → errorMapper → db → shared HMAC auth (skips /v1/briefings)
 *     → customer-JWT plugin → shared idempotency → routes
 *
 * Every handler runs its DB work inside `app.withCustomerContext(...)`, so
 * RLS GUCs are set before any query and the audit chain is appended in the
 * same transaction. On a thrown error the transaction rolls back — the
 * audit row and the briefing row commit together or not at all.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@kmv/platform-shared/envelope';
import {
  briefingListResponseSchema,
  briefingResponseSchema,
  createBriefingRequestSchema,
  listBriefingsQuerySchema,
  updateBriefingRequestSchema,
  type BriefingStatus,
  type BriefingType,
} from './schemas.js';
import {
  createBriefing,
  listBriefingsForCustomer,
  patchBriefing,
  readBriefing,
  revokeBriefing,
  type AuditContext,
} from './service.js';

interface CreateBriefingBody {
  account_uuid: string;
  app_id: string;
  agent_id?: string;
  briefing_type: BriefingType;
  intent: Record<string, unknown>;
  expires_at?: string | null;
  app_correlation_id?: string;
}

interface UpdateBriefingBody {
  status?: BriefingStatus;
  intent?: Record<string, unknown>;
  expires_at?: string | null;
}

interface ListBriefingsQuery {
  app_id?: string;
  status?: BriefingStatus;
  cursor?: string;
  /** Numeric string at the wire layer — `^[1-9][0-9]{0,2}$`, parsed below. */
  limit?: string;
}

interface BriefingIdParams {
  briefing_id: string;
}

const BRIEFING_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['briefing_id'],
  additionalProperties: false,
  properties: {
    briefing_id: { type: 'string', pattern: '^brf_[0-9A-HJKMNP-TV-Z]{26}$' },
  },
} as const;

function railError(code: string, statusCode: number, message: string, field?: string): Error {
  const err = new Error(message) as Error & {
    code: string;
    statusCode: number;
    field?: string;
  };
  err.code = code;
  err.statusCode = statusCode;
  if (field !== undefined) err.field = field;
  return err;
}

function notFound(reply: FastifyReply, requestId: string): FastifyReply {
  return reply.code(404).send({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Briefing not found' },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
      schema_version: '1.0',
    },
  });
}

function buildAuditContext(request: FastifyRequest): AuditContext {
  // customerJwtPlugin populates customerJwt + appId before routes run; if
  // either is missing, the auth chain didn't fire — treat as an internal
  // error so it surfaces loudly in tests rather than silently mis-attributing.
  const claims = request.customerJwt;
  const appId = request.appId;
  if (!claims || !appId) {
    throw new Error('briefings handler reached without customerJwt/appId — plugin chain misconfigured');
  }
  const traceparent = request.headers['traceparent'];
  return {
    accountUuid: claims.sub,
    appId,
    requestId: request.requestId,
    ...(typeof traceparent === 'string' ? { traceparent } : {}),
  };
}

export const briefingsRoutes: FastifyPluginAsync = async (fastify) => {
  // --------------------------------------------------------------------------
  // POST /briefings
  // --------------------------------------------------------------------------
  fastify.post<{ Body: CreateBriefingBody }>(
    '/briefings',
    {
      schema: {
        body: createBriefingRequestSchema,
        response: { 201: briefingResponseSchema },
      },
    },
    async (request, reply) => {
      const claims = request.customerJwt!;
      const body = request.body;

      if (body.account_uuid !== claims.sub) {
        throw railError(
          'AUTH_ACCOUNT_MISMATCH',
          403,
          'Body account_uuid does not match the authenticated customer',
          'account_uuid'
        );
      }

      const audit = buildAuditContext(request);
      const dto = await fastify.withCustomerContext(request, (tx) =>
        createBriefing(tx, audit, {
          accountUuid: body.account_uuid,
          appId: body.app_id,
          briefingType: body.briefing_type,
          intent: body.intent,
          ...(body.agent_id !== undefined ? { agentId: body.agent_id } : {}),
          ...(body.expires_at !== undefined && body.expires_at !== null
            ? { expiresAt: new Date(body.expires_at) }
            : body.expires_at === null
            ? { expiresAt: null }
            : {}),
          ...(body.app_correlation_id !== undefined
            ? { appCorrelationId: body.app_correlation_id }
            : {}),
        })
      );
      return reply.code(201).send(successResponse(dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // GET /briefings
  // --------------------------------------------------------------------------
  fastify.get<{ Querystring: ListBriefingsQuery }>(
    '/briefings',
    {
      schema: {
        querystring: listBriefingsQuerySchema,
        response: { 200: briefingListResponseSchema },
      },
    },
    async (request, reply) => {
      const claims = request.customerJwt!;
      const q = request.query;
      const limitNumeric = q.limit === undefined ? undefined : Number.parseInt(q.limit, 10);
      const result = await fastify.withCustomerContext(request, (tx) =>
        listBriefingsForCustomer(tx, {
          accountUuid: claims.sub,
          ...(q.app_id !== undefined ? { appId: q.app_id } : {}),
          ...(q.status !== undefined ? { status: q.status } : {}),
          ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
          ...(limitNumeric !== undefined ? { limit: limitNumeric } : {}),
        })
      );
      const data: { items: typeof result.items; next_cursor?: string | null } = {
        items: result.items,
        next_cursor: result.nextCursor,
      };
      return reply.send(successResponse(data, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // GET /briefings/:briefing_id
  // --------------------------------------------------------------------------
  fastify.get<{ Params: BriefingIdParams }>(
    '/briefings/:briefing_id',
    {
      schema: {
        params: BRIEFING_ID_PARAMS_SCHEMA,
        response: { 200: briefingResponseSchema },
      },
    },
    async (request, reply) => {
      const claims = request.customerJwt!;
      const dto = await fastify.withCustomerContext(request, (tx) =>
        readBriefing(tx, claims.sub, request.params.briefing_id)
      );
      if (!dto) return notFound(reply, request.requestId);
      return reply.send(successResponse(dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // PATCH /briefings/:briefing_id
  // --------------------------------------------------------------------------
  fastify.patch<{ Params: BriefingIdParams; Body: UpdateBriefingBody }>(
    '/briefings/:briefing_id',
    {
      schema: {
        params: BRIEFING_ID_PARAMS_SCHEMA,
        body: updateBriefingRequestSchema,
        response: { 200: briefingResponseSchema },
      },
    },
    async (request, reply) => {
      const audit = buildAuditContext(request);
      const body = request.body;
      const dto = await fastify.withCustomerContext(request, (tx) =>
        patchBriefing(tx, audit, request.params.briefing_id, {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.intent !== undefined ? { intent: body.intent } : {}),
          ...(body.expires_at !== undefined && body.expires_at !== null
            ? { expiresAt: new Date(body.expires_at) }
            : body.expires_at === null
            ? { expiresAt: null }
            : {}),
        })
      );
      if (!dto) return notFound(reply, request.requestId);
      return reply.send(successResponse(dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // DELETE /briefings/:briefing_id  (soft revoke)
  // --------------------------------------------------------------------------
  fastify.delete<{ Params: BriefingIdParams }>(
    '/briefings/:briefing_id',
    {
      schema: {
        params: BRIEFING_ID_PARAMS_SCHEMA,
      },
    },
    async (request, reply) => {
      const audit = buildAuditContext(request);
      const dto = await fastify.withCustomerContext(request, (tx) =>
        revokeBriefing(tx, audit, request.params.briefing_id)
      );
      if (!dto) return notFound(reply, request.requestId);
      return reply.code(204).send();
    }
  );
};
