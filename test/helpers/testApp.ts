/**
 * Test harness: builds a Fastify app with stub stores and a stub postgres-js
 * sql tag so tests can hit endpoints via `.inject()` without a real database.
 *
 * Two harness modes live in this file:
 *   buildTestApp()      — stub DB. Use for plugin-chain tests (auth, JWT,
 *                          envelope, header echoes).
 *   buildIntegrationApp() — real DB. Use for tests that exercise SQL,
 *                          RLS, the audit chain, or transactional behaviour.
 *                          Skips itself if TEST_DATABASE_URL is not set.
 */

import { createHash } from 'node:crypto';
import { buildCanonicalString, signRequest } from '@kmv/platform-shared/hmac';
import type { AppCredentialStore, TenantRecord } from '@kmv/platform-shared/fastify-auth';
import type { IdempotencyStore } from '@kmv/platform-shared/idempotency';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Db, Sql } from '../../src/db/client.js';
import {
  createInMemoryProducer,
  type InMemoryProducer,
} from '../../src/lib/kafka/producer.js';
import type { WebhookTargetResolver } from '../../src/modules/events/service.js';
import type { DelegatedAuthoritySigner } from '../../src/lib/identitiSigner.js';
import {
  generateTestKeypair,
  publicKeyResolver,
  TEST_AUDIENCE,
  TEST_ISSUER,
  type TestJwksKeypair,
} from './testJwks.js';

export const TEST_APP_ID = 'helpan_test';
export const TEST_HMAC_SECRET = 'test-secret-32-bytes-of-entropy_x';
/** Second test tenant — non-admin. Used to assert admin-scope rejection. */
export const TEST_APP_ID_NO_ADMIN = 'helpan_test_noadmin';
export const TEST_HMAC_SECRET_NO_ADMIN = 'test-noadmin-32-bytes-of-entropy_x';

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return Object.freeze({
    nodeEnv: 'test',
    logLevel: 'fatal',
    port: 0,
    serviceVersion: '0.1.0-test',
    databaseUrl: 'postgres://unused-in-tests',
    auth: {
      railPrefix: 'Helpan',
      timestampHeaderName: 'x-helpan-timestamp',
      toleranceSeconds: 300,
    },
    idempotency: {
      ttlSeconds: 86400,
    },
    secrets: {
      envelopeProvider: 'noop',
    },
    llm: {
      provider: undefined,
      apiKey: undefined,
    },
    identiti: {
      jwksUrl: 'https://unused-in-tests/.well-known/jwks.json',
      issuer: TEST_ISSUER,
      internalSignUrl: '',
      internalHmacSecret: 'test-identiti-internal-hmac-secret-32b',
      internalAppId: 'helpan_ai',
      timestampHeader: 'x-identiti-timestamp',
      daKid: 'helpan-da-test',
    },
    helpan: {
      jwtAudience: TEST_AUDIENCE,
    },
    kafka: {
      brokers: [],
      clientId: 'helpan-ai-rail-test',
    },
    ...overrides,
  } satisfies AppConfig);
}

export function makeWebhookTargetResolver(
  urlsByAppId: Record<string, string>
): WebhookTargetResolver {
  return {
    resolve(appId) {
      return urlsByAppId[appId] ?? null;
    },
  };
}

export interface HmacHeaderInput {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
  /** Defaults to TEST_APP_ID (admin). Pass TEST_APP_ID_NO_ADMIN for the
   *  non-admin tenant — used by admin-scope rejection tests. */
  readonly appId?: string;
  readonly hmacSecret?: string;
}

/** Builds HMAC headers using the named tenant's credentials. */
export function hmacHeaders(input: HmacHeaderInput): Record<string, string> {
  const method = input.method.toUpperCase();
  const body = input.body ?? '';
  const contentType = body ? 'application/json; charset=utf-8' : '';
  const timestamp = new Date().toISOString();
  const canonical = buildCanonicalString({
    method,
    pathAndQuery: input.url,
    contentType,
    timestamp,
    bodySha256Hex: createHash('sha256').update(body, 'utf8').digest('hex'),
  });
  const appId = input.appId ?? TEST_APP_ID;
  const secret = input.hmacSecret ?? TEST_HMAC_SECRET;
  const signature = signRequest(canonical, secret);
  const headers: Record<string, string> = {
    authorization: `Helpan-HMAC-SHA256 app_id=${appId}, signature=${signature}`,
    'x-helpan-timestamp': timestamp,
  };
  if (contentType) headers['content-type'] = contentType;
  return headers;
}

export function makeTestCredentialStore(): AppCredentialStore {
  return {
    async lookup(appId) {
      if (appId === TEST_APP_ID) {
        const record: TenantRecord = {
          app_id: TEST_APP_ID,
          app_name: 'Helpan AI test client (admin)',
          tenant_class: 'internal',
          // H-6 admin endpoints require `helpan:admin`; H-1/H-5 also require
          // `operator:read` for deep-health; H-3 authority endpoints require
          // the issue/validate/revoke scopes. All granted here so happy-path
          // tests can reach every protected surface.
          scopes: [
            'operator:read',
            'helpan:admin',
            'helpan:authorities:issue',
            'helpan:authority:validate',
            'helpan:authorities:revoke',
          ],
          status: 'active',
        };
        return { record, hmacSecret: TEST_HMAC_SECRET };
      }
      if (appId === TEST_APP_ID_NO_ADMIN) {
        const record: TenantRecord = {
          app_id: TEST_APP_ID_NO_ADMIN,
          app_name: 'Helpan AI test client (non-admin)',
          tenant_class: 'internal',
          scopes: ['operator:read'],
          status: 'active',
        };
        return { record, hmacSecret: TEST_HMAC_SECRET_NO_ADMIN };
      }
      return null;
    },
  };
}

export function makeMemoryIdempotencyStore(): IdempotencyStore {
  const store = new Map<string, { record: unknown; expiresAt: number }>();
  const compose = (key: string, appId: string): string => `${appId}::${key}`;
  return {
    async get(key, appId) {
      const entry = store.get(compose(key, appId));
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        store.delete(compose(key, appId));
        return null;
      }
      return entry.record as never;
    },
    async set(key, appId, record, ttlSeconds) {
      store.set(compose(key, appId), { record, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

export interface StubSqlOptions {
  /** When true, the tagged-template invocation rejects so deep-health reports unavailable. */
  readonly failQuery?: boolean;
}

export function makeStubSql(opts: StubSqlOptions = {}): Sql {
  const tag = (..._args: unknown[]) =>
    opts.failQuery
      ? Promise.reject(new Error('stub: query failed'))
      : Promise.resolve([{ '?column?': 1 }]);
  // Augment the tag with the surface the rail actually touches: `.end()`.
  Object.assign(tag, {
    end: () => Promise.resolve(),
  });
  return tag as unknown as Sql;
}

export function makeStubDb(): Db {
  return {} as unknown as Db;
}

export interface BuildTestAppOptions {
  readonly configOverrides?: Partial<AppConfig>;
  readonly stubSqlOptions?: StubSqlOptions;
  readonly keypair?: TestJwksKeypair;
  /** Inject a shared idempotency store so the test can pre-populate it. */
  readonly idempotencyStore?: IdempotencyStore;
  /** Inject an in-memory Kafka producer so the test can assert publishes. */
  readonly kafkaProducer?: InMemoryProducer;
  /** Inject a webhook-target resolver; defaults to empty (no webhooks). */
  readonly webhookTargets?: WebhookTargetResolver;
  /** Inject the delegated-authority signer (H-3 in-process stub). */
  readonly authoritySigner?: DelegatedAuthoritySigner;
}

export interface TestAppHandle {
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  readonly keypair: TestJwksKeypair;
  readonly kafka: InMemoryProducer;
}

/**
 * Stub-DB test harness. Use for tests that exercise the plugin chain
 * without touching SQL — JWT verification, header echoes, idempotency
 * surface, AJV rejection. The customer-JWT plugin gets an in-memory
 * RS256 keypair so tokens minted with `signCustomerToken({ keypair })`
 * verify cleanly.
 */
export async function buildTestApp(options: BuildTestAppOptions = {}): Promise<TestAppHandle> {
  const keypair = options.keypair ?? generateTestKeypair();
  const config = makeTestConfig(options.configOverrides);
  const sql = makeStubSql(options.stubSqlOptions ?? {});
  const db = makeStubDb();
  const idempotencyStore = options.idempotencyStore ?? makeMemoryIdempotencyStore();
  const kafkaProducer = options.kafkaProducer ?? createInMemoryProducer();
  const app = await buildApp({
    config,
    overrides: {
      dbOverride: { db, sql },
      credentialStoreOverride: makeTestCredentialStore(),
      idempotencyStoreOverride: idempotencyStore,
      customerJwtKeyResolver: publicKeyResolver(keypair),
      identitiKeyResolver: publicKeyResolver(keypair),
      kafkaProducer,
      ...(options.webhookTargets ? { webhookTargets: options.webhookTargets } : {}),
      ...(options.authoritySigner ? { authoritySigner: options.authoritySigner } : {}),
    },
  });
  return { app, keypair, kafka: kafkaProducer };
}
