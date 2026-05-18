-- =============================================================================
-- Migration 0003 — Agents and per-app safety policies
-- Source of truth: helpan-ai-schema-erd-v1.md §1.1 + §1.9
--
-- Both are dimensional tables that downstream business tables key off.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- agents — registered agents (one per portfolio app, plus third-party OAuth,
-- plus internal_system)
-- -----------------------------------------------------------------------------
CREATE TABLE agents (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  agent_class                 TEXT NOT NULL,
  owner_app_id                TEXT,
  third_party_oauth_client_id TEXT,
  status                      TEXT NOT NULL DEFAULT 'active',
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_at                TIMESTAMPTZ,
  retired_at                  TIMESTAMPTZ,
  CONSTRAINT agents_class_chk
    CHECK (agent_class IN ('portfolio_app', 'third_party_oauth', 'internal_system')),
  CONSTRAINT agents_status_chk
    CHECK (status IN ('active', 'suspended', 'retired'))
);
CREATE INDEX agents_class_status_idx ON agents (agent_class, status);
CREATE INDEX agents_owner_app_id_idx ON agents (owner_app_id) WHERE owner_app_id IS NOT NULL;
CREATE UNIQUE INDEX agents_third_party_oauth_client_id_uniq
  ON agents (third_party_oauth_client_id) WHERE third_party_oauth_client_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- safety_policies — per-app category whitelist/blacklist, audience posture,
-- content moderation rules, location precision floor
-- -----------------------------------------------------------------------------
CREATE TABLE safety_policies (
  id                       TEXT PRIMARY KEY,
  app_id                   TEXT NOT NULL,
  category_whitelist       TEXT[] NOT NULL DEFAULT '{}',
  category_blacklist       TEXT[] NOT NULL DEFAULT '{}',
  content_moderation_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_posture         TEXT NOT NULL DEFAULT 'general',
  location_precision_floor TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safety_policies_audience_chk
    CHECK (audience_posture IN ('family_friendly', 'general', 'adult_confirmed')),
  CONSTRAINT safety_policies_location_chk
    CHECK (location_precision_floor IS NULL
           OR location_precision_floor IN ('merchant_level', 'neighbourhood_level',
                                            'city_level', 'none'))
);
CREATE UNIQUE INDEX safety_policies_app_id_uniq ON safety_policies (app_id);
