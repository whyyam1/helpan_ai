# Helpan AI Rail

Agent rail for the KMV platform. Fourth platform rail alongside Identiti, Kipkiren Pay, and Todoku. Provides:

- Orchestration runtime for AI agents acting on behalf of users
- Briefing storage and matching engine
- Delegated authority issuance / validation / revocation (most security-critical primitive)
- Helpan Console consent surface (one-tap revocation)
- Audit log with hash chain (7-year retention)
- OAuth scope catalogue for third-party agents

**Cardinal rule:** Helpan AI orchestrates; never duplicates rail functionality. No funds, no credit, no identity, no comms delivery.

---

## Status

H-1 (Foundation) in flight. Sprint goal: deployable Fastify service exposing `/v1/health` + `/v1/health/deep`, full migration sequence applied, shared auth + idempotency plugins wired. See `RECAP.md` §2.

## Stack

Node.js 22 LTS · TypeScript 5.x strict · Fastify 4.x · AJV (JSON Schema 2020-12) · PostgreSQL 16 (Supabase af-south-1 in non-dev) via `postgres` (postgres-js, `prepare: false` for PgBouncer transaction-pooling — matches Todoku TD-0) · Drizzle ORM + drizzle-kit · Kafka via kafkajs (pinned, not yet used) · Vitest · Railway. LLM provider open per Confirmation Memo §5.8.

## Quickstart

```bash
# 0. Build @kmv/platform-shared first — Helpan AI consumes its `dist/`.
#    H-1 added 'Helpan' to its RailPrefix union and the Authorization regex,
#    so the dist must be rebuilt at least once before npm install here.
cd ../platform-shared && npm install && npm run build && cd ../helpan-ai-rail

# 1. Install (resolves the path dep on @kmv/platform-shared)
npm install

# 2. Provision a local Postgres
#    docker run -d --name helpan-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

# 3. Copy env
cp .env.example .env

# 4. Apply the 6 migrations (§5 of helpan-ai-schema-erd-v1.md)
npm run db:migrate

# 5. Boot the service
npm run dev
# → GET http://localhost:3040/v1/health
```

> **Cross-rail change shipped in H-1:** `@kmv/platform-shared/src/hmac.ts` adds `'Helpan'` to the `RailPrefix` union and to the `AUTH_HEADER_RE` regex. Authorization headers from this rail use the literal prefix `Helpan-HMAC-SHA256`. Identiti / Kipkiren Pay / Todoku continue to work unchanged.

## Repository layout

```
src/
  server.ts              # process entrypoint
  app.ts                 # Fastify factory — exported for tests
  config/env.ts          # validated env loader
  plugins/               # rail-local Fastify plugins (db, stores, request-id, error mapping)
  modules/health/        # H-1 only ships health
  db/
    client.ts            # pg + Drizzle init
    schema/              # Drizzle schema for all 15 tables
    migrations/          # six SQL files — see helpan-ai-schema-erd-v1.md §5
  lib/                   # rail-local utilities (e.g. secretsEnvelope)
test/integration/        # Fastify .inject() tests
scripts/migrate.ts       # drizzle-orm migrate runner
```

## Migration sequence (per Schema and ERD §5)

1. `0001_universal_tables.sql` — `app_credentials`, `idempotency_keys`, `audit_log`, `kafka_offsets`, `webhook_deliveries`
2. `0002_oauth_scopes.sql` — `oauth_scopes` + canonical scope seed
3. `0003_agents_safety.sql` — `agents`, `safety_policies`
4. `0004_briefings_events.sql` — `briefings`, `events_ingested`, `briefing_matches`
5. `0005_authorities_actions.sql` — `delegated_authorities`, `authority_usage`, `actions`
6. `0006_rls_policies.sql` — RLS enabled per §3 of the ERD doc

Migrations are hand-authored SQL (so RLS, partial indexes, CHECK constraints, and seed data are explicit) and registered with Drizzle via `src/db/migrations/meta/_journal.json`. Run `npm run db:check` to detect drift between the Drizzle schema files and the SQL files.

## Cross-rail context

Read these before making architectural changes:

- `helpan-ai-reboot-pack-v1.md` — canonical record
- `helpan-ai-rail-instruction-v32.md` — Design Instruction Pack (§3 Design Law is non-negotiable)
- `helpan-ai-openapi-v1.yaml` — wire-level spec
- `helpan-ai-delegated-authority-contract-v1.md` — most security-critical (strawman; H4 pending)
- `helpan-ai-schema-erd-v1.md` — DB design
- `RECAP.md` (this folder) — sprint tracker
- `../Platform Rails-instruction pack v1-reboot pack v1.2/RECAP.md` — cross-rail tracker

## Confidential

© Kirimon Market Ventures. All material in this repository is confidential and proprietary.
