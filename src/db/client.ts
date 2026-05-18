/**
 * Postgres client and Drizzle wiring.
 *
 * Driver: `postgres` (a.k.a. postgres-js). Matches Todoku's
 * `c:\Projects\todoku-prod\src\db\client.ts` (TD-0 Path A) — rail-wide
 * Drizzle driver standard. Identiti and KP adopt the same when they pick
 * up code.
 *
 * `prepare: false` is required when running through Supabase's PgBouncer in
 * transaction-pool mode — PgBouncer rejects prepared statements there.
 *
 * The Fastify plugin in `src/plugins/db.ts` decorates the request with a
 * Drizzle handle. RLS enforcement (`SET LOCAL app.account_uuid = ...`) is
 * applied per-transaction by handlers from H-2 onwards.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = ReturnType<typeof postgres>;

let sql: Sql | undefined;
let db: Db | undefined;

export interface DbClientOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
}

export function createDbClient(opts: DbClientOptions): { sql: Sql; db: Db } {
  const s = postgres(opts.connectionString, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeoutSeconds ?? 30,
    connect_timeout: opts.connectTimeoutSeconds ?? 10,
    prepare: false,
  });
  const d = drizzle(s, { schema });
  return { sql: s, db: d };
}

/**
 * Process-wide singleton. Called once from src/app.ts during boot;
 * never by request handlers. Tests use `createDbClient()` directly.
 */
export function getOrCreateDbClient(opts: DbClientOptions): { sql: Sql; db: Db } {
  if (!sql || !db) {
    const created = createDbClient(opts);
    sql = created.sql;
    db = created.db;
  }
  return { sql, db };
}

export async function closeDbClient(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = undefined;
    db = undefined;
  }
}

export { schema };
