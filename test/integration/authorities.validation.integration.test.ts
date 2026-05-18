/**
 * POST /v1/authorities/:id/validate — relying-party per-call check.
 * Real Postgres; in-process signer mints tokens that verify against the
 * same test keypair the rail uses as its delegated-authority key resolver.
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
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const hasUrl = !!getTestDatabaseUrl();

interface IssuedAuthority {
  id: string;
  token: string;
}

describe.skipIf(!hasUrl)('POST /v1/authorities/:id/validate (real Postgres)', () => {
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

  async function registerAgent(): Promise<string> {
    const raw = JSON.stringify({
      name: 'Validation Test Agent',
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

  async function issueReadOnly(agentId: string): Promise<IssuedAuthority> {
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
        ...hmacHeaders({ method: 'POST', url: '/v1/authorities', body }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    if (res.statusCode !== 201) throw new Error(`issueReadOnly: ${res.statusCode} ${res.body}`);
    return { id: res.json().data.id, token: res.json().data.token };
  }

  async function issueMoney(agentId: string, amountLimit: number): Promise<IssuedAuthority> {
    const stepUp = await signStepUpToken({ keypair, sub: ACCOUNT_A });
    const body = JSON.stringify({
      account_uuid: ACCOUNT_A,
      agent_id: agentId,
      scopes: [
        {
          scope_id: 'kipkiren.write.payments',
          amount_limit_minor: amountLimit,
          per_period_limit_minor: 5000000,
          period: 'weekly',
        },
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
    return { id: res.json().data.id, token: res.json().data.token };
  }

  function validate(
    id: string,
    body: { token: string; intended_operation: string; amount_minor?: number }
  ): ReturnType<FastifyInstance['inject']> {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: `/v1/authorities/${id}/validate`,
      headers: hmacHeaders({
        method: 'POST',
        url: `/v1/authorities/${id}/validate`,
        body: raw,
      }),
      payload: raw,
    });
  }

  it('valid=true for an active token covering the operation', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.valid).toBe(true);
    expect(data.status).toBe('active');
    expect(data.scope_covers).toBe(true);
    expect(data.within_limits).toBe(true);
    expect(data.rejection_reason).toBeNull();
  });

  it('does not require X-Idempotency-Key (validate is query-exempt)', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    // validate() above already omits the key; assert it isn't a 400.
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).toBe(200);
  });

  it('valid=false token_revoked after the authority is revoked', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/v1/authorities/${auth.id}/revoke`,
      headers: {
        ...hmacHeaders({ method: 'POST', url: `/v1/authorities/${auth.id}/revoke`, body: '{}' }),
        'x-idempotency-key': randomUUID(),
      },
      payload: {},
    });
    expect(revokeRes.statusCode).toBe(200);

    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.rejection_reason).toBe('token_revoked');
  });

  it('valid=false token_expired when the row is past expiry', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    await handle.sql`
      UPDATE delegated_authorities SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = ${auth.id}
    `;
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.status).toBe('expired');
    expect(res.json().data.rejection_reason).toBe('token_expired');
  });

  it('valid=false scope_not_covered when the operation matches no scope', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'kipkiren_pay.payment.execute',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.scope_covers).toBe(false);
    expect(res.json().data.rejection_reason).toBe('scope_not_covered');
  });

  it('valid=false amount_exceeds_limit when amount_minor tops the scope limit', async () => {
    const agentId = await registerAgent();
    const auth = await issueMoney(agentId, 400000);
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'kipkiren.write.payments',
      amount_minor: 500000,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.within_limits).toBe(false);
    expect(res.json().data.rejection_reason).toBe('amount_exceeds_limit');
  });

  it('valid=true money scope when amount is within the limit', async () => {
    const agentId = await registerAgent();
    const auth = await issueMoney(agentId, 400000);
    const res = await validate(auth.id, {
      token: auth.token,
      intended_operation: 'kipkiren.write.payments',
      amount_minor: 250000,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(true);
  });

  it('valid=false token_invalid_signature for a garbage token', async () => {
    const agentId = await registerAgent();
    const auth = await issueReadOnly(agentId);
    const res = await validate(auth.id, {
      token: 'not-a-real-jwt',
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.rejection_reason).toBe('token_invalid_signature');
  });

  it('404 AUTHORITY_NOT_FOUND for an unknown authority id', async () => {
    const res = await validate('daa_00000000000000000000000000', {
      token: 'whatever',
      intended_operation: 'helpan.read.briefings',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUTHORITY_NOT_FOUND');
  });
});
