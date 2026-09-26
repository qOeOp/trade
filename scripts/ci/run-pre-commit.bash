#!/usr/bin/env bash
# The one place that decides which pre-commit hooks a CI job runs, and over which files.
#
# Two workflows run hooks. `pre-commit-pr.yml` runs on every pull request push, drafts included, and
# runs every hook that needs no compiled workspace over all files. `build.yml`'s pre-commit job
# runs on the Ready run whose `quality` gates the merge. On a pull request it runs only the
# COMPILED hooks - the no-compile ones already ran for the same head - and then requires that
# run's result, so every hook still gates the merge. On every other event it runs all of them.
#
# Usage: run-pre-commit.bash <scope> [--print]
#   no-compile            every hook but COMPILED, all files          (pre-commit-pr.yml)
#   pull-request-full     COMPILED, all files                         (build.yml, full route)
#   pull-request-narrow   COMPILED minus NARROW_SKIP, the diff only   (build.yml, narrow route)
#   full                  every hook, all files                       (build.yml, other events)
#   narrow                every hook but NARROW_SKIP, the diff only   (build.yml, other events)
# The narrow scopes read the diff base from PRE_COMMIT_BASE. --print writes the `prek run`
# arguments one per line instead of running them; scripts/ci/test-plan.sh computes each route's
# hook coverage from that output, so what it checks is what runs.
set -Eeuo pipefail
trap 'echo "run-pre-commit.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

# Hooks that compile the workspace, plus check-links-offline, which needs the lychee install only
# build.yml's job carries.
COMPILED=(
  cargo-clippy
  cargo-clippy-network-turmoil-non-linux
  cargo-doc
  cargo-machete
  check-links-offline
)
# Every narrow route is non-Rust by plan.sh. Agent TOML and other generic text would otherwise match
# cargo fmt/clippy/doc's broad TOML filter and rebuild the entire workspace without a Rust consumer.
# Their applicable generic TOML/Markdown checks remain.
NARROW_SKIP=(
  check-anyhow-usage
  check-logging-conventions
  check-tokio-usage
  check-dst-conventions
  check-pyo3-conventions
  check-testing-conventions
  check-vibe-conventions
  fmt
  cargo-clippy
  cargo-clippy-network-turmoil-non-linux
  cargo-doc
  cargo-machete
)

scope="${1:?scope: no-compile, pull-request-full, pull-request-narrow, full or narrow}"
print=false
[[ "${2:-}" == --print ]] && print=true

diff_range() {
  [[ -n "${PRE_COMMIT_BASE:-}" ]] || {
    echo "ERROR: the ${scope} scope needs PRE_COMMIT_BASE." >&2
    exit 1
  }
  args+=(--from-ref "$PRE_COMMIT_BASE" --to-ref HEAD)
}

args=()
case "$scope" in
  no-compile)
    args=(--all-files)
    for hook in "${COMPILED[@]}"; do args+=(--skip "$hook"); done
    ;;
  pull-request-full)
    args=(--all-files "${COMPILED[@]}")
    ;;
  pull-request-narrow)
    diff_range
    hooks=()
    for hook in "${COMPILED[@]}"; do
      [[ " ${NARROW_SKIP[*]} " == *" $hook "* ]] || hooks+=("$hook")
    done
    # `prek run` with no hook named runs every hook, so an empty selection runs nothing instead,
    # and --print prints nothing: the note goes to stderr, not into the argument list.
    if [[ ${#hooks[@]} -eq 0 ]]; then
      echo "run-pre-commit.bash: no compiled hook applies to a narrow route." >&2
      exit 0
    fi
    args+=("${hooks[@]}")
    ;;
  full)
    args=(--all-files)
    ;;
  narrow)
    diff_range
    for hook in "${NARROW_SKIP[@]}"; do args+=(--skip "$hook"); done
    ;;
  *)
    echo "ERROR: unknown scope '${scope}'." >&2
    exit 1
    ;;
esac

if [[ "$print" == true ]]; then
  printf '%s\n' "${args[@]}"
else
  prek run "${args[@]}"
fi
