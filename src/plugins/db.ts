/**
 * Fastify plugin: decorates the app with the rail's Drizzle client.
 *
 * H-1 attaches `app.db` (Drizzle) and `app.sql` (raw postgres-js handle, for
 * the deep-health `SELECT 1` probe and any future raw SQL needs). Future
 * sprints add a per-request transaction decorator that runs `SET LOCAL
 * app.account_uuid` / `app.app_id` / `app.role` for RLS.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getOrCreateDbClient, type Db, type Sql } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    sql: Sql;
  }
}

export interface DbPluginConfig {
  readonly connectionString: string;
}

const dbPluginImpl: FastifyPluginAsync<DbPluginConfig> = async (fastify, config) => {
  const { db, sql } = getOrCreateDbClient({ connectionString: config.connectionString });

  fastify.decorate('db', db);
  fastify.decorate('sql', sql);

  fastify.addHook('onClose', async () => {
    await sql.end({ timeout: 5 });
  });
};

export const dbPlugin = fp(dbPluginImpl, {
  name: 'helpan-ai/db',
  fastify: '4.x',
});
