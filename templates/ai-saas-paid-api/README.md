# ai-saas-paid-api

A pay-per-use AI app in which the signed-in caller pays for a model Action from their own Aev
balance. The browser never receives the app runtime key.

This template follows the target Service Unit contract. Current production may not have every target
route rolled out: a `404`, malformed response, Catalog drift, or missing receipt stops the flow. There
is no alternate execution route.

> 1 Aev is 100000000 Aev atoms. Funding remains Legal/provider-gated and this template does not
> treat card funding as available unless a verified live gate explicitly allows it.

## Local setup and deployment readiness

```sh
cp .env.example .env
npm test
npm start
npm i -g semesh
semesh login
semesh deploy preflight . --full-stack --json
```

`app_deployments.create` is the currently unavailable Platform Action for source deployment; it is
never a Service Unit or nested Unit Action. The read-only preflight is the only deployment command
shown by this target-state starter. Today it may report
`deployment_authorization_unavailable`; that is a denial before upload, build, payment, publication,
or a live URL, not a queue or a successful deployment.

## Canonical call flow

For each new logical request, `server.js` performs:

1. Anonymous `GET /v1/service-units/search?q=DeepSeek+text+generation&scope=public`.
2. Anonymous `GET /v1/service-units/{unit_id}?scope=public`, forwarding the bounded Search
   `meta.catalog_token` as `X-Semesh-Catalog-Token` and requiring the same Catalog identity.
3. Selection of exactly one Search `data[]` result with top-level `kind=unit` and `id`. Detail must
   echo that top-level `id`, `kind=unit`, and the pinned Catalog, and advertise exactly one Action
   whose `callable=true`, `availability=available`, and `effect.requires_confirmation=false`.
   Its draft-2020-12 input schema is exact and closed: the top object requires only `messages`; the
   non-empty `messages` array contains closed objects requiring only `role` and non-empty `content`,
   with role enum `[system,user,assistant]`. Model selection is not input. The Action must instead
   advertise exactly one configured choice in `model_choices[]`: a selectable, non-callable,
   Group-free entry whose exact `ref` is
   `{model_id:"deepseek-v3",model_revision:<advertised-revision>}` and whose `targets[]` places that
   same ref under the selected `UnitActionRef`. The opaque revision is bounded to 512 UTF-8 bytes.
   Its output schema is also exact and closed: the top
   object requires only `message` and `usage`; `message` requires only `role` and `content`, with role schema
   `{type:string, enum:[assistant]}` and content schema `{type:string, minLength:1}`; `usage`
   requires only `total_tokens` with `{type:integer, minimum:0}`. All three objects set
   `additionalProperties:false`. DeepSeek is not a Unit, Action, provider, or execution identity.
4. An authenticated, payer-bound, effect-zero
   `POST /v1/service-units/{unit_id}/actions/{action_id}/quote` with the detail-derived exact
   `unit_action_ref`, exact two-field `catalog`, sibling `model_choice_pin`, messages-only canonical
   input, safe-integer Aev-atom budget, and RFC3339 deadline. The response must echo that exact input,
   bind it to `input_digest`, and preserve the same controls plus its exact/hold-ceiling atom
   authorization, quote reference/receipt, and lowercase SHA-256 input/price/policy/effect digests.
5. Before any effect-capable POST, the browser stores one stable `Idempotency-Key`, the exact quote
   evidence, and the quote-derived canonical invoke body as exact JSON bytes. That body contains
   only `unit_action_ref`, `catalog`, the same `model_choice_pin`, `quote_reference`, the same input,
   `confirmed_effect_digest`, and the same deadline.
6. Authenticated, payer-bound invoke using those saved bytes. Its response and every observation
   must preserve the quote-bound `input_digest`. Once an `invocation_id` is known, recovery uses the
   local `/api/observe` endpoint, which performs only canonical upstream GETs through
   `/v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}` and
   `/v1/invocations/{invocation_id}/receipt`.

The quote, invoke response, observation, terminal receipt, returned app result, and same-key replay
must all bind the same exact `model_choice_pin`. The strict nested Action `result` remains only the
advertised `message` and `usage` object; the pin is sibling operation evidence, never injected into it.

`/api/quote` performs steps 1–4 and returns the prepared invoke bytes without causing a provider or
money effect. `/api/invoke` accepts only that prepared bundle. If the outcome is uncertain before an
Invocation ID is returned, the UI keeps the exact bundle and key; **Retry exact request** resends
byte-identical invoke bytes without Search or quote. After an ID is known, **Observe same
invocation** calls `/api/observe`; the server performs no further upstream POST.

The `Idempotency-Key` is the replay/request identity. The returned `invocation_id` is the observation
identity; they must be distinct. A same-key, byte-identical replay must return the same Invocation,
result, receipt, and settlement reference without another provider effect, capture, or owner grant.

## Settlement truth

Only the terminal canonical receipt is money authority. Atom fields are non-negative JSON integers
that must satisfy `Number.isSafeInteger`; strings and rounded/unsafe numbers are rejected. The
receipt’s top-level `held_aev_atoms`, `captured_aev_atoms`, and `released_aev_atoms` must conserve the
exact quote authorization. Its top-level replay key, Invocation ID, terminal state, UnitActionRef,
Catalog, exact model choice pin, quote/settlement references, and input/price/policy/effect digests must all
match the saved quote/invoke/observation chain. A successful exact-price delivery has a terminal
receipt that captures exactly its authorization; a definite failure captures zero and fully releases
it. Provider payload fields,
HTTP status, response headers, and balance deltas cannot prove capture or release.

## Customize

- Change the prompt UI in `public/index.html` and `public/app.js`.
- Set a different exact Action or model ID only after the pinned Unit detail advertises one exact
  revision and placement; never guess or configure the revision independently.
- Set `SEMESH_BUDGET_CEILING_AEV_ATOMS` to the largest quote you intend to admit.
- Set the app markup in `semesh.json`; do not implement a second wallet or ledger.

The “Powered by Semesh” footer is optional and can be removed from `public/index.html`.

---

© StructureIntelligence Inc.
