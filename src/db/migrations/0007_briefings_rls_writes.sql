-- =============================================================================
-- Migration 0007 — Briefings RLS write policies
-- Source of truth: helpan-ai-schema-erd-v1.md §3.1 (intent: user-scoped writes)
--
-- Migration 0006 enabled RLS on briefings and added a SELECT-only policy. Per
-- Postgres semantics, enabling RLS without an INSERT/UPDATE/DELETE policy
-- denies those operations for non-superuser roles. H-2 adds the missing write
-- policies so /v1/briefings POST/PATCH/DELETE handlers (which connect under a
-- non-superuser role and call SET LOCAL app.account_uuid in the per-request
-- transaction via src/plugins/rlsContext.ts) can persist on behalf of the
-- authenticated customer and only their own rows.
--
-- Cross-customer writes are impossible: the WITH CHECK clause re-evaluates the
-- account_uuid GUC on every modified row, so even a SQL injection that escapes
-- the WHERE clause cannot place a row under another customer.
-- =============================================================================

CREATE POLICY briefings_user_insert ON briefings FOR INSERT
  WITH CHECK (account_uuid = current_setting('app.account_uuid', true));

CREATE POLICY briefings_user_update ON briefings FOR UPDATE
  USING      (account_uuid = current_setting('app.account_uuid', true))
  WITH CHECK (account_uuid = current_setting('app.account_uuid', true));

CREATE POLICY briefings_user_delete ON briefings FOR DELETE
  USING      (account_uuid = current_setting('app.account_uuid', true));

-- Force RLS even for the table owner / superuser. Without FORCE, a connection
-- whose role is the table owner (Stage 1 sandbox connects as `postgres` until
-- we provision a service-role) silently bypasses every policy above. FORCE
-- closes that escape hatch — defence in depth, and required for the H-2 RLS
-- isolation integration test to be meaningful when run against a local pg.
ALTER TABLE briefings FORCE ROW LEVEL SECURITY;
