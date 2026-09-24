# shellcheck shell=bash
# Sourced by scripts/ci/test-rd-owner-postgres.bash and crates/data/tests/run_market_data_owner_postgres.bash
# for local runs. The chain's binaries must be built from this worktree's sources.
#
# A target directory shared by several worktrees does not guarantee that. Path-dependency artifacts
# are named without the worktree in them and cargo decides freshness by mtime, so after another
# worktree builds into the same directory, a source file here that is older than that build counts
# as fresh: the chain then runs binaries built from the other worktree's sources against this
# worktree's scripts and SQL, and a mixed result reads exactly like a real regression (Lane 1,
# 2026-09-24). Any cargo command writes the directory - clippy, build, test - so no marker written
# by the chain alone can see every writer. The one reliable rule is not to share it.
#
# There is no switch to allow a shared directory, and nothing here touches sources to force a
# rebuild: a shared target directory has no safe use. The dependency builds each worktree would
# otherwise repeat are reused across directories by sccache (`rustc-wrapper` in ~/.cargo/config.toml
# on the machines these chains run on), which keys on content, not on paths or mtimes, so it does not
# bring this problem back. Do not share a target directory to save compile time.

# Fails, naming the fix, unless cargo's target directory is inside this worktree.
require_cargo_target_inside_worktree() {
  local toplevel target
  # A git hook or wrapper can export GIT_DIR, and with it set `--show-toplevel` answers the current
  # directory rather than the worktree root; this check needs the root, so it ignores both.
  toplevel="$(env -u GIT_DIR -u GIT_WORK_TREE git rev-parse --show-toplevel)"
  target="$(cargo metadata --format-version 1 --no-deps |
    python3 -c 'import json, os, sys; print(os.path.realpath(json.load(sys.stdin)["target_directory"]))')"
  toplevel="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$toplevel")"
  if [[ "$target/" == "$toplevel"/* ]]; then
    return 0
  fi
  echo "ERROR: cargo's target directory is outside this worktree:" >&2
  echo "       target:   $target" >&2
  echo "       worktree: $toplevel" >&2
  echo "       Another worktree may have built into it, and cargo would then run its binaries here." >&2
  echo "       Unset CARGO_TARGET_DIR, or set it to a path inside this worktree." >&2
  return 1
}
