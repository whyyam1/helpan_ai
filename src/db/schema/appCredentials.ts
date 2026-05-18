/**
 * `app_credentials` — per-app HMAC secrets, allowed scopes, webhook config.
 * ERD §1.10. Source of truth for the AppCredentialStore consumed by the
 * shared HMAC auth plugin (@kmv/platform-shared/fastify-auth).
 *
 * Encrypted columns (hmac_secret, webhook_signing_secret) are wrapped via
 * src/lib/secretsEnvelope at write time. H-1 ships a noop envelope provider.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, timestamp, check } from 'drizzle-orm/pg-core';

export const appCredentials = pgTable(
  'app_credentials',
  {
    appId: text('app_id').primaryKey(),
    appName: text('app_name').notNull(),
    tenantClass: text('tenant_class').notNull(),
    hmacSecret: text('hmac_secret').notNull(),
    status: text('status').notNull().default('active'),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    webhookUrl: text('webhook_url'),
    webhookSigningSecret: text('webhook_signing_secret'),
    rateLimits: jsonb('rate_limits').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantClassCheck: check(
      'app_credentials_tenant_class_chk',
      sql`${t.tenantClass} IN ('internal', 'external')`
    ),
    statusCheck: check(
      'app_credentials_status_chk',
      sql`${t.status} IN ('active', 'suspended')`
    ),
  })
);

export type AppCredentialRow = typeof appCredentials.$inferSelect;
export type AppCredentialInsert = typeof appCredentials.$inferInsert;
