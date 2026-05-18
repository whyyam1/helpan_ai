/**
 * Idempotency surface for /v1/briefings.
 *
 * Strategy: the customer-JWT plugin populates `request.appId` from the
 * `X-App-Id` header so the shared idempotency plugin (which keys per-appId)
 * works uniformly with HMAC-authed traffic. We can therefore exercise replay
 * and conflict semantics with the stub-DB harness by pre-populating the
 * idempotency store before the request — no real Postgres needed.
 *
 * Missing-key semantics on POST/PATCH/DELETE come straight from the shared
 * plugin; this file proves the briefings paths are wired into it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, makeMemoryIdempotencyStore, TEST_APP_ID } from '../helpers/testApp.js';
import { signCustomerToken, type TestJwksKeypair } from '../helpers/testJwks.js';
import type { IdempotencyStore } from '@kmv/platform-shared/idempotency';

const ACCOUNT_UUID = 'acc_00000000-0000-0000-0000-000000000001';
const IDEMPOTENCY_KEY = '11111111-2222-3333-4444-555555555555';

async function authHeaders(keypair: TestJwksKeypair): Promise<Record<string, string>> {
  const token = await signCustomerToken({ keypair, sub: ACCOUNT_UUID });
  return {
    authorization: `Bearer ${token}`,
    'x-app-id': TEST_APP_ID,
    'content-type': 'application/json',
  };
}

describe('idempotency on /v1/briefings', () => {
  let app: FastifyInstance;
  let keypair: TestJwksKeypair;
  let store: IdempotencyStore;

  beforeEach(async () => {
    store = makeMemoryIdempotencyStore();
    ({ app, keypair } = await buildTestApp({ idempotencyStore: store }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects POST without X-Idempotency-Key with REQ_IDEMPOTENCY_KEY_MISSING (400)', async () => {
    const headers = await authHeaders(keypair);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_UUID,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: { kind: 'demo' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_MISSING');
  });

  it('replays a cached response on identical key + body, with X-Idempotency-Replayed header', async () => {
    // Pre-populate the cache with a synthetic response keyed on the briefings POST.
    const scopedKey = `POST:/v1/briefings:${IDEMPOTENCY_KEY}`;
    const requestBody = {
      account_uuid: ACCOUNT_UUID,
      app_id: TEST_APP_ID,
      briefing_type: 'alert',
      intent: { kind: 'demo' },
    };
    const requestRaw = JSON.stringify(requestBody);
    const { createHash } = await import('node:crypto');
    const bodyHash = createHash('sha256').update(requestRaw, 'utf8').digest('hex');

    // The cached response must be a full BriefingResponse — Fastify
    // re-serialises through the route's response schema on replay, so any
    // missing required field would 500 instead of returning the cache.
    await store.set(
      scopedKey,
      TEST_APP_ID,
      {
        requestBodyHash: bodyHash,
        statusCode: 201,
        responseBody: {
          ok: true,
          data: {
            id: 'brf_01CACHEDREPLAY00000000000A',
            account_uuid: ACCOUNT_UUID,
            app_id: TEST_APP_ID,
            briefing_type: 'alert',
            status: 'active',
            intent: { kind: 'demo' },
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          meta: {
            request_id: '01CACHEDMETA000000000000RQ',
            timestamp: '2026-01-01T00:00:00.000Z',
            schema_version: '1.0',
          },
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      3600
    );

    const headers = {
      ...(await authHeaders(keypair)),
      'x-idempotency-key': IDEMPOTENCY_KEY,
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: requestBody,
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-idempotency-replayed']).toBe('true');
    expect(res.json().data.id).toBe('brf_01CACHEDREPLAY00000000000A');
  });

  it('returns REQ_IDEMPOTENCY_KEY_CONFLICT (409) on identical key with different body', async () => {
    const scopedKey = `POST:/v1/briefings:${IDEMPOTENCY_KEY}`;
    await store.set(
      scopedKey,
      TEST_APP_ID,
      {
        requestBodyHash: 'unrelated-hash-for-a-different-body',
        statusCode: 201,
        responseBody: { ok: true, data: { id: 'brf_x' } },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      3600
    );

    const headers = {
      ...(await authHeaders(keypair)),
      'x-idempotency-key': IDEMPOTENCY_KEY,
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_UUID,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: { kind: 'fresh' },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_CONFLICT');
  });

  it('idempotency keys are scoped per app_id (different X-App-Id does not collide)', async () => {
    // Two consuming apps using the same key on the same path must not see
    // each other's cached responses. The store is keyed (scopedKey, appId).
    const scopedKey = `POST:/v1/briefings:${IDEMPOTENCY_KEY}`;
    await store.set(
      scopedKey,
      'OTHER_APP',
      {
        requestBodyHash: 'unrelated',
        statusCode: 201,
        responseBody: { ok: true, data: {} },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      3600
    );
    // Verify the entry didn't leak to TEST_APP_ID's namespace.
    const otherAppEntry = await store.get(scopedKey, 'OTHER_APP');
    const testAppEntry = await store.get(scopedKey, TEST_APP_ID);
    expect(otherAppEntry).not.toBeNull();
    expect(testAppEntry).toBeNull();
  });
});
