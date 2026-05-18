# Helpan AI Rail — Delegated Authority Token Contract v1.0

**Document type:** Cryptographic and lifecycle contract for the delegated authority token — the rail's most security-critical artefact.
**Status:** **Strawman.** Identiti-joint integration points are marked "pending H4 closure" per Confirmation Memo §5.9. Final contract requires Identiti engineering sign-off on those points.
**Date:** 7 May 2026
**Authority:** Helpan AI Rail Design Instruction Pack v1.0 §6.4; Identiti Schema Appendix Amendment §A; Reboot Pack v1.2 §5.

---

## 0. How to read

The delegated authority token is the **single most-consumed artefact** on the rail. It is the credential an AI agent presents to Helpan AI's `/actions/dispatch` and to relying parties (Kipkiren Pay, Todoku) on every agent-initiated call. This contract specifies exactly what the token is, how it's issued, validated, revoked, and what claims it carries.

Read in order:
- §1 (Distinction from step-up) before anything else. Conflating the two is a security bug.
- §2 (Format and claims) for the wire-level shape.
- §3 (Issuance) and §4 (Validation) for the runtime contract.
- §5 (Revocation) for the lifecycle.
- §6 (Cryptographic key custody) for the security model.
- §7 (Errors) for the fault paths.
- §8 (Identiti-joint points pending H4) for what's open.

---

## 1. Distinction from step-up tokens

| Property | Step-up token (Identiti) | Delegated authority token (Helpan AI) |
|---|---|---|
| Purpose | User authorising **themselves** for a sensitive action they are about to take | User authorising **an agent** to act on their behalf, possibly later, possibly while they are offline |
| Lifetime | 5 minutes | 60 seconds — 24 hours (per scope class) |
| Use count | Single-use (jti tracked) | Multi-use within lifetime, scope-limited per call |
| Issued by | Identiti via `/v1/step-up/complete` | Helpan AI via `POST /authorities` (signed by Identiti on Helpan AI's behalf) |
| Validated by | Consuming rail (e.g. KP) against Identiti JWKS, locally | Consuming rail against Helpan AI's `POST /authorities/{id}/validate` endpoint per call |
| Revocability | Implicit (5-min expiry) | Explicit (`POST /authorities/{id}/revoke`) — immediate, auditable |
| Audit semantics | "User authorised this exact transaction at this time" | "User authorised this agent to do operations of this class within this window" |

**The two compose.** When issuing a high-stakes delegated authority (money-touching, identity-sensitive), Helpan AI requires a **fresh step-up token in the same call** — the user proves liveness for the act of granting the agent power, even though the agent will use that power later.

---

## 2. Token format

### 2.1 Algorithm

**RS256** (RSA-SHA-256 asymmetric). Signed with Identiti's RSA private key (key shared with step-up tokens but distinct `kid` to disambiguate at validation).

### 2.2 Header

```json
{
  "typ": "JWT",
  "alg": "RS256",
  "kid": "helpan-da-2026-q2"
}
```

`kid` rotates 90-day cadence; previous key retained in JWKS for 24-hour overlap window. JWKS at `https://api.identiti.co.ke/.well-known/jwks.json` — same JWKS as step-up tokens; `kid` distinguishes.

### 2.3 Claims

```json
{
  "iss": "https://api.identiti.co.ke",
  "aud": ["https://api.helpan.co.ke", "https://api.pay.kipkiren.co.ke"],
  "sub": "acc_018a12b3-4c5d-6e7f-8901-234567890abc",
  "iat": 1746604800,
  "exp": 1746608400,
  "jti": "daa_01J5Y9Z3K4M5N6P7Q8R9S0T1V",
  "token_class": "delegated_authority",
  "actor": {
    "type": "agent",
    "agent_id": "agt_01J5Y2A3B4C5D6E7F8G9H0J1K"
  },
  "initiated_by": "agent",
  "scopes": [
    {
      "scope_id": "kipkiren.write.payments",
      "amount_limit_minor": 500000,
      "per_period_limit_minor": 5000000,
      "period": "weekly",
      "category_whitelist": ["food_delivery"]
    }
  ],
  "step_up_jti": "stp_01J5Y8X7W6V5U4T3S2R1Q0P9N",
  "revocation_endpoint": "https://api.helpan.co.ke/v1/authorities/daa_01J5Y9Z3K4M5N6P7Q8R9S0T1V/validate"
}
```

### 2.4 Claim semantics

| Claim | Required | Description |
|---|---|---|
| `iss` | Yes | Always `https://api.identiti.co.ke`. Identiti is the canonical token issuer (Reboot Pack §5; Identiti Rail Contract §3). |
| `aud` | Yes | Array of audiences this token is valid for. Always includes `https://api.helpan.co.ke`. Includes the target rail (e.g. `https://api.pay.kipkiren.co.ke`) for tokens authorising agent → rail dispatch. |
| `sub` | Yes | Account UUID of the delegating user. |
| `iat` | Yes | Issued-at, Unix epoch seconds. |
| `exp` | Yes | Expiry, Unix epoch seconds. Per scope class: ≤3600 for money; ≤900 for identity-sensitive; ≤86400 for read-only. |
| `jti` | Yes | Unique token ID. Format: `daa_<ULID>`. Same value as the `Authority.id` returned by `POST /authorities`. |
| `token_class` | Yes | `"delegated_authority"`. Disambiguates from step-up tokens (`"step_up"`) and customer tokens (`"customer"`). |
| `actor` | Yes | Object: `{type, agent_id}` per Identiti Schema Appendix Amendment §A.1. `actor.type` is always `"agent"` for this token class. |
| `initiated_by` | Yes | Always `"agent"` for delegated authority tokens (the token authorises an agent). |
| `scopes` | Yes | Array of scope objects. Each carries `scope_id`, optional limits, optional whitelists. Schema below. |
| `step_up_jti` | Conditional | Required for high-stakes scopes. The JTI of the step-up token consumed at issuance time. Audit-trail link. |
| `revocation_endpoint` | Yes | URL relying parties call to validate the token. Always points at Helpan AI's validate endpoint with the token's JTI. |

### 2.5 Scope object

```json
{
  "scope_id": "string (OAuth scope id)",
  "amount_limit_minor": 500000,
  "per_period_limit_minor": 5000000,
  "period": "single_use" | "daily" | "weekly" | "monthly",
  "category_whitelist": ["string"],
  "recipient_whitelist": ["string"]
}
```

- `amount_limit_minor` — per-call maximum (KES minor units). Required for money scopes.
- `per_period_limit_minor` — aggregated maximum per `period`. Required for money scopes.
- `period` — period for `per_period_limit_minor`.
- `category_whitelist` — for category-restricted scopes (e.g. family-friendly content categories).
- `recipient_whitelist` — for comms scopes — restricted set of recipient phone-token JTIs.

Empty whitelist arrays mean "no restriction." Missing whitelists mean the same.

---

## 3. Issuance

### 3.1 Endpoint

`POST /v1/authorities` on Helpan AI rail.

### 3.2 Authentication

- HMAC-SHA-256 + mTLS with the calling consuming-app's credentials.
- Required scope: `helpan:authorities:issue`.
- Caller is the consuming app (e.g. kaLunch, Chapaa) on behalf of the user who is in-session in their app.

### 3.3 Request

Per OpenAPI spec `IssueAuthorityRequest`:

```json
{
  "account_uuid": "acc_...",
  "agent_id": "agt_...",
  "scopes": [{"scope_id": "kipkiren.write.payments", "amount_limit_minor": 500000, "per_period_limit_minor": 5000000, "period": "weekly"}],
  "ttl_seconds": 86400,
  "step_up_token": "<step-up JWT from Identiti>"
}
```

### 3.4 Issuance flow

```
[App]                        [Helpan AI]                   [Identiti]
  │                                │                            │
  │  POST /v1/authorities          │                            │
  │  (account_uuid, agent_id,      │                            │
  │   scopes, ttl_seconds,         │                            │
  │   step_up_token)               │                            │
  │ ───────────────────────────────▶                            │
  │                                │                            │
  │                          [validate inputs:                  │
  │                           - scopes are valid for agent's    │
  │                             registration                    │
  │                           - ttl ≤ per-scope-class max       │
  │                           - amount_limit ≤ per-scope ceiling│
  │                           - step_up_token present for       │
  │                             high-stakes scopes              │
  │                           - step_up_token jti not yet used] │
  │                                │                            │
  │                                │  validate step-up token    │
  │                                │ ───────────────────────────▶
  │                                │  ◀ JWKS (cached)           │
  │                                │                            │
  │                          [build claims, sign JWT via        │
  │                           Identiti signing service          │
  │                           (Identiti is canonical signer)]   │
  │                                │                            │
  │                                │  POST /v1/internal/sign    │
  │                                │  (kid=helpan-da-...,        │
  │                                │   claims=...)              │
  │                                │ ───────────────────────────▶
  │                                │  ◀ signed JWT              │
  │                                │                            │
  │                          [persist Authority record:         │
  │                           id, account_uuid, agent_id,       │
  │                           scopes, status='active',          │
  │                           expires_at, step_up_jti,          │
  │                           created_at]                       │
  │                                │                            │
  │                          [emit Kafka helpan.authority.events│
  │                           AUTHORITY_ISSUED]                 │
  │                                │                            │
  │ ◀ 201 Created                  │                            │
  │   {Authority + token field}    │                            │
```

### 3.5 Validation rules at issuance

- `agent_id` must reference an active Agent record (per `/operator/agents`).
- All `scopes[].scope_id` must reference active OAuthScope records.
- `ttl_seconds` must not exceed per-scope-class maximum:
  - Money scopes (`kipkiren.write.*`, `chapaa.write.*`, `chapaa.mmf.*`): max 3600 (1 hour).
  - Identity-sensitive scopes (`identiti.write.*`, `chapaa.read.behavioural`): max 900 (15 min).
  - Read-only aggregate scopes (`*.read.aggregate`, `*.read.position`): max 86400 (24 hours).
- `amount_limit_minor`, `per_period_limit_minor` must be ≤ per-scope ceilings (defined in OAuth scope catalogue).
- `step_up_token` is required when any scope is a money-touching or identity-sensitive scope. Validation: signature, audience (must include `helpan_authority_issuance`), expiry, single-use (jti not in `step_up_tokens.used`).
- `category_whitelist`, `recipient_whitelist` validated against per-app safety policy where applicable.

Failure modes return appropriate 4xx with `ErrorEnvelope.code`:
- `SCOPE_INVALID` — unknown or inactive scope.
- `AGENT_INVALID` — unknown or suspended agent.
- `TTL_EXCEEDS_MAX` — TTL exceeds per-scope-class maximum.
- `AMOUNT_EXCEEDS_SCOPE_CEILING` — amount limit too high for this scope.
- `STEP_UP_REQUIRED` — high-stakes scope without step-up token.
- `STEP_UP_TOKEN_INVALID` — step-up token failed validation.
- `STEP_UP_TOKEN_ALREADY_USED` — step-up token JTI seen before (single-use violation).

---

## 4. Validation (relying-party endpoint)

### 4.1 Endpoint

`POST /v1/authorities/{authority_id}/validate` on Helpan AI rail.

### 4.2 Caller

The relying party — Kipkiren Pay, Todoku, or a consuming-app server — calls this **on every agent-dispatched call** that carries the `X-Delegated-Authority` header.

### 4.3 Authentication

- HMAC-SHA-256 + mTLS with the relying party's app credentials.
- Required scope: `helpan:authority:validate`. Scoped per relying-party-rail.

### 4.4 Request

```json
{
  "token": "<JWT from X-Delegated-Authority header>",
  "intended_operation": "kipkiren_pay.payment.execute",
  "amount_minor": 250000
}
```

### 4.5 Response (200)

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "status": "active",
    "scope_covers": true,
    "within_limits": true,
    "authority": {
      "id": "daa_...",
      "account_uuid": "acc_...",
      "agent_id": "agt_...",
      "scopes": [...],
      "status": "active",
      "expires_at": "..."
    },
    "rejection_reason": null
  },
  "meta": {...}
}
```

When `valid=false`, `rejection_reason` is set:

| Reason | Meaning |
|---|---|
| `token_invalid_signature` | JWT signature failed RS256 verification |
| `token_expired` | `exp` claim in the past |
| `token_revoked` | Authority record `status='revoked'` |
| `scope_not_covered` | None of the authority's scopes match `intended_operation` |
| `amount_exceeds_limit` | Amount exceeds per-scope `amount_limit_minor` |
| `period_limit_exhausted` | Cumulative usage in the period exceeds `per_period_limit_minor` |
| `account_suspended` | Cascade revocation due to Identiti `ACCOUNT_SUSPENDED` event |

### 4.6 Caching guidance

- **Positive cache** (status='active', within limits): permitted up to **60 seconds**.
- **Negative cache**: NOT permitted. Re-validate on every call when previous result was negative.
- Cache key: `(token_jti, intended_operation, amount_bucket)` where `amount_bucket = floor(amount_minor / 100000)` to avoid cache fragmentation.
- Cache invalidation: on Kafka `AUTHORITY_REVOKED` event for the JTI, evict all cache entries.

### 4.7 Local pre-validation (relying-party convenience)

Before calling the validate endpoint, relying parties MAY do local pre-validation:
- Check JWT signature against JWKS (cached 5-minute TTL).
- Check `exp > now`.
- Check `aud` includes the relying party's audience.
- Check `intended_operation` is in any scope's coverage.

If local pre-validation fails, the relying party MAY reject without calling validate. If it passes, the relying party MUST still call validate (revocation status is not in the JWT — only the rail knows).

---

## 5. Revocation

### 5.1 Triggers

| Trigger | Source |
|---|---|
| User-initiated via Helpan Console | `POST /v1/authorities/{id}/revoke` with `reason=user_initiated` |
| Operator-initiated (incident response) | Operator console, scope `helpan:admin` |
| Cascade: Account suspended | Kafka consumer of `identiti.account.events` `ACCOUNT_SUSPENDED` |
| Cascade: User deleted | Kafka consumer of `identiti.account.events` `ACCOUNT_DELETED` |
| Cascade: KYC downgraded | Kafka consumer of `identiti.account.events` `KYC_DOWNGRADED` (revokes high-stakes authorities only) |
| Cascade: Consent revoked | Kafka consumer of `identiti.consent.events` `CONSENT_REVOKED` |
| Security incident | Operator action, scope `helpan:admin` |

### 5.2 Revocation propagation

```
[Revoke triggered]
       │
       ├─▶ Update Authority record: status='revoked', revoked_at, revocation_reason
       │
       ├─▶ Emit Kafka helpan.authority.events AUTHORITY_REVOKED
       │     consumed by: KP (cache eviction), Todoku (cache eviction),
       │                  consuming-app servers (cache eviction)
       │
       ├─▶ Future POST /authorities/{id}/validate returns valid=false,
       │     rejection_reason=token_revoked
       │
       └─▶ (v1.1) CAEP push-revocation: HTTP POST to relying-party's CAEP receiver
             — currently roadmap; v1.0 relies on Kafka + 60-second positive cache
```

### 5.3 Propagation SLA

- Synchronous validate endpoint: **immediate** (next call returns revoked).
- Kafka propagation: **<1 second** under normal load.
- Maximum delay before any relying party reflects revocation: **60 seconds** (the positive-cache TTL).

v1.1 CAEP push-revocation reduces the maximum to **<5 seconds**.

### 5.4 Idempotency

`POST /v1/authorities/{id}/revoke` is idempotent. Calling it on an already-revoked authority returns `409` with `code='AUTHORITY_ALREADY_REVOKED'` and the existing revocation timestamp.

---

## 6. Cryptographic key custody

### 6.1 Signing key

- RSA-2048 minimum, RSA-3072 recommended.
- Held in Identiti's HSM (Kenya-resident, FIPS 140-2 Level 3+ per Reboot Pack §13.5).
- Rotated 90 days; previous key retained 24-hour overlap.
- `kid` distinguishes delegated-authority keys from step-up keys.

### 6.2 Public key distribution

- JWKS at `https://api.identiti.co.ke/.well-known/jwks.json` (public, unauthenticated).
- 5-minute positive cache by relying parties.
- Refresh on 401 (signature verification failure with cached key).

### 6.3 Identiti-Helpan-AI signing API (internal)

Helpan AI does NOT hold the signing key. Helpan AI calls Identiti's internal signing service:

`POST https://internal.identiti.co.ke/v1/internal/sign`
- Authentication: mTLS + HMAC, restricted to Helpan AI's internal credential.
- Payload: `{kid, claims}`.
- Response: `{token, signed_at}`.

This split preserves Identiti's role as the canonical signer (per Reboot Pack §5) while letting Helpan AI define what gets signed.

---

## 7. Errors

### 7.1 Error codes — issuance

| Code | HTTP | Meaning |
|---|---|---|
| `SCOPE_INVALID` | 400 | Unknown or inactive scope_id |
| `AGENT_INVALID` | 400 | Unknown or suspended agent_id |
| `TTL_EXCEEDS_MAX` | 400 | ttl_seconds > per-scope-class maximum |
| `AMOUNT_EXCEEDS_SCOPE_CEILING` | 400 | amount_limit_minor > per-scope ceiling |
| `STEP_UP_REQUIRED` | 401 | High-stakes scope without step_up_token |
| `STEP_UP_TOKEN_INVALID` | 401 | Step-up signature/audience/expiry/operation mismatch |
| `STEP_UP_TOKEN_ALREADY_USED` | 409 | Step-up JTI seen before |
| `ENV_RATE_EXCEEDED` | 429 | Per-app authority issuance rate limit |

### 7.2 Error codes — validation

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_HMAC_INVALID` | 401 | Caller HMAC failed |
| `SCOPE_FORBIDDEN` | 403 | Caller lacks `helpan:authority:validate` |
| `AUTHORITY_NOT_FOUND` | 404 | JTI does not exist |
| (200 with `valid=false`) | 200 | Token invalid for any of the §4.5 reasons |

Note: 200 with `valid=false` is intentional. The validate endpoint is a query, not a guard; a missing token is `404`, an invalid token is `200 valid=false`. Relying parties branch on `data.valid`, not HTTP status.

### 7.3 Error codes — revocation

| Code | HTTP | Meaning |
|---|---|---|
| `AUTHORITY_NOT_FOUND` | 404 | JTI does not exist |
| `AUTHORITY_ALREADY_REVOKED` | 409 | Already revoked |
| `AUTHORITY_EXPIRED` | 410 | Already past expiry — revocation no-op but still 200 (idempotency) |

---

## 8. Identiti-joint integration points pending H4 closure

Per Confirmation Memo §5.9, the following points require Identiti engineering sign-off before this contract finalises:

### 8.1 `kid` namespace coordination

This contract proposes `kid=helpan-da-2026-q2` (and 90-day successors). Identiti engineering confirms whether this naming convention fits its key inventory and rotation cadence.

### 8.2 Internal signing API (`POST /v1/internal/sign`)

This contract proposes Identiti exposes an internal signing API to Helpan AI. The API does not exist in Identiti v1.0 today. Two implementation options:

- **(a) Identiti exposes signing API.** Cleanest. Identiti owns the key; Helpan AI submits claims.
- **(b) Helpan AI gets a delegated subordinate key.** Identiti issues a signing key with constrained `kid` to Helpan AI; Helpan AI signs locally. Higher operational risk.

This strawman assumes (a). Identiti engineering confirms or proposes alternative.

### 8.3 Step-up token audience for delegated-authority issuance

This contract requires the step-up token to have audience `helpan_authority_issuance`. Identiti's step-up token issuance flow today has audiences `kipkiren_pay` and `identiti`. Adding the new audience is a small Identiti change.

Identiti engineering confirms this audience addition.

### 8.4 CAEP integration (v1.1)

CAEP push-revocation requires Identiti and Helpan AI to share a CAEP receiver model. Joint design when v1.1 begins.

### 8.5 Cascade-revocation Kafka events

This contract subscribes to:
- `identiti.account.events.ACCOUNT_SUSPENDED`
- `identiti.account.events.ACCOUNT_DELETED`
- `identiti.account.events.KYC_DOWNGRADED`
- `identiti.consent.events.CONSENT_REVOKED`

Identiti engineering confirms these event types are emitted with the schemas Helpan AI expects (especially `KYC_DOWNGRADED` and `CONSENT_REVOKED` — `ACCOUNT_SUSPENDED` and `ACCOUNT_DELETED` already exist in the platform Kafka topology).

---

## 9. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §6.4
2. Helpan AI Design Reference v1.0 §6.2 + Amendment §A.2
3. Identiti Rail Contract v1.0 + Amendment §A
4. Identiti Schema Appendix v1.0 + Amendment §A
5. Confirmation Memo v1.0 §5.9 (joint contract requirement)
6. Scan Integration Memo v1.0
7. Reboot Pack v1.2 §5

---

*Helpan AI Rail · Delegated Authority Token Contract v1.0 (Strawman) · 7 May 2026 · Kirimon Market Ventures · Confidential · Identiti-joint review pending H4 closure*
