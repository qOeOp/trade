#!/usr/bin/env bash

# Compile the tree a merge would produce, before merging.
#
# Usage: check-merge-tree-compiles.bash [<pr-number> | --commit <rev>]
#
# Each PR's CI builds that PR's own tree. Two PRs that each compile can still produce a merged tree
# that does not (one adds a struct field, the other adds a constructor without it): the text merges
# cleanly, both CI runs are green, and nothing compiles the result before it lands on main. This
# script is that compile. It merges the PR head (or a commit) into current origin/main without
# committing, in a dedicated worktree, and checks the merged tree twice:
#
#   pass 1: the Rust test build CI runs - `--workspace --lib --tests` with the Makefile's
#           CARGO_FEATURES and its test exclusions, read from the merged tree;
#   pass 2: the same plus the ordered chain's sealed feature union, read from the merged tree's chain
#           script, because the chain compiles test code no other build compiles.
#
# It prints one line to quote in the merge rationale:
#
#   RESULT: <main sha>+#<pr>(<head sha>): COMPILES | DOES-NOT-COMPILE | TEXT-CONFLICT
#
# and exits 0, 1 or 2 respectively (3 when it could not run). With no argument it checks origin/main
# alone. MERGE_CHECK_BASE replaces origin/main as the base, e.g. to check a PR against another one
# that is about to merge.
#
# The worktree and target directory are fixed (MERGE_CHECK_HOME, default ~/.cache/vibe-merge-check),
# so every run after the first compiles incrementally. One run at a time per MERGE_CHECK_HOME.
# Measured on a 16-core, 128 GB Apple silicon machine (2026-09-24): the first run takes about 3.5
# minutes; an incremental run takes 1 to 55 seconds, depending on how far main moved since the last one.
# MERGE_CHECK_JOBS sets cargo's -j. It defaults to 8 because memory, not CPU, runs out there: from
# cold, -j 16 finished 9% sooner (188 s against 206 s) but peaked about 30% higher in rustc and cargo
# memory (about 8.6 GB against 6.7 GB).

set -Eeuo pipefail

trap 'echo "check-merge-tree-compiles.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

# A git hook or another git command can export GIT_DIR and friends; inherited here they would point
# every git call below at the caller's repository instead of the dedicated worktree.
while IFS='=' read -r name _; do
  case "$name" in
    GIT_*) unset "$name" ;;
  esac
done < <(env)

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${MERGE_CHECK_HOME:-$HOME/.cache/vibe-merge-check}"
worktree="$state_dir/worktree"
target_dir="$state_dir/target"
jobs="${MERGE_CHECK_JOBS:-8}"

pr=""
commit=""
case "${1:-}" in
  "") ;;
  --commit)
    commit="${2:?usage: $0 [<pr-number> | --commit <rev>]}"
    ;;
  *)
    if [[ ! "$1" =~ ^[0-9]+$ ]]; then
      echo "usage: $0 [<pr-number> | --commit <rev>]" >&2
      exit 3
    fi
    pr="$1"
    ;;
esac

mkdir -p "$state_dir"
lock="$state_dir/lock"
if ! mkdir "$lock" 2> /dev/null; then
  holder="$(cat "$lock/pid" 2> /dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2> /dev/null; then
    echo "ERROR: another merge check (pid $holder) is using $state_dir" >&2
    exit 3
  fi
  echo "note: taking over the lock of a merge check that is no longer running (pid ${holder:-unknown})" >&2
fi
echo "$$" > "$lock/pid"
trap 'rm -rf "$lock"' EXIT

git -C "$repository_root" fetch -q origin main
base="$(git -C "$repository_root" rev-parse --verify "${MERGE_CHECK_BASE:-origin/main}^{commit}")"
head=""
if [ -n "$pr" ]; then
  head="$(gh pr view "$pr" --json headRefOid --jq .headRefOid)"
  git -C "$repository_root" fetch -q origin "pull/$pr/head"
elif [ -n "$commit" ]; then
  head="$(git -C "$repository_root" rev-parse --verify "$commit^{commit}")"
fi

if [ ! -e "$worktree/.git" ]; then
  git -C "$repository_root" worktree add -q --detach "$worktree" "$base"
fi
# The worktree must belong to this repository: resetting and cleaning anything else would destroy it.
if [ "$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)" != \
  "$(git -C "$repository_root" rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo "ERROR: $worktree is not a worktree of $repository_root" >&2
  exit 3
fi

if git -C "$worktree" rev-parse -q --verify MERGE_HEAD > /dev/null; then
  git -C "$worktree" merge --abort
fi
git -C "$worktree" reset -q --hard
git -C "$worktree" clean -qffdx
git -C "$worktree" switch -q --detach "$base"

label="${base:0:9}"
if [ -n "$head" ]; then
  if [ -n "$pr" ]; then
    label="$label+#$pr(${head:0:9})"
  else
    label="$label+${head:0:9}"
  fi
  if ! git -C "$worktree" merge -q --no-commit --no-ff "$head" > /dev/null 2>&1; then
    echo "conflicting paths:"
    git -C "$worktree" diff --name-only --diff-filter=U | sed 's/^/  /'
    git -C "$worktree" merge --abort
    echo "RESULT: $label: TEXT-CONFLICT"
    exit 2
  fi
fi

# What CI's Rust test build uses, read from the merged tree's Makefile rather than restated here.
make_value() {
  make -s --no-print-directory -C "$worktree" -f Makefile -f - print-merge-check-value VARIABLE="$1" << 'MAKE'
print-merge-check-value:
	@echo $($(VARIABLE))
MAKE
}
ci_features="$(make_value CARGO_FEATURES)"
read -r -a exclude_flags <<< "$(make_value CARGO_TEST_EXCLUDE_FLAGS)"
profile="$(make_value CARGO_CI_PROFILE)"
if [ -z "$ci_features" ] || [ -z "$profile" ]; then
  echo "ERROR: could not read CARGO_FEATURES or CARGO_CI_PROFILE from $worktree/Makefile" >&2
  exit 3
fi
# shellcheck source=scripts/ci/sealed-feature-union.bash
source "$repository_root/scripts/ci/sealed-feature-union.bash"
sealed_features="$(sealed_feature_union "$worktree/scripts/ci/test-rd-owner-postgres.bash")"

status=0
check_pass() {
  local name="$1"
  local features="$2"
  local log="$state_dir/$name.log"
  local started=$SECONDS

  echo "== $name: cargo check --workspace --lib --tests --features $features"
  if (cd "$worktree" && CARGO_TARGET_DIR="$target_dir" cargo check --locked --workspace \
    "${exclude_flags[@]}" --lib --tests --features "$features" --profile "$profile" \
    --jobs "$jobs" --quiet --message-format short) > "$log" 2>&1; then
    echo "$name: compiles ($((SECONDS - started))s)"
  else
    status=1
    grep -E '^[^ ]+: error|^error' "$log" | head -40 || true
    echo "$name: DOES NOT COMPILE ($((SECONDS - started))s; full output in $log)"
  fi
}

check_pass pass-1 "$ci_features"
check_pass pass-2 "$ci_features,$sealed_features"

if [ -n "$head" ]; then
  git -C "$worktree" merge --abort
fi
if [ "$status" -eq 0 ]; then
  echo "RESULT: $label: COMPILES"
else
  echo "RESULT: $label: DOES-NOT-COMPILE"
fi
exit "$status"
