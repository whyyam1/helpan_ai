/**
 * Fastify plugin: ensures every reply carries a request_id ULID.
 *
 * - Reads incoming `x-request-id` if the caller provided one.
 * - Otherwise generates a fresh ULID via @kmv/platform-shared/ulid.
 * - Echoes it on the response and exposes it on `request.requestId`.
 *
 * The shared envelope helpers (`successResponse` / `errorResponse`) accept
 * a request_id; route handlers should pass `request.requestId` to keep the
 * meta block consistent with the response header.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { generateUlid } from '@kmv/platform-shared/ulid';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const requestIdPluginImpl: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : generateUlid();
    request.requestId = id;
    reply.header('x-request-id', id);
  });
};

export const requestIdPlugin = fp(requestIdPluginImpl, {
  name: 'helpan-ai/request-id',
  fastify: '4.x',
});
