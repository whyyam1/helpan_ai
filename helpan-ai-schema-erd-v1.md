# Helpan AI Rail — Schema and ERD v1.0

**Document type:** Database schema and entity-relationship diagram for the Helpan AI rail.
**Date:** 7 May 2026
**Authority:** Helpan AI Rail Design Instruction Pack v1.0 §7; Reboot Pack v1.2 §9; Claude Code Instruction Pack v1.0 §3 (universal conventions).
**Status:** Authoritative for Stage 1 sandbox build. Drizzle migration files derive from this.

---

## 0. Conventions (inherited from Platform Rails)

- All primary keys: ULID stored as `TEXT`, prefixed (`brf_`, `daa_`, etc.).
- All timestamps: `TIMESTAMPTZ` with explicit UTC.
- All monetary amounts: `BIGINT` (KES minor units).
- Soft-delete on records with audit-trail significance.
- Row-Level Security enabled on every table; default policy: account-scoped read.
- Append-only audit_log per Reboot Pack §9.5.
- 7-year retention for security and financial events.

---

## 1. Tables

### 1.1 `agents`

```sql
CREATE TABLE agents (
  id                          TEXT PRIMARY KEY,                  -- agt_<ULID>
  name                        TEXT NOT NULL,
  agent_class                 TEXT NOT NULL CHECK (agent_class IN ('portfolio_app', 'third_party_oauth', 'internal_system')),
  owner_app_id                TEXT,                              -- for portfolio_app: which consuming app
  third_party_oauth_client_id TEXT,                              -- for third_party_oauth: OAuth client_id at Identiti
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'retired')),
  metadata                    JSONB NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_at                TIMESTAMPTZ,
  retired_at                  TIMESTAMPTZ
);
CREATE INDEX ON agents (agent_class, status);
CREATE INDEX ON agents (owner_app_id) WHERE owner_app_id IS NOT NULL;
CREATE UNIQUE INDEX ON agents (third_party_oauth_client_id) WHERE third_party_oauth_client_id IS NOT NULL;
```

### 1.2 `oauth_scopes`

```sql
CREATE TABLE oauth_scopes (
  id                  TEXT PRIMARY KEY,                          -- e.g. 'kipkiren.write.payments'
  name                TEXT NOT NULL,
  description         TEXT NOT NULL,
  rail                TEXT NOT NULL CHECK (rail IN ('helpan', 'kipkiren_pay', 'identiti', 'todoku', 'lunchdrop', 'chapaa', 'klokd', 'family_discovery')),
  category            TEXT NOT NULL CHECK (category IN ('read_aggregate', 'read_behavioural', 'write_money', 'write_comms', 'write_identity', 'admin')),
  default_grantable   BOOLEAN NOT NULL DEFAULT TRUE,
  elevation_friction  TEXT NOT NULL DEFAULT 'low' CHECK (elevation_friction IN ('low', 'medium', 'high')),
  per_scope_amount_ceiling_minor      BIGINT,
  per_scope_period_ceiling_minor      BIGINT,
  per_scope_max_ttl_seconds           INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'retired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON oauth_scopes (rail, status);
```

### 1.3 `briefings`

```sql
CREATE TABLE briefings (
  id                  TEXT PRIMARY KEY,                          -- brf_<ULID>
  account_uuid        TEXT NOT NULL,                             -- foreign reference to Identiti
  app_id              TEXT NOT NULL,
  agent_id            TEXT REFERENCES agents(id),
  briefing_type       TEXT NOT NULL CHECK (briefing_type IN ('alert', 'standing_basket', 'scheduled_action', 'threshold_watch')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired', 'revoked')),
  intent              JSONB NOT NULL,                            -- structured intent; schema varies by app and briefing_type
  expires_at          TIMESTAMPTZ,
  app_correlation_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);
CREATE INDEX ON briefings (account_uuid, status);
CREATE INDEX ON briefings (app_id, status);
CREATE INDEX ON briefings (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX ON briefings (briefing_type, status, expires_at);
```

### 1.4 `delegated_authorities`

```sql
CREATE TABLE delegated_authorities (
  id                       TEXT PRIMARY KEY,                     -- daa_<ULID>; same value as JWT jti
  account_uuid             TEXT NOT NULL,                        -- delegating user
  agent_id                 TEXT NOT NULL REFERENCES agents(id),
  scopes                   JSONB NOT NULL,                       -- array of AuthorityScope objects
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  step_up_jti              TEXT,                                 -- step-up token consumed at issuance (high-stakes only)
  issued_by_app_id         TEXT NOT NULL,                        -- consuming app that called POST /authorities
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ NOT NULL,
  revoked_at               TIMESTAMPTZ,
  revocation_reason        TEXT CHECK (revocation_reason IN ('user_initiated', 'operator_initiated', 'account_suspended', 'kyc_downgraded', 'cascade_user_deleted', 'cascade_consent_revoked', 'security_incident', 'expired', 'other')),
  revocation_detail        TEXT
);
CREATE INDEX ON delegated_authorities (account_uuid, status);
CREATE INDEX ON delegated_authorities (agent_id, status);
CREATE INDEX ON delegated_authorities (status, expires_at);                   -- for expiry sweep
CREATE INDEX ON delegated_authorities (step_up_jti) WHERE step_up_jti IS NOT NULL;
```

### 1.5 `authority_usage`

Tracks per-period cumulative usage for `per_period_limit_minor` enforcement.

```sql
CREATE TABLE authority_usage (
  authority_id        TEXT NOT NULL REFERENCES delegated_authorities(id),
  scope_id            TEXT NOT NULL REFERENCES oauth_scopes(id),
  period_window       DATE NOT NULL,                             -- daily/weekly/monthly window key
  cumulative_minor    BIGINT NOT NULL DEFAULT 0,
  call_count          INTEGER NOT NULL DEFAULT 0,
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (authority_id, scope_id, period_window)
);
```

### 1.6 `actions`

```sql
CREATE TABLE actions (
  id                       TEXT PRIMARY KEY,                     -- act_<ULID>
  account_uuid             TEXT NOT NULL,
  agent_id                 TEXT NOT NULL REFERENCES agents(id),
  delegated_authority_jti  TEXT REFERENCES delegated_authorities(id),
  target_rail              TEXT NOT NULL CHECK (target_rail IN ('kipkiren_pay', 'identiti', 'todoku')),
  target_operation         TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  initiated_by             TEXT NOT NULL CHECK (initiated_by IN ('human', 'agent', 'system')),
  actor_type               TEXT CHECK (actor_type IN ('human', 'agent')),
  request_payload_redacted JSONB NOT NULL,                       -- redacted; no PII, no full PANs, no plaintext phone
  result_redacted          JSONB,
  error_code               TEXT,
  traceparent              TEXT,
  app_id                   TEXT NOT NULL,
  app_correlation_id       TEXT,
  idempotency_key          TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);
CREATE UNIQUE INDEX ON actions (idempotency_key, app_id);
CREATE INDEX ON actions (account_uuid, created_at DESC);
CREATE INDEX ON actions (agent_id, created_at DESC);
CREATE INDEX ON actions (delegated_authority_jti) WHERE delegated_authority_jti IS NOT NULL;
CREATE INDEX ON actions (target_rail, target_operation, status);
CREATE INDEX ON actions (status, created_at) WHERE status = 'pending';
```

### 1.7 `events_ingested`

```sql
CREATE TABLE events_ingested (
  id                  TEXT PRIMARY KEY,                          -- evt_<ULID>
  event_type          TEXT NOT NULL,
  app_id              TEXT NOT NULL,
  account_uuid        TEXT,
  payload             JSONB NOT NULL,
  published_at        TIMESTAMPTZ NOT NULL,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status        TEXT NOT NULL DEFAULT 'pending' CHECK (match_status IN ('pending', 'matched', 'no_match', 'dlq')),
  match_count         INTEGER NOT NULL DEFAULT 0,
  app_correlation_id  TEXT,
  idempotency_key     TEXT NOT NULL
);
CREATE UNIQUE INDEX ON events_ingested (idempotency_key, app_id);
CREATE INDEX ON events_ingested (event_type, app_id, ingested_at DESC);
CREATE INDEX ON events_ingested (match_status, ingested_at) WHERE match_status = 'pending';
```

### 1.8 `briefing_matches`

```sql
CREATE TABLE briefing_matches (
  id                  TEXT PRIMARY KEY,                          -- bmt_<ULID>
  briefing_id         TEXT NOT NULL REFERENCES briefings(id),
  event_id            TEXT NOT NULL REFERENCES events_ingested(id),
  account_uuid        TEXT NOT NULL,
  match_confidence    TEXT NOT NULL CHECK (match_confidence IN ('high', 'medium', 'low')),
  match_detail        JSONB,
  webhook_delivery_id TEXT,                                      -- handle to webhook delivery row
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON briefing_matches (briefing_id, created_at DESC);
CREATE INDEX ON briefing_matches (account_uuid, created_at DESC);
CREATE INDEX ON briefing_matches (event_id);
```

### 1.9 `safety_policies`

```sql
CREATE TABLE safety_policies (
  id                       TEXT PRIMARY KEY,                     -- sfp_<ULID>
  app_id                   TEXT NOT NULL UNIQUE,
  category_whitelist       TEXT[] NOT NULL DEFAULT '{}',
  category_blacklist       TEXT[] NOT NULL DEFAULT '{}',
  content_moderation_rules JSONB NOT NULL DEFAULT '[]',
  audience_posture         TEXT NOT NULL DEFAULT 'general' CHECK (audience_posture IN ('family_friendly', 'general', 'adult_confirmed')),
  location_precision_floor TEXT CHECK (location_precision_floor IN ('merchant_level', 'neighbourhood_level', 'city_level', 'none')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.10 `app_credentials`

```sql
CREATE TABLE app_credentials (
  app_id        TEXT PRIMARY KEY,
  app_name      TEXT NOT NULL,
  tenant_class  TEXT NOT NULL CHECK (tenant_class IN ('internal', 'external')),
  hmac_secret   TEXT NOT NULL,                                   -- encrypted at rest
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  scopes        TEXT[] NOT NULL DEFAULT '{}',                    -- e.g. ['helpan:authorities:issue', 'helpan:actions:dispatch']
  webhook_url   TEXT,
  webhook_signing_secret TEXT,                                   -- encrypted at rest
  rate_limits   JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.11 `idempotency_keys`

```sql
CREATE TABLE idempotency_keys (
  key                 TEXT NOT NULL,
  app_id              TEXT NOT NULL,
  request_body_hash   TEXT NOT NULL,
  status_code         INTEGER NOT NULL,
  response_body       JSONB NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, app_id)
);
CREATE INDEX ON idempotency_keys (expires_at);                   -- for cleanup
```

### 1.12 `webhook_deliveries`

```sql
CREATE TABLE webhook_deliveries (
  id                  TEXT PRIMARY KEY,
  app_id              TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  event_id            TEXT NOT NULL,
  payload             JSONB NOT NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TIMESTAMPTZ,
  next_attempt_at     TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'abandoned')),
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON webhook_deliveries (app_id, status, next_attempt_at);
```

### 1.13 `audit_log`

Per Reboot Pack §9.5. Tamper-evident hash chain.

```sql
CREATE TABLE audit_log (
  id                       TEXT PRIMARY KEY,                     -- ULID
  app_id                   TEXT,
  actor_type               TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'operator', 'system')),
  actor_id                 TEXT NOT NULL,
  agent_id                 TEXT,
  delegated_authority_jti  TEXT,
  initiated_by             TEXT CHECK (initiated_by IN ('human', 'agent', 'system')),
  account_uuid             TEXT,
  action                   TEXT NOT NULL,
  resource_type            TEXT,
  resource_id              TEXT,
  target_rail              TEXT,
  target_operation         TEXT,
  request_id               TEXT NOT NULL,
  traceparent              TEXT,
  ip_address               INET,
  outcome                  TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  detail                   JSONB,
  previous_hash            TEXT,                                 -- hash chain
  entry_hash               TEXT NOT NULL,                        -- SHA-256(id + actor_id + action + detail + previous_hash)
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON audit_log (app_id, created_at DESC);
CREATE INDEX ON audit_log (account_uuid, created_at DESC);
CREATE INDEX ON audit_log (agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX ON audit_log (delegated_authority_jti, created_at DESC) WHERE delegated_authority_jti IS NOT NULL;
CREATE INDEX ON audit_log (action, created_at DESC);
CREATE INDEX ON audit_log (target_rail, target_operation, created_at DESC) WHERE target_rail IS NOT NULL;
```

### 1.14 `kafka_offsets` (consumer offset tracking)

```sql
CREATE TABLE kafka_offsets (
  consumer_group   TEXT NOT NULL,
  topic            TEXT NOT NULL,
  partition        INTEGER NOT NULL,
  offset_committed BIGINT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_group, topic, partition)
);
```

---

## 2. ERD (textual)

```
                           ┌────────────────┐
                           │   agents       │
                           │ id (PK)        │
                           │ agent_class    │
                           │ status         │
                           └───────┬────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
              ▼                    ▼                     ▼
      ┌──────────────┐    ┌────────────────┐     ┌──────────────┐
      │  briefings   │    │ delegated_     │     │  actions     │
      │ id (PK)      │    │ authorities    │     │ id (PK)      │
      │ account_uuid │    │ id (PK = jti)  │     │ account_uuid │
      │ agent_id ───►│    │ account_uuid   │     │ agent_id ───►│
      │ briefing_type│    │ agent_id ─────►│     │ delegated_…  │
      │ intent       │    │ scopes (JSONB) │     │ ─jti ───────►│
      │ status       │    │ status         │     │ target_rail  │
      └──────┬───────┘    │ expires_at     │     │ target_op    │
             │            │ step_up_jti    │     │ status       │
             │            └────────┬───────┘     │ initiated_by │
             │                     │             └──────────────┘
             │                     │
             │            ┌────────▼─────────┐
             │            │ authority_usage  │
             │            │ (authority_id,   │
             │            │  scope_id,       │
             │            │  period_window)  │
             │            │  PK              │
             │            │ cumulative_minor │
             │            └──────────────────┘
             │
      ┌──────▼────────┐    ┌──────────────────┐
      │briefing_      │    │ events_ingested  │
      │matches        │◄───┤ id (PK)          │
      │ id (PK)       │    │ event_type       │
      │ briefing_id ─►│    │ app_id           │
      │ event_id ────►│    │ account_uuid     │
      │ confidence    │    │ payload          │
      │ webhook_      │    │ match_status     │
      │  delivery_id  │    └──────────────────┘
      └───────────────┘

   ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ safety_policies │    │ oauth_scopes     │    │ app_credentials  │
   │ id (PK)         │    │ id (PK)          │    │ app_id (PK)      │
   │ app_id (UNIQUE) │    │ rail, category   │    │ scopes[]         │
   │ category_*      │    │ default_grantable│    │ webhook_url      │
   │ audience_posture│    │ ceilings         │    │ rate_limits      │
   └─────────────────┘    └──────────────────┘    └──────────────────┘

   ┌──────────────────┐   ┌──────────────────┐    ┌──────────────────┐
   │ audit_log        │   │webhook_deliveries│    │ idempotency_keys │
   │ hash chain       │   │ at-least-once    │    │ 24h window       │
   │ 7yr retention    │   │ retry schedule   │    │                  │
   └──────────────────┘   └──────────────────┘    └──────────────────┘
```

---

## 3. RLS policies (defence in depth)

### 3.1 Default user-scoped read

```sql
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY briefings_user_read ON briefings FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));

ALTER TABLE delegated_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY authorities_user_read ON delegated_authorities FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY actions_user_read ON actions FOR SELECT
  USING (account_uuid = current_setting('app.account_uuid', true));
```

### 3.2 Per-app service role read

```sql
CREATE POLICY briefings_app_read ON briefings FOR SELECT
  USING (app_id = current_setting('app.app_id', true));
```

### 3.3 Cross-app read requires explicit consent record

Out of v1.0 — cross-app data access flows are deferred to v1.1 per DoD §5. v1.0 enforces single-app default with no cross-app RLS bypass.

### 3.4 Operator role

```sql
-- audit_log readable only by operator service-role connection
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_operator_only ON audit_log FOR SELECT
  USING (current_setting('app.role', true) = 'operator');
```

---

## 4. Indexes — performance summary

Critical query paths and the indexes that serve them:

| Query | Index |
|---|---|
| Helpan Console: list active authorities for user | `(account_uuid, status)` |
| Helpan Console: activity log for user (last 30 actions per authority) | `(account_uuid, created_at DESC)`, `(delegated_authority_jti, created_at DESC)` |
| Validate endpoint: lookup authority by JTI | PK |
| Authority expiry sweep | `(status, expires_at)` |
| Idempotency replay | `(idempotency_key, app_id)` UNIQUE |
| Matching engine: pending events | `(match_status, ingested_at) WHERE match_status='pending'` |
| Webhook delivery worker | `(app_id, status, next_attempt_at)` |
| Audit query by action | `(action, created_at DESC)` |
| Audit query by traceparent | TBD (consider GIN if traceparent search is hot) |

---

## 5. Migration sequence (for build)

Drizzle migrations land in order:

1. `0001_universal_tables.sql` — `app_credentials`, `idempotency_keys`, `audit_log`, `kafka_offsets`, `webhook_deliveries`.
2. `0002_oauth_scopes.sql` — `oauth_scopes` + seed canonical scopes from `helpan-ai-oauth-scope-catalogue-v1.md`.
3. `0003_agents_safety.sql` — `agents`, `safety_policies`.
4. `0004_briefings_events.sql` — `briefings`, `events_ingested`, `briefing_matches`.
5. `0005_authorities_actions.sql` — `delegated_authorities`, `authority_usage`, `actions`.
6. `0006_rls_policies.sql` — RLS policies per §3.

---

*Helpan AI Rail · Schema and ERD v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
