-- =============================================================================
-- Migration 0011 — Helpan Klokd per-app catalogue (H-9)
-- Source: helpan-ai-per-app-integration-patterns-v1.md §1.4 + §1.2
--
-- Paper-only catalogue rows for the Klokd per-app sprint. No authorities
-- are issued yet — the embedding Klokd backend wires these up at its own
-- integration sprint. The TTL ceilings + amount limits match the §1.4
-- worker-side / employer-side authority shapes exactly.
-- =============================================================================

INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  -- Employer-side pay-on-completion. Money-class; mirrors the §1.4 example
  -- (KES 2,000 per shift = 200_000 minor; KES 50,000 per month = 5_000_000).
  ('klokd.write.shift_pay', 'Pay a worker on shift completion',
   'Disburse pay to a verified worker on shift completion via Kipkiren Pay payout.',
   'klokd', 'write_money', FALSE, 'high',
   200000, 5000000, 3600),

  -- Worker-side autonomous shift sign-up. No money — per-period count is
  -- enforced in Klokd app logic (max shifts per week). Stake is high (the
  -- agent commits the user's time) so default_grantable=FALSE + high friction.
  ('klokd.write.shift_signup', 'Sign up for a shift on behalf of the worker',
   'Sign the worker up for a shift matching their saved preferences. Per-period count enforced app-side.',
   'klokd', 'admin', FALSE, 'high',
   NULL, NULL, 86400),

  -- Worker reputation read — aggregate only. Read-only, low friction.
  ('klokd.read.worker_reputation', 'Read aggregate worker reputation',
   'Read the worker''s reputation aggregate (rating, completed-shifts count). Aggregate only — no per-employer detail.',
   'klokd', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);
