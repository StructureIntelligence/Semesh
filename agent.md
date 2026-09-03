# Semesh Agent Quickstart

Read this before using Semesh from Codex, Cursor, Claude Code, CI, or another agent runtime.

> **Step 0 — discover before auth.** After installing (`npm install -g semesh@latest`), use anonymous `semesh search` / `show` and other public read-only GET surfaces first — they work without login so you can learn the catalog and contracts. Login (`semesh login`) or `SEMESH_API_KEY` is required before every canonical Service Unit Action quote or invoke, deploy/publish, or user-private state. There is no manual approval queue for ordinary discovery or mechanical publish. A human approves login once in the browser and the session is reused. After login the CLI prints a short list of what Semesh can do — or run `semesh recipes` any time.

## First Time: Localize This Guide (do this once)

If you are an agent reading this for the first time:

1. Save this file into the project as `agent.md` — run `semesh agent-md --save`, or fetch `https://api.semesh.net/agent.md` (the same `api.` host you call at runtime). `--save` writes `./agent.md` unconditionally and overwrites any existing file at that path with no prompt and no backup: if the project already has its own `agent.md`, copy it aside first, or fetch the URL and write it somewhere else yourself.
2. Create a skill / rule in your runtime that says: **"For any Semesh task, read `./agent.md` first."** (Claude Code: a skill; Cursor: a rule; Codex/CI: a line in your project instructions.)
3. Discover first: anonymous `semesh search` / `show` (and other public read-only GET surfaces) work without login — use them before authenticating.
4. Authenticate only when a selected Unit Action contract needs auth: run `semesh login` (or set `SEMESH_API_KEY`) for every canonical Action quote or invoke, deploy/publish, or user-private state — a human approves in the browser; the CLI reuses the stored session.
5. Print the shortest reliable path for any task with `semesh recipes`.

From then on every Semesh task starts from your local `agent.md` — discover anonymously when you can, authenticate when the contract requires it — no re-deriving how the platform works.

## Core Rule

Semesh is a searchable Service Unit layer. Do not memorize provider-specific endpoints. Search first, inspect the Unit and its nested Action contract, quote the exact paid Action, then invoke it from that quote. A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Ordinary paid calls settle applicable Aev automatically, and a passing mechanical publish does not enter a human review, payment, or release queue. A user's first request like "delete X" is intent, not confirmation. Do not add `--confirm` / `?confirm=true` for destructive actions until a separate human confirmation turn names the exact resource and effect. First identify the target, show what would happen, and stop. If the target is missing or already absent, report that result without using `--confirm`. **Exception fixed by Frame/use/friend:** `friend remove/block` and `group remove/leave` are reversible coordination, so an authenticated direct request is sufficient and must not be interrupted by a second confirmation.

**Catalog shape.** Search may return Guides, Groups, and Service Units. Guides are informational and Groups are navigation only; neither is callable. Send the bounded `meta.catalog_token` as `X-Semesh-Catalog-Token` only on the exact advertised Guide, Group, or Unit GET; never send it to quote, invoke, or another origin. Select a nested Unit Action and invoke its exact `UnitActionRef`, never a Guide or Group id. Semesh publishes one public Model Service Unit; DeepSeek is a versioned choice advertised in an Action's `model_choices`, not a Unit, separate domain, Group, Action, or provider. This closure selects the exact choice ref whose `model_id` is `deepseek-v3` inside the Model Unit's chat Action. Search may report `matched_choice=deepseek`, but quote, invoke, result, receipt, and same-key replay must pin the same exact `UnitActionRef` and `{model_id,model_revision}` `model_choice_pin`. Provider/runtime bindings remain hidden below the pinned Unit Action and choice.

For that selected chat Action, require the exact advertised closed input schema: only required `messages`, a nonempty array whose closed items contain required `role` (enum `system`, `user`, or `assistant`) and nonempty `content`. Select `deepseek-v3` from the Action's advertised `model_choices`, then repeat its exact two-field ref as the `model_choice_pin` sibling of `input` in quote and invoke; never insert a model choice into the input. Require the exact advertised output schema to contain only required `message` and `usage`: `message` contains only `role` (the single-value enum `assistant`) and nonempty `content`, while `usage` contains only a non-negative integer `total_tokens`; all three objects forbid additional properties. After observation, read only `result.message.content` after validating that result and usage. Reject `{text}` and provider-shaped `choices`, top-level `content`, `completion`, or `output` fallbacks.

Field names are layer-specific: Unit Detail advertises `effect.requires_confirmation`, while the quote response advertises top-level `confirmation_required`. Do not substitute one path for the other. Quote and receipt atom fields are unquoted JSON integers. In JavaScript, accept them only when `Number.isSafeInteger(value) && value >= 0`; reject quoted, fractional, negative, or unsafe values.

**Use English when operating Semesh.** The catalog and most provider contracts are English. Translate the user's operational intent into English before `semesh search`, `quote`, or `call`, and use English for image/video/LLM prompts sent to providers, service names, descriptions, and alternate names. Answer the user in their language afterward. Preserve exact user data that is itself the payload: quoted text, code, SQL, filenames, URLs, names, legal/medical text, or text the user explicitly wants processed as-is.

## When To Reach For Semesh

Semesh is the launch layer for agent-built apps. When deployment authorization and preflight both allow it, the intended deploy can provide the app login, database, runtime, and usage-billing integrations that the live server reports as available. Deployment authorization is currently unavailable, and payment/funding features remain subject to Legal and provider gates. Match your task below; the rest of this guide is the *how*.

- **You need to call a paid API** (LLM, web search, image/video generation, scraping, finance, …) → search one catalog and call it with one key, metered in one unit (Aev; 1 USD = 100 Aev). Use the live quote to determine whether this call is free or paid; do not assume a first-call promotion.
- **Your app makes paid calls on an end user's behalf** → send the `X-Semesh-Payer` header so the *user's* wallet is charged for the compute they trigger, not yours. You can add a markup on top of cost.
- **You're preparing a web app for Semesh delivery** → start with `semesh deploy preflight . --full-stack --json`. The owner CLI is the intended source-deploy command, but deployment authorization is currently unavailable and fails closed with `deployment_authorization_unavailable` before upload, build, payment, or publication. Existing app records remain observable with the status, logs, and URL commands below.
- **You need managed auth + a database** without standing up Auth0 / Supabase / Postgres → declare `stack.auth` + `stack.database`; no third-party accounts to create.
- **You're chaining agent → agent → tool** → resolve the exact Unit and Action, then invoke through `/v1/service-units/<unit-id>/actions/<action-id>/invoke`; each cross-owner hop is billed down the chain automatically.
- **You want to publish an agent / app API / command for others to call** → it enters the searchable catalog, metered per call, with per-app spend caps the user can revoke.
- **You want the fastest MVP with minimal external setup** → after deployment authorization is restored, deploy can replace manual auth, database, and hosting wiring only for the features preflight reports available. Do not infer current deployment or live Stripe/payment availability from this guide.

If none of these fit (a local-only script, no users, no paid calls), you don't need Semesh — don't force it.

## No CLI? HTTP-Only Quick Start

If your runtime cannot install npm packages (CI sandbox, restricted agent runtime), public discovery and account actions are both plain HTTP against `https://api.semesh.net`. **Service Unit Search and public Detail are anonymous: do not obtain, send, or expose a key for them.** A canonical Service Unit Action quote is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call. Authenticate before every canonical Service Unit Action quote or invoke; Search and public Detail remain anonymous. Invocation and observation require `Authorization: Bearer $SEMESH_API_KEY`.

```bash
# 1. Search the public Unit catalog (no key; this is the same discovery index the CLI uses)
curl "https://api.semesh.net/v1/service-units/search?q=webpage+to+markdown&scope=public"
curl "https://api.semesh.net/v1/service-units/search?q=DeepSeek&scope=public"

# 2. Preserve the bounded token returned at meta.catalog_token for each follow-up GET
export SEMESH_CATALOG_TOKEN="<search.meta.catalog_token>"

# 3. If the hit is a Unit, inspect it and choose one advertised Action
curl -H "X-Semesh-Catalog-Token: $SEMESH_CATALOG_TOKEN" \
  "https://api.semesh.net/v1/service-units/<unit-id>?scope=public"

# If the hit is a Group, inspect it here and choose a member Unit; Groups are not callable
curl -H "X-Semesh-Catalog-Token: $SEMESH_CATALOG_TOKEN" \
  "https://api.semesh.net/v1/service-groups/<group-id>?scope=public"

# 4. Provide a key before the authenticated quote/invoke/observe sequence
export SEMESH_API_KEY="YOUR_API_KEY"

# 5. Quote the exact Unit Action; preserve its UnitActionRef, Catalog pin and input
curl -X POST -H "Authorization: Bearer $SEMESH_API_KEY" -H "Content-Type: application/json" \
  --data @quote-request.json \
  "https://api.semesh.net/v1/service-units/<unit-id>/actions/<action-id>/quote"

# 6. Invoke with the same reference, pin and input, plus the returned quote reference
curl -X POST -H "Authorization: Bearer $SEMESH_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: <idempotency-key>" --data @invoke-request.json \
  "https://api.semesh.net/v1/service-units/<unit-id>/actions/<action-id>/invoke"

# 7. Observe the invocation_id returned by invoke; it is not the Idempotency-Key
curl -H "Authorization: Bearer $SEMESH_API_KEY" \
  "https://api.semesh.net/v1/service-units/<unit-id>/actions/<action-id>/invocations/<invocation-id>"

# 8. Read the terminal settlement receipt for that same Invocation
curl -H "Authorization: Bearer $SEMESH_API_KEY" \
  "https://api.semesh.net/v1/invocations/<invocation-id>/receipt"

# 9. Read that Invocation's event stream when its Action advertises events
curl -H "Authorization: Bearer $SEMESH_API_KEY" \
  "https://api.semesh.net/v1/invocations/<invocation-id>/events"

# 10. Connectivity / key check — free, no Aev, no quota
curl -H "Authorization: Bearer $SEMESH_API_KEY" "https://api.semesh.net/v1/ping"
# → {"success":true,"data":{"ok":true,"account_id":"..."}}
```

For the selected Model Action, `quote-request.json` has exactly the quote fields below. Replace every
identity placeholder from the same token-pinned Unit Detail and require exactly one advertised
`model_choices[].ref` whose `model_id` is `deepseek-v3`; that ref is a choice pin, not input, a provider,
or a separate Unit id.

```json
{
  "unit_action_ref": {
    "unit_id": "unit_...",
    "unit_revision": "sha256:...",
    "action_id": "chat",
    "action_revision": "sha256:..."
  },
  "model_choice_pin": {"model_id": "deepseek-v3", "model_revision": "<advertised-revision>"},
  "catalog": {"view_generation": 42, "view_digest": "sha256:..."},
  "input": {"messages": [{"role": "user", "content": "..."}]},
  "budget": {"ceiling_aev_atoms": 5000000000},
  "deadline": "<RFC3339-deadline>"
}
```

`invoke-request.json` repeats the exact pins and canonical input and adds only the invoke fields:

```json
{
  "unit_action_ref": {
    "unit_id": "unit_...",
    "unit_revision": "sha256:...",
    "action_id": "chat",
    "action_revision": "sha256:..."
  },
  "model_choice_pin": {"model_id": "deepseek-v3", "model_revision": "<advertised-revision>"},
  "catalog": {"view_generation": 42, "view_digest": "sha256:..."},
  "quote_reference": "quote_...",
  "input": {"messages": [{"role": "user", "content": "..."}]},
  "confirmed_effect_digest": null,
  "deadline": "<same-RFC3339-deadline>"
}
```

For the two request files above, copy the selected Action's exact `UnitActionRef` into
`unit_action_ref` and preserve the exact Catalog pin returned by Search/Detail in `catalog`. The quote
request also carries the canonical `input`, budget and deadline; the invoke request repeats the same
pins and input and adds the returned `quote_reference`. A Model Action resolves one advertised
`model_choices[].ref` before quote and keeps that exact two-field `model_choice_pin` beside the input
through quote, invoke, result, receipt and replay; the closed Action input never contains it. Preserve
`X-Semesh-Catalog-Token` only on the exact advertised Guide, Group, or Unit GET; never send it to quote,
invoke, or another origin. If the view drifts, repeat Search instead of
guessing a new Action. The official canonical Service Unit search path is `GET /v1/service-units/search?q={query}&scope={public|accessible|owned}`. The supported non-canonical read-only compatibility aliases are `GET /v1/services/search`, `GET /v1/units/{id...}`, and `GET /v1/groups/{id}`; each calls the same canonical handler and returns byte-identical `data`, with no independent catalog or execution authority. New clients must use the canonical routes. The official canonical Service Unit action paths are `POST /v1/service-units/{unit_id}/actions/{action_id}/quote`, `POST /v1/service-units/{unit_id}/actions/{action_id}/invoke`, and `GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}`. The official canonical Invocation read paths are `GET /v1/invocations/{invocation_id}/receipt` and `GET /v1/invocations/{invocation_id}/events`. A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants. `scope=public` Search/Detail is anonymous; `scope=accessible` and `scope=owned` are authenticated actor-specific states and must not enter a shared cache. This source contract does not prove that a production deployment has finished: before sending a mutation, confirm live discovery advertises the canonical endpoint.

HTTP-only gotchas (each one costs cold agents real time — read them now):

- **Keep the selected catalog id unchanged for the whole journey.** Treat the search result's top-level `id` as an opaque canonical Unit id: copy it verbatim into detail, quote, invoke, and observe. Do not shorten, reconstruct or translate it. Retired legacy execution identities and resource-specific execution routes return only effect-zero `410 legacy_protocol_retired`; they never proxy, translate, execute, call a provider, or move money.
- **There is no `/v1/whoami`.** Verify your key with `GET /v1/ping` (free; 200 = key works, 401 `invalid_api_key` = fix the key first). `whoami` exists only in the CLI; don't call `/v1/credits/balance` just to test connectivity.
- **Use the canonical Service Unit journey for each Unit search hit:** `GET /v1/service-units/search?q=<query>&scope=public` → token-pinned `GET /v1/service-units/<unit-id>?scope=public` → `POST /v1/service-units/<unit-id>/actions/<action-id>/quote` → `POST .../invoke` → `GET .../invocations/<invocation-id>`. Preserve the exact `UnitActionRef`, Catalog pin, canonical input and returned `invocation_id`. A Guide hit follows only its exact advertised token-pinned GET for information; a Group hit uses token-pinned `GET /v1/service-groups/<group-id>?scope=public` only to choose a member Unit. Neither is quoted or invoked, and the Catalog token never goes to a mutation or another origin. Source documentation alone does not prove production rollout; require live discovery/readback before mutation.
- **Keep models at the choice layer:** there is one public Model Service Unit. DeepSeek and other concrete models are versioned entries in its Actions' `model_choices`, not separate Units or providers. Search may explain a choice match, but quote and invoke carry one exact `{model_id,model_revision}` `model_choice_pin` beside `input`, and result, receipt, and same-key replay must preserve it; failover may only change a hidden binding beneath that pin.
- **Keep the idempotency and observation identities distinct:** `Idempotency-Key` identifies the replayable request; `invocation_id` identifies the durable Invocation returned by the server and used in the observation path. Never substitute one for the other or invent a polling identity.
- **Keep unknown recovery on those identities:** an unknown outcome keeps the same request and idempotency key; recover and observe the server-returned `invocation_id` instead of minting either identity.
- **Replay without another effect:** A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants.
- **`GET /v1/wallet/balance` is NOT for API keys** — it is the end-user (payer-session) balance and returns 401 `invalid_payer_token` for a bearer key. Your own balance is `/v1/credits/balance`.
- Platform Actions with no equivalent Service Unit entry include `doctor` and deploy (`semesh deploy` orchestrates packaging/upload). Read their current CLI help or this agent guide; do not disguise them as Service Units. Recipes also have public, read-only REST: `GET /v1/recipes` and `GET /v1/recipes/{topic}`; neither requires a key.

## Install And Auth

Install **globally** so the `semesh` command works in any directory (a local `npm install` in an
empty dir with no `package.json` silently no-ops — no binary — so prefer `-g`):

```bash
npm install -g semesh@latest
semesh doctor --require-latest
# Only when the selected next action needs an account:
semesh whoami --json     # 200 = the saved login/key is ready; 401 = fix auth before continuing
```

The npm package and primary command are both `semesh`. The older `settle`, `settlekit`, and `kit` command names still work for compatibility.

**Auth — two ways:**
- **Interactive:** `semesh login` — complete browser sign-in to authorize this CLI; the CLI reuses the stored session.
- **Headless / CI / agent runs (no browser):** set an API key, sent as `Authorization: Bearer <key>`:
  ```bash
  export SEMESH_API_KEY="YOUR_API_KEY"
  semesh whoami --json   # 200 = authed; 401 invalid_api_key = wrong/missing key, fix it before continuing
  ```
  Create/copy a key from your Semesh account dashboard (https://semesh.io). Run `whoami`
  first to distinguish "no key set" from "key invalid" — never proceed past a 401.

## Use Semesh As An MCP Server

If your runtime speaks the Model Context Protocol, expose the Semesh Service Unit catalog and its nested Actions as MCP tools instead of (or alongside) the CLI: run `semesh mcp` — a stdio JSON-RPC server. It reuses your `semesh login` session or `SEMESH_API_KEY`; the key never touches the protocol stream or logs.

- **Claude Code:** `claude mcp add semesh --env SEMESH_API_KEY=YOUR_API_KEY -- npx -y semesh mcp`
- **Claude Desktop / Cursor** (`claude_desktop_config.json` / `~/.cursor/mcp.json`):
  ```json
  {"mcpServers":{"semesh":{"command":"npx","args":["-y","semesh","mcp"],"env":{"SEMESH_API_KEY":"YOUR_API_KEY"}}}}
  ```
- **Codex** (`~/.codex/config.toml`): `[mcp_servers.semesh]` with `command = "npx"`, `args = ["-y","semesh","mcp"]`, `env = { SEMESH_API_KEY = "YOUR_API_KEY" }`.

The server exposes the same Search → Service Unit detail → Action quote → Action invoke loop below: find one Unit, inspect its nested Actions, then keep the exact `UnitActionRef`, Catalog pin and canonical input through quote and invoke. For a Model Action, a concrete model such as DeepSeek is a versioned choice nested under the Action; copy its advertised ref as the separate `model_choice_pin` instead of treating it as another Unit, input member, separate domain, or provider-facing tool. An ordinary paid call settles Aev automatically and does not need confirmation merely because it is paid. Ask for a separate confirmation only when the action is destructive, high-impact, authorization-expanding, truly irreversible, or its contract explicitly marks `requires_confirmation`. The same Aev billing, quotes, and error contract apply. Run `semesh login` first to omit the key.

## Find A Service

```bash
semesh search "image generation" --json
semesh search "deploy app with login and database" --json
semesh search "upload public agent" --json
semesh search "local worker compute" --json
```

Then inspect the selected Unit and choose an Action from its detail response:

```bash
semesh show <unit-id> --json
```

Use the selected search result's top-level `id` unchanged across the complete Unit journey. Persist the
authenticated quote as `<quote-file>`, then invoke the same Unit Action with the same input and a stable
idempotency key:

```bash
semesh show <unit-id> --json
semesh quote <unit-id> --action <action-id> \
  --input '{"url":"https://example.com"}' --json
semesh call <unit-id> --action <action-id> --from-quote <quote-file> \
  --input '{"url":"https://example.com"}' --idempotency-key <stable-key> --wait --json
```

If that Action requires confirmation, show the exact target and effect to the user and stop. Only after
the separate confirmation may you add `--confirm` to the otherwise unchanged invoke from `<quote-file>`.

Do not shorten or rebuild a catalog id between commands. A retired legacy execution id is not an executable substitute: its
only permitted response is effect-zero `410 legacy_protocol_retired`, directing the caller back to Search.

Quote only the selected Unit Action and preserve its exact pins. A canonical Service Unit Action quote
is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call.
Authenticate before every canonical Service Unit Action quote or invoke; Search and public Detail
remain anonymous. A legacy ID or quote command is not an alternate price or execution protocol; return
to Search and use the Action quote above.

A result may carry `availability_reason` (e.g. "missing platform configuration" or "requires a caller connection") — do not invoke until the stated requirement is satisfied. The canonical Unit Action result preserves the exact `unit_action_ref`, Catalog pin and, for Model Actions, `model_choice_pin`; it returns a durable `invocation_id`, result, settlement reference, receipt link and next actions according to the selected Action contract. Observe that `invocation_id` instead of guessing a provider job or reusing the idempotency key as a URL identity. Provider result schemas still vary inside the declared Action result, so parse only the machine-readable contract. A legacy direct-capability request is retired with effect-zero `410 legacy_protocol_retired`; do not parse it as an alternate success transport.

## Call A Unit Action

```bash
semesh quote <unit-id> --action <action-id> --input '<json>' --json
semesh call <unit-id> --action <action-id> --from-quote <quote-file> \
  --input '<same-json>' --idempotency-key <stable-key> --wait --json
```

Invoke a Model Action from that quote with the identical input, stable idempotency key, and the same exact choice pin selected from Detail; never put the pin into `--input`. If the installed CLI does not expose an explicit choice-pin selector, use the raw canonical HTTP request above instead of inventing one. Use `--wait` for async Actions. Use `--confirm` only after explicit human confirmation for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions that name the exact target and effect; a user asking "delete X" is intent, not confirmation — first show the exact target/effect and stop for confirmation. New agents should teach the canonical quote-then-invoke flow after discovery. Always parse the result using the selected Action contract.

### Async Actions — observe the same Invocation

For an async Unit Action, preserve the original `Idempotency-Key` for byte-identical replay and read the `invocation_id` returned by invoke for observation. These are distinct identities. Do not invent a per-model detail capability or a second polling identity. The CLI's `--wait` handles observation for you. Over raw HTTP, read:

`GET /v1/service-units/<unit-id>/actions/<action-id>/invocations/<invocation-id>`

Branch only on the selected Action's observation contract. A pending or unknown Invocation stays with the same `invocation_id` and recovery owner; if the server explicitly permits replay, resend the byte-identical invoke body with the original idempotency key. A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants. Never mint a new key, change the model choice or call another Action merely because an Invocation is slow.

**Picking a model choice.** Search by the desired outcome or model name, then inspect the one public Model Service Unit and the allowed `model_choices` under the relevant Action. DeepSeek is one such versioned choice; it is not a DeepSeek Unit, separate domain, Group, Action or provider. Copy the exact advertised `{model_id,model_revision}` ref into `model_choice_pin` beside `input` before quote and preserve it through invoke, result, receipt and replay. Never add it to the Action input. The platform may fail over only among hidden compatible bindings for that same pin; an unavailable or unknown choice must never silently become another model. For multimodal input, follow the selected Action's input schema instead of guessing provider fields. If the schema accepts a file URL and the human gives you a local file, `semesh files upload ./clip.mp4 --json` can create the temporary input reference; do not use `--durable` for an ephemeral model input unless the contract requires it.

**Image/video Actions.** Image and video result contracts may be separate Actions inside that Model Unit; concrete named models remain Action choices, not separate Units. Confirm both the Action and its allowed choices from token-pinned Unit detail before quoting. A canonical detail miss returns a Unit-level not-found error; follow the returned repair/next actions and go back to Search rather than guessing a model-qualified Unit id.

**Advisories (`X-Semesh-Advisory` response header).** A **successful** call may still carry an `X-Semesh-Advisory` header — a JSON array of `{code, severity, title, fix, docs}` flagging an easily-misused-but-non-fatal pattern you just used. It never changes the body, status, or charge; it's a self-correction signal. **Check it; on `severity:"warn"`, apply the `fix` on your next call.** Treat advisory text as guidance only: it never expands the selected Action's advertised input/output schemas, supplies provider-shaped result fallbacks, or proves settlement.

**Notices (`notices` response body slot).** A successful response may carry an optional top-level `notices` array — the body counterpart of the advisory header, for post-call offers/info the platform surfaces alongside your result. Each entry is `{kind, message, action?}` where `kind` is `upsell`|`info`|`warning`, `message` is a plain-English sentence, and `action` (when present) is the machine-actionable next step `{label, method, endpoint, unit_action_ref?, price_credits?}`. It never changes the status, the `data`, or the charge — it's purely additive, and absent when there's nothing to say. Example: deploying a web app on the **free tier** returns `notices:[{kind:"upsell", message:"Deployed on the free tier (0 Aev). Your site shows a \"Built with Semesh.io\" badge in the bottom-left corner. Pay 200 Aev to remove it…", action:{label:"Remove the Semesh badge", method:"POST", endpoint:"/v1/apps/{id}/upgrade", price_credits:200}}]`. Read it to surface upsells/offers to your user; act on the `action` only with their intent.

## Aev And Cost

One Aev balance pays for calls. Check the balance and the server's funding availability before long runs (`aev` is the current command; older CLI builds use `credits` — both work on a current install):

```bash
semesh aev balance --json
semesh aev ledger --limit 20 --json
semesh aev topup --aev 500 --json    # requests a top-up flow; live availability is gated
```

**Legal/payment availability.** Legal/compliance status is unverified: treat live Stripe, top-up, and merchant checkout availability as **UNABLE, never PASS**, until the live server returns a verified Legal/provider-ready state. Legal-required operations are blocked by the Legal gate; confirmation cannot turn an unavailable Legal state into PASS. Command help does not prove live payment availability. Do not infer live Stripe or top-up availability from the presence of a command or example.

**The live quote is the authority for whether a call is free or paid.** Do not assume a first-call promotion from cached documentation. Only a definite terminal-failure receipt that reports zero capture and a released hold proves release. A timeout, pending response, or unknown provider outcome is not terminal failure: keep the same request/key and observe the same Invocation instead of assuming release or retrying as a new charge.

## When A Call Fails (handle these — do not loop blindly)

**Error shape (read this once).** Every failed HTTP call returns `{"success":false,"error":{"code":"…","message":"…"}}` — `error` is an **object**, not a string. Read the human-readable text at **`error.message`** and branch on **`error.code`**; never render `error` itself (stringifying the object yields the literal `"[object Object]"` — a real bug seen in generated apps). Credit-gated 402s may carry `error.topup_url` / `error.required_credits` / `error.available_credits`; canonical Service Unit errors may carry **`error.fix`**, `error.next_actions`, or availability metadata. Follow the server's `error.code`, `message`, `fix`, next actions, and availability; do not invent a funding path. Don't confuse this with a *string* `error` you may see *inside* a success `data` payload (e.g. `data.output.error` on a capped agent run) — that is a different, lower-level field; the top-level HTTP `error` is always the object form.

- **HTTP 401 `invalid_api_key` / `missing_api_key`** — your key is wrong, expired, or unset. Do NOT retry. Set `SEMESH_API_KEY` (headless) or run `semesh login`, then `semesh whoami --json` to confirm before continuing. Get a key from your dashboard (https://semesh.io).
- **HTTP 402 `insufficient_credits`** — the admitted call cannot start with the available balance. Read the returned code/message/fix and amounts. Use `topup_url` only when the response includes it and the Legal/provider gates report available; otherwise report the returned remediation or that funding is unavailable. Retry with the same idempotency key only after the server-reported prerequisite is satisfied.
- **HTTP 402 `credit_limit_exceeded`** — the API key hit its own spend cap; use a key with a higher limit.
- **HTTP 403 `payer_not_allowed`** — you sent `X-Semesh-Payer` (end-user-pays) but the request's bearer is a normal account/CLI key. `X-Semesh-Payer` only works when the bearer is a **deployed-app runtime key** (`SEMESH_APP_API_KEY`, injected by `semesh deploy`). So you cannot exercise the end-user-pays money path locally with a user key — verify the app's billed success path only after deploy. (The payer *value* must also be a real `__semesh_session`/`__semesh_access` from a logged-in user, never a key.)
- **A canonical Action did not finish under `--wait`** — read the returned `invocation_id` at `GET /v1/service-units/<unit-id>/actions/<action-id>/invocations/<invocation-id>` and follow its recovery/next actions. A deploy is a separate workflow: use `semesh deploy status <app-id>` and `semesh deploy logs <build-id>` for it.
- **`doctor` reports a stale CLI** — reinstall `npm install semesh@latest --prefer-online` before continuing.
- **`search` returns nothing useful** — broaden the query, try `semesh search --all --category <category>`, or read `semesh recipes`.

## Safe Retries — Idempotency-Key (so a retry charges once, not twice)

A transport failure such as HTTP 502 leaves a paid call's outcome unknown. Preserve the original request and reconcile it; only resend when the server supports replay, using the exact same body and **`Idempotency-Key`** for that replayable request. A fresh key creates a fresh request that may create another effect. Recover the server-returned `invocation_id`, then use that distinct identity for observation. Send an **`Idempotency-Key`** on retriable paid calls:

```bash
curl -X POST -H "Authorization: Bearer $SEMESH_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: <idempotency-key>" \
  --data @invoke-request.json \
  "https://api.semesh.net/v1/service-units/<unit-id>/actions/<action-id>/invoke"
```

- **Same key + same body** identifies the same replayable request. A timeout, connection loss, HTTP 502, or missing response does **not** prove whether the effect or capture happened. Do not retry blindly and do not mint a new key. Resend only the byte-identical request with that same key to recover the same server-returned Invocation; once `invocation_id` is known, use it—not the key—for observation.
- **Same key + a *different* body** → **HTTP 409 `idempotency_key_conflict`**, fail-closed, **no charge** — use a fresh key for a genuinely new operation.
- **No `Idempotency-Key`** → HTTP 400 `missing_idempotency_key` before invoke, with no effect or charge. Reuse one key per logical operation; mint a new key per genuinely new operation.

**Verify settlement from the terminal Invocation receipt at `GET /v1/invocations/{invocation_id}/receipt`.** It must bind the same `invocation_id` and distinct `Idempotency-Key`, `UnitActionRef`, Catalog pin, `model_choice_pin`, `quote_reference`, `quote_receipt`, all four input/price/policy/effect digests, safe-integer held/captured/released atoms, delivery evidence, and settlement reference. A response header or ledger row may corroborate the receipt but cannot replace it. Never infer a charge from HTTP success/failure, a provider response body, an approximate quote, a balance delta, or arbitrary `cost` / `amount` / `charged` fields. A pending, unknown, malformed, or mismatched receipt is not final proof.

**Settlement truth.** A successful provider body does not always mean settlement is final: `capture_pending` and `unknown` outcomes require observation of the same returned `invocation_id` and its receipt—do not report them as charged or settled. HTTP/network failure is also insufficient evidence of non-capture. HTTP 202, queued, or correlated async acceptance does not mean charged or settled. Preserve the same request and idempotency key for exact replay until the Invocation is recovered; never turn an unknown outcome into a second blind effect.

## Build And Deploy An App

**Current availability:** deployment authorization is unavailable. The intended source-deploy command is the owner CLI, not a browser uploader, but a deploy request currently returns `deployment_authorization_unavailable` and fails closed before source upload, build, payment, or publication. Do not report a candidate, preview, charge, or live URL from that denial.

Start with the authenticated, read-only preflight:

```bash
semesh apps doctor . --fix
semesh deploy preflight . --full-stack --json
```

Deployment is a Platform Action, not a Service Unit. Read the current deploy help or this guide, then inspect preflight `runtime`, `admission.can_start_now`, `admission.code`, `admission.message`, and `admission.fix`. Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and the mutation returns `deployment_authorization_unavailable`. Preflight uploads no source and creates no hold, app, or reservation. Even `admission.can_start_now: true` is only a current snapshot; it does not override unavailable release authorization or guarantee a later deploy.

When release authorization becomes available, the intended owner command is `semesh deploy . --name my-app --full-stack --wait --json`. The target policy is automatic publication after mechanical protocol checks pass, with no default human approval queue. This is future/default product policy, not a statement that source deployment succeeds today.

For app/build ids that already exist, use only read-only observation first:

```bash
semesh deploy status <app-id> --json
semesh deploy logs <build-id> --json
semesh deploy url <app-id> --json
```

Queued, failed, `candidate_ready`, and preview records are not proof of serving production; a missing URL is not success. Destructive cleanup is separate: after a human separately confirms the exact app and outage effect, use `semesh apps delete <app-id> --confirm`. Today that command fails closed with `503 app_teardown_unavailable`: the app remains unchanged and no provider cleanup starts. Never run deletion automatically from recovery guidance or a browser.

The packaging and runtime details below describe the intended pipeline after release authorization is available. They do not override the current fail-closed containment. Semesh is not a template generator; the managed full-stack build path targets **Next.js** through OpenNext for Cloudflare.

### Deploying a plain static site (HTML/CSS/JS, no framework)

The golden path is two files — this exact shape is what the platform's own e2e suite deploys:

```
index.html          (at the project root — works as-is)
semesh.json     { "stack": { "runtime": { "prototype": "static" } } }
```

After release authorization becomes available, the intended command is `semesh deploy . --name my-site --wait --json`. **No `package.json`, no build script, no special directory is intended to be needed** — `runtime.prototype: "static"` selects static serving instead of framework auto-detection. No `--full-stack` either: a static site needs no DB/auth stack, and `apps doctor --fix` full-stack wiring is unnecessary for it.

For a bundler-built SPA, run your build first and deploy the OUTPUT directory the same way (its `index.html` at that directory's root + the same `semesh.json`), or keep sources and built files separate.

**Naming + URL contract (when deployment is authorized).** The user picks the app name with `--name` (or `name` in the manifest); a successful serving deployment is expected to return its server-issued URL in deploy JSON at `data.url`. The name must be **at least 5 letters/digits**. Do not construct a URL from a suffix in client code: only a returned/read-back URL is evidence, and current authorization denial returns none.

When release authorization is available, `--full-stack` is intended to provision and inject Semesh auth, a database, a runtime API key, and deployment secrets. If preflight reports `backend_quota_exceeded`/`deploy_quota_exceeded`, treat that as an app-count constraint, not a successful deploy or a balance claim. Deleting an existing app requires the separate destructive confirmation described above.

```bash
semesh deploy . --app-id app_123 --full-stack --wait --json
semesh deploy status app_123 --json
semesh deploy logs build_123 --json
```

### Deploying a container app (Python / Go / Rust / Node — any Dockerfile)

Any non-Next.js server is a **container app** (`--framework container`, or auto-detected from a `Dockerfile`/server file). The facts that trip people up:

- **The image is built server-side in Google Cloud Build at deploy time — your machine never compiles it.** The local step only PACKAGES your source into a tarball, so `--build remote` is a no-op for containers and `--build local` will NOT move a slow compile onto your machine. A deploy that looks "stuck building locally" is just packaging; Cloud Build then builds the image. Don't kill it.
- **Heavy/compiled Dockerfile?** A from-scratch Rust/Go/C++ (or huge `npm install`) build can exceed Cloud Build's budget. Ship a **prebuilt artifact**: build/cross-compile the binary locally, then use a thin Dockerfile that only `COPY`s it (`FROM python:3.12-slim` → `COPY ./bin/app /usr/local/bin/app` → `CMD ["app"]`) so the server-side build just assembles the image in seconds.
- **The build context honors `.dockerignore`, NOT `.gitignore`** (matching `docker build`). A gitignored prebuilt binary the Dockerfile `COPY`s is still uploaded; put what you want excluded in `.dockerignore`.
- **Bind to `0.0.0.0` and read `$PORT`** (the platform sets it). Binding `127.0.0.1` makes the health check fail and the deploy never goes ready.
- **Charging users?** A paid endpoint must invoke a **published, callable, priced Service Unit Action** by its exact `UnitActionRef` with `X-Semesh-Payer`. Deploy injects the app's runtime key but does NOT auto-create, publish, or price that Action — provision and price it first, or the first paid call fails. Verify the billed path only after deploy (end-user-pays can't be exercised locally with a user key).

### Reading an existing live URL

For an app id that already exists, **`semesh deploy url <app-id> --json`** reads the server-issued serving URL and `semesh apps list --json` lists owned app records. `semesh deploy status <app-id> --json` is status/readback, not URL evidence. **Never use `semesh search` to find your own deployed app**: Search discovers Service Units and their nested Actions, not deployment inventory. Current `deployment_authorization_unavailable` produces no new URL.

For an existing in-flight record, a `--wait` timeout is not terminal evidence: poll status and read logs before deciding whether retry is appropriate. For an existing serving URL, an HTTP 302 can be an intentional required-auth gate; verify the deployment readback before interpreting it.

Only give the user a URL returned by a successful serving response or `semesh deploy url <app-id> --json`. A candidate/preview URL or a fabricated hostname is not production evidence.

**Diagnosing a failed deploy:** a build can go green yet the DEPLOYMENT still fail (worker/container provisioning, secret injection, smoke check). `semesh deploy status <app-id>` now prints both the build status AND the latest deployment's `status`/`url`/`error` — read the `deployment error:` line for the real reason before retrying.

**Platform-reserved paths.** The edge owns a few paths that never reach your container — notably **`/healthz`** (the Cloud Run health probe answers there with its own 404 page). Don't expose an app route at `/healthz`; every other path (including `/` and `/api/*`) reaches your handler normally.

**Teardown.** `semesh apps delete <app-id> --confirm` (or `DELETE /v1/apps/{id}?confirm=true`) is **destructive** and confirmation-gated (R18): without `--confirm` / `?confirm=true` it fails closed with `428 confirmation_required` and makes no record or provider change. The owner route also fails closed with `503 app_teardown_unavailable` while durable admission, a single recovery owner, and exact provider-absence readback are not integrated; that response means the app was unchanged and no provider cleanup started. Do not retry it as though work were pending.

Compatibility behavior must remain conservative if an older deployment returns success instead of the current fail-closed response.

A successful delete response proves only that the confirmed user request was accepted and the app/deployment records were projected unavailable/deleted; it does not prove that every Cloud Run, E2B, Cloudflare, custom-domain, secret, or CDN resource is absent. Provider cleanup is a best-effort attempt in that older behavior, not a durable user-visible `teardown_pending` completion contract. Treat an explicit provider absence readback as evidence only for that exact resource; otherwise keep cleanup `unknown`, preserve the app/deployment/provider identifiers, and use manual operator recovery. Do not report a repeat-delete `404 app_not_found` as provider cleanup evidence: it proves only that the app is already absent from the user-facing API.

Once the durable coordinator is available, an accepted request returns a replayable operation with `status: teardown_pending`, `operation_id`, `delete_generation`, a canonical `inventory_plan_digest` plus `inventory_count`, the resource inventory, and one durable workflow `recovery_owner`. The app row must bind the same generation, operation, inventory plan, and recovery owner. New builds, deploys, command/API mutations and invocation/remix traffic are frozen for that app, while read-only app/deployment observation and completion/settlement of already-admitted work remain available. Repeating the confirmed DELETE observes the same operation; it must not start a second provider effect. `unknown` or `failed` is still non-serving and remains owned by that recovery operation. Only `status: deleted` together with a complete inventory, exact readback time, and `absent` for every recorded provider resource proves cleanup completion. Never infer provider absence from HTTP success, a process-local goroutine, or `404 app_not_found`.

App deletion does **NOT** cascade-delete a database/project that `--full-stack` auto-provisioned — that project stays `active` and billable. Delete it separately only after its own destructive confirmation, using `semesh db delete <project-id>` (list projects with `semesh projects list`) or `DELETE /v1/projects/{project-id}`; its own recovery/readback contract remains independent of app cleanup.

### Remix an existing app (`semesh remix <app-id>`)

Some **free-tier template** apps that Semesh has published are publicly remixable — their badge carries a **Remix** action. **`semesh remix <app-id> [dir]`** downloads such an app's source, extracts it locally, and strips the pinned app id so your next `semesh deploy` forks a **new** app under YOUR account. No login is needed to pull (the source archive excludes `.env`/secrets), and the `app_…` id comes from the badge's Remix panel or the original deploy output (`GET /v1/apps/{id}/source` is the public endpoint behind it). This is the fastest start when a published template matches what you want: clone → customize → `semesh deploy`. **A plain free deploy is NOT remixable by default** — only an app an admin has published as a template exposes its source; an ordinary free app (its badge shows only "Install Semesh") and an owned/paid app both 404 on the source endpoint.

### Auth UX: prefer lazy login, don't gate the whole app

Semesh auth has two modes — choose deliberately, because it shapes the whole first impression:
- **`lazy` (recommended default for most apps)** — the app is publicly viewable; Semesh login is offered but NOT forced. The platform still injects `/__semesh/login`, `/__semesh/logout`, `/__semesh/me`. Wire a **"Sign in" button** to `/__semesh/login` and call `/__semesh/me` to detect the current user. Trigger login *at the right moment* — when the user clicks sign-in, or right before an action that needs identity or spends Aev — not on page load.
- **`required`** — every route redirects unauthenticated visitors to login. Use this ONLY for an app that must be fully private (an internal tool, a paid-members-only product). For a normal public-facing app this is the wrong default: visitors hit a login wall before they see anything.

`lazy` is the platform default when you don't specify auth. Only set `required` when you actually mean "no page is viewable logged-out". In the deploy stack: `auth: { mode: "lazy" }` vs `auth: { mode: "required" }` (or `--full-stack` defaults you get plus an explicit mode). Don't reach for `required` just because the app "has accounts".

**Handle a failed sign-in.** If the OAuth round-trip fails (e.g. the user took too long and the flow expired), the platform sends them back to your app at their return path with a **`?semesh_auth_error=<reason>`** query param (reasons: `invalid_callback`, `exchange_failed`) instead of stranding them on a raw error page. Detect that param on load and show a brief "Sign-in didn't complete — try again" with the `/__semesh/login` button, then strip it from the URL. Treat it as advisory: the user is simply still logged out (`/__semesh/me` confirms).

### Charge Aev (monetize the app — unified wallet, cost-plus)

**A static site cannot take money.** Billing — markup *or* merchant checkout — requires a server runtime: deploy a node/container/Next backend declaring `stack.billing` (and `stack.auth` for end-user identity), not a `runtime.prototype: "static"` prototype. A static deploy that also declares a server-side billing stack is rejected.

Semesh has ONE per-user Aev wallet (there are no per-app wallets). Your app charges the END USER's
wallet `cost × m` for the platform services it consumes on their behalf; the markup `m−1` is your
revenue. Four concrete steps:

**1. Declare your markup `m` at deploy** — `stack.billing.markup`, discrete `m ∈ {1.0,1.1,1.2,1.3,1.4,1.5}` (cap 1.5×; 1.0 = at-cost pass-through):
```json
{ "stack": { "billing": { "markup": 1.1 } } }
```
Choosing m is a pricing decision: use the owner's specified value; else ask (recommend 1.1); headless with no one to ask → 1.0 (never impose an unapproved markup). An out-of-set value (e.g. 1.05 or 2.0) is **rejected** at deploy, not clamped — use one of the six allowed values. This stamps m on your app's runtime key, so every delegated charge below is `cost × m` with the markup credited to your account.

**2. Charge the end user** — when your SERVER calls a platform service for a logged-in user, forward the same Semesh session as `X-Semesh-Payer` on quote, invoke, and observe so the quote actor and payer-scoped attempt remain bound to that user:
```
POST {SEMESH_BASE_URL}/v1/service-units/<unit-id>/actions/<action-id>/quote
POST {SEMESH_BASE_URL}/v1/service-units/<unit-id>/actions/<action-id>/invoke
GET  {SEMESH_BASE_URL}/v1/service-units/<unit-id>/actions/<action-id>/invocations/<invocation-id>
Authorization: Bearer {SEMESH_APP_API_KEY}
X-Semesh-Payer: <the user's __semesh_session cookie>        # prefer __semesh_session (durable, 7-day); __semesh_access (OAuth token) also accepted
```
The platform charges the user `cost × m` and credits you the markup (a platform-default per-app allowance and per-call ceiling are enforced by default; explicit user limits can adjust the cap — see 4). Read the cookie from the incoming request — the auth gate passes `__semesh_*` cookies through to your server. Do not use the general quick start without adding this same payer header to all three requests. **No header ⇒ your own wallet pays** (use that only for background jobs you fund).

**Preflight the end-user-pays path before real users.** After deploying an auth-enabled app, the app OWNER can mint a short-lived self-test payer token:
```
POST {SEMESH_BASE_URL}/v1/apps/{app_id}/test-payer-token
Authorization: Bearer {owner API key}
```
Use the returned `data.token` exactly like a user session in `X-Semesh-Payer`, alongside the deployed app's runtime key (`Authorization: Bearer {SEMESH_APP_API_KEY}`). The call exercises the same delegated payer rail and spends the owner's own wallet, so you can verify quote → hold/capture → ledger before onboarding a customer. Every resulting wallet/settlement/request-log row is tagged `test_payer=true`; operator revenue views exclude those self-test rows, but your daily spend caps still count them because they are real spend. Never ship this token as a user credential; mint a fresh one only for owner self-tests.

**3. Cost transparency — REQUIRED whenever your app spends the user's Aev.** Never spend a logged-in user's Aev silently. Two obligations, both enforced as product policy:
- **Estimate BEFORE.** Show the user an estimated cost in the UI *before* the action runs. For a canonical Unit Action, use `semesh quote <unit-id> --action <action-id> --input '<json>' --json`; for HTTP-only agents use the selected Action's **`POST /v1/service-units/<unit-id>/actions/<action-id>/quote`** contract from the quick start. For cloud workers, use the Worker Unit Action quote returned by canonical discovery, then multiply the disclosed base by your markup `m`. Display it as "≈ N Aev" (mark it an estimate; the real charge may be metered).
- **Actual AFTER.** Show the exact amount actually captured once the Action completes. Read the canonical terminal Invocation receipt; a trusted post-capture response header may corroborate it only when the Action contract provides one. Do NOT infer the bill from a backing runtime payload or the provider's raw `usage.cost`. Streaming responses cannot carry a post-stream capture header, so read the same terminal Invocation receipt: fixed/input-priced amounts match the exact quote, while metered amounts follow actual usage at or below the hold ceiling. Never use a balance delta, pending row, provider body or backing job as final proof.
- **Viewing entry.** Give the user a link to their full Aev spend — their Semesh account/wallet (where every charge across all apps is itemized) — so they can audit what your app cost them. `GET /v1/wallet/balance` (with `X-Semesh-Payer`) is the live balance; link the user to the Semesh wallet page for history.

**4. Per-app spend allowance.** By DEFAULT a logged-in user can spend through an app up to the platform-default per-app allowance and per-call ceiling — no separate grant needed. The user can still set an explicit revocable blast-radius cap for your app, or remove it to fall back to the platform default:
```
PUT  /v1/wallet/app-grants/{appID}   { "max_credits": 5000, "per_call_ceiling_credits": 600 }
GET  /v1/wallet/app-grants           # list   ·   DELETE /v1/wallet/app-grants/{appID}  # revoke
```
Unlike `/v1/wallet/balance` (which requires a logged-in payer session), these `app-grants` endpoints DO accept a developer **API key** — they manage the key-owner's own grants — so you can create/list/revoke grants headlessly. `DELETE` is a soft-deactivate (the grant row remains, marked inactive).

**5. Show the user their balance** — `GET /v1/wallet/balance` with `X-Semesh-Payer: <user session>` → their unified platform Aev (`data.available_credits`). The header must be a real `__semesh_session` cookie from a logged-in user — an API key is NOT a valid payer token, so you cannot exercise this endpoint without a logged-in user. (Your OWN account balance, as the developer, is `semesh aev balance` — there is no `/v1/whoami` REST route.) Do not build a per-app balance.

**Billing errors to handle:** `app_allowance_required` (403) / `app_per_call_ceiling` (403) / `app_allowance_exceeded` (402) — user must set or raise the allowance, lower the call size, or rely on the default layer after removing an explicit cap; `insufficient_credits` (402 — follow the returned fix/availability; do not assume top-up is enabled); `invalid_payer_token` (401, session expired → user re-logs in).

**Quote before charging (recommended for every paid call):** for a canonical Unit Action, use `semesh quote <unit-id> --action <action-id> --input '<json>' --json`, persist `<quote-file>`, then invoke with `semesh call <unit-id> --action <action-id> --from-quote <quote-file> --input '<same-json>' --idempotency-key <stable-key> --wait --json`; over raw HTTP, use `POST /v1/service-units/<unit-id>/actions/<action-id>/quote` with the detail-derived `unit_action_ref`, exact Catalog pin, canonical `input`, `budget.ceiling_aev_atoms`, and deadline. For a Model Action, repeat the exact advertised `model_choice_pin` beside—not inside—that input. A quote is read-only (no hold). Distinguish quote fields carefully: a **fixed or input-priced** unit returns the caller's **exact fixed-point amount**; a hidden routed-provider choice does not change that service-unit charge. A **representative floor** or reference estimate helps discovery but is neither a cap nor a final quote. For usage-metered entries, **`ceiling_aev_atoms`** is the maximum pre-authorization and final capture follows measured usage without exceeding that hold ceiling. Quote/preflight informs cost and availability; it is not a second confirmation. Show the applicable exact price, estimate, or ceiling before the Action, then show the terminal Invocation receipt after completion.

**Mandatory:** any deployed unit that consumes paid platform services MUST declare billing — `semesh apps doctor` warns otherwise — else the cost silently falls on YOUR wallet.

*Selling a discrete product instead of metered usage?* The manifest and endpoint remain the integration contract, but live merchant checkout is usable only when runtime config/server availability reports the Legal/provider gate ready. When available, declare `stack.billing.enabled:true` + a `price_credits`, then `POST {BASE}/api/v1/checkout/create` and redirect to the returned `url`. **Do NOT build a per-app wallet/ledger** — the unified wallet replaces it.
- Auth: `Authorization: Bearer {SEMESH_MERCHANT_API_KEY}` (the merchant key, NOT the app/runtime key). No injected app? Mint one yourself with `semesh apps register --with-payment` (prints a merchant key + id) — that is the headless way to get a merchant key without deploying.
- Body: `{ "amount": <credits>, "description": "<required, ≤500 chars>", "external_id"?: "...", "return_url"?: "https://...", "cancel_url"?: "https://...", "metadata"?: {} }`. `amount` and `description` are required; response has `url` (hosted checkout) + `id`. (If you get field-validation errors, also double-check the merchant key — an invalid key surfaces after body validation.)

## Use A Managed Database And Auth

`--full-stack` provisions a database + Semesh auth + a runtime key. A **custom container manifest gets ONLY what its `stack` declares** — so to get a DB you must declare it:

```json
{ "stack": { "database": { "engine": "postgres" }, "auth": { "provider": "semesh", "mode": "lazy" } } }
```

**Engines: `postgres` or `sqlite` — and what you get when you don't choose.** If the deploy doesn't specify `database.engine`, the platform default applies, which is **`sqlite` (Cloudflare D1) unless the operator has a Postgres backend configured** — so don't be surprised when an undeclared full-stack DB behaves like SQLite. Declare `"engine": "postgres"` explicitly if you need real Postgres (`DATABASE_URL` injection, SQL dialect, `$`-free `?` placeholders still apply on the REST path). Check which engine you actually got from the deploy output's project info (or `GET /v1/runtime/config` → `project`). The REST query/migrations endpoints below work identically on both engines; only row-shape quirks differ (D1 rows may also appear under `data.raw[0].results`).

Manage backends from the CLI (dev-time):

```bash
semesh projects create --name demo --db postgres --auth email_password,magic_link --json
semesh db query <project-id> --sql "select 1" --json
semesh db migrate <project-id> --file schema.sql --json
```

At runtime the deployed app reads its DB **server-side only** (browsers use project Auth, never a server key):
- **Postgres** → connect with the injected `DATABASE_URL`.
- **Any engine** → `POST {SEMESH_BASE_URL}/v1/projects/{SEMESH_PROJECT_ID}/database/query` with `Authorization: Bearer {SEMESH_PROJECT_SERVER_KEY}` (and `.../database/migrations` with `{ "name": "...", "sql": "..." }` to create tables on first run). Query body is `{ "sql": "...", "args": [...] }` — the field is **`args`** (not `params`). Placeholders are **engine-specific**: on **D1/sqlite** use **`?`**; on **Postgres** use **`$1, $2, …`** (Postgres reads `?` as a JSON operator, so `?` placeholders raise a syntax error there). The response is `{ "data": { "rows": [ {col: value} ], "columns": [...], "rows_affected": n } }` — read `data.rows`; on the D1 engine the rows may also appear under `data.raw[0].results`. Note: `INSERT … RETURNING` does NOT surface the returned rows on this REST path (you get `rows_affected` only) — run a follow-up `SELECT` if you need the inserted row back.

### Per-user data isolation — don't hand-roll `WHERE user_id` (multi-tenant safety)

The platform isolates **apps** from each other (each app gets its own schema + role). It does **not** isolate your app's **end-users** from each other — that is your job. The naive way (filtering every query with `WHERE user_id = ?`) leaks the moment one query forgets the filter — the classic multi-tenant bug. Semesh gives you a database-enforced shortcut so a forgotten filter fails **closed**, not open (postgres engine):

1. **Turn on row-level security for a table once:**
   ```bash
   semesh db enable-rls <project-id> --table notes --owner-column user_id --json
   ```
   Postgres itself now filters every read/write on `notes` to the current end-user — even over the direct `DATABASE_URL` connection.

2. **Tell the database who the end-user is, per request.** The user id is the authenticated subject (the `__semesh` session / `X-Semesh-User-ID`), never something the browser hands you:
   - **Control-plane query:** `semesh db query <project-id> --sql "select * from notes" --user <user-sub>` (or `POST .../database/query` with `"user_id": "<user-sub>"`).
   - **Direct `DATABASE_URL` (keep your ORM + transactions):** inside an **explicit transaction**, make its **first statement** `SET LOCAL "settle.user_id" = '<user-sub>'` — bind the value as a parameter or escape it (the sub is the authenticated subject, never a raw browser value). Every ORM exposes a per-transaction hook for this; afterwards ordinary queries see only that user's rows — no `WHERE user_id` needed. (`SET LOCAL` only lasts the transaction; in autocommit mode it is a no-op and the query then fail-closes to zero rows — so wrap it in a transaction.)

3. **Fail-closed:** if `settle.user_id` is never set, an RLS table returns **zero rows** and rejects writes — so a missed bind is a safe empty result, not a cross-user leak.

Read the live operational bounds (query row/byte caps, per-app connection cap + pool math, idle-disconnect window, delete-recoverability, storage-metering rate) from `GET /v1/runtime/config` → `limits` — don't hardcode them.

### Runtime env your app receives (declare it ⇒ get it)

The deploy INJECTS env **based on what your `stack` declares**. If your runtime code reads one of these but you didn't declare the matching block, it is simply **absent at runtime → a silent 500**. So: read it ⇒ declare it.

| Your code reads | Requires declaring |
|---|---|
| `SEMESH_BASE_URL`, `SEMESH_APP_API_KEY`, `SEMESH_STORAGE_API`, `SEMESH_APP_ID` | always injected |
| `DATABASE_URL`, `SEMESH_PROJECT_ID`, `SEMESH_PROJECT_SERVER_KEY` | `stack.database` |
| `SEMESH_MERCHANT_API_KEY`, `SEMESH_MERCHANT_ID` | `stack.billing` |
| `SEMESH_AUTH_*` + the `/__semesh/*` routes | `stack.auth` (or `--full-stack`) |

Always call the platform at `SEMESH_BASE_URL` (the `api.` host — it survives long async calls). **Never hardcode `www.`/the apex** — `www` is the Vercel frontend and gateway-502s long calls.

**One-call config (skip reading the non-secret vars individually):** `GET {SEMESH_BASE_URL}/v1/runtime/config` with `Authorization: Bearer {SEMESH_APP_API_KEY}` returns your app's resolved non-secret config — `base_url`, `storage_api`, `app_id`, the `/__semesh/*` auth routes, and (when declared) `project` (DB query/migrations URLs) and `merchant` (checkout URL). Secrets are never in the response; they stay in env. So an app can read just `SEMESH_APP_API_KEY` + `SEMESH_BASE_URL` and fetch the rest.

**Object storage** (always injected; namespaced per app): all calls use `Authorization: Bearer {SEMESH_APP_API_KEY}`. The namespace is determined by the **authenticating key**, not by any header: the injected runtime key (`SEMESH_APP_API_KEY`) scopes you to `apps/<app_id>/`, so your app only ever sees its own objects. (A plain account/owner key used directly — e.g. while testing from the CLI — is namespaced per-owner under `apps/owner-<owner_id>/` instead; deployed apps always use the runtime key, so this only matters for ad-hoc testing.)
- Write: `PUT {SEMESH_BASE_URL}/v1/storage/objects/<key>` with the file bytes as the body (`Content-Type` sets the stored type).
- **Read: `GET {SEMESH_BASE_URL}/v1/storage/objects/<key>`** — streams the bytes back directly (Bearer-auth). Add `?presign=true` (or `POST /v1/storage/sign {"key":"..."}`) only if you want a short-lived shareable URL instead of the bytes.
- List: `GET {SEMESH_BASE_URL}/v1/storage/objects?prefix=&limit=`. `DELETE .../objects/<key>` is an **immediate, irreversible provider-level delete**: it calls the storage provider's delete directly and answers `{"success": true, "data": {"delete_mode": "irreversible_provider_delete", "recoverable": false, ...}}` — the response states the irreversibility in machine-readable form. There is no tombstone, no recovery receipt, and no restore endpoint; the object bytes are gone. Copy anything you may need before deleting. Deletion also does not revoke an already-issued short-lived URL, which stays valid until its own TTL expires.

### Wire one service to another with `@app:` (don't hardcode sibling URLs)

A multi-service app (e.g. frontend + backend) wires the dependency by reference, not by pasting a URL:

```json
{ "stack": { "runtime": { "env": { "NEXT_PUBLIC_API_BASE_URL": "@app:my-api" } } } }
```

On deploy `@app:my-api` resolves to that app's live URL **before the build** (so it bakes into build-time `NEXT_PUBLIC_*`/`VITE_*`) and keeps working across the sibling's redeploys. Hardcoding the sibling URL breaks the moment it changes.

## Buy And Connect A Custom Domain

Give an app a real domain (e.g. `yourbrand.com`) end-to-end: the agent searches + quotes, a **human pays** via a confirm link, then the platform registers it and wires DNS + TLS automatically. Every deployed app already gets a free `<name>.semesh.app` subdomain — this is for a domain you own.

```bash
# 1. Search availability + real prices (no money, no commitment)
semesh search "buy and connect a custom domain" --json
semesh show <domain-unit-id> --json
semesh quote <domain-unit-id> --action <availability-action-id> \
  --input '{"query":"yourbrand","tlds":["com","io","xyz"]}' --json
semesh call <domain-unit-id> --action <availability-action-id> \
  --from-quote <availability-quote-file> \
  --input '{"query":"yourbrand","tlds":["com","io","xyz"]}' \
  --idempotency-key <availability-key> --wait --json

# 2. Quote ONE exact domain → returns a confirm_url. Pass app_id to auto-connect on purchase.
semesh quote <domain-unit-id> --action <registration-action-id> \
  --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' --json
semesh call <domain-unit-id> --action <registration-action-id> \
  --from-quote <registration-quote-file> \
  --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' \
  --idempotency-key <registration-key> --wait --json
# → { "confirm_url": "https://semesh.io/domains/confirm/<token>", "price_aev": 1299, ... }

# 3. A HUMAN opens confirm_url, signs in, reviews price + registrant + agreement, clicks Confirm & Pay.
#    This is the ONLY step that moves money. The agent must STOP here — never auto-pay, never set ?confirm=true.

# 4. Connect a domain you ALREADY own to an app (or re-connect):
semesh quote <domain-unit-id> --action <attach-action-id> \
  --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' --json
semesh call <domain-unit-id> --action <attach-action-id> \
  --from-quote <attach-quote-file> \
  --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' \
  --idempotency-key <attach-key> --wait --json

# 5. Your ICANN right: get the EPP auth code to transfer the domain OUT to another registrar:
semesh quote <domain-unit-id> --action <transfer-authcode-action-id> \
  --input '{"fqdn":"yourbrand.com"}' --json
semesh call <domain-unit-id> --action <transfer-authcode-action-id> \
  --from-quote <transfer-authcode-quote-file> --input '{"fqdn":"yourbrand.com"}' \
  --idempotency-key <transfer-authcode-key> --wait --json
```

Rules that matter:
- **Agent quotes, human pays.** Domain registration is irreversible spend, so it requires an explicit human click on the confirm page (price breakdown, ICANN registrant contact, and a separate registration-agreement consent are all shown there). An agent that tries to self-confirm is rejected by design.
- **The human types the exact domain.** Agents must not free-text-invent names; trademark / typosquat / look-alike (IDN homoglyph) names are hard-rejected at quote to keep you out of UDRP/ACPA trouble.
- **After payment it's automatic:** the domain registers, a Cloudflare-for-SaaS custom hostname + DNS records are written for you, TLS issues automatically, and the app serves on the domain within minutes — no dashboard, no nameserver fiddling.
- **Pricing is cost-plus and shown up front** (`registration_price_aev`); a domain is **non-refundable once registered** (a failed/never-completed registration is auto-refunded). Registrant contact you enter once is remembered for next time.

## Optional App API Or CLI Command

Use App APIs and App Commands only when the app should expose a route or command for other users or agents.

```bash
semesh apps api publish <app-id> --file app-api.json --json
semesh apps commands publish <app-id> --file app-commands.json --json
semesh search "<published app API or command purpose>" --json
semesh show <published-unit-id> --json
semesh quote <published-unit-id> --action <action-id> --input '{}' --json
semesh call <published-unit-id> --action <action-id> --from-quote <quote-file> \
  --input '{}' --idempotency-key <stable-key> --wait --json
```

**Resale-chain contract (App API / Hosted Agent Unit Actions):** each platform-mediated hop is depth-capped (default 5) and owner cycles (A→B→A) are rejected with 403 `chain_depth_exceeded` / `owner_cycle_detected`; markup is earned **once per distinct owner in the whole chain**, so re-wrapping your own layer never double-charges. If your app receives an `X-Semesh-Call-Chain` header on an inbound invocation, forward it unchanged on every Semesh Action call you make while serving that request — it is a signed ancestry token; dropping it only shortens your own chain accounting. **Hosted agents** get this automatically: the built-in runtime reads `SEMESH_CALL_CHAIN` from the sandbox env and forwards it on every nested Unit Action, so agent→agent chains are counted end-to-end with no code on your part. A custom agent runtime must forward `SEMESH_CALL_CHAIN` as the `X-Semesh-Call-Chain` header itself.

## Hand Off To A Human

When a task needs human judgment (confirm, sign in, pay, review), create a login-gated continuation URL instead of guessing:

```bash
semesh handoff create <provider-or-app> <action-id> --input '{...}' --json
semesh handoff get <session-id> --json
semesh open <command-ref> --input '{...}'   # open an app command's web/handoff page with your CLI identity
```

`<provider-or-app>` is a provider name or your **app id** (`app_...`) — NOT a raw URL; pass the app whose `/api/handoff/sessions` endpoint should receive the session.

Give the returned URL to the user, then poll `handoff get` for the result.

**If the provider is your own endpoint/app, it must speak the handoff webhook contract.** On `handoff create` the platform POSTs the session (JSON body; headers include `X-Semesh-Handoff-Session`, `X-Semesh-Caller-Account`, and an HMAC `X-Semesh-Handoff-Signature: sha256=<hex>`) to the provider — an app provider receives it at `{app base}/api/handoff/sessions`. The endpoint MUST respond with JSON containing **`continuation_url`** (top-level, or nested under `data`) — the human-facing URL the platform hands back to the caller. Any response without `continuation_url` fails the create with `handoff endpoint did not return continuation_url`. A relative `continuation_url` is resolved against the provider's base URL. The webhook body is exactly `{session_id, action_id, input, metadata, expires_at}`. **There is currently no provider completion callback.** The platform does not send a `completion` object, does not mint a provider redeem token, and does not expose a public `POST /handoff/{id}/redeem`; the only redeem route is `POST /internal/v1/handoff/sessions/{id}/redeem`, which requires a platform-internal token an external provider never holds. Consequently a provider can show its page via `continuation_url`, but **cannot close the session** — it stays `ready` until its TTL expires. Do not build against a redeem callback yet. For a paid `app-command` that routes through `needs_handoff`, this also means the hold is not captured by the provider path and is released by the settlement reaper.

## Publish Your Own Service Unit

Author directly against the Unit-native control plane. A Draft is mutable under compare-and-swap; a published Release is immutable and exposes only nested Actions. Private configuration values stay in configuration records and never enter the Draft or Release.

```bash
semesh units create --from <openapi.json-or-url> --json
semesh units list --mine --json
semesh units draft get <unit-id> --json

# Store an upstream secret without putting it in the Unit document.
printf '%s' "$UPSTREAM_API_KEY" | semesh configurations create \
  --kind api-key --audience <upstream-origin> --value-stdin --json
semesh configurations list --json
semesh configurations status <configuration-id> --json

# Edit from the returned Draft, then preserve its ETag for CAS.
semesh units draft put <unit-id> --if-match <etag> --file unit.json --json
semesh units validate <unit-id> --json
semesh units test <unit-id> --json
semesh units publish <unit-id> --if-match <etag> --json
semesh units publication get <publication-id> --json
```

Every public Action must declare input/output, executable examples, effect and confirmation policy, exact or metered price/ceiling, requirements, retry/idempotency, wait/result, and errors. Passing mechanical protocol checks publishes and becomes discoverable automatically; there is no default human approval queue. If publish returns a nonterminal PublicationOperation, preserve its `publication_id` and read that operation instead of starting a second publish.

Use lifecycle commands only for the exact owned Unit the user named:

```bash
semesh units lifecycle get <unit-id> --json
semesh units pause <unit-id> --json
semesh units resume <unit-id> --json
semesh units archive <unit-id> --json
semesh units delete <unit-id> --json
```

Pause, archive, and delete can change existing callers and require the contract's high-impact/destructive confirmation boundary. Rotate a configuration with `semesh configurations rotate <configuration-id> --value-stdin --json`; never print the value. Do not fall back to an older service authoring command or dynamic-service route when the Unit-native control plane is unavailable.

After publication, return to scoped Search, preserve its Catalog token through Unit Detail, select a nested Action, then quote and invoke the canonical Unit Action. An authoring or PublicationOperation identifier is never a second consumer execution identity.

## Publish A Hosted Agent

```bash
semesh agents create --name helper --template hermes --public --max-budget 50 --json
semesh agents deploy agent_123 --project ./agent-dir --json
semesh agents pause agent_123 --json
semesh agents get agent_123 --json
semesh agents resume agent_123 --json
semesh agents reconcile agent_123 --json
```

Templates differ in setup: **`hermes` auto-deploys a version on create**, while `simple_workflow` needs its own deployed version before it is eligible for Catalog projection. Deployment does not create a second Hosted Agent execution protocol: after the public Catalog slice appears, find its Unit and nested Action through normal Search, then use the canonical Action quote/invoke/Invocation journey. Delete a hosted agent you no longer need with `DELETE /v1/agents/{agent_id}` (or `semesh agents delete <agent-id>` on a current CLI — older installs lack the subcommand, the HTTP route always works): it stops listing and invoking, while its invocation history stays readable for billing audit.

`agents get` is the authoritative read used for lifecycle recovery. It is a read-only GET: it changes neither Agent source nor Catalog state, and it may be safely retried after a transient transport or observation failure. It prints only after a bounded response proves the exact Agent identity and a valid source status. It reports Agent source state only; it does **not** prove the current Catalog discovery state.

`agents pause` commits the owned Agent's source status as paused, blocks new invocation, and synchronizes withdrawal of any active Catalog slice while retaining invocation history and billing audit. `agents resume` commits the source status as active and synchronizes only the Catalog projection for which the current Agent and latest version remain eligible; resume alone does not make an ineligible or private Agent discoverable. A successful pause or resume response is returned only after Catalog synchronization completes, and the CLI prints it only after the exact Agent and requested source status pass validation. Pause and resume each send one POST at most, and the CLI never automatically replays either mutation after a lost response or an untrusted 2xx.

If a pause or resume response is lost or untrusted, its source outcome is unknown: run `agents get <agent-id> --json` to read the authoritative source, use normal Search/discovery readback when Catalog visibility matters, and explicitly reconcile a stale projection instead of repeating the source mutation to force a green result. `active_catalog_unavailable` can mean the source mutation already committed, so wait for Catalog authority and use the returned reconcile action rather than replaying pause or resume. `agent_mutation_conflict` means the rejected mutation raced with another source change: GET the exact Agent, merge the current state with the intended change, and create a new explicit mutation.

`agents reconcile` does not change the Agent source state. It reads that authoritative state and projects it back into the active Catalog after a partial lifecycle/publication result. Reconcile also sends one POST at most and prints success only after the response proves the exact Agent and `reconciled:true`. If its response is lost, read source with `agents get`, inspect Catalog state through normal Search/discovery rather than treating `get` as Catalog proof, then explicitly decide whether another reconcile is needed.

A Hosted Agent Action returns the shared Invocation envelope and its declared result/events schema. If it terminates cleanly at its step budget with `max_steps_exceeded`, read that Invocation's result and events; if the user wants continuation, make a new canonical Action quote/invoke with a higher `max_steps` in the Action input. A genuine infrastructure failure (sandbox crash, timeout) follows the same Action failure and recovery contract; a non-JSON 502 is not a readable result or authority to mint a new key.

## Share Local Compute As A Worker

```bash
semesh worker start --name local-model --public --model local/model --endpoint http://localhost:11434/v1/chat/completions --credits-per-second 0.05
semesh worker status <worker-id> --json
semesh worker pause <worker-id> --json
semesh worker resume <worker-id> --json
```

`worker status` is an owner-only exact read. A foreign or missing worker id is reported as
`worker_not_found`, and the CLI prints only after a bounded response proves the requested worker id
and a valid lifecycle state. Heartbeat freshness is applied at read time: a stale heartbeat is
reported as `offline` with `accepting_jobs:false` without persisting that projected state.

`worker pause` stores a sticky drain intent. The poller keeps heartbeating but takes no new leases;
jobs leased before pause may finish. Ordinary and metadata-bearing heartbeats cannot clear pause or
stop. Only explicit `worker resume` clears pause. Stop retires that exact worker id and cannot be
cleared by heartbeat, resume, or same-id registration; run `worker start` again to register a new
worker id. These lifecycle acknowledgements do not prove global cross-replica linearizability.

Other users can find published public worker offers through service search.

Pricing is **fractional per compute-second** (`--credits-per-second`); a successful Action is billed from its declared rate and measured duration. Consumer delivery, status and settlement are read only through the canonical Invocation and its receipt; a backing Worker Job is control-plane evidence, not a caller handle or second observation identity. Omitting the rate makes the offer **free** (callers run it at 0 Aev) — the CLI prints a stderr note when that happens, so a silent free offer is never an accident. Charges can be sub-1-Aev — a short Action at a small rate (e.g. 0.05/s × 4s = 0.2 Aev) may not visibly move an integer balance readout, so verify the exact capture in the terminal Invocation receipt, not a balance delta. A caller that owns the offer pays the cost normally (no owner-earnings rebate to self); owner earnings only apply when a *different* account calls your offer. The `worker start` process keeps the offer online while it polls; stop it with Ctrl-C, or from another shell run `semesh worker stop <worker-id>` — that takes the worker and its offers offline and signals a still-running poller to exit (so it won't re-register itself online).

To lend your **logged-in local coding agent** (Claude Code / Codex) instead of a model endpoint, use `semesh worker lend codex --allow <caller-login-email>` (repeat `--allow` per caller), or `semesh worker lend codex --friends` to permit **all your accepted friends** at once (see "Add Friends And Share Compute" below). See the next section for how the caller then reaches it.

## Use A Worker Someone Lent You (authenticated accessible scope)

If someone **lent** you their machine's compute (e.g. `semesh worker lend codex --allow you@example.com`), authenticate and discover it in the actor-specific `scope=accessible` Catalog view. It must not appear in anonymous `scope=public`. A lender email, Worker source id, or offer id may help Search recall, but none is a public execution identity:

```bash
semesh search "lent coding agent from <lender>" --scope accessible --json
semesh show <worker-unit-id> --scope accessible --json
semesh quote <worker-unit-id> --action <coding-action-id> --scope accessible \
  --input '{"prompt":"Write a Python is_prime(n). Only code."}' --json
semesh call <worker-unit-id> --action <coding-action-id> --scope accessible \
  --from-quote <quote-file> \
  --input '{"prompt":"Write a Python is_prime(n). Only code."}' \
  --idempotency-key <stable-key> --wait --json
```

The input for a lent coding agent is `{"prompt":"<your task>"}`. Preserve the accessible Search token, exact Worker Unit Action and returned `invocation_id`; observe the Invocation rather than a Worker Job or email-qualified route. If the Unit is absent from your authenticated accessible view, there is no authorized call path—ask the lender to fix publication/allowlist state instead of guessing another route. A `worker_unavailable` means the selected Action currently lacks healthy capacity; it never authorizes a different execution route.

## Add Friends And Share Compute With Them

`semesh friend` is your trust graph: add another account as a friend (two-sided consent), and any **friends-visibility** worker offer you publish becomes callable by every accepted friend — share your logged-in coding agent or a model endpoint with everyone you trust at once, without listing each caller. Friendships are between accounts, addressed by **login email** (find yours with `semesh whoami`).

```bash
semesh friend add bob@example.com           # send a request — bob must accept (no auto-friend)
semesh friend accept alice@example.com      # accept a pending incoming request
semesh friend list [--pending]              # accepted friends; --pending shows requests; --status blocked too
semesh friend remove bob@example.com              # unfriend — immediately revokes their access to your friends offers
semesh friend block spammer@example.com           # block (prevents requests/calls); `friend unblock` reverses it
```

Create a group Conversation only from accepted trust identities. In `friend list --json`, use the
other side's stable `requester` or `addressee_owner` value from an accepted edge; do not substitute
an email address for a group member owner id. The authenticated creator is read from the server and
included automatically. Every initial or added member still passes the server-owned trust gate, and
only the group owner can add or remove another member. A newly added member sees messages from their
joined membership generation onward, not earlier history.

The current group CLI is exactly `create`, `list`, `show`, `add`, `remove`, `leave`, `send`,
`messages`, `read`, and `unread`. The five exact-target result commands `show`, `send`, `messages`,
`read`, and `unread` first prove that the requested id is a currently accessible group in the
authenticated 500-conversation inbox window; a DM, an inaccessible group, or a target missing from a
full window fails closed before any effect. `group list`, `show`, and
`unread` read that authoritative inbox and own no membership, message, cursor, or unread cache:
removal or leave makes all five exact-target commands unavailable on the next read. A result with
`complete:false` reached the 500-conversation server window; the server has no pagination yet, so it
is not a complete enumeration. If a full 500-item window omits the target, the lookup is incomplete
and no follow-up Action is sent. If the target is present in that full window, the matched item is
exact; `group unread` may still report `inbox_window_complete:false` because only the surrounding
enumeration is incomplete. Recover by inspecting `semesh inbox --limit 500 --json`; do not guess
a group id. Removing a member or leaving is a direct authenticated revocation and needs no second
confirmation. The owner must remove every other active member before leaving. Group
messaging and read cursors still use the canonical Conversation Actions, which recheck membership at
their effect seam; `group send` is text-only, so use `msg send` for attachments:

```bash
semesh group create <group-id> --member <owner-id> [--member <owner-id> ...] --json
semesh group list --json
semesh group show <group-id> --json
semesh group add <group-id> <owner-id> --json
semesh group remove <group-id> <owner-id> --json
semesh group leave <group-id> --json
semesh group send <group-id> --text "Release ready." --json
semesh group messages <group-id> --after 0 --limit 100 --json
semesh group read <group-id> <observed-sequence> --json
semesh group unread <group-id> --json
```

Send text to an existing Conversation, or read incoming work from the same Conversation authority.
`msg send` does not create a Conversation or a second message store; it returns the canonical Message
identity from the existing Conversation Action. `inbox` derives unread counts from the server-owned
monotonic read cursor; it is a polling projection, not a second notification store or an online-presence
signal. `msg unread` reads one exact Conversation from a single authenticated 500-item inbox window,
validates the whole window before printing, and reports `last_sequence`, the actor `read_cursor`, the
derived `unread_count`, and `inbox_window_complete`; it does not advance the cursor or send a follow-up
mutation. A target missing from fewer than 500 items is not currently accessible. A target missing from
a full 500-item window fails incomplete instead of reporting a false zero; a matched target in that full
window is exact but reports `inbox_window_complete:false`. Open the exact conversation before advancing
only a sequence you observed:

```bash
semesh msg send <conversation-id> --text "Please review the release." --json
semesh inbox --limit 20 --json
semesh msg list <conversation-id> --after 0 --limit 100 --json
semesh msg unread <conversation-id> --json
semesh msg read <conversation-id> <observed-sequence> --json
semesh msg unread <conversation-id> --json  # exact authoritative readback; repeated read cannot move the cursor backward
```

To send an attachment, first upload a private File asset, then pass its stable `data.id` to `msg
send`; do not pass a one-time model-input URL. A message may contain text, up to 32 distinct
`--file-id` values, or both. The receiver reads the server-issued `grant_id` from `msg list`, then
downloads to an explicit new path. The CLI never prints the one-time transfer capability, never puts
it in a URL, verifies the exact size/hash/content type, and publishes the local file only after the
whole download succeeds; it will not overwrite an existing path:

```bash
semesh files upload ./plan.pdf --purpose service_input --retention 24h --json
semesh msg send <conversation-id> --text "Review this" --file-id <data.id> --json
semesh msg list <conversation-id> --after 0 --limit 100 --json  # read attachments[].grant_id
semesh msg attachment download <conversation-id> <grant-id> --output ./plan.pdf --json
semesh msg attachment revoke <conversation-id> <grant-id> --json
```

Only the sender can revoke a grant. Revocation blocks future transfer issuance; a capability already
issued to an authorized member remains usable only for its short bounded lifetime. If an issue or
download response is lost, do not guess or reuse a token: issue a new download from the same grant.

An unknown conversation and a conversation you no longer belong to both fail closed as not found. Do
not retry a failed read by guessing a later sequence; list again and use an observed sequence.

Then lend to ALL accepted friends in one shot (no per-caller `--allow`):

```bash
semesh worker lend claude-code --friends --credits-per-minute 20
```

A friend uses authenticated `scope=accessible` Search and token-pinned Detail, then quotes and invokes the returned Unit Action. Your login email may help Search recall the offer, but it is never an execution identity. Friend-only offers never appear in anonymous `scope=public` Search, and accessible results are actor-specific state that must not enter a shared cache. The live trust graph gates access: unfriend or block and access is revoked at once. The friend pays for the metered sandboxed Action and you earn according to its receipt.

## Read Contracts In Your Own Agent Runtime

For Service Unit work, use scoped Search and token-pinned Unit Detail (or the equivalent canonical MCP projection) to obtain one current nested Action contract. Do not export or memorize a second ToolSpec identity. For Platform Actions such as deployment, friends, files, connections, and resource lifecycle, use the current CLI help and this agent guide; they are not Service Units and must not be disguised as catalog entries.
