-- =============================================================================
-- Migration 0013 — Helpan Chapaa per-app catalogue (H-11)
-- Source: helpan-ai-per-app-integration-patterns-v1.md §3.4 + §3.6 + §3.7
--
-- Highest-stakes integration in the portfolio (McKinsey deposits-at-34%-
-- risk thesis lands here). Four paper-only catalogue rows on the existing
-- `chapaa` rail. v1.0 keeps autonomous money movement narrow — only
-- `chapaa.write.deposit` (round-up auto-accept). MMF rebalancing stays
-- suggest-only per §3.6; no `chapaa.mmf.rebalance` scope at v1.0.
-- =============================================================================

INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  -- v1.0 autonomous deposit (round-up auto-acceptance). Mirrors the §3.4
  -- shape exactly: amount_limit_minor 30_000 = KES 300 per call;
  -- per_scope_period_ceiling_minor 1_000_000 = KES 10,000 monthly.
  -- 1h TTL ceiling — short-window single-deposit semantics per §A.1 JIT.
  ('chapaa.write.deposit', 'Deposit into a savings goal',
   'Deposit into a savings goal on the user''s behalf (round-up auto-acceptance and similar narrow uses).',
   'chapaa', 'write_money', FALSE, 'high',
   30000, 1000000, 3600),

  -- The behavioural-data scope. §3.6 STRICT containment: this scope must
  -- always require the Console behavioural-friction screen (§4.2 of the
  -- Console spec). default_grantable=FALSE — never auto-granted; the
  -- friction screen is the only granting path. read_behavioural category
  -- is the discriminator the Console UI reads to know to show the friction.
  ('chapaa.read.behavioural', 'Read behavioural savings patterns',
   'Read savings cadence, withdrawal patterns, and goal completions. STRICT containment — Console behavioural-friction screen required to grant.',
   'chapaa', 'read_behavioural', FALSE, 'high',
   NULL, NULL, 3600),

  -- Aggregate credit-unlock status (§3.7). Surface-only — Helpan AI does
  -- not own the credit relationship; the partner-lender architecture
  -- handles disbursement and collection out of band.
  ('chapaa.read.credit_unlock_status', 'Read credit-unlock status',
   'Read whether the user has unlocked a tier of micro-credit. Aggregate status only — not the credit relationship itself.',
   'chapaa', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400),

  -- Goal read — required by the goal_acceleration briefing path. Aggregate.
  ('chapaa.read.goals', 'Read savings goals',
   'Read the user''s savings goals (id, target, progress, deadline). Aggregate per goal.',
   'chapaa', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);
