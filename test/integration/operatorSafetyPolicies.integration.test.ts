/**
 * /v1/operator/safety-policies — list + PUT (RFC-compliant upsert).
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

// Crockford base32 (ULID alphabet): 0-9 + A-Z minus I, L, O, U.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let policyIdCounter = 0;
function makePolicyId(_seed: string): string {
  // Deterministic-shape, unique-per-call ULID-formatted policy_id. The shape
  // must satisfy `^sfp_[0-9A-HJKMNP-TV-Z]{26}$` (the path-param regex).
  policyIdCounter++;
  const suffix = (policyIdCounter + 1_000_000_000).toString(32).toUpperCase().padStart(26, '0');
  // The base32 output uses 0-9 + A-V; map any out-of-alphabet char (W-Z are
  // unused by toString(32) anyway) and any of I/L/O/U to a safe value.
  const safe = suffix
    .split('')
    .map((c) => (CROCKFORD.includes(c) ? c : '0'))
    .join('');
  return `sfp_${safe.slice(0, 26)}`;
}

async function putPolicy(
  app: FastifyInstance,
  policyId: string,
  body: object
): Promise<ReturnType<FastifyInstance['inject']> extends Promise<infer R> ? R : never> {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'PUT',
    url: `/v1/operator/safety-policies/${policyId}`,
    headers: {
      ...hmacHeaders({
        method: 'PUT',
        url: `/v1/operator/safety-policies/${policyId}`,
        body: raw,
      }),
      'x-idempotency-key': randomUUID(),
    },
    payload: raw,
  });
}

describe.skipIf(!hasUrl)('/v1/operator/safety-policies (real Postgres)', () => {
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

  it('GET returns empty initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/safety-policies',
      headers: hmacHeaders({ method: 'GET', url: '/v1/operator/safety-policies' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it('PUT new policy_id creates (201); same id replaces (200)', async () => {
    const id = makePolicyId('FAMDISC1');
    const create = await putPolicy(app, id, {
      id,
      app_id: 'family_discovery',
      audience_posture: 'family_friendly',
      category_blacklist: ['adult'],
      content_moderation_rules: [],
      category_whitelist: ['merchant', 'cuisine'],
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.id).toBe(id);
    expect(create.json().data.audience_posture).toBe('family_friendly');

    const replace = await putPolicy(app, id, {
      id,
      app_id: 'family_discovery',
      audience_posture: 'family_friendly',
      category_blacklist: ['adult', 'gambling'],
      content_moderation_rules: [
        {
          rule_id: 'block_links',
          kind: 'link_filter',
          pattern: 'https?://.*',
          action: 'flag',
        },
      ],
      category_whitelist: ['merchant', 'cuisine'],
    });
    expect(replace.statusCode).toBe(200);
    expect(replace.json().data.category_blacklist).toContain('gambling');
    expect(replace.json().data.content_moderation_rules.length).toBe(1);
  });

  it('PUT with body.id != path policy_id → 400 REQ_INVALID', async () => {
    const pathId = makePolicyId('PATHID01');
    const bodyId = makePolicyId('BODYID01');
    const res = await putPolicy(app, pathId, {
      id: bodyId,
      app_id: 'lunchdrop',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });

  it('PUT cannot change app_id of an existing policy → 409 SAFETY_POLICY_APP_ID_FROZEN', async () => {
    const id = makePolicyId('FROZEN01');
    await putPolicy(app, id, { id, app_id: 'lunchdrop' });
    const reassign = await putPolicy(app, id, { id, app_id: 'chapaa' });
    expect(reassign.statusCode).toBe(409);
    expect(reassign.json().error.code).toBe('SAFETY_POLICY_APP_ID_FROZEN');
  });

  it('PUT a different policy_id for an app that already has one → 409 SAFETY_POLICY_APP_HAS_POLICY', async () => {
    const firstId = makePolicyId('APPFIRS1');
    const secondId = makePolicyId('APPSECN1');
    await putPolicy(app, firstId, { id: firstId, app_id: 'klokd' });
    const second = await putPolicy(app, secondId, { id: secondId, app_id: 'klokd' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SAFETY_POLICY_APP_HAS_POLICY');
  });

  it('non-admin PUT returns 403 AUTH_SCOPE_REQUIRED', async () => {
    const id = makePolicyId('NOADMN01');
    const body = JSON.stringify({ id, app_id: 'lunchdrop' });
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/operator/safety-policies/${id}`,
      headers: {
        ...hmacHeaders({
          method: 'PUT',
          url: `/v1/operator/safety-policies/${id}`,
          body,
          appId: TEST_APP_ID_NO_ADMIN,
          hmacSecret: TEST_HMAC_SECRET_NO_ADMIN,
        }),
        'x-idempotency-key': randomUUID(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_SCOPE_REQUIRED');
  });

  it('GET lists multiple policies sorted by app_id', async () => {
    const a = makePolicyId('LIST01AA');
    const b = makePolicyId('LIST02BB');
    await putPolicy(app, a, { id: a, app_id: 'chapaa' });
    await putPolicy(app, b, { id: b, app_id: 'lunchdrop' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/operator/safety-policies',
      headers: hmacHeaders({ method: 'GET', url: '/v1/operator/safety-policies' }),
    });
    expect(res.statusCode).toBe(200);
    const apps = (res.json().data.items as Array<{ app_id: string }>).map((i) => i.app_id);
    expect(apps).toEqual(['chapaa', 'lunchdrop']);
  });
});
