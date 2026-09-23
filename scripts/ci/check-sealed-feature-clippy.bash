#!/usr/bin/env bash

# Lint the code the ordered chain compiles behind its sealed acceptance features.
#
# The workspace clippy (`scripts/clippy-changed.sh`) enables a fixed CI feature set and never a sealed
# acceptance feature, so everything behind `#[cfg(feature = "sealed-...")]` is compiled by the ordered
# chain and linted by nothing. A lint there stays green in CI until someone happens to run clippy with
# that feature by hand.
#
# The feature union is read from the chain script's own definition rather than copied here. When the
# chain widens its union, this gate widens with it; a second copy of the string would drift behind the
# chain with nothing going red. The packages are likewise derived, not listed: every workspace package
# whose resolved features include a sealed feature under that union is linted with all its targets, so a
# package that starts compiling sealed code is picked up without editing this file.

set -Eeuo pipefail

trap 'echo "check-sealed-feature-clippy.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
chain_script="$repository_root/scripts/ci/test-rd-owner-postgres.bash"

# Parse the two definitions exactly instead of evaluating them. If the chain restructures how it spells
# its union, this fails and says so; it never falls back to a partial or stale value.
archive_features=""
schema_features=""
while IFS= read -r line; do
  if [[ "$line" =~ ^readonly\ nextest_archive_features=\'([^\']+)\'$ ]]; then
    [ -z "$archive_features" ] || {
      echo "ERROR: $chain_script defines nextest_archive_features twice." >&2
      exit 1
    }
    archive_features="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^readonly\ schema_materialization_features=\"\$\{nextest_archive_features\},([^\"]+)\"$ ]]; then
    [ -z "$schema_features" ] || {
      echo "ERROR: $chain_script defines schema_materialization_features twice." >&2
      exit 1
    }
    schema_features="${BASH_REMATCH[1]}"
  fi
done < "$chain_script"
if [ -z "$archive_features" ] || [ -z "$schema_features" ]; then
  echo "ERROR: could not read the sealed feature union from $chain_script." >&2
  echo "       Expected 'readonly nextest_archive_features='...'' and" >&2
  echo "       'readonly schema_materialization_features=\"\${nextest_archive_features},...\"'." >&2
  echo "       Update this gate to read the chain's union where it now lives; do not copy it here." >&2
  exit 1
fi
# The schema materialization build is the widest graph the chain compiles.
features="$archive_features,$schema_features"

cd "$repository_root"
metadata="$(cargo metadata --format-version 1 --locked --features "$features")"

# A plain loop rather than `mapfile`: macOS still ships bash 3.2, where an empty array expanded under
# `set -u` aborts. An empty list must fail loudly here, never reach `cargo clippy` as zero packages.
packages=()
while IFS= read -r package; do
  if [ -n "$package" ]; then
    packages+=("$package")
  fi
done < <(printf '%s' "$metadata" | python3 -c '
import json, sys
metadata = json.load(sys.stdin)
members = set(metadata["workspace_members"])
names = {package["id"]: package["name"] for package in metadata["packages"]}
for node in metadata["resolve"]["nodes"]:
    if node["id"] in members and any(feature.startswith("sealed") for feature in node.get("features", [])):
        print(names[node["id"]])
')
if [ "${#packages[@]}" -eq 0 ]; then
  echo "ERROR: no workspace package resolves a sealed feature under the chain's union '$features'." >&2
  exit 1
fi

# Every package the union names must be among the derived ones; if not, the derivation is wrong and
# linting the remainder would pass on less than the chain compiles.
IFS=',' read -r -a union_entries <<< "$features"
for entry in "${union_entries[@]}"; do
  named="${entry%%/*}"
  found=false
  for package in "${packages[@]}"; do
    if [ "$package" = "$named" ]; then
      found=true
    fi
  done
  if [ "$found" != true ]; then
    echo "ERROR: the union names '$named' but it is not among the derived packages: ${packages[*]}." >&2
    exit 1
  fi
done

package_args=()
for package in "${packages[@]}"; do
  package_args+=(--package "$package")
done

# The same profile and HIGH_PRECISION as the workspace clippy, so in CI this reuses what that step
# already checked and rechecks only the sealed crates and their dependents.
export HIGH_PRECISION="${HIGH_PRECISION:-1}"
profile="${CARGO_CI_PROFILE:-nextest}"

echo "Linting the ordered chain's sealed feature union"
echo "  packages: ${packages[*]}"
echo "  features: $features"
cargo clippy "${package_args[@]}" --locked --all-targets --features "$features" \
  --profile "$profile" -- -D warnings
