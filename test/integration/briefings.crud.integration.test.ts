/**
 * End-to-end CRUD + RLS + audit chain + deep-health probe — real Postgres.
 *
 * Activation: set TEST_DATABASE_URL to a Postgres 16 instance the test
 * process can reach. The whole suite skips itself otherwise so the always-
 * green stub-DB suite is unaffected.
 *
 * Each test resets the briefings table and the audit_log non-genesis rows
 * via `resetTestData` before running, so the order tests run in is
 * irrelevant.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TEST_APP_ID } from '../helpers/testApp.js';
import {
  generateTestKeypair,
  signCustomerToken,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import {
  buildIntegrationApp,
  countAuditEntries,
  countBriefings,
  getTestDatabaseUrl,
  readAuditChain,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import { createHash } from 'node:crypto';
import { buildCanonicalString, signRequest } from '@kmv/platform-shared/hmac';
import { TEST_HMAC_SECRET } from '../helpers/testApp.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const ACCOUNT_B = 'acc_00000000-0000-0000-0000-000000000002';

const hasUrl = !!getTestDatabaseUrl();

async function authHeaders(
  keypair: TestJwksKeypair,
  sub: string,
  extra: Record<string, string> = {}
): Promise<Record<string, string>> {
  const token = await signCustomerToken({ keypair, sub });
  return {
    authorization: `Bearer ${token}`,
    'x-app-id': TEST_APP_ID,
    'content-type': 'application/json',
    ...extra,
  };
}

function randomUuidV4(): string {
  // Crypto-random UUIDv4 — deterministic uniqueness; no library needed.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hmacHeaders(
  method: string,
  url: string,
  body = ''
): Record<string, string> {
  const ts = new Date().toISOString();
  const contentType = body ? 'application/json; charset=utf-8' : '';
  const canonical = buildCanonicalString({
    method,
    pathAndQuery: url,
    contentType,
    timestamp: ts,
    bodySha256Hex: createHash('sha256').update(body, 'utf8').digest('hex'),
  });
  const sig = signRequest(canonical, TEST_HMAC_SECRET);
  const h: Record<string, string> = {
    authorization: `Helpan-HMAC-SHA256 app_id=${TEST_APP_ID}, signature=${sig}`,
    'x-helpan-timestamp': ts,
  };
  if (contentType) h['content-type'] = contentType;
  return h;
}

describe.skipIf(!hasUrl)('briefings CRUD + RLS + audit (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;
  let keypair: TestJwksKeypair;

  beforeAll(async () => {
    const h = await withRealDb();
    if (!h) throw new Error('TEST_DATABASE_URL was set but withRealDb returned null');
    handle = h;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetTestData(handle.sql);
    keypair = generateTestKeypair();
    ({ app } = await buildIntegrationApp({ handle, keypair }));
  });

  afterEach(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // Happy-path CRUD
  // --------------------------------------------------------------------------
  it('POST /v1/briefings creates an active briefing and returns 201 with brf_<ULID>', async () => {
    const headers = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: { kind: 'demo', threshold: 100 },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^brf_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.data.account_uuid).toBe(ACCOUNT_A);
    expect(body.data.status).toBe('active');
    expect(body.data.intent).toEqual({ kind: 'demo', threshold: 100 });
    expect(await countBriefings(handle)).toBe(1);
  });

  it('GET /v1/briefings/:id returns the briefing for the owner', async () => {
    const headers = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    const id = create.json().data.id;

    const readHeaders = await authHeaders(keypair, ACCOUNT_A);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/briefings/${id}`,
      headers: readHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
  });

  it('PATCH /v1/briefings/:id updates status + intent and bumps updated_at', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: { v: 1 },
      },
    });
    const id = create.json().data.id;
    const beforeUpdated = create.json().data.updated_at;

    // Force a measurable delta on updated_at.
    await new Promise((r) => setTimeout(r, 5));

    const patchHeaders = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/briefings/${id}`,
      headers: patchHeaders,
      payload: { status: 'paused', intent: { v: 2 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('paused');
    expect(res.json().data.intent).toEqual({ v: 2 });
    expect(res.json().data.updated_at >= beforeUpdated).toBe(true);
  });

  it('DELETE /v1/briefings/:id soft-revokes (status=revoked, GET still returns row)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    const id = create.json().data.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_A),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.status).toBe('revoked');
  });

  it('GET /v1/briefings lists the user\'s rows; pagination cursor round-trips', async () => {
    const idemHeaders = async () =>
      authHeaders(keypair, ACCOUNT_A, { 'x-idempotency-key': randomUuidV4() });
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/briefings',
        headers: await idemHeaders(),
        payload: {
          account_uuid: ACCOUNT_A,
          app_id: TEST_APP_ID,
          briefing_type: 'alert',
          intent: { i },
        },
      });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/v1/briefings?limit=2',
      headers: await authHeaders(keypair, ACCOUNT_A),
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().data.items.length).toBe(2);
    const cursor = page1.json().data.next_cursor as string;
    expect(typeof cursor).toBe('string');

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/briefings?limit=2&cursor=${encodeURIComponent(cursor)}`,
      headers: await authHeaders(keypair, ACCOUNT_A),
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().data.items.length).toBe(1);
    expect(page2.json().data.next_cursor).toBeNull();
  });

  // --------------------------------------------------------------------------
  // RLS isolation
  // --------------------------------------------------------------------------
  it('Customer B cannot read Customer A\'s briefing — returns 404', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    const id = create.json().data.id;

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_B),
    });
    expect(cross.statusCode).toBe(404);
  });

  it('Customer B cannot PATCH or DELETE Customer A\'s briefing — both return 404', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    const id = create.json().data.id;

    const patchAcrossCustomer = await app.inject({
      method: 'PATCH',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_B, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: { status: 'paused' },
    });
    expect(patchAcrossCustomer.statusCode).toBe(404);

    const deleteAcrossCustomer = await app.inject({
      method: 'DELETE',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_B, {
        'x-idempotency-key': randomUuidV4(),
      }),
    });
    expect(deleteAcrossCustomer.statusCode).toBe(404);

    // The original briefing must still exist for Customer A.
    expect(await countBriefings(handle)).toBe(1);
  });

  it('POST with body.account_uuid != JWT.sub returns 403 AUTH_ACCOUNT_MISMATCH', async () => {
    const headers = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_B, // mismatched
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_ACCOUNT_MISMATCH');
  });

  // --------------------------------------------------------------------------
  // AJV rejection
  // --------------------------------------------------------------------------
  it('POST with invalid briefing_type returns 400 REQ_INVALID', async () => {
    const headers = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'totally_invalid_type',
        intent: {},
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });

  it('POST missing required field returns 400 REQ_INVALID', async () => {
    const headers = await authHeaders(keypair, ACCOUNT_A, {
      'x-idempotency-key': randomUuidV4(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers,
      payload: {
        // account_uuid omitted
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });

  // --------------------------------------------------------------------------
  // Audit chain
  // --------------------------------------------------------------------------
  it('Create + Update + Revoke produce a continuous audit hash chain', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/briefings',
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: {
        account_uuid: ACCOUNT_A,
        app_id: TEST_APP_ID,
        briefing_type: 'alert',
        intent: {},
      },
    });
    const id = create.json().data.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
      payload: { status: 'paused' },
    });

    await app.inject({
      method: 'DELETE',
      url: `/v1/briefings/${id}`,
      headers: await authHeaders(keypair, ACCOUNT_A, {
        'x-idempotency-key': randomUuidV4(),
      }),
    });

    expect(await countAuditEntries(handle)).toBe(3);

    const chain = await readAuditChain(handle);
    // First row is genesis (previous_hash = NULL).
    expect(chain[0]?.action).toBe('audit_log.genesis');
    expect(chain[0]?.previous_hash).toBeNull();

    // Each subsequent row's previous_hash equals the prior row's entry_hash.
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]?.previous_hash).toBe(chain[i - 1]?.entry_hash);
    }

    // Three real entries are tagged with our briefing actions, in order.
    const realActions = chain.slice(1).map((r) => r.action);
    expect(realActions).toEqual(['briefing.create', 'briefing.update', 'briefing.revoke']);

    // All real entries point at the same resource_id.
    for (const row of chain.slice(1)) {
      expect(row.resource_id).toBe(id);
    }
  });

  // --------------------------------------------------------------------------
  // Deep-health briefings probe
  // --------------------------------------------------------------------------
  it('GET /v1/health/deep reports briefings=healthy when the table is queryable', async () => {
    const headers = hmacHeaders('GET', '/v1/health/deep');
    const res = await app.inject({ method: 'GET', url: '/v1/health/deep', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().components.briefings).toBe('healthy');
    expect(res.json().components.database).toBe('healthy');
  });
});
