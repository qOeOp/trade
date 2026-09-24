#!/usr/bin/env bash
# Exercises cargo-target-in-worktree.bash in both directions, from the root of this worktree: target
# directories inside the worktree pass, ones outside it fail and say so. The case that matters most is
# a sibling whose path starts with the worktree's path (`<worktree>-target`): a bare string-prefix
# comparison would take it for "inside", so it must fail here, and it does only because the helper
# compares with a `/` after each path.
set -euo pipefail

# Run as a pre-commit hook, this inherits GIT_DIR and friends, which point git at the repository
# without its worktree; left in place, every `--show-toplevel` below would answer the wrong path.
while IFS='=' read -r name _; do
  case "$name" in
    GIT_*) unset "$name" ;;
  esac
done < <(env)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${CARGO_TARGET_IN_WORKTREE_HELPER:-${SCRIPT_DIR}/cargo-target-in-worktree.bash}"
toplevel="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$toplevel"

stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT

# expect <0|1> <description> <CARGO_TARGET_DIR, or "unset">
expect() {
  local want="$1" description="$2" target="$3" status=0
  # The child shell expands its own positional parameters; single quotes are deliberate.
  # shellcheck disable=SC2016
  if [[ "$target" == unset ]]; then
    env -u CARGO_TARGET_DIR bash -c 'source "$1"; require_cargo_target_inside_worktree' _ "$HELPER" \
      2> "$stderr_file" || status=$?
  else
    CARGO_TARGET_DIR="$target" bash -c 'source "$1"; require_cargo_target_inside_worktree' _ "$HELPER" \
      2> "$stderr_file" || status=$?
  fi
  if [[ "$status" -ne "$want" ]]; then
    echo "FAIL: ${description}: expected exit ${want}, got ${status}" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
  if [[ "$want" -ne 0 ]] && ! grep -q "outside this worktree" "$stderr_file"; then
    echo "FAIL: ${description}: refused without saying the directory is outside the worktree" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
}

expect 0 "CARGO_TARGET_DIR unset (cargo's own target/ inside the worktree)" unset
expect 0 "a subdirectory of the worktree" "${toplevel}/target/chain-local"
expect 0 "a relative path, which cargo resolves inside the worktree" "target/relative"
# The worktree root itself passes: the rule keeps out directories another worktree can write to, and
# only this worktree builds here. Unusual - cargo's build directories would sit beside the sources -
# but not shared, so not what this check exists to stop.
expect 0 "the worktree root itself" "$toplevel"
expect 1 "a sibling whose path starts with the worktree's path" "${toplevel}-target"
expect 1 "a directory elsewhere" "$(dirname "$toplevel")/some-other-target"

echo "cargo-target-in-worktree: inside the worktree passes; outside it, including a sibling sharing its prefix, is refused by name"
