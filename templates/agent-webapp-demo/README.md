# Snippet Vault — an agent-built demo app on Semesh

A tiny full-stack web app — login, a managed database, and one paid AI action — that demonstrates delegated-payer admission without inventing its own settlement truth.

## Quickstart

```bash
npm i -g semesh
git clone <this repo>
semesh login
semesh tool show app_deployments.create --json
semesh deploy preflight . --full-stack --json
```

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. Preflight is read-only. When authorization becomes available and both checks allow it, the intended command is `semesh deploy . --full-stack --wait --json`; only a successful serving response or URL readback proves a live app.

## What you get

- **Login** — Semesh OAuth. Sign-in / sign-out work out of the box via the
  injected `/__semesh/*` routes. You write no auth code.
- **Database** — a managed SQLite project. Before any read, table creation, or
  write, the server resolves the browser session through the platform's
  same-origin `/__semesh/me` authority. Rows store only the stable, non-sensitive
  principal id; raw payer/session tokens are never persisted, and an unavailable
  identity authority fails closed rather than falling back to shared anonymous rows.
- **Usage billing** — the "Polish with AI" button requires a signed-in payer,
  forwards `X-Semesh-Payer`, and never falls back to the app-owner wallet. One
  immutable input and `Idempotency-Key` identify the logical operation across
  retries. Provider output is preserved when settlement is unknown; only the
  platform `x-semesh-charged-aev` header is rendered as captured money.
- **Recovery** — an uncertain result remains in `sessionStorage`, bound to the
  same principal, input, and operation key. **Retry same operation** replays that
  exact tuple; a fresh key is never created for an unknown outcome.
- **Payments** — users pay from their prepaid **Aev** balance. *Aev is Semesh
  prepaid credit (1 USD = 100 Aev); funding options remain live availability- and
  Legal-gated rather than being assumed by this template.*

## How it fits together

| Piece | Where |
| --- | --- |
| Auth helpers + DB query + capability call | `lib/semesh.ts` |
| Snippet CRUD (managed DB) | `app/api/snippets/route.ts` |
| Metered "polish" capability | `app/api/polish/route.ts` |
| UI | `app/page.tsx` |
| Manifest (`framework`, auth, database, runtime_api) | `semesh.json` |

After a successful authorized deployment, real keys are injected by the platform; for local dev copy `.env.example`
to `.env.local`. Never commit real values.

> **Note:** the "Powered by Semesh" badge
> (`components/powered-by-semesh.tsx`) is optional — delete that file and its
> import in `app/page.tsx` to remove it.

---

© StructureIntelligence Inc.
