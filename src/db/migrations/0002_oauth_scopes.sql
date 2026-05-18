-- =============================================================================
-- Migration 0002 — OAuth scope catalogue
-- Source of truth: helpan-ai-schema-erd-v1.md §1.2 + helpan-ai-oauth-scope-catalogue-v1.md
--
-- The catalogue is part of the schema (not a runtime asset) so every environment
-- has the same canonical scope IDs. Apps and agents reference these IDs by FK
-- semantics from H-2 onward.
-- =============================================================================

CREATE TABLE oauth_scopes (
  id                              TEXT PRIMARY KEY,
  name                            TEXT NOT NULL,
  description                     TEXT NOT NULL,
  rail                            TEXT NOT NULL,
  category                        TEXT NOT NULL,
  default_grantable               BOOLEAN NOT NULL DEFAULT TRUE,
  elevation_friction              TEXT NOT NULL DEFAULT 'low',
  per_scope_amount_ceiling_minor  BIGINT,
  per_scope_period_ceiling_minor  BIGINT,
  per_scope_max_ttl_seconds       INTEGER NOT NULL,
  status                          TEXT NOT NULL DEFAULT 'active',
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_scopes_rail_chk
    CHECK (rail IN ('helpan', 'kipkiren_pay', 'identiti', 'todoku',
                    'lunchdrop', 'chapaa', 'klokd', 'family_discovery')),
  CONSTRAINT oauth_scopes_category_chk
    CHECK (category IN ('read_aggregate', 'read_behavioural', 'write_money',
                        'write_comms', 'write_identity', 'admin')),
  CONSTRAINT oauth_scopes_elevation_chk
    CHECK (elevation_friction IN ('low', 'medium', 'high')),
  CONSTRAINT oauth_scopes_status_chk
    CHECK (status IN ('active', 'deprecated', 'retired'))
);
CREATE INDEX oauth_scopes_rail_status_idx ON oauth_scopes (rail, status);

-- -----------------------------------------------------------------------------
-- Seed canonical scopes from helpan-ai-oauth-scope-catalogue-v1.md.
-- Subset that H-1 needs: helpan-rail-internal admin scopes + the most-named
-- KP/Todoku/Identiti scopes from the design corpus. The full catalogue is
-- expected to land at H-6 when the OAuth endpoints ship — until then this
-- seed is the floor.
--
-- Conventions:
--   * IDs are dotted: <rail>.<verb>.<resource>
--   * TTLs in seconds; ceilings in KES minor units (cents); NULL = no ceiling.
-- -----------------------------------------------------------------------------
INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  -- Helpan AI internal / admin
  ('helpan.read.briefings',     'Read briefings',
   'List and read the user''s own briefings.',
   'helpan', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400),
  ('helpan.write.briefings',    'Write briefings',
   'Create, update, and revoke briefings on the user''s behalf.',
   'helpan', 'admin', TRUE, 'low',
   NULL, NULL, 86400),
  ('helpan.read.activity',      'Read activity log',
   'Read the activity log surfaced in the Helpan Console.',
   'helpan', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400),
  ('helpan.admin.authorities',  'Manage delegated authorities',
   'Issue, validate, and revoke delegated authority tokens.',
   'helpan', 'admin', FALSE, 'high',
   NULL, NULL, 3600),
  ('operator.read',             'Operator read',
   'Operator-only read access (audit log, deep health, registry).',
   'helpan', 'admin', FALSE, 'high',
   NULL, NULL, 3600),

  -- Kipkiren Pay (write_money — high friction, narrow TTLs)
  ('kipkiren.read.balance',     'Read wallet balance',
   'Read the user''s wallet balance and recent statement.',
   'kipkiren_pay', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400),
  ('kipkiren.write.payments',   'Initiate payments',
   'Initiate payments under explicit per-call and per-period ceilings.',
   'kipkiren_pay', 'write_money', FALSE, 'high',
   500000, 5000000, 3600),
  ('kipkiren.write.holds',      'Hold and release funds',
   'Place transactional holds and release/refund (Klokd shift escrow, Lunch Drop order escrow).',
   'kipkiren_pay', 'write_money', FALSE, 'high',
   500000, 5000000, 3600),
  ('kipkiren.write.schedules',  'Programmable money',
   'Create scheduled transfers (family-discovery standing-basket).',
   'kipkiren_pay', 'write_money', FALSE, 'high',
   100000, 1000000, 86400),

  -- Todoku (write_comms — anti-spam friction)
  ('todoku.write.notifications', 'Send notifications',
   'Send a notification to the user via Todoku envelope.',
   'todoku', 'write_comms', TRUE, 'medium',
   NULL, NULL, 3600),

  -- Identiti (read-only at the OAuth-scope layer; identity writes are protected)
  ('identiti.read.tier',        'Read account tier',
   'Read the user''s KYC tier signal.',
   'identiti', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);
