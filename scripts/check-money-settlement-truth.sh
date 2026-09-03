#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  printf 'money-settlement truth guard requires ripgrep (rg)\n' >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

sources=(
  agent.md
  templates/ai-saas-paid-api/server.js
  templates/ai-saas-paid-api/public/app.js
  templates/ai-saas-paid-api/public/index.html
  templates/ai-saas-paid-api/README.md
  templates/auth-payments-minimal/server.js
  templates/auth-payments-minimal/public/app.js
  templates/auth-payments-minimal/public/index.html
  templates/auth-payments-minimal/README.md
  templates/paid-tool-api/server.js
  templates/paid-tool-api/public/index.html
  templates/paid-tool-api/README.md
  templates/agent-webapp-demo/lib/semesh.ts
  templates/agent-webapp-demo/app/api/polish/route.ts
  templates/agent-webapp-demo/app/page.tsx
)

failed=0

blind_retry_pattern='(?:(?<!not )(?<!never )retry\s+blindly.{0,120}(?:timeout|502)|(?:timeout|502).{0,120}(?<!not )(?<!never )retry\s+blindly)'
failure_no_charge_pattern='(?:(?:http|network|timeout|502|call|action).{0,100}(?:fail(?:ed|ure)?|error).{0,100}(?:not|nothing|no\s+amount\s+was)\s+(?:was\s+)?charged|(?:not|nothing)\s+(?:was\s+)?charged.{0,120}(?:http|network|timeout|502|call|action).{0,60}(?:fail(?:ed|ure)?|error))'
recursive_cost_pattern='(?:function\s+extractCost\s*\(|const\s+keys\s*=\s*\[[^]]*(?:cost|amount|charged)[^]]*\].{0,500}extractCost\s*\()'
provider_cost_read_pattern='(?:response|result|r)\.(?:json|data|payload)(?:\?\.|\.)[^;\n]{0,160}(?:cost|amount|charged|billed)'
estimate_as_charge_pattern='(?:charged\s*=.{0,160}(?:estimate|PRICE_)|actual\s*=.{0,160}(?:estimate|PRICE_)|(?:≈|approx(?:imate)?).{0,80}charged|estimate.{0,160}(?:charged|captured))'
success_as_capture_pattern='(?:charged.{0,80}(?:on|after)\s+(?:provider\s+|http\s+)?success|(?:provider\s+|http\s+)?success.{0,80}(?:charged|captured))'
raw_session_storage_pattern='(?:owner(?:Key)?\s*=?.{0,160}extractPayerToken|return\s+extractPayerToken\([^)]*\)\s*\|\|\s*[\x22\x27]anonymous[\x22\x27]|(?:insert|update).{0,200}(?:payer|session|token))'
inverted_funding_gate_pattern='does\s+not\s+treat\s+(?:card\s+)?funding\s+as\s+unavailable\s+until'
quote_as_capture_pattern='successful\s+(?:exact\s+)?quote.{0,80}captures?'
legacy_deployment_action_pattern='legacy\s+`?app_deployments\.create`?'

reject_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2
  if rg -n -i -U --pcre2 -- "$pattern" "$@"; then
    printf 'money-settlement truth violation: %s\n' "$label" >&2
    failed=1
  fi
}

require_pattern() {
  local file="$1"
  local label="$2"
  local pattern="$3"
  if ! rg -q -i -U --pcre2 -- "$pattern" "$file"; then
    printf 'money-settlement truth contract missing in %s: %s\n' "$file" "$label" >&2
    failed=1
  fi
}

require_text() {
  local file="$1"
  local label="$2"
  local expected="$3"
  if ! grep -Fq -- "$expected" "$file"; then
    printf 'money-settlement truth contract missing in %s: %s\n' "$file" "$label" >&2
    failed=1
  fi
}

run_self_tests() {
  local self_failed=0

  assert_rejects() {
    local label="$1"
    local pattern="$2"
    local text="$3"
    if ! printf '%s\n' "$text" | rg -q -i -U --pcre2 -- "$pattern"; then
      printf 'money-settlement self-test FAIL (expected reject): %s\n' "$label" >&2
      self_failed=1
    fi
  }

  assert_allows() {
    local label="$1"
    local pattern="$2"
    local text="$3"
    if printf '%s\n' "$text" | rg -q -i -U --pcre2 -- "$pattern"; then
      printf 'money-settlement self-test FAIL (expected allow): %s\n' "$label" >&2
      self_failed=1
    fi
  }

  assert_rejects 'blind timeout retry' "$blind_retry_pattern" \
    'Safe to retry blindly on a timeout/502.'
  assert_allows 'explicitly prohibits blind retry' "$blind_retry_pattern" \
    'On timeout/502, do not retry blindly; reconcile the same operation.'
  assert_rejects 'network error claims no capture' "$failure_no_charge_pattern" \
    'Network error — you were not charged.'
  assert_allows 'network error stays unknown' "$failure_no_charge_pattern" \
    'Network error — settlement is unknown; reconcile the same operation.'
  assert_rejects 'recursive cost miner' "$recursive_cost_pattern" \
    'function extractCost(value) { return value.children.map(extractCost); }'
  assert_rejects 'direct provider cost field read' "$provider_cost_read_pattern" \
    'const charged = response.json.data.cost;'
  assert_allows 'provider output text extraction' "$provider_cost_read_pattern" \
    'const text = response.json.data.text;'
  assert_rejects 'estimate labelled charged' "$estimate_as_charge_pattern" \
    'const charged = response.cost_aev || response.estimate_aev;'
  assert_allows 'estimate remains pre-call information' "$estimate_as_charge_pattern" \
    'The estimate is read-only pre-call information; settlement remains unknown.'
  assert_rejects 'provider success labelled charged' "$success_as_capture_pattern" \
    'The user is charged on success only.'
  assert_allows 'capture evidence remains authoritative' "$success_as_capture_pattern" \
    'Provider success is output only; final charge requires trusted capture evidence.'
  assert_rejects 'inverted funding availability gate' "$inverted_funding_gate_pattern" \
    'This template does not treat card funding as unavailable until a live gate says otherwise.'
  assert_allows 'funding stays unavailable until allowed' "$inverted_funding_gate_pattern" \
    'This template does not treat card funding as available unless a live gate explicitly allows it.'
  assert_rejects 'quote mislabeled as capture' "$quote_as_capture_pattern" \
    'A successful exact quote captures the exact amount.'
  assert_allows 'receipt establishes capture' "$quote_as_capture_pattern" \
    'A successful delivery has a terminal receipt that captures the exact amount.'
  assert_rejects 'current deployment Action mislabeled legacy' "$legacy_deployment_action_pattern" \
    'The legacy `app_deployments.create` operation is disabled.'
  assert_rejects 'raw payer token becomes database owner' "$raw_session_storage_pattern" \
    'return extractPayerToken(req) || "anonymous";'
  assert_allows 'verified principal scopes database rows' "$raw_session_storage_pattern" \
    'const principal = await resolveSettlePrincipal(req);'

  if (( self_failed )); then
    return 1
  fi
  printf 'money-settlement truth self-test: PASS\n'
}

if ! run_self_tests; then
  failed=1
fi

run_safe_funding_url_tests() {
  node <<'NODE'
const assert = require("node:assert/strict");
const { safeFundingURL } = require("./templates/ai-saas-paid-api/server.js");

for (const rejected of [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "http://example.com/topup",
  "//example.com/topup",
  "https://user@example.com/topup",
  "https://user:secret@example.com/topup",
  "/safe\nunsafe",
  "/\\example.com/topup",
]) {
  assert.equal(safeFundingURL(rejected), null, `expected rejection: ${JSON.stringify(rejected)}`);
}

assert.equal(safeFundingURL("/__semesh/billing?return=wallet"), "/__semesh/billing?return=wallet");
assert.equal(safeFundingURL("https://billing.example.com/topup?return=wallet"), "https://billing.example.com/topup?return=wallet");
NODE
}

if ! run_safe_funding_url_tests; then
  printf 'safe funding URL contract: FAIL\n' >&2
  failed=1
else
  printf 'safe funding URL contract: PASS\n'
fi

if ! node --test templates/paid-tool-api/server.test.js; then
  printf 'paid-tool settlement authority contract: FAIL\n' >&2
  failed=1
else
  printf 'paid-tool settlement authority contract: PASS\n'
fi

if ! node --test templates/ai-saas-paid-api/server.test.js; then
  printf 'AI SaaS canonical Unit Action contract: FAIL\n' >&2
  failed=1
else
  printf 'AI SaaS canonical Unit Action contract: PASS\n'
fi

if ! node --test \
  templates/auth-payments-minimal/server.test.js \
  templates/auth-payments-minimal/public/app.test.js; then
  printf 'auth-payments-minimal quote authority contract: FAIL\n' >&2
  failed=1
else
  printf 'auth-payments-minimal quote authority contract: PASS\n'
fi

if ! node --test templates/agent-webapp-demo/lib/*.test.mjs; then
  printf 'agent-webapp settlement authority contract: FAIL\n' >&2
  failed=1
else
  printf 'agent-webapp settlement authority contract: PASS\n'
fi

# A transport result alone cannot prove whether a paid effect was captured.
reject_pattern \
  'timeout/502 guidance says to retry blindly' \
  "$blind_retry_pattern" \
  agent.md
reject_pattern \
  'HTTP/network failure is presented as proof that no charge happened' \
  "$failure_no_charge_pattern" \
  "${sources[@]}"

# Provider payloads are Action output, not settlement authority. Mining
# arbitrary nested cost/amount/charged-like fields must never drive the UI.
reject_pattern \
  'recursive arbitrary response-field cost mining remains' \
  "$recursive_cost_pattern" \
  templates/ai-saas-paid-api/server.js \
  templates/auth-payments-minimal/server.js \
  templates/paid-tool-api/server.js
reject_pattern \
  'provider response cost-like field is read as settlement data' \
  "$provider_cost_read_pattern" \
  templates/paid-tool-api/server.js

# An estimate may be shown before/alongside an operation, but never relabelled
# or accumulated as captured money when trusted capture evidence is absent.
reject_pattern \
  'estimate or approximation is presented/accumulated as charged' \
  "$estimate_as_charge_pattern" \
  templates/ai-saas-paid-api/server.js \
  templates/ai-saas-paid-api/public/app.js \
  templates/auth-payments-minimal/server.js \
  templates/auth-payments-minimal/public/app.js \
  templates/paid-tool-api/server.js \
  templates/paid-tool-api/public/index.html
reject_pattern \
  'provider/HTTP success is presented as capture proof' \
  "$success_as_capture_pattern" \
  templates/ai-saas-paid-api/public/index.html \
  templates/auth-payments-minimal/public/index.html
reject_pattern \
  'funding gate is inverted to assume availability' \
  "$inverted_funding_gate_pattern" \
  templates/ai-saas-paid-api/README.md \
  templates/auth-payments-minimal/README.md
reject_pattern \
  'an effect-zero quote is presented as capture' \
  "$quote_as_capture_pattern" \
  templates/ai-saas-paid-api/README.md \
  templates/ai-saas-paid-api/server.js \
  templates/paid-tool-api/README.md \
  templates/paid-tool-api/server.js \
  templates/auth-payments-minimal/README.md
reject_pattern \
  'current deployment Platform Action is mislabeled legacy' \
  "$legacy_deployment_action_pattern" \
  templates/agent-webapp-demo/README.md \
  templates/ai-saas-paid-api/README.md \
  templates/paid-tool-api/README.md
funding_claim_pattern='(?:funded\s+(?:by|via).{0,40}Stripe|(?:Stripe|card)\s+(?:top-?up|funding)\s+is\s+available|top-?up\s+with\s+Stripe)'
if rg -n -i -U --pcre2 -- "$funding_claim_pattern" \
  templates/ai-saas-paid-api/server.js \
  templates/ai-saas-paid-api/README.md \
  templates/auth-payments-minimal/server.js \
  templates/auth-payments-minimal/README.md \
  | rg -iv -- '(do not|never|cannot|must not).{0,80}(claim|infer|assume)|\b(not|unavailable|contained)\b.{0,80}(Stripe|card|top-?up|funding)' >/dev/null; then
  printf 'money-settlement truth violation: live Stripe/card funding is claimed without Legal/provider availability\n' >&2
  failed=1
fi
reject_pattern \
  'template fabricates a fixed hosted funding path instead of consuming live availability' \
  '(?:topup|topup_url)\s*:\s*"\/__semesh\/billing"' \
  templates/ai-saas-paid-api/server.js \
  templates/auth-payments-minimal/server.js

runtime_flows=(
  templates/ai-saas-paid-api/server.js
  templates/auth-payments-minimal/server.js
  templates/paid-tool-api/server.js
  templates/agent-webapp-demo/lib/semesh.ts
)

for runtime in "${runtime_flows[@]}"; do
  require_pattern "$runtime" 'canonical public Search' '/v1/service-units'
  require_pattern "$runtime" 'public discovery scope' 'scope=public'
  require_pattern "$runtime" 'bounded Catalog token forwarding' 'X-Semesh-Catalog-Token'
  require_pattern "$runtime" 'nested Action quote' '/actions/[\s\S]{0,400}/quote'
  require_pattern "$runtime" 'nested Action invoke' '/actions/[\s\S]{0,400}/invoke'
  require_pattern "$runtime" 'exact UnitActionRef pin' 'unit_action_ref'
  require_pattern "$runtime" 'exact Catalog pin' 'catalog'
  require_pattern "$runtime" 'bounded fixed-point quote budget' 'ceiling_aev_atoms'
  require_pattern "$runtime" 'bounded request deadline' 'deadline'
  require_pattern "$runtime" 'quote reference reused by invoke' 'quote_reference'
  require_pattern "$runtime" 'effect confirmation digest is explicit' 'confirmed_effect_digest'
  require_pattern "$runtime" 'request replay identity is forwarded' 'Idempotency-Key'
  require_pattern "$runtime" 'server observation identity is preserved' 'invocation_id'
  require_pattern "$runtime" 'Invocation receipt is read' '/v1/invocations/[\s\S]{0,300}/receipt'
  reject_pattern \
    'runtime retains a noncanonical or retired consumer endpoint or identifier' \
    '(?:/v1/capabilities|/v1/billing/quote|/v1/tools|/v1/models|/v1/services/search|llm\.chat|image\.gpt-image-2|wof_)' \
    "$runtime"
done

for model_runtime in \
  templates/ai-saas-paid-api/server.js \
  templates/paid-tool-api/server.js \
  templates/agent-webapp-demo/lib/semesh.ts; do
  require_pattern "$model_runtime" 'DeepSeek stays a versioned model choice pin' 'model_choice_pin'
done

# A browser payer/session credential is an authorization secret, never a durable row owner.
# Resolve it through the platform session authority and persist only its stable principal id.
reject_pattern \
  'raw payer/session token is used as a database identity' \
  "$raw_session_storage_pattern" \
  templates/agent-webapp-demo/app/api/snippets/route.ts
reject_pattern \
  'snippet persistence reads a raw payer/session token directly' \
  'extractPayerToken' \
  templates/agent-webapp-demo/app/api/snippets/route.ts
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'session is resolved by the stable platform authority' '/__semesh/me'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'resolver returns a non-sensitive principal id' 'principalId'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'resolver verifies the authority authentication result' 'payload\.authenticated\s*!==\s*true'
require_pattern templates/agent-webapp-demo/app/api/snippets/route.ts \
  'snippet reads fail closed when identity cannot be verified' 'resolveSettlePrincipal'
require_pattern templates/agent-webapp-demo/app/api/snippets/route.ts \
  'database rows are scoped only by the verified principal' '\[principal\.principalId(?:,|\])'
require_pattern templates/agent-webapp-demo/app/api/snippets/route.ts \
  'database failure is a non-success response' 'database_query_failed'
reject_pattern \
  'database failure is projected as a successful empty list' \
  'result\.error[\s\S]{0,240}snippets\s*:\s*\[\][\s\S]{0,120}status\s*:\s*200' \
  templates/agent-webapp-demo/app/api/snippets/route.ts
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'failed refresh preserves the last truthful list' 'if\s*\(!res\.ok\s*\|\|\s*json\.error\)\s*\{[\s\S]{0,200}return;[\s\S]{0,160}setSnippets'
reject_pattern \
  'anonymous fallback can read or write shared rows' \
  '(?:\|\|\s*[\x22\x27]anonymous[\x22\x27]|owner\s*=\s*[\x22\x27]anonymous[\x22\x27])' \
  templates/agent-webapp-demo/app/api/snippets/route.ts

# The demo's paid polish Action must never fall back to the app-owner wallet, invent settlement from
# an Action result, or collapse the replay key into the returned Invocation identity.
reject_pattern \
  'polish provider success is presented as metered/captured' \
  '(?:metered\s*:\s*true|Polished \(metered to you\))' \
  templates/agent-webapp-demo/app/api/polish/route.ts \
  templates/agent-webapp-demo/app/page.tsx
require_pattern templates/agent-webapp-demo/app/api/polish/route.ts \
  'missing payer is rejected before invocation' 'if\s*\(!payerToken\)[\s\S]{0,300}status\s*:\s*401'
require_pattern templates/agent-webapp-demo/app/api/polish/route.ts \
  'payer authentication precedes input parsing' 'extractPayerToken\(req\)[\s\S]{0,500}status\s*:\s*401[\s\S]{0,500}await req\.json\(\)'
require_pattern templates/agent-webapp-demo/app/api/polish/route.ts \
  'polish requires one stable request replay identity' 'Idempotency-Key'
require_pattern templates/agent-webapp-demo/app/api/polish/route.ts \
  'polish returns explicit settlement state' 'settlement_status'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'Unit Action helper forwards request replay identity' 'Idempotency-Key'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'Unit Action helper reads the terminal receipt' '/v1/invocations/.{0,160}/receipt'
require_pattern templates/agent-webapp-demo/lib/polish-operation.mjs \
  'effect-zero requires both no effect and no money state' 'effect_state\s*===\s*[\x22\x27]none[\x22\x27]\s*&&\s*value\.money_state\s*===\s*[\x22\x27]none[\x22\x27]'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser preserves uncertain polish request across reload' 'sessionStorage'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser exposes exact same-request recovery' 'Retry same request'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser keeps replay and observation identities distinct' 'idempotencyKey[\s\S]{0,800}invocationId'
require_pattern templates/ai-saas-paid-api/server.js \
  'funding navigation validates the live URL before exposing it' 'const\s+topup\s*=\s*safeFundingURL\(detail\.topup_url\)'
require_pattern templates/paid-tool-api/server.js \
  'terminal receipt is settlement authority' 'receipt[\s\S]{0,240}captured_aev_atoms'
require_pattern templates/paid-tool-api/server.js \
  'unknown settlement gives an executable same-request recovery' 'exact same (?:request|input and Idempotency-Key)'
require_pattern templates/paid-tool-api/public/index.html \
  'browser exposes an exact same-request retry' 'Retry same request'

for client in \
  templates/ai-saas-paid-api/public/app.js \
  templates/auth-payments-minimal/public/app.js; do
  require_pattern "$client" 'browser creates/preserves a request replay identity' 'Idempotency-Key'
  require_pattern "$client" 'unknown settlement tells the user to reconcile' 'reconcil'
  require_pattern "$client" 'unknown settlement exposes an exact same-request retry' 'Retry same request'
  require_pattern "$client" 'same-request retry survives navigation/reload' 'sessionStorage'
  require_pattern "$client" 'request and Invocation identities are distinct' 'idempotencyKey[\s\S]{0,1000}invocationId'
done
require_pattern templates/ai-saas-paid-api/public/app.js \
  'AI retry preserves the original request body' '(?:requestRecord|state\.request)[\s\S]{0,800}prompt'
require_pattern templates/auth-payments-minimal/public/app.js \
  'minimal retry preserves the original request body' '(?:requestRecord|currentRequest)[\s\S]{0,800}input'
reject_pattern \
  'auth-payments-minimal still assumes a static PRICE_AEV fallback' \
  'PRICE_AEV' \
  templates/auth-payments-minimal/server.js \
  templates/auth-payments-minimal/public/app.js
reject_pattern \
  'auth-payments-minimal still projects static estimate_aev' \
  'estimate_aev' \
  templates/auth-payments-minimal/server.js \
  templates/auth-payments-minimal/public/app.js
require_pattern templates/auth-payments-minimal/server.js \
  'paid Action quotes before invoke and reuses the reference' 'quote_reference[\s\S]{0,2000}/invoke'
require_pattern templates/auth-payments-minimal/server.js \
  'quote failure remains pre-effect' 'effect_started\s*:\s*false'
require_pattern templates/auth-payments-minimal/server.js \
  'terminal receipt uses fixed-point atoms' 'captured_aev_atoms'
require_pattern templates/auth-payments-minimal/server.js \
  'canonical quote kinds are preserved' 'representative_floor'
require_pattern templates/auth-payments-minimal/public/app.js \
  'UI distinguishes exact vs floor vs hold ceiling' 'hold_ceiling'
require_pattern templates/auth-payments-minimal/public/app.js \
  'UI surfaces quote failure code and fix' 'err\.code'
require_pattern templates/auth-payments-minimal/README.md \
  'README states quote failure prevents invoke' 'Quote failure prevents invoke'
require_pattern templates/auth-payments-minimal/README.md \
  'README states no price is assumed' 'No price is assumed'

require_pattern agent.md \
  'unknown outcomes preserve request and Invocation identity' \
  'same (?:request|idempotency key).{0,300}(?:invocation_id|reconcil)'
require_text agent.md \
  'transport failure remains unknown and replays only exact body/key' \
  "A transport failure such as HTTP 502 leaves a paid call's outcome unknown. Preserve the original request and reconcile it; only resend when the server supports replay, using the exact same body and **\`Idempotency-Key\`** for that replayable request. A fresh key creates a fresh request that may create another effect. Recover the server-returned \`invocation_id\`, then use that distinct identity for observation. Send an **\`Idempotency-Key\`** on retriable paid calls:"
require_pattern agent.md \
  'terminal Invocation receipt is settlement authority' \
  'GET /v1/invocations/\{invocation_id\}/receipt[\s\S]{0,500}(?:held|captured|released).{0,100}atoms'
require_text agent.md \
  'terminal receipt binds every model/commercial identity' \
  'It must bind the same `invocation_id` and distinct `Idempotency-Key`, `UnitActionRef`, Catalog pin, `model_choice_pin`, `quote_reference`, `quote_receipt`, all four input/price/policy/effect digests, safe-integer held/captured/released atoms, delivery evidence, and settlement reference.'
require_text agent.md \
  'quote/receipt atom wire values are safe integers' \
  'Quote and receipt atom fields are unquoted JSON integers. In JavaScript, accept them only when `Number.isSafeInteger(value) && value >= 0`; reject quoted, fractional, negative, or unsafe values.'
require_text llms.txt \
  'llms atom wire values are safe integers' \
  'Quote and receipt atom fields are unquoted JSON integers. In JavaScript, accept them only when `Number.isSafeInteger(value) && value >= 0`; reject quoted, fractional, negative, or unsafe values.'
for authoring_command in \
  'semesh units create --from <openapi.json-or-url> --json' \
  'semesh units draft get <unit-id> --json' \
  'semesh configurations create' \
  'semesh units draft put <unit-id> --if-match <etag> --file unit.json --json' \
  'semesh units validate <unit-id> --json' \
  'semesh units test <unit-id> --json' \
  'semesh units publish <unit-id> --if-match <etag> --json' \
  'semesh units publication get <publication-id> --json'; do
  require_text agent.md 'Unit-native authoring contract' "$authoring_command"
done
require_text agent.md \
  'nonterminal publish preserves one recovery owner' \
  'preserve its `publication_id` and read that operation instead of starting a second publish'
reject_pattern \
  'generic publish recovery hides quota-specific actions' \
  'publish within the free quota or wait until atomic publish settlement admission is available' \
  agent.md
reject_pattern \
  'positive-quota recovery changes visibility without named-service authorization' \
  'make at least 1 existing shared service entry private with `semesh services publish <existing-service-id> --visibility private --json`' \
  agent.md
reject_pattern \
  'will_charge false is falsely presented as proof of a free publish' \
  '`will_charge:false` means you are still inside the free publish quota or the fee is disabled' \
  agent.md
reject_pattern \
  'paid publish is falsely described as an insufficient-balance 402' \
  'insufficient balance returns 402 without publishing' \
  agent.md

if (( failed )); then
  printf 'money-settlement truth guard: FAIL\n' >&2
  exit 1
fi

printf 'money-settlement truth guard: PASS\n'
