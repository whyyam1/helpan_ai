/**
 * /v1/operator/audit — admin-only paginated audit-log query.
 * Seeds entries via the existing public endpoints (briefings + agents) so the
 * test exercises the RLS policy + hash chain that real callers will produce.
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
  generateTestKeypair,
  signCustomerToken,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import {
  buildIntegrationApp,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const hasUrl = !!getTestDatabaseUrl();

async function seedBriefing(
  app: FastifyInstance,
  keypair: TestJwksKeypair
): Promise<string> {
  const token = await signCustomerToken({ keypair, sub: ACCOUNT_A });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/briefings',
    headers: {
      authorization: `Bearer ${token}`,
      'x-app-id': TEST_APP_ID,
      'content-type': 'application/json',
      'x-idempotency-key': randomUUID(),
    },
    payload: {
      account_uuid: ACCOUNT_A,
      app_id: TEST_APP_ID,
      briefing_type: 'alert',
      intent: { match: { x: 1 } },
    },
  });
  if (res.statusCode !== 201) throw new Error(`seedBriefing: ${res.statusCode}`);
  return res.json().data.id as string;
}

async function seedAgent(app: FastifyInstance): Promise<string> {
  const raw = JSON.stringify({
    name: 'Audit Agent',
    agent_class: 'portfolio_app',
    owner_app_id: 'lunchdrop',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/operator/agents',
    headers: {
      ...hmacHeaders({ method: 'POST', url: '/v1/operator/agents', body: raw }),
      'x-idempotency-key': randomUUID(),
    },
    payload: raw,
  });
  if (res.statusCode !== 201) throw new Error(`seedAgent: ${res.statusCode}`);
  return res.json().data.id as string;
}

describe.skipIf(!hasUrl)('GET /v1/operator/audit (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;
  let keypair: TestJwksKeypair;

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
    keypair = generateTestKeypair();
    ({ app } = await buildIntegrationApp({ handle, keypair }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns audit entries seeded by other endpoints', async () => {
    await seedBriefing(app, keypair);
    await seedAgent(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit',
      headers: hmacHeaders({ method: 'GET', url: '/v1/operator/audit' }),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ action: string }>;
    // genesis (excluded by default-no-filter query? No — genesis is included
    // because RLS allows operator and the query doesn't filter it out).
    const actions = items.map((i) => i.action);
    expect(actions).toContain('briefing.create');
    expect(actions).toContain('agent.register');
    expect(actions).toContain('audit_log.genesis');
  });

  it('filters by action', async () => {
    await seedBriefing(app, keypair);
    await seedAgent(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit?action=agent.register',
      headers: hmacHeaders({
        method: 'GET',
        url: '/v1/operator/audit?action=agent.register',
      }),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ action: string }>;
    expect(items.length).toBe(1);
    expect(items[0]?.action).toBe('agent.register');
  });

  it('filters by account_uuid (only user-scoped entries match)', async () => {
    await seedBriefing(app, keypair);
    await seedAgent(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/operator/audit?account_uuid=${ACCOUNT_A}`,
      headers: hmacHeaders({
        method: 'GET',
        url: `/v1/operator/audit?account_uuid=${ACCOUNT_A}`,
      }),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ account_uuid: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.account_uuid).toBe(ACCOUNT_A);
  });

  it('paginates via cursor', async () => {
    // Three briefings yields three briefing.create entries (+ genesis +
    // anything else).
    for (let i = 0; i < 3; i++) await seedBriefing(app, keypair);

    const page1 = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit?limit=2',
      headers: hmacHeaders({ method: 'GET', url: '/v1/operator/audit?limit=2' }),
    });
    expect(page1.statusCode).toBe(200);
    const items1 = page1.json().data.items;
    expect(items1.length).toBe(2);
    const cursor = page1.json().data.next_cursor as string;
    expect(typeof cursor).toBe('string');

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/operator/audit?limit=2&cursor=${encodeURIComponent(cursor)}`,
      headers: hmacHeaders({
        method: 'GET',
        url: `/v1/operator/audit?limit=2&cursor=${encodeURIComponent(cursor)}`,
      }),
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().data.items.length).toBeGreaterThan(0);
    const allIds = new Set([
      ...items1.map((i: { id: string }) => i.id),
      ...page2.json().data.items.map((i: { id: string }) => i.id),
    ]);
    // No duplicates across the two pages.
    expect(allIds.size).toBe(
      items1.length + (page2.json().data.items as Array<unknown>).length
    );
  });

  it('rejects an invalid cursor with 400 REQ_INVALID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit?cursor=not-a-real-cursor',
      headers: hmacHeaders({
        method: 'GET',
        url: '/v1/operator/audit?cursor=not-a-real-cursor',
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });

  it('non-admin tenant gets 403 AUTH_SCOPE_REQUIRED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit',
      headers: hmacHeaders({
        method: 'GET',
        url: '/v1/operator/audit',
        appId: TEST_APP_ID_NO_ADMIN,
        hmacSecret: TEST_HMAC_SECRET_NO_ADMIN,
      }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_REQUIRED');
  });

  it('limit outside [1, 500] is rejected (REQ_INVALID)', async () => {
    // limit=0 fails the regex `^[1-9][0-9]{0,2}$|^500$`.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/audit?limit=0',
      headers: hmacHeaders({ method: 'GET', url: '/v1/operator/audit?limit=0' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });
});
