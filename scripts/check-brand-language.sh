#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  printf 'brand-language guard requires ripgrep (rg)\n' >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Check only Git-tracked current public surfaces. Protocol compatibility
# identifiers are intentionally outside this case-sensitive display-name
# pattern: examples include SETTLEMESH_API_KEY, settlemesh.json, and
# settlemesh.io.
brand_pattern='\bSettle[[:space:]-]?Mesh\b'
git_brand_pattern='Settle([[:space:]-]?Mesh)'
surfaces=(
  .agents
  .claude-plugin
  .cursor-plugin
  .mcp.json
  NOTICE
  README.md
  agent.md
  commands
  cursor
  docs
  glama.json
  llms-install.md
  llms.txt
  plugins
  rules
  semesh.latest.json
  server.json
  skills
  smithery.yaml
  templates
)

self_test_failed=0

assert_rejects() {
  local value="$1"
  if ! printf '%s\n' "$value" | rg -q -- "$brand_pattern"; then
    printf 'brand-language self-test FAIL (expected reject): %s\n' "$value" >&2
    self_test_failed=1
  fi
}

assert_allows() {
  local value="$1"
  if printf '%s\n' "$value" | rg -q -- "$brand_pattern"; then
    printf 'brand-language self-test FAIL (expected allow): %s\n' "$value" >&2
    self_test_failed=1
  fi
}

assert_rejects 'SettleMesh'
assert_rejects 'Settle Mesh'
assert_rejects 'Settle-Mesh'
assert_allows 'SETTLEMESH_API_KEY'
assert_allows 'settlemesh.json'
assert_allows 'https://www.settlemesh.io'

if (( self_test_failed )); then
  exit 1
fi

matches=''
status=0
matches="$(git grep -n -I -E -- "$git_brand_pattern" -- "${surfaces[@]}")" || status=$?

if (( status == 0 )); then
  printf '%s\n' "$matches" >&2
  printf 'brand-language violation: use Semesh for active public display copy\n' >&2
  exit 1
fi
if (( status != 1 )); then
  exit "$status"
fi

printf 'brand-language guard: PASS\n'
