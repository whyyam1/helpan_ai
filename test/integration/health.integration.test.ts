/**
 * Integration tests for /v1/health and /v1/health/deep.
 *
 * Boots the full Fastify app via `buildApp(...)` with stub stores so the
 * test exercises the real plugin chain (auth + idempotency + error mapper)
 * without a live Postgres.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCanonicalString, sha256Hex, signRequest } from '@kmv/platform-shared/hmac';
import { buildTestApp, TEST_APP_ID, TEST_HMAC_SECRET } from '../helpers/testApp.js';

interface SignedHeadersInput {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
  readonly contentType?: string;
}

function signedHeaders(input: SignedHeadersInput): Record<string, string> {
  const method = input.method.toUpperCase();
  const body = input.body ?? '';
  const contentType = input.contentType ?? (body ? 'application/json; charset=utf-8' : '');
  const timestamp = new Date().toISOString();
  const canonical = buildCanonicalString({
    method,
    pathAndQuery: input.url,
    contentType,
    timestamp,
    bodySha256Hex: sha256Hex(body),
  });
  const signature = signRequest(canonical, TEST_HMAC_SECRET);
  const headers: Record<string, string> = {
    authorization: `Helpan-HMAC-SHA256 app_id=${TEST_APP_ID}, signature=${signature}`,
    'x-helpan-timestamp': timestamp,
  };
  if (contentType) headers['content-type'] = contentType;
  return headers;
}

describe('GET /v1/health', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with HealthResponse shape; no auth required', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      status: 'healthy',
      version: '0.1.0-test',
    });
  });

  it('echoes x-request-id header on every reply', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('respects a caller-provided x-request-id', async () => {
    const incoming = '01HHHHHHHHHHHHHHHHHHHHHHHH';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': incoming },
    });
    expect(res.headers['x-request-id']).toBe(incoming);
  });
});

describe('GET /v1/health/deep', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests with 401 AUTH_HMAC_INVALID', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health/deep' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('returns DeepHealthResponse with locally-wired components healthy + cross-rail unavailable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health/deep',
      headers: signedHeaders({ method: 'GET', url: '/v1/health/deep' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Locally wired (stub-DB + in-memory Kafka producer in tests).
    expect(body.components.database).toBe('healthy');
    expect(body.components.briefings).toBe('healthy');
    expect(body.components.events_ingest).toBe('healthy');
    expect(body.components.authorities).toBe('healthy');
    expect(body.components.kafka).toBe('healthy');
    // Cross-rail components not yet wired.
    expect(body.components.identiti).toBe('unavailable');
    expect(body.components.kipkiren_pay).toBe('unavailable');
    expect(body.components.todoku).toBe('unavailable');
    expect(body.components.llm_provider).toBe('unavailable');
    // Roll-up: any unavailable component → overall unavailable, ok=false.
    expect(body.status).toBe('unavailable');
    expect(body.ok).toBe(false);
  });

  it('reports database=unavailable when the probe query throws', async () => {
    await app.close();
    ({ app } = await buildTestApp({ stubSqlOptions: { failQuery: true } }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health/deep',
      headers: signedHeaders({ method: 'GET', url: '/v1/health/deep' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().components.database).toBe('unavailable');
  });
});
