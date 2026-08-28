#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  printf 'brand-language guard requires ripgrep (rg)\n' >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Public is itself the active integration layer, so inspect every Git-tracked
# path and text file. A persistent compatibility token must opt in on its exact
# source line with this marker; broad case/prefix exemptions would also let a
# new default, slug, or public filename silently regress.
brand_pattern='settle([[:space:]_-]?mesh|-native)'
allow_marker='brand-lint: allow-legacy'
content_exclusions=(
  scripts/check-brand-language.sh
)
legacy_path_allowlist=()

line_is_violation() {
  local value="$1"
  if [[ "$value" == *"$allow_marker"* ]]; then
    return 1
  fi
  printf '%s\n' "$value" | rg -q -i -e "$brand_pattern"
}

path_is_allowlisted() {
  local value="$1"
  local allowed
  for allowed in "${legacy_path_allowlist[@]}"; do
    if [[ "$value" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

self_test_failed=0

assert_rejects() {
  local value="$1"
  if ! printf '%s\n' "$value" | rg -q -i -e "$brand_pattern"; then
    printf 'brand-language self-test FAIL (expected reject): %s\n' "$value" >&2
    self_test_failed=1
  fi
}

assert_allows() {
  local value="$1"
  if printf '%s\n' "$value" | rg -q -i -e "$brand_pattern"; then
    printf 'brand-language self-test FAIL (expected allow): %s\n' "$value" >&2
    self_test_failed=1
  fi
}

assert_rejects 'SettleMesh'
assert_rejects 'Settle Mesh'
assert_rejects 'Settle-Mesh'
assert_rejects 'Settle-native'
assert_rejects 'settlemesh'
assert_rejects 'SETTLEMESH_API_KEY'
assert_rejects 'settlemesh.json'
assert_allows 'SEMESH_API_KEY'
assert_allows 'semesh.json'

if line_is_violation "SETTLEMESH_API_KEY # $allow_marker"; then
  printf 'brand-language self-test FAIL (compatibility marker ignored)\n' >&2
  self_test_failed=1
fi

if (( self_test_failed )); then
  exit 1
fi

failed=0

while IFS= read -r tracked_path; do
  if printf '%s\n' "$tracked_path" | rg -q -i -e "$brand_pattern" &&
    ! path_is_allowlisted "$tracked_path"; then
    printf 'brand-language path violation: %s\n' "$tracked_path" >&2
    failed=1
  fi
done < <(git ls-files)

matches=''
status=0
matches="$(git grep -n -I -i -E -- "$brand_pattern" -- . \
  "${content_exclusions[@]/#/:(exclude)}")" || status=$?

if (( status == 0 )); then
  filtered_matches=''
  while IFS= read -r match; do
    if line_is_violation "$match"; then
      if [[ -n "$filtered_matches" ]]; then
        filtered_matches+=$'\n'
      fi
      filtered_matches+="$match"
    fi
  done <<<"$matches"
  if [[ -n "$filtered_matches" ]]; then
    printf '%s\n' "$filtered_matches" >&2
    printf 'brand-language violation: use Semesh for public copy, paths, and new defaults\n' >&2
    printf 'mark an exact persistent compatibility line with: %s\n' "$allow_marker" >&2
    failed=1
  fi
elif (( status != 1 )); then
  exit "$status"
fi

if (( failed )); then
  exit 1
fi

printf 'brand-language guard: PASS\n'
