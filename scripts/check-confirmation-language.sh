#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  printf 'confirmation-language guard requires ripgrep (rg)\n' >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

policy='A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation.'
quote_boundary='Quote/preflight informs cost and availability; it is not a second confirmation.'
confirmation_boundary='Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions.'
canonical_service_unit_actions='The official canonical Service Unit action paths are `POST /v1/service-units/{unit}/actions/{action}/quote`, `POST /v1/service-units/{unit}/actions/{action}/invoke`, and `GET /v1/service-units/{unit}/actions/{action}/invocations/{invoke_attempt_id}`.'
legacy_capability_canonical='The canonical HTTP invoke path is `POST /v1/capabilities/{id}/invoke`; `POST /v1/tools/{id}/call` is a compatibility alias only.'
automatic_publication='Passing mechanical protocol checks publish and become discoverable automatically; there is no default human approval queue.'
card_containment='Aev is the platform accounting unit. Card top-up is contained and Legal remains unverified; do not claim card funding is available.'

# Core contract sentences required in agent.md + llms.txt (discover-before-auth, scoped quote auth, Legal independence).
discover_before_auth='use anonymous `semesh search` / `show` and other public read-only GET surfaces first — they work without login so you can learn the catalog and contracts'
public_capability_quote='A public platform capability quote is anonymous and read-only: it creates no hold, charge, ledger entry, allowance read, or provider call.'
restricted_quote_auth='Authenticate to quote an agent, worker offer, app endpoint, service unit, non-public target, or any payer-aware or call-chain request.'
legal_independence='confirmation cannot turn an unavailable Legal state into PASS'
deployment_availability='subject to live server/preflight availability'
deployment_authorization_unavailable='deployment_authorization_unavailable'
cleanup_response_truth='A successful delete response proves only that the confirmed user request was accepted and the app/deployment records were projected unavailable/deleted; it does not prove that every Cloud Run, E2B, Cloudflare, custom-domain, secret, or CDN resource is absent.'
cleanup_durability_truth='Provider cleanup is a best-effort attempt in that older behavior, not a durable user-visible `teardown_pending` completion contract.'
cleanup_recovery_truth='Treat an explicit provider absence readback as evidence only for that exact resource; otherwise keep cleanup `unknown`, preserve the app/deployment/provider identifiers, and use manual operator recovery.'
cleanup_current_fail_closed_truth='The owner route also fails closed with `503 app_teardown_unavailable` while durable admission, a single recovery owner, and exact provider-absence readback are not integrated; that response means the app was unchanged and no provider cleanup started.'

projections=(
  agent.md
  llms.txt
  llms-install.md
  commands/deploy.md
  plugins/semesh/commands/deploy.md
  rules/semesh.mdc
  cursor/semesh.mdc
  plugins/semesh-cursor/rules/semesh.mdc
  skills/semesh/SKILL.md
  plugins/semesh/SKILL.md
  plugins/semesh-cursor/skills/semesh/SKILL.md
  plugins/semesh-codex/skills/semesh/SKILL.md
)

journey_projections=(
  rules/semesh.mdc
  cursor/semesh.mdc
  plugins/semesh-cursor/rules/semesh.mdc
  skills/semesh/SKILL.md
  plugins/semesh/SKILL.md
  plugins/semesh-cursor/skills/semesh/SKILL.md
  plugins/semesh-codex/skills/semesh/SKILL.md
)

contract_projections=(
  llms.txt
  llms-install.md
  "${journey_projections[@]}"
)

core_contract_projections=(
  agent.md
  llms.txt
)

canonical_service_unit_projections=(
  agent.md
  llms.txt
)

deploy_truth_projections=(
  README.md
  agent.md
  llms.txt
  llms-install.md
  commands/deploy.md
  plugins/semesh/commands/deploy.md
  rules/semesh.mdc
  cursor/semesh.mdc
  plugins/semesh-cursor/rules/semesh.mdc
  skills/semesh/SKILL.md
  plugins/semesh/SKILL.md
  plugins/semesh-cursor/skills/semesh/SKILL.md
  plugins/semesh-codex/skills/semesh/SKILL.md
  templates/agent-webapp-demo/README.md
  templates/claude-code-starter/README.md
  templates/claude-code-starter/CLAUDE.md
  templates/ai-saas-paid-api/README.md
  templates/auth-payments-minimal/README.md
  templates/paid-tool-api/README.md
)

failed=0

require_text() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "$expected" "$file"; then
    printf 'missing required confirmation policy in %s: %s\n' "$file" "$expected" >&2
    failed=1
  fi
}

# Returns 0 when a line broadens anonymous quote beyond the exact public,
# platform-capability boundary or restores the stale all-quotes-authenticated claim.
text_has_false_quote_claim() {
  local text="$1"
  local quote_text="${text//$public_capability_quote/}"

  if printf '%s\n' "$quote_text" | rg -qi \
    -e '\b(all|any|every)[[:space:]]+quotes?\b.{0,80}\banonymous\b' \
    -e 'quotes?\s+(works?|is\s+available)\s+anonymously' \
    -e '(anonymous|unauthenticated)\s+users?\s+can\s+(get\s+)?quotes?' \
    -e 'quotes?\s+without\s+(login|auth)\b' \
    -e 'quotes?\s+is\s+anonymous\b' \
    -e '\b(agent|worker([[:space:]]+offer)?|app([[:space:]]+endpoint)?|service[[:space:]]+unit|non-public|payer-aware|call-chain)[[:space:]-]+quotes?\b.{0,80}\banonymous\b' \
    -e 'quote requires login or `semesh_api_key` under the current contract' \
    -e 'quote via `post /v1/billing/quote` is authenticated but read-only'; then
    return 0
  fi
  if printf '%s\n' "$quote_text" | rg -Pqi -- \
    '(?<!not )(?<!not an )\banonymous\s+quotes?\b'; then
    return 0
  fi

  return 1
}

# Context-aware forbidden-policy matcher (case-insensitive).
# Returns 0 when text contains a rejected claim; 1 when clean.
text_has_forbidden_policy() {
  local text="$1"

  if text_has_false_quote_claim "$text"; then
    return 0
  fi

  # Login/authenticate before search/show/discover, or login then search.
  # Does NOT match "search/show/discover first, then login once before quote/invoke"
  # or bare "run semesh login once" without a discovery reordering.
  if printf '%s\n' "$text" | rg -qi \
    -e '\b(log[[:space:]]*in|login|authenticate[ds]?)\b.{0,120}?\b(before|then)[[:space:]]+(search|show|discover)\b'; then
    return 0
  fi

  # First-call-free guarantees.
  if printf '%s\n' "$text" | rg -qi \
    -e '\bfirst[[:space:]]+call[[:space:]]+free\b' \
    -e '\bfirst-call[[:space:]]+free\b' \
    -e '\bfirst[[:space:]]+call[[:space:]]+to[[:space:]]+each[[:space:]]+official[[:space:]]+capability[[:space:]]+is[[:space:]]+free\b' \
    -e '\bfirst[[:space:]]+calls?[[:space:]]+are[[:space:]]+free\b' \
    -e '\bfirst[[:space:]]+call[[:space:]]+is[[:space:]]+free\b'; then
    return 0
  fi

  # Confirmation bypasses Legal / makes Legal available.
  # Does NOT match "confirmation cannot turn an unavailable Legal state into PASS".
  if printf '%s\n' "$text" | rg -qi \
    -e '\bconfirmation[[:space:]]+bypasses[[:space:]]+Legal\b' \
    -e '\bconfirmation[[:space:]]+makes[[:space:]]+Legal[[:space:]]+available\b'; then
    return 0
  fi

  # Unqualified Stripe/card/top-up availability claims.
  if printf '%s\n' "$text" | rg -qi \
    -e '\bfunded[[:space:]]+(via|by[[:space:]]+card[[:space:]]+via)[[:space:]]+Stripe\b' \
    -e '\b(card[[:space:]]+top-?up|live[[:space:]]+Stripe|Stripe[[:space:]]+top-?up)[[:space:]]+is[[:space:]]+available\b' \
    -e '\bunconditional[[:space:]]+Stripe\b'; then
    return 0
  fi
  if printf '%s\n' "$text" | rg -i -n -- 'card[[:space:]]+funding[[:space:]]+is[[:space:]]+available' \
    | rg -iv -- 'do[[:space:]]+not[[:space:]]+claim[[:space:]]+card[[:space:]]+funding[[:space:]]+is[[:space:]]+available' >/dev/null; then
    return 0
  fi

  return 1
}

# Returns 0 only for the retired claim that promotes direct capability/tool
# routes to the canonical Service Unit contract.
text_has_legacy_capability_canonical_claim() {
  local text="$1"
  printf '%s\n' "$text" | grep -Fq -- "$legacy_capability_canonical"
}

# Current production has no durable user-visible teardown_pending state machine.
# Reject prose that turns an accepted record delete or an in-process best-effort
# attempt into a guarantee of eventual provider cleanup.
text_has_false_cleanup_claim() {
  local text="$1"

  if printf '%s\n' "$text" | rg -qi \
    -e '\bqueues?[[:space:]]+(provider[[:space:]]+cleanup|Cloud Run[[:space:]]*/[[:space:]]*E2B[[:space:]]*/[[:space:]]*Cloudflare)' \
    -e '\bcleanup[[:space:]]+(?:is[[:space:]]+)?(?:durably[[:space:]]+)?enqueued\b' \
    -e '\bteardown_pending\b.{0,100}\buntil[[:space:]]+cleanup[[:space:]]+is[[:space:]]+confirmed\b' \
    -e '\bdeployments?\b.{0,80}\bremains?\b.{0,80}\bteardown_pending\b.{0,100}\breclaimer\b' \
    -e '\bfailed.{0,80}cleanup.{0,100}\boperator[[:space:]]+reclaimer\b' \
    -e '\bproviders?\b.{0,100}\beventually\b.{0,80}\b(?:deleted|cleaned|removed)\b' \
    -e '\b(?:all|every)[[:space:]]+(?:provider[[:space:]]+)?resources?.{0,80}\b(?:will|are guaranteed to)[[:space:]]+(?:be[[:space:]]+)?(?:deleted|cleaned|removed)\b'; then
    return 0
  fi

  return 1
}

# Reject an unqualified promise that a source-deploy command creates a live URL
# or paid product. Conditional target-policy wording, existing-resource readback,
# and explicit negative statements remain valid.
text_has_false_deploy_claim() {
  local text="$1"

  if ! printf '%s\n' "$text" | rg -qi \
    -e '\b(one[[:space:]]+command|one[[:space:]]+deploy)\b.{0,140}\b(turns?|makes?|creates?)\b.{0,140}\b(live|paid)[[:space:]]+(app|product|url)\b' \
    -e '\bsemesh[[:space:]]+deploy\b.{0,160}\b(ships?|provisions?|wires?|gives?|returns?)\b.{0,160}\b(live[[:space:]]+url|paid[[:space:]]+product|login|database|billing)\b' \
    -e '\bdeploy\b.{0,140}\b(to|returns?|gives?|→)[[:space:]]+(a[[:space:]]+)?live[[:space:]]+([^[:space:]]+[[:space:]]+)?url\b' \
    -e '\bdeploy[[:space:]]+and[[:space:]]+monetize\b.{0,140}\bone[[:space:]]+command\b'; then
    return 1
  fi

  if printf '%s\n' "$text" | rg -qi \
    -e '\b(when|after|once|if|only[[:space:]]+if)\b.{0,120}\b(authorization|admission|availability|gate)\b.{0,100}\b(available|allows?|ready|restored)\b' \
    -e '\bsubject[[:space:]]+to\b.{0,100}\bavailability\b' \
    -e '\b(target|intended|future)[[:space:]]+(product[[:space:]]+)?(policy|command|contract|pipeline)\b' \
    -e '\b(existing|already[[:space:]]+serving)\b.{0,100}\b(app|deployment|status|url|readback)\b' \
    -e '\b(does[[:space:]]+not|do[[:space:]]+not|cannot|never|will[[:space:]]+not)\b.{0,140}\b(live|url|deploy|deployment)\b' \
    -e '\b(not[[:space:]]+(evidence|proof)|fails?[[:space:]]+closed)\b'; then
    return 1
  fi

  return 0
}

# In-memory self-test (printf | rg fixtures only — no persistent files).
# Proves regex catches bad + nearby-good contradictions and accepts good sequencing.
run_self_tests() {
  local st_failed=0

  assert_rejects() {
    local name="$1"
    local text="$2"
    if ! text_has_forbidden_policy "$text"; then
      printf 'self-test FAIL (expected reject): %s\n  text: %s\n' "$name" "$text" >&2
      st_failed=1
    fi
  }

  assert_allows() {
    local name="$1"
    local text="$2"
    if text_has_forbidden_policy "$text"; then
      printf 'self-test FAIL (expected allow): %s\n  text: %s\n' "$name" "$text" >&2
      st_failed=1
    fi
  }

  # --- Positive mutation cases (must reject) ---
  assert_rejects 'quote works anonymously' \
    'Quote works anonymously for any caller.'
  assert_rejects 'quote is available anonymously' \
    'The quote is available anonymously without a key.'
  assert_rejects 'anonymous users can get quotes' \
    'Anonymous users can get quotes from the billing API.'
  assert_rejects 'unauthenticated users can quote' \
    'Unauthenticated users can quote paid tools.'
  assert_rejects 'unauthenticated users can get quotes' \
    'unauthenticated users can get quotes before login'
  assert_rejects 'quote without login' \
    'You can quote without login on this platform.'
  assert_rejects 'quote without auth' \
    'Agents may quote without auth.'
  assert_rejects 'anonymous quote' \
    'Use the anonymous quote path for discovery.'
  assert_rejects 'quote is anonymous' \
    'Billing quote is anonymous under the current contract.'
  assert_rejects 'all quotes are anonymous' \
    'All quotes are anonymous and read-only.'
  assert_rejects 'agent quote is anonymous' \
    'An agent quote is anonymous.'
  assert_rejects 'stale all-auth quote claim' \
    'Quote requires login or `SEMESH_API_KEY` under the current contract (`POST /v1/billing/quote` is authenticated — not anonymous)'
  assert_rejects 'login before search' \
    'Always login before search.'
  assert_rejects 'authenticate before show' \
    'Authenticate before show for every task.'
  assert_rejects 'login before discover' \
    'Login before discover, then inspect contracts.'
  assert_rejects 'login then search' \
    'run semesh login then search the catalog'
  assert_rejects 'login once then search' \
    'login once (a human approves in the browser), then search'
  assert_rejects 'first call free' \
    'The first call free for every official tool.'
  assert_rejects 'first-call free' \
    'Enjoy first-call free usage forever.'
  assert_rejects 'first call capability free' \
    'first call to each official capability is free'
  assert_rejects 'first call is free' \
    'Your first call is free.'
  assert_rejects 'confirmation bypasses Legal' \
    'confirmation bypasses Legal gates after the user agrees'
  assert_rejects 'confirmation makes Legal available' \
    'confirmation makes Legal available for Stripe'
  assert_rejects 'funded via Stripe' \
    'Aev is funded via Stripe.'
  assert_rejects 'funded by card via Stripe' \
    'Balance is funded by card via Stripe.'
  assert_rejects 'card top-up is available' \
    'card top-up is available in production'
  assert_rejects 'live Stripe is available' \
    'live Stripe is available today'
  assert_rejects 'Stripe top-up is available' \
    'Stripe top-up is available for all accounts'
  assert_rejects 'unconditional Stripe' \
    'unconditional Stripe funding is fine to claim'
  assert_rejects 'card funding is available' \
    'card funding is available without gates'

  # Nearby contradiction: correct discover guidance next to a bad quote claim.
  assert_rejects 'nearby good+bad quote contradiction' \
    'Discover with anonymous semesh search / show first. Also, quote works anonymously.'
  assert_rejects 'scoped public quote plus broad contradiction' \
    "$public_capability_quote All quotes are anonymous."
  assert_rejects 'anonymous quote followed by nearby denial' \
    'Use the anonymous quote path. Billing quote is not anonymous.'
  assert_rejects 'nearby good+bad login-then-search' \
    'Use public GET surfaces first — but login once (a human approves in the browser), then search.'

  # --- Negative mutation cases (must allow) ---
  assert_allows 'scoped public platform quote' \
    'A public platform capability quote is anonymous and read-only: it creates no hold, charge, ledger entry, allowance read, or provider call.'
  assert_allows 'restricted quote requires auth' \
    'Authenticate to quote an agent, worker offer, app endpoint, service unit, non-public target, or any payer-aware or call-chain request.'
  assert_allows 'not an anonymous quote' \
    'This is not an anonymous quote; auth is required.'
  assert_allows 'discover then login once before quote' \
    'discover/search/show first, then login once before authenticated quote/invoke'
  assert_allows 'search show first then login once' \
    'use anonymous semesh search / show first — they work without login so you can learn the catalog. Run semesh login once when the contract needs auth for quote or invoke.'
  assert_allows 'login once bare (no reordering)' \
    'A human approves in the browser; run semesh login once; the CLI reuses the stored session.'
  assert_allows 'login once before authenticated quote only' \
    'After discovery, login once before authenticated quote or paid invoke.'
  assert_allows 'do not claim card funding' \
    'Card top-up is contained and Legal remains unverified; do not claim card funding is available.'
  assert_allows 'legal independence wording' \
    'Legal-required operations are blocked by the Legal gate; confirmation cannot turn an unavailable Legal state into PASS.'
  assert_allows 'no first-call promotion assumption' \
    'Do not assume a first-call promotion from cached documentation.'
  assert_allows 'anonymous search show only' \
    'use anonymous semesh search / show and other public read-only GET surfaces first — they work without login'

  if ! text_has_legacy_capability_canonical_claim "$legacy_capability_canonical"; then
    printf 'self-test FAIL (expected reject): legacy capability-canonical claim\n' >&2
    st_failed=1
  fi
  if text_has_legacy_capability_canonical_claim "$canonical_service_unit_actions"; then
    printf 'self-test FAIL (expected allow): canonical Service Unit action paths\n' >&2
    st_failed=1
  fi

  if ! text_has_false_cleanup_claim 'Delete queues provider cleanup and every deployment remains teardown_pending until cleanup is confirmed.'; then
    printf 'self-test FAIL (expected reject): false durable cleanup projection\n' >&2
    st_failed=1
  fi
  if ! text_has_false_cleanup_claim 'Cleanup is enqueued and providers are eventually deleted by the reclaimer.'; then
    printf 'self-test FAIL (expected reject): false eventual cleanup projection\n' >&2
    st_failed=1
  fi
  if text_has_false_cleanup_claim 'The record is deleted first; provider cleanup remains unknown unless the exact provider absence readback succeeds, and manual recovery keeps the identifiers.'; then
    printf 'self-test FAIL (expected allow): bounded cleanup truth\n' >&2
    st_failed=1
  fi

  if ! text_has_false_deploy_claim 'One command turns an app into a live, paid product.'; then
    printf 'self-test FAIL (expected reject): unqualified one-command deploy promise\n' >&2
    st_failed=1
  fi
  if ! text_has_false_deploy_claim '`semesh deploy` ships the app and returns a live URL.'; then
    printf 'self-test FAIL (expected reject): unqualified live URL promise\n' >&2
    st_failed=1
  fi
  if ! text_has_false_deploy_claim '`semesh deploy` returns a live URL. Current deployment authorization is unavailable.'; then
    printf 'self-test FAIL (expected reject): later denial must not repair earlier promise\n' >&2
    st_failed=1
  fi
  if text_has_false_deploy_claim 'When deployment authorization is available, the intended `semesh deploy` command returns a server-issued live URL after a successful serving readback.'; then
    printf 'self-test FAIL (expected allow): conditional target deploy contract\n' >&2
    st_failed=1
  fi
  if text_has_false_deploy_claim '`semesh deploy` does not return a live URL while authorization is unavailable.'; then
    printf 'self-test FAIL (expected allow): explicit unavailable denial\n' >&2
    st_failed=1
  fi
  if text_has_false_deploy_claim 'For an existing app, `semesh deploy url` returns a URL readback; this is observation and not evidence that a new release can start.'; then
    printf 'self-test FAIL (expected allow): existing-resource observation\n' >&2
    st_failed=1
  fi

  if (( st_failed )); then
    printf 'confirmation-language self-test: FAIL\n' >&2
    return 1
  fi
  printf 'confirmation-language self-test: PASS\n'
  return 0
}

if ! run_self_tests; then
  failed=1
fi

for file in "${projections[@]}"; do
  require_text "$file" "$policy"
  require_text "$file" "$quote_boundary"
  require_text "$file" "$confirmation_boundary"
done

for file in "${journey_projections[@]}"; do
  require_text "$file" 'semesh search "<task>" --json'
  require_text "$file" 'semesh show <service-or-operation-id> --json'
  require_text "$file" 'semesh quote <entrypoint-id> --input '\''{...}'\'' --json'
  require_text "$file" 'semesh call <entrypoint-id> --input '\''{...}'\'' --json'
done

for file in "${contract_projections[@]}"; do
  require_text "$file" "$automatic_publication"
  require_text "$file" "$card_containment"
done

for file in "${canonical_service_unit_projections[@]}"; do
  require_text "$file" "$canonical_service_unit_actions"
  if text_has_legacy_capability_canonical_claim "$(<"$file")"; then
    printf 'legacy capability-canonical wording remains in %s: %s\n' \
      "$file" "$legacy_capability_canonical" >&2
    failed=1
  fi
done

for file in "${core_contract_projections[@]}"; do
  require_text "$file" "$discover_before_auth"
  require_text "$file" "$public_capability_quote"
  require_text "$file" "$restricted_quote_auth"
  require_text "$file" "$legal_independence"
done

require_text llms.txt "$deployment_availability"

for file in "${deploy_truth_projections[@]}"; do
  require_text "$file" "$deployment_authorization_unavailable"
  require_text "$file" 'app_deployments.create'
  while IFS= read -r line; do
    if text_has_false_deploy_claim "$line"; then
      printf 'unqualified deploy success claim remains in %s: %s\n' "$file" "$line" >&2
      failed=1
    fi
  done < "$file"
done

# Exact deprecated confirmation / tool-call wording (stable literals).
for forbidden in \
  'Confirm before any paid / deploy / destructive action' \
  '--confirm for paid' \
  'Confirm intent before any paid, deploy, publish, or destructive action' \
  'with a confirm step before any paid call' \
  'costly, side-effecting, or destructive calls' \
  'wait for human approval by default' \
  'enters a human approval queue by default' \
  'semesh tool call <tool-id>'; do
  if rg -n -F -- "$forbidden" "${projections[@]}" 2>/dev/null; then
    printf 'deprecated confirmation wording remains: %s\n' "$forbidden" >&2
    failed=1
  fi
done

# Context-aware quote boundary over every public projection.
for file in "${projections[@]}"; do
  while IFS= read -r line; do
    if text_has_false_quote_claim "$line"; then
      printf 'deprecated or over-broad quote wording remains in %s: %s\n' "$file" "$line" >&2
      failed=1
    fi
  done < "$file"
done
if rg -n -i \
  -e '\b(log[[:space:]]*in|login|authenticate[ds]?)\b.{0,120}?\b(before|then)[[:space:]]+(search|show|discover)\b' \
  "${projections[@]}" 2>/dev/null; then
  printf 'deprecated policy wording remains: login/authenticate before search/show/discover (or login then search)\n' >&2
  failed=1
fi
if rg -n -i \
  -e '\bfirst[[:space:]]+call[[:space:]]+free\b' \
  -e '\bfirst-call[[:space:]]+free\b' \
  -e '\bfirst[[:space:]]+call[[:space:]]+to[[:space:]]+each[[:space:]]+official[[:space:]]+capability[[:space:]]+is[[:space:]]+free\b' \
  -e '\bfirst[[:space:]]+calls?[[:space:]]+are[[:space:]]+free\b' \
  -e '\bfirst[[:space:]]+call[[:space:]]+is[[:space:]]+free\b' \
  "${projections[@]}" 2>/dev/null; then
  printf 'deprecated policy wording remains: first-call-free guarantee\n' >&2
  failed=1
fi
if rg -n -i \
  -e '\bconfirmation[[:space:]]+bypasses[[:space:]]+Legal\b' \
  -e '\bconfirmation[[:space:]]+makes[[:space:]]+Legal[[:space:]]+available\b' \
  "${projections[@]}" 2>/dev/null; then
  printf 'deprecated policy wording remains: confirmation bypasses/makes Legal available\n' >&2
  failed=1
fi
if rg -n -i \
  -e '\bfunded[[:space:]]+(via|by[[:space:]]+card[[:space:]]+via)[[:space:]]+Stripe\b' \
  -e '\b(card[[:space:]]+top-?up|live[[:space:]]+Stripe|Stripe[[:space:]]+top-?up)[[:space:]]+is[[:space:]]+available\b' \
  -e '\bunconditional[[:space:]]+Stripe\b' \
  "${projections[@]}" 2>/dev/null; then
  printf 'deprecated policy wording remains: unqualified Stripe/card/top-up availability\n' >&2
  failed=1
fi
if rg -n -i -- 'card[[:space:]]+funding[[:space:]]+is[[:space:]]+available' "${projections[@]}" 2>/dev/null \
  | rg -iv -- 'do[[:space:]]+not[[:space:]]+claim[[:space:]]+card[[:space:]]+funding[[:space:]]+is[[:space:]]+available'; then
  printf 'deprecated policy wording remains: card funding is available (unqualified)\n' >&2
  failed=1
fi

for pair in \
  'rules/semesh.mdc:cursor/semesh.mdc' \
  'rules/semesh.mdc:plugins/semesh-cursor/rules/semesh.mdc' \
  'skills/semesh/SKILL.md:plugins/semesh/SKILL.md' \
  'skills/semesh/SKILL.md:plugins/semesh-cursor/skills/semesh/SKILL.md' \
  'skills/semesh/SKILL.md:plugins/semesh-codex/skills/semesh/SKILL.md' \
  'commands/deploy.md:plugins/semesh/commands/deploy.md'; do
  left="${pair%%:*}"
  right="${pair#*:}"
  if ! cmp -s "$left" "$right"; then
    printf 'mirrored public projections differ: %s != %s\n' "$left" "$right" >&2
    failed=1
  fi
done

require_text agent.md 'semesh apps delete <app-id> --confirm'
require_text agent.md '428 confirmation_required'
require_text agent.md 'agent must STOP here — never auto-pay'
require_text agent.md 'semesh msg send <conversation-id> --text "Please review the release." --json'
require_text agent.md "$cleanup_response_truth"
require_text agent.md "$cleanup_durability_truth"
require_text agent.md "$cleanup_recovery_truth"
require_text agent.md "$cleanup_current_fail_closed_truth"
for required_deploy_truth in \
  'semesh deploy preflight . --full-stack --json' \
  'admission.can_start_now' \
  "$deployment_authorization_unavailable" \
  'semesh deploy status <app-id> --json' \
  'semesh deploy logs <build-id> --json' \
  'semesh deploy url <app-id> --json' \
  'semesh apps delete <app-id> --confirm' \
  'no default human approval queue'; do
  require_text agent.md "$required_deploy_truth"
done

for unavailable_deploy_claim in \
  'then returns the stable live URL in `data.url`' \
  'preview` is the default target'; do
  if rg -n -F -- "$unavailable_deploy_claim" agent.md >/dev/null; then
    printf 'agent.md still promises unavailable deployment behavior: %s\n' "$unavailable_deploy_claim" >&2
    failed=1
  fi
done

if text_has_false_cleanup_claim "$(<agent.md)"; then
  printf 'agent.md still promises durable or guaranteed provider cleanup that current production does not expose\n' >&2
  failed=1
fi

if (( failed )); then
  exit 1
fi

printf 'confirmation-language guard: PASS\n'
