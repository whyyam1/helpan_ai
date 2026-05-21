/**
 * /v1/actions routes (H-4).
 *
 *   POST /actions/dispatch        — agent action dispatch
 *   GET  /actions                 — list actions (Console Activity tab)
 *   GET  /actions/:action_id      — read one action
 *
 * Auth model:
 *   - `POST /actions/dispatch` is HMAC-only — the consuming-app server signs
 *     on behalf of its agent. Scope `helpan:actions:dispatch`. The agent
 *     identity is carried by the `X-Delegated-Authority` JWT, not by the
 *     calling tenant.
 *   - `GET /actions` and `GET /actions/:id` are dual-auth (the Console reads
 *     them via customer JWT, operators / consuming apps via HMAC). A customer
 *     caller is hard-scoped to their own `account_uuid` — same pattern as
 *     H-8a `/v1/authorities`.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { errorResponse, successResponse } from '@kmv/platform-shared/envelope';
import { requireScope } from '../../lib/scopeCheck.js';
import type { JWTVerifyGetKey, KeyLike } from 'jose';
import type { DispatcherRegistry } from '../../lib/dispatchers/dispatcher.js';
import type { KafkaProducerLike } from '../../lib/kafka/producer.js';
import {
  actionListResponseSchema,
  actionResponseSchema,
  dispatchActionRequestSchema,
  listActionsQuerySchema,
  type ActionInitiatedBy,
  type ActionStatus,
  type ActionTargetRail,
} from './schemas.js';
import {
  dispatchAction,
  listActionsForQuery,
  readAction,
  type DispatchAuditContext,
} from './service.js';

const SCOPE_DISPATCH = 'helpan:actions:dispatch';
const SCOPE_READ = 'helpan:actions:read';

const ACTION_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['action_id'],
  additionalProperties: false,
  properties: {
    action_id: { type: 'string', pattern: '^act_[0-9A-HJKMNP-TV-Z]{26}$' },
  },
} as const;

interface DispatchBody {
  account_uuid: string;
  target_rail: ActionTargetRail;
  target_operation: string;
  payload: Record<string, unknown>;
  initiated_by?: ActionInitiatedBy;
  amount_minor?: number;
  business_op_id?: string;
}

interface ActionIdParams {
  action_id: string;
}

interface ListQuery {
  status?: ActionStatus;
  agent_id?: string;
  target_rail?: ActionTargetRail;
  account_uuid?: string;
  cursor?: string;
  limit?: string;
}

type Caller =
  | { readonly kind: 'customer'; readonly accountUuid: string }
  | { readonly kind: 'service' };

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

function notFound(reply: FastifyReply, requestId: string): FastifyReply {
  return reply
    .code(404)
    .send(errorResponse('ACTION_NOT_FOUND', 'Action not found', requestId));
}

function dispatchAuditContext(request: FastifyRequest): DispatchAuditContext {
  const traceparent = headerString(request.headers['traceparent']);
  const idempotencyKey = headerString(request.headers['x-idempotency-key']) ?? '';
  return {
    appId: request.appId ?? 'unknown',
    requestId: request.requestId,
    idempotencyKey,
    ...(traceparent ? { traceparent } : {}),
  };
}

export interface ActionsRoutesConfig {
  readonly dispatchers: DispatcherRegistry;
  readonly daKeyResolver: JWTVerifyGetKey | KeyLike;
  readonly issuer: string;
  readonly kafka?: KafkaProducerLike;
}

export const actionsRoutes: FastifyPluginAsync<ActionsRoutesConfig> = async (
  fastify,
  config
) => {
  // --------------------------------------------------------------------------
  // POST /actions/dispatch
  // --------------------------------------------------------------------------
  fastify.post<{ Body: DispatchBody }>(
    '/actions/dispatch',
    {
      schema: {
        body: dispatchActionRequestSchema,
        response: { 200: actionResponseSchema },
      },
    },
    async (request, reply) => {
      // Service-only — the Console doesn't dispatch on behalf of users.
      const caller = resolveCaller(request);
      if (caller.kind !== 'service') {
        throw Object.assign(new Error('Dispatch is service-only'), {
          code: 'AUTH_SCOPE_REQUIRED',
          statusCode: 403,
          detail: { required_scope: SCOPE_DISPATCH },
        });
      }
      requireScope(request, SCOPE_DISPATCH);

      const delegatedAuthorityJwt = headerString(request.headers['x-delegated-authority']);
      if (!delegatedAuthorityJwt) {
        return reply
          .code(401)
          .send(
            errorResponse(
              'AUTH_AUTHORITY_MISSING',
              'X-Delegated-Authority header is required on /actions/dispatch',
              request.requestId
            )
          );
      }

      const body = request.body;
      const dto = await dispatchAction(
        {
          db: fastify.db,
          validationDeps: {
            db: fastify.db,
            daKeyResolver: config.daKeyResolver,
            issuer: config.issuer,
          },
          dispatchers: config.dispatchers,
          ...(config.kafka ? { kafka: config.kafka } : {}),
        },
        dispatchAuditContext(request),
        {
          accountUuid: body.account_uuid,
          targetRail: body.target_rail,
          targetOperation: body.target_operation,
          payload: body.payload,
          ...(body.initiated_by !== undefined ? { initiatedBy: body.initiated_by } : {}),
          ...(body.amount_minor !== undefined ? { amountMinor: body.amount_minor } : {}),
          ...(body.business_op_id !== undefined ? { businessOpId: body.business_op_id } : {}),
          delegatedAuthorityJwt,
        }
      );

      // The OpenAPI spec returns 200 for synchronous-completed and 202 for
      // accepted-but-async. v1.0 dispatch is synchronous — return 200 unless
      // future async dispatcher impls reverse it.
      return reply.send(successResponse(dto, request.requestId));
    }
  );

  // --------------------------------------------------------------------------
  // GET /actions — list (Console Activity + operator)
  // --------------------------------------------------------------------------
  fastify.get<{ Querystring: ListQuery }>(
    '/actions',
    {
      schema: {
        querystring: listActionsQuerySchema,
        response: { 200: actionListResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_READ);

      const q = request.query;
      const limit = q.limit === undefined ? undefined : Number.parseInt(q.limit, 10);
      const accountUuid =
        caller.kind === 'customer' ? caller.accountUuid : q.account_uuid;

      const result = await listActionsForQuery(fastify.db, {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.agent_id !== undefined ? { agentId: q.agent_id } : {}),
        ...(q.target_rail !== undefined ? { targetRail: q.target_rail } : {}),
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
  // GET /actions/:action_id
  // --------------------------------------------------------------------------
  fastify.get<{ Params: ActionIdParams }>(
    '/actions/:action_id',
    {
      schema: {
        params: ACTION_ID_PARAMS_SCHEMA,
        response: { 200: actionResponseSchema },
      },
    },
    async (request, reply) => {
      const caller = resolveCaller(request);
      if (caller.kind === 'service') requireScope(request, SCOPE_READ);

      const dto = await readAction(fastify.db, request.params.action_id);
      if (!dto) return notFound(reply, request.requestId);
      // Customer-scoped: a customer may only see their own actions.
      if (caller.kind === 'customer' && dto.account_uuid !== caller.accountUuid) {
        return notFound(reply, request.requestId);
      }
      return reply.send(successResponse(dto, request.requestId));
    }
  );
};
