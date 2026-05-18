/**
 * /v1/authorities routes — the rail's most security-critical surface.
 *
 *   POST   /authorities                        — issue / grant
 *   GET    /authorities                        — list
 *   GET    /authorities/:authority_id          — read one
 *   POST   /authorities/:authority_id/validate — relying-party per-call check
 *   POST   /authorities/:authority_id/revoke   — revoke
 *
 * Auth (H-8a — dual-auth):
 *   - `/validate` is HMAC-only — relying parties (KP / Todoku), scope
 *     `helpan:authority:validate`.
 *   - issue / list / detail / revoke accept EITHER HMAC (consuming-app
 *     server / operator, per-endpoint scope) OR an Identiti customer JWT
 *     (the Helpan Console). The customer-JWT plugin runs first and, on a
 *     Bearer request, sets `request.customerJwt`; an HMAC request leaves it
 *     unset. A customer caller skips the HMAC-scope check (their right to
 *     see / revoke / grant their own authorities is implicit in the JWT)
 *     and is hard-scoped to their own `account_uuid`.
 *
 * `POST /validate` is on the idempotency plugin's `exemptSuffixes` — it must
 * not consume an idempotency key (a cached validate result would defeat the
 * §4.6 cache rules).
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { errorResponse, successResponse } from '@kmv/platform-shared/envelope';
import type { JWTVerifyGetKey, KeyLike } from 'jose';
import { requireScope } from '../../lib/scopeCheck.js';
import type { DelegatedAuthoritySigner } from '../../lib/identitiSigner.js';
import type { StepUpVerifier } from '../../lib/stepUpVerifier.js';
import {
  authorityListResponseSchema,
  authorityResponseSchema,
  issueAuthorityRequestSchema,
  listAuthoritiesQuerySchema,
  revokeAuthorityRequestSchema,
  validateAuthorityRequestSchema,
  validateAuthorityResponseSchema,
  type AuthorityScopeDto,
  type AuthorityStatus,
  type RevocationReason,
} from './schemas.js';
import {
  issueAuthority,
  listAuthoritiesForQuery,
  readAuthority,
  revokeAuthority,
  validateAuthority,
  type AuthorityAuditContext,
} from './service.js';

const SCOPE_ISSUE = 'helpan:authorities:issue';
const SCOPE_VALIDATE = 'helpan:authority:validate';
const SCOPE_REVOKE = 'helpan:authorities:revoke';

const AUTHORITY_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['authority_id'],
  additionalProperties: false,
  properties: {
    authority_id: { type: 'string', pattern: '^daa_[0-9A-HJKMNP-TV-Z]{26}$' },
  },
} as const;

interface IssueBody {
  account_uuid: string;
  agent_id: string;
  scopes: AuthorityScopeDto[];
  ttl_seconds: number;
  step_up_token?: string;
}

interface ValidateBody {
  token: string;
  intended_operation: string;
  amount_minor?: number;
}

interface RevokeBody {
  reason?: RevocationReason;
  detail?: string;
}

interface AuthorityIdParams {
  authority_id: string;
}

interface ListQuery {
  status?: AuthorityStatus;
  agent_id?: string;
  account_uuid?: string;
  cursor?: string;
  limit?: string;
}

type Caller =
  | { readonly kind: 'customer'; readonly accountUuid: string }
  | { readonly kind: 'service' };

/**
 * The customer-JWT plugin sets `request.customerJwt` on a verified Bearer
 * request; an HMAC request leaves it unset (the HMAC plugin set `appId` +
 * `tenantRecord` instead).
 */
function resolveCaller(request: FastifyRequest): Caller {
  if (request.customerJwt) {
    return { kind: 'customer', accountUuid: request.customerJwt.sub };
  }
  return { kind: 'service' };
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function buildAuditContext(request: FastifyRequest, caller: Caller): AuthorityAuditContext {
  const traceparent = headerString(request.headers['traceparent']);
  return {
    appId: request.appId ?? 'unknown',
    requestId: request.requestId,
    ...(traceparent ? { traceparent } : {}),
    caller: caller.kind,
    ...(caller.kind === 'customer' ? { callerAccountUuid: caller.accountUuid } : {}),
  };
}

function notFound(reply: FastifyReply, requestId: string): FastifyReply {
  return reply
    .code(404)
    .send(errorResponse('AUTHORITY_NOT_FOUND', 'Authority not found', requestId));
}

function accountMismatch(): Error {
  const err = new Error(
    'Body account_uuid does not match the authenticated customer'
  ) as Error & { code: string; statusCode: number; field: string };
  err.code = 'AUTH_ACCOUNT_MISMATCH';
  err.statusCode = 403;
  err.field = 'account_uuid';
  return err;
}

export interface AuthoritiesRoutesConfig {
  readonly signer?: DelegatedAuthoritySigner;
  readonly stepUpVerifier: StepUpVerifier;
  readonly daKeyResolver: JWTVerifyGetKey | KeyLike;
  readonly issuer: string;
  readonly helpanAudience: string;
  readonly daKid: string;
}

export const authoritiesRoutes: FastifyPluginAsync<AuthoritiesRoutesConfig> = async (
  fastify,
  config
) => {
  // --------------------------------------------------------------------------
  // POST /authorities — issue / grant
  // --------------------------------------------------------------------------
  fastify.post<{ Body: IssueBody }>(
    '/authorities',
    {
      schema: {
        body: issueAuthorityRequestSchema,
        response: { 201: authorityResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_ISSUE);
      const body = request.body;
      // A Console (customer) grant may only issue for the authenticated user.
      if (caller.kind === 'customer' && body.account_uuid !== caller.accountUuid) {
        throw accountMismatch();
      }
      const result = await issueAuthority(
        {
          db: fastify.db,
          ...(config.signer ? { signer: config.signer } : {}),
          stepUpVerifier: config.stepUpVerifier,
          issuer: config.issuer,
          helpanAudience: config.helpanAudience,
          daKid: config.daKid,
          ...(fastify.kafka ? { kafka: fastify.kafka } : {}),
        },
        buildAuditContext(request, caller),
        {
          accountUuid: body.account_uuid,
          agentId: body.agent_id,
          scopes: body.scopes,
          ttlSeconds: body.ttl_seconds,
          ...(body.step_up_token !== undefined ? { stepUpToken: body.step_up_token } : {}),
        }
      );
      return reply.code(201).send(successResponse(result.dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // GET /authorities — list
  // --------------------------------------------------------------------------
  fastify.get<{ Querystring: ListQuery }>(
    '/authorities',
    {
      schema: {
        querystring: listAuthoritiesQuerySchema,
        response: { 200: authorityListResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_ISSUE);
      const q = request.query;
      const limit = q.limit === undefined ? undefined : Number.parseInt(q.limit, 10);
      // A customer is hard-scoped to their own account; any account_uuid query
      // param is ignored. A service caller may filter by any account.
      const accountUuid =
        caller.kind === 'customer' ? caller.accountUuid : q.account_uuid;
      const result = await listAuthoritiesForQuery(fastify.db, {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.agent_id !== undefined ? { agentId: q.agent_id } : {}),
        ...(accountUuid !== undefined ? { accountUuid } : {}),
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return reply.send(
        successResponse(
          { items: result.items, next_cursor: result.nextCursor },
          request.requestId
        )
      );
    }
  );

  // --------------------------------------------------------------------------
  // GET /authorities/:authority_id — detail
  // --------------------------------------------------------------------------
  fastify.get<{ Params: AuthorityIdParams }>(
    '/authorities/:authority_id',
    {
      schema: {
        params: AUTHORITY_ID_PARAMS_SCHEMA,
        response: { 200: authorityResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_ISSUE);
      const dto = await readAuthority(fastify.db, request.params.authority_id);
      if (!dto) return notFound(reply, request.requestId);
      // Cross-customer read → 404 (never leak that the id exists).
      if (caller.kind === 'customer' && dto.account_uuid !== caller.accountUuid) {
        return notFound(reply, request.requestId);
      }
      return reply.send(successResponse(dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // POST /authorities/:authority_id/validate — relying-party query (HMAC-only)
  // --------------------------------------------------------------------------
  fastify.post<{ Params: AuthorityIdParams; Body: ValidateBody }>(
    '/authorities/:authority_id/validate',
    {
      schema: {
        params: AUTHORITY_ID_PARAMS_SCHEMA,
        body: validateAuthorityRequestSchema,
        response: { 200: validateAuthorityResponseSchema },
      },
    },
    async (request, reply) => {
      requireScope(request, SCOPE_VALIDATE);
      const body = request.body;
      const result = await validateAuthority(
        { db: fastify.db, daKeyResolver: config.daKeyResolver, issuer: config.issuer },
        request.params.authority_id,
        {
          token: body.token,
          intendedOperation: body.intended_operation,
          ...(body.amount_minor !== undefined ? { amountMinor: body.amount_minor } : {}),
        }
      );
      return reply.send(
        successResponse(
          {
            valid: result.valid,
            status: result.status,
            scope_covers: result.scopeCovers,
            within_limits: result.withinLimits,
            authority: result.authority,
            rejection_reason: result.rejectionReason,
          },
          request.requestId
        )
      );
    }
  );

  // --------------------------------------------------------------------------
  // POST /authorities/:authority_id/revoke
  // --------------------------------------------------------------------------
  fastify.post<{ Params: AuthorityIdParams; Body: RevokeBody }>(
    '/authorities/:authority_id/revoke',
    {
      schema: {
        params: AUTHORITY_ID_PARAMS_SCHEMA,
        body: revokeAuthorityRequestSchema,
        response: { 200: authorityResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_REVOKE);
      const body = request.body ?? {};
      // A customer revocation is always `user_initiated` — a customer cannot
      // claim operator / security-incident / cascade reasons.
      const reason: RevocationReason =
        caller.kind === 'customer' ? 'user_initiated' : (body.reason ?? 'user_initiated');
      const dto = await revokeAuthority(
        { db: fastify.db, ...(fastify.kafka ? { kafka: fastify.kafka } : {}) },
        buildAuditContext(request, caller),
        request.params.authority_id,
        {
          reason,
          ...(caller.kind === 'service' && body.detail !== undefined
            ? { detail: body.detail }
            : {}),
        }
      );
      return reply.send(successResponse(dto, request.requestId));
    }
  );
};
