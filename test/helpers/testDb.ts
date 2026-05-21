/**
 * Real-Postgres test harness for integration tests that need RLS, the
 * audit-log hash chain, or transactional behaviour the stub SQL can't
 * model.
 *
 * Activation:
 *   - Set TEST_DATABASE_URL to a Postgres 16 instance the test process can
 *     reach (e.g. a local docker-compose pg, a Supabase af-south-1 dev
 *     project, or any disposable dev DB).
 *   - When unset, `withRealDb` returns null; tests SHOULD skip via
 *     `it.skipIf(!handle)` so the suite stays green when no DB is wired.
 *
 * Schema lifecycle: migrations 0001–0007 are applied via drizzle-kit's
 * runtime migrator on first call. Subsequent calls are no-ops.
 *
 * Test isolation: between tests, callers should TRUNCATE the briefings
 * table and DELETE non-genesis rows from audit_log. The genesis row is
 * preserved because the chain is seeded by migration 0001.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql as drizzleSql } from 'drizzle-orm';
import * as schema from '../../src/db/schema/index.js';
import { buildApp } from '../../src/app.js';
import type { Db, Sql } from '../../src/db/client.js';
import {
  generateTestKeypair,
  publicKeyResolver,
  type TestJwksKeypair,
} from './testJwks.js';
import {
  createInMemoryProducer,
  type InMemoryProducer,
} from '../../src/lib/kafka/producer.js';
import type { WebhookTargetResolver } from '../../src/modules/events/service.js';
import type { DelegatedAuthoritySigner } from '../../src/lib/identitiSigner.js';
import {
  makeMemoryIdempotencyStore,
  makeTestConfig,
  makeTestCredentialStore,
} from './testApp.js';

export interface RealDbHandle {
  readonly sql: Sql;
  readonly db: Db;
  readonly close: () => Promise<void>;
}

let migrationsApplied = false;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '..', '..', 'src', 'db', 'migrations');

export function getTestDatabaseUrl(): string | null {
  const url = process.env['TEST_DATABASE_URL'];
  return url && url.length > 0 ? url : null;
}

/**
 * Postgres advisory lock key used to serialise the drizzle migrator across
 * Vitest workers. Without this, parallel test files race to apply pending
 * migrations and either collide on the `_drizzle_migrations` PK or trip
 * "column already exists" errors on schema mutations.
 */
const MIGRATE_LOCK_KEY = 7268010825743211n; // adjacent to AUDIT_CHAIN_LOCK_KEY

export async function withRealDb(): Promise<RealDbHandle | null> {
  const url = getTestDatabaseUrl();
  if (!url) return null;

  const sql = postgres(url, { max: 4, prepare: false });
  if (!migrationsApplied) {
    // Dedicated single-connection client for the migrate step — advisory
    // session locks live on the connection, not the transaction.
    const migrateSql = postgres(url, { max: 1, prepare: false });
    try {
      await migrateSql`SELECT pg_advisory_lock(${MIGRATE_LOCK_KEY})`;
      const migrationDb = drizzle(migrateSql);
      await migrate(migrationDb, {
        migrationsFolder,
        migrationsTable: '_drizzle_migrations',
        migrationsSchema: 'public',
      });
      await migrateSql`SELECT pg_advisory_unlock(${MIGRATE_LOCK_KEY})`;
    } finally {
      await migrateSql.end({ timeout: 5 });
    }
    migrationsApplied = true;
  }
  const db = drizzle(sql, { schema });
  return {
    sql,
    db: db as unknown as Db,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * Truncate test data, leaving the audit_log genesis row in place so the
 * chain pointer is well-formed for the next test. Idempotent.
 */
export async function resetTestData(sql: Sql): Promise<void> {
  // H-4 — actions truncated FIRST because it FK-refs both agents and
  // delegated_authorities; CASCADE on those would clobber it anyway but
  // ordering it explicitly keeps the FK chain readable in the test log.
  await sql`TRUNCATE TABLE actions CASCADE`;
  await sql`TRUNCATE TABLE briefings CASCADE`;
  await sql`TRUNCATE TABLE events_ingested CASCADE`;
  await sql`TRUNCATE TABLE briefing_matches CASCADE`;
  await sql`TRUNCATE TABLE webhook_deliveries CASCADE`;
  await sql`TRUNCATE TABLE safety_policies CASCADE`;
  await sql`TRUNCATE TABLE authority_usage CASCADE`;
  await sql`TRUNCATE TABLE delegated_authorities CASCADE`;
  // H-6: keep the H-1 seeded oauth_scopes; tests that add scopes via POST
  // clean those up by id. agents has no seeded rows.
  await sql`TRUNCATE TABLE agents CASCADE`;
  await sql`DELETE FROM oauth_scopes WHERE id LIKE 'test.%'`;
  await sql`DELETE FROM audit_log WHERE action <> 'audit_log.genesis'`;
  await sql`DELETE FROM idempotency_keys`;
}

export interface BuildIntegrationAppOptions {
  readonly handle: RealDbHandle;
  readonly keypair?: TestJwksKeypair;
  readonly kafkaProducer?: InMemoryProducer;
  readonly webhookTargets?: WebhookTargetResolver;
  readonly authoritySigner?: DelegatedAuthoritySigner;
  /** Inject H-4 target-rail dispatchers (in-memory in tests). */
  readonly dispatchers?: import('../../src/lib/dispatchers/dispatcher.js').DispatcherRegistry;
}

export interface IntegrationAppHandle {
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  readonly keypair: TestJwksKeypair;
  readonly kafka: InMemoryProducer;
}

/**
 * Build a Fastify app wired against a real Postgres handle (from
 * `withRealDb`). Customer-JWT verification uses an ephemeral keypair so
 * tests can sign tokens that this app accepts.
 */
export async function buildIntegrationApp(
  options: BuildIntegrationAppOptions
): Promise<IntegrationAppHandle> {
  const keypair = options.keypair ?? generateTestKeypair();
  const config = makeTestConfig();
  const kafkaProducer = options.kafkaProducer ?? createInMemoryProducer();
  const app = await buildApp({
    config,
    overrides: {
      dbOverride: { db: options.handle.db, sql: options.handle.sql },
      credentialStoreOverride: makeTestCredentialStore(),
      idempotencyStoreOverride: makeMemoryIdempotencyStore(),
      customerJwtKeyResolver: publicKeyResolver(keypair),
      identitiKeyResolver: publicKeyResolver(keypair),
      kafkaProducer,
      ...(options.webhookTargets ? { webhookTargets: options.webhookTargets } : {}),
      ...(options.authoritySigner ? { authoritySigner: options.authoritySigner } : {}),
      ...(options.dispatchers ? { dispatchers: options.dispatchers } : {}),
    },
  });
  return { app, keypair, kafka: kafkaProducer };
}

/** Convenience: count briefings rows by SELECT bypass-RLS via SET LOCAL. */
export async function countBriefings(handle: RealDbHandle): Promise<number> {
  const result = (await handle.sql`SELECT count(*)::int AS n FROM briefings`) as unknown as readonly {
    n: number;
  }[];
  return result[0]?.n ?? 0;
}

/** Inspect the audit_log chain length (excluding genesis). */
export async function countAuditEntries(handle: RealDbHandle): Promise<number> {
  const result = (await handle.sql`
    SELECT count(*)::int AS n FROM audit_log WHERE action <> 'audit_log.genesis'
  `) as unknown as readonly { n: number }[];
  return result[0]?.n ?? 0;
}

/**
 * Read full audit chain ordered by created_at; useful for verifying chain
 * continuity in tests. Returns rows with `previous_hash` and `entry_hash`.
 */
export async function readAuditChain(handle: RealDbHandle): Promise<
  ReadonlyArray<{
    id: string;
    action: string;
    previous_hash: string | null;
    entry_hash: string;
    resource_id: string | null;
  }>
> {
  return (await handle.sql`
    SELECT id, action, previous_hash, entry_hash, resource_id
    FROM audit_log
    ORDER BY created_at ASC, id ASC
  `) as unknown as ReadonlyArray<{
    id: string;
    action: string;
    previous_hash: string | null;
    entry_hash: string;
    resource_id: string | null;
  }>;
}

// Re-export drizzleSql so test files don't need to import drizzle-orm directly.
export { drizzleSql };
