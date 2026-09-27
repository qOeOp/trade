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
# Every run plants one direct `PgPool::connect` under `owner-recovery` and lints once, over the same
# packages and features. It passes only if that pass refuses the plant at its own line and finds no
# other direct connection and no compile error, so a derivation that silently lints nothing fails the
# gate itself rather than a separate self-test (one lint pass instead of two; #1151's two cost 123 s
# more). Hits and errors are read from `--message-format json` diagnostics, not from the exit code.
#
# When the features do not compile together, nothing was linted, and the gate fails. It then checks
# each feature on its own and names the ones that do not compile alone, or, when each does, says the
# failure is the combination. `--self-test-bisect` plants a `compile_error!` under `owner-recovery`
# and passes only if that feature, and no other, is named as not compiling on its own.
#
# Both plants carry the fixed marker `planted_direct_connect_for_check_disallowed_connect_outside_union`
# (`plant_marker` below). A killed run cannot restore the plant file, so pre-commit refuses any staged
# `.rs` content containing the marker; that check matches this exact string, so change both together.

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

mode=gate
case "${1:-}" in
  "") ;;
  --self-test-bisect) mode=self-test-bisect ;;
  *)
    echo "usage: $0 [--self-test-bisect]" >&2
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

if ! git diff --quiet -- "$plant_file"; then
  echo "ERROR: this gate plants into $plant_file, which has local changes; commit or set them aside first." >&2
  exit 1
fi
# The plant is removed on every exit, and the file must then be exactly what it was: a hook that runs
# after this one would otherwise lint the planted tree. A killed run cannot get here, which is what
# the check-connect-guard-plant hook is for.
restore_plant() {
  git checkout -- "$plant_file"
  if ! git diff --quiet -- "$plant_file"; then
    echo "ERROR: $plant_file is not back to its committed content after the plant was removed." >&2
    return 1
  fi
}
on_exit() {
  local status=$?
  restore_plant || status=1
  exit "$status"
}
trap on_exit EXIT
case "$mode" in
  gate)
    cat >> "$plant_file" << EOF

#[allow(dead_code, reason = "gate plant, removed on exit")]
async fn ${plant_marker}(url: &str) {
    let _ = sqlx::PgPool::connect(url).await;
}
EOF
    plant_line="$(grep -n 'sqlx::PgPool::connect(url)' "$plant_file" | tail -n 1 | cut -d: -f1)"
    ;;
  self-test-bisect)
    cat >> "$plant_file" << EOF

compile_error!("${plant_marker}: self-test-bisect plant, removed on exit");
EOF
    plant_line=0
    ;;
esac

package_args=()
for package in "${packages[@]}"; do
  package_args+=(--package "$package")
done
export HIGH_PRECISION="${HIGH_PRECISION:-1}"
profile="${CARGO_CI_PROFILE:-nextest}"
# `--cap-lints warn` leaves every lint a warning, the disallowed method included, and
# `.cargo/config.toml` sets `build.warnings = "deny"`, which turns any warning in a workspace crate
# into a failed build (exit 101). Under it the plant alone failed the build and was blamed on the
# feature that carries it (run 36305569380). With `warn` a non-zero exit means something did not
# compile, which the bisect below relies on.
export CARGO_BUILD_WARNINGS=warn

echo "Refusing direct PostgreSQL connections outside the chain's sealed union"
echo "  packages: ${packages[*]}"
echo "  features: $features"
output="$(mktemp)"
status=0
cargo clippy "${package_args[@]}" --locked --all-targets --features "$features" \
  --profile "$profile" --message-format json -- --cap-lints warn > "$output" 2> "$output.stderr" || status=$?

# One line per finding from the JSON diagnostics: `PLANT <where>` for the disallowed method at the
# plant's own line, `HIT <where>` for it anywhere else, `ERROR <rendered>` for any error-level
# diagnostic. Other warnings are not what this gate refuses. The same location reported by two
# targets (lib and its tests) is one finding.
readings="$(
  python3 - "$output" "$plant_file" "$plant_line" << 'PY'
import json
import sys

path, plant_file, plant_line = sys.argv[1], sys.argv[2], int(sys.argv[3])
plant, hits, errors = set(), set(), []
for line in open(path, encoding="utf-8"):
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if entry.get("reason") != "compiler-message":
        continue
    message = entry["message"]
    code = (message.get("code") or {}).get("code")
    span = next((s for s in message.get("spans", []) if s.get("is_primary")), None)
    where = f"{span['file_name']}:{span['line_start']}" if span else "(no location)"
    if message.get("level", "").startswith("error"):
        errors.append((message.get("rendered") or message.get("message", "")).strip())
    elif code == "clippy::disallowed_methods":
        target = plant if where == f"{plant_file}:{plant_line}" else hits
        target.add(f"{where}: {message.get('message', '')}")
for finding in sorted(plant):
    print(f"PLANT {finding}")
for finding in sorted(hits):
    print(f"HIT {finding}")
for rendered in errors:
    print("ERROR " + rendered.replace("\n", "\n      "))
PY
)"
plant_found="$(grep -c '^PLANT ' <<< "$readings" || true)"
hit_count="$(grep -c '^HIT ' <<< "$readings" || true)"
error_count="$(grep -c '^ERROR ' <<< "$readings" || true)"

# Names the features that do not compile on their own, one clippy run per feature over its own
# package, and records them in `alone_failures`.
alone_failures=()
bisect_compile_failure() {
  local feature
  local -a all
  IFS=',' read -r -a all <<< "$features"

  for feature in "${all[@]}"; do
    if ! cargo clippy --package "${feature%%/*}" --locked --all-targets --features "$feature" \
      --profile "$profile" --message-format short -- --cap-lints warn > /dev/null 2>&1; then
      alone_failures+=("$feature")
    fi
  done

  if [ "${#alone_failures[@]}" -eq 0 ]; then
    echo "ERROR: these ${#all[@]} features compile alone but not together: ${all[*]}" >&2
    return
  fi

  for feature in "${alone_failures[@]}"; do
    echo "ERROR: feature $feature does not compile on its own." >&2
  done
}

if [ "$status" -ne 0 ] || [ "$error_count" -ne 0 ]; then
  grep '^ERROR ' <<< "$readings" | head -n 40 >&2 || true
  tail -n 20 "$output.stderr" >&2
  rm -f "$output" "$output.stderr"
  echo "ERROR: clippy did not compile everything (exit $status, $error_count error diagnostic(s)), so this" >&2
  echo "       pass proves nothing. Checking each feature on its own to name what does not compile." >&2
  bisect_compile_failure

  if [ "$mode" = self-test-bisect ]; then
    if [ "${alone_failures[*]}" = "vibe-qualification/owner-recovery" ]; then
      echo "self-test-bisect: the planted compile error was named, and only it: vibe-qualification/owner-recovery"
      exit 0
    fi
    echo "ERROR: self-test-bisect: expected exactly vibe-qualification/owner-recovery, named: ${alone_failures[*]:-none}" >&2
  fi
  exit 1
fi
rm -f "$output" "$output.stderr"

if [ "$mode" = self-test-bisect ]; then
  echo "ERROR: self-test-bisect: the planted compile error did not stop clippy." >&2
  exit 1
fi

if [ "$hit_count" -ne 0 ]; then
  grep '^HIT ' <<< "$readings" | sed 's/^HIT /  /' >&2
  echo "ERROR: $hit_count direct PostgreSQL connection(s) outside vibe-postgres-connect; state TLS through it." >&2
  exit 1
fi
if [ "$plant_found" -ne 1 ]; then
  echo "ERROR: the connection planted at $plant_file:$plant_line was not refused, so this pass could not" >&2
  echo "       have refused a real one: no direct connection found proves nothing here." >&2
  exit 1
fi
echo "Refused the planted connection at $plant_file:$plant_line, and found no other."
echo "No direct PostgreSQL connection outside vibe-postgres-connect under: $features"
