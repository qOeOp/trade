# shellcheck shell=bash
# Source this before running git on any repository but the one that started you: a fixture, a
# temporary repository, a dedicated worktree.
#
# `git commit` in a linked worktree exports GIT_DIR and GIT_INDEX_FILE to its hooks, and a script
# that inherits them acts on the caller's repository whatever directory it is in:
# - `git init` re-initialises it as bare, which breaks every worktree that shares it;
# - `git config` writes into its config;
# - `git commit` moves its branch.
# That happened on 2026-09-23 (#904's calibration) and again on 2026-09-27, from a self-test whose
# author had written the first incident down.
#
# Sourcing this clears every GIT_* variable, and init_fixture_repository refuses a repository that
# is not the directory it was asked for. scripts/check-git-isolation.py refuses a script that
# creates, clones or configures a repository without sourcing this.
#
# Never source this at a hook's entry when the hook reads the commit being made: for
# `git commit -- <paths>` GIT_INDEX_FILE names the temporary index holding exactly those paths.

isolate_git_environment() {
  local name
  for name in $(compgen -e); do
    if [[ "$name" == GIT_* ]]; then
      unset "$name"
    fi
  done
}

# init_fixture_repository <directory>: an empty repository at <directory>, proven to be that
# directory, with a local fixture identity a caller may overwrite.
init_fixture_repository() {
  local directory=$1 toplevel
  git init -q --initial-branch=main "$directory"
  toplevel="$(git -C "$directory" rev-parse --show-toplevel)"
  if [[ "$toplevel" != "$(cd "$directory" && pwd -P)" ]]; then
    echo "git-isolation: $directory resolves to the repository at $toplevel" >&2
    return 1
  fi
  git -C "$directory" config user.email fixture@example.invalid
  git -C "$directory" config user.name fixture
}

isolate_git_environment
