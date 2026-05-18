/**
 * H-8a — dual-auth on the Console-facing authority endpoints.
 * A customer JWT (the Helpan Console) and an HMAC tenant (consuming-app
 * server / operator) both reach issue / list / detail / revoke; a customer
 * is hard-scoped to their own account. `/validate` stays HMAC-only.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hmacHeaders, TEST_APP_ID } from '../helpers/testApp.js';
import {
  generateTestKeypair,
  signCustomerToken,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import { createInProcessSigner } from '../helpers/testAuthorities.js';
import {
  buildIntegrationApp,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const ACCOUNT_B = 'acc_00000000-0000-0000-0000-000000000002';
const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('Console dual-auth on /v1/authorities (real Postgres)', () => {
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
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      authoritySigner: createInProcessSigner(keypair),
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  /** Customer-JWT (Console) headers for ACCOUNT_A unless `sub` overridden. */
  async function consoleHeaders(sub = ACCOUNT_A): Promise<Record<string, string>> {
    const token = await signCustomerToken({ keypair, sub });
    return {
      authorization: `Bearer ${token}`,
      'x-app-id': TEST_APP_ID,
      'content-type': 'application/json',
    };
  }

  async function registerAgent(): Promise<string> {
    const raw = JSON.stringify({
      name: 'Console Test Agent',
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
    return res.json().data.id as string;
  }

  /** Issue a read-only authority via the HMAC service path. */
  async function issueHmac(agentId: string, account: string): Promise<string> {
    const body = JSON.stringify({
      account_uuid: account,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/authorities', body }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    if (res.statusCode !== 201) throw new Error(`issueHmac: ${res.statusCode} ${res.body}`);
    return res.json().data.id as string;
  }

  it('HMAC issue still works (dual-auth leaves the service path intact)', async () => {
    const agentId = await registerAgent();
    const id = await issueHmac(agentId, ACCOUNT_A);
    expect(id).toMatch(/^daa_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('customer-JWT GET /v1/authorities returns only the caller\'s authorities', async () => {
    const agentId = await registerAgent();
    await issueHmac(agentId, ACCOUNT_A);
    await issueHmac(agentId, ACCOUNT_A);
    await issueHmac(agentId, ACCOUNT_B);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/authorities',
      headers: await consoleHeaders(ACCOUNT_A),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ account_uuid: string }>;
    expect(items.length).toBe(2);
    for (const i of items) expect(i.account_uuid).toBe(ACCOUNT_A);
  });

  it('customer-JWT cannot widen scope via an account_uuid query param', async () => {
    const agentId = await registerAgent();
    await issueHmac(agentId, ACCOUNT_B);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/authorities?account_uuid=${ACCOUNT_B}`,
      headers: await consoleHeaders(ACCOUNT_A),
    });
    expect(res.statusCode).toBe(200);
    // account_uuid query is ignored for a customer — scoped to ACCOUNT_A.
    expect(res.json().data.items).toEqual([]);
  });

  it('customer-JWT GET /:id — 200 for own, 404 for another customer\'s', async () => {
    const agentId = await registerAgent();
    const ownId = await issueHmac(agentId, ACCOUNT_A);
    const otherId = await issueHmac(agentId, ACCOUNT_B);

    const own = await app.inject({
      method: 'GET',
      url: `/v1/authorities/${ownId}`,
      headers: await consoleHeaders(ACCOUNT_A),
    });
    expect(own.statusCode).toBe(200);

    const other = await app.inject({
      method: 'GET',
      url: `/v1/authorities/${otherId}`,
      headers: await consoleHeaders(ACCOUNT_A),
    });
    expect(other.statusCode).toBe(404);
  });

  it('customer-JWT revoke of own authority → 200, audited as helpan_console.revoke / user', async () => {
    const agentId = await registerAgent();
    const id = await issueHmac(agentId, ACCOUNT_A);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/authorities/${id}/revoke`,
      headers: {
        ...(await consoleHeaders(ACCOUNT_A)),
        'x-idempotency-key': randomUUID(),
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('revoked');

    const auditRow = (await handle.sql`
      SELECT action, actor_type, actor_id
      FROM audit_log WHERE action = 'helpan_console.revoke'
    `) as unknown as { action: string; actor_type: string; actor_id: string }[];
    expect(auditRow).toHaveLength(1);
    expect(auditRow[0]?.actor_type).toBe('user');
    expect(auditRow[0]?.actor_id).toBe(ACCOUNT_A);
  });

  it('customer-JWT revoke of another customer\'s authority → 404', async () => {
    const agentId = await registerAgent();
    const otherId = await issueHmac(agentId, ACCOUNT_B);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/authorities/${otherId}/revoke`,
      headers: {
        ...(await consoleHeaders(ACCOUNT_A)),
        'x-idempotency-key': randomUUID(),
      },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUTHORITY_NOT_FOUND');
  });

  it('customer-JWT grant → 201, audited as helpan_console.grant', async () => {
    const agentId = await registerAgent();
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: {
        ...(await consoleHeaders(ACCOUNT_A)),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(201);

    const auditRow = (await handle.sql`
      SELECT actor_type FROM audit_log WHERE action = 'helpan_console.grant'
    `) as unknown as { actor_type: string }[];
    expect(auditRow).toHaveLength(1);
    expect(auditRow[0]?.actor_type).toBe('user');
  });

  it('customer-JWT grant for a different account_uuid → 403 AUTH_ACCOUNT_MISMATCH', async () => {
    const agentId = await registerAgent();
    const body = JSON.stringify({
      account_uuid: ACCOUNT_B, // not the caller
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: {
        ...(await consoleHeaders(ACCOUNT_A)),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_ACCOUNT_MISMATCH');
  });

  it('a Bearer token on /validate is rejected — /validate stays HMAC-only', async () => {
    const agentId = await registerAgent();
    const id = await issueHmac(agentId, ACCOUNT_A);
    const body = JSON.stringify({ token: 'x', intended_operation: 'helpan.read.briefings' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/authorities/${id}/validate`,
      headers: { ...(await consoleHeaders(ACCOUNT_A)) },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('no auth at all on /v1/authorities → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/authorities' });
    expect(res.statusCode).toBe(401);
  });
});
