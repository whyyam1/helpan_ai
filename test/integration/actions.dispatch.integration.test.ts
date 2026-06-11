/**
 * POST /v1/actions/dispatch — H-4 dispatch happy path + rejection paths.
 * Real Postgres + in-memory dispatcher + in-process authority signer.
 *
 * Verifies the cross-rail audit invariant (§A.11):
 *   - One `action.dispatch` audit row at the start.
 *   - One `action.complete` (or `action.fail`) audit row at the end.
 *   - Both rows carry agent_id, delegated_authority_jti, target_rail,
 *     target_operation, business_op_id, traceparent.
 *   - The two rows share a `business_op_id` and a `traceparent`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hmacHeaders, TEST_APP_ID_NO_ADMIN, TEST_HMAC_SECRET_NO_ADMIN } from '../helpers/testApp.js';
import {
  generateTestKeypair,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import { createInProcessSigner } from '../helpers/testAuthorities.js';
import {
  buildIntegrationApp,
  drainTestOutbox,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import { createInMemoryProducer, type InMemoryProducer } from '../../src/lib/kafka/producer.js';
import {
  createInMemoryDispatcher,
  type InMemoryDispatcher,
} from '../../src/lib/dispatchers/inMemoryDispatcher.js';
import { createUnconfiguredDispatcher } from '../../src/lib/dispatchers/dispatcher.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const ACCOUNT_B = 'acc_00000000-0000-0000-0000-000000000002';
const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('POST /v1/actions/dispatch (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;
  let kafka: InMemoryProducer;
  let keypair: TestJwksKeypair;
  let kpDispatcher: InMemoryDispatcher;

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
    kpDispatcher = createInMemoryDispatcher({ rail: 'kipkiren_pay' });
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      kafkaProducer: kafka,
      authoritySigner: createInProcessSigner(keypair),
      dispatchers: {
        kipkiren_pay: kpDispatcher,
        todoku: createInMemoryDispatcher({ rail: 'todoku' }),
        identiti: createUnconfiguredDispatcher('identiti'),
      },
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  /** Register an agent + issue an authority for it, return { agentId, daaId, token }. */
  async function setupAuthority(opts: {
    scopeId: string;
    account?: string;
    ttlSeconds?: number;
    amountLimitMinor?: number;
    perPeriodLimitMinor?: number;
    period?: 'daily' | 'monthly' | 'weekly' | 'single_use';
  }): Promise<{ agentId: string; daaId: string; token: string }> {
    const agentBody = JSON.stringify({
      name: 'Dispatch Test Agent',
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
    if (agentRes.statusCode !== 201) throw new Error(`agent: ${agentRes.statusCode} ${agentRes.body}`);
    const agentId = agentRes.json().data.id as string;

    const scope: Record<string, unknown> = { scope_id: opts.scopeId };
    if (opts.amountLimitMinor !== undefined) scope['amount_limit_minor'] = opts.amountLimitMinor;
    if (opts.perPeriodLimitMinor !== undefined) {
      scope['per_period_limit_minor'] = opts.perPeriodLimitMinor;
    }
    if (opts.period !== undefined) scope['period'] = opts.period;

    const issueBody = JSON.stringify({
      account_uuid: opts.account ?? ACCOUNT_A,
      agent_id: agentId,
      scopes: [scope],
      ttl_seconds: opts.ttlSeconds ?? 3600,
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
    if (issueRes.statusCode !== 201) throw new Error(`issue: ${issueRes.statusCode} ${issueRes.body}`);
    const issued = issueRes.json().data;
    return { agentId, daaId: issued.id as string, token: issued.token as string };
  }

  function dispatchHeaders(body: string, token: string): Record<string, string> {
    return {
      ...hmacHeaders({ method: 'POST', url: '/v1/actions/dispatch', body }),
      'x-idempotency-key': randomUUID(),
      'x-delegated-authority': token,
      traceparent: '00-0000000000000000000000000000abcd-0000000000001234-01',
    };
  }

  it('happy path — dispatches, persists, audits, increments usage', async () => {
    const { agentId, daaId, token } = await setupAuthority({
      scopeId: 'helpan.read.briefings',
    });

    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: { briefing_id: 'brf_test' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.id).toMatch(/^act_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(data.status).toBe('completed');
    expect(data.agent_id).toBe(agentId);
    expect(data.delegated_authority_jti).toBe(daaId);
    expect(data.target_rail).toBe('kipkiren_pay');
    expect(data.target_operation).toBe('helpan.read.briefings');
    expect(typeof data.business_op_id).toBe('string');
    expect(data.traceparent).toBe('00-0000000000000000000000000000abcd-0000000000001234-01');

    // dispatcher was called once with the propagated context
    expect(kpDispatcher.calls.length).toBe(1);
    const call = kpDispatcher.calls[0]!;
    expect(call.targetOperation).toBe('helpan.read.briefings');
    expect(call.delegatedAuthorityJwt).toBe(token);
    expect(call.businessOpId).toBe(data.business_op_id);

    // two audit entries (dispatch + complete), both with §A.11 fields
    const auditRows = (await handle.sql`
      SELECT action, agent_id, delegated_authority_jti, target_rail,
             target_operation, business_op_id, traceparent
      FROM audit_log
      WHERE action IN ('action.dispatch', 'action.complete')
      ORDER BY created_at ASC, id ASC
    `) as unknown as readonly {
      action: string;
      agent_id: string;
      delegated_authority_jti: string;
      target_rail: string;
      target_operation: string;
      business_op_id: string;
      traceparent: string;
    }[];
    expect(auditRows.length).toBe(2);
    expect(auditRows[0]!.action).toBe('action.dispatch');
    expect(auditRows[1]!.action).toBe('action.complete');
    for (const row of auditRows) {
      expect(row.agent_id).toBe(agentId);
      expect(row.delegated_authority_jti).toBe(daaId);
      expect(row.target_rail).toBe('kipkiren_pay');
      expect(row.target_operation).toBe('helpan.read.briefings');
      expect(row.business_op_id).toBe(data.business_op_id);
      expect(row.traceparent).toBe('00-0000000000000000000000000000abcd-0000000000001234-01');
    }

    // usage incremented
    const usage = (await handle.sql`
      SELECT cumulative_minor::text AS cumulative, call_count
      FROM authority_usage
      WHERE authority_id = ${daaId}
    `) as unknown as readonly { cumulative: string; call_count: number }[];
    expect(usage.length).toBe(1);
    expect(usage[0]!.call_count).toBe(1);
    expect(usage[0]!.cumulative).toBe('0'); // no amount supplied

    // ACTION_DISPATCHED + ACTION_COMPLETED published (H-17: drained from outbox)
    await drainTestOutbox(handle, kafka);
    const types = kafka.published.map((m) => m.value['event_type']);
    expect(types).toContain('ACTION_DISPATCHED');
    expect(types).toContain('ACTION_COMPLETED');
  });

  it('amount_minor exceeds per-call ceiling → 422 AUTHORITY_LIMIT_EXCEEDED', async () => {
    // Use a non-high-stakes scope so the authority issues without a step-up
    // token. amount_limit_minor lives on the AUTHORITY scope, not on the
    // catalogue row — any scope id works as the carrier here.
    const { token } = await setupAuthority({
      scopeId: 'helpan.read.briefings',
      amountLimitMinor: 100_000,
    });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: { merchant_id: 'mch_test' },
      amount_minor: 200_000,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('AUTHORITY_LIMIT_EXCEEDED');
    expect(kpDispatcher.calls.length).toBe(0); // outbound never fires
  });

  it('scope mismatch → 403 AUTH_SCOPE_NOT_COVERED', async () => {
    const { token } = await setupAuthority({ scopeId: 'helpan.read.briefings' });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'kipkiren.write.payments', // not on the authority
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_NOT_COVERED');
    expect(kpDispatcher.calls.length).toBe(0);
  });

  it('account mismatch (body says one account, authority is bound to another) → 403 ACTION_ACCOUNT_MISMATCH', async () => {
    const { token } = await setupAuthority({
      scopeId: 'helpan.read.briefings',
      account: ACCOUNT_A,
    });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_B, // not the authority's account
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACTION_ACCOUNT_MISMATCH');
  });

  it('missing X-Delegated-Authority → 401 AUTH_AUTHORITY_MISSING', async () => {
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/actions/dispatch', body }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_AUTHORITY_MISSING');
  });

  it('garbage X-Delegated-Authority → 401 AUTH_AUTHORITY_MALFORMED', async () => {
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, 'not-a-jwt'),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_AUTHORITY_MALFORMED');
  });

  it('non-admin HMAC tenant → 403 AUTH_SCOPE_REQUIRED', async () => {
    const { token } = await setupAuthority({ scopeId: 'helpan.read.briefings' });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: {
        ...hmacHeaders({
          method: 'POST',
          url: '/v1/actions/dispatch',
          body,
          appId: TEST_APP_ID_NO_ADMIN,
          hmacSecret: TEST_HMAC_SECRET_NO_ADMIN,
        }),
        'x-idempotency-key': randomUUID(),
        'x-delegated-authority': token,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_REQUIRED');
  });

  it('idempotency key replay returns the cached completed response', async () => {
    const { token } = await setupAuthority({ scopeId: 'helpan.read.briefings' });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: { note: 'replay-me' },
    });
    const idempotencyKey = randomUUID();
    const headers = {
      ...hmacHeaders({ method: 'POST', url: '/v1/actions/dispatch', body }),
      'x-idempotency-key': idempotencyKey,
      'x-delegated-authority': token,
    };
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers,
      payload: body,
    });
    expect(res1.statusCode).toBe(200);
    const action1 = res1.json().data;

    // Same key + same body → same action returned, dispatcher NOT called twice.
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: { ...headers, 'x-idempotency-key': idempotencyKey },
      payload: body,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-idempotency-replayed']).toBeDefined();
    const action2 = res2.json().data;
    expect(action2.id).toBe(action1.id);
    expect(kpDispatcher.calls.length).toBe(1); // not duplicated
  });

  it('TARGET_RAIL_UNCONFIGURED — identiti dispatcher is the unconfigured sentinel; action persists as failed', async () => {
    const { token, daaId } = await setupAuthority({ scopeId: 'helpan.read.briefings' });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'identiti',
      target_operation: 'helpan.read.briefings',
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe('failed');
    expect(data.error_code).toBe('TARGET_RAIL_UNCONFIGURED');

    // action.fail audit entry chained
    const failRow = (await handle.sql`
      SELECT action FROM audit_log WHERE action = 'action.fail' AND resource_id = ${data.id}
    `) as unknown as readonly { action: string }[];
    expect(failRow.length).toBe(1);

    // usage still incremented (single-spend semantics §A.1)
    const usage = (await handle.sql`
      SELECT call_count FROM authority_usage WHERE authority_id = ${daaId}
    `) as unknown as readonly { call_count: number }[];
    expect(usage[0]?.call_count).toBe(1);
  });

  it('payload PII is redacted before persistence', async () => {
    const { token } = await setupAuthority({ scopeId: 'helpan.read.briefings' });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      target_rail: 'kipkiren_pay',
      target_operation: 'helpan.read.briefings',
      payload: {
        recipient_phone: '+254712345678',
        amount_minor: 480_00,
        note: 'order at PowerMama',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/actions/dispatch',
      headers: dispatchHeaders(body, token),
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    // Persisted payload: PII key replaced
    const data = res.json().data;
    expect(data.request_payload['recipient_phone']).toBe('[REDACTED]');
    expect(data.request_payload['amount_minor']).toBe(48000);

    // The outbound dispatcher saw the ORIGINAL (un-redacted) payload — only
    // Helpan-side persistence redacts. The relying rail needs the real value.
    expect(kpDispatcher.calls[0]!.payload['recipient_phone']).toBe('+254712345678');
  });
});
