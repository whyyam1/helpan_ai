/**
 * /v1/oauth/scopes routes.
 *
 *   GET  /oauth/scopes              — list (HMAC-authed in v1.0; see RECAP §6 for
 *                                     the public-listing follow-up noted as an
 *                                     Amendment §A candidate).
 *   POST /oauth/scopes              — admin-only: define a new scope.
 *
 * Both paths go through the standard plugin chain (HMAC + idempotency on
 * POST). POST additionally requires the `helpan:admin` scope on the
 * authenticated tenant — enforced via `requireAdminScope`.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { successResponse } from '@kmv/platform-shared/envelope';
import { requireAdminScope } from '../../lib/scopeCheck.js';
import {
  createOauthScopeRequestSchema,
  listOauthScopesQuerySchema,
  oauthScopeListResponseSchema,
  oauthScopeResponseSchema,
  type ElevationFriction,
  type ScopeCategory,
  type ScopeRail,
} from './schemas.js';
import {
  createOauthScope,
  listOauthScopes,
  type OperatorAuditContext,
} from './service.js';

interface ListQuery {
  rail?: ScopeRail;
}

interface CreateBody {
  id: string;
  name: string;
  description: string;
  rail: ScopeRail;
  category: ScopeCategory;
  default_grantable: boolean;
  elevation_friction?: ElevationFriction;
  per_scope_amount_ceiling_minor?: number | null;
  per_scope_period_ceiling_minor?: number | null;
  per_scope_max_ttl_seconds?: number;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function buildAuditContext(request: FastifyRequest): OperatorAuditContext {
  const traceparent = headerString(request.headers['traceparent']);
  return {
    appId: request.appId ?? 'unknown',
    requestId: request.requestId,
    ...(traceparent ? { traceparent } : {}),
  };
}

export const oauthScopesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: ListQuery }>(
    '/oauth/scopes',
    {
      schema: {
        querystring: listOauthScopesQuerySchema,
        response: { 200: oauthScopeListResponseSchema },
      },
    },
    async (request, reply) => {
      const items = await listOauthScopes(fastify.db, {
        ...(request.query.rail !== undefined ? { rail: request.query.rail } : {}),
      });
      return reply.send(successResponse({ items }, request.requestId));
    }
  );

  fastify.post<{ Body: CreateBody }>(
    '/oauth/scopes',
    {
      schema: {
        body: createOauthScopeRequestSchema,
        response: { 201: oauthScopeResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const body = request.body;
      const dto = await createOauthScope(fastify.db, buildAuditContext(request), {
        id: body.id,
        name: body.name,
        description: body.description,
        rail: body.rail,
        category: body.category,
        defaultGrantable: body.default_grantable,
        ...(body.elevation_friction !== undefined
          ? { elevationFriction: body.elevation_friction }
          : {}),
        ...(body.per_scope_amount_ceiling_minor !== undefined
          ? { perScopeAmountCeilingMinor: body.per_scope_amount_ceiling_minor }
          : {}),
        ...(body.per_scope_period_ceiling_minor !== undefined
          ? { perScopePeriodCeilingMinor: body.per_scope_period_ceiling_minor }
          : {}),
        ...(body.per_scope_max_ttl_seconds !== undefined
          ? { perScopeMaxTtlSeconds: body.per_scope_max_ttl_seconds }
          : {}),
      });
      return reply.code(201).send(successResponse(dto, request.requestId));
    }
  );
};
