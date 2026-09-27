#!/usr/bin/env bash
# How scripts/ci/check-disallowed-connect-outside-union.bash reads cargo, against a stand-in cargo.
#
# The guard's answer is a warning, and this repository denies warnings (`build.warnings = "deny"`):
# run 36305569380's self-test planted a direct connection, clippy flagged it, cargo turned the warning
# into exit 101, and the script reported "clippy did not finish" and blamed owner-recovery. The
# stand-in behaves as cargo does there - it emits the disallowed-method warning for a planted or real
# connection, and fails the build over it unless warnings are set to `warn` - so each case answers
# one way only:
# - a planted connection makes --self-test pass, and the plant file is restored;
# - a real connection fails the gate by count, not as "did not finish";
# - no connection passes the gate;
# - a planted compile error makes --self-test-bisect pass, naming owner-recovery;
# - the script without its `warn` setting fails --self-test as run 36305569380 did, which shows the
#   stand-in can tell the two apart.
# The stand-in is a model: a clean run of the hook `test-disallowed-connect-guard` on real cargo is
# the live evidence.
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
mkdir -p "$fixture/scripts/ci" "$fixture/crates/qualification/src" "$fixture/.cargo" "$work/bin"
cp "$repo_root/scripts/ci/check-disallowed-connect-outside-union.bash" \
  "$repo_root/scripts/ci/sealed-feature-union.bash" "$fixture/scripts/ci/"
printf "readonly nextest_archive_features='vibe-other/sealed-acceptance'\n" \
  > "$fixture/scripts/ci/test-rd-owner-postgres.bash"
printf 'pub fn recover() {}\n' > "$fixture/crates/qualification/src/recovery.rs"
printf 'pub fn other() {}\n' > "$fixture/crates/qualification/src/other.rs"
printf '[build]\nwarnings = "deny"\n' > "$fixture/.cargo/config.toml"
git -C "$fixture" add -A
git -C "$fixture" commit -qm fixture

cat > "$work/bin/cargo" << 'STANDIN'
#!/usr/bin/env bash
# Stand-in cargo: `metadata` describes one workspace package with owner-recovery; `clippy` flags a
# direct connection in any fixture source and applies build.warnings as cargo does.
set -euo pipefail
case "$1" in
  metadata)
    printf '%s' '{"workspace_members":["q"],"packages":[{"id":"q","name":"vibe-qualification","features":{"owner-recovery":[]}}],"resolve":{"nodes":[{"id":"q","features":["owner-recovery"]}]}}'
    ;;
  clippy)
    warned=false
    for source in crates/qualification/src/*.rs; do
      if grep -q 'compile_error!' "$source"; then
        echo "$source:1:1: error: planted"
        exit 101
      fi
      line="$(grep -n 'PgPool::connect' "$source" | head -1 | cut -d: -f1 || true)"
      if [ -n "$line" ]; then
        echo "$source:$line:13: warning: use of a disallowed method \`sqlx_core::pool::Pool::connect\`"
        warned=true
      fi
    done
    setting="${CARGO_BUILD_WARNINGS:-$(sed -n 's/^warnings = "\(.*\)"$/\1/p' .cargo/config.toml)}"
    if [ "$warned" = true ] && [ "$setting" = deny ]; then
      echo "error: warnings are denied by \`build.warnings\` configuration"
      exit 101
    fi
    ;;
  *)
    echo "stand-in cargo: unexpected $*" >&2
    exit 2
    ;;
esac
STANDIN
chmod +x "$work/bin/cargo"

guard() {
  PATH="$work/bin:$PATH" bash "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash" "$@" \
    > "$work/out" 2>&1
}

guard --self-test || fail "a refused plant failed --self-test: $(cat "$work/out")"
grep -q 'self-test: the planted direct connection was refused' "$work/out" ||
  fail "--self-test passed without saying the plant was refused: $(cat "$work/out")"
git -C "$fixture" diff --quiet || fail "--self-test left its plant: $(git -C "$fixture" diff)"
echo "ok a planted connection passes --self-test, and the plant is removed"

guard || fail "the clean fixture failed the gate: $(cat "$work/out")"
echo "ok no connection passes the gate"

printf 'async fn real(url: &str) { let _ = sqlx::PgPool::connect(url).await; }\n' \
  >> "$fixture/crates/qualification/src/other.rs"
if guard; then fail "a real connection passed the gate"; fi
grep -q '1 direct PostgreSQL connection(s) outside vibe-postgres-connect' "$work/out" ||
  fail "a real connection was not refused by count: $(cat "$work/out")"
if grep -q 'did not finish' "$work/out"; then
  fail "a real connection was reported as a build failure: $(cat "$work/out")"
fi
git -C "$fixture" checkout -q -- crates/qualification/src/other.rs
echo "ok a real connection fails the gate by count"

guard --self-test-bisect || fail "--self-test-bisect failed: $(cat "$work/out")"
grep -q 'the planted compile error was named, and only it: vibe-qualification/owner-recovery' "$work/out" ||
  fail "--self-test-bisect did not name owner-recovery: $(cat "$work/out")"
echo "ok a planted compile error passes --self-test-bisect by name"

sed -i.bak '/^export CARGO_BUILD_WARNINGS=warn$/d' "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash"
if cmp -s "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash" \
  "$fixture/scripts/ci/check-disallowed-connect-outside-union.bash.bak"; then
  fail "the control found no CARGO_BUILD_WARNINGS=warn line to remove"
fi
if guard --self-test; then fail "without the warn setting --self-test still passed"; fi
grep -q 'clippy did not finish (exit 101)' "$work/out" ||
  fail "without the warn setting the failure was not run 36305569380's: $(cat "$work/out")"
echo "ok without the warn setting --self-test fails as run 36305569380 did"
echo "ok: the guard reads a refused connection as a refusal, not as a build that did not finish"
