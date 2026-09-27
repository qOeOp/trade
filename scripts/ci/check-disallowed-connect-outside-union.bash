#!/usr/bin/env bash

# Refuse a direct PostgreSQL connection in code no other clippy run compiles.
#
# `clippy.toml` disallows every sqlx entry point that opens a pool, a connection or a listener outside
# `vibe-postgres-connect`, so a connection cannot fall back to sqlx's `Prefer` default. A lint only
# guards the code some clippy run compiles. The workspace clippy (`scripts/clippy-changed.sh`) enables
# no acceptance feature, and `check-sealed-feature-clippy.bash` lints exactly the ordered chain's
# sealed feature union. Every other acceptance or recovery feature, such as `vibe-qualification`'s
# `owner-recovery`, is compiled by tests and deployments and linted by nothing. This lints the
# workspace with all of those features and fails on any disallowed method.
#
# The features are derived, not listed. Every workspace feature whose name contains `acceptance` or
# `recovery` and that the chain union leaves out is included, so a new one is covered without editing
# this file. The union is read through the same reader the sealed clippy uses.
#
# Other lints are capped at warn: this gate answers one question, and a lint that only fires under
# these features is not what it refuses.
#
# `--self-test` plants one direct `PgPool::connect` under `owner-recovery` and passes only if the plant
# is refused by name, so a derivation that silently lints nothing is caught.

set -Eeuo pipefail

trap 'echo "check-disallowed-connect-outside-union.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
chain_script="$repository_root/scripts/ci/test-rd-owner-postgres.bash"
plant_file="crates/qualification/src/recovery.rs"
plant_marker="planted_direct_connect_for_check_disallowed_connect_outside_union"

# shellcheck source=scripts/ci/sealed-feature-union.bash
source "$repository_root/scripts/ci/sealed-feature-union.bash"
union="$(sealed_feature_union "$chain_script")"

cd "$repository_root"

self_test=false
case "${1:-}" in
  "") ;;
  --self-test) self_test=true ;;
  *)
    echo "usage: $0 [--self-test]" >&2
    exit 2
    ;;
esac

features="$(
  cargo metadata --format-version 1 --locked --no-deps | UNION="$union" python3 -c '
import json, os, sys
union = set(filter(None, os.environ["UNION"].split(",")))
metadata = json.load(sys.stdin)
members = set(metadata["workspace_members"])
selected = sorted(
    f"{package["name"]}/{feature}"
    for package in metadata["packages"]
    if package["id"] in members
    for feature in package["features"]
    if ("acceptance" in feature or "recovery" in feature)
    and f"{package["name"]}/{feature}" not in union
)
print(",".join(selected))
'
)"
if [ -z "$features" ]; then
  echo "ERROR: no acceptance or recovery feature lies outside the chain union '$union'." >&2
  echo "       If that is now true, this gate has nothing to lint; retire it rather than pass empty." >&2
  exit 1
fi

packages=()
while IFS= read -r package; do
  if [ -n "$package" ]; then
    packages+=("$package")
  fi
done < <(
  cargo metadata --format-version 1 --locked --features "$features" | FEATURES="$features" python3 -c '
import json, os, sys
wanted = {entry.split("/", 1)[1] for entry in os.environ["FEATURES"].split(",")}
metadata = json.load(sys.stdin)
members = set(metadata["workspace_members"])
names = {package["id"]: package["name"] for package in metadata["packages"]}
for node in metadata["resolve"]["nodes"]:
    if node["id"] in members and wanted & set(node.get("features", [])):
        print(names[node["id"]])
'
)
if [ "${#packages[@]}" -eq 0 ]; then
  echo "ERROR: no workspace package resolves any of '$features'." >&2
  exit 1
fi

if [ "$self_test" = true ]; then
  if ! git diff --quiet -- "$plant_file"; then
    echo "ERROR: --self-test plants into $plant_file, which has local changes; commit or set them aside first." >&2
    exit 1
  fi
  restore_plant() { git checkout -- "$plant_file"; }
  trap 'restore_plant' EXIT
  cat >> "$plant_file" << EOF

#[allow(dead_code, reason = "self-test plant, removed on exit")]
async fn ${plant_marker}(url: &str) {
    let _ = sqlx::PgPool::connect(url).await;
}
EOF
fi

package_args=()
for package in "${packages[@]}"; do
  package_args+=(--package "$package")
done
export HIGH_PRECISION="${HIGH_PRECISION:-1}"
profile="${CARGO_CI_PROFILE:-nextest}"

echo "Refusing direct PostgreSQL connections outside the chain's sealed union"
echo "  packages: ${packages[*]}"
echo "  features: $features"
output="$(mktemp)"
status=0
cargo clippy "${package_args[@]}" --locked --all-targets --features "$features" \
  --profile "$profile" --message-format short -- --cap-lints warn > "$output" 2>&1 || status=$?
hits="$(grep -E 'use of a disallowed method' "$output" || true)"
count=0
if [ -n "$hits" ]; then
  count="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
fi

if [ "$status" -ne 0 ]; then
  tail -n 40 "$output" >&2
  rm -f "$output"
  echo "ERROR: clippy did not finish (exit $status), so nothing here was linted." >&2
  exit 1
fi
rm -f "$output"

if [ "$self_test" = true ]; then
  if printf '%s\n' "$hits" | grep -q "$plant_file"; then
    echo "self-test: the planted direct connection was refused: $(printf '%s\n' "$hits" | grep "$plant_file")"
    exit 0
  fi
  echo "ERROR: self-test: the planted direct connection in $plant_file was not refused." >&2
  exit 1
fi

if [ "$count" -ne 0 ]; then
  printf '%s\n' "$hits" >&2
  echo "ERROR: $count direct PostgreSQL connection(s) outside vibe-postgres-connect; state TLS through it." >&2
  exit 1
fi
echo "No direct PostgreSQL connection outside vibe-postgres-connect under: $features"
