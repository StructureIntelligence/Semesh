# paid-tool-api

Sell one API endpoint, metered per call — **admit user-paid calls without building a second billing system.** Semesh handles login and the authoritative wallet/ledger workflow; your endpoint only reports captured money when the platform returns explicit post-capture evidence.

This starter exposes a single paid endpoint (`POST /api/tool`, a text summarizer) that delegates payment to the **logged-in caller's** Semesh wallet. A useful provider result is not itself proof of capture: the response stays `settlement_status: "unknown"` unless the platform returns its trusted `x-semesh-charged-aev` header.

> **Aev** is Semesh prepaid credit: **1 USD = 100 Aev**. Funding options are shown only when the live platform reports them available; this template does not assume card/Legal/provider availability.

## Quickstart

```bash
npm i -g semesh
git clone <this repo>
semesh login
semesh tool show app_deployments.create --json
semesh deploy preflight . --full-stack --json
```

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. When authorization becomes available and both checks allow it, the intended command is `semesh deploy . --full-stack --wait --json`; a successful authorized deployment injects the app runtime key and base URL.

## How a caller hits the paid endpoint

1. The caller signs in once at `/__semesh/login` (the platform auth gate; sets a durable `__semesh_session` cookie).
2. They POST to your endpoint. The payer session requests admission against **their** Aev wallet — not yours:

```bash
curl -X POST https://YOUR-APP.run.semesh.io/api/tool \
  -H "Authorization: Bearer <your-semesh-session-token>" \
  -H "Idempotency-Key: tool:<one-stable-operation-id>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Long article here...","style":"bullets"}'
```

```json
{ "ok": true, "summary": "...", "style": "bullets", "captured_aev": 6, "settlement_status": "captured", "idempotency_key": "tool:...", "currency": "aev" }
```

The deployed app also serves a small docs/landing page (`public/index.html`) with a "try it" box.

## What you get

- **Login** — Semesh OAuth, zero auth code. The auth gate (`/__semesh/login`) handles sign-in and sets the payer session.
- **Usage billing** — `/api/tool` forwards the logged-in user's delegated payer session and one stable idempotency key. Your margin is the `billing.markup` field in `semesh.json` (default `1.3`).
- **Settlement truth** — only the explicit platform `x-semesh-charged-aev` post-capture header is rendered as captured, including on a non-2xx response. Missing evidence remains `unknown`; use **Retry same operation** to resend the exact same input and `Idempotency-Key`, or inspect that operation's platform record. Never invent a fresh key for an uncertain outcome.
- **Funding and payouts** — availability remains platform- and Legal-gated. Do not claim a card funding or payout path until the live response says it is available.

### How the billing wiring works (so you can change the tool safely)

`server.js` authenticates to Semesh with the injected `SEMESH_APP_API_KEY`, forwards the caller's session as `X-Semesh-Payer`, and forwards a stable `Idempotency-Key`. If the payer is missing, the route returns `401` rather than falling back to the developer wallet. Keep that wiring and replace only the tool's input/prompt. Provider body fields such as `cost`, `amount`, or `charged` are untrusted capability output and must never be treated as settlement evidence.

## Make it yours

- Edit the body of `POST /api/tool` in `server.js`.
- To resell a different Semesh capability or cloud-worker offer, change `CAPABILITY` (env `TOOL_CAPABILITY_ID`) and set the invoke **input** to that capability's documented schema — see https://semesh.io/agent.md. Don't guess the request body.
- Tune your margin via `stack.billing.markup` in `semesh.json`.

## The badge is optional

`public/index.html` ends with a small, clearly-commented "Powered by Semesh" footer. It's in your code — delete that `<footer>` block to remove it.

---

© StructureIntelligence Inc.
