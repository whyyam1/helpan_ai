/**
 * Postgres-backed IdempotencyStore for the shared idempotency plugin.
 *
 * Reads/writes the `idempotency_keys` table created in migration 0001.
 * TTL-driven cleanup is not done here — a separate periodic job
 * (out of H-1 scope) deletes rows where expires_at < NOW().
 */

import type { IdempotencyStore, IdempotencyRecord } from '@kmv/platform-shared/idempotency';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema/index.js';

export interface PgIdempotencyStoreOptions {
  readonly db: Db;
}

export function createPgIdempotencyStore(opts: PgIdempotencyStoreOptions): IdempotencyStore {
  const { db } = opts;

  return {
    async get(key, appId) {
      const rows = await db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.appId, appId),
            sql`${idempotencyKeys.expiresAt} > NOW()`
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        requestBodyHash: row.requestBodyHash,
        statusCode: row.statusCode,
        responseBody: row.responseBody,
        createdAt: row.createdAt.toISOString(),
      } satisfies IdempotencyRecord;
    },

    async set(key, appId, record, ttlSeconds) {
      const expiresAt = sql`NOW() + (${ttlSeconds} * INTERVAL '1 second')`;

      // ON CONFLICT DO NOTHING: first writer wins. The plugin only calls
      // set() after a get() returned null, but a concurrent first-time
      // request on the same key would otherwise raise a PK violation.
      await db
        .insert(idempotencyKeys)
        .values({
          key,
          appId,
          requestBodyHash: record.requestBodyHash,
          statusCode: record.statusCode,
          responseBody: record.responseBody as object,
          expiresAt: sql`${expiresAt}`,
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.key, idempotencyKeys.appId],
        });
    },
  };
}
