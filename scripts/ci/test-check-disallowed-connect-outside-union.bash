#!/usr/bin/env bash
# How scripts/ci/check-disallowed-connect-outside-union.bash reads cargo, against a stand-in cargo.
#
# The gate plants a direct connection and lints once. It must pass only when that one pass refuses
# the plant at its own line, finds no other direct connection, and reports no error of any kind. The
# stand-in emits `--message-format json` diagnostics the way clippy does - the disallowed-method
# warning at every `PgPool::connect`, an error for every `compile_error!` - and applies
# `build.warnings` as cargo does, so each case answers one way only:
# - the plant alone passes, also when two targets report it, and the plant file is restored;
# - a real connection fails by count, in another file and in the plant's own file off its line;
# - a pass that refuses nothing (the plant missed) fails rather than reading as clean;
# - a compile error elsewhere fails even though the plant was refused, also when the exit code is 0;
# - the one pass lints every derived package with every derived feature, the bisect's single
#   features never replacing them;
# - a planted compile error makes --self-test-bisect pass, naming owner-recovery;
# - without its `warn` setting the gate fails as run 36305569380 did, so the stand-in can tell.
# The stand-in is a model: the hook `test-disallowed-connect-guard` passing on real cargo is the live
# evidence.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# shellcheck source=scripts/lib/git-isolation.bash
source "$repo_root/scripts/lib/git-isolation.bash"
fixture="$work/repo"
mkdir -p "$fixture"
init_fixture_repository "$fixture"
mkdir -p "$fixture/scripts/ci" "$fixture/crates/qualification/src" "$fixture/crates/data/src" \
  "$fixture/.cargo" "$work/bin"
cp "$repo_root/scripts/ci/check-disallowed-connect-outside-union.bash" \
  "$repo_root/scripts/ci/sealed-feature-union.bash" "$fixture/scripts/ci/"
printf "readonly nextest_archive_features='vibe-other/sealed-acceptance'\n" \
  > "$fixture/scripts/ci/test-rd-owner-postgres.bash"
printf 'pub fn recover() {}\n' > "$fixture/crates/qualification/src/recovery.rs"
printf 'pub fn other() {}\n' > "$fixture/crates/qualification/src/other.rs"
printf 'pub fn data() {}\n' > "$fixture/crates/data/src/lib.rs"
printf '[build]\nwarnings = "deny"\n' > "$fixture/.cargo/config.toml"
git -C "$fixture" add -A
git -C "$fixture" commit -qm fixture

cat > "$work/bin/cargo" << 'STANDIN'
#!/usr/bin/env python3
"""Stand-in cargo: two workspace packages with one out-of-union feature each."""
import json
import os
import re
import sys
from pathlib import Path

args = sys.argv[1:]
crates = {"vibe-qualification": "crates/qualification", "vibe-data": "crates/data"}
if args[0] == "metadata":
    packages = [
        {"id": "q", "name": "vibe-qualification", "features": {"owner-recovery": []}},
        {"id": "d", "name": "vibe-data", "features": {"isolated-event-replay-acceptance": []}},
    ]
    print(json.dumps({
        "workspace_members": ["q", "d"],
        "packages": packages,
        "resolve": {"nodes": [
            {"id": "q", "features": ["owner-recovery"]},
            {"id": "d", "features": ["isolated-event-replay-acceptance"]},
        ]},
    }))
    sys.exit(0)
assert args[0] == "clippy", args
with open(os.environ["STANDIN_LOG"], "a") as log:
    log.write(" ".join(args) + "\n")
packages = [args[i + 1] for i, a in enumerate(args) if a == "--package"]
json_format = "json" in args
blind = os.environ.get("STANDIN_BLIND") == "1"
twice = os.environ.get("STANDIN_TWICE") == "1"
warned, failed = False, False
for package in packages:
    for source in sorted(Path(crates[package]).rglob("*.rs")):
        for number, line in enumerate(source.read_text().splitlines(), 1):
            if "compile_error!" in line:
                failed = True
                message = {"level": "error", "code": None, "message": "planted",
                           "spans": [{"file_name": str(source), "line_start": number, "is_primary": True}],
                           "rendered": f"error: planted\n --> {source}:{number}"}
            elif "PgPool::connect" in line and not blind:
                warned = True
                message = {"level": "warning", "code": {"code": "clippy::disallowed_methods"},
                           "message": "use of a disallowed method `sqlx_core::pool::Pool::connect`",
                           "spans": [{"file_name": str(source), "line_start": number, "is_primary": True}],
                           "rendered": "warning: use of a disallowed method"}
            else:
                continue
            if json_format:
                for _ in range(2 if twice and message["level"] == "warning" else 1):
                    print(json.dumps({"reason": "compiler-message", "message": message}))
if failed and os.environ.get("STANDIN_ERROR_EXIT_ZERO") != "1":
    sys.exit(101)
setting = os.environ.get("CARGO_BUILD_WARNINGS") or re.search(
    r'^warnings = "(\w+)"', Path(".cargo/config.toml").read_text(), re.MULTILINE).group(1)
if warned and setting == "deny":
    print("error: warnings are denied by `build.warnings` configuration", file=sys.stderr)
    sys.exit(101)
STANDIN
chmod +x "$work/bin/cargo"

guard() {
  : > "$work/clippy.log"
  STANDIN_LOG="$work/clippy.log" PATH="$work/bin:$PATH" \
    bash "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash" "$@" > "$work/out" 2>&1
}
restored() {
  git -C "$fixture" diff --quiet || fail "$1 left the tree changed: $(git -C "$fixture" diff)"
}
refused_as() {
  grep -q -- "$1" "$work/out" || fail "$2: expected '$1' in: $(cat "$work/out")"
}

guard || fail "the plant alone failed the gate: $(cat "$work/out")"
refused_as 'Refused the planted connection at crates/qualification/src/recovery.rs:' "the plant alone"
restored "a passing gate"
combined="$(head -n 1 "$work/clippy.log")"
for expected in "--package vibe-qualification" "--package vibe-data" \
  "--features vibe-data/isolated-event-replay-acceptance,vibe-qualification/owner-recovery"; do
  [[ "$combined" == *"$expected"* ]] || fail "the one pass did not lint with '$expected': $combined"
done
[ "$(wc -l < "$work/clippy.log" | tr -d ' ')" -eq 1 ] || fail "a clean gate ran more than one lint pass"
echo "ok the plant alone passes in one pass over every package and feature, and is removed"

STANDIN_TWICE=1 guard || fail "a plant reported by two targets failed the gate: $(cat "$work/out")"
restored "a doubly reported plant"
echo "ok a plant reported by lib and tests is one finding"

printf 'async fn real(url: &str) { let _ = sqlx::PgPool::connect(url).await; }\n' \
  >> "$fixture/crates/data/src/lib.rs"
if guard; then fail "a real connection in another package passed the gate"; fi
refused_as '1 direct PostgreSQL connection(s) outside vibe-postgres-connect' "a real connection elsewhere"
if grep -q 'did not compile' "$work/out"; then fail "a real connection read as a build failure"; fi
git -C "$fixture" checkout -q -- crates/data/src/lib.rs
restored "a gate that found a real connection"
echo "ok a real connection in another package fails by count"

printf 'async fn real(url: &str) { let _ = sqlx::PgPool::connect(url).await; }\n' \
  >> "$fixture/crates/qualification/src/recovery.rs"
git -C "$fixture" commit -qam "a real connection in the plant's own file"
if guard; then fail "a real connection in the plant's file, off its line, passed the gate"; fi
refused_as '1 direct PostgreSQL connection(s) outside vibe-postgres-connect' "a real connection beside the plant"
refused_as 'crates/qualification/src/recovery.rs:2:' "a real connection beside the plant"
restored "a gate that found a connection beside the plant"
git -C "$fixture" reset -q --hard HEAD~1
echo "ok a real connection in the plant's own file, off its line, fails by count"

if STANDIN_BLIND=1 guard; then fail "a pass that refused nothing, the plant included, passed"; fi
refused_as 'was not refused, so this pass could not' "a blind pass"
restored "a blind pass"
echo "ok a pass that misses the plant fails instead of reading as clean"

printf 'compile_error!("unrelated");\n' >> "$fixture/crates/data/src/lib.rs"
if guard; then fail "a compile error elsewhere passed because the plant was refused"; fi
refused_as 'did not compile everything' "a compile error beside a refused plant"
if STANDIN_ERROR_EXIT_ZERO=1 guard; then fail "an error diagnostic with exit 0 passed the gate"; fi
refused_as '1 error diagnostic(s)' "an error diagnostic with exit 0"
git -C "$fixture" checkout -q -- crates/data/src/lib.rs
restored "a gate that met a compile error"
echo "ok a compile error elsewhere fails, by exit code and by diagnostic"

guard --self-test-bisect || fail "--self-test-bisect failed: $(cat "$work/out")"
refused_as 'the planted compile error was named, and only it: vibe-qualification/owner-recovery' "the bisect"
restored "the bisect"
echo "ok a planted compile error passes --self-test-bisect by name"

sed -i.bak '/^export CARGO_BUILD_WARNINGS=warn$/d' "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash"
if cmp -s "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash" \
  "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash.bak"; then
  fail "the control found no CARGO_BUILD_WARNINGS=warn line to remove"
fi
if guard; then fail "without the warn setting the gate still passed"; fi
refused_as 'did not compile everything (exit 101' "without the warn setting"
echo "ok without the warn setting the gate fails as run 36305569380 did"
echo "ok: one planted pass refuses the plant at its line, and anything else it finds fails the gate"
