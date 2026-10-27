-- =============================================================================
-- Migration 0017 — admit `klokd` as an H-4 dispatch target rail.
--
-- Klokd (octopus-api) executes `klokd.write.shift_signup` on a worker's
-- behalf at POST /api/v1/agents/dispatch/{operation}. Until now the actions
-- CHECK only allowed the three regulated rails, so a Klokd-targeted dispatch
-- could not be persisted. Widening the CHECK is additive; existing rows are
-- unaffected.
-- =============================================================================

ALTER TABLE actions DROP CONSTRAINT actions_target_rail_chk;

ALTER TABLE actions ADD CONSTRAINT actions_target_rail_chk
  CHECK (target_rail IN ('kipkiren_pay', 'identiti', 'todoku', 'klokd'));
