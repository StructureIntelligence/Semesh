# auth-payments-minimal

The smallest Semesh paid app: a user signs in, reviews a live quote for one Model Unit Action, invokes that exact quoted request, and verifies settlement from its receipt. The logged-in user pays from their wallet; the app runtime key never reaches the browser.

> **Aev** is Semesh prepaid credit. Settlement uses non-negative int64 JSON-integer atoms: **1 Aev = 100000000 atoms**. Because JavaScript cannot exactly represent every int64, this template accepts only the safe-integer subset and fails closed instead of rounding. It does not assume a price, a funding path, or that a target contract has reached production.

## Quickstart

```bash
npm i -g semesh@latest
git clone <this repo>
cd templates/auth-payments-minimal
cp .env.example .env
semesh login
semesh search "DeepSeek chat" --json
semesh show <unit-id-from-search> --json
npm test
node server.js
```

Set `SEMESH_APP_API_KEY`, choose a public goal in `SEMESH_UNIT_QUERY`, select an Action ID actually advertised by its Unit detail, and set an explicit `SEMESH_BUDGET_CEILING_AEV_ATOMS`. Do not put a Unit ID, UnitActionRef, Catalog pin, catalog token, quote reference, provider, or binding in `.env`; the server obtains the current execution identity from live discovery.

Deployment authorization remains subject to the live deployment contract. `app_deployments.create` is an unavailable **Platform Action**, never a Service Unit, and currently returns `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. Run `semesh deploy preflight . --full-stack --json`; deploy only when a later live authorization permits it. An authorized deployment injects `SEMESH_APP_API_KEY` server-side.

## Exact paid journey

The template follows one canonical chain:

```text
anonymous GET /v1/service-units/search?q=...&scope=public
  -> anonymous token-pinned GET /v1/service-units/{unit_id}?scope=public
  -> authenticated POST /v1/service-units/{unit_id}/actions/{action_id}/quote
  -> authenticated POST /v1/service-units/{unit_id}/actions/{action_id}/invoke
  -> authenticated GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}
  -> authenticated GET /v1/invocations/{invocation_id}/receipt
  -> authenticated GET /v1/invocations/{invocation_id}/events when detail advertises events
```

Search must return exactly one Unit for the configured goal. Groups and Guides are navigation, not invocation targets. The server copies Search `meta.catalog_token` unchanged into `X-Semesh-Catalog-Token` for Unit detail, requires the same `meta.catalog_identity` and token in the detail response, and requires Detail `catalog` to equal the `{view_generation, view_digest}` projection of that identity. The digest and both UnitActionRef revisions must be exact lowercase `sha256:` plus 64 hex digits. That token is never read from an environment variable, never sent to quote/invoke, and never exposed to the browser. Every Semesh fetch is `no-store`.

The selected Action must publish one exact `unit_action_ref`, one `catalog` pin, `callable: true`, `availability: "available"`, and `effect.requires_confirmation: false`. Its input schema must exactly equal the closed draft-2020-12 chat schema: the only required property is `messages`, an array with at least one item; each item has only required `role` (enum `system`, `user`, or `assistant`) and nonempty `content: string`. The input itself contains only `messages`; `model_choice`, provider, and routing fields inside `input` fail closed.

The Action's nested `model_choices` supplies the separate execution choice. This template selects exactly one selectable, non-callable, Group-free entry whose `ref` is `{model_id:"deepseek-v3",model_revision:<advertised revision>}` and whose target binds that same ref to the exact enclosing UnitActionRef. The two-field ref becomes `model_choice_pin`; its revision is copied from Detail, never guessed from Search recall, configuration, a provider name, or an alternate name. A Search hint such as `matched_choice: "deepseek"` is recall only. DeepSeek is a choice inside the single Model Unit Action—not a Unit, provider, binding, or alternate execution identity.

The strict canonical output schema is an object with only required `message` and `usage`: `message` has only `role: "assistant"` and nonempty `content: string`, while `usage` has only a non-negative integer `total_tokens`; all three objects forbid additional properties. The app reads only canonical observation `result.message.content`; provider-shaped `choices`, top-level `content`, `completion`, or `output` alternatives never become output fallbacks.

The quote request contains:

```json
{
  "unit_action_ref": {
    "unit_id": "unit_models",
    "unit_revision": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "action_id": "chat",
    "action_revision": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  },
  "catalog": {"view_generation": 42, "view_digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"},
  "model_choice_pin": {"model_id": "deepseek-v3", "model_revision": "model.release.2026-09-02"},
  "input": {"messages": [{"role": "user", "content": "Say hello."}]},
  "budget": {"ceiling_aev_atoms": 500000000},
  "deadline": "<bounded ISO timestamp>"
}
```

The response must echo the exact UnitActionRef, Catalog, two-field `model_choice_pin`, messages input, budget, deadline, quote response `confirmation_required: false`, quote reference/receipt, and input/price/policy/effect digests. (`effect.requires_confirmation: false` is the distinct Unit Detail field.) Every `*_digest` pin is exact lowercase `sha256:` plus 64 hex digits. An exact price uses `amount_aev_atoms`; metered pricing must provide `ceiling_aev_atoms` with `capture_basis=actual_usage`. Atom values are JSON integers; strings, fractions, negatives, and unsafe integers above `Number.MAX_SAFE_INTEGER` fail closed. A representative floor is display-only and cannot authorize invoke.

`/api/quote` seals those server-validated fields into a principal-bound quote token and also returns the exact canonical invoke request:

```json
{
  "unit_action_ref": {
    "unit_id": "unit_models",
    "unit_revision": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "action_id": "chat",
    "action_revision": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  },
  "catalog": {"view_generation": 42, "view_digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"},
  "model_choice_pin": {"model_id": "deepseek-v3", "model_revision": "model.release.2026-09-02"},
  "quote_reference": "quote_...",
  "input": {"messages": [{"role": "user", "content": "Say hello."}]},
  "confirmed_effect_digest": null,
  "deadline": "<the same timestamp>"
}
```

Before sending `/api/action`, the browser persists that exact request, quote token, input, quote, principal binding, and `Idempotency-Key`. `/api/action` verifies the signature and byte-equivalent JSON projection, then sends the saved invoke request without running Search or quote again. A retry with no returned Invocation reuses the same bundle and key; it cannot drift to a new Catalog view, quote, deadline, or model choice.

## Authentication and identities

- Public Search and token-pinned public detail are anonymous: no runtime bearer, payer token, cookie, or ambient credential is sent.
- Quote, invoke, observation, receipt, and advertised event reads use the server-only runtime key and forward the signed-in user's token as `X-Semesh-Payer`.
- Browser recovery slots bind to `/__semesh/me` `user.sub`, or `user.id` only when `sub` is absent. The server compares that value with trusted `x-semesh-user-id` before any upstream call.
- `Idempotency-Key` identifies the exact replayable invoke request. `invocation_id` is returned by Semesh and identifies observation/receipt/event URLs. They are stored in separate fields, must differ, and are never substituted for each other.
- Once an `invocation_id` is known, the browser uses `/api/observe`, which performs read-only canonical GETs and never repeats the invoke POST.

Older browser recovery records lack the new exact quoted request. They remain untouched and quarantined for reconciliation; the app never migrates or executes them.

## Settlement and failure behavior

Only the validated terminal receipt is settlement authority. The receipt must bind the same Invocation, idempotency identity, UnitActionRef, Catalog, exact two-field `model_choice_pin`, quote reference, quote receipt, Invocation settlement reference, and exact lowercase SHA-256 input/price/policy/effect digests. Observation, receipt, and same-key replay must echo the same choice pin and settlement reference; alternate names or bare model strings are rejected. Its `held_aev_atoms`, `captured_aev_atoms`, and `released_aev_atoms` must be non-negative safe JSON integers, with capture plus release equal to hold without unsafe arithmetic. Successful fixed-price delivery captures the exact quoted atoms; definite non-delivery captures zero and releases the full hold.

Response headers and provider result fields are ordinary data and cannot prove a charge. A missing, malformed, drifted, or inconsistent receipt leaves settlement unknown and preserves the operation for reconciliation.

Search, detail, and quote are bounded and effect-zero. Any live 404, malformed envelope, missing token/pin, ambiguous Unit, unadvertised choice, quote drift, timeout, or availability defect stops before invoke. The template never tries another collection, public identity, price endpoint, alternate endpoint, or provider route. Retired protocol inputs may only fail effect-zero; they are not fallbacks.

**No price is assumed. Quote failure prevents invoke.**

Invoke has no client timeout. Once its request leaves the app, a transport or malformed response is unknown. The browser keeps the exact request and original key. If the server returned `invocation_id`, recovery observes that Invocation; otherwise replay uses the identical signed request and key.

## Tests

```bash
npm test
```

The hostile tests cover anonymous discovery/auth separation, Search-issued token pinning, exact closed messages schema, nested model-choice placement, input/choice separation, UnitActionRef/Catalog/choice quote-invoke parity, persistence before effect, request tampering, key/Invocation separation, GET-only recovery, strict canonical chat results, provider-shaped output rejection, receipt atom conservation, string/unsafe-above-2^53 atom rejection, malicious header/provider amounts, and 404/malformed no-fallback behavior.

The app uses only Node 18+ built-ins and has no runtime dependencies.

---
© StructureIntelligence Inc.
