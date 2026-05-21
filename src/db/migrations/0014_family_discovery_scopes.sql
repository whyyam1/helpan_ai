-- =============================================================================
-- Migration 0014 — Helpan family-discovery per-app catalogue (H-12)
-- Source: helpan-ai-per-app-integration-patterns-v1.md §4.4 + §4.6
--
-- Last per-app sprint. Agent-native from day one (§4.1) — the agent IS the
-- primary interaction model for this app, not a UX augmentation. Two
-- paper-only catalogue rows on the existing `family_discovery` rail.
--
-- Per §4.8: brand name is TBD. Rail-side identifier stays
-- `family_discovery` per the spec's literal placeholder; search-and-replace
-- at brand-lock time, before Stage 2.
-- =============================================================================

INSERT INTO oauth_scopes
  (id, name, description, rail, category, default_grantable, elevation_friction,
   per_scope_amount_ceiling_minor, per_scope_period_ceiling_minor, per_scope_max_ttl_seconds)
VALUES
  -- Standing-basket execution + manual basket dispatch.
  -- §4.4 example: amount_limit_minor 250_000 = KES 2,500 per basket;
  -- per_scope_period_ceiling_minor 2_000_000 = KES 20,000 monthly.
  -- 24h TTL ceiling. Authority-level category_whitelist (food/household/etc)
  -- is enforced by the authority, not the catalogue row — the catalogue
  -- just defines the SCOPE; the AUTHORITY layers narrowing on top.
  ('family_discovery.write.basket', 'Place a family-discovery basket',
   'Place a single-merchant basket on the user''s behalf within per-basket and per-period limits.',
   'family_discovery', 'write_money', FALSE, 'high',
   250000, 2000000, 86400),

  -- Discovery read — for the fresh_arrivals briefing path. Aggregate.
  ('family_discovery.read.discovery', 'Read discovery feed',
   'Read the family-discovery surface aggregate (categories, prices, fresh-arrival flags).',
   'family_discovery', 'read_aggregate', TRUE, 'low',
   NULL, NULL, 86400);
