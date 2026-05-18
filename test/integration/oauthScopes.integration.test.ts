/**
 * /v1/oauth/scopes — public list + admin-only POST.
 * Real Postgres; relies on the H-1 seeded scope catalogue from migration 0002.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  hmacHeaders,
  TEST_APP_ID,
  TEST_APP_ID_NO_ADMIN,
  TEST_HMAC_SECRET_NO_ADMIN,
} from '../helpers/testApp.js';
import {
  buildIntegrationApp,
  countAuditEntries,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('/v1/oauth/scopes (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;

  beforeAll(async () => {
    const h = await withRealDb();
    if (!h) throw new Error('TEST_DATABASE_URL set but withRealDb returned null');
    handle = h;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetTestData(handle.sql);
    ({ app } = await buildIntegrationApp({ handle }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET returns the seeded canonical scopes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/scopes',
      headers: hmacHeaders({ method: 'GET', url: '/v1/oauth/scopes' }),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain('helpan.read.briefings');
    expect(ids).toContain('kipkiren.write.payments');
    expect(ids).toContain('todoku.write.notifications');
  });

  it('GET filters by rail query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/scopes?rail=todoku',
      headers: hmacHeaders({ method: 'GET', url: '/v1/oauth/scopes?rail=todoku' }),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ rail: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.rail).toBe('todoku');
  });

  it('POST with admin scope creates a new entry and audits', async () => {
    const body = JSON.stringify({
      id: 'test.write.demo',
      name: 'Demo write',
      description: 'For H-6 test only',
      rail: 'helpan',
      category: 'admin',
      default_grantable: false,
      elevation_friction: 'high',
      per_scope_max_ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/scopes',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/oauth/scopes', body }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBe('test.write.demo');
    expect(await countAuditEntries(handle)).toBe(1);
  });

  it('POST without helpan:admin returns 403 AUTH_SCOPE_REQUIRED', async () => {
    const body = JSON.stringify({
      id: 'test.write.denied',
      name: 'should not be created',
      description: 'x',
      rail: 'helpan',
      category: 'admin',
      default_grantable: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/scopes',
      headers: {
        ...hmacHeaders({
          method: 'POST',
          url: '/v1/oauth/scopes',
          body,
          appId: TEST_APP_ID_NO_ADMIN,
          hmacSecret: TEST_HMAC_SECRET_NO_ADMIN,
        }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_REQUIRED');
  });

  it('POST with duplicate id returns 409 OAUTH_SCOPE_EXISTS', async () => {
    const body = JSON.stringify({
      id: 'helpan.read.briefings', // seeded by 0002
      name: 'dup',
      description: 'x',
      rail: 'helpan',
      category: 'read_aggregate',
      default_grantable: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/scopes',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/oauth/scopes', body }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OAUTH_SCOPE_EXISTS');
  });

  it('POST without HMAC at all returns 401 AUTH_HMAC_INVALID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/scopes',
      payload: {
        id: 'test.read.x',
        name: 'x',
        description: 'x',
        rail: 'helpan',
        category: 'read_aggregate',
        default_grantable: true,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  // Reference: TEST_APP_ID has both operator:read and helpan:admin per
  // testApp.makeTestCredentialStore; non-admin uses TEST_APP_ID_NO_ADMIN.
  it('sanity: TEST_APP_ID is the admin tenant', () => {
    expect(TEST_APP_ID).toBe('helpan_test');
  });
});
