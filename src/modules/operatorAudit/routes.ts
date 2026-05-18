/**
 * /v1/operator/audit route.
 *
 *   GET /operator/audit — admin-only audit log query. Filters on
 *                          account_uuid · agent_id · action · from · to.
 *                          Pagination with opaque base64url cursor.
 *                          Wraps every query in a transaction that sets
 *                          `app.role='operator'` so the RLS policy on
 *                          `audit_log` (migration 0006) allows the read.
 */

import type { FastifyPluginAsync } from 'fastify';
import { successResponse } from '@kmv/platform-shared/envelope';
import { requireAdminScope } from '../../lib/scopeCheck.js';
import { auditLogListResponseSchema, listAuditQuerySchema } from './schemas.js';
import { listAudit } from './service.js';

interface ListQuery {
  account_uuid?: string;
  agent_id?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}

export const operatorAuditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: ListQuery }>(
    '/operator/audit',
    {
      schema: {
        querystring: listAuditQuerySchema,
        response: { 200: auditLogListResponseSchema },
      },
    },
    async (request, reply) => {
      requireAdminScope(request);
      const q = request.query;
      const limit = q.limit === undefined ? undefined : Number.parseInt(q.limit, 10);
      const result = await listAudit(fastify.db, {
        ...(q.account_uuid !== undefined ? { accountUuid: q.account_uuid } : {}),
        ...(q.agent_id !== undefined ? { agentId: q.agent_id } : {}),
        ...(q.action !== undefined ? { action: q.action } : {}),
        ...(q.from !== undefined ? { from: new Date(q.from) } : {}),
        ...(q.to !== undefined ? { to: new Date(q.to) } : {}),
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      const data: { items: typeof result.items; next_cursor?: string | null } = {
        items: result.items,
        next_cursor: result.nextCursor,
      };
      return reply.send(successResponse(data, request.requestId));
    }
  );
};
