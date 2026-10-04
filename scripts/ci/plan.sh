#!/usr/bin/env bash
set -euo pipefail

# Single CI impact authority. Pull requests are classified from the exact base
# to HEAD name-status diff. An exact main-branch push that modifies only the
# external Skill lock uses the same narrow non-language route; every other push
# and ambiguous input fails closed to every gate.

emit() {
  local tests="$1" rust_tests="$2" generated="$3" full_prek="$4" capnp="$5"
  local python="$6" rust="$7" owner_chain="$8" reason="$9"
  {
    echo "run_tests=${tests}"
    echo "run_rust_tests=${rust_tests}"
    echo "run_generated_drift=${generated}"
    echo "run_full_pre_commit=${full_prek}"
    echo "run_capnp_check=${capnp}"
    echo "codeql_python_impacted=${python}"
    echo "codeql_rust_impacted=${rust}"
    echo "run_owner_chain=${owner_chain}"
    echo "pre_commit_base=${merge_base:-}"
  } >> "$GITHUB_OUTPUT"
  echo "$reason"
}

run_all() {
  emit true true true true true true true true "$1"
  exit 0
}

case "${EVENT_NAME:-}" in
  push)
    if [[ "${REF_NAME:-}" != main ]]; then
      run_all "non-main push: running full validation"
    fi
    before_commit="${BEFORE_SHA:-}"
    after_commit="${AFTER_SHA:-}"
    if [[ ! "$before_commit" =~ ^[0-9a-f]{40}$ ]] ||
      [[ "$before_commit" == 0000000000000000000000000000000000000000 ]] ||
      ! git cat-file -e "${before_commit}^{commit}" 2> /dev/null; then
      run_all "main push base commit invalid: running full validation"
    fi
    if [[ ! "$after_commit" =~ ^[0-9a-f]{40}$ ]] ||
      ! git cat-file -e "${after_commit}^{commit}" 2> /dev/null ||
      [[ "$after_commit" != "$(git rev-parse HEAD)" ]]; then
      run_all "main push candidate commit invalid: running full validation"
    fi
    if ! merge_base="$(git merge-base "$before_commit" "$after_commit" 2> /dev/null)" ||
      [[ "$merge_base" != "$before_commit" ]]; then
      run_all "main push is not an exact fast-forward: running full validation"
    fi
    push_diff="$(git diff --name-status --find-renames "$before_commit" "$after_commit")"
    before_pin_entry="$(git ls-tree --format='%(objectmode) %(objecttype)' \
      "$before_commit" -- codex-skills.lock.json)"
    after_pin_entry="$(git ls-tree --format='%(objectmode) %(objecttype)' \
      "$after_commit" -- codex-skills.lock.json)"
    if [[ "$push_diff" != $'M\tcodex-skills.lock.json' ||
      "$before_pin_entry" != '100644 blob' || "$after_pin_entry" != '100644 blob' ]]; then
      run_all "main push is not an exact Skill pin update: running full validation"
    fi
    emit false false false false false false false false \
      "exact main Skill pin update: running narrow non-language validation"
    exit 0
    ;;
  pull_request)
    if [[ -z "${BASE_REF:-}" ]]; then
      run_all "PR base ref missing: running full validation"
    fi

    base_commit="${BASE_SHA:-}"
    if [[ -n "$base_commit" ]]; then
      if [[ ! "$base_commit" =~ ^[0-9a-f]{40}$ ]] ||
        ! git cat-file -e "${base_commit}^{commit}" 2> /dev/null; then
        run_all "PR base commit invalid: running full validation"
      fi
    else
      if ! base_commit="$(git rev-parse --verify "refs/remotes/origin/${BASE_REF}^{commit}" 2> /dev/null)"; then
        run_all "PR base commit unavailable: running full validation"
      fi
    fi
    if ! merge_base="$(git merge-base "$base_commit" HEAD 2> /dev/null)" ||
      [[ -z "$merge_base" ]]; then
      run_all "PR merge-base unavailable: running full validation"
    fi
    ;;
  *)
    run_all "${EVENT_NAME:-unknown} event: running full validation"
    ;;
esac

# Regular A/M prose has no build or language-analysis consumer unless it lives
# inside an authority, generated, schema, test-fixture, or data owner.
is_lightweight_prose() {
  local changed_file="$1" filename="${1##*/}"
  case "$changed_file" in
    .github/workflows/* | .github/actions/* | .github/scripts/* | \
      scripts/* | .pre-commit-hooks/* | .cargo/* | .config/* | \
      config/* | configs/* | schema/* | schemas/* | \
      generated/* | tests/* | fixtures/* | resources/* | data/* | \
      test_data/* | snapshots/* | */.cargo/* | */.config/* | \
      */config/* | */configs/* | */schema/* | */schemas/* | \
      */generated/* | */tests/* | */fixtures/* | */resources/* | \
      */data/* | */test_data/* | */snapshots/*)
      return 1
      ;;
  esac
  case "$filename" in
    requirements*.txt | constraints*.txt)
      return 1
      ;;
  esac
  case "$changed_file" in
    *.md | *.markdown | *.mdx | *.rst | *.adoc | *.txt | LICENSE | NOTICE | COPYING)
      return 0
      ;;
  esac
  return 1
}

is_lightweight_prose_deletion() {
  local deleted_file="$1" deleted_dir manifest old_entry old_mode old_type old_blob

  if ! is_lightweight_prose "$deleted_file" || ! command -v python3 > /dev/null; then
    return 1
  fi
  # Root prose and prose beside a package manifest can be packaging metadata
  # (for example README.md). Treat those deletions as build-impacting without
  # maintaining a directory allowlist.
  if [[ "$deleted_file" != */* ]]; then
    return 1
  fi
  deleted_dir="${deleted_file%/*}"
  for manifest in Cargo.toml pyproject.toml package.json; do
    if git cat-file -e "${merge_base}:${deleted_dir}/${manifest}" 2> /dev/null; then
      return 1
    fi
  done
  : > "$entry_file"
  if ! git ls-tree -z --format='%(objectmode) %(objecttype) %(objectname)' \
    "$merge_base" -- ":(literal)$deleted_file" > "$entry_file"; then
    return 1
  fi
  exec 4< "$entry_file"
  if ! IFS= read -r -d '' old_entry <&4; then
    exec 4<&-
    return 1
  fi
  if IFS= read -r -d '' _ <&4; then
    exec 4<&-
    return 1
  fi
  exec 4<&-
  read -r old_mode old_type old_blob <<< "$old_entry"
  if [[ "$old_mode" != 100644 || "$old_type" != blob ||
    ! "$old_blob" =~ ^[0-9a-f]{40,64}$ ]]; then
    return 1
  fi

  git cat-file blob "$old_blob" | python3 -c '
import sys

data = sys.stdin.buffer.read()
if b"\0" in data:
    raise SystemExit(1)
try:
    data.decode("utf-8", errors="strict")
except UnicodeDecodeError:
    raise SystemExit(1)
'
}

# scripts/ci/owner-chain-crates.tsv (scripts/ci/owner-chain-closure.py's own table) maps every
# workspace crate directory to whether it lies in the transitive dependency closure of the Owner
# Postgres chain's guarded roots (scripts/ci/test-rd-owner-postgres.bash's `guarded_roots`).
# Loaded once; a missing or malformed table, or a path it cannot attribute to a known crate
# directory, fails open to "the chain is needed" - the same bias `run_all` uses for everything
# else this script cannot classify.
owner_chain_table_loaded=false
declare -A owner_chain_table_status=()

load_owner_chain_table() {
  owner_chain_table_loaded=true
  local table="scripts/ci/owner-chain-crates.tsv"
  [[ -f "$table" ]] || return 0
  local dir status
  while IFS=$'\t' read -r dir status; do
    case "$dir" in
      '' | '#'*) continue ;;
    esac
    owner_chain_table_status["$dir"]="$status"
  done < "$table"
}

# The crate directory that genuinely owns `changed_file`, read from the git tree at HEAD (the
# diff's own tip, so a crate the same PR just added is seen too) rather than from the table: the
# table can only ever be as fresh as the last `--write`, and trusting it for *which* directory is
# a crate root - not just what the known ones map to - would silently misattribute a path under a
# brand-new, not-yet-tabled crate to its nearest tabled ancestor instead of failing open. Walks
# upward from the file's own directory until one holds a `Cargo.toml` at HEAD; a path with no
# such ancestor (nothing under `crates/` or `services/` reaches this function at all - see the
# `*.rs`/`*/Cargo.toml` cases below) prints empty, which the caller treats as unresolved.
owning_crate_dir() {
  local changed_file="$1" probe
  probe="${changed_file%/*}"
  [[ "$probe" == "$changed_file" ]] && probe=""
  while true; do
    if [[ -z "$probe" ]]; then
      echo ""
      return
    fi
    if git cat-file -e "HEAD:${probe}/Cargo.toml" 2> /dev/null; then
      echo "$probe"
      return
    fi
    if [[ "$probe" == */* ]]; then
      probe="${probe%/*}"
    else
      probe=""
    fi
  done
}

owner_chain_impact() {
  local changed_file="$1" crate_dir
  [[ "$owner_chain_table_loaded" == true ]] || load_owner_chain_table
  crate_dir="$(owning_crate_dir "$changed_file")"
  if [[ -n "$crate_dir" && -n "${owner_chain_table_status[$crate_dir]+set}" ]]; then
    if [[ "${owner_chain_table_status[$crate_dir]}" == in ]]; then
      echo true
    else
      echo false
    fi
    return
  fi
  echo true
}

tests=false
rust_tests=false
generated=false
full_prek=false
capnp=false
codeql_python=false
codeql_rust=false
owner_chain=false
changed=false

status_file="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan.XXXXXX")"
entry_file="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan-entry.XXXXXX")"
trap 'rm -f "$status_file" "$entry_file"' EXIT
if ! git diff --name-status --find-renames -z "$merge_base" HEAD > "$status_file"; then
  run_all "Changed paths unavailable: running full validation"
fi

exec 3< "$status_file"
while IFS= read -r -d '' status <&3; do
  changed=true
  case "$status" in
    A | M)
      if ! IFS= read -r -d '' changed_file <&3; then
        run_all "Malformed changed path: running full validation"
      fi
      ;;
    D)
      if ! IFS= read -r -d '' changed_file <&3; then
        run_all "Malformed deleted path: running full validation"
      fi
      if is_lightweight_prose_deletion "$changed_file"; then
        continue
      fi
      run_all "Unsafe deletion detected: running full validation"
      ;;
    R* | C*)
      run_all "${status} change detected: running full validation"
      ;;
    *)
      run_all "Unknown ${status} change detected: running full validation"
      ;;
  esac

  mode="$(git ls-tree HEAD -- "$changed_file" | awk 'NR == 1 { print $1 }')"
  if [[ "$mode" != 100644 ]]; then
    run_all "Non-regular or executable path changed: running full validation"
  fi
  if is_lightweight_prose "$changed_file"; then
    continue
  fi

  # Each of these is its own Cargo workspace, with its own Cargo.lock, excluded from the root
  # workspace (Cargo.toml's `exclude`): nothing here can affect a root build, test, or codeql
  # scan, so a change confined to one carries no root-workspace impact here. Its own
  # services-rust-mcp.yml workflow (path_triggered_workflows.py) is the gate that actually runs
  # against it.
  case "$changed_file" in
    services/market-data-mcp/* | services/strategy-authoring-mcp/* | services/backtest-mcp/*)
      continue
      ;;
  esac

  # The planner, CI/security workflows, reusable actions, and validation hooks
  # control their own authority. Syntax validation supplements, but never
  # replaces, fail-closed full analysis for these paths.
  case "$changed_file" in
    .github/workflows/* | .github/actions/* | .github/scripts/* | \
      .pre-commit-config.yaml | .pre-commit-hooks/* | scripts/ci/*)
      run_all "CI or security authority changed: running full validation"
      ;;
  esac

  # Shared schemas and cross-language bindings feed both Rust and Python.
  case "$changed_file" in
    schema/* | schemas/* | */schema/* | */schemas/* | *.capnp | *.proto | \
      crates/*/src/python/* | crates/*/src/bindings/*)
      tests=true
      rust_tests=true
      generated=true
      full_prek=true
      capnp=true
      codeql_python=true
      codeql_rust=true
      owner_chain=true
      continue
      ;;
  esac

  case "$changed_file" in
    *.py | *.pyi | *.pyx | *.pxd | \
      python/pyproject.toml | python/uv.lock | setup.cfg | tox.ini | \
      requirements*.txt | constraints*.txt)
      tests=true
      codeql_python=true
      case "$changed_file" in
        *generate* | *.pyi | *.pyx | *.pxd)
          generated=true
          ;;
      esac
      ;;
    *.rs)
      tests=true
      rust_tests=true
      full_prek=true
      codeql_rust=true
      if [[ "$(owner_chain_impact "$changed_file")" == true ]]; then
        owner_chain=true
      fi
      ;;
    */Cargo.toml)
      tests=true
      rust_tests=true
      full_prek=true
      codeql_rust=true
      if [[ "$(owner_chain_impact "$changed_file")" == true ]]; then
        owner_chain=true
      fi
      ;;
    Cargo.toml | Cargo.lock | rust-toolchain.toml | .cargo/* | \
      */.cargo/* | clippy.toml)
      # Workspace-wide, not one crate's own manifest: a dependency edge, a shared profile, or the
      # toolchain itself could move any crate across the closure's line, so this stays ambiguous.
      tests=true
      rust_tests=true
      full_prek=true
      codeql_rust=true
      owner_chain=true
      ;;
    Makefile | *.mk | tools.toml | *.sh | *.bash | *.zsh | *.toml | *.yaml | *.yml | \
      *.json | *.lock | generated/* | */generated/* | tests/* | */tests/* | \
      fixtures/* | */fixtures/* | resources/* | */resources/* | data/* | */data/*)
      run_all "Build input, generator, fixture, data, or config changed: running full validation"
      ;;
    *)
      run_all "Unknown changed path: running full validation"
      ;;
  esac
done
exec 3<&-

if [[ "$changed" != true ]]; then
  run_all "Empty changed-path set: running full validation"
fi

emit "$tests" "$rust_tests" "$generated" "$full_prek" "$capnp" \
  "$codeql_python" "$codeql_rust" "$owner_chain" \
  "PR impact plan: tests=${tests}, rust=${rust_tests}, generated=${generated}, owner_chain=${owner_chain}, changed-file pre-commit"
