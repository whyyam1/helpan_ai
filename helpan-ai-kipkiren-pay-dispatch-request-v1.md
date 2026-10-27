# Helpan AI → Kipkiren Pay — Agent Dispatch Endpoint Request v1

**From:** Helpan AI rail (agent-runtime rail) — build session
**To:** Kipkiren Pay rail — engineering / Claude session
**Date:** 2026-10-27
**Re:** KP needs one inbound endpoint so Helpan agents can move money on a user's behalf
**Status:** 🟡 OPEN — blocks every agent money action (Klokd shift pay, Chapaa round-up deposit, Lunch Drop orders, family-discovery basket)

---

## Why this is needed

Today KP is a **relying party** of Helpan: it calls `POST /v1/authorities/{jti}/validate` to check a delegated authority (DA) presented on a KP route. That leg is **live and verified** (26 Oct; tenant `kipkiren-pay`, commit `f37a18c`).

The other half is missing. When an **agent** acts (not a human tapping a button), the consuming app calls Helpan `POST /v1/actions/dispatch`. Helpan validates the DA, enforces per-call and per-period ceilings, writes the §A.11 audit pair (`action.dispatch` → `action.complete`/`action.fail`), and then **forwards the action to the target rail**. For money, the target rail is KP.

KP has no route that accepts that forward. So every agent money action ends as `status=failed, error_code=TARGET_RAIL_UNCONFIGURED`. The authority, limits and audit all work; only the last hop is missing.

Why Helpan forwards instead of apps calling KP directly with the DA:
- **One choke point for agent money.** Ceilings, period budgets, revocation and the audit chain are enforced in one place (Reboot Pack v1.2 Amendment §A.5: Helpan is the per-call validation authority when `actor.type='agent'`).
- **Forensic join.** Helpan's audit row and KP's ledger row share `business_op_id` + `traceparent` (§A.11), so a regulator query on "which agent moved this money, under which authority" is answerable from either side.
- **Revocation is immediate.** A revoked authority never reaches KP, because Helpan rejects it before forwarding.

---

## The ask

### 1. Expose `POST /v1/dispatch` on KP

If you prefer another path, send it back as `HELPAN_KP_DISPATCH_PATH`.

**Request Helpan sends** (already implemented; fixed 27 Oct in Helpan `3e445f9` to match KP's auth):

```
POST /v1/dispatch
Content-Type: application/json
Authorization: KipkirenPay-HMAC-SHA256 app_id=helpan_ai, signature=<base64>
x-kipkirenpay-timestamp: <ISO-8601>
X-Delegated-Authority: <DA JWT, RS256, signed by Identiti>
X-Idempotency-Key: <same key the consuming app used at Helpan>
X-Business-Op-Id: boi_…
Traceparent: 00-<32hex>-<16hex>-01

{
  "operation": "klokd.write.shift_pay",
  "account_uuid": "acc_…",
  "payload": { …operation-specific, opaque to Helpan… },
  "business_op_id": "boi_…"
}
```

- Signing uses the standard KMV canonical string (`METHOD\nPATH\nCONTENT_TYPE\nTIMESTAMP\nSHA256_HEX(body)`), via `@kmv/platform-shared/hmac`, the same code KP already verifies with.
- `operation` is a **Helpan scope ID** (exact-match rule, Helpan RECAP §6.15).

**Response Helpan expects:**
- **2xx** with `{ "ok": true, "data": { … } }`. Helpan stores `data`, redacted, as the action result, so include KP's own reference (e.g. `payment_id` / `hold_id`).
- **non-2xx** with `{ "ok": false, "error": { "code": "KP_…", "detail": { … } } }`. Helpan surfaces `error.code` verbatim as the action's `error_code`.
- **Respond within 15 s.** That's Helpan's timeout, after which the action is marked `TARGET_RAIL_TIMEOUT`. For M-Pesa/STK flows, return 2xx with a `pending` status and KP's reference. Don't hold the socket open until settlement.

### 2. What KP must do on receipt

1. **Verify HMAC** with KP's existing auth plugin. The caller is app `helpan_ai`.
2. **Re-validate the DA (recommended, defence in depth).** Use KP's existing `HttpHelpanAuthorityClient.validate({ token: X-Delegated-Authority, intendedOperation: body.operation, amountMinor })`. It's a read-only query and doesn't double-count usage. Reject if `data.valid !== true`.
3. **Check `account_uuid`** equals the DA's `authority.account_uuid`.
4. **Dedup on `X-Idempotency-Key`.** Helpan may retry under the same key.
5. **Persist `business_op_id` + `traceparent`** on the ledger row (§A.11), with `actor.type='agent'` and `actor.agent_id` taken from the DA claims.
6. **Route `operation` to the internal KP handler** (table below).

### 3. Operations to route

These are the scopes in Helpan's live catalogue whose money moves on KP:

| `operation` (scope ID) | Per-call ceiling (minor) | Suggested KP handler | Payload KP should define |
|---|---|---|---|
| `kipkiren.write.payments` | 500,000 | payment execute | amount, destination |
| `kipkiren.write.holds` | 500,000 | hold create / release / refund | `action: create\|release\|refund`, hold ref, amount |
| `kipkiren.write.schedules` | 100,000 | schedule create / cancel | schedule spec |
| `klokd.write.shift_pay` | 200,000 | payout to worker | amount, `destination_type`, `destination_ref` |
| `chapaa.write.deposit` | 30,000 | wallet → savings deposit | amount, goal ref |
| `lunchdrop.write.orders` | 100,000 | order payment / escrow hold | amount, order ref |
| `family_discovery.write.basket` | 250,000 | basket checkout | amount, basket ref |

`kipkiren.write.holds` covers three sub-actions under one scope, so KP needs an `action` field in the payload. **Please publish the payload schema for each operation**; Helpan forwards `payload` untouched and the consuming apps will build to your schema.

Unknown `operation` → `400 { "error": { "code": "KP_OPERATION_UNSUPPORTED" } }`.

### 4. Issue Helpan a KP tenant credential

Seed `helpan_ai` in KP's `app_credentials` as **internal**, with whatever scope KP gates `/v1/dispatch` on. Send back:

| Helpan env var | Value |
|---|---|
| `HELPAN_KP_URL` | `https://kipkiren-pay-api-production.up.railway.app` (or `https://pay.kipkiren.co.ke` once its TLS cert is live) |
| `HELPAN_KP_HMAC_SECRET` | 64-hex secret, **out of band** |
| `HELPAN_KP_APP_ID` | only if not `helpan_ai` |
| `HELPAN_KP_DISPATCH_PATH` | only if not `/v1/dispatch` |

Helpan then sets these on Railway `helpan_ai`, and the dispatcher switches from "unconfigured" to live with no code change.

---

## Done when

A consuming app dispatches `kipkiren.write.payments` for a sandbox amount through Helpan, and:
- Helpan returns `status=completed` with KP's reference in `result`.
- KP's ledger row carries the same `business_op_id`.
- Helpan `npm run audit:verify` stays CHAIN INTACT.

Helpan will run this smoke test as soon as the credential lands.
