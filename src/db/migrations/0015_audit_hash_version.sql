-- =============================================================================
-- Migration 0015 — audit_log hash-version discriminator (H-15)
-- Source: RECAP §6.18 — full-column audit-hash hardening before Stage 2 pen-test.
--
-- Before H-15, audit_log.entry_hash covered only
--     id | actor_id | action | resource_id | detail | previous_hash
-- — tampering with actor_type / account_uuid / app_id / outcome /
-- initiated_by / traceparent / agent_id / delegated_authority_jti /
-- target_rail / target_operation / business_op_id was not chain-detectable.
--
-- This migration adds `hash_version` so the writer can publish a v2 hash
-- composition (covering every persisted column) without breaking the chain.
-- Existing rows (incl. the genesis row from 0001) are backfilled to v1,
-- which matches their existing entry_hash composition exactly. New rows
-- written after this point go in at v2.
--
-- The verifier (scripts/verifyAuditChain.ts) reads each row's hash_version
-- and uses the matching composition; the genesis row is special-cased
-- because its hash is the literal sha256('helpan-ai-genesis'), not a
-- computeEntryHash output.
-- =============================================================================

ALTER TABLE audit_log
  ADD COLUMN hash_version SMALLINT NOT NULL DEFAULT 1;

-- Backfill is already correct via the DEFAULT 1 on existing rows. Belt-and-
-- braces UPDATE so a future PostgreSQL behaviour change can't silently break
-- the invariant. Idempotent.
UPDATE audit_log SET hash_version = 1 WHERE hash_version IS NULL;

-- Lock the column NOT NULL post-backfill so writes that forget the version
-- fail at INSERT time rather than producing a row that the verifier can't
-- categorise.
ALTER TABLE audit_log
  ALTER COLUMN hash_version SET NOT NULL;

-- Constraint: hash_version must be a known version. Adding 3, 4, ... here
-- is the migration shape for any future composition change. Keeping the
-- check tight surfaces accidental schema drift loudly.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_hash_version_chk
    CHECK (hash_version IN (1, 2));
