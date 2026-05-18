/**
 * /v1/operator/safety-policies routes.
 *
 *   GET  /operator/safety-policies              — list all
 *   PUT  /operator/safety-policies/:policy_id   — upsert (RFC-compliant)
 *
 * All paths require HMAC + `helpan:admin`. PUT is idempotent on the
 * (policy_id, body) tuple — the shared idempotency plugin handles header
 * replay; PUT itself is naturally idempotent at the storage layer because
 * we overwrite the named row.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { successResponse } from '@kmv/platform-shared/envelope';
import { requireAdminScope } from '../../lib/scopeCheck.js';
import {
  putSafetyPolicyRequestSchema,
  safetyPolicyListResponseSchema,
  safetyPolicyResponseSchema,
  type AudiencePosture,
  type ContentModerationRule,
  type LocationPrecisionFloor,
} from './schemas.js';
import {
  listAllSafetyPolicies,
  putSafetyPolicy,
  type OperatorAuditContext,
} from './service.js';

interface PolicyIdParams {
  policy_id: string;
}

interface PutBody {
  id: string;
  app_id: string;
  category_whitelist?: string[];
  category_blacklist?: string[];
  content_moderation_rules?: ContentModerationRule[];
  audience_posture?: AudiencePosture;
  location_precision_floor?: LocationPrecisionFloor | null;
}

const POLICY_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['policy_id'],
  additionalProperties: false,
  properties: {
    policy_id: { type: 'string', pattern: '^sfp_[0-9A-HJKMNP-TV-Z]{26}$' },
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

export const operatorSafetyPoliciesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/operator/safety-policies',
    {
      schema: {
        response: { 200: safetyPolicyListResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const items = await listAllSafetyPolicies(fastify.db);
      return reply.send(successResponse({ items }, request.requestId));
    }
  );

  fastify.put<{ Params: PolicyIdParams; Body: PutBody }>(
    '/operator/safety-policies/:policy_id',
    {
      schema: {
        params: POLICY_ID_PARAMS_SCHEMA,
        body: putSafetyPolicyRequestSchema,
        response: {
          200: safetyPolicyResponseSchema,
          201: safetyPolicyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const body = request.body;
      const result = await putSafetyPolicy(
        fastify.db,
        buildAuditContext(request),
        request.params.policy_id,
        {
          id: body.id,
          appId: body.app_id,
          ...(body.category_whitelist !== undefined
            ? { categoryWhitelist: body.category_whitelist }
            : {}),
          ...(body.category_blacklist !== undefined
            ? { categoryBlacklist: body.category_blacklist }
            : {}),
          ...(body.content_moderation_rules !== undefined
            ? { contentModerationRules: body.content_moderation_rules }
            : {}),
          ...(body.audience_posture !== undefined
            ? { audiencePosture: body.audience_posture }
            : {}),
          ...(body.location_precision_floor !== undefined
            ? { locationPrecisionFloor: body.location_precision_floor }
            : {}),
        }
      );
      const statusCode = result.created ? 201 : 200;
      return reply.code(statusCode).send(successResponse(result.dto, request.requestId));
    }
  );
};
