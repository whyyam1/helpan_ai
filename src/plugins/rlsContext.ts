/**
 * Fastify plugin: per-request RLS context.
 *
 * Decorates the app with `withCustomerContext(request, fn)`. Each call:
 *   1. Asserts `request.customerJwt` is populated (so the customer-JWT
 *      preHandler ran and verified the token).
 *   2. Opens a Drizzle transaction.
 *   3. Inside the transaction, runs `SELECT set_config('app.account_uuid',
 *      $sub, true)` and `set_config('app.role', 'user', true)`. The third
 *      argument `true` makes the GUCs **transaction-local** — they vanish
 *      when the transaction ends, so a subsequent connection-pool reuse
 *      cannot leak the previous request's account_uuid.
 *   4. Invokes `fn(tx)` and returns its result.
 *   5. On throw, the transaction rolls back per Drizzle/postgres-js default.
 *
 * Why a single funnel: RLS write policies in 0007 read the GUC with
 * `current_setting('app.account_uuid', true)`. If a route handler forgot
 * to set that GUC before issuing a write, the policy's WITH CHECK clause
 * would compare against an empty string and silently deny the write. By
 * routing every briefings handler through this helper, GUC setup is
 * impossible to forget.
 *
 * Plugin dependency: customer-jwt plugin must run before `withCustomerContext`
 * is called from a handler. The dependency declaration ensures plugin
 * registration order, but does not enforce hook order at request time —
 * routes that don't go through the briefings prefix simply won't call this.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Drizzle transaction type, exported so repos can accept either the top-level
 * `Db` handle (in tests, with stub) or the transaction handle (in production
 * routes). At runtime, both expose the same query surface.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface CustomerContextRunner {
  <T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

declare module 'fastify' {
  interface FastifyInstance {
    withCustomerContext: CustomerContextRunner;
  }
}

const rlsContextPluginImpl: FastifyPluginAsync = async (fastify) => {
  const runner: CustomerContextRunner = async (request, fn) => {
    const claims = request.customerJwt;
    if (!claims) {
      throw new Error(
        'withCustomerContext invoked without request.customerJwt — customer-jwt plugin must run first'
      );
    }
    return fastify.db.transaction(async (tx) => {
      // postgres-js / Drizzle: parameterised; `is_local=true` scopes the
      // setting to the current transaction. `set_config` is preferable to
      // `SET LOCAL` because it accepts bound parameters, eliminating any
      // injection risk on the GUC value.
      await tx.execute(sql`SELECT set_config('app.account_uuid', ${claims.sub}, true)`);
      await tx.execute(sql`SELECT set_config('app.role', 'user', true)`);
      return fn(tx);
    });
  };

  fastify.decorate('withCustomerContext', runner);
};

export const rlsContextPlugin = fp(rlsContextPluginImpl, {
  name: 'helpan-ai/rls-context',
  fastify: '4.x',
  // Note: this plugin reads `fastify.db.transaction(...)` lazily inside the
  // runner returned by `withCustomerContext`. The decorator is supplied
  // either by `dbPlugin` (production) or directly via `app.decorate('db',
  // ...)` in the test harness, so we don't declare a plugin-name dependency
  // — that would fail registration in the override path.
});
