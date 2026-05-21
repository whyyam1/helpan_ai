-- =============================================================================
-- Migration 0010 — Newdocs Instruction Pack additions (21 May 2026)
-- Source: NEWDOCS_INSTRUCTION_PACK.md §H-NN scope catalogue + §H-8c (paper).
--
-- Adds OAuth scope catalogue entries introduced by the 21 May 2026 newdocs
-- batch (KWS Sprint 9, Itafika S0, Hakken consumer wiring).
--
-- Catalogue-only; no agents are issued these scopes at this migration. Agent
-- admission (helpan-kws-v1) runs separately via `scripts/seedHelpanKwsAdmission.ts`
-- so the registration is chained into the audit log via appendAuditEntry.
--
-- Three open questions are deliberately decided conservatively here; revisit
-- in a follow-up migration once Chamia / Identiti rule on them:
--   * Rail allow-list — itafika, hakken, kipkiren_web_services admitted.
--     Open Q3 (delivery.dispatch class) decided: keep delivery semantics on
--     the Itafika rail; do not invent a new top-level category.
--   * KWS Phase-2 scope TTL pinned at 3600s (matches the §A.1 high-stakes
--     band and existing kipkiren.write.* scopes), NOT the 72h figure in the
--     KWS instruction pack §3.2. Open Q7 — joint Identiti + Helpan decision
--     still pending; this migration takes the JIT-compliant side.
--   * KWS Phase-2 scopes are admin-category, high-elevation-friction,
--     default_grantable=FALSE. Paper-only until Phase 2 ADR-KWS-002 is
--     ratified (the agent build lands at H-8d).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Admit the three new rails Helpan-AI cares about.
-- -----------------------------------------------------------------------------
ALTER TABLE oauth_scopes DROP CONSTRAINT oauth_scopes_rail_chk;
ALTER TABLE oauth_scopes ADD CONSTRAINT oauth_scopes_rail_chk
  CHECK (rail IN ('helpan', 'kipkiren_pay', 'identiti', 'todoku',
                  'lunchdrop', 'chapaa', 'klokd', 'family_discovery',
                  'itafika', 'hakken', 'kipkiren_web_services'));

-- -----------------------------------------------------------------------------
-- Itafika S0 — delivery dispatch. High-stakes (operational + financial).
-- -----------------------------------------------------------------------------
INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  ('delivery.dispatch', 'Dispatch a delivery',
   'Dispatch a delivery on the user''s behalf against their delivery preferences and address book.',
   'itafika', 'write_money', FALSE, 'high',
   NULL, NULL, 3600);

-- -----------------------------------------------------------------------------
-- Hakken — outbound discovery / ranking query. Read-only, broad TTL.
-- Used by Helpan-AI-rail-side agent runners when HK-3 ships; the scope
-- exists in the catalogue ahead of time so the auth wiring is locked.
-- -----------------------------------------------------------------------------
INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  ('discovery.query', 'Query discovery / ranking',
   'Query the Hakken discovery and ranking surface on behalf of an agent flow.',
   'hakken', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);

-- -----------------------------------------------------------------------------
-- Helpan KWS Phase-2 execution scopes — paper only.
-- Phase 1 (enrichment) does NOT issue authorities. Phase 2 (autonomous
-- DNS / SSL / MX / domain / uptime execution) routes via the rail's action
-- dispatch (H-4) per Open Question 4 — when that lands, these are the
-- callable surfaces.
-- -----------------------------------------------------------------------------
INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  ('kws.dns.write', 'Write DNS configuration',
   'Create, update, and delete DNS records on a domain managed by Helpan KWS.',
   'kipkiren_web_services', 'admin', FALSE, 'high',
   NULL, NULL, 3600),
  ('kws.ssl.write', 'Write SSL configuration',
   'Issue, renew, and revoke SSL certificates on a domain managed by Helpan KWS.',
   'kipkiren_web_services', 'admin', FALSE, 'high',
   NULL, NULL, 3600),
  ('kws.mx.write', 'Write MX configuration',
   'Configure mail routing (MX records) on a domain managed by Helpan KWS.',
   'kipkiren_web_services', 'admin', FALSE, 'high',
   NULL, NULL, 3600),
  ('kws.domain.write', 'Manage domain registration',
   'Renew, transfer, and configure domain registration on the user''s behalf via Helpan KWS.',
   'kipkiren_web_services', 'admin', FALSE, 'high',
   NULL, NULL, 3600),
  ('kws.uptime.write', 'Configure uptime monitoring',
   'Configure uptime monitoring and alerting on a domain managed by Helpan KWS.',
   'kipkiren_web_services', 'admin', FALSE, 'high',
   NULL, NULL, 3600);
