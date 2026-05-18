-- =============================================================================
-- Migration 0005 — Delegated authorities, usage, actions
-- Source of truth: helpan-ai-schema-erd-v1.md §1.4 + §1.5 + §1.6
--
-- The most security-critical block in the rail. delegated_authorities is
-- referenced per call by every relying-party (KP, Todoku) on the validate path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- delegated_authorities — issued tokens (id == JWT jti); token itself is not
-- stored, only metadata used for revocation/validation/audit
-- -----------------------------------------------------------------------------
CREATE TABLE delegated_authorities (
  id                  TEXT PRIMARY KEY,
  account_uuid        TEXT NOT NULL,
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  scopes              JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  step_up_jti         TEXT,
  issued_by_app_id    TEXT NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revocation_reason   TEXT,
  revocation_detail   TEXT,
  CONSTRAINT delegated_authorities_status_chk
    CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT delegated_authorities_reason_chk
    CHECK (revocation_reason IS NULL OR revocation_reason IN (
      'user_initiated', 'operator_initiated', 'account_suspended',
      'kyc_downgraded', 'cascade_user_deleted', 'cascade_consent_revoked',
      'security_incident', 'expired', 'other'
    ))
);
CREATE INDEX delegated_authorities_account_status_idx ON delegated_authorities (account_uuid, status);
CREATE INDEX delegated_authorities_agent_status_idx ON delegated_authorities (agent_id, status);
CREATE INDEX delegated_authorities_status_expiry_idx ON delegated_authorities (status, expires_at);
CREATE INDEX delegated_authorities_step_up_jti_idx
  ON delegated_authorities (step_up_jti) WHERE step_up_jti IS NOT NULL;

-- -----------------------------------------------------------------------------
-- authority_usage — per-period cumulative usage for per_period_limit_minor
-- -----------------------------------------------------------------------------
CREATE TABLE authority_usage (
  authority_id      TEXT NOT NULL REFERENCES delegated_authorities(id),
  scope_id          TEXT NOT NULL REFERENCES oauth_scopes(id),
  period_window     DATE NOT NULL,
  cumulative_minor  BIGINT NOT NULL DEFAULT 0,
  call_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (authority_id, scope_id, period_window)
);

-- -----------------------------------------------------------------------------
-- actions — every agent action attempted via dispatch
-- -----------------------------------------------------------------------------
CREATE TABLE actions (
  id                       TEXT PRIMARY KEY,
  account_uuid             TEXT NOT NULL,
  agent_id                 TEXT NOT NULL REFERENCES agents(id),
  delegated_authority_jti  TEXT REFERENCES delegated_authorities(id),
  target_rail              TEXT NOT NULL,
  target_operation         TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  initiated_by             TEXT NOT NULL,
  actor_type               TEXT,
  request_payload_redacted JSONB NOT NULL,
  result_redacted          JSONB,
  error_code               TEXT,
  traceparent              TEXT,
  app_id                   TEXT NOT NULL,
  app_correlation_id       TEXT,
  idempotency_key          TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  CONSTRAINT actions_target_rail_chk
    CHECK (target_rail IN ('kipkiren_pay', 'identiti', 'todoku')),
  CONSTRAINT actions_status_chk
    CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT actions_initiated_by_chk
    CHECK (initiated_by IN ('human', 'agent', 'system')),
  CONSTRAINT actions_actor_type_chk
    CHECK (actor_type IS NULL OR actor_type IN ('human', 'agent'))
);
CREATE UNIQUE INDEX actions_idempotency_uniq ON actions (idempotency_key, app_id);
CREATE INDEX actions_account_created_idx ON actions (account_uuid, created_at DESC);
CREATE INDEX actions_agent_created_idx ON actions (agent_id, created_at DESC);
CREATE INDEX actions_daa_jti_idx
  ON actions (delegated_authority_jti) WHERE delegated_authority_jti IS NOT NULL;
CREATE INDEX actions_rail_op_status_idx ON actions (target_rail, target_operation, status);
CREATE INDEX actions_pending_idx ON actions (status, created_at) WHERE status = 'pending';
