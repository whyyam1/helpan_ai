/**
 * GET /v1/actions + GET /v1/actions/:id — H-4 read endpoints. Dual-auth:
 * the Console reads via customer JWT (hard-scoped to its own account_uuid);
 * operators / consuming apps read via HMAC.
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
import { createInMemoryProducer, type InMemoryProducer } from '../../src/lib/kafka/producer.js';
import { createInMemoryDispatcher } from '../../src/lib/dispatchers/inMemoryDispatcher.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const ACCOUNT_B = 'acc_00000000-0000-0000-0000-000000000002';
const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('GET /v1/actions + GET /v1/actions/:id (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;
  let kafka: InMemoryProducer;
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
    kafka = createInMemoryProducer();
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      kafkaProducer: kafka,
      authoritySigner: createInProcessSigner(keypair),
      dispatchers: {
        kipkiren_pay: createInMemoryDispatcher({ rail: 'kipkiren_pay' }),
        todoku: createInMemoryDispatcher({ rail: 'todoku' }),
        identiti: createInMemoryDispatcher({ rail: 'identiti' }),
      },
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  /** Issue + dispatch in one helper. Returns the persisted action id. */
  async function seedDispatch(account: string): Promise<string> {
    const agentBody = JSON.stringify({
      name: `Agent ${account}`,
      agent_class: 'portfolio_app',
      owner_app_id: 'lunchdrop',
    });
    const agentRes = await app.inject({
      method: 'POST',
      url: '/v1/operator/agents',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/operator/agents', body: agentBody }),
        'x-idempotency-key': randomUUID(),
      },
      payload: agentBody,
    });
    const agentId = agentRes.json().data.id as string;

    const issueBody = JSON.stringify({
      account_uuid: account,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const issueRes = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/authorities', body: issueBody }),
        'x-idempotency-key': randomUUID(),
      },
      payload: issueBody,
    });
    const token = issueRes.json().data.token as string;

    const dispatchBody = JSON.stringify({
      account_uuid: account,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const dispatchRes = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/actions/dispatch', body: dispatchBody }),
        'x-idempotency-key': randomUUID(),
        'x-delegated-authority': token,
      },
      payload: dispatchBody,
    });
    return dispatchRes.json().data.id as string;
  }

  it('HMAC list returns all actions across accounts when no account filter set', async () => {
    await seedDispatch(ACCOUNT_A);
    await seedDispatch(ACCOUNT_A);
    await seedDispatch(ACCOUNT_B);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/actions',
      headers: hmacHeaders({ method: 'GET', url: '/v1/actions' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items.length).toBe(3);
  });

  it('HMAC list filters by account_uuid query', async () => {
    await seedDispatch(ACCOUNT_A);
    await seedDispatch(ACCOUNT_A);
    await seedDispatch(ACCOUNT_B);

    const url = `/v1/actions?account_uuid=${ACCOUNT_B}`;
    const res = await app.inject({
      method: 'GET',
      url,
      headers: hmacHeaders({ method: 'GET', url }),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ account_uuid: string }>;
    expect(items.length).toBe(1);
    expect(items[0]!.account_uuid).toBe(ACCOUNT_B);
  });

  it("customer-JWT list returns only the caller's actions and ignores account_uuid query", async () => {
    await seedDispatch(ACCOUNT_A);
    await seedDispatch(ACCOUNT_B);

    const token = await signCustomerToken({ keypair, sub: ACCOUNT_A });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/actions?account_uuid=${ACCOUNT_B}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-app-id': TEST_APP_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ account_uuid: string }>;
    expect(items.length).toBe(1);
    expect(items[0]!.account_uuid).toBe(ACCOUNT_A);
  });

  it('GET /:id — 200 for HMAC; customer JWT 200 for own, 404 for another', async () => {
    const ownId = await seedDispatch(ACCOUNT_A);
    const otherId = await seedDispatch(ACCOUNT_B);

    // HMAC operator sees both
    const hmacOwn = await app.inject({
      method: 'GET',
      url: `/v1/actions/${ownId}`,
      headers: hmacHeaders({ method: 'GET', url: `/v1/actions/${ownId}` }),
    });
    expect(hmacOwn.statusCode).toBe(200);

    // Customer sees only their own
    const token = await signCustomerToken({ keypair, sub: ACCOUNT_A });
    const headers = {
      authorization: `Bearer ${token}`,
      'x-app-id': TEST_APP_ID,
    };
    const own = await app.inject({
      method: 'GET',
      url: `/v1/actions/${ownId}`,
      headers,
    });
    expect(own.statusCode).toBe(200);
    const other = await app.inject({
      method: 'GET',
      url: `/v1/actions/${otherId}`,
      headers,
    });
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('ACTION_NOT_FOUND');
  });
});
