/**
 * /v1/operator/agents — admin-only CRUD with audit chain.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  hmacHeaders,
  TEST_APP_ID_NO_ADMIN,
  TEST_HMAC_SECRET_NO_ADMIN,
} from '../helpers/testApp.js';
import {
  buildIntegrationApp,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const hasUrl = !!getTestDatabaseUrl();

async function registerAgentHelper(
  app: FastifyInstance,
  body: object
): Promise<ReturnType<FastifyInstance['inject']> extends Promise<infer R> ? R : never> {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/v1/operator/agents',
    headers: {
      ...hmacHeaders({ method: 'POST', url: '/v1/operator/agents', body: raw }),
      'x-idempotency-key': randomUUID(),
    },
    payload: raw,
  });
}

describe.skipIf(!hasUrl)('/v1/operator/agents (real Postgres)', () => {
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

  it('registers a portfolio_app agent and returns agt_<ULID>', async () => {
    const res = await registerAgentHelper(app, {
      name: 'Lunch Drop Agent',
      agent_class: 'portfolio_app',
      owner_app_id: 'lunchdrop',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toMatch(/^agt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.data.agent_class).toBe('portfolio_app');
    expect(body.data.owner_app_id).toBe('lunchdrop');
    expect(body.data.status).toBe('active');
  });

  it('rejects portfolio_app registration without owner_app_id (400 AGENT_OWNER_REQUIRED)', async () => {
    const res = await registerAgentHelper(app, {
      name: 'Bad Agent',
      agent_class: 'portfolio_app',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AGENT_OWNER_REQUIRED');
  });

  it('rejects third_party_oauth registration without client_id (400 AGENT_OAUTH_CLIENT_REQUIRED)', async () => {
    const res = await registerAgentHelper(app, {
      name: 'Bad 3p Agent',
      agent_class: 'third_party_oauth',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AGENT_OAUTH_CLIENT_REQUIRED');
  });

  it('GET returns the agent for admin; 404 on unknown id', async () => {
    const created = await registerAgentHelper(app, {
      name: 'Klokd Agent',
      agent_class: 'portfolio_app',
      owner_app_id: 'klokd',
    });
    const id = created.json().data.id;

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/operator/agents/${id}`,
      headers: hmacHeaders({ method: 'GET', url: `/v1/operator/agents/${id}` }),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.id).toBe(id);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/operator/agents/agt_00000000000000000000000000',
      headers: hmacHeaders({
        method: 'GET',
        url: '/v1/operator/agents/agt_00000000000000000000000000',
      }),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('PATCH suspended/active/retired flips status and stamps suspended_at/retired_at', async () => {
    const created = await registerAgentHelper(app, {
      name: 'Chapaa Agent',
      agent_class: 'portfolio_app',
      owner_app_id: 'chapaa',
    });
    const id = created.json().data.id;

    const patch = async (status: string) => {
      const raw = JSON.stringify({ status, reason: `going to ${status}` });
      return app.inject({
        method: 'PATCH',
        url: `/v1/operator/agents/${id}`,
        headers: {
          ...hmacHeaders({
            method: 'PATCH',
            url: `/v1/operator/agents/${id}`,
            body: raw,
          }),
          'x-idempotency-key': randomUUID(),
        },
        payload: raw,
      });
    };

    const suspended = await patch('suspended');
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().data.status).toBe('suspended');
    expect(suspended.json().data.suspended_at).not.toBeNull();

    const reactivated = await patch('active');
    expect(reactivated.json().data.status).toBe('active');
    expect(reactivated.json().data.suspended_at).toBeNull();

    const retired = await patch('retired');
    expect(retired.json().data.status).toBe('retired');
    expect(retired.json().data.retired_at).not.toBeNull();
  });

  it('non-admin tenant gets 403 AUTH_SCOPE_REQUIRED on POST', async () => {
    const raw = JSON.stringify({
      name: 'denied',
      agent_class: 'portfolio_app',
      owner_app_id: 'demo',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/operator/agents',
      headers: {
        ...hmacHeaders({
          method: 'POST',
          url: '/v1/operator/agents',
          body: raw,
          appId: TEST_APP_ID_NO_ADMIN,
          hmacSecret: TEST_HMAC_SECRET_NO_ADMIN,
        }),
        'x-idempotency-key': randomUUID(),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_REQUIRED');
  });

  it('audits agent.register and agent.status_change with continuous hash chain', async () => {
    const created = await registerAgentHelper(app, {
      name: 'Audit Agent',
      agent_class: 'portfolio_app',
      owner_app_id: 'lunchdrop',
    });
    const id = created.json().data.id;

    const raw = JSON.stringify({ status: 'suspended', reason: 'audit test' });
    await app.inject({
      method: 'PATCH',
      url: `/v1/operator/agents/${id}`,
      headers: {
        ...hmacHeaders({
          method: 'PATCH',
          url: `/v1/operator/agents/${id}`,
          body: raw,
        }),
        'x-idempotency-key': randomUUID(),
      },
      payload: raw,
    });

    const chain = (await handle.sql`
      SELECT action, previous_hash, entry_hash
      FROM audit_log
      ORDER BY created_at ASC, id ASC
    `) as unknown as Array<{
      action: string;
      previous_hash: string | null;
      entry_hash: string;
    }>;
    // genesis + agent.register + agent.status_change = 3 rows
    expect(chain.length).toBe(3);
    expect(chain[0]?.action).toBe('audit_log.genesis');
    expect(chain[1]?.action).toBe('agent.register');
    expect(chain[2]?.action).toBe('agent.status_change');
    expect(chain[1]?.previous_hash).toBe(chain[0]?.entry_hash);
    expect(chain[2]?.previous_hash).toBe(chain[1]?.entry_hash);
  });
});
