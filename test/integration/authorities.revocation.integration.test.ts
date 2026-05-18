/**
 * POST /v1/authorities/:id/revoke — immediate, idempotent revocation.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hmacHeaders } from '../helpers/testApp.js';
import { generateTestKeypair, type TestJwksKeypair } from '../helpers/testJwks.js';
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

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('POST /v1/authorities/:id/revoke (real Postgres)', () => {
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

  async function issue(): Promise<string> {
    const agentRaw = JSON.stringify({
      name: 'Revoke Test Agent',
      agent_class: 'portfolio_app',
      owner_app_id: 'lunchdrop',
    });
    const agentRes = await app.inject({
      method: 'POST',
      url: '/v1/operator/agents',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/operator/agents', body: agentRaw }),
        'x-idempotency-key': randomUUID(),
      },
      payload: agentRaw,
    });
    const agentId = agentRes.json().data.id as string;
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
    return res.json().data.id as string;
  }

  function revoke(id: string, body: object = {}): ReturnType<FastifyInstance['inject']> {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: `/v1/authorities/${id}/revoke`,
      headers: {
        ...hmacHeaders({ method: 'POST', url: `/v1/authorities/${id}/revoke`, body: raw }),
        'x-idempotency-key': randomUUID(),
      },
      payload: raw,
    });
  }

  it('revokes an active authority → 200, status=revoked, AUTHORITY_REVOKED published', async () => {
    const id = await issue();
    kafka.clear(); // drop the AUTHORITY_ISSUED publish
    const res = await revoke(id, { reason: 'user_initiated', detail: 'console tap' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('revoked');
    expect(res.json().data.revoked_at).not.toBeNull();
    expect(res.json().data.revocation_reason).toBe('user_initiated');

    expect(kafka.published).toHaveLength(1);
    expect(kafka.published[0]?.value).toMatchObject({
      event_type: 'AUTHORITY_REVOKED',
      authority_id: id,
      reason: 'user_initiated',
    });

    // genesis + agent.register + authority.issue + authority.revoke = 3 real.
    expect(await countAuditEntries(handle)).toBe(3);

    // §A.11: authority.revoke row carries agent_id + delegated_authority_jti.
    const revokeRow = (await handle.sql`
      SELECT agent_id, delegated_authority_jti
      FROM audit_log WHERE action = 'authority.revoke'
    `) as unknown as { agent_id: string | null; delegated_authority_jti: string | null }[];
    expect(revokeRow[0]?.agent_id).toMatch(/^agt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(revokeRow[0]?.delegated_authority_jti).toBe(id);
  });

  it('defaults reason to user_initiated when the body is empty', async () => {
    const id = await issue();
    const res = await revoke(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.revocation_reason).toBe('user_initiated');
  });

  it('returns 409 AUTHORITY_ALREADY_REVOKED on a second revoke', async () => {
    const id = await issue();
    await revoke(id);
    const second = await revoke(id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('AUTHORITY_ALREADY_REVOKED');
  });

  it('returns 404 AUTHORITY_NOT_FOUND for an unknown id', async () => {
    const res = await revoke('daa_00000000000000000000000000');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUTHORITY_NOT_FOUND');
  });

  it('returns 409 AUTHORITY_EXPIRED when the authority is past expiry', async () => {
    const id = await issue();
    await handle.sql`
      UPDATE delegated_authorities SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = ${id}
    `;
    const res = await revoke(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUTHORITY_EXPIRED');
  });
});
