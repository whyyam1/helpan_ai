# Helpan AI → Todoku — Agent Dispatch Endpoint Request v1

**From:** Helpan AI rail (agent-runtime rail) — build session
**To:** Todoku rail — engineering / Claude session
**Date:** 2026-10-27
**Re:** Todoku needs one inbound endpoint so Helpan agents can send notifications on a user's behalf
**Status:** 🟡 OPEN — blocks every agent-sent message (briefing alerts, shift nudges, savings prompts)

---

## Why this is needed

When an **agent** acts, the consuming app calls Helpan `POST /v1/actions/dispatch`. Helpan validates the user's delegated authority (DA), enforces limits, writes the §A.11 audit pair, then **forwards the action to the target rail**. For messages, the target rail is Todoku.

Todoku has no route that accepts that forward, so every agent message ends as `status=failed, error_code=TARGET_RAIL_UNCONFIGURED`.

Why forward through Helpan instead of apps calling `POST /v1/messages/send` directly:
- **Consent gate.** An agent may only message a user under an authority carrying `todoku.write.notifications`. Revocation is immediate because Helpan rejects revoked authorities before forwarding.
- **Forensic join.** Helpan's audit row and Todoku's message row share `business_op_id` + `traceparent` (§A.11), so "which agent sent this SMS, under whose consent" is answerable from either side. That matters for the Kenya Information and Communications Act (KICA) and Data Protection Act complaints handling.
- **One choke point** for agent-originated comms (Reboot Pack v1.2 Amendment §A.5).

Todoku keeps everything it already does: templates, channel match, SIMjacker filter, envelope enforcement, sender-ID rules. The dispatch endpoint is a thin wrapper over the existing send pipeline.

---

## The ask

### 1. Expose `POST /v1/dispatch` on Todoku

If you prefer another path, send it back as `HELPAN_TODOKU_DISPATCH_PATH`.

**Request Helpan sends** (already implemented; per-rail timestamp header fixed 27 Oct in Helpan `3e445f9`):

```
POST /v1/dispatch
Content-Type: application/json
Authorization: Todoku-HMAC-SHA256 app_id=helpan_ai, signature=<base64>
x-todoku-timestamp: <ISO-8601>
X-Delegated-Authority: <DA JWT, RS256, signed by Identiti>
X-Idempotency-Key: <same key the consuming app used at Helpan>
X-Business-Op-Id: boi_…
Traceparent: 00-<32hex>-<16hex>-01

{
  "operation": "todoku.write.notifications",
  "account_uuid": "acc_…",
  "payload": {
    "template_id": "<Todoku template ULID>",
    "channel": "sms",
    "parameters": { … }
  },
  "business_op_id": "boi_…"
}
```

The suggested `payload` mirrors `POST /v1/messages/send`. **Todoku owns this schema**; send back the final shape and Helpan and the apps will build to it. The recipient is `account_uuid`, which Todoku resolves through Identiti as it does today.

**Response Helpan expects:**
- **2xx** `{ "ok": true, "data": { "message_id": "…", "status": "queued" } }`. Helpan stores `data`, redacted, as the action result.
- **non-2xx** `{ "ok": false, "error": { "code": "TD_…", "detail": { … } } }`. `error.code` surfaces verbatim to the app.
- **Respond within 15 s.** Return once the message is accepted or queued; don't wait for delivery receipts.

### 2. What Todoku must do on receipt

1. **Verify HMAC** with Todoku's existing auth plugin. The caller is app `helpan_ai`.
2. **Re-validate the DA (recommended).** Call Helpan `POST /v1/authorities/{jti}/validate` with `intended_operation: "todoku.write.notifications"`. Reject unless `data.valid === true`. Todoku would need a Helpan tenant for this; ask and Helpan seeds one (scope `helpan:authority:validate`), as done for KP on 26 Oct.
3. **Check `account_uuid`** equals the DA's account.
4. **Dedup on `X-Idempotency-Key`.**
5. **Persist `business_op_id` + `traceparent`** on the message row, with `actor.type='agent'` and the `agent_id` from the DA claims.
6. **Run the normal send pipeline** (template, envelope, filters).

Unknown `operation` → `400 { "error": { "code": "TD_OPERATION_UNSUPPORTED" } }`.

### 3. Issue Helpan a Todoku tenant credential

Provision `helpan_ai` via `scripts/provision-app.ts` (internal; channels per your policy). Send back:

| Helpan env var | Value |
|---|---|
| `HELPAN_TODOKU_URL` | `https://todoku-prod-production.up.railway.app` |
| `HELPAN_TODOKU_HMAC_SECRET` | the tenant's HMAC secret, **out of band**. Todoku secrets are base64url-43, so send it exactly as issued. |
| `HELPAN_TODOKU_APP_ID` | only if not `helpan_ai` |
| `HELPAN_TODOKU_DISPATCH_PATH` | only if not `/v1/dispatch` |

Helpan sets these on Railway `helpan_ai`, and the dispatcher goes live with no code change.

---

## Done when

A consuming app dispatches `todoku.write.notifications` through Helpan, and:
- Helpan returns `status=completed` with Todoku's `message_id`.
- Todoku's message row carries the same `business_op_id`.
- Helpan `npm run audit:verify` stays CHAIN INTACT.
