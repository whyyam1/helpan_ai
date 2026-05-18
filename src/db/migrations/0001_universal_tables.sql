-- =============================================================================
-- Migration 0001 — Universal tables
-- Source of truth: helpan-ai-schema-erd-v1.md §1.10–§1.14 + §5
-- Tables created: app_credentials, idempotency_keys, audit_log, kafka_offsets,
--                 webhook_deliveries
-- Plus: audit_log hash-chain seed row (chain genesis).
--
-- Why this batch first: every authenticated request hits app_credentials,
-- every mutating request hits idempotency_keys, every action writes audit_log.
-- Nothing in 0002+ can be exercised without these.
-- =============================================================================

-- pgcrypto provides digest() used to compute the audit_log genesis hash below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- app_credentials — per-app HMAC secrets, scopes, webhook config
-- -----------------------------------------------------------------------------
CREATE TABLE app_credentials (
  app_id                 TEXT PRIMARY KEY,
  app_name               TEXT NOT NULL,
  tenant_class           TEXT NOT NULL,
  hmac_secret            TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',
  scopes                 TEXT[] NOT NULL DEFAULT '{}',
  webhook_url            TEXT,
  webhook_signing_secret TEXT,
  rate_limits            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_credentials_tenant_class_chk
    CHECK (tenant_class IN ('internal', 'external')),
  CONSTRAINT app_credentials_status_chk
    CHECK (status IN ('active', 'suspended'))
);

-- -----------------------------------------------------------------------------
-- idempotency_keys — replay store for the shared idempotency plugin
-- PK is composite (key, app_id) so a key from one tenant cannot replay another's
-- -----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  key                TEXT NOT NULL,
  app_id             TEXT NOT NULL,
  request_body_hash  TEXT NOT NULL,
  status_code        INTEGER NOT NULL,
  response_body      JSONB NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, app_id)
);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

-- -----------------------------------------------------------------------------
-- audit_log — append-only, hash-chained, 7-year retention
-- Reboot Pack §9.5: entry_hash = SHA-256(id || actor_id || action || detail || previous_hash)
-- The chain is genesis-seeded at the bottom of this migration so action #1
-- has a well-formed previous_hash reference.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id                       TEXT PRIMARY KEY,
  app_id                   TEXT,
  actor_type               TEXT NOT NULL,
  actor_id                 TEXT NOT NULL,
  agent_id                 TEXT,
  delegated_authority_jti  TEXT,
  initiated_by             TEXT,
  account_uuid             TEXT,
  action                   TEXT NOT NULL,
  resource_type            TEXT,
  resource_id              TEXT,
  target_rail              TEXT,
  target_operation         TEXT,
  request_id               TEXT NOT NULL,
  traceparent              TEXT,
  ip_address               INET,
  outcome                  TEXT NOT NULL,
  detail                   JSONB,
  previous_hash            TEXT,
  entry_hash               TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_log_actor_type_chk
    CHECK (actor_type IN ('user', 'agent', 'operator', 'system')),
  CONSTRAINT audit_log_initiated_by_chk
    CHECK (initiated_by IS NULL OR initiated_by IN ('human', 'agent', 'system')),
  CONSTRAINT audit_log_outcome_chk
    CHECK (outcome IN ('success', 'failure'))
);
CREATE INDEX audit_log_app_id_created_at_idx ON audit_log (app_id, created_at DESC);
CREATE INDEX audit_log_account_uuid_created_at_idx ON audit_log (account_uuid, created_at DESC);
CREATE INDEX audit_log_agent_id_created_at_idx ON audit_log (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;
CREATE INDEX audit_log_daa_jti_created_at_idx ON audit_log (delegated_authority_jti, created_at DESC)
  WHERE delegated_authority_jti IS NOT NULL;
CREATE INDEX audit_log_action_created_at_idx ON audit_log (action, created_at DESC);
CREATE INDEX audit_log_rail_op_created_at_idx ON audit_log (target_rail, target_operation, created_at DESC)
  WHERE target_rail IS NOT NULL;

-- -----------------------------------------------------------------------------
-- kafka_offsets — per consumer-group offset tracking (created empty in H-1)
-- -----------------------------------------------------------------------------
CREATE TABLE kafka_offsets (
  consumer_group   TEXT NOT NULL,
  topic            TEXT NOT NULL,
  partition        INTEGER NOT NULL,
  offset_committed BIGINT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_group, topic, partition)
);

-- -----------------------------------------------------------------------------
-- webhook_deliveries — at-least-once outbound webhook state
-- -----------------------------------------------------------------------------
CREATE TABLE webhook_deliveries (
  id               TEXT PRIMARY KEY,
  app_id           TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  payload          JSONB NOT NULL,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  next_attempt_at  TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending',
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_deliveries_status_chk
    CHECK (status IN ('pending', 'delivered', 'abandoned'))
);
CREATE INDEX webhook_deliveries_app_status_next_idx
  ON webhook_deliveries (app_id, status, next_attempt_at);

-- -----------------------------------------------------------------------------
-- audit_log genesis row — seeds the hash chain with NULL previous_hash
-- entry_hash for the genesis is SHA-256 of the constant string 'helpan-ai-genesis'
-- (computed once below; verifying code can recompute from the same constant).
-- -----------------------------------------------------------------------------
INSERT INTO audit_log (
  id,
  actor_type,
  actor_id,
  action,
  request_id,
  outcome,
  previous_hash,
  entry_hash,
  detail,
  created_at
) VALUES (
  '01HELPAN0AUDITGENESIS0000000',
  'system',
  'helpan-ai-rail',
  'audit_log.genesis',
  '01HELPAN0AUDITGENESIS0000000',
  'success',
  NULL,
  encode(digest('helpan-ai-genesis', 'sha256'), 'hex'),
  jsonb_build_object('note', 'Hash chain genesis row inserted by migration 0001.'),
  NOW()
);
