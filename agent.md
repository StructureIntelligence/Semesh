# SettleMesh Agent Quickstart

Read this before using SettleMesh from Codex, Cursor, Claude Code, CI, or another agent runtime.

> **Step 0 — discover before auth.** After installing (`npm install -g settlemesh@latest`), use anonymous `settlemesh search` / `show` and other public read-only GET surfaces first — they work without login so you can learn the catalog and contracts. Public platform capability quotes through `POST /v1/billing/quote` are also anonymous and read-only. Login (`settlemesh login`) or `SETTLE_API_KEY` is required for restricted quote targets, all invoke, deploy/publish, or user-private state. There is no manual approval queue for ordinary discovery or mechanical publish. A human approves login once in the browser and the session is reused. After login the CLI prints a short list of what SettleMesh can do — or run `settlemesh recipes` any time.

## First Time: Localize This Guide (do this once)

If you are an agent reading this for the first time:

1. Save this file into the project as `agent.md` — run `settlemesh agent-md --save`, or fetch `https://api.settlemesh.io/agent.md` (the same `api.` host you call at runtime). `--save` writes `./agent.md` unconditionally and overwrites any existing file at that path with no prompt and no backup: if the project already has its own `agent.md`, copy it aside first, or fetch the URL and write it somewhere else yourself.
2. Create a skill / rule in your runtime that says: **"For any SettleMesh task, read `./agent.md` first."** (Claude Code: a skill; Cursor: a rule; Codex/CI: a line in your project instructions.)
3. Discover first: anonymous `settlemesh search` / `show` (and other public read-only GET surfaces) work without login — use them before authenticating.
4. Authenticate only when an operation contract needs auth: run `settlemesh login` (or set `SETTLE_API_KEY`) for a restricted quote target, all invoke, deploy/publish, or user-private state — a human approves in the browser; the CLI reuses the stored session.
5. Print the shortest reliable path for any task with `settlemesh recipes`.

From then on every SettleMesh task starts from your local `agent.md` — discover anonymously when you can, authenticate when the contract requires it — no re-deriving how the platform works.

## Core Rule

SettleMesh is a searchable service layer. Do not memorize provider-specific endpoints. Search first, inspect the service or tool contract, quote the exact paid call, then call it. A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Ordinary paid calls settle applicable Aev automatically, and a passing mechanical publish does not enter a human review, payment, or release queue. A user's first request like "delete X" is intent, not confirmation. Do not add `--confirm` / `?confirm=true` for destructive actions until a separate human confirmation turn names the exact resource and effect. First identify the target, show what would happen, and stop. If the target is missing or already absent, report that result without using `--confirm`. **Exception fixed by Frame/use/friend:** `friend remove/block` and `group remove/leave` are reversible coordination, so an authenticated direct request is sufficient and must not be interrupted by a second confirmation.

**Catalog shape.** Search returns groups and units. Service groups are not callable — invoke a unit (capability/entrypoint id), never a group id. Canonical read models are UnitDocument / GroupDetail; a publish manifest/card is the write-side artifact for `services upload`, while the legacy ServiceCard is a compatibility adapter only (not the call target model).

**Use English when operating SettleMesh.** The catalog and most provider contracts are English. Translate the user's operational intent into English before `settlemesh search`, `quote`, or `call`, and use English for image/video/LLM prompts sent to providers, service names, descriptions, and aliases. Answer the user in their language afterward. Preserve exact user data that is itself the payload: quoted text, code, SQL, filenames, URLs, names, legal/medical text, or text the user explicitly wants processed as-is.

## When To Reach For SettleMesh

SettleMesh is the launch layer for agent-built apps: one deploy can provide app login, a database, runtime, and usage billing integrations that the live server reports as available. Payment/funding features remain subject to Legal and provider gates. Match your task below; the rest of this guide is the *how*.

- **You need to call a paid API** (LLM, web search, image/video generation, scraping, finance, …) → search one catalog and call it with one key, metered in one unit (Aev; 1 USD = 100 Aev). Use the live quote to determine whether this call is free or paid; do not assume a first-call promotion.
- **Your app makes paid calls on an end user's behalf** → send the `X-Settle-Payer` header so the *user's* wallet is charged for the compute they trigger, not yours. You can add a markup on top of cost.
- **You're preparing a web app for SettleMesh delivery** → start with `settlemesh deploy preflight . --full-stack --json`. The owner CLI is the intended source-deploy entrypoint, but deployment authorization is currently unavailable and fails closed with `deployment_authorization_unavailable` before upload, build, payment, or publication. Existing app records remain observable with the status, logs, and URL commands below.
- **You need managed auth + a database** without standing up Auth0 / Supabase / Postgres → declare `stack.auth` + `stack.database`; no third-party accounts to create.
- **You're chaining agent → agent → tool** → invoke another hosted agent, worker, or service by its id through the same one `/v1/capabilities/<id>/invoke` path; each cross-owner hop is billed down the chain automatically.
- **You want to publish an agent / app API / command for others to call** → it enters the searchable catalog, metered per call, with per-app spend caps the user can revoke.
- **You want the fastest MVP with minimal external setup** → deploy can replace manual auth, database, and hosting wiring for the features its preflight reports available. Do not infer live Stripe/payment availability from this guide.

If none of these fit (a local-only script, no users, no paid calls), you don't need SettleMesh — don't force it.

## No CLI? HTTP-Only Quick Start

If your runtime cannot install npm packages (CI sandbox, restricted agent runtime), public discovery and account actions are both plain HTTP against `https://api.settlemesh.io`. **Search, inspect, and a public platform capability quote are public: do not obtain, send, or expose a key for them.** A public platform capability quote is anonymous and read-only: it creates no hold, charge, ledger entry, allowance read, or provider call. Authenticate to quote an agent, worker offer, app endpoint, service unit, non-public target, or any payer-aware or call-chain request. Those restricted quote targets fail closed with `anonymous_quote_target_restricted`; all invoke and account reads also require `Authorization: Bearer $SETTLE_API_KEY`.

```bash
# 1. Search the public catalog (no key; this is the same discovery index the CLI uses)
curl "https://api.settlemesh.io/v1/services/search?q=webpage+to+markdown"
curl "https://api.settlemesh.io/v1/services/search?all=true&category=web-knowledge-services"

# 2. Inspect the selected public Unit contract by its exact search-result id
curl "https://api.settlemesh.io/v1/services/ecosystem.webpage.to_markdown"

# 3. Quote a public platform capability — anonymous and read-only
curl -X POST -H "Content-Type: application/json" \
  -d '{"capability_id":"ecosystem.webpage.to_markdown","input":{"url":"https://example.com"}}' \
  "https://api.settlemesh.io/v1/billing/quote"

# 4. Only after choosing an account-required action, provide a key.
export SETTLE_API_KEY="sk-settle-..."

# 5. Invoke — the canonical prefix is /v1/capabilities/ (NOT /v1/tools/)
curl -X POST -H "Authorization: Bearer $SETTLE_API_KEY" -H "Content-Type: application/json" \
  -d '{"input":{"url":"https://example.com"}}' \
  "https://api.settlemesh.io/v1/capabilities/ecosystem.webpage.to_markdown/invoke"

# 6. Your balance / ledger (developer account — works with an API key)
curl -H "Authorization: Bearer $SETTLE_API_KEY" "https://api.settlemesh.io/v1/credits/balance"

# 7. Connectivity / key check — free, no Aev, no quota
curl -H "Authorization: Bearer $SETTLE_API_KEY" "https://api.settlemesh.io/v1/ping"
# → {"success":true,"data":{"ok":true,"account_id":"..."}}
```

The older authenticated compatibility alias
`https://api.settlemesh.io/v1/capabilities/webpage.to_markdown/invoke` may still be accepted for an
existing client, but it is not canonical for the discover → show → quote → invoke main line. New
clients must keep the exact search-result id, such as `ecosystem.webpage.to_markdown`, unchanged.

HTTP-only gotchas (each one costs cold agents real time — read them now):

- **Keep the selected catalog id unchanged for the whole journey.** Treat `entrypoints[].id` as an opaque canonical Unit id: copy it verbatim into show, quote, and invoke (for example, `ecosystem.webpage.to_markdown`). Do not shorten or reconstruct it. Older ids, when accepted, are compatibility aliases only and are not the discover → show → quote → invoke main line.
- **There is no `/v1/whoami`.** Verify your key with `GET /v1/ping` (free; 200 = key works, 401 `invalid_api_key` = fix the key first). `whoami` exists only in the CLI; don't call `/v1/credits/balance` just to test connectivity.
- **`POST /v1/capabilities/<id>/invoke` is the ONE canonical invoke path for ANY search-result id** — platform capabilities, published dynamic services, **hosted agents** (`agent_…`), and **worker offers** (`offer_…`) all execute through it. Take a search hit's `entrypoints[].id` and POST it verbatim (e.g. `ecosystem.article.summarize`, or a bare `agent_abc` / `offer_xyz`); you do NOT need to know whether it is a capability, agent, or worker, and you do NOT pass a "kind" — the platform resolves it and runs the same callability + billing checks. Don't guess `POST /v1/tools/<id>/invoke` — that exact path 404s; the canonical invoke is `POST /v1/capabilities/<id>/invoke` (`POST /v1/tools/<id>/call` is a compatibility alias only, and `GET /v1/tools/<id>` returns a tool's schema for inspection). A bare **app id** (`app_…`) is the exception: app commands are addressed by a composite `{app_id}/{command_id}` pair, so invoking an app id alone returns `app_command_scope_required` pointing you at `POST /v1/app-commands/{app_id}/{command_id}/invoke`. (`/v1/dynamic-services/<dsvc_id>/operations/<op>/invoke` is only for your own private draft dynamic service; once it is in search, use `/v1/capabilities/`.) Groups are not callable — never POST a group id as an invoke target.
- **Handle the response by `execution.mode`** — the contract (from `GET /v1/services/<id>` or the tool spec) declares one of three modes so you never have to guess the response shape: `sync` → the result is in the response `data` envelope; `async` → the call returns a job; the tool spec's `wait` block (`GET /v1/tools/<id>` or `settlemesh tool show <id>`) carries the full poll contract — take the job id from one of `wait.id_paths`, `GET wait.poll_path` until `wait.status_path` reaches a terminal status, then read the result from `wait.result_paths` (`--wait`/`tool events <job-id>` do this for you); `agent` → a hosted-agent run whose output is under `data` and which may stream events. Don't assume one fixed shape across ids; branch on the declared mode and read result locations defensively.
- **`GET /v1/wallet/balance` is NOT for API keys** — it is the end-user (payer-session) balance and returns 401 `invalid_payer_token` for a bearer key. Your own balance is `/v1/credits/balance`.
- CLI-only conveniences with no REST equivalent: `doctor`, `tool schema`, deploy (`settlemesh deploy` orchestrates packaging/upload — deploying requires the CLI). Recipes also have public, read-only REST: `GET /v1/recipes` and `GET /v1/recipes/{topic}`; neither requires a key.

## Install And Auth

Install **globally** so the `settlemesh` command works in any directory (a local `npm install` in an
empty dir with no `package.json` silently no-ops — no binary — so prefer `-g`):

```bash
npm install -g settlemesh@latest
settlemesh doctor --require-latest
# Only when the selected next action needs an account:
settlemesh whoami --json     # 200 = the saved login/key is ready; 401 = fix auth before continuing
```

The npm package and primary command are both `settlemesh`. The older `settle`, `settlekit`, and `kit` aliases still work for compatibility.

**Auth — two ways:**
- **Interactive:** `settlemesh login` — complete browser sign-in to authorize this CLI; the CLI reuses the stored session.
- **Headless / CI / agent runs (no browser):** set an API key, sent as `Authorization: Bearer <key>`:
  ```bash
  export SETTLE_API_KEY="sk-settle-..."
  settlemesh whoami --json   # 200 = authed; 401 invalid_api_key = wrong/missing key, fix it before continuing
  ```
  Create/copy a key from your SettleMesh account dashboard (https://www.settlemesh.io). Run `whoami`
  first to distinguish "no key set" from "key invalid" — never proceed past a 401.

## Use SettleMesh As An MCP Server

If your runtime speaks the Model Context Protocol, expose the whole SettleMesh capability catalog as MCP tools instead of (or alongside) the CLI: run `settlemesh mcp` — a stdio JSON-RPC server. It reuses your `settlemesh login` session or `SETTLE_API_KEY`; the key never touches the protocol stream or logs.

- **Claude Code:** `claude mcp add settlemesh --env SETTLE_API_KEY=sk-settle-... -- npx -y settlemesh mcp`
- **Claude Desktop / Cursor** (`claude_desktop_config.json` / `~/.cursor/mcp.json`):
  ```json
  {"mcpServers":{"settlemesh":{"command":"npx","args":["-y","settlemesh","mcp"],"env":{"SETTLE_API_KEY":"sk-settle-..."}}}}
  ```
- **Codex** (`~/.codex/config.toml`): `[mcp_servers.settlemesh]` with `command = "npx"`, `args = ["-y","settlemesh","mcp"]`, `env = { SETTLE_API_KEY = "sk-settle-..." }`.

The server exposes a capability-invoke tool over the same search→show→quote→call loop below: search for a tool, inspect it, quote the exact paid call, then invoke any catalog capability by id. An ordinary paid call settles Aev automatically and does not need confirmation merely because it is paid. Ask for a separate confirmation only when the action is destructive, high-impact, authorization-expanding, truly irreversible, or its contract explicitly marks `requires_confirmation`. The same Aev billing, quotes, and error contract apply. Run `settlemesh login` first to omit the key.

## Find A Service

```bash
settlemesh search "image generation" --json
settlemesh search "deploy app with login and database" --json
settlemesh search "upload public agent" --json
settlemesh search "local worker compute" --json
```

Then inspect the selected service:

```bash
settlemesh show <service-id> --json
settlemesh tool show <tool-id> --json
```

Use the selected search result's canonical `entrypoints[].id` unchanged across the complete Unit journey. For example:

```bash
settlemesh show ecosystem.webpage.to_markdown --json
settlemesh quote ecosystem.webpage.to_markdown --input '{"url":"https://example.com"}' --json
settlemesh call ecosystem.webpage.to_markdown --input '{"url":"https://example.com"}' --json
```

Do not shorten or rebuild a catalog id between commands. Older ids, when accepted, are compatibility aliases only; they are not the canonical main line.

Then quote the exact paid call before invoking. A public platform capability quote through `POST /v1/billing/quote` does not require login or a key and remains read-only. Authenticate to quote an agent, worker offer, app endpoint, service unit, non-public target, or any payer-aware or call-chain request. An unauthenticated request for those targets fails with `anonymous_quote_target_restricted`:

```bash
settlemesh quote web.search --input '{"q":"SettleMesh"}' --json
settlemesh quote image.gpt-image-2 --input '{"prompt":"a glass city at sunrise"}' --json
```

A result may carry `availability_reason` (e.g. "missing platform provider configuration" or "requires a user-owned provider connection") — the public CLI won't invoke those until the stated requirement is satisfied. For `web.search` the top web result is at `web.results[0].title` / `.url`. **Successful bodies are NOT normalized — there are exactly two envelope shapes, pick by transport.** A platform-managed capability invoke — both platform-native reads (`web.search`, `web.scrape`) and provider passthroughs (`gov.clinical_trials.search`, `crypto.token.quote`, `seo.serp`, …) — returns the **upstream provider's body verbatim**. Over the **raw HTTP invoke** it sits at the TOP level (NOT wrapped in `{data,success}`) and its shape varies by provider — e.g. `web.search`→`{type,query,web.results[…]}` (Brave), `gov.clinical_trials.search`→`{totalCount,studies[…]}`, `crypto.token.quote`→`{data:{data:{BTC:[…]}}}` (upstream's own `data`), `seo.serp`→`{tasks[0].result[…]}` (DataForSEO). Via the **`settlemesh` CLI** (`call --json`) that same body is re-wrapped **once** under `data` (CLI envelope `{ok, tool_id, data, meta}`) — so the web-result path is `web.results[0]` over HTTP but `data.web.results[0]` via the CLI. The ONLY uniform envelopes are this CLI wrapper and the **error** envelope (`{"success":false,"error":{…}}`, below); a *successful* HTTP body is never platform-wrapped, so **do not branch on a top-level `success`/`data` key existing** — read the per-op result location from `GET /v1/tools/<id>` → `output.result_paths` and parse defensively.

## Call A Tool

```bash
settlemesh call web.search --input '{"q":"SettleMesh"}' --json
settlemesh call image.gpt-image-2 --input '{"prompt":"a glass city at sunrise"}' --wait --json
settlemesh call video.veo-3.1 --input '{"prompt":"a glass city at sunrise, slow aerial push-in"}' --wait --json
```

Use `--wait` for async jobs. Use `--confirm` only after explicit human confirmation for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions that name the exact target and effect; a user asking "delete X" is intent, not confirmation — first show the exact target/effect and stop for confirmation. `settlemesh tool call` remains a compatible alias, but new agents should teach and use `settlemesh call <entrypoint-id>`. Always parse JSON defensively. Result URLs or payloads may appear in `data.result`, `data.results`, `data.output`, `output`, `url`, `urls`, or nested arrays/objects.

### Async jobs — poll the *per-model* detail capability (don't guess it)

Media generation is async: the submit capability returns only a **job id**; the actual result lives behind a separate **detail capability** you poll. The detail id is **self-described by the submit spec**, and you must not invent it:

- **Video detail ids are usually per-model** (`video.veo-3.1` → `video.veo-3.1.detail`, `video.sora2-new` → `video.sora2-new.detail`), but some framework-level video tools explicitly share generic detail ids such as `video.hosted.task.detail` or `video.clip.task.detail`.
- **Images share `image.task.detail`** for image models such as `image.gpt-image-2` and `image.nanobanana2`.
- **Never guess `video.task.detail`, and never reuse another concrete model's detail id.** Read the advertised detail id every time.
- **The authoritative poll id is in the submit op's spec at `wait.detail_capability_id` (also `output.next[0].tool_id`).** Read it with `settlemesh tool show <submit-id>` / `GET /v1/tools/<submit-id>`; the poll input key is **`id`** (not `task_id`). Over raw HTTP, an async submit response also carries `X-Settle-Poll-Capability` / `X-Settle-Poll-Input-Key` headers with the same target.
- **Easiest:** add `--wait` and the CLI polls for you; over HTTP, `POST /v1/capabilities/<submit-id>/invoke?wait=true` blocks server-side and returns the finished result in one call (or `202` + the poll headers if it exceeds the wall-clock).

**Picking an LLM model (`llm.chat`).** `model` defaults to `mistralai/mistral-medium-3-5`, so `{"messages":[...]}` alone works with a vetted non-reasoning instruct model that reliably returns text at `choices[0].message.content` (so JSON/structured-output apps don't get an empty `content` from a reasoning model). Send `model` explicitly only when it is listed by `GET /v1/models`; unknown explicit ids return `model_not_found` with suggestions before any charge or upstream call. Pin a listed model for byte-for-byte determinism. Multimodal recognition models still use `llm.chat`: after search, read `GET /v1/services/{model_id}` or `/v1/models` for `media_input_contract`; do not guess top-level `image_url`/`video_url`. Standard image parts live at `messages[].content[]` as `{type:"image_url",image_url:{url:"https://..."}}`. For video/file recognition, prefer URL-first: if the human gives you a local file, run `settlemesh files upload ./clip.mp4 --json` with the default temporary upload, then pass the returned `data.url` as `{type:"file",file:{filename:"clip.mp4",file_data:"https://..."}}` (or `file.url`). Do not use `--durable` for model inputs. SettleMesh converts the URL to provider-ready bytes before the upstream call; tiny data URLs remain accepted, but do not inline large videos manually.

**Image/video tool ids.** The real image generators are **`image.gpt-image-2`** and **`image.nanobanana2`** (there is no `image.gpt-image-1` — don't use it as a fallback). Video: `video.veo-3.1`, `video.sora2-new`, `video.doubao-seedance-2.0`. Always confirm an id against `GET /v1/tools` (or `settlemesh search`) before relying on it — a mistyped id 404s with an `error.suggestions` did-you-mean.

**Advisories (`X-Settle-Advisory` response header).** A **successful** call may still carry an `X-Settle-Advisory` header — a JSON array of `{code, severity, title, fix, docs}` flagging an easily-misused-but-non-fatal pattern you just used. It never changes the body, status, or charge; it's a self-correction signal. **Check it; on `severity:"warn"`, apply the `fix` on your next call.** Stable `code`s you can branch on — e.g. `llm_nondeterministic_auto` (you used an unsupported auto-router model → pin a listed model for reproducible output) and `llm_response_truncated` (`choices[0].finish_reason=="length"` → your answer was cut off by `max_tokens`; raise it, and give reasoning models far more headroom). Safe to ignore, cheap to act on.

**Notices (`notices` response body slot).** A successful response may carry an optional top-level `notices` array — the body counterpart of the advisory header, for post-call offers/info the platform surfaces alongside your result. Each entry is `{kind, message, action?}` where `kind` is `upsell`|`info`|`warning`, `message` is a plain-English sentence, and `action` (when present) is the machine-actionable next step `{label, method, endpoint, capability?, price_credits?}`. It never changes the status, the `data`, or the charge — it's purely additive, and absent when there's nothing to say. Example: deploying a web app on the **free tier** returns `notices:[{kind:"upsell", message:"Deployed on the free tier (0 Aev). Your site shows a \"Built with SettleMesh.io\" badge in the bottom-left corner. Pay 200 Aev to remove it…", action:{label:"Remove the SettleMesh badge", method:"POST", endpoint:"/v1/apps/{id}/upgrade", price_credits:200}}]`. Read it to surface upsells/offers to your user; act on the `action` only with their intent.

## Aev And Cost

One Aev balance pays for calls. Check the balance and the server's funding availability before long runs (`aev` is the current command; older CLI builds use `credits` — both work on a current install):

```bash
settlemesh aev balance --json
settlemesh aev ledger --limit 20 --json
settlemesh aev topup --aev 500 --json    # requests a top-up flow; live availability is gated
```

**Legal/payment availability.** Legal/compliance status is unverified: treat live Stripe, top-up, and merchant checkout availability as **UNABLE, never PASS**, until the live server returns a verified Legal/provider-ready state. Legal-required operations are blocked by the Legal gate; confirmation cannot turn an unavailable Legal state into PASS. Command help does not prove live payment availability. Do not infer live Stripe or top-up availability from the presence of a command or example.

**The live quote is the authority for whether a call is free or paid.** Do not assume a first-call promotion from cached documentation. A terminal failed call releases its hold. A timeout, pending response, or unknown provider outcome is not terminal failure: keep the same idempotency key and reconcile instead of assuming release or retrying as a new charge.

## When A Call Fails (handle these — do not loop blindly)

**Error shape (read this once).** Every failed HTTP call returns `{"success":false,"error":{"code":"…","message":"…"}}` — `error` is an **object**, not a string. Read the human-readable text at **`error.message`** and branch on **`error.code`**; never render `error` itself (stringifying the object yields the literal `"[object Object]"` — a real bug seen in generated apps). Credit-gated 402s may carry `error.topup_url` / `error.required_credits` / `error.available_credits`; some errors carry **`error.fix`** or availability metadata, and some 404s carry `error.suggestions`. Follow the server's `error.code`, `message`, `fix`, and availability; do not invent a funding path. Don't confuse this with a *string* `error` you may see *inside* a success `data` payload (e.g. `data.output.error` on a capped agent run) — that is a different, lower-level field; the top-level HTTP `error` is always the object form.

- **HTTP 401 `invalid_api_key` / `missing_api_key`** — your key is wrong, expired, or unset. Do NOT retry. Set `SETTLE_API_KEY` (headless) or run `settlemesh login`, then `settlemesh whoami --json` to confirm before continuing. Get a key from your dashboard (https://www.settlemesh.io).
- **HTTP 402 `insufficient_credits`** — the admitted call cannot start with the available balance. Read the returned code/message/fix and amounts. Use `topup_url` only when the response includes it and the Legal/provider gates report available; otherwise report the returned remediation or that funding is unavailable. Retry with the same idempotency key only after the server-reported prerequisite is satisfied.
- **HTTP 402 `credit_limit_exceeded`** — the API key hit its own spend cap; use a key with a higher limit.
- **HTTP 403 `payer_not_allowed`** — you sent `X-Settle-Payer` (end-user-pays) but the request's bearer is a normal account/CLI key. `X-Settle-Payer` only works when the bearer is a **deployed-app runtime key** (`SETTLEMESH_APP_API_KEY`, injected by `settlemesh deploy`). So you cannot exercise the end-user-pays money path locally with a user key — verify the app's billed success path only after deploy. (The payer *value* must also be a real `__settle_session`/`__settle_access` from a logged-in user, never a key.)
- **An async job did not finish under `--wait`** — read progress with `settlemesh tool events <job-id> --json`; for deploys use `settlemesh deploy status <app-id>` and `settlemesh deploy logs <build-id>`.
- **`doctor` reports a stale CLI** — reinstall `npm install settlemesh@latest --prefer-online` before continuing.
- **`search` returns nothing useful** — broaden the query, try `settlemesh search --all --category <category>`, or read `settlemesh recipes`.

## Safe Retries — Idempotency-Key (so a retry charges once, not twice)

A transport failure such as HTTP 502 leaves a paid call's outcome unknown. Preserve the original request and reconcile it; only resend when the server supports replay, using the exact same body and **`Idempotency-Key`** for that logical operation. A fresh key creates a fresh paid operation. Send an **`Idempotency-Key`** on retriable paid calls:

```bash
curl -X POST -H "Authorization: Bearer $SETTLE_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"input":{"q":"SettleMesh"}}' \
  "https://api.settlemesh.io/v1/capabilities/web.search/invoke"
```

- **Same key + same body** identifies the same logical operation. A timeout, connection loss, HTTP 502, or missing response does **not** prove whether the effect or capture happened. Do not retry blindly and do not mint a new key. Reconcile the same idempotency key / logical operation identity first; if the server supports a retry, resend the exact same body with that same key so you do not create a new logical effect.
- **Same key + a *different* body** → **HTTP 409 `idempotency_key_conflict`**, fail-closed, **no charge** — use a fresh key for a genuinely new operation.
- **No key** → every call is a new charge (the default). Reuse one key per logical operation; mint a new key per new operation.

**Verify a charge only from trusted capture evidence: a terminal captured ledger entry, or the explicit platform `x-settle-charged-aev` post-capture response header when present.** Never infer a charge from HTTP success/failure, a provider response body, an approximate quote, a balance delta, or arbitrary `cost` / `amount` / `charged` fields. Async settlement makes a balance delta briefly unreliable. Use `GET /v1/credits/ledger?limit=5` for itemized entries. Match a captured entry by endpoint and operation context, not by string-matching your literal `Idempotency-Key` against the derived ledger id. A fixed/input-priced capture should match its exact quote; a usage-metered capture is the measured amount at or below its hold ceiling. A row or response still marked pending/unknown is not final proof.

**Settlement truth.** A successful provider body does not always mean the ledger is final: `capture_pending` and `unknown` settlement outcomes require reconciliation (poll ledger/request status using the same logical operation identity) — do not report them as charged or settled. HTTP/network failure is also insufficient evidence of non-capture. HTTP 202, queued, or correlated async acceptance does not mean charged or settled. Preserve the same idempotency key until the operation is reconciled; never turn an unknown outcome into a second blind effect.

## Build And Deploy An App

**Current availability:** deployment authorization is unavailable. The intended source-deploy entrypoint is the owner CLI, not a browser uploader, but a deploy request currently returns `deployment_authorization_unavailable` and fails closed before source upload, build, payment, or publication. Do not report a candidate, preview, charge, or live URL from that denial.

Start with the authenticated, read-only preflight:

```bash
settlemesh apps doctor . --fix
settlemesh tool show app_deployments.create --json
settlemesh deploy preflight . --full-stack --json
```

Read the tool's `availability`, then preflight `runtime`, `admission.can_start_now`, `admission.code`, `admission.message`, and `admission.fix`. Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and the mutation returns `deployment_authorization_unavailable`. Preflight uploads no source and creates no hold, app, or reservation. Even `admission.can_start_now: true` is only a current snapshot; it does not override unavailable release authorization or guarantee a later deploy.

When release authorization becomes available, the intended owner command is `settlemesh deploy . --name my-app --full-stack --wait --json`. The target policy is automatic publication after mechanical protocol checks pass, with no default human approval queue. This is future/default product policy, not a statement that source deployment succeeds today.

For app/build ids that already exist, use only read-only observation first:

```bash
settlemesh deploy status <app-id> --json
settlemesh deploy logs <build-id> --json
settlemesh deploy url <app-id> --json
```

Queued, failed, `candidate_ready`, and preview records are not proof of serving production; a missing URL is not success. Destructive cleanup is separate: after a human separately confirms the exact app and outage effect, use `settlemesh apps delete <app-id> --confirm`. Today that command fails closed with `503 app_teardown_unavailable`: the app remains unchanged and no provider cleanup starts. Never run deletion automatically from recovery guidance or a browser.

The packaging and runtime details below describe the intended pipeline after release authorization is available. They do not override the current fail-closed containment. SettleMesh is not a template generator; the managed full-stack build path targets **Next.js** through OpenNext for Cloudflare.

### Deploying a plain static site (HTML/CSS/JS, no framework)

The golden path is two files — this exact shape is what the platform's own e2e suite deploys:

```
index.html          (at the project root — works as-is)
settlemesh.json     { "stack": { "runtime": { "prototype": "static" } } }
```

After release authorization becomes available, the intended command is `settlemesh deploy . --name my-site --wait --json`. **No `package.json`, no build script, no special directory is intended to be needed** — `runtime.prototype: "static"` selects static serving instead of framework auto-detection. No `--full-stack` either: a static site needs no DB/auth stack, and `apps doctor --fix` full-stack wiring is unnecessary for it.

For a bundler-built SPA, run your build first and deploy the OUTPUT directory the same way (its `index.html` at that directory's root + the same `settlemesh.json`), or keep sources and built files separate.

**Naming + URL contract (when deployment is authorized).** The user picks the app name with `--name` (or `name` in the manifest); a successful serving deployment is expected to return its server-issued URL in deploy JSON at `data.url`. The name must be **at least 5 letters/digits**. Do not construct a URL from a suffix in client code: only a returned/read-back URL is evidence, and current authorization denial returns none.

When release authorization is available, `--full-stack` is intended to provision and inject SettleMesh auth, a database, a runtime API key, and deployment secrets. If preflight reports `backend_quota_exceeded`/`deploy_quota_exceeded`, treat that as an app-count constraint, not a successful deploy or a balance claim. Deleting an existing app requires the separate destructive confirmation described above.

```bash
settlemesh deploy . --app-id app_123 --full-stack --wait --json
settlemesh deploy status app_123 --json
settlemesh deploy logs build_123 --json
```

### Deploying a container app (Python / Go / Rust / Node — any Dockerfile)

Any non-Next.js server is a **container app** (`--framework container`, or auto-detected from a `Dockerfile`/server file). The facts that trip people up:

- **The image is built server-side in Google Cloud Build at deploy time — your machine never compiles it.** The local step only PACKAGES your source into a tarball, so `--build remote` is a no-op for containers and `--build local` will NOT move a slow compile onto your machine. A deploy that looks "stuck building locally" is just packaging; Cloud Build then builds the image. Don't kill it.
- **Heavy/compiled Dockerfile?** A from-scratch Rust/Go/C++ (or huge `npm install`) build can exceed Cloud Build's budget. Ship a **prebuilt artifact**: build/cross-compile the binary locally, then use a thin Dockerfile that only `COPY`s it (`FROM python:3.12-slim` → `COPY ./bin/app /usr/local/bin/app` → `CMD ["app"]`) so the server-side build just assembles the image in seconds.
- **The build context honors `.dockerignore`, NOT `.gitignore`** (matching `docker build`). A gitignored prebuilt binary the Dockerfile `COPY`s is still uploaded; put what you want excluded in `.dockerignore`.
- **Bind to `0.0.0.0` and read `$PORT`** (the platform sets it). Binding `127.0.0.1` makes the health check fail and the deploy never goes ready.
- **Charging users?** A paid endpoint must invoke a **published, callable, priced** capability/dynamic-service with `X-Settle-Payer`. Deploy injects the app's runtime key but does NOT auto-create or price that charge capability — provision + price it first, or the first paid call fails. Verify the billed path only after deploy (end-user-pays can't be exercised locally with a user key).

### Reading an existing live URL

For an app id that already exists, **`settlemesh deploy url <app-id> --json`** reads the server-issued serving URL and `settlemesh apps list --json` lists owned app records. `settlemesh deploy status <app-id> --json` is status/readback, not URL evidence. **Never use `settlemesh search` to find your own deployed app**: search is capability/service discovery, not deployment inventory. Current `deployment_authorization_unavailable` produces no new URL.

For an existing in-flight record, a `--wait` timeout is not terminal evidence: poll status and read logs before deciding whether retry is appropriate. For an existing serving URL, an HTTP 302 can be an intentional required-auth gate; verify the deployment readback before interpreting it.

Only give the user a URL returned by a successful serving response or `settlemesh deploy url <app-id> --json`. A candidate/preview URL or a fabricated hostname is not production evidence.

**Diagnosing a failed deploy:** a build can go green yet the DEPLOYMENT still fail (worker/container provisioning, secret injection, smoke check). `settlemesh deploy status <app-id>` now prints both the build status AND the latest deployment's `status`/`url`/`error` — read the `deployment error:` line for the real reason before retrying.

**Platform-reserved paths.** The edge owns a few paths that never reach your container — notably **`/healthz`** (the Cloud Run health probe answers there with its own 404 page). Don't expose an app route at `/healthz`; every other path (including `/` and `/api/*`) reaches your handler normally.

**Teardown.** `settlemesh apps delete <app-id> --confirm` (or `DELETE /v1/apps/{id}?confirm=true`) is **destructive** and confirmation-gated (R18): without `--confirm` / `?confirm=true` it fails closed with `428 confirmation_required` and makes no record or provider change. The owner route also fails closed with `503 app_teardown_unavailable` while durable admission, a single recovery owner, and exact provider-absence readback are not integrated; that response means the app was unchanged and no provider cleanup started. Do not retry it as though work were pending.

Compatibility behavior must remain conservative if an older deployment returns success instead of the current fail-closed response.

A successful delete response proves only that the confirmed user request was accepted and the app/deployment records were projected unavailable/deleted; it does not prove that every Cloud Run, E2B, Cloudflare, custom-domain, secret, or CDN resource is absent. Provider cleanup is a best-effort attempt in that older behavior, not a durable user-visible `teardown_pending` completion contract. Treat an explicit provider absence readback as evidence only for that exact resource; otherwise keep cleanup `unknown`, preserve the app/deployment/provider identifiers, and use manual operator recovery. Do not report a repeat-delete `404 app_not_found` as provider cleanup evidence: it proves only that the app is already absent from the user-facing API.

Once the durable coordinator is available, an accepted request returns a replayable operation with `status: teardown_pending`, `operation_id`, `delete_generation`, a canonical `inventory_plan_digest` plus `inventory_count`, the resource inventory, and one durable workflow `recovery_owner`. The app row must bind the same generation, operation, inventory plan, and recovery owner. New builds, deploys, command/API mutations and invocation/remix traffic are frozen for that app, while read-only app/deployment observation and completion/settlement of already-admitted work remain available. Repeating the confirmed DELETE observes the same operation; it must not start a second provider effect. `unknown` or `failed` is still non-serving and remains owned by that recovery operation. Only `status: deleted` together with a complete inventory, exact readback time, and `absent` for every recorded provider resource proves cleanup completion. Never infer provider absence from HTTP success, a process-local goroutine, or `404 app_not_found`.

App deletion does **NOT** cascade-delete a database/project that `--full-stack` auto-provisioned — that project stays `active` and billable. Delete it separately only after its own destructive confirmation, using `settlemesh db delete <project-id>` (list projects with `settlemesh projects list`) or `DELETE /v1/projects/{project-id}`; its own recovery/readback contract remains independent of app cleanup.

### Remix an existing app (`settlemesh remix <app-id>`)

Some **free-tier template** apps that SettleMesh has published are publicly remixable — their badge carries a **Remix** action. **`settlemesh remix <app-id> [dir]`** downloads such an app's source, extracts it locally, and strips the pinned app id so your next `settlemesh deploy` forks a **new** app under YOUR account. No login is needed to pull (the source archive excludes `.env`/secrets), and the `app_…` id comes from the badge's Remix panel or the original deploy output (`GET /v1/apps/{id}/source` is the public endpoint behind it). This is the fastest start when a published template matches what you want: clone → customize → `settlemesh deploy`. **A plain free deploy is NOT remixable by default** — only an app an admin has published as a template exposes its source; an ordinary free app (its badge shows only "Install SettleMesh") and an owned/paid app both 404 on the source endpoint.

### Auth UX: prefer lazy login, don't gate the whole app

SettleMesh auth has two modes — choose deliberately, because it shapes the whole first impression:
- **`lazy` (recommended default for most apps)** — the app is publicly viewable; SettleMesh login is offered but NOT forced. The platform still injects `/__settle/login`, `/__settle/logout`, `/__settle/me`. Wire a **"Sign in" button** to `/__settle/login` and call `/__settle/me` to detect the current user. Trigger login *at the right moment* — when the user clicks sign-in, or right before an action that needs identity or spends Aev — not on page load.
- **`required`** — every route redirects unauthenticated visitors to login. Use this ONLY for an app that must be fully private (an internal tool, a paid-members-only product). For a normal public-facing app this is the wrong default: visitors hit a login wall before they see anything.

`lazy` is the platform default when you don't specify auth. Only set `required` when you actually mean "no page is viewable logged-out". In the deploy stack: `auth: { mode: "lazy" }` vs `auth: { mode: "required" }` (or `--full-stack` defaults you get plus an explicit mode). Don't reach for `required` just because the app "has accounts".

**Handle a failed sign-in.** If the OAuth round-trip fails (e.g. the user took too long and the flow expired), the platform sends them back to your app at their return path with a **`?settle_auth_error=<reason>`** query param (reasons: `invalid_callback`, `exchange_failed`) instead of stranding them on a raw error page. Detect that param on load and show a brief "Sign-in didn't complete — try again" with the `/__settle/login` button, then strip it from the URL. Treat it as advisory: the user is simply still logged out (`/__settle/me` confirms).

### Charge Aev (monetize the app — unified wallet, cost-plus)

**A static site cannot take money.** Billing — markup *or* merchant checkout — requires a server runtime: deploy a node/container/Next backend declaring `stack.billing` (and `stack.auth` for end-user identity), not a `runtime.prototype: "static"` prototype. A static deploy that also declares a server-side billing stack is rejected.

SettleMesh has ONE per-user Aev wallet (there are no per-app wallets). Your app charges the END USER's
wallet `cost × m` for the platform services it consumes on their behalf; the markup `m−1` is your
revenue. Four concrete steps:

**1. Declare your markup `m` at deploy** — `stack.billing.markup`, discrete `m ∈ {1.0,1.1,1.2,1.3,1.4,1.5}` (cap 1.5×; 1.0 = at-cost pass-through):
```json
{ "stack": { "billing": { "markup": 1.1 } } }
```
Choosing m is a pricing decision: use the owner's specified value; else ask (recommend 1.1); headless with no one to ask → 1.0 (never impose an unapproved markup). An out-of-set value (e.g. 1.05 or 2.0) is **rejected** at deploy, not clamped — use one of the six allowed values. This stamps m on your app's runtime key, so every delegated charge below is `cost × m` with the markup credited to your account.

**2. Charge the end user** — when your SERVER calls a platform service for a logged-in user, forward the user's SettleMesh session as the `X-Settle-Payer` header so THEIR wallet pays (not yours):
```
POST {SETTLEMESH_BASE_URL}/v1/capabilities/<id>/invoke      # or /v1/dynamic-services/<id>/operations/<op>/invoke
Authorization: Bearer {SETTLEMESH_APP_API_KEY}
X-Settle-Payer: <the user's __settle_session cookie>        # prefer __settle_session (durable, 7-day); __settle_access (OAuth token) also accepted
```
The platform charges the user `cost × m` and credits you the markup (a platform-default per-app allowance and per-call ceiling are enforced by default; explicit user limits can adjust the cap — see 4). Read the cookie from the incoming request — the auth gate passes `__settle_*` cookies through to your server. **No header ⇒ your own wallet pays** (use that only for background jobs you fund).

**Preflight the end-user-pays path before real users.** After deploying an auth-enabled app, the app OWNER can mint a short-lived self-test payer token:
```
POST {SETTLEMESH_BASE_URL}/v1/apps/{app_id}/test-payer-token
Authorization: Bearer {owner API key}
```
Use the returned `data.token` exactly like a user session in `X-Settle-Payer`, alongside the deployed app's runtime key (`Authorization: Bearer {SETTLEMESH_APP_API_KEY}`). The call exercises the same delegated payer rail and spends the owner's own wallet, so you can verify quote → hold/capture → ledger before onboarding a customer. Every resulting wallet/settlement/request-log row is tagged `test_payer=true`; operator revenue views exclude those self-test rows, but your daily spend caps still count them because they are real spend. Never ship this token as a user credential; mint a fresh one only for owner self-tests.

**3. Cost transparency — REQUIRED whenever your app spends the user's Aev.** Never spend a logged-in user's Aev silently. Two obligations, both enforced as product policy:
- **Estimate BEFORE.** Show the user an estimated cost in the UI *before* the action runs. Use `settlemesh quote <entrypoint-id> --input '{...}' --json` as the canonical CLI source; for HTTP-only agents use **`POST /v1/billing/quote`** — see the quote note below. For cloud workers, quote the offer or compute `credits_per_second × expected_seconds`, then multiply by your markup `m`. Display it as "≈ N Aev" (mark it an estimate; the real charge may be metered).
- **Actual AFTER.** Show the exact amount actually captured once the action completes. For a **synchronous capability invoke**, read **`X-Settle-Charged-Aev`** when present (the metered path may also add `X-Settle-Base-Cost-Aev` + `X-Settle-Markup-Aev`); do NOT infer the bill from the provider's raw `usage.cost`. A metered cloud-worker job reports `GET /v1/worker-jobs/{id}` → `data.metadata.settlement_cost_credits`. Streaming responses cannot carry a post-stream capture header, so verify a terminal captured ledger row for the endpoint: fixed/input-priced amounts match the exact quote, while metered amounts follow actual usage at or below the hold ceiling. Never use a balance delta, pending row, or provider body as final proof.
- **Viewing entry.** Give the user a link to their full Aev spend — their SettleMesh account/wallet (where every charge across all apps is itemized) — so they can audit what your app cost them. `GET /v1/wallet/balance` (with `X-Settle-Payer`) is the live balance; link the user to the SettleMesh wallet page for history.

**4. Per-app spend allowance.** By DEFAULT a logged-in user can spend through an app up to the platform-default per-app allowance and per-call ceiling — no separate grant needed. The user can still set an explicit revocable blast-radius cap for your app, or remove it to fall back to the platform default:
```
PUT  /v1/wallet/app-grants/{appID}   { "max_credits": 5000, "per_call_ceiling_credits": 600 }
GET  /v1/wallet/app-grants           # list   ·   DELETE /v1/wallet/app-grants/{appID}  # revoke
```
Unlike `/v1/wallet/balance` (which requires a logged-in payer session), these `app-grants` endpoints DO accept a developer **API key** — they manage the key-owner's own grants — so you can create/list/revoke grants headlessly. `DELETE` is a soft-deactivate (the grant row remains, marked inactive).

**5. Show the user their balance** — `GET /v1/wallet/balance` with `X-Settle-Payer: <user session>` → their unified platform Aev (`data.available_credits`). The header must be a real `__settle_session` cookie from a logged-in user — an API key is NOT a valid payer token, so you cannot exercise this endpoint without a logged-in user. (Your OWN account balance, as the developer, is `settlemesh aev balance` — there is no `/v1/whoami` REST route.) Do not build a per-app balance.

**Billing errors to handle:** `app_allowance_required` (403) / `app_per_call_ceiling` (403) / `app_allowance_exceeded` (402) — user must set or raise the allowance, lower the call size, or rely on the default layer after removing an explicit cap; `insufficient_credits` (402 — follow the returned fix/availability; do not assume top-up is enabled); `invalid_payer_token` (401, session expired → user re-logs in).

**Quote before charging (recommended for every paid call):** CLI: `settlemesh quote <entrypoint-id> --input '{...}' --json`. HTTP: `POST /v1/billing/quote` with `{"capability_id":"..."}` or `{"agent_id":"..."}` or `{"app_id":"...","endpoint_id":"..."}` → `{base_cost_credits, markup_bps, multiplier, total_credits, markup_deduped, chain:{depth,max_depth}, payer:{delegated, allowance?}}`. Read-only (no hold). Distinguish quote fields carefully: a **fixed or input-priced** unit returns the caller's **exact price**; a hidden routed-provider choice does not change that service-unit charge. A **representative floor** or reference estimate helps discovery but is neither a cap nor a final quote. For usage-metered entries, **`hold_ceiling_credits`** is the maximum pre-authorization and final capture follows **measured usage** / actual usage capture without exceeding that hold ceiling. Quote/preflight informs cost and availability; it is not a second confirmation. Show the applicable exact price, estimate, or ceiling before the action, then show the actual ledger/header charge after completion.

**Mandatory:** any deployed unit that consumes paid platform services MUST declare billing — `settlemesh apps doctor` warns otherwise — else the cost silently falls on YOUR wallet.

*Selling a discrete product instead of metered usage?* The manifest and endpoint remain the integration contract, but live merchant checkout is usable only when runtime config/server availability reports the Legal/provider gate ready. When available, declare `stack.billing.enabled:true` + a `price_credits`, then `POST {BASE}/api/v1/checkout/create` and redirect to the returned `url`. **Do NOT build a per-app wallet/ledger** — the unified wallet replaces it.
- Auth: `Authorization: Bearer {SETTLEMESH_MERCHANT_API_KEY}` (the merchant key, NOT the app/runtime key). No injected app? Mint one yourself with `settlemesh apps register --with-payment` (prints a merchant key + id) — that is the headless way to get a merchant key without deploying.
- Body: `{ "amount": <credits>, "description": "<required, ≤500 chars>", "external_id"?: "...", "return_url"?: "https://...", "cancel_url"?: "https://...", "metadata"?: {} }`. `amount` and `description` are required; response has `url` (hosted checkout) + `id`. (If you get field-validation errors, also double-check the merchant key — an invalid key surfaces after body validation.)

## Use A Managed Database And Auth

`--full-stack` provisions a database + SettleMesh auth + a runtime key. A **custom container manifest gets ONLY what its `stack` declares** — so to get a DB you must declare it:

```json
{ "stack": { "database": { "engine": "postgres" }, "auth": { "provider": "settlemesh", "mode": "lazy" } } }
```

**Engines: `postgres` or `sqlite` — and what you get when you don't choose.** If the deploy doesn't specify `database.engine`, the platform default applies, which is **`sqlite` (Cloudflare D1) unless the operator has a Postgres backend configured** — so don't be surprised when an undeclared full-stack DB behaves like SQLite. Declare `"engine": "postgres"` explicitly if you need real Postgres (`DATABASE_URL` injection, SQL dialect, `$`-free `?` placeholders still apply on the REST path). Check which engine you actually got from the deploy output's project info (or `GET /v1/runtime/config` → `project`). The REST query/migrations endpoints below work identically on both engines; only row-shape quirks differ (D1 rows may also appear under `data.raw[0].results`).

Manage backends from the CLI (dev-time):

```bash
settlemesh projects create --name demo --db postgres --auth email_password,magic_link --json
settlemesh db query <project-id> --sql "select 1" --json
settlemesh db migrate <project-id> --file schema.sql --json
```

At runtime the deployed app reads its DB **server-side only** (browsers use project Auth, never a server key):
- **Postgres** → connect with the injected `DATABASE_URL`.
- **Any engine** → `POST {SETTLEMESH_BASE_URL}/v1/projects/{SETTLEMESH_PROJECT_ID}/database/query` with `Authorization: Bearer {SETTLEMESH_PROJECT_SERVER_KEY}` (and `.../database/migrations` with `{ "name": "...", "sql": "..." }` to create tables on first run). Query body is `{ "sql": "...", "args": [...] }` — the field is **`args`** (not `params`). Placeholders are **engine-specific**: on **D1/sqlite** use **`?`**; on **Postgres** use **`$1, $2, …`** (Postgres reads `?` as a JSON operator, so `?` placeholders raise a syntax error there). The response is `{ "data": { "rows": [ {col: value} ], "columns": [...], "rows_affected": n } }` — read `data.rows`; on the D1 engine the rows may also appear under `data.raw[0].results`. Note: `INSERT … RETURNING` does NOT surface the returned rows on this REST path (you get `rows_affected` only) — run a follow-up `SELECT` if you need the inserted row back.

### Per-user data isolation — don't hand-roll `WHERE user_id` (multi-tenant safety)

The platform isolates **apps** from each other (each app gets its own schema + role). It does **not** isolate your app's **end-users** from each other — that is your job. The naive way (filtering every query with `WHERE user_id = ?`) leaks the moment one query forgets the filter — the classic multi-tenant bug. SettleMesh gives you a database-enforced shortcut so a forgotten filter fails **closed**, not open (postgres engine):

1. **Turn on row-level security for a table once:**
   ```bash
   settlemesh db enable-rls <project-id> --table notes --owner-column user_id --json
   ```
   Postgres itself now filters every read/write on `notes` to the current end-user — even over the direct `DATABASE_URL` connection.

2. **Tell the database who the end-user is, per request.** The user id is the authenticated subject (the `__settle` session / `X-Settle-User-ID`), never something the browser hands you:
   - **Control-plane query:** `settlemesh db query <project-id> --sql "select * from notes" --user <user-sub>` (or `POST .../database/query` with `"user_id": "<user-sub>"`).
   - **Direct `DATABASE_URL` (keep your ORM + transactions):** inside an **explicit transaction**, make its **first statement** `SET LOCAL "settle.user_id" = '<user-sub>'` — bind the value as a parameter or escape it (the sub is the authenticated subject, never a raw browser value). Every ORM exposes a per-transaction hook for this; afterwards ordinary queries see only that user's rows — no `WHERE user_id` needed. (`SET LOCAL` only lasts the transaction; in autocommit mode it is a no-op and the query then fail-closes to zero rows — so wrap it in a transaction.)

3. **Fail-closed:** if `settle.user_id` is never set, an RLS table returns **zero rows** and rejects writes — so a missed bind is a safe empty result, not a cross-user leak.

Read the live operational bounds (query row/byte caps, per-app connection cap + pool math, idle-disconnect window, delete-recoverability, storage-metering rate) from `GET /v1/runtime/config` → `limits` — don't hardcode them.

### Runtime env your app receives (declare it ⇒ get it)

The deploy INJECTS env **based on what your `stack` declares**. If your runtime code reads one of these but you didn't declare the matching block, it is simply **absent at runtime → a silent 500**. So: read it ⇒ declare it.

| Your code reads | Requires declaring |
|---|---|
| `SETTLEMESH_BASE_URL`, `SETTLEMESH_APP_API_KEY`, `SETTLEMESH_STORAGE_API`, `SETTLEMESH_APP_ID` | always injected |
| `DATABASE_URL`, `SETTLEMESH_PROJECT_ID`, `SETTLEMESH_PROJECT_SERVER_KEY` | `stack.database` |
| `SETTLEMESH_MERCHANT_API_KEY`, `SETTLEMESH_MERCHANT_ID` | `stack.billing` |
| `SETTLEMESH_AUTH_*` + the `/__settle/*` routes | `stack.auth` (or `--full-stack`) |

Always call the platform at `SETTLEMESH_BASE_URL` (the `api.` host — it survives long async calls). **Never hardcode `www.`/the apex** — `www` is the Vercel frontend and gateway-502s long calls.

**One-call config (skip reading the non-secret vars individually):** `GET {SETTLEMESH_BASE_URL}/v1/runtime/config` with `Authorization: Bearer {SETTLEMESH_APP_API_KEY}` returns your app's resolved non-secret config — `base_url`, `storage_api`, `capabilities_invoke`, `app_id`, the `/__settle/*` auth routes, and (when declared) `project` (DB query/migrations URLs) and `merchant` (checkout URL). Secrets are never in the response; they stay in env. So an app can read just `SETTLEMESH_APP_API_KEY` + `SETTLEMESH_BASE_URL` and fetch the rest.

**Object storage** (always injected; namespaced per app): all calls use `Authorization: Bearer {SETTLEMESH_APP_API_KEY}`. The namespace is determined by the **authenticating key**, not by any header: the injected runtime key (`SETTLEMESH_APP_API_KEY`) scopes you to `apps/<app_id>/`, so your app only ever sees its own objects. (A plain account/owner key used directly — e.g. while testing from the CLI — is namespaced per-owner under `apps/owner-<owner_id>/` instead; deployed apps always use the runtime key, so this only matters for ad-hoc testing.)
- Write: `PUT {SETTLEMESH_BASE_URL}/v1/storage/objects/<key>` with the file bytes as the body (`Content-Type` sets the stored type).
- **Read: `GET {SETTLEMESH_BASE_URL}/v1/storage/objects/<key>`** — streams the bytes back directly (Bearer-auth). Add `?presign=true` (or `POST /v1/storage/sign {"key":"..."}`) only if you want a short-lived shareable URL instead of the bytes.
- List: `GET {SETTLEMESH_BASE_URL}/v1/storage/objects?prefix=&limit=`. `DELETE .../objects/<key>` is an **immediate, irreversible provider-level delete**: it calls the storage provider's delete directly and answers `{"success": true, "data": {"delete_mode": "irreversible_provider_delete", "recoverable": false, ...}}` — the response states the irreversibility in machine-readable form. There is no tombstone, no recovery receipt, and no restore endpoint; the object bytes are gone. Copy anything you may need before deleting. Deletion also does not revoke an already-issued short-lived URL, which stays valid until its own TTL expires.

### Wire one service to another with `@app:` (don't hardcode sibling URLs)

A multi-service app (e.g. frontend + backend) wires the dependency by reference, not by pasting a URL:

```json
{ "stack": { "runtime": { "env": { "NEXT_PUBLIC_API_BASE_URL": "@app:my-api" } } } }
```

On deploy `@app:my-api` resolves to that app's live URL **before the build** (so it bakes into build-time `NEXT_PUBLIC_*`/`VITE_*`) and keeps working across the sibling's redeploys. Hardcoding the sibling URL breaks the moment it changes.

## Buy And Connect A Custom Domain

Give an app a real domain (e.g. `yourbrand.com`) end-to-end: the agent searches + quotes, a **human pays** via a confirm link, then the platform registers it and wires DNS + TLS automatically. Every deployed app already gets a free `<name>.settlemesh.run` subdomain — this is for a domain you own.

```bash
# 1. Search availability + real prices (no money, no commitment)
settlemesh call domain.search --input '{"query":"yourbrand","tlds":["com","io","xyz"]}' --json

# 2. Quote ONE exact domain → returns a confirm_url. Pass app_id to auto-connect on purchase.
settlemesh call domain.quote --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' --json
# → { "confirm_url": "https://www.settlemesh.io/domains/confirm/<token>", "price_aev": 1299, ... }

# 3. A HUMAN opens confirm_url, signs in, reviews price + registrant + agreement, clicks Confirm & Pay.
#    This is the ONLY step that moves money. The agent must STOP here — never auto-pay, never set ?confirm=true.

# 4. Connect a domain you ALREADY own to an app (or re-connect):
settlemesh call domain.attach --input '{"fqdn":"yourbrand.com","app_id":"app_xxx"}' --json

# 5. Your ICANN right: get the EPP auth code to transfer the domain OUT to another registrar:
settlemesh call domain.transfer_authcode --input '{"fqdn":"yourbrand.com"}' --json
```

Rules that matter:
- **Agent quotes, human pays.** Domain registration is irreversible spend, so it requires an explicit human click on the confirm page (price breakdown, ICANN registrant contact, and a separate registration-agreement consent are all shown there). An agent that tries to self-confirm is rejected by design.
- **The human types the exact domain.** Agents must not free-text-invent names; trademark / typosquat / look-alike (IDN homoglyph) names are hard-rejected at quote to keep you out of UDRP/ACPA trouble.
- **After payment it's automatic:** the domain registers, a Cloudflare-for-SaaS custom hostname + DNS records are written for you, TLS issues automatically, and the app serves on the domain within minutes — no dashboard, no nameserver fiddling.
- **Pricing is cost-plus and shown up front** (`registration_price_aev`); a domain is **non-refundable once registered** (a failed/never-completed registration is auto-refunded). Registrant contact you enter once is remembered for next time.

## Optional App API Or CLI Command

Use App APIs and App Commands only when the app should expose a route or command for other users or agents.

```bash
settlemesh apps api publish <app-id> --file app-api.json --json
settlemesh apps api call <app-id> <endpoint-id> --input '{}' --json

settlemesh apps commands publish <app-id> --file app-commands.json --json
settlemesh run <command-id> --input '{}' --json
```

**Resale-chain contract (App APIs / agent invokes):** each platform-mediated hop is depth-capped (default 5) and owner cycles (A→B→A) are rejected with 403 `chain_depth_exceeded` / `owner_cycle_detected`; markup is earned **once per distinct owner in the whole chain**, so re-wrapping your own layer never double-charges. If your app receives an `X-Settle-Call-Chain` header on an inbound invocation, forward it unchanged on every SettleMesh call you make while serving that request — it is a signed ancestry token; dropping it only shortens your own chain accounting. **Hosted agents** get this automatically: the built-in runtime reads `SETTLEMESH_CALL_CHAIN` from the sandbox env and forwards it on every capability/LLM call, so agent→agent chains are counted end-to-end with no code on your part. A custom agent runtime must forward `SETTLEMESH_CALL_CHAIN` as the `X-Settle-Call-Chain` header itself.

## Hand Off To A Human

When a task needs human judgment (confirm, sign in, pay, review), create a login-gated continuation URL instead of guessing:

```bash
settlemesh handoff create <provider-or-app> <action-id> --input '{...}' --json
settlemesh handoff get <session-id> --json
settlemesh open <command-ref> --input '{...}'   # open an app command's web/handoff page with your CLI identity
```

`<provider-or-app>` is a provider name or your **app id** (`app_...`) — NOT a raw URL; pass the app whose `/api/handoff/sessions` endpoint should receive the session.

Give the returned URL to the user, then poll `handoff get` for the result.

**If the provider is your own endpoint/app, it must speak the handoff webhook contract.** On `handoff create` the platform POSTs the session (JSON body; headers include `X-Settle-Handoff-Session`, `X-Settle-Caller-Account`, and an HMAC `X-Settle-Handoff-Signature: sha256=<hex>`) to the provider — an app provider receives it at `{app base}/api/handoff/sessions`. The endpoint MUST respond with JSON containing **`continuation_url`** (top-level, or nested under `data`) — the human-facing URL the platform hands back to the caller. Any response without `continuation_url` fails the create with `handoff endpoint did not return continuation_url`. A relative `continuation_url` is resolved against the provider's base URL. The webhook body is exactly `{session_id, action_id, input, metadata, expires_at}`. **There is currently no provider completion callback.** The platform does not send a `completion` object, does not mint a provider redeem token, and does not expose a public `POST /handoff/{id}/redeem`; the only redeem route is `POST /internal/v1/handoff/sessions/{id}/redeem`, which requires a platform-internal token an external provider never holds. Consequently a provider can show its page via `continuation_url`, but **cannot close the session** — it stays `ready` until its TTL expires. Do not build against a redeem callback yet. For a paid `app-command` that routes through `needs_handoff`, this also means the hold is not captured by the provider path and is released by the settlement reaper.

## Publish Your Own Service (wrap any API → a searchable, billable SettleMesh service)

Turn an external HTTP API into a SettleMesh service others can discover and call (no platform code change). Init from an OpenAPI spec, validate, set secrets/env, then publish:

```bash
settlemesh services init <openapi.json|url> --json   # derives a service card (operations, pricing)
settlemesh services validate ./service.json --json
settlemesh services secrets set <id> API_KEY=...      # upstream creds, stored encrypted, never exposed
settlemesh services env set <id> BASE_URL=...
settlemesh services upload ./service.json --json
settlemesh services config-status <id> --json
# Continue only when publish_fee.admission.can_start_now is true:
settlemesh services publish <id> --visibility public --json
settlemesh search <service-id>
```

Set per-call/per-duration/per-token pricing in the service card so callers pay Aev and you keep **100% of owner revenue** (zero platform tax; revenue paid from platform-granted promo credit arrives as non-withdrawable granted credit — spendable, not cashable). Wrapping a fixed-price platform capability? Use `pricing: {mode: platform_markup, multiplier: 1.1|1.3|1.5}` — you charge platform-cost × multiplier; you're granted the full charge and pay the platform base once, so you net platform-cost × (m−1). Caller-byok markup is unsupported. Flat pricing must be ≥ the priciest operation's platform base cost (the publish call 422s below that floor, telling you the exact number). To register an existing website as a Settle-native service, see `settlemesh sites --help`. Run `settlemesh services --help` for the full lifecycle.

**Read the publish-fee admission before publishing.** After `upload`, run `settlemesh services config-status <id> --json` (or `GET /v1/dynamic-services/{id}` / `.../{id}/config-status` over HTTP) and inspect the top-level `publish_fee` object:
```
publish_fee: {
  publish_fee_credits: 100,
  free_quota: 3,
  published_count: 3,
  fee_required: true,
  will_charge: false,
  admission: {
    can_start_now: false,
    code: "publish_settlement_unavailable",
    message: "paid publish settlement admission is unavailable",
    fix: "inspection only: run `settlemesh services list --json`; freeing 1 shared service entry requires high-impact visibility changes and confirmation_required; obtain a separate explicit request naming each affected service before running `settlemesh services publish <explicitly-authorized-existing-service-id> --visibility private --json`; after the authorized changes, rerun `settlemesh services config-status <id> --json`"
  }
}
```
This preview is read-only: no hold, charge, or publication occurs. `fee_required` is separate from `will_charge`; never use `will_charge:false` as proof that the publish is free or fee-disabled. Branch on `admission.can_start_now`. When `admission.can_start_now:false`, follow `admission.code`, `admission.message`, and `admission.fix`; do not send the publish request as a fallback. With a positive free quota, the fix reports the exact number of shared (`public` or `settle_users`) entries blocking the new publish and first gives only the read-only `services list` inspection. Making any existing shared service private is a high-impact discoverability/caller change that the request to publish a new service does not authorize. `confirmation_required` means obtain a separate explicit request naming each affected service; only after that authorization may the returned `<explicitly-authorized-existing-service-id>` command template be used, followed by the exact target config-status readback. This separate authorization applies only to changing existing services; the ordinary publish itself still needs no duplicate confirmation. With a zero free quota, shared publish is currently `UNABLE`, the service stays private, and the fix gives the exact config-status readback to run after atomic settlement admission is enabled. A rejected first-time `sites publish` has no persisted service record: its fix never sends you to dynamic-service config-status, says that no site record was created, and gives the site-specific publish command to retry after the stated prerequisite. For the current `publish_settlement_unavailable` state, if the earlier mechanical gates pass and the admission state is unchanged, the publish returns HTTP 503 with the same recovery fields before any hold, capture, or publication. Free or fee-disabled mechanical publish remains automatic once its mechanical gates pass, with no default review queue and no duplicate confirmation.

**HTTP-only (no CLI):** the same lifecycle is REST — `POST /v1/dynamic-services` (body = the publish-manifest JSON; older clients call this a service-card) → returns `{dsvc_id}`; read `GET /v1/dynamic-services/{id}/config-status`, then use `POST /v1/dynamic-services/{id}/publish` with `{"visibility":"public"}` only when `publish_fee.admission.can_start_now` is true; `GET /v1/dynamic-services` lists records and `DELETE /v1/dynamic-services/{id}` removes one. (`PATCH /v1/dynamic-services/{id}` is a **full-replace** — send the entire manifest, or use `/publish` just to flip visibility.) In the manifest, `operations[].action` is a closed semantic enum (e.g. `read`) — **not** an HTTP verb; if a value is rejected, derive it from `settlemesh services init <openapi>` rather than guessing the field shape.

Note on visibility: when `publish_fee.admission.can_start_now` is true, `--visibility public` is **automatically published and searchable immediately** once all mechanical gates pass — every public operation needs at least one runnable `examples[].input`, copy must not name upstream vendors, flat pricing must clear the platform-cost floor, and the safety gate (allowed_hosts / positive pricing / abuse protection) must hold; any failure is a 422 that tells you exactly what to fix and resend. Once admission and mechanical checks pass, publication is automatic and discoverable: **manual review is not the default publication path**. A future, explicitly enabled governance mode may add review without changing the current default or turning a failed mechanical gate into a waiting queue. Your own dynamic service is callable by you **right after `upload`, before it goes public**, but only via the raw HTTP invoke endpoint — the CLI `tool call` / `services show <dsvc_id>` do NOT resolve a private draft dynamic service. Use the `dsvc_...` id from `upload`:
```
POST {SETTLEMESH_BASE_URL}/v1/dynamic-services/<dsvc_id>/operations/<operation_id>/invoke
Authorization: Bearer {your key}
{ ...operation input... }     # → { "data": { "body": {...}, "upstream_status": 200 } }
```
The `<operation_id>` is **slugified/lowercased** from your OpenAPI `operationId` (e.g. `lookupZip` → `lookupzip`). Use the id shown in the `upload`/`validate` output — not the raw operationId from your spec — or the invoke 404s.

## Publish A Hosted Agent

```bash
settlemesh agents create --name helper --template hermes --public --max-budget 50 --allowed-capabilities web.search,web.scrape,llm.chat --json
settlemesh agents invoke agent_123 --input '{"prompt":"hello"}' --json
settlemesh agents deploy agent_123 --project ./agent-dir --json
settlemesh agents pause agent_123 --json
settlemesh agents get agent_123 --json
settlemesh agents resume agent_123 --json
settlemesh agents reconcile agent_123 --json
```

Templates differ in setup: **`hermes` auto-deploys a version on create** (invokable immediately, as above), while `simple_workflow` needs its own deployed version before the first invoke — if you just want a working agent fast, use `hermes`. Delete a hosted agent you no longer need with `DELETE /v1/agents/{agent_id}` (or `settlemesh agents delete <agent-id>` on a current CLI — older installs lack the subcommand, the HTTP route always works): it stops listing and invoking, while its invocation history stays readable for billing audit.

`agents get` is the authoritative read used for lifecycle recovery. It sends one GET, changes neither Agent source nor Catalog state, and prints only after a bounded response proves the exact Agent identity and a valid source status. It reports Agent source state only; it does **not** prove the current Catalog discovery state.

`agents pause` commits the owned Agent's source status as paused, blocks new invocation, and synchronizes withdrawal of any active Catalog slice while retaining invocation history and billing audit. `agents resume` commits the source status as active and synchronizes only the Catalog projection for which the current Agent and latest version remain eligible; resume alone does not make an ineligible or private Agent discoverable. A successful pause or resume response is returned only after Catalog synchronization completes, and the CLI prints it only after the exact Agent and requested source status pass validation. Pause and resume each send one POST at most, and the CLI never automatically replays either mutation after a lost response or an untrusted 2xx.

If a pause or resume response is lost or untrusted, its source outcome is unknown: run `agents get <agent-id> --json` to read the authoritative source, use normal Search/discovery readback when Catalog visibility matters, and explicitly reconcile a stale projection instead of repeating the source mutation to force a green result. `active_catalog_unavailable` can mean the source mutation already committed, so wait for Catalog authority and use the returned reconcile action rather than replaying pause or resume. `agent_mutation_conflict` means the rejected mutation raced with another source change: GET the exact Agent, merge the current state with the intended change, and create a new explicit mutation.

`agents reconcile` does not change the Agent source state. It reads that authoritative state and projects it back into the active Catalog after a partial lifecycle/publication result. Reconcile also sends one POST at most and prints success only after the response proves the exact Agent and `reconciled:true`. If its response is lost, read source with `agents get`, inspect Catalog state through normal Search/discovery rather than treating `get` as Catalog proof, then explicitly decide whether another reconcile is needed.

An invoke returns the invocation in `data`. If the agent ran cleanly but did not finish the task within its step budget, you get **HTTP 200 with `success:false` and `data.output.error: "max_steps_exceeded"`** — that is a graceful stop, not a platform error; read `data.output`/`data.events`, then re-invoke with a higher step budget: pass `--max-steps 20` (CLI) or include `"max_steps": 20` in the invoke input object (the runtime reads `max_steps` from the input, overriding the version default). A genuine infrastructure failure (sandbox crash, timeout) returns 502 — and note a 502 body may be a non-JSON HTML edge page, so treat a non-JSON 502 as a transient infra error to retry, not a readable result.

## Share Local Compute As A Worker

```bash
settlemesh worker start --name local-model --public --model local/model --endpoint http://localhost:11434/v1/chat/completions --credits-per-second 0.05
```

Other users can find published public worker offers through service search.

Pricing is **fractional per compute-second** (`--credits-per-second`); a job is billed `rate × (completed_at − started_at)`. Inspect a finished job's status, timing, and billed cost with `settlemesh worker job <job-id>` (shows `metadata.settlement_cost_credits`; `tool events` does not resolve `wjob_` ids). Omitting the rate makes the offer **free** (callers run it at 0 Aev) — the CLI prints a stderr note when that happens, so a silent free offer is never an accident. Charges can be sub-1-Aev — a short job at a small rate (e.g. 0.05/s × 4s = 0.2 Aev) may not visibly move an integer balance readout, so verify billing via the job/request cost, not a balance delta. A caller that owns the offer pays the cost normally (no owner-earnings rebate to self); owner earnings only apply when a *different* account calls your offer. The `worker start` process keeps the offer online while it polls; stop it with Ctrl-C, or from another shell run `settlemesh worker stop <worker-id>` — that takes the worker and its offers offline and signals a still-running poller to exit (so it won't re-register itself online).

To lend your **logged-in local coding agent** (Claude Code / Codex) instead of a model endpoint, use `settlemesh worker lend codex --allow <caller-login-email>` (repeat `--allow` per caller), or `settlemesh worker lend codex --friends` to permit **all your accepted friends** at once (see "Add Friends And Share Compute" below). See the next section for how the caller then reaches it.

## Use A Worker Someone Lent You (allowlist offers — NOT searchable)

If someone **lent** you their machine's compute (e.g. `settlemesh worker lend codex --allow you@example.com`), that offer is an **allowlist offer**: it is private to its allowlist and **does NOT appear in `settlemesh search` or `worker-offers list`**. Do not waste time searching for it — you won't find it, and that is by design (not an error). You address it **directly by the LENDER's SettleMesh login email** (which is the offer's `public_id`), or by an `offer_id` (`wof_…`) they hand you:

```bash
settlemesh worker invoke <lender-login-email> --input '{"prompt":"Write a Python is_prime(n). Only code."}'
# e.g. settlemesh worker invoke alice@gmail.com --input '{"prompt":"..."}'
# HTTP equivalent: POST /v1/worker-offers/<lender-login-email>/invoke  with body {"input":{"prompt":"..."}}
```

The input for a lent coding agent is `{"prompt":"<your task>"}`. Public/searchable offers should be invoked as `settlemesh call <offer_id>`; the `worker invoke <lender-login-email>` form is the compatibility shortcut for private allowlist offers addressed by email. The call is synchronous (waits for the result; add `--no-wait` to get a job id and poll `GET /v1/worker-jobs/<id>`). You must be on the offer's allowlist (matched by your login email or account id) — otherwise you get `worker_forbidden`. A `worker_unavailable` means the lender's machine is offline (their `worker lend` process stopped); it is not an addressing error.

## Add Friends And Share Compute With Them

`settlemesh friend` is your trust graph: add another account as a friend (two-sided consent), and any **friends-visibility** worker offer you publish becomes callable by every accepted friend — share your logged-in coding agent or a model endpoint with everyone you trust at once, without listing each caller. Friendships are between accounts, addressed by **login email** (find yours with `settlemesh whoami`).

```bash
settlemesh friend add bob@example.com           # send a request — bob must accept (no auto-friend)
settlemesh friend accept alice@example.com      # accept a pending incoming request
settlemesh friend list [--pending]              # accepted friends; --pending shows requests; --status blocked too
settlemesh friend remove bob@example.com              # unfriend — immediately revokes their access to your friends offers
settlemesh friend block spammer@example.com           # block (prevents requests/calls); `friend unblock` reverses it
```

Create a group Conversation only from accepted trust identities. In `friend list --json`, use the
other side's stable `requester` or `addressee_owner` value from an accepted edge; do not substitute
an email address for a group member owner id. The authenticated creator is read from the server and
included automatically. Every initial or added member still passes the server-owned trust gate, and
only the group owner can add or remove another member. A newly added member sees messages from their
joined membership generation onward, not earlier history.

The current group lifecycle CLI is exactly `create`, `add`, `remove`, and `leave`; do not invent
`group list`, `group show`, or `group send` aliases. Use the returned Conversation id with `inbox`
and `msg` below. Removing a member or leaving is a direct authenticated revocation and needs no
second confirmation. The owner must remove every other active member before leaving:

```bash
settlemesh group create <group-id> --member <owner-id> [--member <owner-id> ...] --json
settlemesh group add <group-id> <owner-id> --json
settlemesh group remove <group-id> <owner-id> --json
settlemesh group leave <group-id> --json
```

Send text to an existing Conversation, or read incoming work from the same Conversation authority.
`msg send` does not create a Conversation or a second message store; it returns the canonical Message
identity from the existing Conversation Action. `inbox` derives unread counts from the server-owned
monotonic read cursor; it is a polling projection, not a second notification store or an online-presence
signal. Open the exact conversation before advancing only a sequence you observed:

```bash
settlemesh msg send <conversation-id> --text "Please review the release." --json
settlemesh inbox --limit 20 --json
settlemesh msg list <conversation-id> --after 0 --limit 100 --json
settlemesh msg read <conversation-id> <observed-sequence> --json
settlemesh inbox --json  # authoritative unread readback; repeated read cannot move the cursor backward
```

An unknown conversation and a conversation you no longer belong to both fail closed as not found. Do
not retry a failed read by guessing a later sequence; list again and use an observed sequence.

Then lend to ALL accepted friends in one shot (no per-caller `--allow`):

```bash
settlemesh worker lend claude-code --friends --credits-per-minute 20
```

A friend invokes it exactly like any lent offer — by your login email (the section above). Friends offers are **non-public** (never in search) and gated to the live trust graph: unfriend or block and access is revoked at once. Same metered, sandboxed billing as any worker offer — the friend pays, you earn.

## Load The Toolset Into Your Own Agent Runtime

Export SettleMesh tools as native function schemas for your SDK, including user-published services:

```bash
settlemesh tool schema --format openai --include-services --json
# --format also supports anthropic | mcp | settle
```
