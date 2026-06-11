/**
 * Cascade-revocation worker core — H-3b.
 * `handleAccountEvent` exercised directly against real Postgres; authorities
 * are seeded through the live issuance endpoint so the cascade runs on real
 * rows + scope classifications.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hmacHeaders } from '../helpers/testApp.js';
import {
  generateTestKeypair,
  signStepUpToken,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import { createInProcessSigner } from '../helpers/testAuthorities.js';
import {
  buildIntegrationApp,
  countAuditEntries,
  drainTestOutbox,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import { createInMemoryProducer, type InMemoryProducer } from '../../src/lib/kafka/producer.js';
import {
  handleAccountEvent,
  isTierDowngrade,
} from '../../src/workers/cascadeRevocation/cascade.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const ACCOUNT_B = 'acc_00000000-0000-0000-0000-000000000002';
const hasUrl = !!getTestDatabaseUrl();

describe('isTierDowngrade (unit)', () => {
  it('detects a downgrade', () => {
    expect(isTierDowngrade('tier_2', 'tier_1')).toBe(true);
    expect(isTierDowngrade('tier_1', 'tier_0')).toBe(true);
  });
  it('rejects an upgrade or no-change', () => {
    expect(isTierDowngrade('tier_0', 'tier_2')).toBe(false);
    expect(isTierDowngrade('tier_1', 'tier_1')).toBe(false);
  });
  it('rejects missing or unknown tiers', () => {
    expect(isTierDowngrade(undefined, 'tier_0')).toBe(false);
    expect(isTierDowngrade('tier_1', undefined)).toBe(false);
    expect(isTierDowngrade('tier_9', 'tier_0')).toBe(false);
  });
});

describe.skipIf(!hasUrl)('handleAccountEvent (real Postgres)', () => {
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
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerAgent(): Promise<string> {
    const raw = JSON.stringify({
      name: 'Cascade Test Agent',
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

  async function issueReadOnly(agentId: string, account: string): Promise<string> {
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
    if (res.statusCode !== 201) throw new Error(`issueReadOnly: ${res.statusCode} ${res.body}`);
    return res.json().data.id as string;
  }

  async function issueMoney(agentId: string, account: string): Promise<string> {
    const stepUp = await signStepUpToken({ keypair, sub: account });
    const body = JSON.stringify({
      account_uuid: account,
      agent_id: agentId,
      scopes: [
        { scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 },
      ],
      ttl_seconds: 3600,
      step_up_token: stepUp,
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
    if (res.statusCode !== 201) throw new Error(`issueMoney: ${res.statusCode} ${res.body}`);
    return res.json().data.id as string;
  }

  async function statusOf(id: string): Promise<string> {
    const rows = (await handle.sql`
      SELECT status FROM delegated_authorities WHERE id = ${id}
    `) as unknown as { status: string }[];
    return rows[0]?.status ?? 'missing';
  }

  it('ACCOUNT_SUSPENDED revokes every active authority for the account', async () => {
    const agentId = await registerAgent();
    const a1 = await issueReadOnly(agentId, ACCOUNT_A);
    const a2 = await issueMoney(agentId, ACCOUNT_A);

    const result = await handleAccountEvent(
      { db: handle.db, kafka },
      { event_type: 'ACCOUNT_SUSPENDED', account_uuid: ACCOUNT_A },
      'req_test_suspend'
    );
    expect(result.trigger).toBe('account_suspended');
    expect(result.revoked).toBe(2);
    expect(await statusOf(a1)).toBe('revoked');
    expect(await statusOf(a2)).toBe('revoked');
  });

  it('ACCOUNT_SUSPENDED leaves other accounts untouched', async () => {
    const agentId = await registerAgent();
    const aA = await issueReadOnly(agentId, ACCOUNT_A);
    const aB = await issueReadOnly(agentId, ACCOUNT_B);

    await handleAccountEvent(
      { db: handle.db, kafka },
      { event_type: 'ACCOUNT_SUSPENDED', account_uuid: ACCOUNT_A },
      'req_test'
    );
    expect(await statusOf(aA)).toBe('revoked');
    expect(await statusOf(aB)).toBe('active');
  });

  it('TIER_CHANGED downgrade revokes high-stakes authorities only', async () => {
    const agentId = await registerAgent();
    const readOnly = await issueReadOnly(agentId, ACCOUNT_A);
    const money = await issueMoney(agentId, ACCOUNT_A);

    const result = await handleAccountEvent(
      { db: handle.db, kafka },
      {
        event_type: 'TIER_CHANGED',
        account_uuid: ACCOUNT_A,
        from_tier: 'tier_2',
        to_tier: 'tier_1',
      },
      'req_test_downgrade'
    );
    expect(result.trigger).toBe('kyc_downgraded');
    expect(result.revoked).toBe(1);
    expect(await statusOf(money)).toBe('revoked');
    expect(await statusOf(readOnly)).toBe('active');
  });

  it('TIER_CHANGED upgrade is ignored — no revocations', async () => {
    const agentId = await registerAgent();
    const a1 = await issueMoney(agentId, ACCOUNT_A);
    const result = await handleAccountEvent(
      { db: handle.db, kafka },
      {
        event_type: 'TIER_CHANGED',
        account_uuid: ACCOUNT_A,
        from_tier: 'tier_0',
        to_tier: 'tier_2',
      },
      'req_test_upgrade'
    );
    expect(result.trigger).toBe('ignored');
    expect(result.revoked).toBe(0);
    expect(await statusOf(a1)).toBe('active');
  });

  it('publishes AUTHORITY_REVOKED per revoked authority + writes audit entries', async () => {
    const agentId = await registerAgent();
    await issueReadOnly(agentId, ACCOUNT_A);
    await issueReadOnly(agentId, ACCOUNT_A);
    // H-17: drain the two AUTHORITY_ISSUED outbox entries first.
    await drainTestOutbox(handle, kafka);
    kafka.clear(); // drop the two AUTHORITY_ISSUED publishes

    const auditBefore = await countAuditEntries(handle);
    const result = await handleAccountEvent(
      { db: handle.db, kafka },
      { event_type: 'ACCOUNT_SUSPENDED', account_uuid: ACCOUNT_A, traceparent: '00-abc-def-01' },
      'req_test_publish'
    );
    expect(result.revoked).toBe(2);
    await drainTestOutbox(handle, kafka);
    expect(kafka.published).toHaveLength(2);
    for (const m of kafka.published) {
      expect(m.topic).toBe('helpan.authority.events');
      expect(m.value).toMatchObject({
        event_type: 'AUTHORITY_REVOKED',
        reason: 'account_suspended',
      });
    }
    expect(await countAuditEntries(handle)).toBe(auditBefore + 2);
  });

  it('is idempotent — a redelivered event revokes nothing the second time', async () => {
    const agentId = await registerAgent();
    await issueReadOnly(agentId, ACCOUNT_A);
    const event = { event_type: 'ACCOUNT_SUSPENDED', account_uuid: ACCOUNT_A };

    const first = await handleAccountEvent({ db: handle.db, kafka }, event, 'req_1');
    const second = await handleAccountEvent({ db: handle.db, kafka }, event, 'req_2');
    expect(first.revoked).toBe(1);
    expect(second.revoked).toBe(0);
  });

  it('ignores unrelated event types', async () => {
    const agentId = await registerAgent();
    const a1 = await issueReadOnly(agentId, ACCOUNT_A);
    const result = await handleAccountEvent(
      { db: handle.db, kafka },
      { event_type: 'ACCOUNT_REACTIVATED', account_uuid: ACCOUNT_A },
      'req_test'
    );
    expect(result.trigger).toBe('ignored');
    expect(result.revoked).toBe(0);
    expect(await statusOf(a1)).toBe('active');
  });
});
