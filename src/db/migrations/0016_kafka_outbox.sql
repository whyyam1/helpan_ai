-- =============================================================================
-- Migration 0016 — Kafka outbox (H-17). Closes RECAP §6.7.
--
-- Before H-17, producers (briefings/authorities/actions/cascade) called
-- `kafka.publish()` AFTER the business tx committed. A crash between
-- commit and publish lost the event — the audit chain stayed intact but
-- external subscribers never saw it.
--
-- H-17 makes producers INSERT into this table inside the same tx that
-- writes the business state. A drainer worker (src/workers/kafkaOutbox/)
-- selects `pending` rows with FOR UPDATE SKIP LOCKED (multi-replica safe),
-- publishes to Kafka, and marks `delivered` (or `abandoned` after
-- exhausting retries).
--
-- Partial index pattern matches `actions_pending_idx` from 0005 — the
-- worker's hot scan stays O(pending rows), not O(table size), even as
-- delivered rows accumulate before GC.
-- =============================================================================

CREATE TABLE kafka_outbox (
  id              TEXT PRIMARY KEY,
  topic           TEXT NOT NULL,
  -- Partition key — for account-scoped events this is the account_uuid; the
  -- rail's other producers all key by account_uuid for cross-rail co-ordering.
  partition_key   TEXT NOT NULL,
  -- JSON-serialisable event body. The drainer passes this through verbatim
  -- to kafka.publish({ value }); the rail does no transformation in the
  -- drainer.
  payload         JSONB NOT NULL,
  -- Optional Kafka headers (string→string). NULL when the producer doesn't
  -- need to attach any.
  headers         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  -- The drainer ignores rows with next_attempt_at in the future; backoff
  -- after a failure increases this monotonically.
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  -- Last failure message for forensics; cleared (NULL) on success. Bounded
  -- by `text` — operators should grep for repeated `last_error` patterns to
  -- detect broker outages or schema rejections.
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kafka_outbox_status_chk
    CHECK (status IN ('pending', 'delivered', 'abandoned'))
);

-- Hot path: the drainer's per-tick SELECT FOR UPDATE SKIP LOCKED. Partial
-- on status='pending' — keeps the index small even as delivered rows pile
-- up between GC runs.
CREATE INDEX kafka_outbox_pending_idx
  ON kafka_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';

-- Cold path: forensic queries — "show me every BRIEFING_MATCHED for this
-- account" or "all abandoned action.fail publishes in the last 24h."
CREATE INDEX kafka_outbox_topic_status_created_idx
  ON kafka_outbox (topic, status, created_at DESC);
