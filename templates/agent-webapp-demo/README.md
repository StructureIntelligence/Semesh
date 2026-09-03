# Snippet Vault — an agent-built demo app on Semesh

A tiny full-stack web app—login, a managed database, and one paid Model Unit Action—that demonstrates canonical discovery, delegated-payer admission, replay safety, and receipt-authoritative settlement.

## Quickstart

```bash
npm i -g semesh
git clone <this repo>
semesh login
semesh deploy preflight . --full-stack --json
```

Preflight is read-only. Current source deployment closes with `deployment_authorization_unavailable`; the `app_deployments.create` Platform Action is currently unavailable and is not a deploy authority or fallback. When authorization is live and preflight allows it, the intended command is `semesh deploy . --full-stack --wait --json`; only a successful serving response or URL readback proves a live app.

For local development, copy `.env.example` to `.env.local`. Set the exact Unit and nested Action ids only after the live public catalog advertises them. Do not commit real keys.

## Paid polish contract

The route implements one closed journey:

1. `GET /v1/service-units/search?q=…&scope=public` anonymously with `cache: no-store` and `credentials: omit`.
2. Copy the bounded `meta.catalog_token` only into `X-Semesh-Catalog-Token` on the matching `GET /v1/service-units/{unit_id}?scope=public`. The token is never read from configuration, exposed to the browser, or sent to quote/invoke.
3. Select exactly one advertised Model Action, require `effect.requires_confirmation === false`, the exact draft-2020-12 chat schemas, and exactly one selectable, non-callable, Group-free `model_choices[]` entry whose exact two-field ref is `{model_id:"deepseek-v3",model_revision:<advertised opaque revision>}` and targets the chosen UnitActionRef exactly once. Preserve that advertised choice pin byte-for-byte beside the four-field `unit_action_ref` and Detail `catalog`. Detail must echo Search's token and Catalog identity.
4. Map the UI snippet to messages-only canonical input, authenticate the delegated payer, and request the effect-zero quote with `{unit_action_ref,catalog,model_choice_pin,input,budget,deadline}`; accept only a response that echoes `confirmation_required:false` and every exact pin/control.
5. Persist the returned `quote_reference`, the same action/catalog/choice pins, messages-only input, deadline, `confirmed_effect_digest:null`, and a separate stable `Idempotency-Key` in `sessionStorage` before the invoke POST.
6. Invoke with `{unit_action_ref,catalog,model_choice_pin,quote_reference,input,confirmed_effect_digest,deadline}`. An uncertain retry sends that exact persisted request and key; it never repeats Search or quote after preparation.
7. Persist the returned `invocation_id` separately. Use only that id for the nested observation endpoint and `/v1/invocations/{invocation_id}/receipt`.

Every canonical Search, Detail, quote, invoke, observation, and receipt payload must be an explicit `success:true` envelope; a bare `data` member is not authority. The terminal receipt is settlement authority only when it binds the same Invocation, replay key, settlement reference, Unit/Action/Catalog/model pins, quote reference and receipt, and four SHA-256 quote digests. Provider output, HTTP success, and response headers are hints at most and never upgrade settlement. The wire contract encodes Aev atoms as JSON integers; this JavaScript template accepts only non-negative `Number.isSafeInteger` values and fails closed on strings or values above `2^53 - 1`, so rounded numbers can never become settlement authority. Missing, malformed, invalid-UTF-8, or oversized canonical data fails closed; streamed bodies are canceled as soon as they exceed the bound. There is no legacy route or local polish fallback.

The template targets one configured Model Unit Action. It requires the exact draft-2020-12 messages schema and maps the UI snippet to `input.messages` as one system instruction followed by `{role:"user",content:<snippet>}`; input contains no model selector. The selected live Detail is the only source of the exact `deepseek-v3` `model_choice_pin`, including its opaque advertised revision, which remains a sibling of input through quote, invoke, observation, receipt, and replay. The only accepted successful result is `{message:{role:"assistant",content:nonempty string},usage:{total_tokens:integer>=0}}` under the exact closed output schema; `{text:...}`, provider `choices`, `output`, in-input `model_choice`, and other compatibility projections fail closed. DeepSeek is a choice inside the Model Unit, never a separate Unit or provider binding.

## What you get

- **Login** — Semesh OAuth through injected `/__semesh/*` routes.
- **Database** — managed SQLite. The server resolves the same-origin auth authority before every database operation, stores only a stable principal id, and never persists payer/session tokens.
- **Paid Action recovery** — an immutable quoted request is principal-bound and kept across reloads. Before an `invocation_id` exists, only the same byte-equivalent invoke request/key may be retried. After an id exists, observation and receipt use that id, never the key.
- **Effect-zero closure** — configuration gaps, catalog drift, an unavailable live rollout, schema mismatch, or quote rejection cannot call a provider or move money.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SEMESH_APP_API_KEY` | Server-side authorization for quote, invoke, observation, and receipt. |
| `SEMESH_POLISH_QUERY` | Natural-language public Search query. |
| `SEMESH_POLISH_UNIT_ID` | Exact live-discovered Unit id. |
| `SEMESH_POLISH_ACTION_ID` | Exact nested Action id from token-pinned Detail. |
| `SEMESH_POLISH_CEILING_AEV_ATOMS` | Positive decimal environment value serialized as a safe JSON-integer quote ceiling in Aev atoms. |
| `SEMESH_PROJECT_ID`, `SEMESH_PROJECT_SERVER_KEY` | Managed database credentials. |

## Code map

| Piece | Where |
| --- | --- |
| Auth, DB, canonical Unit journey | `lib/semesh.ts` |
| Receipt projection | `lib/settlement.mjs` |
| Immutable browser recovery record | `lib/polish-operation.mjs` |
| Snippet CRUD | `app/api/snippets/route.ts` |
| Paid polish prepare/invoke route | `app/api/polish/route.ts` |
| UI | `app/page.tsx` |
| Stack manifest | `semesh.json` |

The optional "Powered by Semesh" badge lives in `components/powered-by-semesh.tsx`.

---

© StructureIntelligence Inc.
