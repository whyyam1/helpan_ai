/**
 * /v1/operator/agents routes.
 *
 *   POST   /operator/agents              — register a new agent
 *   GET    /operator/agents/:agent_id    — read agent detail
 *   PATCH  /operator/agents/:agent_id    — change status (suspend / reactivate / retire)
 *
 * All paths require HMAC + `helpan:admin` scope.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { errorResponse, successResponse } from '@kmv/platform-shared/envelope';
import { requireAdminScope } from '../../lib/scopeCheck.js';
import {
  agentResponseSchema,
  registerAgentRequestSchema,
  updateAgentStatusRequestSchema,
  type AgentClass,
  type AgentStatus,
} from './schemas.js';
import {
  changeAgentStatus,
  readAgent,
  registerAgent,
  type OperatorAuditContext,
} from './service.js';

interface RegisterBody {
  name: string;
  agent_class: AgentClass;
  owner_app_id?: string;
  third_party_oauth_client_id?: string;
}

interface AgentIdParams {
  agent_id: string;
}

interface PatchBody {
  status: AgentStatus;
  reason?: string;
}

const AGENT_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['agent_id'],
  additionalProperties: false,
  properties: {
    agent_id: { type: 'string', pattern: '^agt_[0-9A-HJKMNP-TV-Z]{26}$' },
  },
} as const;

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

function notFound(reply: FastifyReply, requestId: string): FastifyReply {
  return reply
    .code(404)
    .send(errorResponse('NOT_FOUND', 'Agent not found', requestId));
}

export const operatorAgentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RegisterBody }>(
    '/operator/agents',
    {
      schema: {
        body: registerAgentRequestSchema,
        response: { 201: agentResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const body = request.body;
      const dto = await registerAgent(fastify.db, buildAuditContext(request), {
        name: body.name,
        agentClass: body.agent_class,
        ...(body.owner_app_id !== undefined ? { ownerAppId: body.owner_app_id } : {}),
        ...(body.third_party_oauth_client_id !== undefined
          ? { thirdPartyOauthClientId: body.third_party_oauth_client_id }
          : {}),
      });
      return reply.code(201).send(successResponse(dto, request.requestId));
    }
  );

  fastify.get<{ Params: AgentIdParams }>(
    '/operator/agents/:agent_id',
    {
      schema: {
        params: AGENT_ID_PARAMS_SCHEMA,
        response: { 200: agentResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const dto = await readAgent(fastify.db, request.params.agent_id);
      if (!dto) return notFound(reply, request.requestId);
      return reply.send(successResponse(dto, request.requestId));
    }
  );

  fastify.patch<{ Params: AgentIdParams; Body: PatchBody }>(
    '/operator/agents/:agent_id',
    {
      schema: {
        params: AGENT_ID_PARAMS_SCHEMA,
        body: updateAgentStatusRequestSchema,
        response: { 200: agentResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const body = request.body;
      const dto = await changeAgentStatus(
        fastify.db,
        buildAuditContext(request),
        request.params.agent_id,
        {
          status: body.status,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
        }
      );
      if (!dto) return notFound(reply, request.requestId);
      return reply.send(successResponse(dto, request.requestId));
    }
  );
};
