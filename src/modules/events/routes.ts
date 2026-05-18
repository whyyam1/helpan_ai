/**
 * /v1/events routes.
 *
 *   POST /events/ingest — consuming-app server publishes a domain event for
 *                          matching against active briefings. HMAC-authed
 *                          (service-to-service); no customer JWT.
 *
 * Plugin chain ahead of this handler (registered in src/app.ts):
 *
 *   requestId → errorMapper → db → kafka → shared HMAC auth → customer-JWT
 *     (skips this path) → rlsContext → shared idempotency → routes
 *
 * Idempotency: shared plugin handles the within-TTL replay window. The
 * service layer also checks the `(idempotency_key, app_id)` unique index
 * so a TTL-expired key with the same value still doesn't produce a
 * duplicate row.
 */

import type { FastifyPluginAsync } from 'fastify';
import { successResponse } from '@kmv/platform-shared/envelope';
import {
  ingestEventRequestSchema,
  ingestEventResponseSchema,
} from './schemas.js';
import {
  ingestEvent,
  type WebhookTargetResolver,
} from './service.js';

interface IngestEventBody {
  event_type: string;
  app_id: string;
  account_uuid?: string | null;
  payload: Record<string, unknown>;
  published_at?: string;
  app_correlation_id?: string;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export interface EventsRoutesConfig {
  readonly webhookTargets: WebhookTargetResolver;
}

export const eventsRoutes: FastifyPluginAsync<EventsRoutesConfig> = async (fastify, config) => {
  fastify.post<{ Body: IngestEventBody }>(
    '/events/ingest',
    {
      schema: {
        body: ingestEventRequestSchema,
        response: { 202: ingestEventResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const idempotencyKey = headerString(request.headers['x-idempotency-key']);
      if (!idempotencyKey) {
        // The shared idempotency plugin enforces this at the protocol layer;
        // we only reach here if a misconfiguration exempted the path. Throw
        // a clear error rather than persisting a partial row.
        throw new Error('events.ingest: X-Idempotency-Key missing after plugin chain');
      }
      const traceparent = headerString(request.headers['traceparent']);

      const result = await ingestEvent(
        {
          db: fastify.db,
          ...(fastify.kafka ? { kafka: fastify.kafka } : {}),
          webhookTargets: config.webhookTargets,
        },
        {
          eventType: body.event_type,
          appId: body.app_id,
          ...(body.account_uuid !== undefined ? { accountUuid: body.account_uuid } : {}),
          payload: body.payload,
          ...(body.published_at !== undefined
            ? { publishedAt: new Date(body.published_at) }
            : {}),
          ...(body.app_correlation_id !== undefined
            ? { appCorrelationId: body.app_correlation_id }
            : {}),
          idempotencyKey,
          requestId: request.requestId,
          ...(traceparent ? { traceparent } : {}),
        }
      );

      return reply.code(202).send(
        successResponse(
          {
            event_id: result.eventId,
            accepted_at: result.acceptedAt.toISOString(),
            match_count: result.matchCount,
          },
          request.requestId
        )
      );
    }
  );
};
