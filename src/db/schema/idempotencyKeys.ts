/**
 * `idempotency_keys` — replay store for the shared idempotency plugin.
 * ERD §1.11. PK is composite (key, app_id) to scope replay per tenant.
 *
 * The shared plugin further composes the stored key as
 * `{METHOD}:{routePath}:{X-Idempotency-Key}` so the same client-supplied
 * key on a different endpoint cannot collide.
 */

import { pgTable, text, integer, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    appId: text('app_id').notNull(),
    requestBodyHash: text('request_body_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseBody: jsonb('response_body').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.appId] }),
    expiresIdx: index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  })
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert;
