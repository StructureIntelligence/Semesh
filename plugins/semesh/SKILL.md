---
name: semesh
description: Discover Semesh Service Units and Actions, and prepare or observe app deployments. Production deployment authorization is currently unavailable, so new source deploys fail closed; use availability, preflight, and existing-resource readbacks without claiming a new live URL.
---

# Semesh — Service Unit Actions and deployment readiness

Semesh is a Service Unit layer with an intended app runtime contract for login, managed data, and usage billing. Production deployment authorization is currently unavailable: `app_deployments.create` is disabled, and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or creation of a live URL. Existing app records remain observable, but observing one does not authorize a new release.

## Setup (once)

1. `npm install -g semesh@latest`.
2. Start with `semesh search "<task>"` to discover the public catalog. Run `semesh login` (a human approves once in the browser) — or set `SEMESH_API_KEY=YOUR_API_KEY` for headless/CI — only when the selected action needs an account.
3. The full agent contract lives at `https://semesh.io/agent.md` — fetch it for the complete recipe set, then `semesh recipes` for the shortest path to any task.

**No card flow is needed to discover:** `scope=public` Search and Detail are anonymous and read-only. Authenticate before `scope=accessible`, every Action quote/invoke, or private state. If available Aev is insufficient while card top-up is contained, stop and report that the paid Action cannot proceed in this profile.

## Core rule

Semesh is a searchable Service Unit layer. Do not memorize provider-specific endpoints. **Search → Unit detail → Action quote → Action invoke → Invocation/receipt.** The official canonical Service Unit search path is `GET /v1/service-units/search?q={query}&scope={public|accessible|owned}`. The supported non-canonical read-only compatibility aliases are `GET /v1/services/search`, `GET /v1/units/{id...}`, and `GET /v1/groups/{id}`; each calls the same canonical handler and returns byte-identical `data`, with no independent catalog or execution authority. New clients must use the canonical routes. Send the bounded `meta.catalog_token` as `X-Semesh-Catalog-Token` only on the exact advertised Guide, Group, or Unit GET; never send it to quote, invoke, or another origin. `scope=public` Search/Detail is anonymous; `scope=accessible` and `scope=owned` are authenticated actor-specific states and must not enter a shared cache. The official canonical Service Unit action paths are `POST /v1/service-units/{unit_id}/actions/{action_id}/quote`, `POST /v1/service-units/{unit_id}/actions/{action_id}/invoke`, and `GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}`. The official canonical Invocation read paths are `GET /v1/invocations/{invocation_id}/receipt` and `GET /v1/invocations/{invocation_id}/events`. A canonical Service Unit Action quote is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call. Authenticate before every canonical Service Unit Action quote or invoke; Search and Detail with `scope=public` remain anonymous, while `scope=accessible` and `scope=owned` require authentication. A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Semesh publishes one public Model Service Unit; DeepSeek is a versioned model choice advertised in `actions[].model_choices`, not a Unit, separate domain, Group, Action, or provider. Search may report `matched_choice=deepseek`, but quote, invoke, result, receipt, and same-key replay must pin the same exact `UnitActionRef` and two-field `model_choice_pin`; that pin is a quote/invoke sibling of `input`, never an input member. A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants. Retired legacy execution identities and resource-specific execution routes return only effect-zero `410 legacy_protocol_retired`; they never proxy, translate, execute, call a provider, or move money. Passing mechanical protocol checks publish and become discoverable automatically; there is no default human approval queue. For source deployment, that target policy applies only after deployment authorization is available; it does not turn today's denial into a queue or a success. Aev is the platform accounting unit. Card top-up is contained and Legal remains unverified; do not claim card funding is available.

## Check deployment readiness

```bash
semesh deploy preflight ./my-app --full-stack --json
```

Deployment is a Platform Action, not a Service Unit. Read the current agent guide or deploy help, then inspect preflight's `admission.can_start_now`, `code`, `message`, and `fix`. Current production reports `app_deployments.create` as `deployment_authorization_unavailable`; stop without running the deploy mutation. Preflight uploads no source and creates no app, build, hold, publication, or URL.

For ids that already exist, observe and recover with `semesh deploy status <app-id> --json`, `semesh deploy logs <build-id> --json`, and `semesh deploy url <app-id> --json`. Existing status or URL readback is not evidence that a new release can start.

When deployment authorization becomes available and preflight allows the operation, the intended owner command is `semesh deploy ./my-app --name my-app --full-stack --wait --json`. Report a live URL only from a successful serving response or URL readback; never construct one.

## Charge end users (end-user-pays)

An already serving app with an available delegated-payer rail can charge the signed-in end user's own Aev balance instead of the developer's by attaching the `X-Semesh-Payer` header. Quote the exact selected Unit Action before spend and read its terminal Invocation receipt. Only a definite terminal failed Action proves release; timeout, pending, or unknown settlement stays with the same `invocation_id` and recovery owner.

## Use any Service Unit Action

```bash
semesh search "<task>" --json
semesh show <unit-id> --json
semesh quote <unit-id> --action <action-id> --input '<json>' --json
semesh call <unit-id> --action <action-id> --from-quote <quote-file> --input '<same-json>' --idempotency-key <stable-key> --wait --json
```

Add `--confirm` to the invoke only when the confirmation boundary above applies.

Billing unit: **Aev** (1 USD = 100 Aev accounting conversion). Check available Aev with `semesh credits balance --json`; do not offer card top-up while its release gate is contained.

## MCP

This plugin also registers the `semesh` MCP server (`npx -y semesh mcp`), so the same Service Unit catalog and nested Actions are available through one canonical execution contract. It authenticates with your `semesh login` session or `SEMESH_API_KEY`.
