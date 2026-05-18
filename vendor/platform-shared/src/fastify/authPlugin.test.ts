import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authPlugin, type AppCredentialStore } from './authPlugin.js';
import { buildCanonicalString, sha256Hex, signRequest } from '../hmac.js';

const SECRET = 'test-secret-32-bytes-of-entropy_x';
const APP_ID = 'kalunch_dev';

function makeStore(): AppCredentialStore {
  return {
    async lookup(appId) {
      if (appId !== APP_ID) return null;
      return {
        record: {
          app_id: APP_ID,
          app_name: 'kaLunch (dev)',
          tenant_class: 'external',
          scopes: ['identiti:customers:read'],
          status: 'active',
        },
        hmacSecret: SECRET,
      };
    },
  };
}

function makeSuspendedStore(): AppCredentialStore {
  return {
    async lookup(appId) {
      if (appId !== APP_ID) return null;
      return {
        record: {
          app_id: APP_ID,
          app_name: 'kaLunch (dev)',
          tenant_class: 'external',
          scopes: [],
          status: 'suspended',
        },
        hmacSecret: SECRET,
      };
    },
  };
}

async function buildApp(store: AppCredentialStore = makeStore()) {
  const app = Fastify();
  await app.register(authPlugin, {
    railPrefix: 'Identiti',
    timestampHeaderName: 'X-Identiti-Timestamp',
    toleranceSeconds: 300,
    credentialStore: store,
    exemptPaths: ['/v1/health'],
  });
  app.get('/v1/health', async () => ({ ok: true }));
  app.get('/v1/protected', async (req) => ({
    appId: req.appId,
    tenant: req.tenantRecord?.app_name,
  }));
  app.post('/v1/echo', async (req) => ({ body: req.body }));
  return app;
}

function signedHeaders(opts: {
  method: string;
  url: string;
  body?: string;
  contentType?: string;
  appId?: string;
  secret?: string;
  timestamp?: string;
}) {
  const method = opts.method.toUpperCase();
  const url = opts.url;
  const body = opts.body ?? '';
  const contentType = opts.contentType ?? (body ? 'application/json; charset=utf-8' : '');
  const ts = opts.timestamp ?? new Date().toISOString();
  const canonical = buildCanonicalString({
    method,
    pathAndQuery: url,
    contentType,
    timestamp: ts,
    bodySha256Hex: sha256Hex(body),
  });
  const sig = signRequest(canonical, opts.secret ?? SECRET);
  const headers: Record<string, string> = {
    authorization: `Identiti-HMAC-SHA256 app_id=${opts.appId ?? APP_ID}, signature=${sig}`,
    'x-identiti-timestamp': ts,
  };
  if (contentType) headers['content-type'] = contentType;
  return headers;
}

describe('authPlugin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows exempt paths without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('rejects malformed Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { authorization: 'garbage' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('rejects mismatched rail prefix', async () => {
    const ts = new Date().toISOString();
    const sig = signRequest(
      buildCanonicalString({
        method: 'GET',
        pathAndQuery: '/v1/protected',
        contentType: '',
        timestamp: ts,
        bodySha256Hex: sha256Hex(''),
      }),
      SECRET
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: {
        authorization: `KipkirenPay-HMAC-SHA256 app_id=${APP_ID}, signature=${sig}`,
        'x-identiti-timestamp': ts,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('rejects missing or stale timestamp', async () => {
    const stale = new Date(Date.now() - 600_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: signedHeaders({ method: 'GET', url: '/v1/protected', timestamp: stale }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_TIMESTAMP_EXPIRED');
  });

  it('rejects unknown app_id', async () => {
    const headers = signedHeaders({
      method: 'GET',
      url: '/v1/protected',
      appId: 'no-such-app',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/protected', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('rejects suspended app with 403', async () => {
    const suspendedApp = await buildApp(makeSuspendedStore());
    try {
      const res = await suspendedApp.inject({
        method: 'GET',
        url: '/v1/protected',
        headers: signedHeaders({ method: 'GET', url: '/v1/protected' }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('AUTH_APP_SUSPENDED');
    } finally {
      await suspendedApp.close();
    }
  });

  it('rejects bad signature', async () => {
    const ts = new Date().toISOString();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: {
        authorization: `Identiti-HMAC-SHA256 app_id=${APP_ID}, signature=YWFhYWFh`,
        'x-identiti-timestamp': ts,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });

  it('passes a valid GET and attaches tenantRecord', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: signedHeaders({ method: 'GET', url: '/v1/protected' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ appId: APP_ID, tenant: 'kaLunch (dev)' });
  });

  it('passes a valid POST whose body affects the signature', async () => {
    const body = JSON.stringify({ hello: 'world' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/echo',
      headers: signedHeaders({
        method: 'POST',
        url: '/v1/echo',
        body,
        contentType: 'application/json; charset=utf-8',
      }),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: { hello: 'world' } });
  });

  it('rejects POST whose signed body differs from the actual payload', async () => {
    const signedBody = JSON.stringify({ hello: 'world' });
    const actualBody = JSON.stringify({ hello: 'tampered' });
    const headers = signedHeaders({
      method: 'POST',
      url: '/v1/echo',
      body: signedBody,
      contentType: 'application/json; charset=utf-8',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/echo',
      headers,
      payload: actualBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_HMAC_INVALID');
  });
});
