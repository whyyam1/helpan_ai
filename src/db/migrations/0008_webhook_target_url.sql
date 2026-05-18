-- =============================================================================
-- Migration 0008 — webhook_deliveries.target_url
-- Source of truth: helpan-ai-schema-erd-v1.md §1.12 (extension at H-5)
--
-- H-5 introduces the webhook delivery worker. Each row needs to know where to
-- POST. ERD §1.12 modelled the row without `target_url`; H-5 fills the gap so
-- the worker can resolve the URL without a separate lookup table.
--
-- Resolution at enqueue time: HELPAN_WEBHOOK_URL_<APP_ID> env (uppercased) →
-- single URL per app. v1.1 will replace with a registry table once the
-- consuming-app onboarding flow exists.
-- =============================================================================

ALTER TABLE webhook_deliveries ADD COLUMN target_url TEXT NOT NULL;
