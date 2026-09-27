#!/usr/bin/env bash
# Self-test for scripts/ci/workspace_mtimes.py. Each case must answer both ways:
# - reuse sets unchanged files to T - 1 and changed files, of any kind, to after T;
# - verify fails by name when a changed file is left at T - 1, for a source file and for a file
#   only `include_str!` reads (a missed touch there is the same false green);
# - a member crate's manifest is an ordinary changed file, while a workspace manifest change, a
#   missing marker and an unreachable commit each fall back to a full rebuild
#   and leave the checkout's mtimes alone.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tool="$repo_root/scripts/ci/workspace_mtimes.py"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mtime() { python3 -c 'import os, sys; print(int(os.lstat(sys.argv[1]).st_mtime))' "$1"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# The fixture is a repository of its own; scripts/lib/git-isolation.bash keeps a commit hook's
# GIT_DIR off the caller's (this test did that to the shared repository on 2026-09-27).
# shellcheck source=scripts/lib/git-isolation.bash
source "$repo_root/scripts/lib/git-isolation.bash"
init_fixture_repository "$work"
cd "$work"
mkdir -p crate/src crate/sql
printf '[package]\nname = "c"\n' > crate/Cargo.toml
printf 'pub fn a() {}\n' > crate/src/lib.rs
printf 'pub fn b() {}\n' > crate/src/b.rs
printf 'SELECT 1;\n' > crate/sql/query.sql
git add -A
git commit -q -m cached

target=target/t
python3 "$tool" record "$target" > /dev/null
recorded="$(sed -n 's/^# workspace source [0-9a-f]* //p' "$target/source-marker/CACHEDIR.TAG")"
[[ -n "$recorded" ]] || fail "record wrote no time"
sleep 1

printf 'pub fn a() { let _ = 1; }\n' > crate/src/lib.rs
printf 'SELECT 2;\n' > crate/sql/query.sql
git commit -q -am change

# Positive: reuse, then every file carries the mtime its content calls for.
out="$(python3 "$tool" reuse "$target")" || fail "reuse failed: $out"
[[ "$out" == *"2 changed file(s)"* ]] || fail "reuse did not report 2 changed files: $out"
[[ "$(mtime crate/src/b.rs)" -eq $((recorded - 1)) ]] || fail "unchanged b.rs not set to T - 1"
[[ "$(mtime crate/Cargo.toml)" -eq $((recorded - 1)) ]] || fail "unchanged Cargo.toml not set to T - 1"
[[ "$(mtime crate/src/lib.rs)" -gt "$recorded" ]] || fail "changed lib.rs not after T"
[[ "$(mtime crate/sql/query.sql)" -gt "$recorded" ]] || fail "changed query.sql not after T"
python3 "$tool" verify "$target" > /dev/null || fail "verify rejected a correct reuse"

# Negative, twice: a changed file left at T - 1 fails verify by its name.
for missed in crate/src/lib.rs crate/sql/query.sql; do
  python3 "$tool" reuse "$target" > /dev/null
  python3 -c 'import os, sys; t = int(sys.argv[2]); os.utime(sys.argv[1], (t, t))' "$missed" $((recorded - 1))
  if err="$(python3 "$tool" verify "$target" 2>&1)"; then
    fail "verify passed with $missed left at T - 1"
  fi
  [[ "$err" == *"WRONG MTIME $missed:"* ]] || fail "verify did not name $missed: $err"
done
python3 "$tool" reuse "$target" > /dev/null

# An unchanged file bumped to now also fails: it would rebuild, but it means the mapping is off.
touch crate/src/b.rs
if err="$(python3 "$tool" verify "$target" 2>&1)"; then
  fail "verify passed with unchanged b.rs set to now"
fi
[[ "$err" == *"WRONG MTIME crate/src/b.rs:"* ]] || fail "verify did not name b.rs: $err"

# A member crate's own manifest is an ordinary changed file: cargo fingerprints what it compiles
# from, so the crate's closure rebuilds (each field kind measured in the pull request).
printf '[package]\nname = "c"\nversion = "0.1.0"\n' > crate/Cargo.toml
git commit -q -am member-manifest
out="$(python3 "$tool" reuse "$target")" || fail "reuse failed on a member manifest change: $out"
[[ "$(mtime crate/Cargo.toml)" -gt "$recorded" ]] || fail "the changed member Cargo.toml not after T"
[[ "$(mtime crate/src/b.rs)" -eq $((recorded - 1)) ]] || fail "unchanged b.rs not T - 1 after a member manifest change"

# Fallbacks leave the checkout's mtimes and say why: the workspace manifest reaches every crate.
printf '[workspace]\nmembers = ["crate"]\n' > Cargo.toml
git add Cargo.toml
git commit -q -m workspace-manifest
touch crate/src/b.rs
bumped="$(mtime crate/src/b.rs)"
out="$(python3 "$tool" reuse "$target")"
[[ "$out" == *"full rebuild: Cargo.toml changed"* ]] || fail "a workspace manifest change did not fall back: $out"
[[ "$(mtime crate/src/b.rs)" -eq "$bumped" ]] || fail "the workspace manifest fallback changed an mtime"

out="$(python3 "$tool" reuse target/absent)"
[[ "$out" == *"full rebuild: the restored cache carries no source marker"* ]] || fail "no marker did not fall back: $out"

printf '%s\n# workspace source %s %s\n' 'Signature: 8a477f597d28d172789f06886806bc55' \
  0123456789abcdef0123456789abcdef01234567 "$recorded" > "$target/source-marker/CACHEDIR.TAG"
git remote add origin "$work/no-such-remote"
out="$(python3 "$tool" reuse "$target")"
[[ "$out" == *"full rebuild: cannot reach the cached source commit"* ]] || fail "an unknown commit did not fall back: $out"

echo "ok: workspace mtimes reuse, verify by name, and fall back"
