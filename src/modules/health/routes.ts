/**
 * Health routes.
 *
 *   GET /v1/health        — unauthenticated liveness; on the auth-plugin
 *                           exempt-paths list (configured in src/app.ts).
 *   GET /v1/health/deep   — authenticated; aggregates downstream component
 *                           probes. H-1 reports `unavailable` for components
 *                           not yet wired (kafka, rails, llm).
 *
 * Health endpoints intentionally bypass the success-envelope wrapper
 * because the OpenAPI HealthResponse / DeepHealthResponse schemas are
 * raw objects — load balancers, k8s liveness probes, and Railway need a
 * predictable shape that does not depend on the rail's envelope contract.
 */

import type { FastifyPluginAsync } from 'fastify';
import { gatherDeepHealth } from './service.js';
import {
  deepHealthResponseSchema,
  healthResponseSchema,
  type HealthResponse,
} from './schemas.js';

export interface HealthRouteConfig {
  readonly serviceVersion: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteConfig> = async (fastify, config) => {
  fastify.get(
    '/health',
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async (): Promise<HealthResponse> => ({
      ok: true,
      status: 'healthy',
      version: config.serviceVersion,
    })
  );

  fastify.get(
    '/health/deep',
    {
      schema: {
        response: { 200: deepHealthResponseSchema },
      },
    },
    async (request) => {
      return gatherDeepHealth({
        sql: request.server.sql,
        hasKafkaProducer: !!request.server.kafka,
      });
    }
  );
};
