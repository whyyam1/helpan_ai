# Helpan AI — Newdocs Instruction Pack (21 May 2026)

**Source:** Chamia's 21 May 2026 additions in `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\`.
**Scope:** What the Helpan AI rail needs to add, change, and execute because of the six new product/rail packs Chamia just landed.
**Read first:** [RECAP.md](RECAP.md) §1, §2 — current state is H-1/2/3/3.1/3b/5/6/7/8a closed; H-8b in flight (RN library `C:\Projects\helpan-console\`). Rail 173/173 tests + Console 43/43. Railway `web` LIVE 20 May; Supabase re-pointed to `jvkhoveeayixbjnhmqxa` — migrations need re-running. H-4 hard-blocked on KP-8 + Todoku TD-1.

This pack enumerates **net-new work** the newdocs introduce for the Helpan AI rail.

---

## Newdocs touching Helpan AI

| Source pack | File | Why Helpan AI cares |
|---|---|---|
| **KWS Sprint 9** | `newdocs/Kipkiren Web Services-Sprint 9-Helpan/helpan_kws_instruction_pack.md` | **Most consequential pack for Helpan AI.** Agent specification for `helpan-kws-v1`. Phase 1 = enrichment/confidence/SLA warning; Phase 2 = autonomous execution (DNS/SSL) routed via Helpan dispatch. |
| KWS Sprint 9 | `newdocs/Kipkiren Web Services-Sprint 9-Helpan/kws_sprint_9.md` (KWS-S9-001) | KWS creates a KWS-side `agent_registry` table and seeds `helpan-kws-v1`. **Rail-side admission is the corresponding action** — currently not done; McKinsey P1 + Reboot Pack §14 open CEO action. |
| KWS Sprint 9 | `newdocs/Kipkiren Web Services-Sprint 9-Helpan/kws_mckinsey_advisory.md` | Strategic argument that Helpan KWS must be a first-class Helpan AI agent — "registering it late risks parallel-architecture fragmentation." |
| KWS Inaugural | `newdocs/kipkiren web services - inaugural pack/kws_architecture_v1.md` (§7) | KWS AI decomposition engine — recommendation from analysis is to run this on Helpan AI rail rather than as a direct Anthropic call. ADR open. |
| Itafika | `newdocs/Itafika-LaaS rail-DevPack/itafika-sprint0-reboot-pack-md.md` (§5) | NEW OAuth scope `delivery.dispatch` to add to the scope catalogue. No agent build at MVP — surface is dark-ready (Phase 2+). |
| Hakken | `newdocs/Hakken-Discovery rail-DevPack/hakken-rail-spec-md.md` (§9.4) | **Inverted relationship** — Helpan AI is a **consumer of Hakken** (calls `POST /ranking/query` with `X-Hakken-Caller: helpan_ai`). No Helpan-side endpoint changes; outbound client wiring. |
| Hakken | `newdocs/Hakken-Discovery rail-DevPack/hakken-reboot-pack-md.md` | Confirms split: Hakken does not run agents; Helpan AI does. Helpan calls Hakken like any consuming app. |
| LipaStack | `newdocs/LipaStack-DevPack/lipastack-tech-spec-build-pack-v13.md` (v2 section) | v2 only — per-merchant scoped agents for dispute evidence assembly + risk dashboard NL summaries. Not MVP work. |
| Todoku productisation | `newdocs/TODOKU-Comms rail-DevPack/todoku-bd-portal.html` + `todoku-finance-portal.html` | BD provisioning (`POST /bd/tenants`) and Finance credit-decision (`POST /finance/credit-proposals/{id}/decision`) are exactly the kind of high-risk operator writes that should call Helpan `POST /v1/authorities/{id}/validate` per-call. |

---

## Net-new Helpan AI tickets

### H-8c — Admit `helpan-kws-v1` to rail-side agent registry

**Highest-priority new ticket.** Closes McKinsey P1 action and Reboot Pack §14 outstanding CEO action. Slot **between H-8b (in flight) and H-9 (Klokd integration)**.

**Work surface:**

- Insert `helpan-kws-v1` into Helpan AI rail's `agents` registry (existing H-6 surface). Class: `portfolio_app` (KWS is a Kipkiren Teknolojia portfolio division, not a third-party).
- Issue HMAC creds for the rail to authenticate KWS as a tenant when KWS calls `POST /v1/authorities/{id}/validate` (relying-party check) and any future per-app surfaces.
- Add scope-catalogue entries for `kws_*` namespace (paper for now — Phase 1 doesn't issue authorities). Specific scopes per `helpan_kws_instruction_pack.md` §5 (Autonomous scope table): DNS / SSL / MX / domain renewal / uptime config (Phase 2 execution targets).
- Add safety-policy entry for `helpan-kws-v1` (H-6 surface).
- Audit `agent.register` event with `actor_type='operator'` (Chamia / Silvia performs the registration).

**Why this is rail-side, not KWS-side:**

The Helpan KWS instruction pack §3.1 is explicit: "Helpan KWS gets agent identity, delegated-authority validation, consent, audit event emission, and escalation routing **from the Helpan AI rail** — it does not own its own runtime." KWS-S9-001 creates a KWS-local registry table, but that's the KWS-side mirror — the canonical registration is on the rail.

**Open Question 1:** is KWS-S9-001 a duplicate of the rail-side registry, or just a local-allowlist mirror? Recommend: mirror.

### H-8d — Helpan KWS Phase 1 agent build (proforma enrichment runner)

**Phase 1 work surface — the agent itself.** Lands as a Helpan-AI-rail-side agent runner, not as a KWS-direct Anthropic call.

This is the recommendation from the agent analysis. Rationale: §3.1 of the instruction pack mandates rail-side runtime. KWS-S9-008 specifies the *capabilities* (enrichment + confidence + SLA early warning + admin enrichment panel) — those capabilities run on the Helpan AI rail with `helpan-kws-v1` agent identity, calling KWS API endpoints with `helpan-kws-service` JWT.

**Concretely:**

- New Helpan agent runner targeted at the `kws.proforma.enrich` operation kind.
- Reads KWS API via the `helpan-kws-service` JWT (issued by KWS at KWS-S9-002, scoped to the read endpoints + audit write).
- Calls Claude API via the rail's existing LLM provider abstraction (Confirmation Memo §5.8 — provider still open; this surfaces it).
- Emits audit events on the **rail-side hash-chained audit log** (advisory lock `7268010825743210`), not the KWS-side `audit_log` table. **This is the major reconciliation point** — see Open Question 2.

**Cross-rail audit invariant (§A.11):** every enrichment event must carry `actor.type='agent'`, `actor.agent_id='helpan-kws-v1'`, `traceparent`, `business_op_id`. Already supported by `appendAuditEntry` after H-3.1.

**Sequencing:** **Cannot start until KWS Sprint 1–8 ship.** KWS-S6 in particular (`client_services` machine-readable + real-time fields) is the data Helpan KWS reads. Realistic Helpan-side calendar: align with KWS-S9 timing.

### H-NN — Scope catalogue addition: `delivery.dispatch` (Itafika)

**Trivial scope-catalogue entry.** No agent build at Itafika MVP — the auth surface is dark-ready per Itafika §5.

**Add to OAuth scope catalogue (H-6 surface):**

- Scope ID: `delivery.dispatch`
- Description: "Dispatch a delivery on behalf of an account."
- Class: `delivery` (new top-level class — or fits under `portfolio_app` actions? Open Question 3).
- TTL ceiling: align with §A.1 JIT band — recommend ≤1h (matches money-class scope ceiling in H-3 scopeClassifier).
- High-stakes: yes (operational + financial consequences).

**Itafika side:** Itafika S1 (`ITF-S1-011`) validates a delegated-authority token + scope query against this scope. No agent. The scope exists in the catalogue so Itafika's auth wiring is exercised end-to-end at MVP without Helpan dispatching anything yet.

**Bundled with this ticket:** also add `discovery.query` (for any future agent calling Hakken's `POST /ranking/query`) and `kws.*` scopes (paper-only for Phase 2). All catalogue, no agents.

### H-NN — Hakken consumer wiring (no rail-side endpoint change)

**Outbound client only. No new Helpan AI rail endpoint.**

When Hakken's HK-3 (ranking v0) ships, Helpan AI rail begins calling Hakken `POST /ranking/query` from agent runners that need discovery / ranking signals. Helpan attaches `X-Hakken-Caller: helpan_ai` per the Hakken rail spec §9.4.

**Wire shape (per Hakken §9.4 — confirm with Hakken team):**

- `Authorization: Bearer <token>` — delegated-authority token, issued by Helpan AI, validated by Hakken via Helpan AI's `POST /v1/authorities/{id}/validate`.
- OR `X-Helpan-Delegation: <jwt>` — separate header slot. Hakken doc is ambiguous; needs joint decision before HK-4 (Identiti integration sprint) locks.

**No work for the Helpan AI rail until HK-3 is reachable.** Track as a dependency, ship a small outbound client module when needed.

### H-NN — Cascade-revocation extension (Hakken consent invalidation)

**Bundled extension of H-3b cascade-revocation worker** to consume the new Identiti `identiti.consent.events` (ID-14 above on the Identiti rail).

**Current behaviour (H-3b):** consumes `identiti.account.events`, revokes authorities on `ACCOUNT_SUSPENDED` (all) / `TIER_CHANGED` downgrade (high-stakes only).

**New behaviour:** also consume `identiti.consent.events.consent_revoked` and `.scope_degraded`. When a customer revokes consent for an app, revoke any active authorities for that `(account, app)` pair.

**Sequencing:** waits on Identiti ID-14 (consent surface) shipping.

---

## Existing surfaces affected (no new tickets — confirmation)

| Surface | Change |
|---|---|
| `POST /v1/authorities/{id}/validate` | Currently sandbox-stubbed by KP-8 + TD-9. Now reachable since H-3 closed 18 May. KP-8 swaps `StubHelpanAuthorityClient` → real client; TD-9 swaps `SandboxHelpanClient` → real. No Helpan-side change. |
| OAuth scope catalogue (H-6 surface) | Catalogue grows: `delivery.dispatch`, `discovery.query`, `kws.*` (Phase 2). Paper-only entries — no agents at MVP. |
| `agents` registry (H-6 surface) | Add `helpan-kws-v1` (portfolio_app class). H-8c above. |
| Safety policies (H-6 surface) | Add `helpan-kws-v1` safety policy — bound the Phase 1 enrichment agent's network access (KWS API only) and prohibited actions (no autonomous execution until Phase 2 ADR-KWS-002 revised). |
| Audit writer (`src/lib/auditWriter.ts`) | No code change. §A.11 columns (`agent_id`, `delegated_authority_jti`, `target_rail`, `target_operation`, `business_op_id`) already populated after H-3.1. Helpan KWS Phase 1 events use them. |
| Cascade-revocation worker (`src/workers/cascadeRevocation/`) | Extended to consume new Identiti consent events once ID-14 ships. |

---

## Cross-rail wiring deltas

| Direction | Change |
|---|---|
| Helpan AI ↔ KWS | NEW `helpan-kws-v1` agent registered rail-side (H-8c); Phase 1 enrichment agent runs rail-side (H-8d). Audit events on rail-side hash-chained audit log. KWS API consumed via `helpan-kws-service` JWT (KWS-S9-002). |
| Helpan AI → Hakken | Helpan AI calls Hakken `POST /ranking/query` as a consumer. Auth via Helpan-issued delegated authority. No rail-side endpoint change. |
| Helpan AI ← Identiti | NEW `identiti.consent.events` consumed by extended cascade-revocation worker (once ID-14 ships). |
| Helpan AI ↔ Kipkiren Pay | KP-8 delegated-authority validator now hits real Helpan `/v1/authorities/{id}/validate` (sandbox stub → real client swap). |
| Helpan AI ↔ Todoku | TD-9 per-call validate sandbox stub → real client. BD portal provisioning (TD-18) and Finance credit-decision should call validate per-call when those portals ship. |
| Helpan AI ← LipaStack | v2 only — per-merchant scoped agents. No MVP work. |
| Helpan AI ← Itafika | Itafika S1 validates `delivery.dispatch` scope against catalogue. No agent flows at Itafika MVP. |

---

## Recommended sequencing

Current state: H-8b in flight (RN library). H-4 (action dispatch) hard-blocked on KP-8 + Todoku TD-1. KP-8 now engineering-complete; TD-1 closed. **H-4 is increasingly unblocked.**

1. **Finish H-8b** (RN library component layer + `HelpanConsole.open()` entry) — in flight, don't divert.
2. **Re-run migrations** against new Supabase project `jvkhoveeayixbjnhmqxa` (the 0001–0009 set). Seed first `app_credentials` row (otherwise every HMAC endpoint 401s). Pre-requisite housekeeping per RECAP §1.
3. **H-8c — Admit `helpan-kws-v1`** — paper-light ticket (agent registration + scope catalogue + safety policy). Closes McKinsey P1 + Reboot Pack §14 CEO action. Slot before H-9.
4. **Scope catalogue additions** — `delivery.dispatch` + `discovery.query` + `kws.*` paper entries. Bundle with H-8c.
5. **H-4 (action dispatch)** — original sprint plan. KP-8 + TD-1 now substantially unblocked. **Critical-path item for any per-app sprint (H-9..H-12).**
6. **H-9 (Klokd)** — original plan. Depends on KP-8/9 + Todoku TD-9 — all engineering-complete.
7. **H-8d Helpan KWS Phase 1 agent runner** — gated on KWS Sprint 6+ shipping (KWS `client_services` machine-readable). Realistic = KWS Sprint 9 alignment.
8. **Cascade-revocation extension** — gated on Identiti ID-14 (consent surface).
9. **Hakken consumer wiring** — gated on Hakken HK-3 shipping. Outbound client module + auth wiring.
10. **H-10..H-12** — original plan.

---

## Open questions for Chamia

1. **Two agent registries?** KWS-S9-001 creates a KWS-side `agent_registry`; Helpan AI rail has its own. Is KWS-side a mirror / local-allowlist, or is one canonical? Recommend: rail-side canonical, KWS-side mirror.
2. **One audit log or two?** Helpan KWS instruction pack §3.1 routes via Helpan AI rail audit bus (hash-chained, advisory lock `7268010825743210`). §6 + KWS-S9 write to a KWS-side `audit_log` table. **These cannot both be canonical** — pick one. Recommend rail-side; KWS-S9-008 becomes an event-forwarder to the rail. Cost: a small writer adapter on the KWS side.
3. **`delivery.dispatch` scope class** — new top-level class, or under existing `portfolio_app`? Affects scopeClassifier TTL ceilings.
4. **Phase 2 execution-site decision** — KWS-S9-004/005 builds Cloudflare DNS/SSL execution in the KWS backend (flag OFF). Should Phase 2 instead route through H-4 (action dispatch)? Recommend: yes. Implication: Phase 2 = pure migration of execution from KWS-side to rail-side, no new build on KWS.
5. **AI runtime for KWS AI decomposition** — KWS Inaugural Pack mandates "dedicated KWS Claude key, not shared." Should the KWS AI decomposition engine itself run as a Helpan AI agent (consistent with §A.5 platform direction), or stay as a KWS-direct Anthropic call? If the former, this is a Phase 1+ Helpan agent in addition to the Helpan KWS enrichment agent.
6. **Hakken auth wire** — `Authorization: Bearer` vs `X-Helpan-Delegation` header for Helpan calling Hakken. Hakken §9.4 is ambiguous; needs joint decision before HK-4 locks.
7. **KWS scope TTL** — Helpan KWS instruction pack §3.2 says 72h TTL on `kws_*` scopes. Identiti instruction pack flags this as a JIT-violation candidate (§A.1 norm is ≤15min). Joint Identiti + Helpan decision needed.

---

## File pointers

- Helpan KWS agent specification: `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Kipkiren Web Services-Sprint 9-Helpan\helpan_kws_instruction_pack.md`
- KWS Sprint 9 backlog (KWS-S9-001 agent registry; KWS-S9-008 Phase 1 capabilities): `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Kipkiren Web Services-Sprint 9-Helpan\kws_sprint_9.md`
- KWS Reboot Pack v2 (sprint status + ADRs): `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Kipkiren Web Services-Sprint 9-Helpan\kws_reboot_pack_v2.md`
- McKinsey advisory (Implication 4 — rail-side agent admission): `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Kipkiren Web Services-Sprint 9-Helpan\kws_mckinsey_advisory.md`
- KWS Inaugural architecture §7 (AI decomposition prompt design): `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\kipkiren web services - inaugural pack\kws_architecture_v1.md`
- Itafika `delivery.dispatch` scope §5: `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Itafika-LaaS rail-DevPack\itafika-sprint0-reboot-pack-md.md`
- Hakken consumer relationship §9.4: `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\Hakken-Discovery rail-DevPack\hakken-rail-spec-md.md`
- LipaStack v2 agent surface: `c:\Projects\Platform Rails-instruction pack v1-reboot pack v1.2\newdocs\LipaStack-DevPack\lipastack-tech-spec-build-pack-v13.md`

---

*Helpan AI rail · newdocs instruction pack · 21 May 2026.*
