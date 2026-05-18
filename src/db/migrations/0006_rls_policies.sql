-- =============================================================================
-- Migration 0006 — Row-Level Security policies
-- Source of truth: helpan-ai-schema-erd-v1.md §3
--
-- Lands last because policies reference columns on tables created in 0003–0005.
-- The connection-time GUCs read by policies (set by src/plugins/db.ts via
-- SET LOCAL on the per-request transaction):
--   * app.account_uuid  — for user-scoped reads
--   * app.app_id        — for per-app service-role reads
--   * app.role          — 'user' | 'app' | 'operator' (default operator-only on audit_log)
--
-- v1 policy posture per ERD §3.3: cross-app reads deferred to v1.1; v1
-- enforces single-app default with no cross-app RLS bypass.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- briefings
-- -----------------------------------------------------------------------------
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY briefings_user_read ON briefings FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));

CREATE POLICY briefings_app_read ON briefings FOR SELECT
  USING (app_id = current_setting('app.app_id', true));

-- -----------------------------------------------------------------------------
-- delegated_authorities
-- -----------------------------------------------------------------------------
ALTER TABLE delegated_authorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY authorities_user_read ON delegated_authorities FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));

-- -----------------------------------------------------------------------------
-- actions
-- -----------------------------------------------------------------------------
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY actions_user_read ON actions FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));

-- -----------------------------------------------------------------------------
-- audit_log — operator-only read in v1
-- -----------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_operator_only ON audit_log FOR SELECT
  USING (current_setting('app.role', true) = 'operator');
