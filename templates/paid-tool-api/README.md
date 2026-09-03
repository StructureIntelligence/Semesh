# paid-tool-api

A payer-bound summarization API backed by one nested Action in Semesh’s single public Model Service
Unit. DeepSeek is a versioned `model_choice_pin` beside canonical input, never an input field, Unit,
Action, provider, or alternate execution identity.

This starter implements the target contract and requires live canonical readback. If a target route
currently returns `404`, non-JSON, incomplete identity, or a nonterminal/malformed receipt, it stops.
It never changes protocols or guesses another ID.

> 1 Aev = 100000000 Aev atoms. Wire atom values are JSON integers; this JavaScript starter accepts
> only non-negative `Number.isSafeInteger` values and rejects strings or unsafe rounded numbers.
> Funding and payouts remain Legal/provider-gated.

## Run and check deployment readiness

```sh
cp .env.example .env
npm test
npm start
npm i -g semesh
semesh login
semesh deploy preflight . --full-stack --json
```

`app_deployments.create` is the currently unavailable Platform Action for source deployment; it is
never a Service Unit or nested Unit Action. This target-state template shows only its read-only
preflight. A current `deployment_authorization_unavailable` result is an
effect-zero denial before upload/build/payment/publication, not a successful deployment or queue.

## Two-phase caller API

The app requires one stable replay key and persists the quote-derived invoke bytes before any effect:

```sh
# 1. Effect-zero preparation. Persist the response's `prepared` object exactly.
curl -X POST https://YOUR-APP.example/api/tool/quote \
  -H "Authorization: Bearer <caller-session>" \
  -H "Idempotency-Key: tool:<stable-request-key>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Long article...","style":"bullets"}'

# 2. Invoke with that unchanged object and the same key.
curl -X POST https://YOUR-APP.example/api/tool/invoke \
  -H "Authorization: Bearer <same-caller-session>" \
  -H "Idempotency-Key: tool:<same-stable-request-key>" \
  -H "Content-Type: application/json" \
  -d '{"style":"bullets","prepared":<exact-prepared-object>}'
```

`/api/tool/quote` performs anonymous public Search, anonymous token-pinned Unit detail, and an
authenticated payer-bound Action quote. It requires exactly one Model Unit result, one exact
detail-derived `UnitActionRef`, the detail’s exact two-key `catalog`, and an Action explicitly marked
callable, available, and `effect.requires_confirmation=false`. The Action schemas must require
an exact closed draft-2020-12 messages-only input: required `[messages]`, a non-empty array of closed
`[role,content]` objects, role enum `[system,user,assistant]`, and non-empty content. The Action’s
`model_choices[]` must contain exactly one configured selectable, non-callable, Group-free entry
whose `ref` is `{model_id:"deepseek-v3",model_revision:<advertised-revision>}` and whose `targets[]`
places that same ref under the selected `UnitActionRef`; the opaque revision is bounded to 512 UTF-8
bytes. Its output schema is the exact closed chat
schema: required `[message,usage]`; message required `[role,content]` with role
`{type:string,enum:[assistant]}` and non-empty string content; usage required `[total_tokens]` with
integer minimum zero; top/message/usage each use `additionalProperties:false`. Its quote body
carries the sibling exact `model_choice_pin`, messages-only canonical input, a safe-integer Aev-atom budget, and an RFC3339 deadline. The response must
echo the pins, controls, and exact input, bind it to `input_digest`, and supply exact quote evidence:
kind, authorization, reference/receipt, and lowercase SHA-256 input/price/policy/effect digests.

The returned `prepared.invoke_body` is the canonical upstream invoke body, already containing the
exact `unit_action_ref`, `catalog`, `quote_reference`, same input, `confirmed_effect_digest`, and
deadline, plus the same sibling `model_choice_pin`. `/api/tool/invoke` forwards those exact bytes,
and its response plus every observation must preserve the quote-bound `input_digest`. An uncertain
retry resends the same bytes and key only while no Invocation ID is known. After an ID is known,
`/api/tool/observe` performs only the nested observation and global receipt GETs.

After invoke, the server reads the returned top-level `invocation_id`, observes that exact Invocation,
then gets `/v1/invocations/{invocation_id}/receipt`. The replay key is request identity;
`invocation_id` is observation identity, and the two must not be equal. Same-key, byte-identical replay
must return the same Invocation, result, receipt, and settlement reference with no extra effect,
capture, or owner grant. Quote, invoke response, observation, terminal receipt, returned app result,
and replay must all bind the same `model_choice_pin`; the strict nested Action `result` stays the
advertised `message` plus `usage` object and never carries an injected choice field.

## Settlement truth

Only conserved atoms in the terminal canonical receipt establish money state:

```text
held_aev_atoms = captured_aev_atoms + released_aev_atoms
```

The receipt uses top-level terminal state, safe-integer atom fields, request key, Invocation ID,
UnitActionRef, Catalog, exact model choice pin, quote/settlement references, and all four quote digests. Held
atoms must equal the quote authorization. A successful exact-price delivery has a terminal receipt
that captures the exact amount; a definite failure captures zero and fully releases the hold. Only canonical
`result.message.content` plus validated usage is read; a provider-shaped result, HTTP status,
response header, balance delta, or fields named `cost`, `amount`, or `charged` are not settlement
authority.

Set the maximum admitted quote through `SEMESH_BUDGET_CEILING_AEV_ATOMS`, and change markup in
`semesh.json`. Do not build a second wallet or ledger. The footer in `public/index.html` is optional.

---

© StructureIntelligence Inc.
