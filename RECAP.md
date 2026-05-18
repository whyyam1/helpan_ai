# Helpan AI Rail — Build Progress and Sprint Tracker

**Document type:** Rail-specific progress tracker. Update at each sprint close.
**Date:** 7 May 2026 · **Last update:** 18 May 2026 (H-3 closure)
**Cross-rail source of truth:** `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\Platform_Rails_Reboot_Pack_v1_2.md` (v1.2 + Amendment §A, 7 May 2026). For Helpan-AI-facing wiring, read §16.8 (cross-rail wiring — JWT TTL table, Kafka topology, `actor`/`initiated_by` propagation) and Amendment §A (especially §A.2, §A.5, §A.9, §A.11) before starting any sprint. Programme `RECAP.md` in the same folder remains the dependency-graph / critical-path view.
**Rail design corpus:** every `helpan-ai-*.md` and `helpan-ai-openapi-v1.yaml` in this folder. Reading order in `helpan-ai-reading-orders-v1.md`.

---

## 1. Where this rail is

**Design phase:** ✅ complete (all 16 Output Plan items + scan integration).

**Code:** 🟢 H-1 + H-2 + H-3 + H-5 + H-6 + H-7 closed (H-3 closed 18 May 2026).
- **Live surfaces (21 endpoints):** health ×2 · briefings ×5 · `POST /v1/events/ingest` · oauth-scopes ×2 · operator-agents ×3 · operator-safety-policies ×2 · `GET /v1/operator/audit` · **authorities ×5** — `POST /v1/authorities` (issue) · `GET /v1/authorities` (list) · `GET /v1/authorities/:id` · `POST /v1/authorities/:id/validate` (relying-party per-call check) · `POST /v1/authorities/:id/revoke`.
- **Workers:** `webhook-worker` separate Railway entrypoint (`src/workers/webhookDelivery/`). Drains `webhook_deliveries` with `FOR UPDATE SKIP LOCKED`; HMAC-SHA256 signing on outbound POST; retry 30s → 24h × 8 attempts → abandoned.
- **Auth:** HMAC (rail-wide default) + Identiti customer-JWT on `/v1/briefings/*` only. Admin surfaces require `helpan:admin`; authority endpoints require per-endpoint scopes (`helpan:authorities:issue` / `helpan:authority:validate` / `helpan:authorities:revoke`) — all enforced by rail-local `requireScope(request, scope)`. `/v1/authorities/*` is all-HMAC in v1.0 (H-3 decision 1a; customer-JWT Console list/revoke deferred to H-8).
- **DB:** migrations 0001–0008 apply cleanly (H-3 added none — `delegated_authorities` + `authority_usage` exist from 0005; see §6.13). RLS enforced on `briefings` (FORCE) and `audit_log` (operator-only SELECT). Audit hash chain (writer from H-2) now also appended by `authority.issue` + `authority.revoke`.
- **Delegated authorities (H-3):** Helpan AI authors the §2.3 claim set; Identiti signs it via `POST /v1/internal/sign` (H4 joint contract — Helpan AI never holds the DA key). `src/lib/identitiSigner.ts` is the HMAC-signed client; `src/lib/stepUpVerifier.ts` checks the issuance-time step-up token (`aud=helpan_authority_issuance`). Validation verifies the token RS256 signature against Identiti's JWKS + the DB row's status/limits — pure query, HTTP 200 even on `valid=false`. Revocation is immediate + idempotent. `helpan.authority.events` publishes `AUTHORITY_ISSUED` / `AUTHORITY_REVOKED`.
- **Kafka:** producer surface in `src/lib/kafka/{topics,producer}.ts` — `kafkajs` in production, in-memory stub in tests. Topics published: `helpan.briefing.events` (`BRIEFING_MATCHED`), `helpan.authority.events` (`AUTHORITY_ISSUED` / `AUTHORITY_REVOKED`). Producer optional — missing brokers → publish skipped, the DB + webhook paths still work.
- **Tests:** **153/153 green** — 76 always-on + 77 real-Postgres against `helpan_ai_test` on `localhost:5432`. Typecheck clean, lint clean.
- **Next:** H-4 (action dispatch) is hard-blocked on **KP KP-8 + Todoku TD-1** (relying parties must accept `X-Delegated-Authority`) and functionally on H-3 (done). H-8 (Helpan Console RN library) is now unblocked — H-3 closed. Cascade-revocation Kafka *consumer* deferred to a fast-follow (H-3 decision 2a) — see §6.14.

**Stack:** Node.js 22 LTS · TypeScript 5.x strict · Fastify 4.x · AJV 2020-12 · PostgreSQL 16 (Supabase af-south-1 in non-dev) accessed via **`postgres` (postgres-js, `prepare:false`)** — rail-wide Drizzle driver standard, matches Todoku TD-0 · Drizzle ORM + drizzle-kit · `jose` 5.x for RS256 customer-JWT verify · `kafkajs` 2.x with `LegacyPartitioner` + `idempotent: true` + `acks: -1` · ESLint 9 flat config · Vitest · Railway. **LLM provider open** per Confirmation Memo §5.8.

**Dependencies:** `@kmv/platform-shared` from `C:\Projects\platform-shared\` via `file:..` path dep — pnpm workspace migration is open question (b) under §6.3.

**Standing position:** Helpan AI is the **agent-runtime rail** — per Reboot Pack v1.2 Amendment §A.5, **not** a fourth rail in the §3 three-rails-at-a-glance table (Pay / Identity / Comms remain the canonical regulated rails). Helpan AI orchestrates them on behalf of agents and owns the scope catalogue, agent registry, action dispatch, agent audit log, and delegated-authority registry. The split is canonical: Identiti is the OAuth issuance authority for agents (regulator-facing); Helpan AI is the per-call validation authority that KP and Todoku consult when `actor.type='agent'`. Supersedes scan item ID-2. Build sequencing unchanged: H-1 + H-2 ran in parallel with the other rails' early sprints; H-3 onward is gated by cross-rail unblocks.

**Cardinal rule:** Helpan AI does NOT duplicate platform rail functionality. No funds, no credit, no yield, no float, no off-ledger netting. No identity / KYC / credentials. No direct comms delivery.

---

## 2. Sprint plan

Conventions: 2-week sprints. Status: [ ] open · [~] in flight · [x] done.

| Sprint | Goal | Maps to | Cross-rail deps | Status | Notes |
|---|---|---|---|---|---|
| **H-1** | Foundation — Fastify scaffold, auth + idempotency middleware, `GET /v1/health` + `/v1/health/deep`, DB migrations 0001–0006 per Schema and ERD §5 | OpenAPI §health, §components | None (uses `@kmv/platform-shared` only) | [x] | Closed 8 May 2026. Typecheck clean, lint clean (ESLint 9 flat config), 16 tests pass (env validator 7 + secrets envelope 3 + health integration 6). Cross-rail patch: `@kmv/platform-shared/src/hmac.ts` accepts `'Helpan'` as a `RailPrefix` — rebuilt + 37/37 platform-shared tests pass. Driver: `postgres-js` with `prepare:false` to match Todoku TD-0. **Follow-ups (do not block close):** real-Postgres smoke (env-dependent, no Docker on Windows), three scope decisions to Chamia tracked in §6. |
| **H-2** | Briefings CRUD — `POST/GET/PATCH/DELETE /v1/briefings`, RLS policies | OpenAPI Briefings tag | Identiti ID-3 (customer JWT validation) | [x] | Closed 9 May 2026. Five briefings routes wired; customer-JWT verifier rail-local (decision 1a — promote to platform-shared once KP-2/TD-2 also need it); migration 0007 adds INSERT/UPDATE/DELETE policies + `FORCE ROW LEVEL SECURITY` (closes 0006's SELECT-only gap on `briefings` — H-3 should replicate for `delegated_authorities`, H-4 for `actions`); audit-log hash-chain writer (`src/lib/auditWriter.ts`) seeded for H-4 reuse; deep-health gains `briefings` component. Auth narrowed to BearerCustomer per decision 2a — HMAC + service-JWT on `/v1/briefings/*` deferred. New dep: `jose` ^5.9.6. 53/53 tests green. Detail in §5; open follow-ups in §6. |
| **H-3** | **Delegated authorities issuance + validation + revocation** — `POST /v1/authorities`, `POST /v1/authorities/{id}/validate` (per-call XR-1 contract — relying rails MUST validate per Reboot Pack v1.2 Amendment §A.2 when `actor.type='agent'`), `/revoke`, Kafka `helpan.authority.events` (topology MUST not preclude future CAEP per-token revocation events per Reboot Pack §A.9). JIT semantics mandatory per §A.1 (short-TTL, audience-bound, single-operation). | OpenAPI Authorities tag; Delegated Authority Contract §3, §4, §5, §8; Reboot Pack v1.2 §16.8 + §A.2 | H4 joint with Identiti ID-10 — **ID-10 closed**, `POST /v1/internal/sign` live. | [x] | Closed 18 May 2026. 5 authority endpoints (issue/list/get/validate/revoke), all HMAC + per-endpoint scope (decision 1a). Issuance: validate inputs → step-up verify (high-stakes) → build §2.3 claims → Identiti `POST /v1/internal/sign` → persist + audit + publish `AUTHORITY_ISSUED`. Validation: RS256 signature verify vs Identiti JWKS + DB status/scope/limit checks, pure query (HTTP 200 even on `valid=false`). Revocation: immediate, idempotent, publishes `AUTHORITY_REVOKED`. Cascade-revocation Kafka *consumer* deferred to fast-follow (decision 2a, §6.14). Idempotency plugin gained `exemptSuffixes` (cross-rail platform-shared change, decision 3a) so `POST /validate` is key-exempt. No new migration (§6.13). 42 new tests; 153/153 green. Detail in §5; open follow-ups in §6. |
| **H-4** | Action dispatch — `POST /v1/actions/dispatch`, target-rail routing, audit log writes with hash chain. **Cross-rail audit invariant** (Reboot Pack v1.2 §A.11): every dispatched action MUST carry shared `traceparent` + `business_op_id`, with `actor` + `initiated_by` matching the values KP/Todoku will persist on their side. Hard build-acceptance criterion. | OpenAPI Actions tag; Reboot Pack v1.2 §A.2, §A.11 | KP KP-8 + Todoku TD-1 (relying parties accept `X-Delegated-Authority`) | [ ] | |
| **H-5** | Matching engine — `POST /v1/events/ingest`, briefing-to-event matching, `BRIEFING_MATCHED` Kafka event + webhook fan-out | OpenAPI Events tag | None | [x] | Closed 11 May 2026. HMAC-authed `/v1/events/ingest`; synchronous matching engine ships the **generic key-equality matcher** per decision 2b (type-aware matchers deferred to per-app sprints H-9..H-12); Kafka producer surface (`kafkajs` prod / in-memory test); webhook delivery worker as separate Railway entrypoint (`npm run worker:webhooks`) — HMAC-signed POST, `FOR UPDATE SKIP LOCKED` claim, retry 30s/1m/5m/15m/1h/4h/12h → abandoned. Migration 0008 added `webhook_deliveries.target_url`. Audit-log writer (from H-2) appends one `event.ingested` entry per ingest with `matched_briefings[]` detail. New dep: `kafkajs` ^2.2.4 (was pinned but unused). 79/79 tests green. Detail in §5; open follow-ups in §6. |
| **H-6** | OAuth scope catalogue + agent registry endpoints, per-app safety policies | OpenAPI OAuth + Operator tags | None | [x] | Closed 11 May 2026. Three sub-surfaces wired: OAuth scopes (public GET + admin POST), Operator agents (POST register / GET / PATCH status), Operator safety policies (GET list / PUT upsert). Rail-local `requireAdminScope` helper checks `helpan:admin` on the HMAC tenant — promotion to platform-shared once KP/Todoku need scoped admin endpoints. Safety policy PUT is RFC-compliant upsert with explicit 409s on `app_id` frozen and duplicate-policy-per-app. All write paths audit-logged. v1.0 narrowing: GET /v1/oauth/scopes is HMAC-authed (OpenAPI says public) — see §6.10. `vitest.config.ts` gains `fileParallelism: false` to fix real-DB test races. 104/104 tests green. Detail in §5; open follow-ups in §6. |
| **H-7** | Operator console — agent registration, safety policy admin, audit log query | OpenAPI Operator tag | None | [x] | Closed 11 May 2026. Narrowed to `GET /v1/operator/audit` since agent + safety endpoints shipped at H-6. Filters: account_uuid · agent_id · action · from · to. Paginated by base64url cursor (`<created_at>|<id>`), same shape as briefings. Query runs in a tx that sets `app.role='operator'` so migration 0006's operator-only RLS policy on `audit_log` is satisfied. Hash-chain fields (`previous_hash`, `entry_hash`) included in the response for tamper-evident reads. 111/111 tests green (7 new integration tests). |
| **H-8** | **`@kmv/helpan-console` React Native shared library** — Console specification §3 IA, §4 behaviour, §6 cross-rail. Separate codebase but parallel sprint | Helpan Console Specification | H-3 (authorities API live) | [ ] | |
| **H-9** | Per-app: **Helpan Klokd** (priority 1) — pay-on-completion via dispatch, reputation surfacing | Per-App Integration Patterns §1 | KP KP-8/9 + Todoku TD-9 | [ ] | |
| **H-10** | Per-app: **Helpan Lunch Drop** (priority 2) — ZoneFeed augmentation, weekly plans, reliability nudges | Per-App Integration Patterns §2 | KP KP-8 + Todoku TD-9 | [ ] | |
| **H-11** | Per-app: **Helpan Chapaa** (priority 3, highest stakes) — goal nudges, round-up, MMF suggest-only, credit unlock surface | Per-App Integration Patterns §3 | KP KP-8/13 (S.1 partner-lender) | [ ] | |
| **H-12** | Per-app: **Helpan [App Name]** (family-discovery, priority 4) — discovery briefings, standing-basket | Per-App Integration Patterns §4 | KP KP-8/9/10 (all three) + Todoku TD-9 | [ ] | |
| **H-13** | UX validation 10+ users (DoD §13.2 S11), Console hardening | DoD S11 | H-8 (Console live) | [ ] | |
| **H-14** | Cross-rail end-to-end testing | Handoff §14 | All rails Sprint 5+ | [ ] | |
| **H-Beta** | Stage 2 closed beta — 50+ users per app cohort | DoD §7.3 | H-13 + per-app sprints | [ ] | |
| **H-GA** | Stage 3 GA — family-discovery + Chapaa live; Lunch Drop / Klokd live or formally deferred | DoD §7.4 + §10 | H14 closed; pen-test C+H | [ ] | |

**Stage 1 sandbox target:** end of H-7 (~8 weeks; depends on Identiti ID-10 and KP KP-8 unlocking by then).
**v1.0 launch criterion:** family-discovery + Helpan Chapaa live and passing DoD Stage 3.

---

## 3. What changes between sprints

After each sprint:

1. Update row: `[ ]` → `[x]`. Notes for scope shifts.
2. Cross-update central tracker: `RECAP.md` §4.4.
3. Cross-update Helpan AI Build Readiness Checklist (`helpan-ai-build-readiness-checklist-v1.md`) — flip the corresponding row.
4. If H-3 lands → notify KP and Todoku to begin/continue their delegated-authority validator integrations.

After **Stage advances**:

1. Update central tracker §1.
2. Re-issue Helpan AI Reboot Pack at the next minor version with updated state.
3. Sign-off per DoD §14.

---

## 4. Source-of-truth pointers

1. `helpan-ai-reboot-pack-v1.md` — canonical record for this rail
2. `helpan-ai-design-reference-v1.md` + Amendment §A — the "why"
3. `helpan-ai-openapi-v1.yaml` — wire-level spec
4. `helpan-ai-delegated-authority-contract-v1.md` — most security-critical
5. `helpan-ai-schema-erd-v1.md` — DB design
6. `helpan-ai-event-bus-contract-v1.md` — Kafka topology
7. `helpan-ai-threat-model-v1.md` — threats and mitigations
8. `helpan-ai-oauth-scope-catalogue-v1.md` — scopes
9. `helpan-ai-per-app-integration-patterns-v1.md` — Klokd, Lunch Drop, Chapaa, family-discovery
10. `helpan-ai-console-specification-v1.md` — Console UX
11. `helpan-ai-build-readiness-checklist-v1.md` — execution roadmap
12. `helpan-ai-reading-orders-v1.md` — who reads what
13. `helpan-ai-scan-integration-memo-v1.md` — what changed because of the scan
14. Cross-rail: `Platform_Rails_Reboot_Pack_v1_2.md` (v1.2 + Amendment §A, 7 May 2026 — §16.8 cross-rail wiring + §A.2 actor/initiated_by propagation + §A.5 Helpan-AI-as-agent-runtime-rail + §A.9 roadmap + §A.11 audit invariant), all three Rail Contracts + Amendments §A, App Integration Guide + Amendment §A, Claude Code Instruction Pack + Amendment §A

---

## 5. Sprint artefacts inventory (update as you go)

| Sprint | Artefacts produced |
|---|---|
| H-1 | Fastify scaffold + tsconfig (strict) + drizzle-kit + ESLint 9 flat config + vitest config; 14 Drizzle ORM schema files (`src/db/schema/*`); 6 hand-authored SQL migrations matching ERD §5 (`0001_universal_tables` … `0006_rls_policies`) + `meta/_journal.json` + migrations README; rail-local Fastify plugins (`db`, `credentialStore`, `idempotencyStore`, `requestId`, `errorMapper`); shared HMAC auth + idempotency plugins wired with `/v1/health` exempt; `health` module (`/v1/health` + `/v1/health/deep`); env validator (`src/config/env.ts`) + unit tests; placeholder noop `secretsEnvelope` lib + unit tests; migration runner (`scripts/migrate.ts`); integration test (`test/integration/health.integration.test.ts`); cross-rail patch to `@kmv/platform-shared/src/hmac.ts` adding `'Helpan'` to `RailPrefix` and `AUTH_HEADER_RE`. |
| H-2 | New rail-local Fastify plugins: `customerJwtPlugin` (RS256 verify via `jose`, `aud`/`iss`/`exp` checks, decorates `request.customerJwt`+`request.appId` from `X-App-Id`), `rlsContextPlugin` (`withCustomerContext` runner — opens Drizzle transaction + `set_config(app.account_uuid, …, true)` + `app.role='user'`); new `src/lib/auditWriter.ts` with `appendAuditEntry(tx, …)` + pure `computeEntryHash(...)` + `pg_advisory_xact_lock` serialisation; new `src/modules/briefings/` (schemas, repo, service, routes for `POST/GET/LIST/PATCH/DELETE /v1/briefings`); migration `0007_briefings_rls_writes.sql` (INSERT/UPDATE/DELETE policies + `FORCE ROW LEVEL SECURITY`); env config extended (`IDENTITI_JWKS_URL`, `IDENTITI_JWT_ISSUER`, `HELPAN_JWT_AUDIENCE`); deep-health gains `briefings` component; test helpers `testJwks.ts` + `testDb.ts` (real-Postgres harness skips when `TEST_DATABASE_URL` unset); seven test files totalling 41 stub-DB + 12 real-DB checks. New dep: `jose@^5.9.6`. |
| H-5 | New `src/lib/kafka/{topics,producer}.ts` — topic catalogue + `KafkaProducerLike` interface with `kafkajs` and in-memory implementations; new `src/plugins/kafkaPlugin.ts` (optional registration); new `src/lib/matching/{engine,engine.test}.ts` — pure generic key-equality matcher with 10 unit tests; new `src/modules/events/` (schemas, repo, service, routes for `POST /v1/events/ingest` — synchronous match → enqueue webhook → publish-after-commit); new worker package `src/workers/webhookDelivery/` (pure `processBatch` + Railway entrypoint with SIGTERM-aware drain, HMAC-signed POST, retry schedule, `FOR UPDATE SKIP LOCKED`); migration `0008_webhook_target_url.sql`; deep-health gains `events_ingest` + `kafka` components; env extended (`KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `WEBHOOK_HMAC_SECRET`, `WEBHOOK_DELIVERY_POLL_MS/BATCH_SIZE`, `HELPAN_WEBHOOK_URL_<APP>`); test helpers gain `hmacHeaders()` + `makeWebhookTargetResolver()` + Kafka producer injection + advisory-locked migrate to fix Vitest worker race; two new integration test files (`events.ingest` + `webhookWorker`) totalling 11 real-DB + 12 stub/unit checks. New dep: `kafkajs@^2.2.4` (previously pinned but unused). |
| H-6 | New rail-local `src/lib/scopeCheck.ts` — `requireAdminScope(request)` + `AdminScopeRequiredError` (403 `AUTH_SCOPE_REQUIRED`); three new modules: `src/modules/oauthScopes/` (schemas, repo, service, routes — public GET list + admin POST create), `src/modules/operatorAgents/` (POST register with class-invariant checks for `portfolio_app` / `third_party_oauth`, GET detail, PATCH status with `suspended_at` / `retired_at` stamps), `src/modules/operatorSafetyPolicies/` (GET list, PUT upsert with `app_id` frozen + UNIQUE(app_id) enforcement). All admin writes audit-logged. Test helper `hmacHeaders(...)` extended with `appId` / `hmacSecret` overrides; `makeTestCredentialStore` now serves two tenants (admin + non-admin) for scope-rejection tests; `resetTestData` extended for `agents` / `safety_policies` / `oauth_scopes WHERE id LIKE 'test.%'`; `vitest.config.ts` gains `fileParallelism: false`. Three new integration test files (oauthScopes 7 + operatorAgents 7 + operatorSafetyPolicies 7 = 21 real-DB checks) + scopeCheck unit (4). 25 new tests; total 104/104. No new deps. |
| H-7 | New `src/modules/operatorAudit/` (schemas, repo, service, routes) for `GET /v1/operator/audit`. Read-only; admin-scope gated. Filters by account_uuid · agent_id · action · from · to. Pagination via base64url cursor (same `<iso_created_at>\|<id>` shape as briefings). Repo opens a tx and `set_config('app.role', 'operator', true)` so migration 0006's operator-only SELECT policy on `audit_log` admits the query. New integration test file (`operatorAudit.integration.test.ts`) with 7 real-DB checks covering happy path · filter-by-action · filter-by-account · cursor pagination · cursor-invalid → 400 · non-admin rejection · `limit=0` → 400. 7 new tests; total 111/111. No new deps. |
| H-3 | New `src/lib/identitiSigner.ts` (`DelegatedAuthoritySigner` interface + `createHttpIdentitiSigner` — HMAC-signed client for Identiti `POST /v1/internal/sign`), `src/lib/stepUpVerifier.ts` (RS256 + `aud=helpan_authority_issuance` check on the issuance-time step-up token); new `src/modules/authorities/` — `scopeClassifier.ts` (pure: TTL ceiling + high-stakes derive over an `oauth_scopes` row), `claimBuilder.ts` (pure §2.3 claim assembly, `daa_<ULID>` jti, rail-audience map), `schemas.ts` / `repo.ts` / `service.ts` (issuance + validation + revocation + list) / `routes.ts` (5 endpoints). `topics.ts` gains `AUTHORITY_ISSUED/REVOKED/EXPIRED`; `scopeCheck.ts` generalised to `requireScope(request, scope)`; deep-health gains `authorities` component; env extended (`IDENTITI_INTERNAL_SIGN_URL`, `IDENTITI_INTERNAL_HMAC_SECRET`, `HELPAN_INTERNAL_APP_ID`, `IDENTITI_TIMESTAMP_HEADER`, `JWT_DA_KID`). **Cross-rail:** `@kmv/platform-shared` idempotency plugin gained `exemptSuffixes` (rebuilt dist + 37/37 platform-shared tests still green). Test helpers: `testAuthorities.ts` (in-process signer with `forceError`), `testJwks.ts` gains `signStepUpToken`, `buildApp` gains `identitiKeyResolver` + `authoritySigner` overrides. Five new test files (scopeClassifier 10 + claimBuilder 6 unit; issuance 12 + validation 9 + revocation 5 real-DB). 42 new tests; total 153/153. No new deps (jose/kafkajs already present). No new migration. |

---

## 6. Open follow-ups (do not block H-4 / H-8 start)

### 6.1 Customer-JWT verifier — promote to platform-shared once a second caller appears
Shipped at H-2 in `src/plugins/customerJwtPlugin.ts` (decision 1a). Interface is generic by design — `keyResolver | KeyLike`, `issuer`, `audience`; decorates `request.customerJwt` + `request.appId` (from `X-App-Id`); error codes `AUTH_JWT_MISSING / _INVALID / _EXPIRED / _AUDIENCE`. Lift to `@kmv/platform-shared/fastify-customer-jwt` once KP-2 and TD-2 also need it; expected lift effort ~half-day.

### 6.2 Auth surface narrowed at H-2 — Amendment §A entry needed
Decision 2a: only `BearerCustomer` is accepted on `/v1/briefings/*` in v1.0. OpenAPI root lists three security alternatives; the rail enforces only one. **Action:** propose Amendment §A entry on the OpenAPI / Design Reference noting the v1.0 narrowing the next time a third-party agent flow asks for HMAC or service-JWT on briefings.

### 6.3 H-1 scope decisions surfaced to Chamia — still open
| Q | Topic | Default if no reply | Code impact |
|---|---|---|---|
| (a) | Deep-health `reason` field — embed in `components.<name>` object vs. sibling `components_detail` | a-i (amend OpenAPI to `{status, reason?}` object) | Small: schemas.ts + service.ts + OpenAPI yaml |
| (b) | pnpm workspaces + Turborepo migration (locked by Reboot Pack §131 + Instruction Pack §79; `kmv/platform-rails` monorepo per Reboot Pack §16.7) | b-iii (defer to KP-1 cross-rail sprint) | None at H-2 if deferred; large structural move if pulled forward |
| (c) | Ciphertext-from-day-one envelope (AES-256-GCM via new `@kmv/platform-shared/secrets` module — name avoids collision with response-envelope) | New module name `secrets`; blob format `secret:aes-gcm:v1:<key_id>:<iv_b64>:<ct_b64>:<tag_b64>` | Half-day on platform-shared + ~1h here to swap noop → real |

### 6.4 RLS write-policy + FORCE pattern — `delegated_authorities` reassessed at H-3
Migration 0006 shipped SELECT-only RLS for `briefings`, `delegated_authorities`, `actions`. H-2 closed the gap for `briefings` in 0007. **H-3 deliberately shipped no `delegated_authorities` migration** — on closer read the §6.4 user-scoped write-policy pattern does **not** apply: `delegated_authorities` is written by the issuance/revocation flow under HMAC/system context (a consuming-app server), with no `app.account_uuid` GUC set. The 0006 `authorities_user_read` SELECT policy stays dormant until H-8 wires customer-JWT Console reads; H-3's writes run as the (non-FORCEd) table owner. **When a non-superuser service role is introduced** (post-Stage-1 sandbox), `delegated_authorities` will need INSERT/UPDATE policies keyed on a system/app context — not the account-UUID pattern. Track as a deployment-hardening item. `actions` (H-4) is the same shape — system-mutated, not user-mutated; the §6.4 account-UUID pattern is for `briefings` only.
The fixed account-scoped pattern (still correct for any future user-mutated table):
```sql
CREATE POLICY <name>_user_insert ON <table> FOR INSERT
  WITH CHECK (account_uuid = current_setting('app.account_uuid', true));
CREATE POLICY <name>_user_update ON <table> FOR UPDATE
  USING      (account_uuid = current_setting('app.account_uuid', true))
  WITH CHECK (account_uuid = current_setting('app.account_uuid', true));
CREATE POLICY <name>_user_delete ON <table> FOR DELETE
  USING      (account_uuid = current_setting('app.account_uuid', true));
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
```
Without `FORCE`, a connection running as the table owner silently bypasses every policy.

### 6.5 Audit hash-chain writer — direct reuse at H-4
`src/lib/auditWriter.ts` exposes pure `computeEntryHash(...)` (unit-tested, key-order-stable canonical JSON) and `appendAuditEntry(tx, ...)`. Concurrency is serialised by `pg_advisory_xact_lock(7268010825743210)` inside the transaction — constant across all callers. H-4 should call `appendAuditEntry` for action-dispatch entries with `actorType: 'agent'` and the `delegated_authority_jti` populated; no changes to the writer expected.

### 6.6 Type-aware matchers per `briefing_type` — deferred to per-app sprints
H-5 plan decision 2b: ship the generic key-equality matcher only. Per-app intent shapes (`alert` / `standing_basket` / `scheduled_action` / `threshold_watch`) get type-specific matchers as H-9..H-12 wire each app. The matcher engine in `src/lib/matching/engine.ts` is a single pure function so adding a strategy table per `briefing_type` is a localised change — no plumbing rework.

### 6.7 Kafka publish is fire-and-forget after DB commit at H-5 — outbox pattern deferred
`ingestEvent` collects messages during the DB transaction and publishes after commit. A crash between commit and publish leaves a match in the DB without subscribers seeing the Kafka event; `webhook_deliveries` is the durable fan-out so this is recoverable for app consumers but not for cross-rail subscribers. v1.1 adds an outbox table + drainer process — defer until H-3 puts another rail's subscribers on `helpan.authority.events`.

### 6.8 Webhook URL discovery is env-driven at H-5 — registry table at v1.1
`HELPAN_WEBHOOK_URL_<APP_ID_UPPER>` per app. Works for the four v1 consuming apps. Replace with `app_webhook_targets` table when (a) the consuming-app onboarding flow exists (H-7 operator console adjacent) or (b) any app needs multiple webhook endpoints / per-event-type routing.

### 6.10 Admin-scope enforcement is rail-local at H-6 — promote to platform-shared on second caller
`src/lib/scopeCheck.ts` provides `requireAdminScope(request)` reading `request.tenantRecord.scopes`. Promote to `@kmv/platform-shared/scope-check` once KP/Todoku also need scoped admin endpoints. Interface is one function + one error class — verbatim lift.

### 6.11 OAuth scope catalogue listing is HMAC-authed at H-6 — Amendment §A candidate
OpenAPI says GET /v1/oauth/scopes is `security: []` (public). H-6 ships it HMAC-authed because the shared HMAC plugin's exemption list is path-based, not method-aware (POST on the same path requires HMAC). v1.1 options: (i) extend the shared plugin to support method-aware exemptions; (ii) keep HMAC-on-listing and document the v1.0 narrowing in Amendment §A. Decide when a third-party agent onboarding tool actually needs anonymous discovery.

### 6.12 Safety policy "create" path piggybacks on PUT — POST endpoint deferred to H-7+
OpenAPI doesn't define POST /v1/operator/safety-policies. H-6 uses RFC-compliant PUT-as-upsert (unknown policy_id → 201 create, known → 200 replace), but operators have to invent the ULID locally. Either (a) add a server-side `POST /v1/operator/safety-policies` that mints the id, or (b) leave PUT-only and surface the convention in operator-console UX. Likely lands with H-7's operator-console hardening.

### 6.13 Reboot Pack v1.2 + Amendment §A — platform commitments locked H-3 / H-4 must implement
Reconciled 13 May 2026. The Reboot Pack v1.2 (4 May 2026 consolidation) + Amendment §A (7 May 2026 cross-rail scan integration) lifts five cross-rail rules into the platform record that affect Helpan AI directly:

| Ref | Rule | Helpan-AI impact | Sprint |
|---|---|---|---|
| §A.5 | Helpan AI is the agent-runtime rail; supersedes scan ID-2. **Not** a fourth rail in the §3 regulated-rails table. Identiti = OAuth issuance authority; Helpan AI = per-call validation, scope catalogue, agent registry, delegated-authority registry, action dispatch, agent audit log. | Standing position updated in §1 above. No code impact — clarifies positioning for external comms / docs / Amendment §A on Helpan AI Design Reference. | — |
| §A.2 (XR-1) | When `actor.type='agent'`, relying rails (KP, Todoku) MUST call `POST /authorities/{id}/validate` **per call** before accepting the operation. `actor` and `initiated_by` are optional JWT claims propagated end-to-end. | H-3 ships `/validate` as the most-called endpoint of the rail. Contract is now platform-locked (not just Helpan-internal). | **H-3** |
| §A.11 | Cross-rail audit invariant: identical `actor` + `initiated_by` across Identiti / KP / Todoku audit log entries for a single business operation, keyed off shared `traceparent` + `business_op_id`. **Hard build-acceptance criterion** for any rail consuming step-up tokens. | H-4 dispatch and H-2 audit-log writer must persist `actor`, `initiated_by`, `traceparent`, `business_op_id`. H-2 schema already has the columns (verify); H-4 propagation is the new work. | **H-4** (+ verify H-2) |
| §A.1 | JIT identity posture is platform-wide: no long-lived bearer tokens, no static service accounts, no refresh on elevated scopes. TTL table at §16.8 (step-up 5 min single-use; phone token 15 min audience-bound). | Helpan-AI-issued delegated-authority JWTs must follow the same JIT semantics (short-TTL, audience-bound, single-operation where applicable). H-3 token-issuance design choice. | **H-3** |
| §A.9 | Kafka topology **MUST not preclude** per-token revocation events. CAEP real-time revocation is v1.1 roadmap. | `helpan.authority.events` topic schema must include an event-type that maps to per-token revocation (or be extensible to one) — even if H-3 only emits issuance / scope-change / explicit-revocation at v1.0. | **H-3** |

Action items into H-3 design:
1. `/validate` endpoint shape and error codes must match the contract relying rails will call per Reboot Pack §A.2 — coordinate the wire format with Identiti ID-10 (signing API) and the KP/Todoku validator callsites before locking.
2. `helpan.authority.events` topic catalogue must include `AUTHORITY_REVOKED` event-type at v1.0 with a schema extensible to CAEP-style push-revocation at v1.1.
3. Delegated-authority JWT TTL: align with the §16.8 table — step-up class (5 min single-use) for one-shot actions; phone-token class (15 min audience-bound) for short-burst flows. Long-lived agent credentials are out.

**Audit-invariant gap (verified 13 May 2026 against `src/db/schema/auditLog.ts`, `src/db/schema/actions.ts`, `src/lib/auditWriter.ts`) — must be closed before H-4 ships:**

| Field | `audit_log` column | `appendAuditEntry` writer | `actions` column | Status |
|---|---|---|---|---|
| `traceparent` | ✓ present | ✓ exposed + inserted | ✓ present | OK |
| `actor.type` → `actor_type` | ✓ present | ✓ exposed + inserted | ✓ present | OK |
| `actor.agent_id` → `agent_id` | ✓ present | ❌ writer does NOT accept it; column is NULL on every existing audit row | ✓ present | **Gap — writer extension** |
| `actor.delegated_authority_jti` → `delegated_authority_jti` | ✓ present | ❌ writer does NOT accept it; column is NULL on every existing audit row | ✓ present | **Gap — writer extension** |
| `initiated_by` | ✓ present | ✓ exposed + inserted | ✓ present | OK |
| `business_op_id` | ❌ **column does not exist** | ❌ not exposed | ❌ does not exist (only `app_correlation_id`, which is app-side not cross-rail) | **Gap — migration + writer + schema** |
| `target_rail` / `target_operation` | ✓ present | ❌ writer does NOT accept either | ✓ present | **Gap — writer extension** (needed by H-4 dispatch entries) |

Required work, ordered:
1. **Migration 0009** — add `business_op_id text` to `audit_log` and `actions` (nullable; index on `(business_op_id, created_at)` for cross-rail forensic reconstruction). Coordinate the exact column name with KP and Todoku before applying — Reboot Pack §A.11 says "shared `business_op_id`" so the three rails must use the same identifier name on the wire and in storage.
2. **`appendAuditEntry` extension** — add optional `agentId`, `delegatedAuthorityJti`, `targetRail`, `targetOperation`, `businessOpId` to `AppendAuditEntryInput`; include them in the INSERT. Backward-compatible (all optional). Hash-chain input unaffected (currently just `id|actor_id|action|resource_id|detail|previous_hash`) — decide whether the new fields should also be folded into `entry_hash` to keep them tamper-evident. Likely yes; that means a chain reset is not required but the hash composition changes from a given migration date forward — document the cutover.
3. **Backfill audit of existing call sites** — `event.ingested`, `oauth_scope.create`, `agent.register`, `agent.status_change`, `safety_policy.create`, `safety_policy.update`, `briefings.*`. Pass `agentId` / `delegatedAuthorityJti` where the operation is agent-initiated; otherwise leave NULL. Existing rows stay NULL by design.
4. **H-4 dispatch must populate all of the above on every audit entry + every `actions` row.** Per §A.11, mismatched values across Helpan/KP/Todoku for the same `business_op_id` is a build-acceptance failure.

This is closer to a half-sprint of incremental work than a verification step. Recommend folding it into H-3 (since H-3 already touches the audit-log writer for issuance/validation/revocation entries) rather than waiting for H-4.

**Status after H-3 (18 May 2026): NOT folded in.** The greenlit H-3 plan scoped this out (it predates a full weighting of §6.13). H-3's `authority.issue` / `authority.revoke` audit entries carry `agent_id` + `delegated_authority_jti` inside the `detail` JSONB but **not** in the indexed top-level columns — so the §A.11 cross-rail audit join on those columns will miss authority events until the writer is extended. The `appendAuditEntry` extension + migration 0009 (`business_op_id`) + the hash-composition decision remain open and are now the **top H-4-prep item** (H-4 is blocked on KP-8/TD-1 anyway, so there is runway). Treat as a standalone half-sprint (call it H-3.1) or the first slice of H-4.

### 6.14 Cascade-revocation Kafka consumer — deferred fast-follow (H-3 decision 2a)
H-3 shipped the synchronous `POST /revoke` + the `AUTHORITY_REVOKED` producer. It did **not** ship the Kafka *consumer* that auto-revokes authorities on `identiti.account.events` `ACCOUNT_SUSPENDED` + `TIER_CHANGED` (downgrade) per H4 joint contract §5. The rail still has only a producer. Build the consumer as a separate worker (`src/workers/cascadeRevocation/`, mirroring `webhookDelivery`) — it blocks nothing downstream (KP/Todoku validate per-call, so a suspended account's authorities are caught synchronously regardless). `ACCOUNT_DELETED` / `CONSENT_REVOKED` have no v1.0 Identiti source (H4 §5) — v1.1.

### 6.15 Authority `scope_covers` is exact-match in v1.0 — operation→scope resolver is v1.1
`POST /validate` computes `scope_covers` by exact equality of `intended_operation` against an authority `scope_id`. The Delegated Authority Contract §4.4 *example* shows different strings (`intended_operation: kipkiren_pay.payment.execute` vs `scope_id: kipkiren.write.payments`) but never specifies the mapping algorithm. v1.0 expects the relying party to pass the `scope_id` it intends to exercise as `intended_operation`. A richer operation→scope catalogue resolver is a v1.1 item — flag an Amendment §A entry on the Delegated Authority Contract / OpenAPI when KP/Todoku validator callsites are wired.

### 6.16 Expired-authority revoke — contract §7.3 is self-contradictory (Amendment §A candidate)
Delegated Authority Contract §7.3 table says `AUTHORITY_EXPIRED | 410` but the same row's prose says "still 200 (idempotency)". OpenAPI groups "already revoked or expired" into **409**. H-3 follows OpenAPI: expired revoke → 409 `AUTHORITY_EXPIRED`. **Action:** propose an Amendment §A entry reconciling §7.3 to 409.

### 6.17 `exemptSuffixes` added to `@kmv/platform-shared` idempotency plugin (H-3 decision 3a)
Done — `IdempotencyPluginConfig.exemptSuffixes` mirrors `exemptPaths` / `exemptPrefixes`, matched with `path.endsWith()`. Used by H-3 to exempt `POST /v1/authorities/{id}/validate` (a pure query — a cached validate result would break the §4.6 cache rules). dist rebuilt; 37/37 platform-shared tests still green. KP/Todoku can use it for any POST-query endpoint under a variable path segment.

### 6.9 Other observations worth carrying forward
- **Vitest worker race on migrations** — two parallel test files calling `migrate(...)` collide on `_drizzle_migrations` PK or `ALTER TABLE` schema mutations. H-5 resolved with `pg_advisory_lock(7268010825743211)` in `withRealDb`. KP/Todoku integration test setups will need the same pattern.
- **Vitest file parallelism races on a shared DB.** H-6 grew the integration suite enough that file A's `TRUNCATE` mid-run wiped file B's seeded data. Fixed with `fileParallelism: false` in `vitest.config.ts` — single process, files serialised. Slower (~96s with real DB vs ~25s parallel) but correct. KP/Todoku will hit the same.
- **AJV `coerceTypes:false` is rail-wide.** Query-string ints don't coerce; H-2 used "string-with-numeric-pattern + handler-side `parseInt`" for `limit`. KP-2/TD-2 will hit the same on any GET with a numeric query param.
- **postgres-js Date binding via tagged templates** — at H-5 we observed Bind-step errors when a `Date` was interpolated directly. Workaround: pass `.toISOString()::timestamptz`. Adopted across the worker + tests.
- **Identiti closed ID-1..ID-10** (8–15 May 2026; 147/147 tests). H-2 unblocked by ID-3; H-3 unblocked + closed by ID-10 (`POST /v1/internal/sign` live).
- **Todoku consolidated** `c:\Projects\todoku\` → `c:\Projects\todoku-prod\`. Stale path references in this folder fixed in `src/db/client.ts` and `helpan-ai-scan-integration-memo-v1.md` during H-1.
- **`prepare:false` postgres-js pin** is now rail-wide per Todoku TD-0; H-1 matched. Identiti and KP should adopt the same.

---

## 7. Recently closed

| Item | Closed at | Notes |
|---|---|---|
| Real-Postgres smoke (was H-1 §6.1) | H-2 (9 May 2026) | Full suite ran against `helpan_ai_test` on `localhost:5432` (`postgres:postgres`). 7 migrations applied cleanly via drizzle-kit's runtime migrator. 12/12 real-DB tests green. Supabase af-south-1 provisioning for staging still pending Ops. |
| Kafka first use (was H-1 stack note "first use at H-3") | H-5 (11 May 2026) | H-5 introduced the producer surface — `kafkajs` in prod, in-memory in tests. `helpan.briefing.events` topic publishing `BRIEFING_MATCHED`. H-3 will reuse the same surface for `helpan.authority.events`; H-4 for `helpan.action.events`. |
| H-3 hard blocker — Identiti ID-10 (H4 joint contract) | H-3 (18 May 2026) | ID-10 closed 15 May 2026 — `POST /v1/internal/sign` + `helpan_authority_issuance` step-up audience + `helpan-da-*` kid live. H-3 built against it with an in-process signer stub in tests; production wires `createHttpIdentitiSigner`. |

---

*Helpan AI Rail · Build Progress · 7 May 2026 · last updated 9 May 2026 · update at each sprint close*
