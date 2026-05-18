/**
 * Postgres-backed AppCredentialStore for the shared HMAC auth plugin.
 *
 * Reads from the `app_credentials` table created in migration 0001.
 * Decrypts `hmac_secret` via the secrets-envelope helper (noop in H-1).
 *
 * No caching at H-1 — the auth plugin runs once per request and queries are
 * indexed on the PK. Add an LRU once we have observability data showing
 * the read rate justifies it.
 */

import type { AppCredentialStore, TenantRecord } from '@kmv/platform-shared/fastify-auth';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { appCredentials } from '../db/schema/index.js';
import type { SecretsEnvelope } from '../lib/secretsEnvelope.js';

export interface PgCredentialStoreOptions {
  readonly db: Db;
  readonly envelope: SecretsEnvelope;
}

export function createPgCredentialStore(opts: PgCredentialStoreOptions): AppCredentialStore {
  const { db, envelope } = opts;

  return {
    async lookup(appId: string) {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.appId, appId))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const record: TenantRecord = {
        app_id: row.appId,
        app_name: row.appName,
        tenant_class: row.tenantClass as TenantRecord['tenant_class'],
        scopes: row.scopes,
        status: row.status as TenantRecord['status'],
      };

      return {
        record,
        hmacSecret: await envelope.decrypt(row.hmacSecret),
      };
    },
  };
}
