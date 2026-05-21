-- =============================================================================
-- Migration 0012 — Helpan Lunch Drop per-app catalogue (H-10)
-- Source: helpan-ai-per-app-integration-patterns-v1.md §2.4 + §2.2
--
-- Two paper-only catalogue rows on the existing `lunchdrop` rail. No
-- authorities are issued yet — Lunch Drop's backend wires these up at
-- its own integration sprint. The §2.4 employer-side authority example
-- maps directly onto `lunchdrop.write.orders`.
-- =============================================================================

INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  -- Order placement. Money-class; mirrors the §2.4 example
  -- (amount_limit_minor 100_000 = KES 1,000 per call; per_period_limit_minor
  -- 3_000_000 = KES 30,000 per week). Step-up required at issue time.
  ('lunchdrop.write.orders', 'Place orders on Lunch Drop',
   'Place a Lunch Drop order on the user''s behalf, within per-call and per-period limits.',
   'lunchdrop', 'write_money', FALSE, 'high',
   100000, 3000000, 86400),

  -- ZoneFeed read for augmentation suggestions. Read-only, low friction.
  ('lunchdrop.read.zone_feed', 'Read ZoneFeed',
   'Read the user''s ZoneFeed to power agent-side personalisation and suggestions. Aggregate only.',
   'lunchdrop', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);
