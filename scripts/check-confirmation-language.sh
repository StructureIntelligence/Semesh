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
canonical_service_unit_search='The official canonical Service Unit search path is `GET /v1/service-units/search?q={query}&scope={public|accessible|owned}`.'
supported_read_aliases='The supported non-canonical read-only compatibility aliases are `GET /v1/services/search`, `GET /v1/units/{id...}`, and `GET /v1/groups/{id}`; each calls the same canonical handler and returns byte-identical `data`, with no independent catalog or execution authority. New clients must use the canonical routes.'
canonical_service_unit_actions='The official canonical Service Unit action paths are `POST /v1/service-units/{unit_id}/actions/{action_id}/quote`, `POST /v1/service-units/{unit_id}/actions/{action_id}/invoke`, and `GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}`.'
canonical_invocation_reads='The official canonical Invocation read paths are `GET /v1/invocations/{invocation_id}/receipt` and `GET /v1/invocations/{invocation_id}/events`.'
canonical_replay='A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants.'
canonical_scope_auth='`scope=public` Search/Detail is anonymous; `scope=accessible` and `scope=owned` are authenticated actor-specific states and must not enter a shared cache.'
canonical_model_unit='Semesh publishes one public Model Service Unit'
selected_model_choice='deepseek-v3'
canonical_model_choice_pin='model_choice_pin'
catalog_token_boundary='Send the bounded `meta.catalog_token` as `X-Semesh-Catalog-Token` only on the exact advertised Guide, Group, or Unit GET; never send it to quote, invoke, or another origin.'
detail_quote_confirmation_truth='Field names are layer-specific: Unit Detail advertises `effect.requires_confirmation`, while the quote response advertises top-level `confirmation_required`. Do not substitute one path for the other.'
legacy_route_retirement='Retired legacy execution identities and resource-specific execution routes return only effect-zero `410 legacy_protocol_retired`; they never proxy, translate, execute, call a provider, or move money.'
legacy_capability_canonical='The canonical HTTP invoke path is `POST /v1/capabilities/{id}/invoke`; `POST /v1/tools/{id}/call` is a compatibility alias only.'
automatic_publication='Passing mechanical protocol checks publish and become discoverable automatically; there is no default human approval queue.'
card_containment='Aev is the platform accounting unit. Card top-up is contained and Legal remains unverified; do not claim card funding is available.'

# Core contract sentences required in agent.md + llms.txt (discover-before-auth, canonical quote auth, Legal independence).
discover_before_auth='use anonymous `semesh search` / `show` and other public read-only GET surfaces first — they work without login so you can learn the catalog and contracts'
canonical_action_quote='A canonical Service Unit Action quote is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call.'
canonical_action_quote_auth='Authenticate before every canonical Service Unit Action quote or invoke; Search and public Detail remain anonymous.'
skill_owned_scope_auth='Authenticate before every canonical Service Unit Action quote or invoke; Search and Detail with `scope=public` remain anonymous, while `scope=accessible` and `scope=owned` require authentication.'
accessible_worker_search='semesh search "lent coding agent from <lender>" --scope accessible --json'
accessible_worker_detail='semesh show <worker-unit-id> --scope accessible --json'
accessible_worker_call='semesh call <worker-unit-id> --action <coding-action-id> --scope accessible'
legal_independence='confirmation cannot turn an unavailable Legal state into PASS'
deployment_availability='subject to live server/preflight availability'
deployment_authorization_unavailable='deployment_authorization_unavailable'
cleanup_response_truth='A successful delete response proves only that the confirmed user request was accepted and the app/deployment records were projected unavailable/deleted; it does not prove that every Cloud Run, E2B, Cloudflare, custom-domain, secret, or CDN resource is absent.'
cleanup_durability_truth='Provider cleanup is a best-effort attempt in that older behavior, not a durable user-visible `teardown_pending` completion contract.'
cleanup_recovery_truth='Treat an explicit provider absence readback as evidence only for that exact resource; otherwise keep cleanup `unknown`, preserve the app/deployment/provider identifiers, and use manual operator recovery.'
cleanup_current_fail_closed_truth='The owner route also fails closed with `503 app_teardown_unavailable` while durable admission, a single recovery owner, and exact provider-absence readback are not integrated; that response means the app was unchanged and no provider cleanup started.'

retired_contract_markers=(
  '/v1/service-units?'
  'invoke_attempt_id'
  'invoke-attempt-id'
  '/v1/models'
  'llm.chat'
  'image.gpt-image-2'
  '/v1/billing/quote'
  '/v1/dynamic-services'
  '/v1/capabilities'
  '/v1/tools'
  '/v1/capabilities/'
  '/v1/tools/'
  'semesh services '
  'semesh tool '
  'SEMESH_CAPABILITY'
  'SEMESH_POLISH_CAPABILITY'
  'TOOL_CAPABILITY'
  'CAPABILITY_ID'
  'POLISH_CAPABILITY'
  'callCapability'
  'invokeCapability'
  'capability catalog'
  'deployment Unit'
  'selected deployment Action'
  'semesh search "deploy an app'
  'semesh show <deployment-unit-id>'
  'semesh quote <entrypoint-id>'
  'semesh agents invoke'
  'semesh worker invoke'
  '/v1/worker-offers/'
  '/operations/'
  'semesh apps api call'
  'semesh run <'
  'semesh call domain.'
  'service card'
  'service-card'
  'ServiceCard'
  'tool call'
  'compatibility rail'
  'compatibility shortcut'
  '<entrypoint-id>'
  '<offer_id>'
  'semesh worker job'
  '/v1/worker-jobs/'
  'capabilities_invoke'
  'capability/dynamic-service'
  'charge capability'
  'capability?'
  'call the selected entrypoint'
  'semesh tool show app_deployments.create --json'
  'search is capability/service discovery'
  '--quote-only'
  '--quote-out'
  'semesh search "lent coding agent from <lender>" --json'
  'semesh show <worker-unit-id> --json'
)

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
  llms-install.md
  "${journey_projections[@]}"
)

public_contract_scan_files=(
  .claude-plugin/marketplace.json
  README.md
  agent.md
  commands/deploy.md
  cursor/semesh.mdc
  docs/openai-plugin-submission.md
  llms-install.md
  llms.txt
  plugins/semesh-codex/.codex-plugin/plugin.json
  plugins/semesh-codex/skills/semesh/SKILL.md
  plugins/semesh-cursor/.cursor-plugin/plugin.json
  plugins/semesh-cursor/README.md
  plugins/semesh-cursor/rules/semesh.mdc
  plugins/semesh-cursor/skills/semesh/SKILL.md
  plugins/semesh/.claude-plugin/plugin.json
  plugins/semesh/SKILL.md
  plugins/semesh/commands/deploy.md
  rules/semesh.mdc
  semesh.latest.json
  server.json
  skills/semesh/SKILL.md
  templates/agent-webapp-demo/.env.example
  templates/agent-webapp-demo/CLAUDE.md
  templates/agent-webapp-demo/README.md
  templates/agent-webapp-demo/app/api/polish/route.ts
  templates/agent-webapp-demo/app/layout.tsx
  templates/agent-webapp-demo/app/page.tsx
  templates/agent-webapp-demo/lib/polish-operation.mjs
  templates/agent-webapp-demo/lib/semesh.ts
  templates/agent-webapp-demo/lib/settlement.mjs
  templates/ai-saas-paid-api/.env.example
  templates/ai-saas-paid-api/README.md
  templates/ai-saas-paid-api/public/app.js
  templates/ai-saas-paid-api/public/index.html
  templates/ai-saas-paid-api/server.js
  templates/auth-payments-minimal/.env.example
  templates/auth-payments-minimal/README.md
  templates/auth-payments-minimal/public/app.js
  templates/auth-payments-minimal/server.js
  templates/claude-code-starter/CLAUDE.md
  templates/claude-code-starter/README.md
  templates/paid-tool-api/.env.example
  templates/paid-tool-api/README.md
  templates/paid-tool-api/public/index.html
  templates/paid-tool-api/server.js
)

canonical_cli_projections=(
  agent.md
  "${journey_projections[@]}"
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

# Returns 0 when a line reintroduces an anonymous or legacy capability quote.
text_has_false_quote_claim() {
  local text="$1"

  if printf '%s\n' "$text" | rg -qi \
    -e '\b(all|any|every)[[:space:]]+quotes?\b.{0,80}\banonymous\b' \
    -e 'quotes?\s+(works?|is\s+available)\s+anonymously' \
    -e '(anonymous|unauthenticated)\s+users?\s+can\s+(get\s+)?quotes?' \
    -e 'quotes?\s+without\s+(login|auth)\b' \
    -e 'quotes?\s+is\s+anonymous\b' \
    -e '\b(agent|worker([[:space:]]+offer)?|app([[:space:]]+endpoint)?|service[[:space:]]+unit|non-public|payer-aware|call-chain)[[:space:]-]+quotes?\b.{0,80}\banonymous\b'; then
    return 0
  fi
  if printf '%s\n' "$text" | rg -Pqi -- \
    '(?<!not )(?<!not an )\banonymous\s+quotes?\b'; then
    return 0
  fi

  return 1
}

text_has_retired_contract_marker() {
  local text="$1"
  local marker

  for marker in "${retired_contract_markers[@]}"; do
    if [[ "$text" == *"$marker"* ]]; then
      return 0
    fi
  done

  return 1
}

# A canonical quote names a Service Unit and nested Action on the same command
# line. Provider/model/entrypoint quote commands without --action are retired.
text_has_noncanonical_quote_cli() {
  local text="$1"
  printf '%s\n' "$text" | awk '
    /semesh[[:space:]]+quote[[:space:]]+/ && $0 !~ /--action[[:space:]]+/ { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

# Canonical Action invocation reuses an immutable quote and a stable replay key.
# Accumulate shell continuations before evaluating each example.
text_has_noncanonical_action_call_cli() {
  local text="$1"
  printf '%s\n' "$text" | awk '
    function check_command() {
      if (command ~ /semesh[[:space:]]+call[[:space:]]+/ &&
          command ~ /--action[[:space:]]+/ &&
          (command !~ /--from-quote[[:space:]]+/ ||
           command !~ /--idempotency-key[[:space:]]+/)) {
        found = 1
      }
      command = ""
    }
    collecting {
      command = command " " $0
      if ($0 !~ /\\[[:space:]]*$/) {
        check_command()
        collecting = 0
      }
      next
    }
    /semesh[[:space:]]+call[[:space:]]+/ && /--action[[:space:]]+/ {
      command = $0
      if ($0 ~ /\\[[:space:]]*$/) collecting = 1
      else check_command()
    }
    END {
      if (collecting) check_command()
      exit(found ? 0 : 1)
    }
  '
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

# Compatibility-alias prose is a closed allowlist. After removing the exact
# canonical sentence and two exact benign controls, any remaining alias mention
# or alias route is drift. JSON is validated structurally below instead.
text_has_compatibility_alias_contradiction() {
  local text="$1"
  local scan="$text"
  local first_non_whitespace

  # Structured JSON is validated by exact keys and values below; do not apply
  # prose allowlisting to serialized metadata. Read the whole input before
  # selecting its first non-whitespace character so a later code/object line in
  # Markdown or JavaScript cannot misclassify preceding prose as JSON.
  first_non_whitespace="$(printf '%s' "$text" | awk '
    !found {
      for (pos = 1; pos <= length($0); pos += 1) {
        character = substr($0, pos, 1)
        if (character !~ /[[:space:]]/) {
          first = character
          found = 1
          break
        }
      }
    }
    END { printf "%s", first }
  ')"
  case "$first_non_whitespace" in
    \{|\[) return 1 ;;
  esac

  # Remove only statements whose complete semantics are known-safe. Any hostile
  # adjacent sentence or altered wording remains in scan and fails closed.
  scan="${scan//"$supported_read_aliases"/}"
  scan="${scan//"The compatibility aliases remain supported and read-only."/}"
  scan="${scan//"The compatibility aliases are deprecated but remain supported and read-only."/}"

  printf '%s\n' "$scan" | rg -Pqi -- \
    '\balias(?:es)?\b|\bGET[[:space:]]+/v1/(?:services/search\b|units/|groups/)|\b(?:POST|PUT|PATCH|DELETE)[[:space:]]+/v1/(?:services/search\b|units/|groups/)'
}

# Correct canonical sentences do not neutralize a nearby contradictory claim.
# Keep these matchers separate from literal retired-route markers so the hostile
# fixtures prove that semantic drift fails even when all required text is present.
text_has_contract_contradiction() {
  local text="$1"
  if text_has_compatibility_alias_contradiction "$text"; then
    return 0
  fi
  printf '%s\n' "$text" | rg -qi \
    -e '\bDeepSeek[[:space:]]+is[[:space:]]+(also[[:space:]]+)?a[[:space:]]+standalone[[:space:]]+Unit\b' \
    -e '\bIdempotency-Key[[:space:]]+and[[:space:]]+invocation_id[[:space:]]+are[[:space:]]+the[[:space:]]+same[[:space:]]+locator\b' \
    -e '\baccessible[[:space:]]+results?[[:space:]]+may[[:space:]]+enter[[:space:]]+a[[:space:]]+shared[[:space:]]+cache\b' \
    -e '\bowned[[:space:]]+results?[[:space:]]+may[[:space:]]+enter[[:space:]]+a[[:space:]]+shared[[:space:]]+cache\b' \
    -e '\ba[[:space:]]+legacy[[:space:]]+route[[:space:]]+may[[:space:]]+(translate|proxy|execute)([[:space:]]*/[[:space:]]*(translate|proxy|execute))*\b'
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
  assert_rejects 'canonical Action quote plus broad contradiction' \
    "$canonical_action_quote All quotes are anonymous."
  assert_rejects 'anonymous quote followed by nearby denial' \
    'Use the anonymous quote path. Billing quote is not anonymous.'
  assert_rejects 'nearby good+bad login-then-search' \
    'Use public GET surfaces first — but login once (a human approves in the browser), then search.'

  local contradiction_fixture
  for contradiction_fixture in \
    "$canonical_model_unit DeepSeek is also a standalone Unit." \
    "$canonical_replay Idempotency-Key and invocation_id are the same locator." \
    "$canonical_scope_auth Accessible results may enter a shared cache." \
    "$canonical_scope_auth Owned results may enter a shared cache." \
    "$supported_read_aliases The compatibility aliases are retired." \
    "$supported_read_aliases The compatibility aliases form an independent catalog authority." \
    "$supported_read_aliases The compatibility aliases may mutate and execute." \
    "$supported_read_aliases POST /v1/services/search" \
    "$legacy_route_retirement A legacy route may translate/proxy/execute."; do
    if ! text_has_contract_contradiction "$contradiction_fixture"; then
      printf 'self-test FAIL (expected semantic contradiction reject): %s\n' \
        "$contradiction_fixture" >&2
      st_failed=1
    fi
  done
  if text_has_contract_contradiction \
    "$canonical_model_unit $canonical_replay $canonical_scope_auth $supported_read_aliases $legacy_route_retirement"; then
    printf 'self-test FAIL (expected canonical semantic bundle allow)\n' >&2
    st_failed=1
  fi

  local alias_contradiction_fixture
  for alias_contradiction_fixture in \
    'The compatibility aliases remain retired.' \
    'The compatibility aliases constitute an independent catalog authority.' \
    'The compatibility aliases support mutation.' \
    'The compatibility aliases serve as an independent execution authority.' \
    'The compatibility aliases enable invocation.' \
    'The compatibility aliases permit charges.' \
    'The compatibility aliases are unsupported.' \
    'The compatibility aliases return 410.' \
    'The compatibility aliases are a separate authority.' \
    'The compatibility aliases return different data.' \
    'New clients may use the compatibility aliases.' \
    'The non-canonical aliases remain retired.' \
    'The read aliases constitute an independent catalog authority.' \
    'These aliases support mutation.' \
    'Legacy read aliases are unsupported.' \
    'Aliases remain retired.' \
    'Both aliases remain retired.' \
    'All three aliases form a second authority.' \
    'The same aliases return different data.' \
    'This alias permits mutation.' \
    $'Prose begins here.\n{"later":"object"}\nThe compatibility aliases are unsupported.' \
    'GET /v1/services/search is retired.' \
    'GET /v1/services/search is an independent catalog authority.' \
    'GET /v1/units/{id...} mutates catalog state.' \
    'GET /v1/units/{id...} is a second execution authority.' \
    'GET /v1/groups/{id} is a second catalog authority.' \
    'GET /v1/groups/{id} enables invocation.'; do
    if ! text_has_compatibility_alias_contradiction "$alias_contradiction_fixture"; then
      printf 'self-test FAIL (expected compatibility alias contradiction reject): %s\n' \
        "$alias_contradiction_fixture" >&2
      st_failed=1
    fi
  done
  local safe_alias_fixture
  for safe_alias_fixture in \
    "$supported_read_aliases" \
    'The compatibility aliases remain supported and read-only.' \
    'The compatibility aliases are deprecated but remain supported and read-only.' \
    '{"compatibilityReadAliases":{"search":{"alias":"GET /v1/services/search"}}}'; do
    if text_has_compatibility_alias_contradiction "$safe_alias_fixture"; then
      printf 'self-test FAIL (expected compatibility alias statement allow): %s\n' \
        "$safe_alias_fixture" >&2
      st_failed=1
    fi
  done

  # --- Negative mutation cases (must allow) ---
  assert_allows 'canonical Action quote is authenticated and effect-zero' \
    'A canonical Service Unit Action quote is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call.'
  assert_allows 'canonical Action quote and invoke require auth' \
    "$skill_owned_scope_auth"
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

  local retired_fixture
  for retired_fixture in \
    'GET /v1/service-units?q=chat&scope=public' \
    'GET /v1/capabilities/cap_1' \
    'GET /v1/tools/tool_1' \
    'POST /v1/billing/quote with capability_id' \
    'POST /v1/dynamic-services/dsvc_1/operations/run/invoke' \
    'semesh services publish service_1 --json' \
    'semesh tool schema --json' \
    'const CAPABILITY_ID = "llm.chat"' \
    'await callCapability(toolId, input)' \
    'discover the deployment Unit before preflight' \
    'semesh agents invoke agent_123' \
    'semesh worker invoke owner@example.com' \
    'POST /v1/worker-offers/owner@example.com/invoke' \
    'semesh apps api call app_123 endpoint_123' \
    'semesh call domain.search' \
    'semesh worker job wjob_123' \
    'GET /v1/worker-jobs/wjob_123' \
    'runtime config exposes capabilities_invoke' \
    'paid capability/dynamic-service with X-Semesh-Payer' \
    'auto-create or price that charge capability' \
    'action exposes capability?' \
    'call the selected entrypoint' \
    'semesh tool show app_deployments.create --json' \
    'search is capability/service discovery' \
    'semesh call unit_1 --action run --input "{}" --quote-only --quote-out quote.json' \
    'semesh search "lent coding agent from <lender>" --json'; do
    if ! text_has_retired_contract_marker "$retired_fixture"; then
      printf 'self-test FAIL (expected retired contract reject): %s\n' \
        "$retired_fixture" >&2
      st_failed=1
    fi
  done
  local supported_alias_fixture
  for supported_alias_fixture in \
    'GET /v1/services/search?q=chat&scope=public' \
    'GET /v1/units/unit_1?scope=public' \
    'GET /v1/groups/group_1?scope=public'; do
    if text_has_retired_contract_marker "$supported_alias_fixture"; then
      printf 'self-test FAIL (expected supported noncanonical read alias allow): %s\n' \
        "$supported_alias_fixture" >&2
      st_failed=1
    fi
  done
  if ! text_has_noncanonical_quote_cli 'semesh quote image.gpt-image-2'; then
    printf 'self-test FAIL (expected noncanonical quote reject)\n' >&2
    st_failed=1
  fi
  if text_has_noncanonical_quote_cli \
    'semesh quote <unit-id> --action <action-id> --input '\''<json>'\'' --json'; then
    printf 'self-test FAIL (expected canonical quote allow)\n' >&2
    st_failed=1
  fi
  if ! text_has_noncanonical_action_call_cli \
    'semesh call unit_1 --action run --input "{}" --json'; then
    printf 'self-test FAIL (expected direct Action call reject)\n' >&2
    st_failed=1
  fi
  if ! text_has_noncanonical_action_call_cli \
    'semesh call unit_1 --action run --from-quote quote.json --input "{}" --json'; then
    printf 'self-test FAIL (expected missing idempotency key reject)\n' >&2
    st_failed=1
  fi
  if text_has_noncanonical_action_call_cli \
    'semesh call <unit-id> --action <action-id> --from-quote <quote-file> --input '\''<same-json>'\'' --idempotency-key <stable-key> --wait --json'; then
    printf 'self-test FAIL (expected canonical Action call allow)\n' >&2
    st_failed=1
  fi
  if text_has_retired_contract_marker \
    'POST /v1/service-units/unit_1/actions/chat/invoke'; then
    printf 'self-test FAIL (expected canonical Action allow)\n' >&2
    st_failed=1
  fi
  if text_has_retired_contract_marker \
    'GET /v1/service-units/search?q=chat&scope=public'; then
    printf 'self-test FAIL (expected canonical Search allow)\n' >&2
    st_failed=1
  fi
  if text_has_retired_contract_marker \
    'GET /v1/service-units/search?q=chat&scope=owned'; then
    printf 'self-test FAIL (expected canonical owned Search allow)\n' >&2
    st_failed=1
  fi

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
  require_text "$file" 'semesh show <unit-id> --json'
done

for file in "${canonical_cli_projections[@]}"; do
  require_text "$file" 'semesh quote <unit-id> --action <action-id> --input '\''<json>'\'' --json'
  require_text "$file" 'semesh call <unit-id> --action <action-id> --from-quote <quote-file>'
  require_text "$file" '--input '\''<same-json>'\'' --idempotency-key <stable-key> --wait --json'
done

for file in "${contract_projections[@]}"; do
  require_text "$file" "$automatic_publication"
  require_text "$file" "$card_containment"
done

for file in "${canonical_service_unit_projections[@]}"; do
  require_text "$file" "$canonical_service_unit_search"
  require_text "$file" "$supported_read_aliases"
  require_text "$file" "$canonical_service_unit_actions"
  require_text "$file" "$canonical_invocation_reads"
  require_text "$file" "$canonical_replay"
  require_text "$file" "$canonical_scope_auth"
  require_text "$file" "$canonical_model_unit"
  require_text "$file" "$canonical_model_choice_pin"
  require_text "$file" "$catalog_token_boundary"
  require_text "$file" "$legacy_route_retirement"
  require_text "$file" "$canonical_action_quote"
  case "$file" in
    skills/semesh/SKILL.md|plugins/semesh/SKILL.md|plugins/semesh-cursor/skills/semesh/SKILL.md|plugins/semesh-codex/skills/semesh/SKILL.md)
      require_text "$file" "$skill_owned_scope_auth"
      ;;
    *)
      require_text "$file" "$canonical_action_quote_auth"
      ;;
  esac
  if text_has_legacy_capability_canonical_claim "$(<"$file")"; then
    printf 'legacy capability-canonical wording remains in %s: %s\n' \
      "$file" "$legacy_capability_canonical" >&2
    failed=1
  fi
done

require_text agent.md "$accessible_worker_search"
require_text agent.md "$accessible_worker_detail"
require_text agent.md "$accessible_worker_call"

for marker in "${retired_contract_markers[@]}"; do
  if rg -n -F -- "$marker" "${public_contract_scan_files[@]}"; then
    printf 'retired contract marker remains in a public projection: %s\n' "$marker" >&2
    failed=1
  fi
done

for file in "${public_contract_scan_files[@]}"; do
  if text_has_contract_contradiction "$(<"$file")"; then
    printf 'canonical contract contradiction remains in a public projection: %s\n' "$file" >&2
    failed=1
  fi
  if text_has_noncanonical_quote_cli "$(<"$file")"; then
    printf 'noncanonical quote command remains in a public projection: %s\n' "$file" >&2
    failed=1
  fi
  if text_has_noncanonical_action_call_cli "$(<"$file")"; then
    printf 'noncanonical Action call remains in a public projection: %s\n' "$file" >&2
    failed=1
  fi
done

if ! node - "$root/semesh.latest.json" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const journey = manifest.canonicalServiceUnitJourney;
const model = manifest.canonicalModelUnit;

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value ?? {}).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys drifted: ${JSON.stringify(actual)}`);
  }
}

if (!journey || journey.status !== "official_backend_contract_target_requires_live_readback") {
  throw new Error("canonicalServiceUnitJourney status is missing or widened");
}
if (journey.authorityBackendCommit !== "60ee801adf604c34763c1ce83d39e5e9facceb5f") {
  throw new Error("canonicalServiceUnitJourney authorityBackendCommit drifted");
}
const aliasSemantics =
  "supported_noncanonical_read_only_same_handler_byte_identical_no_independent_catalog_or_execution_authority";
const expectedCompatibilityReadAliases = {
  search: {
    alias: "GET /v1/services/search?q={query}&scope={public|accessible|owned}",
    canonical: "GET /v1/service-units/search?q={query}&scope={public|accessible|owned}",
    semantics: aliasSemantics,
  },
  unitDetail: {
    alias: "GET /v1/units/{id...}?scope={public|accessible|owned}",
    canonical: "GET /v1/service-units/{id...}?scope={public|accessible|owned}",
    semantics: aliasSemantics,
  },
  groupDetail: {
    alias: "GET /v1/groups/{id}?scope={public|accessible|owned}",
    canonical: "GET /v1/service-groups/{id}?scope={public|accessible|owned}",
    semantics: aliasSemantics,
  },
};
function assertExpectedCompatibilityReadAliases(value, label) {
  assertExactKeys(value, ["search", "unitDetail", "groupDetail"], label);
  for (const [name, expected] of Object.entries(expectedCompatibilityReadAliases)) {
    assertExactKeys(value[name], ["alias", "canonical", "semantics"], `${label}.${name}`);
    if (JSON.stringify(value[name]) !== JSON.stringify(expected)) {
      throw new Error(`${label}.${name} drifted`);
    }
  }
}
const expectedJourney = {
  search: "GET /v1/service-units/search?q={query}&scope={public|accessible|owned}",
  publicScopeAuth: "anonymous",
  accessibleScopeAuth: "authenticated_actor_specific_not_shared_cache",
  ownedScopeAuth: "authenticated_actor_specific_not_shared_cache",
  groupDetail: "GET /v1/service-groups/{group_id}?scope={public|accessible|owned}",
  detail: "GET /v1/service-units/{unit_id}?scope={public|accessible|owned}",
  compatibilityReadAliases: expectedCompatibilityReadAliases,
  compatibilityReadAliasClientPolicy: "new_clients_use_canonical_routes_only",
  catalogTokenHeader: "X-Semesh-Catalog-Token",
  quote: "POST /v1/service-units/{unit_id}/actions/{action_id}/quote",
  invoke: "POST /v1/service-units/{unit_id}/actions/{action_id}/invoke",
  idempotencyIdentity: "Idempotency-Key",
  observationIdentity: "invocation_id",
  observe: "GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}",
  receipt: "GET /v1/invocations/{invocation_id}/receipt",
  events: "GET /v1/invocations/{invocation_id}/events",
  sameKeyReplay:
    "same invocation + provider result + receipt + settlement reference; zero new provider effect, capture, or owner grant",
};
function assertExpectedJourney(value, label) {
  assertExactKeys(
    value,
    ["status", "authorityBackendCommit", ...Object.keys(expectedJourney)],
    label,
  );
  for (const [key, expected] of Object.entries(expectedJourney)) {
    if (JSON.stringify(value[key]) !== JSON.stringify(expected)) {
      throw new Error(`${label}.${key} drifted`);
    }
  }
  assertExpectedCompatibilityReadAliases(
    value.compatibilityReadAliases,
    `${label}.compatibilityReadAliases`,
  );
}
assertExpectedJourney(journey, "canonicalServiceUnitJourney");

const missingOwnedScopeAuth = { ...journey };
delete missingOwnedScopeAuth.ownedScopeAuth;
function hostileAliasJourney(mutator) {
  const fixture = JSON.parse(JSON.stringify(journey));
  mutator(fixture);
  return fixture;
}
const hostileJourneyFixtures = [
  ["missing ownedScopeAuth", missingOwnedScopeAuth],
  ["Group Detail missing owned", {
    ...journey,
    groupDetail: "GET /v1/service-groups/{group_id}?scope={public|accessible}",
  }],
  ["Unit Detail missing owned", {
    ...journey,
    detail: "GET /v1/service-units/{unit_id}?scope={public|accessible}",
  }],
  ["missing Search compatibility alias", hostileAliasJourney((fixture) => {
    delete fixture.compatibilityReadAliases.search;
  })],
  ["missing Unit Detail compatibility alias", hostileAliasJourney((fixture) => {
    delete fixture.compatibilityReadAliases.unitDetail;
  })],
  ["missing Group Detail compatibility alias", hostileAliasJourney((fixture) => {
    delete fixture.compatibilityReadAliases.groupDetail;
  })],
  ["compatibility alias path drift", hostileAliasJourney((fixture) => {
    fixture.compatibilityReadAliases.unitDetail.alias =
      "GET /v1/units/{id}?scope={public|accessible|owned}";
  })],
  ["compatibility alias incorrectly retired", hostileAliasJourney((fixture) => {
    fixture.compatibilityReadAliases.search.semantics = "retired_effect_zero_410";
  })],
  ["compatibility alias second catalog authority", hostileAliasJourney((fixture) => {
    fixture.compatibilityReadAliases.groupDetail.semantics =
      "supported_noncanonical_read_only_independent_catalog_authority";
  })],
  ["compatibility alias mutation authority", hostileAliasJourney((fixture) => {
    fixture.compatibilityReadAliases.unitDetail.alias =
      "POST /v1/units/{id...}?scope={public|accessible|owned}";
    fixture.compatibilityReadAliases.unitDetail.semantics =
      "supported_noncanonical_mutation_and_execution_authority";
  })],
  ["new clients use noncanonical aliases", {
    ...journey,
    compatibilityReadAliasClientPolicy: "new_clients_may_use_aliases",
  }],
];
for (const [label, fixture] of hostileJourneyFixtures) {
  let rejected = false;
  try {
    assertExpectedJourney(fixture, `hostile ${label}`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`manifest guard accepted hostile fixture: ${label}`);
}
assertExactKeys(
  model,
  [
    "status",
    "authorityBackendCommit",
    "publicModelUnitCount",
    "specificModelRole",
    "deepSeekRole",
    "deepSeekChoice",
    "searchBehavior",
    "providerBindings",
    "modelChoicePinShape",
    "modelChoicePinPlacement",
    "chatInput",
    "chatResult",
    "pin",
  ],
  "canonicalModelUnit",
);
if (
  !model ||
  model.status !== "official_backend_contract_target_requires_live_readback" ||
  model.authorityBackendCommit !== "60ee801adf604c34763c1ce83d39e5e9facceb5f" ||
  model.publicModelUnitCount !== 1 ||
  model.specificModelRole !== "versioned_action_model_choice" ||
  model.deepSeekRole !== "model_choice_ref_carried_as_model_choice_pin" ||
  model.deepSeekChoice !== "deepseek-v3" ||
  model.searchBehavior !==
    "choice recall returns the same Model Unit and may report matched_choice=deepseek" ||
  model.providerBindings !== "hidden_under_unit_action_ref_and_model_choice_pin" ||
  JSON.stringify(model.modelChoicePinShape) !==
    JSON.stringify({ model_id: "deepseek-v3", model_revision: "advertised_exact_revision" }) ||
  model.modelChoicePinPlacement !== "quote_and_invoke_sibling_of_input_never_input_member" ||
  model.chatInput !== "closed_messages_only_schema" ||
  model.chatResult !== "strict_result.message.content_plus_usage.total_tokens" ||
  model.pin !==
    "unit_action_ref + model_choice_pin + catalog + price/policy/input/effect digests"
) {
  throw new Error("canonicalModelUnit contract drifted");
}
NODE
then
  printf 'semesh.latest.json canonical manifest validation failed\n' >&2
  failed=1
fi

for file in "${core_contract_projections[@]}"; do
  require_text "$file" "$discover_before_auth"
  require_text "$file" "$canonical_action_quote"
  require_text "$file" "$canonical_action_quote_auth"
  require_text "$file" "$legal_independence"
  require_text "$file" "$selected_model_choice"
  if text_has_false_quote_claim "$(<"$file")"; then
    printf 'anonymous or legacy quote claim remains in %s\n' "$file" >&2
    failed=1
  fi
done

require_text llms.txt "$deployment_availability"
require_text agent.md 'never insert a model choice into the input'
require_text llms.txt 'never becomes a member of the Action input'

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
require_text agent.md "$detail_quote_confirmation_truth"
require_text llms.txt 'Unit Detail advertises `effect.requires_confirmation`, while the quote response advertises top-level `confirmation_required`'
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
