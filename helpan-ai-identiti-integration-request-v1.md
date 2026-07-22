# Helpan AI → Identiti — Integration Request v1

**From:** Helpan AI rail (agent-runtime rail), build session — KMV Platform
**To:** Identiti rail — engineering / Claude session
**Date:** 2026-07-20
**Re:** Identiti dependencies blocking Helpan AI's first *complete* consuming-app integration (Console live-grant + agent-action issuance)
**Status:** ✅ **RESOLVED 2026-07-20** (Identiti handoff, live-verified). Values wired into Helpan `.env`; pending paste into the Railway `web` service.

## Resolution (Identiti handoff, 2026-07-20)

| Item | Delivered value |
|---|---|
| `IDENTITI_API_BASE` | `https://identiti-production.up.railway.app` (informational — Helpan uses full per-endpoint URLs, no `IDENTITI_API_BASE` var) |
| `IDENTITI_JWKS_URL` | `https://identiti-production.up.railway.app/.well-known/jwks.json` — **live-verified**; publishes kid `helpan-da-2026-q2` (RS256) |
| `IDENTITI_INTERNAL_SIGN_URL` | `https://identiti-production.up.railway.app/v1/internal/sign` |
| `IDENTITI_JWT_ISSUER` | `https://api.id.identiti.co.ke` — logical issuer, **intentionally ≠ the JWKS host** |
| internal-sign `app_id` → `HELPAN_INTERNAL_APP_ID` | **`helpan_ai_internal`** (NOT `helpan_ai`) |
| DA kid → `JWT_DA_KID` (sent in sign body) | `helpan-da-2026-q2` |
| Console customer-token `requested_audience` (= `HELPAN_JWT_AUDIENCE`) | `https://api.helpan.co.ke` |
| Step-up | `operation_kind=helpan_ai.authority_issuance`, `operation_audience=helpan_authority_issuance` |
| Internal-sign HMAC secret → `IDENTITI_INTERNAL_HMAC_SECRET` | delivered out-of-band 2026-07-20 |

**Op-kind correction:** the registered value is **`helpan_ai.authority_issuance`** (Identiti's canonical `OPERATION_KIND_ENUM`), NOT the `helpan.authorities.issue` originally requested in Ask 1 below. Apps sending the old string get `400 OPERATION_KIND_UNKNOWN`.

_Original asks retained below for the record._

---

## Who we are

Helpan AI is KMV's **agent-runtime rail** (`helpan.co.ke`; DPA-2019; **no CBK / funds / KYC exposure**). It issues delegated-authority (DA) tokens, validates them per-call for Kipkiren Pay / Todoku, dispatches agent actions to those rails, and ships the **Helpan Console** consent surface (`@kmv/helpan-console`, git-installable).

Helpan is code-complete (H-1…H-17 closed; 24 endpoints; `web` live on Railway). We consume Identiti as our identity root — **we never hold the DA signing key, issue customer tokens, or run step-up ourselves.** We're standing up the first end-to-end app integration; three blockers are on the Identiti side.

## Flows that touch Identiti

- Helpan → your `POST /v1/internal/sign` (HMAC) to mint DA JWTs (kid `helpan-da-*`).
- Helpan verifies DA + step-up JWTs against your **JWKS** (RS256).
- The **Console** authenticates end-users with an Identiti **customer JWT**, `aud` = Helpan's audience.
- **High-stakes** issuance (money / behavioural scopes) requires a fresh Identiti **step-up token**, `aud=helpan_authority_issuance`.

---

## Asks

### Ask 1 — Register `helpan.authorities.issue` as a step-up operation-kind
The Console Grant flow initiates a step-up challenge for "grant a Helpan authority." Until `helpan.authorities.issue` exists in your operation-kind catalogue, `POST /v1/step-up/initiate` rejects it and the Grant flow 503s.
- **Do:** add `helpan.authorities.issue` to the operation-kind enum, mapped to the `helpan_authority_issuance` step-up audience.
- **Unblocks:** Console live-grant (H-13 smoke) + all high-stakes issuance.

### Ask 2 — Provision/confirm Helpan's internal-sign tenant credential (staging + prod)
Helpan calls `POST /v1/internal/sign` as tenant `app_id=helpan_ai`, HMAC-signed, scope `identiti:internal:sign:delegated_authority`, timestamp header `x-identiti-timestamp`.
- **Do:** confirm `helpan_ai` is provisioned with that scope on the current Identiti and hand off the HMAC secret out-of-band (we set `IDENTITI_INTERNAL_HMAC_SECRET` + `IDENTITI_INTERNAL_SIGN_URL`).
- **Unblocks:** any live issuance — without it `POST /v1/authorities` 503s (the env is currently unset on our deploy).

### Ask 3 — Confirm customer-JWT minting with `aud = <Helpan audience>`
The Console presents an Identiti customer JWT whose `aud` must equal Helpan's audience (`https://api.helpan.co.ke`; the string, not a live host). This is the same shape as the `aud=hakken` cross-audience case that App Integration Guide §18.5.1 flags as "not yet designed."
- **Do:** confirm a consuming app can obtain a customer token with `aud=<helpan>` (second-audience mint or audience extension), or tell us the intended mechanism/endpoint. **If undesigned, this needs a decision, not just config.**
- **Unblocks:** the Console authenticating to `/v1/authorities/*` at all.

---

## Confirmations (believed done via ID-10, 15 May — please verify in the *current* environment)

- **C1:** `helpan_authority_issuance` step-up audience is live and issuing.
- **C2 (config mismatch — needs your correct values):** Helpan is currently configured with
  `IDENTITI_JWKS_URL=https://api.identiti.co.ke/.well-known/jwks.json` and
  `IDENTITI_JWT_ISSUER=https://api.identiti.co.ke`.
  But App Integration Guide §19.1 says `api.identiti.co.ke` is **not cut over** — Identiti currently serves at a Railway domain (`https://identiti-production.up.railway.app`). If so, our JWKS fetch + `iss` check will fail against a dead host.
  **Please confirm the authoritative JWKS URL + `iss` value for the current environment** (and the DA-signing kid `helpan-da-*`). We will point `IDENTITI_JWKS_URL` / `IDENTITI_JWT_ISSUER` at whatever you confirm.

---

## On our side, once each lands

- Ask-1 → we run the Console live-grant smoke.
- Ask-2 → we set the internal-sign env; issuance goes live.
- Ask-3 → the Console authenticates.
- C2 → we repoint `IDENTITI_JWKS_URL` / `IDENTITI_JWT_ISSUER` and re-verify JWT paths.

**Not asking for:** anything CBK / funds / KYC — Helpan holds none. These are token / audience / tenant-catalogue / JWKS items only.

Please reply with status per item and we'll sequence the smoke tests.
