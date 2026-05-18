/**
 * POST /v1/authorities — delegated-authority issuance. Real Postgres, with
 * the in-process signer standing in for Identiti's /v1/internal/sign.
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
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import { createInMemoryProducer, type InMemoryProducer } from '../../src/lib/kafka/producer.js';
import type { DelegatedAuthoritySigner } from '../../src/lib/identitiSigner.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const hasUrl = !!getTestDatabaseUrl();

async function registerAgent(app: FastifyInstance): Promise<string> {
  const raw = JSON.stringify({
    name: 'Issuance Test Agent',
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
  if (res.statusCode !== 201) throw new Error(`registerAgent: ${res.statusCode} ${res.body}`);
  return res.json().data.id as string;
}

function issueHeaders(body: string): Record<string, string> {
  return {
    ...hmacHeaders({ method: 'POST', url: '/v1/authorities', body }),
    'x-idempotency-key': randomUUID(),
  };
}

describe.skipIf(!hasUrl)('POST /v1/authorities (real Postgres)', () => {
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
  });

  afterEach(async () => {
    await app.close();
  });

  async function build(signer?: DelegatedAuthoritySigner): Promise<void> {
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      kafkaProducer: kafka,
      authoritySigner: signer ?? createInProcessSigner(keypair),
    }));
  }

  it('issues a read-only authority with no step-up → 201 with daa_<ULID> + token', async () => {
    await build();
    const agentId = await registerAgent(app);
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.id).toMatch(/^daa_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(data.status).toBe('active');
    expect(typeof data.token).toBe('string');
    expect(data.agent_id).toBe(agentId);

    // AUTHORITY_ISSUED published.
    expect(kafka.published).toHaveLength(1);
    expect(kafka.published[0]?.topic).toBe('helpan.authority.events');
    expect(kafka.published[0]?.value).toMatchObject({
      event_type: 'AUTHORITY_ISSUED',
      authority_id: data.id,
    });
    // audit entry: agent.register (seed) + authority.issue.
    expect(await countAuditEntries(handle)).toBe(2);

    // §A.11: the authority.issue row carries agent_id + delegated_authority_jti
    // in their indexed columns (H-3.1 audit-writer extension).
    const issueRow = (await handle.sql`
      SELECT agent_id, delegated_authority_jti
      FROM audit_log WHERE action = 'authority.issue'
    `) as unknown as { agent_id: string | null; delegated_authority_jti: string | null }[];
    expect(issueRow[0]?.agent_id).toBe(agentId);
    expect(issueRow[0]?.delegated_authority_jti).toBe(data.id);
  });

  it('issues a money-scope authority with a valid step-up token → 201', async () => {
    await build();
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({ keypair, sub: ACCOUNT_A });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [
        {
          scope_id: 'kipkiren.write.payments',
          amount_limit_minor: 400000,
          per_period_limit_minor: 4000000,
          period: 'weekly',
        },
      ],
      ttl_seconds: 3600,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('active');
  });

  it('rejects a money scope with no step-up token → 401 STEP_UP_REQUIRED', async () => {
    await build();
    const agentId = await registerAgent(app);
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('STEP_UP_REQUIRED');
  });

  it('rejects a step-up token with the wrong audience → 401 STEP_UP_TOKEN_INVALID', async () => {
    await build();
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({
      keypair,
      sub: ACCOUNT_A,
      audience: 'kipkiren_pay', // not helpan_authority_issuance
    });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 }],
      ttl_seconds: 3600,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('STEP_UP_TOKEN_INVALID');
  });

  it('rejects a step-up token whose sub differs from account_uuid → 401', async () => {
    await build();
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({
      keypair,
      sub: 'acc_00000000-0000-0000-0000-000000000099',
    });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 }],
      ttl_seconds: 3600,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('STEP_UP_TOKEN_INVALID');
  });

  it('rejects ttl exceeding the tightest per-scope ceiling → 400 TTL_EXCEEDS_MAX', async () => {
    await build();
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({ keypair, sub: ACCOUNT_A });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      // kipkiren.write.payments has per_scope_max_ttl_seconds = 3600.
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 }],
      ttl_seconds: 7200,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TTL_EXCEEDS_MAX');
  });

  it('rejects amount_limit above the scope ceiling → 400 AMOUNT_EXCEEDS_SCOPE_CEILING', async () => {
    await build();
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({ keypair, sub: ACCOUNT_A });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      // kipkiren.write.payments ceiling = 500000.
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 600000 }],
      ttl_seconds: 3600,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AMOUNT_EXCEEDS_SCOPE_CEILING');
  });

  it('rejects an unknown scope → 400 SCOPE_INVALID', async () => {
    await build();
    const agentId = await registerAgent(app);
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }, { scope_id: 'no.such.scope' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SCOPE_INVALID');
  });

  it('rejects an unknown agent → 400 AGENT_INVALID', async () => {
    await build();
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: 'agt_00000000000000000000000000',
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AGENT_INVALID');
  });

  it('maps an Identiti signer rejection to the Helpan error code', async () => {
    await build(
      createInProcessSigner(keypair, {
        forceError: {
          code: 'step_up_token_already_used',
          message: 'replay detected',
          httpStatus: 409,
        },
      })
    );
    const agentId = await registerAgent(app);
    const stepUp = await signStepUpToken({ keypair, sub: ACCOUNT_A });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'kipkiren.write.payments', amount_limit_minor: 100000 }],
      ttl_seconds: 3600,
      step_up_token: stepUp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: issueHeaders(body),
      payload: body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STEP_UP_TOKEN_ALREADY_USED');
  });

  it('requires X-Idempotency-Key (issuance is not query-exempt)', async () => {
    await build();
    const agentId = await registerAgent(app);
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers: hmacHeaders({ method: 'POST', url: '/v1/authorities', body }),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_MISSING');
  });

  it('replays the issued authority on an idempotency-key repeat', async () => {
    await build();
    const agentId = await registerAgent(app);
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [{ scope_id: 'helpan.read.briefings' }],
      ttl_seconds: 3600,
    });
    const headers = issueHeaders(body);
    const first = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers,
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/authorities',
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['x-idempotency-replayed']).toBe('true');
    expect(second.json().data.id).toBe(first.json().data.id);

    const count = (await handle.sql`SELECT count(*)::int AS n FROM delegated_authorities`) as unknown as {
      n: number;
    }[];
    expect(count[0]?.n).toBe(1);
  });
});
