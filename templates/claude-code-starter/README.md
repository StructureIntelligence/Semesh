# Claude Code Starter

The simplest Semesh deployment-contract starter: a tiny Next.js app prepared
for Semesh OAuth login and a managed database.

**The differentiator:** Semesh is the launch layer for agent-built apps. You get
login, a database, usage metering, and end-user payments without writing billing
code — charge your users per use, and Semesh handles the money.

> **Aev** is Semesh prepaid credit (1 USD = 100 Aev). Funding remains Legal/provider-gated and must not be assumed available.

## Quickstart

```
npm i -g semesh
git clone <this repo>
semesh login
semesh deploy preflight . --full-stack --json
```

`app_deployments.create` is the currently unavailable Platform Action for source deployment; it is
never a Service Unit or nested Unit Action. This starter shows only its read-only preflight.
Production deployment authorization is currently unavailable: preflight can
return `deployment_authorization_unavailable` before upload, build, payment, publication, or a live
URL. Treat that as an effect-zero denial, not a queue or successful deployment.

## What you get

- **Login** — Semesh OAuth in lazy mode. Sign-in only fires when the user clicks;
  the edge serves `/__semesh/login`, `/__semesh/logout`, and `/__semesh/me` for you.
- **Database** — a managed database is provisioned from `semesh.json`. Credentials
  are injected at runtime; see `app/api/hello/route.ts` for a query example.
- **Usage billing & payments** — when you add a canonical metered Service Unit Action, first use
  anonymous Search and token-pinned Unit detail, then authenticated quote/invoke, and finally the
  returned `invocation_id` and terminal receipt. Persist the exact quote-derived invoke request plus
  its stable `Idempotency-Key` before the effect-capable POST; uncertain retries must be byte-identical
  and must not rediscover or re-quote. A Model Action input schema must be the exact closed
  draft-2020-12 messages-only schema: required non-empty `messages`, with closed
  `[role,content]` items, role enum `[system,user,assistant]`, and non-empty content. Select
  `deepseek-v3` only from the Action’s `model_choices[]`: require one selectable, non-callable,
  Group-free entry with exact `ref={model_id:"deepseek-v3",model_revision:<advertised-revision>}`
  and a `targets[]` placement binding that ref to the selected `UnitActionRef`; send the same exact
  `model_choice_pin` beside (never inside) `input` in quote and invoke. Read only the exact
  draft-2020-12 chat output schema: top-level required `[message,usage]`; message required
  `[role,content]`, role `{type:string,enum:[assistant]}`, content `{type:string,minLength:1}`; usage
  required `[total_tokens]` with integer minimum zero; and `additionalProperties:false` on the top,
  message, and usage objects. Read `result.message.content` only after validating that schema and
  canonical usage; reject `{text}` and provider-shaped fallbacks. This starter itself ships only
  login + DB. Quote, invoke response, observation, terminal receipt, app result, and exact replay
  must bind the same choice pin; the nested Action `result` itself remains only `message` + `usage`.

## The badge

`components/powered-by-semesh.tsx` renders a small "Powered by Semesh" badge.
It is **optional** — delete that file and its import in `app/page.tsx` to remove it.

---

© StructureIntelligence Inc.
