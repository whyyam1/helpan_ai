# Helpan AI → Klokd — Console Embed + Dispatch Receiver Fix v1

**From:** Helpan AI rail — build session
**To:** Klokd — engineering / Claude session (`octopus-api` + `worker-app`)
**Date:** 2026-10-27
**Re:** (A) embed the Helpan Console in the worker app; (B) a one-line HMAC fix on Klokd's dispatch receiver; (C) the two values Helpan needs to dispatch to Klokd
**Status:** 🟡 OPEN. Klokd is Helpan's first live consumer (`klokd` tenant active on the rail since 23 Jul).

---

## A. Embed the Helpan Console in `worker-app`

The Console is where a worker sees and revokes what their Klokd agent may do: shift sign-up, shift pay. **It's required before any authority is issued to a real user.** The behavioural-data friction screen and one-tap revoke are DPA-2019 consent obligations.

### Install

```
npm install github:whyyam1/helpan-console#v0.2.3
```

- Use **v0.2.3**. Its default `baseUrl` is the live rail host. v0.2.2 defaulted to `api.helpan.co.ke`, which has no DNS.
- Prebuilt, so there's no build step and no transitive dependencies. Peers are `react` ≥ 18 and `react-native` ≥ 0.74; worker-app's React 19.2 / RN 0.86 satisfies both. React 19 hasn't been exercised by the Console's test suite, so treat the first on-device run as the smoke test, and report anything odd back to Helpan.

### Mount

From a Settings or Profile entry, e.g. "Agent permissions":

```tsx
import { HelpanConsole } from '@kmv/helpan-console';

<Modal visible={open} animationType="slide" presentationStyle="fullScreen">
  <HelpanConsole
    customerToken={identitiCustomerToken}
    appId="klokd"
    theme={{ primary: '<Klokd brand>', accent: '<Klokd accent>', danger: '#8B1A1A' }}
    lang="en"                     // or 'sw'
    onClose={() => setOpen(false)}
    onAuthorityRevoked={(id) => refreshAgentState(id)}
  />
</Modal>
```

### Two Identiti requirements

1. The `customerToken` must be requested from Identiti with **`requested_audience=https://api.helpan.co.ke`**. That's the audience string, not a host. A token minted for Klokd's own audience is rejected with 401.
2. The **Grant** flow needs a step-up token: `operation_kind=helpan_ai.authority_issuance`, `operation_audience=helpan_authority_issuance`. The old `helpan.authorities.issue` returns `400 OPERATION_KIND_UNKNOWN`.

### Optional

Pass `subscribeConnectivity` with `@react-native-community/netinfo` to get the offline banner. worker-app doesn't depend on NetInfo today.

**Done when:** on a device, a sandbox worker opens the Console, sees an issued authority, revokes it, and Helpan `GET /v1/authorities/:id` shows `status=revoked`. Then do the manual VoiceOver and TalkBack pass (helpan-console `WCAG-AA-AUDIT.md`).

---

## B. Fix: dispatch receiver verifies HMAC over the wrong path

`octopus-api/src/core/agent/agent-dispatch.routes.ts` is mounted at `/api/v1/agents/dispatch` (`src/app.ts:47`), and builds the canonical string from **`req.path`**. Inside a mounted Express router, `req.path` is only the sub-path, `/klokd.write.shift_signup`.

Helpan signs the **full request path**, `/api/v1/agents/dispatch/klokd.write.shift_signup`, the same way every KMV HMAC does. So **every Helpan dispatch to Klokd fails Klokd's signature check with 401.**

Fix (line ~64):

```ts
// before
const canonical = ['POST', req.path, contentType, timestamp, bodyHash].join('\n');
// after — full path + query, as signed
const canonical = ['POST', req.originalUrl, contentType, timestamp, bodyHash].join('\n');
```

Everything else in that receiver already matches what Helpan sends:
- `Helpan-HMAC-SHA256 app_id=helpan_ai`
- `x-helpan-timestamp`
- Content-Type in the canonical string, base64 signature
- `{ operation, account_uuid, payload, business_op_id }` body
- Callback to `/validate`

Helpan added `klokd` as a dispatch target on 27 Oct (rail `3e20fee`, prod migration 0017).

**Suggested test:** sign a request with `@kmv/platform-shared/hmac` over the full path, post it to the mounted router, and expect it to pass verification.

---

## C. Values Helpan needs to dispatch to Klokd

The receiver verifies with **Klokd's own Helpan tenant secret** (`HELPAN_APP_SECRET`), so Helpan signs with that same value.

| Helpan env var (Railway `helpan_ai`) | Value |
|---|---|
| `HELPAN_KLOKD_URL` | `https://octopus-api-production.up.railway.app` |
| `HELPAN_KLOKD_HMAC_SECRET` | the value of Klokd's `HELPAN_APP_SECRET`. The operator copies it across, out of band. |

`HELPAN_KLOKD_DISPATCH_PATH` already defaults to `/api/v1/agents/dispatch/{operation}`, so there's nothing to set.

**Done when:** after B ships and C is set, a Helpan dispatch of `klokd.write.shift_signup` returns `status=completed` with Klokd's result, and Klokd's row carries the same `business_op_id`.
