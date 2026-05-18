/**
 * Fastify plugin: idempotency middleware.
 * Per Instruction Pack §2.8; Identiti Rail Contract §6 (per-(app, endpoint, key) scope).
 *
 *   1. On protected method (POST/PUT/PATCH/DELETE), require X-Idempotency-Key.
 *      Missing → REQ_IDEMPOTENCY_KEY_MISSING (400).
 *   2. Compose scoped key: {METHOD}:{routePath}:{key} so the same key on a
 *      different endpoint cannot collide.
 *   3. Hash request body (raw bytes, captured by authPlugin's parser).
 *   4. Look up store by (scopedKey, appId).
 *      - Found + body hash matches → replay stored response with
 *        X-Idempotency-Replayed: true.
 *      - Found + body hash differs → REQ_IDEMPOTENCY_KEY_CONFLICT (409).
 *      - Not found → continue; capture response in onSend and persist.
 *
 * Requires authPlugin to have run first so request.appId is set.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import type { IdempotencyStore } from '../idempotency.js';
import { errorResponse } from '../envelope.js';

export interface IdempotencyPluginConfig {
  store: IdempotencyStore;
  ttlSeconds: number;
  protectedMethods: readonly ('POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  /**
   * Paths exempt from the idempotency check (e.g. vendor inbound webhooks
   * that have their own per-vendor signature surface and don't carry
   * X-Idempotency-Key). Matched on the URL path with exact equality, same
   * shape as authPlugin's exemptPaths.
   */
  exemptPaths?: readonly string[];
  /** Prefix-match exemptions. Mirrors authPlugin.exemptPrefixes. */
  exemptPrefixes?: readonly string[];
  /**
   * Suffix-match exemptions. For POST endpoints that are queries rather than
   * state mutations and sit under a variable path segment — e.g.
   * `POST /v1/authorities/{id}/validate`, where exact-path and prefix
   * matching can't isolate the `/validate` leaf without also exempting its
   * siblings. Applied with `path.endsWith(suffix)`.
   */
  exemptSuffixes?: readonly string[];
}

interface IdempotencyMeta {
  scopedKey: string;
  appId: string;
  bodyHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyMeta?: IdempotencyMeta;
  }
}

function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

const idempotencyPluginImpl: FastifyPluginAsync<IdempotencyPluginConfig> = async (
  fastify,
  config
) => {
  const protectedSet = new Set<string>(config.protectedMethods);
  const exemptSet = new Set<string>(config.exemptPaths ?? []);
  const exemptPrefixes = config.exemptPrefixes ?? [];
  const exemptSuffixes = config.exemptSuffixes ?? [];

  fastify.addHook('preHandler', async (request, reply) => {
    if (!protectedSet.has(request.method)) return;
    const path = pathOf(request.url);
    if (exemptSet.has(path)) return;
    for (const p of exemptPrefixes) {
      if (path.startsWith(p)) return;
    }
    for (const s of exemptSuffixes) {
      if (path.endsWith(s)) return;
    }

    const key = headerString(request.headers['x-idempotency-key']);
    if (!key) {
      return reply
        .code(400)
        .send(errorResponse('REQ_IDEMPOTENCY_KEY_MISSING', 'X-Idempotency-Key header required'));
    }

    if (!request.appId) {
      return reply
        .code(401)
        .send(errorResponse('AUTH_HMAC_INVALID', 'Authentication required before idempotency'));
    }

    const scopedKey = `${request.method}:${pathOf(request.url)}:${key}`;
    const bodyHash = hashBody(request.rawBody ?? '');

    const existing = await config.store.get(scopedKey, request.appId);
    if (existing) {
      if (existing.requestBodyHash !== bodyHash) {
        return reply
          .code(409)
          .send(
            errorResponse('REQ_IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key reused with different body')
          );
      }
      reply.header('x-idempotency-replayed', 'true');
      reply.header('content-type', 'application/json; charset=utf-8');
      return reply.code(existing.statusCode).send(existing.responseBody);
    }

    request.idempotencyMeta = { scopedKey, appId: request.appId, bodyHash };
    return;
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const meta = request.idempotencyMeta;
    if (!meta) return payload;
    if (reply.getHeader('x-idempotency-replayed') === 'true') return payload;

    let body: unknown;
    if (typeof payload === 'string') {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    } else if (payload === undefined || payload === null) {
      body = null;
    } else {
      body = payload;
    }

    await config.store.set(
      meta.scopedKey,
      meta.appId,
      {
        requestBodyHash: meta.bodyHash,
        statusCode: reply.statusCode,
        responseBody: body,
        createdAt: new Date().toISOString(),
      },
      config.ttlSeconds
    );
    return payload;
  });
};

export const idempotencyPlugin = fp(idempotencyPluginImpl, {
  name: 'kmv-platform-shared/idempotency',
  fastify: '4.x',
  dependencies: ['kmv-platform-shared/auth'],
});
