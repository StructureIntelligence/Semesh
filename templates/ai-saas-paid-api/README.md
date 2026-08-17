# ai-saas-paid-api

A pay-per-use AI app where **your end users pay for each AI call** — you write no billing code.

The signed-in user runs an AI call (an LLM text generation) and is charged for *that call* against
**their own** Aev balance, not yours. This is the Semesh end-user-pays model (the `X-Semesh-Payer`
header): the app authenticates with its own runtime key and forwards the logged-in user's session so the
platform bills the user. Semesh is the intended launch layer for agent-built apps (a product of
StructureIntelligence Inc.); this template describes the runtime contract once deployment authorization is available.

> **Aev** is Semesh prepaid credit (1 USD = 100 Aev). Card funding is offered only when the live
> server reports its Legal/provider gates available; this template does not assume live funding.

## Quickstart

```sh
npm i -g semesh
git clone <this repo>
semesh login
semesh tool show app_deployments.create --json
semesh deploy preflight . --full-stack --json
```

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. When authorization becomes available and both checks allow it, the intended command is `semesh deploy . --full-stack --wait --json`; only a successful serving response or URL readback proves a live app.

## What you get

- **Login** — Semesh OAuth, zero auth code. The platform gate at `/__semesh/login` signs users in;
  this app just reads the session.
- **Usage billing (end-user-pays)** — every AI call is charged to the *signed-in user's* Aev wallet via
  the `X-Semesh-Payer` header. You never bill yourself for a user's action. The markup you earn on top of
  upstream cost is declared once in `semesh.json` (`stack.billing.markup`, e.g. `1.3`); the platform
  validates and applies it (markup must be in `1.0`–`1.5`).
- **Payments** — when a user is out of Aev, the call returns `402`. The UI offers a funding link only
  when that live response includes one; otherwise it reports funding unavailable instead of bypassing
  Legal/provider gates.
- **Managed database** *(optional)* — Semesh provisions one if your app needs it. This minimal
  template keeps no server-side state, so it doesn't use one — add it when you need to store history.

### How it works (one paragraph)

The browser talks **only** to this app's own `/api/*` routes and never sees any secret. `server.js`
extracts the user's delegated-payer token from their session (`__semesh_session` cookie, set by the
login gate), then calls `POST /v1/capabilities/{id}/invoke` with the app's runtime key in the
`Authorization` header and the user's token in `X-Semesh-Payer`. That one header is what charges the
**user** instead of you.

### Customize

- **Swap the AI capability** — set `SEMESH_CAPABILITY_ID` (or edit the constant in `server.js`) and
  adjust the `input` body to match. Confirm the capability id and its exact request body against the
  agent guide: <https://semesh.io/agent.md>. There is a clearly-marked `TODO(confirm against agent.md)`
  at that line — do not guess the body.
- **Change your markup** — edit `stack.billing.markup` in `semesh.json` (allowed range `1.0`–`1.5`).
- **Change the displayed estimate** — set `PRICE_ESTIMATE_AEV` (UI hint only). The template calls an
  amount captured only when the explicit platform `x-semesh-charged-aev` post-capture header is present;
  missing/unknown evidence keeps the same operation identity for reconciliation.

## Badge

The page shows a small "Powered by Semesh" badge. It's **optional** — delete the clearly-commented
`<footer class="powered-by">` block in `public/index.html` to remove it. Nothing else depends on it.

---

© StructureIntelligence Inc.
