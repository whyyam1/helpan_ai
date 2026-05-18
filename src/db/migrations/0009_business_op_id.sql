-- =============================================================================
-- Migration 0009 — business_op_id (cross-rail audit join key)
-- Source: Reboot Pack v1.2 Amendment §A.11; Helpan AI RECAP §6.13.
--
-- §A.11 makes "identical actor + initiated_by across rails for one business
-- operation, keyed off shared traceparent + business_op_id" a hard build-
-- acceptance criterion. `audit_log` and `actions` need a `business_op_id`
-- column so a forensic auditor can reconstruct one operation across Identiti
-- / KP / Todoku / Helpan AI.
--
-- The other §A.11 audit fields — agent_id, delegated_authority_jti,
-- target_rail, target_operation — already exist as columns (migration 0001 /
-- 0005); H-3.1 only extends `appendAuditEntry` to populate them. This
-- migration adds the one genuinely missing column.
--
-- Hash chain: `business_op_id` is NOT folded into entry_hash — consistent
-- with the existing partial-coverage design (actor_type, outcome,
-- account_uuid, etc. are likewise not hashed). A future full-column-hash
-- hardening (with a hash_version discriminator) is tracked separately in
-- RECAP §6.
-- =============================================================================

ALTER TABLE audit_log ADD COLUMN business_op_id TEXT;
ALTER TABLE actions   ADD COLUMN business_op_id TEXT;

-- Forensic reconstruction path: "all audit entries for one business op,
-- newest first".
CREATE INDEX audit_log_business_op_created_idx
  ON audit_log (business_op_id, created_at DESC)
  WHERE business_op_id IS NOT NULL;
