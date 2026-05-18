import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authPlugin, type AppCredentialStore } from './authPlugin.js';
import { idempotencyPlugin } from './idempotencyPlugin.js';
import type { IdempotencyRecord, IdempotencyStore } from '../idempotency.js';
import { buildCanonicalString, sha256Hex, signRequest } from '../hmac.js';

const SECRET = 'idempotency-test-secret-32-bytes_x';
const APP_ID = 'kalunch_dev';

function makeCredStore(): AppCredentialStore {
  return {
    async lookup(appId) {
      if (appId !== APP_ID) return null;
      return {
        record: {
          app_id: APP_ID,
          app_name: 'kaLunch (dev)',
          tenant_class: 'external',
          scopes: [],
          status: 'active',
        },
        hmacSecret: SECRET,
      };
    },
  };
}

function makeMemStore(): IdempotencyStore & {
  inspect: () => Map<string, IdempotencyRecord>;
} {
  const data = new Map<string, IdempotencyRecord>();
  return {
    async get(key, appId) {
      return data.get(`${appId}:${key}`) ?? null;
    },
    async set(key, appId, record) {
      data.set(`${appId}:${key}`, record);
    },
    inspect: () => data,
  };
}

async function buildApp(idemStore: IdempotencyStore) {
  const app = Fastify();
  await app.register(authPlugin, {
    railPrefix: 'Identiti',
    timestampHeaderName: 'X-Identiti-Timestamp',
    toleranceSeconds: 300,
    credentialStore: makeCredStore(),
    exemptPaths: ['/v1/health'],
  });
  await app.register(idempotencyPlugin, {
    store: idemStore,
    ttlSeconds: 86_400,
    protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  });

  let counter = 0;
  app.post('/v1/things', async () => {
    counter += 1;
    return { id: `thing_${counter}`, count: counter };
  });
  app.get('/v1/health', async () => ({ ok: true }));
  return app;
}

function signed(opts: { method: string; url: string; body: string }) {
  const ts = new Date().toISOString();
  const contentType = 'application/json; charset=utf-8';
  const canonical = buildCanonicalString({
    method: opts.method,
    pathAndQuery: opts.url,
    contentType,
    timestamp: ts,
    bodySha256Hex: sha256Hex(opts.body),
  });
  const sig = signRequest(canonical, SECRET);
  return {
    authorization: `Identiti-HMAC-SHA256 app_id=${APP_ID}, signature=${sig}`,
    'x-identiti-timestamp': ts,
    'content-type': contentType,
  };
}

describe('idempotencyPlugin', () => {
  let store: ReturnType<typeof makeMemStore>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    store = makeMemStore();
    app = await buildApp(store);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects POST without X-Idempotency-Key', async () => {
    const body = JSON.stringify({ name: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/things',
      headers: signed({ method: 'POST', url: '/v1/things', body }),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_MISSING');
  });

  it('persists and replays on identical retry', async () => {
    const body = JSON.stringify({ name: 'x' });
    const headers = {
      ...signed({ method: 'POST', url: '/v1/things', body }),
      'x-idempotency-key': 'idem-1',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/things',
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ id: 'thing_1', count: 1 });
    expect(first.headers['x-idempotency-replayed']).toBeUndefined();

    // Re-sign with a fresh timestamp; idempotency key is the same.
    const headers2 = {
      ...signed({ method: 'POST', url: '/v1/things', body }),
      'x-idempotency-key': 'idem-1',
    };
    const second = await app.inject({
      method: 'POST',
      url: '/v1/things',
      headers: headers2,
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ id: 'thing_1', count: 1 });
    expect(second.headers['x-idempotency-replayed']).toBe('true');
  });

  it('returns 409 on key reuse with different body', async () => {
    const body1 = JSON.stringify({ name: 'a' });
    const headers1 = {
      ...signed({ method: 'POST', url: '/v1/things', body: body1 }),
      'x-idempotency-key': 'idem-2',
    };
    await app.inject({ method: 'POST', url: '/v1/things', headers: headers1, payload: body1 });

    const body2 = JSON.stringify({ name: 'b' });
    const headers2 = {
      ...signed({ method: 'POST', url: '/v1/things', body: body2 }),
      'x-idempotency-key': 'idem-2',
    };
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/things',
      headers: headers2,
      payload: body2,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_CONFLICT');
  });

  it('skips idempotency check on GET', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(store.inspect().size).toBe(0);
  });

  it('scopes by route and method — same key on different endpoint does not collide', async () => {
    // Two POSTs to the same endpoint with the same key replay; this test verifies the
    // *scoped key* uses METHOD:path:key by checking the stored key shape.
    const body = JSON.stringify({ name: 'x' });
    const headers = {
      ...signed({ method: 'POST', url: '/v1/things', body }),
      'x-idempotency-key': 'idem-3',
    };
    await app.inject({ method: 'POST', url: '/v1/things', headers, payload: body });
    const stored = [...store.inspect().keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toBe(`${APP_ID}:POST:/v1/things:idem-3`);
  });
});
