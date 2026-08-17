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
)

failed=0

blind_retry_pattern='(?:(?<!not )(?<!never )retry\s+blindly.{0,120}(?:timeout|502)|(?:timeout|502).{0,120}(?<!not )(?<!never )retry\s+blindly)'
failure_no_charge_pattern='(?:(?:http|network|timeout|502|call|action).{0,100}(?:fail(?:ed|ure)?|error).{0,100}(?:not|nothing|no\s+amount\s+was)\s+(?:was\s+)?charged|(?:not|nothing)\s+(?:was\s+)?charged.{0,120}(?:http|network|timeout|502|call|action).{0,60}(?:fail(?:ed|ure)?|error))'
recursive_cost_pattern='(?:function\s+extractCost\s*\(|const\s+keys\s*=\s*\[[^]]*(?:cost|amount|charged)[^]]*\].{0,500}extractCost\s*\()'
provider_cost_read_pattern='(?:response|result|r)\.(?:json|data|payload)(?:\?\.|\.)[^;\n]{0,160}(?:cost|amount|charged|billed)'
estimate_as_charge_pattern='(?:charged\s*=.{0,160}(?:estimate|PRICE_)|actual\s*=.{0,160}(?:estimate|PRICE_)|(?:≈|approx(?:imate)?).{0,80}charged|estimate.{0,160}(?:charged|captured))'
success_as_capture_pattern='(?:charged.{0,80}(?:on|after)\s+(?:provider\s+|http\s+)?success|(?:provider\s+|http\s+)?success.{0,80}(?:charged|captured))'
raw_session_storage_pattern='(?:owner(?:Key)?\s*=?.{0,160}extractPayerToken|return\s+extractPayerToken\([^)]*\)\s*\|\|\s*[\x22\x27]anonymous[\x22\x27]|(?:insert|update).{0,200}(?:payer|session|token))'

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

# Provider payloads are capability output, not settlement authority.  Mining
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
  'live Stripe/card funding is claimed without Legal/provider availability' \
  '(?:funded\s+(?:by|via).{0,40}Stripe|(?:Stripe|card)\s+(?:top-?up|funding)\s+is\s+available|top-?up\s+with\s+Stripe)' \
  templates/ai-saas-paid-api/server.js \
  templates/ai-saas-paid-api/README.md \
  templates/auth-payments-minimal/server.js \
  templates/auth-payments-minimal/README.md
reject_pattern \
  'template fabricates a fixed hosted funding path instead of consuming live availability' \
  '(?:topup|topup_url)\s*:\s*"\/__semesh\/billing"' \
  templates/ai-saas-paid-api/server.js \
  templates/auth-payments-minimal/server.js

for server in \
  templates/ai-saas-paid-api/server.js \
  templates/auth-payments-minimal/server.js \
  templates/paid-tool-api/server.js; do
  require_pattern "$server" 'explicit trusted capture header' 'x-semesh-charged-aev'
  require_pattern "$server" 'settlement state is explicit' 'settlement_status'
  require_pattern "$server" 'logical operation identity is forwarded' 'Idempotency-Key'
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

# The demo's paid polish action must never fall back to the app-owner wallet, invent capture from a
# provider result, or lose the logical operation identity needed for a safe replay.
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
  'polish requires one stable logical operation identity' 'Idempotency-Key'
require_pattern templates/agent-webapp-demo/app/api/polish/route.ts \
  'polish returns explicit settlement state' 'settlement_status'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'capability helper forwards logical operation identity' 'Idempotency-Key'
require_pattern templates/agent-webapp-demo/lib/semesh.ts \
  'capability helper exposes trusted response headers' 'response\.headers'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser preserves uncertain polish operation across reload' 'sessionStorage'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser exposes exact same-operation recovery' 'Retry same operation'
require_pattern templates/agent-webapp-demo/app/page.tsx \
  'browser calls an amount captured only from settlement state' 'settlement_status\s*===\s*[\x22\x27]captured[\x22\x27]'
require_pattern templates/ai-saas-paid-api/server.js \
  'funding navigation validates the live URL before exposing it' 'const\s+topup\s*=\s*safeFundingURL\(detail\.topup_url\)'
require_pattern templates/paid-tool-api/server.js \
  'non-2xx response consumes trusted capture evidence' 'const\s+capture\s*=\s*captureEvidence\(r\.headers\);[\s\S]{0,160}if\s*\(r\.status\s*>=\s*400\)'
require_pattern templates/paid-tool-api/server.js \
  'unknown settlement gives an executable same-operation recovery' 'exact same input and Idempotency-Key'
require_pattern templates/paid-tool-api/public/index.html \
  'browser exposes an exact same-operation retry' 'Retry same operation'

for client in \
  templates/ai-saas-paid-api/public/app.js \
  templates/auth-payments-minimal/public/app.js; do
  require_pattern "$client" 'browser creates/preserves a logical operation identity' 'Idempotency-Key'
  require_pattern "$client" 'unknown settlement tells the user to reconcile' 'reconcil'
  require_pattern "$client" 'unknown settlement exposes an exact same-operation retry' 'Retry same operation'
  require_pattern "$client" 'same-operation retry survives navigation/reload' 'sessionStorage'
done
require_pattern templates/ai-saas-paid-api/public/app.js \
  'AI retry preserves the original request body' 'state\.operation\s*=\s*\{[^}]*prompt:[\s\S]{0,800}operation\.prompt'
require_pattern templates/auth-payments-minimal/public/app.js \
  'minimal retry preserves the original request body' 'operation\s*=\s*operation\s*\|\|[\s\S]{0,200}input:[\s\S]{0,800}currentOperation\.input'
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
  'paid action quotes before invoke' 'quoteAction\([\s\S]{0,800}invokeCapability'
require_pattern templates/auth-payments-minimal/server.js \
  'action-path quote failure blocks invoke' 'const\s+quoted\s*=\s*await\s+quoteAction\(payer,\s*input\);[\s\S]{0,300}if\s*\(!quoted\.ok\)[\s\S]{0,300}return\s+sendPreEffectProblem[\s\S]{0,700}invokeCapability'
require_pattern templates/auth-payments-minimal/server.js \
  'non-2xx invoke preserves trusted capture evidence' 'const\s+capture\s*=\s*captureEvidence\(r\.headers\);[\s\S]{0,200}if\s*\(r\.status\s*>=\s*400\)'
require_pattern templates/auth-payments-minimal/server.js \
  'live quote posts the billing quote path' 'POST".{0,8}"/v1/billing/quote|/v1/billing/quote'
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
  'unknown outcomes preserve the same logical operation identity' \
  'same (?:idempotency key|logical operation identity).{0,200}reconcil'
require_text agent.md \
  'transport failure remains unknown and replays only exact body/key' \
  "A transport failure such as HTTP 502 leaves a paid call's outcome unknown. Preserve the original request and reconcile it; only resend when the server supports replay, using the exact same body and **\`Idempotency-Key\`** for that logical operation. A fresh key creates a fresh paid operation. Send an **\`Idempotency-Key\`** on retriable paid calls:"
require_pattern agent.md \
  'only trusted capture evidence may be called charged' \
  '(?:captured ledger.{0,160}x-semesh-charged-aev|x-semesh-charged-aev.{0,160}captured ledger)'
require_text agent.md \
  'publish fee requirement is distinct from current charge admission' \
  '`fee_required` is separate from `will_charge`'
require_text agent.md \
  'paid publish admission reports its stable unavailable code' \
  '`publish_settlement_unavailable`'
require_text agent.md \
  'paid publish admission exposes its stable recovery field' \
  '`admission.fix`'
require_text agent.md \
  'positive-quota recovery is inspection-only until named-service authorization' \
  'inspection only: run `semesh services list --json`; freeing 1 shared service entry requires high-impact visibility changes and confirmation_required; obtain a separate explicit request naming each affected service before running `semesh services publish <explicitly-authorized-existing-service-id> --visibility private --json`; after the authorized changes, rerun `semesh services config-status <id> --json`'
require_text agent.md \
  'existing-service authorization does not add confirmation to ordinary publish' \
  'This separate authorization applies only to changing existing services; the ordinary publish itself still needs no duplicate confirmation.'
require_text agent.md \
  'new site recovery never reads an unpersisted dynamic service' \
  'A rejected first-time `sites publish` has no persisted service record: its fix never sends you to dynamic-service config-status, says that no site record was created, and gives the site-specific publish command to retry after the stated prerequisite.'
require_text agent.md \
  'zero-quota recovery remains unable and private until settlement admission exists' \
  'With a zero free quota, shared publish is currently `UNABLE`, the service stays private, and the fix gives the exact config-status readback to run after atomic settlement admission is enabled.'
require_text agent.md \
  '503 is conditional on earlier gates and unchanged admission' \
  'if the earlier mechanical gates pass and the admission state is unchanged'
require_text agent.md \
  'conditional 503 keeps recovery fields and precedes effects' \
  'the publish returns HTTP 503 with the same recovery fields before any hold, capture, or publication'
require_pattern agent.md \
  'copyable publish flow branches before mutation and reads search after publish' \
  'semesh services upload ./service\.json --json\s+semesh services config-status <id> --json\s+# continue only when publish_fee\.admission\.can_start_now is true:\s+semesh services publish <id> --visibility public --json\s+semesh search <service-id>'
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
