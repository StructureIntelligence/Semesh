# auth-payments-minimal

The "hello world" of paid apps — login plus one paid action, billed straight to the logged-in user's wallet. **Charge your users per use, with no billing code:** Semesh handles OAuth login, the wallet, metering, and the end-user charge. You write the action.

> **Aev** is Semesh prepaid credit: **1 USD = 100 Aev**. Card funding is offered only when the live
> server reports its Legal/provider gates available; this template does not assume live funding.

## Quickstart

```bash
npm i -g semesh
git clone <this repo>
semesh login
semesh tool show app_deployments.create --json
semesh deploy preflight . --full-stack --json
```

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. When authorization becomes available and both checks allow it, the intended command is `semesh deploy . --full-stack --wait --json`; a successful authorized deployment injects `SEMESH_APP_API_KEY` server-side so the runtime key never touches the browser.

## What you get

- **Login** — Semesh OAuth at `/__semesh/login`. `auth.mode: lazy` lets anyone see the page;
  the paid action requires sign-in. The browser resolves the stable principal from same-origin
  `/__semesh/me` (`user.sub`, or `user.id` only when `sub` is absent). It never binds recovery to a
  session token or token hash.
- **Usage billing** — the one paid action calls a metered capability via
  `POST /v1/capabilities/{id}/invoke`. The user's session is forwarded as the `X-Semesh-Payer`
  header, so the **logged-in user's** Aev wallet is charged — not yours. Configure the markup in
  `semesh.json` (`billing.markup`).
- **Payments** — the only price authority is a read-only live `POST /v1/billing/quote` for the
  exact same input that will be invoked. The browser posts its pending input snapshot to the local
  `/api/quote` adapter; `/api/action` quotes that same stored object again immediately before invoke.
  **No price is assumed:** there is no static or hardcoded
  amount fallback. **Quote failure prevents invoke** — transport, backend, provider, availability,
  or contract failures are projected as a machine-readable
  `{code,message,fix,retryable,trace_id?}` object and the paid action does not run. The UI renders
  `quote_kind` truthfully (`exact` vs `representative_floor` vs `hold_ceiling`) and never labels a
  floor or hold ceiling as a final capture charge. Captured money afterward is shown only from the
  explicit platform `x-semesh-charged-aev` header; an HTTP/network failure or missing capture
  evidence remains unknown and keeps the same operation identity for reconciliation. This minimal
  template does not fabricate a funding path; add one only when the live server reports its
  Legal/provider gates available and returns the path.
- **Account-bound recovery** — pending operations live in separate `sessionStorage` slots per
  validated principal and carry that non-secret principal binding. Immediately before an action,
  the browser resolves `/__semesh/me` again. The server compares the binding with the trusted
  `x-semesh-user-id` injected by the Semesh auth edge (which strips client spoofing) before any
  quote or invoke. Missing, invalid, or mismatched identity fails pre-effect. A legacy unbound v1
  record remains quarantined as reconciliation evidence and is never replayed or silently migrated.
- **Bounded quote waiting** — read-only quote calls use `AbortController` and return retryable
  `quote_timeout` / `quote_ui_timeout` machine errors. The default server quote timeout is 15 seconds
  and may be set from 100–60000 ms with `SEMESH_QUOTE_TIMEOUT_MS`; the browser waits 20 seconds
  so it normally receives that canonical server error instead of masking it. The capability invoke
  does not inherit either timeout: once a paid effect may have started, the original input and
  `Idempotency-Key` remain available for replay/reconciliation instead of manufacturing a fresh try.

The whole loop lives in `server.js` (`/api/action`) and `public/` (a single page). No npm install —
pure Node 18+ builtins, zero dependencies.

The principal comparison assumes the app is reached through the Semesh auth edge. Do not expose
`/api/quote` or `/api/action` through a side door that bypasses the edge: direct requests have no
trusted `x-semesh-user-id` and intentionally fail closed. Local tests inject the trusted header only
to exercise this boundary; production application code must not manufacture it.

```bash
npm test
```

## Make it yours

Open `server.js` and set `CAPABILITY_ID` to the capability you want to bill for, then shape the
request `input` to match it. The capability catalogue and exact request bodies are in the agent
guide at <https://semesh.io/agent.md>. (There's a `TODO(you)` marker at the spot to edit.)

## The badge is optional

A small "Powered by Semesh" badge sits in `public/index.html`. It's yours to keep or remove —
delete that clearly-commented footer block to take it out.

---
© StructureIntelligence Inc.
