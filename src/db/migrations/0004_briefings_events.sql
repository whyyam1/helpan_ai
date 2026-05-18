-- =============================================================================
-- Migration 0004 — Briefings, events, and matches
-- Source of truth: helpan-ai-schema-erd-v1.md §1.3 + §1.7 + §1.8
--
-- briefing_matches references both briefings (this migration) and
-- events_ingested (this migration), so the three land together.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- briefings — standing user intents the agent acts on
-- -----------------------------------------------------------------------------
CREATE TABLE briefings (
  id                  TEXT PRIMARY KEY,
  account_uuid        TEXT NOT NULL,
  app_id              TEXT NOT NULL,
  agent_id            TEXT REFERENCES agents(id),
  briefing_type       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  intent              JSONB NOT NULL,
  expires_at          TIMESTAMPTZ,
  app_correlation_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  CONSTRAINT briefings_type_chk
    CHECK (briefing_type IN ('alert', 'standing_basket', 'scheduled_action', 'threshold_watch')),
  CONSTRAINT briefings_status_chk
    CHECK (status IN ('active', 'paused', 'expired', 'revoked'))
);
CREATE INDEX briefings_account_uuid_status_idx ON briefings (account_uuid, status);
CREATE INDEX briefings_app_id_status_idx ON briefings (app_id, status);
CREATE INDEX briefings_agent_id_idx ON briefings (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX briefings_type_status_expiry_idx ON briefings (briefing_type, status, expires_at);

-- -----------------------------------------------------------------------------
-- events_ingested — events published by consuming apps for matching
-- -----------------------------------------------------------------------------
CREATE TABLE events_ingested (
  id                  TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  app_id              TEXT NOT NULL,
  account_uuid        TEXT,
  payload             JSONB NOT NULL,
  published_at        TIMESTAMPTZ NOT NULL,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status        TEXT NOT NULL DEFAULT 'pending',
  match_count         INTEGER NOT NULL DEFAULT 0,
  app_correlation_id  TEXT,
  idempotency_key     TEXT NOT NULL,
  CONSTRAINT events_ingested_match_status_chk
    CHECK (match_status IN ('pending', 'matched', 'no_match', 'dlq'))
);
CREATE UNIQUE INDEX events_ingested_idempotency_uniq ON events_ingested (idempotency_key, app_id);
CREATE INDEX events_ingested_type_app_ingested_idx
  ON events_ingested (event_type, app_id, ingested_at DESC);
CREATE INDEX events_ingested_pending_idx
  ON events_ingested (match_status, ingested_at) WHERE match_status = 'pending';

-- -----------------------------------------------------------------------------
-- briefing_matches — matched (briefing × event) tuples; one row per match
-- -----------------------------------------------------------------------------
CREATE TABLE briefing_matches (
  id                  TEXT PRIMARY KEY,
  briefing_id         TEXT NOT NULL REFERENCES briefings(id),
  event_id            TEXT NOT NULL REFERENCES events_ingested(id),
  account_uuid        TEXT NOT NULL,
  match_confidence    TEXT NOT NULL,
  match_detail        JSONB,
  webhook_delivery_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT briefing_matches_confidence_chk
    CHECK (match_confidence IN ('high', 'medium', 'low'))
);
CREATE INDEX briefing_matches_briefing_created_idx ON briefing_matches (briefing_id, created_at DESC);
CREATE INDEX briefing_matches_account_created_idx ON briefing_matches (account_uuid, created_at DESC);
CREATE INDEX briefing_matches_event_idx ON briefing_matches (event_id);
