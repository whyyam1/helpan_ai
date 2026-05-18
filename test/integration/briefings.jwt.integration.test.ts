/**
 * Customer-JWT verifier — failure modes and surface contract.
 * Stub-DB harness: these tests exercise the plugin chain only and never
 * reach the handler / DB.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, TEST_APP_ID } from '../helpers/testApp.js';
import {
  generateTestKeypair,
  signCustomerToken,
  TEST_AUDIENCE,
  TEST_ISSUER,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';

const ACCOUNT_UUID = 'acc_00000000-0000-0000-0000-000000000001';

async function bearerHeaders(
  keypair: TestJwksKeypair,
  overrides: Parameters<typeof signCustomerToken>[0] = {} as Parameters<
    typeof signCustomerToken
  >[0]
): Promise<Record<string, string>> {
  const token = await signCustomerToken({ keypair, sub: ACCOUNT_UUID, ...overrides });
  return {
    authorization: `Bearer ${token}`,
    'x-app-id': TEST_APP_ID,
  };
}

describe('customer-JWT verifier on /v1/briefings/*', () => {
  let app: FastifyInstance;
  let keypair: TestJwksKeypair;

  beforeEach(async () => {
    ({ app, keypair } = await buildTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects requests with no Authorization header → 401 AUTH_JWT_MISSING', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/briefings',
      headers: { 'x-app-id': TEST_APP_ID },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_MISSING');
  });

  it('rejects requests with no X-App-Id → 401 AUTH_JWT_MISSING', async () => {
    const token = await signCustomerToken({ keypair, sub: ACCOUNT_UUID });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/briefings',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_MISSING');
  });

  it('rejects a malformed bearer token → 401 AUTH_JWT_INVALID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/briefings',
      headers: {
        authorization: 'Bearer not-a-real-jwt',
        'x-app-id': TEST_APP_ID,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_INVALID');
  });

  it('rejects a token signed by an unknown key → 401 AUTH_JWT_INVALID', async () => {
    const otherKey = generateTestKeypair();
    const headers = await bearerHeaders(otherKey);
    const res = await app.inject({ method: 'GET', url: '/v1/briefings', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_INVALID');
  });

  it('rejects an expired token → 401 AUTH_JWT_EXPIRED', async () => {
    const headers = await bearerHeaders(keypair, {
      keypair,
      sub: ACCOUNT_UUID,
      issuedAtSeconds: Math.floor(Date.now() / 1000) - 3600,
      expiresInSeconds: 60, // expired 59 minutes ago
    });
    const res = await app.inject({ method: 'GET', url: '/v1/briefings', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_EXPIRED');
  });

  it('rejects a token whose audience does not include this rail → 401 AUTH_JWT_AUDIENCE', async () => {
    const headers = await bearerHeaders(keypair, {
      keypair,
      sub: ACCOUNT_UUID,
      audience: 'https://other-rail.example',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/briefings', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_AUDIENCE');
  });

  it('rejects a token whose issuer is not Identiti → 401 AUTH_JWT_INVALID', async () => {
    const headers = await bearerHeaders(keypair, {
      keypair,
      sub: ACCOUNT_UUID,
      issuer: 'https://impostor.example',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/briefings', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_INVALID');
  });

  it('rejects an X-App-Id with disallowed characters → 401 AUTH_JWT_MISSING', async () => {
    const token = await signCustomerToken({ keypair, sub: ACCOUNT_UUID });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/briefings',
      headers: {
        authorization: `Bearer ${token}`,
        'x-app-id': 'BAD App',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_JWT_MISSING');
  });

  it('does NOT verify customer-JWT on /v1/health (only briefings paths gate)', async () => {
    // Sanity: the JWT plugin's path filter is the load-bearing piece. /v1/health
    // is unauthenticated; presence/absence of Authorization must not interfere.
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does NOT verify customer-JWT on /v1/health/deep (HMAC-only path)', async () => {
    // No HMAC, no JWT: should 401 with AUTH_HMAC_INVALID — proving the JWT
    // plugin did not take precedence on a path it should ignore.
    const res = await app.inject({ method: 'GET', url: '/v1/health/deep' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('expected issuer / audience are configurable via test config', () => {
    // Sanity that the test harness wired the same issuer/audience the plugin
    // checks against. Catches harness regressions.
    expect(TEST_ISSUER).toBe('https://test.identiti.local');
    expect(TEST_AUDIENCE).toBe('https://test.helpan.local');
  });
});
