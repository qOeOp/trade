#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUALITY_SCOPE="${1:-all}"
if [ "$#" -gt 1 ]; then
  printf 'quality: usage: scripts/quality-check.sh [all|policy|typescript|replay|native]\n' >&2
  exit 2
fi
case "$QUALITY_SCOPE" in
  all|policy|typescript|replay|native) ;;
  *)
    printf 'quality: unsupported scope: %s\n' "$QUALITY_SCOPE" >&2
    exit 2
    ;;
esac

QUALITY_LOCK_DIR="$ROOT/tmp/check/quality-check.lock"
QUALITY_WORKSPACE_SNAPSHOT="$ROOT/tmp/check/quality-workspace-snapshot.json"
QUALITY_FOOTPRINT_REPORT="$ROOT/tmp/check/workspace-footprint.json"
QUALITY_WORKSPACE_POSTFLIGHT=0
sh scripts/quality-lock.sh acquire "$QUALITY_LOCK_DIR" "$$"
release_quality_lock() {
  sh scripts/quality-lock.sh release "$QUALITY_LOCK_DIR" "$$"
}
finish_quality_check() {
  quality_status=$?
  postflight_status=0
  trap - EXIT HUP INT TERM
  if [ "$QUALITY_WORKSPACE_POSTFLIGHT" -eq 1 ]; then
    bun scripts/check-workspace-side-effects.ts --action check --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" || postflight_status=$?
  fi
  release_quality_lock
  if [ "$quality_status" -ne 0 ]; then
    exit "$quality_status"
  fi
  exit "$postflight_status"
}
trap finish_quality_check EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -n "${CI:-}" ]; then
  bun scripts/check-workspace-side-effects.ts --action capture --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" --require-clean >/dev/null
else
  bun scripts/check-workspace-side-effects.ts --action capture --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" >/dev/null
fi
QUALITY_WORKSPACE_POSTFLIGHT=1

log() {
  printf 'quality: %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'quality: missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

find_local_home_paths() {
  quality_home="$HOME"
  while [ "${quality_home%/}" != "$quality_home" ]; do
    quality_home="${quality_home%/}"
  done
  [ -n "$quality_home" ] || return 2

  quality_home_rg_status=0
  quality_home_candidates="$(
    rg --no-config -n --fixed-strings "$quality_home" README.md AGENTS.md docs scripts modules .agents toolset.json
  )" || quality_home_rg_status=$?
  if [ "$quality_home_rg_status" -ne 0 ]; then
    return "$quality_home_rg_status"
  fi

  printf '%s\n' "$quality_home_candidates" | QUALITY_HOME="$quality_home" awk '
      BEGIN {
        home = ENVIRON["QUALITY_HOME"]
      }
      {
        search_start = 1
        while (search_start <= length($0)) {
          relative_position = index(substr($0, search_start), home)
          if (relative_position == 0) {
            break
          }
          position = search_start + relative_position - 1
          prefix = substr($0, 1, position - 1)
          previous_character = position == 1 ? "" : substr($0, position - 1, 1)
          next_character = substr($0, position + length(home), 1)
          path_prefix = prefix
          sub(/^.*[^[:alnum:]_.~\/-]/, "", path_prefix)
          normalized_path_boundary = 0
          if (path_prefix ~ /^\//) {
            path_depth = 0
            path_segment_count = split(path_prefix, path_segments, "/")
            for (path_segment_index = 1; path_segment_index <= path_segment_count; path_segment_index++) {
              path_segment = path_segments[path_segment_index]
              if (path_segment == "" || path_segment == ".") {
                continue
              }
              if (path_segment == "..") {
                if (path_depth > 0) {
                  path_depth--
                }
                continue
              }
              path_depth++
            }
            normalized_path_boundary = path_depth == 0
          }
          file_uri_boundary = (length(prefix) >= 7 && tolower(substr(prefix, length(prefix) - 6)) == "file://") \
            || (length(prefix) >= 16 && tolower(substr(prefix, length(prefix) - 15)) == "file://localhost")
          shell_default_boundary = (prefix ~ /\$\{([[:alpha:]_][[:alnum:]_]*|[[:digit:]]+|[@*#?$!-]):?-$/)
          shell_parameter_boundary = (prefix ~ /(^|[[:space:]"=:,;|&(])\$([[:alpha:]_][[:alnum:]_]*|[[:digit:]]+|[@*#?$!-])$/)
          joined_option_boundary = (prefix ~ /(^|[[:space:]"=:,;|&(])--?[[:alnum:]_][[:alnum:]_-]*$/)
          previous_boundary = previous_character == "" \
            || previous_character !~ /[[:alnum:]_.~\/-]/ \
            || file_uri_boundary \
            || shell_default_boundary \
            || shell_parameter_boundary \
            || joined_option_boundary \
            || normalized_path_boundary
          next_boundary = next_character == "" || next_character == "/" || next_character !~ /[[:alnum:]_.~-]/
          if (previous_boundary && next_boundary) {
            print
            found = 1
            break
          }
          search_start = position + length(home)
        }
      }
      END {
        exit(found ? 0 : 1)
      }
    '
}

check_dependencies() {
  require_cmd bun
  log "repository dependencies"
  env \
    -u BINANCE_API_KEY \
    -u BINANCE_API_SECRET \
    -u SILICONFLOW_API_KEY \
    bun --no-env-file install --frozen-lockfile --ignore-scripts
}

check_shell() {
  log "shell syntax"
  git ls-files --cached --others --exclude-standard -- '*.sh' | while IFS= read -r file; do
    sh -n "$file"
  done
  bun run lint:shell
}

check_helpers() {
  log "helper scripts"
  sh scripts/resolve-codex-home.sh >/dev/null
  CODEX_HOME=/tmp/codex-home sh scripts/resolve-codex-home.sh >/dev/null
  sh scripts/automation-memory-path.sh demo-id >/dev/null
  CODEX_HOME=/tmp/codex-home sh scripts/automation-memory-path.sh demo-id >/dev/null
  sh scripts/resolve-python.sh >/dev/null
  sh scripts/check-workspace-skills.sh >/dev/null
}

check_secrets() {
  require_cmd bun
  log "secret scan"
  bun scripts/check-secrets.ts >/dev/null
}

check_lint() {
  require_cmd bun
  log "eslint"
  bun run lint
}

check_toolset_manifest() {
  require_cmd bun
  log "quality judge regression"
  bun test ./scripts/*.test.ts >/dev/null
  log "doc contracts"
  bun scripts/check-doc-contracts.ts >/dev/null
  log "development convergence"
  bun scripts/check-convergence-budget.ts
  log "toolset manifest"
  bun scripts/toolset.ts --validate >/dev/null
  bun scripts/check-architecture-manifest.ts >/dev/null
  bun scripts/check-rd-target-layout.ts >/dev/null
  bun scripts/check-rd-replay-maturity-gate.ts >/dev/null
  bun scripts/check-storage-schemas.ts >/dev/null
  bun scripts/architecture-drift-audit.ts --check >/dev/null
  bun scripts/logical-store.ts --action init --store all --base-dir tmp/check/logical-store >/dev/null
  bun scripts/logical-store.ts --action check --store all --base-dir tmp/check/logical-store >/dev/null
}

check_module_contracts() {
  log "module contracts"
  if rg -n '"id": "trade-flow\.research"' toolset.json >/dev/null; then
    printf 'quality: strategy research must be registered as strategy-rd, not trade-flow.research\n' >&2
    exit 1
  fi
  if rg -n '"id": "trade-flow\.artifact"' toolset.json >/dev/null; then
    printf 'quality: artifact/catalog work must be registered as artifact-catalog, not trade-flow.artifact\n' >&2
    exit 1
  fi
  if rg -n '"id": "trade-flow\.review"' toolset.json >/dev/null; then
    printf 'quality: strategy review must be registered as strategy-review, not trade-flow.review\n' >&2
    exit 1
  fi
  for retired in \
    modules/orchestration-ops/trade-flow/src/domain \
    modules/orchestration-ops/trade-flow/src/domain/research \
    modules/orchestration-ops/trade-flow/src/domain/review \
    modules/orchestration-ops/trade-flow/src/domain/artifact \
    modules/orchestration-ops/trade-flow/src/scripts/commands/research.ts \
    modules/orchestration-ops/trade-flow/src/scripts/commands/evidence.ts \
    modules/orchestration-ops/trade-flow/src/scripts/commands/catalog.ts \
    modules/orchestration-ops/trade-flow/src/scripts/lib/data-catalog.ts \
    modules/orchestration-ops/trade-flow/src/scripts/lib/strategy-iteration.ts \
    modules/orchestration-ops/trade-flow/src/scripts/lib/replay-core.ts \
    modules/orchestration-ops/trade-flow/src/scripts/lib/rd-program-state.ts \
    modules/orchestration-ops/trade-flow/src/scripts/lib/strategy-rnd.ts
  do
    if [ -e "$retired" ]; then
      printf 'quality: retired trade-flow compatibility path must not exist: %s\n' "$retired" >&2
      exit 1
    fi
  done
  if rg -n 'handle(Catalog|Evidence|Research)Command|from "\./commands/(catalog|evidence|research)"|from "\./lib/(data-catalog|strategy-iteration|replay-core|rd-program-state|strategy-rnd)"' modules/orchestration-ops/trade-flow/src >/dev/null; then
    rg -n 'handle(Catalog|Evidence|Research)Command|from "\./commands/(catalog|evidence|research)"|from "\./lib/(data-catalog|strategy-iteration|replay-core|rd-program-state|strategy-rnd)"' modules/orchestration-ops/trade-flow/src >&2
    printf 'quality: migrated research/review/catalog code must not be re-imported by trade-flow\n' >&2
    exit 1
  fi
  find modules \( -name package.json -o -name go.mod -o -name Cargo.toml -o -name requirements.txt \) -type f | sort | while IFS= read -r marker; do
    module_dir="$(dirname "$marker")"
    if [ ! -f "$module_dir/CONTRACT.md" ]; then
      printf 'quality: missing module contract: %s/CONTRACT.md\n' "$module_dir" >&2
      exit 1
    fi
  done
  find modules -name CONTRACT.md -type f | sort | while IFS= read -r contract; do
    module_dir="$(dirname "$contract")"
    if find "$module_dir/src" -name '*.ts' -type f 2>/dev/null | grep -q .; then
      if [ ! -f "$module_dir/tsconfig.json" ]; then
        printf 'quality: TypeScript module is missing tsconfig: %s\n' "$module_dir" >&2
        exit 1
      fi
      if [ ! -f "$module_dir/package.json" ]; then
        printf 'quality: TypeScript module is missing package check entry: %s\n' "$module_dir" >&2
        exit 1
      fi
    fi
  done
}

check_typescript_tools() {
  require_cmd bun
  log "typescript tools"
  if find modules -name bun.lock -type f | grep -q .; then
    find modules -name bun.lock -type f | sort >&2
    printf 'quality: tool-local bun.lock files are not allowed; use the root install lockfile\n' >&2
    exit 1
  fi
  bun scripts/check-ts-tool-boundaries.ts
  if [ -n "${QUALITY_TS_SHARD:-}" ]; then
    bun scripts/check-package-tests.ts --run-shard "$QUALITY_TS_SHARD"
  else
    bun scripts/check-package-tests.ts --run-all
  fi
}

check_replay_semantics() {
  require_cmd bun
  log "Replay semantic regression"
  bun scripts/run-cached-quality-check.ts \
    --cache-id replay-semantic \
    --workdir . \
    --input package.json \
    --input bun.lock \
    --input scripts/check-replay-semantic.sh \
    --input scripts/run-cached-quality-check.ts \
    --input scripts/run-exclusive-test.sh \
    --input scripts/quality-lock.sh \
    --input modules/contracts/runtime-core \
    --input modules/research-strategy-development/research-control-plane/contracts \
    --input modules/research-strategy-development/replay-execution-plane/accounting \
    --input modules/research-strategy-development/replay-execution-plane/contracts \
    --input modules/research-strategy-development/replay-execution-plane/data-adapter \
    --input modules/research-strategy-development/replay-execution-plane/engine \
    --input modules/research-strategy-development/replay-execution-plane/runner \
    -- sh scripts/check-replay-semantic.sh
}

check_duplication() {
  require_cmd bun
  log "duplicated code"
  bun scripts/check-duplication.ts
}

check_test_source_boundaries() {
  require_cmd bun
  log "test source boundaries"
  bun scripts/check-test-source-boundaries.ts
}

check_go_tools() {
  require_cmd go
  log "go tools"
  find modules -name go.mod -type f | sort | while IFS= read -r mod; do
    [ -f "$mod" ] || continue
    dir="$(dirname "$mod")"
    sh scripts/check-go-format.sh "$dir"
    (cd "$dir" && go test ./... && go vet ./...)
  done
}

check_python_tools() {
  python_cmd="$(sh scripts/resolve-python.sh)"
  log "python tools"
  find modules -type d -name scripts | sort | while IFS= read -r scripts_dir; do
    dir="$(dirname "$scripts_dir")"
    [ -d "$dir/scripts" ] || continue
    if find "$dir/scripts" -name '*.py' -type f | grep -q .; then
      "$python_cmd" -m compileall -q "$dir/scripts"
      (cd "$dir" && "$python_cmd" -W error -m unittest discover -s scripts -p 'test*.py')
    fi
  done
  find modules -type d -name __pycache__ -prune -exec rm -rf {} +
}

check_rust_tools() {
  require_cmd cargo
  log "rust tools"
  find modules -name Cargo.toml -type f | sort | while IFS= read -r manifest; do
    [ -f "$manifest" ] || continue
    dir="$(dirname "$manifest")"
    (cd "$dir" && cargo fmt --all -- --check)
    (cd "$dir" && cargo check)
    (cd "$dir" && cargo clippy --all-targets -- -D warnings)
    (cd "$dir" && cargo test)
  done
}

check_project_hygiene() {
  require_cmd rg
  require_cmd bun
  log "project hygiene"
  if [ -n "${QUALITY_DIFF_BASE:-}" ]; then
    git diff --no-renames --check "$QUALITY_DIFF_BASE"...HEAD
  else
    git diff --no-renames --check HEAD
  fi
  bun scripts/check-workspace-hygiene.ts
  bun scripts/audit-workspace-footprint.ts > "$QUALITY_FOOTPRINT_REPORT"
  unexpected_docs_root="$(find docs -maxdepth 1 -type f ! -name README.md -print)"
  if [ -n "$unexpected_docs_root" ]; then
    printf 'quality: docs root only allows README.md; move contracts and feature docs into an owned subdirectory:\n%s\n' "$unexpected_docs_root" >&2
    exit 1
  fi
  for docs_dir in product architecture runtime research engineering history; do
    if [ ! -d "docs/$docs_dir" ]; then
      printf 'quality: required docs owner directory is missing: docs/%s\n' "$docs_dir" >&2
      exit 1
    fi
  done
  if [ -n "${HOME:-}" ]; then
    quality_home_paths=
    if quality_home_paths="$(find_local_home_paths)"; then
      printf '%s\n' "$quality_home_paths" >&2
      printf 'quality: local absolute path leaked into project files\n' >&2
      exit 1
    else
      quality_home_scan_status=$?
      if [ "$quality_home_scan_status" -ne 1 ]; then
        printf 'quality: failed to scan project files for local absolute paths\n' >&2
        exit 1
      fi
    fi
  fi
  if [ -d toolset ]; then
    printf 'quality: tool registry belongs at ./toolset.json; do not recreate toolset/\n' >&2
    exit 1
  fi
  retired_negative_control_pattern='n''ull[_ -]?control|n''ullControl|N''ULL[_ -]?CONTROL'
  if rg -n "$retired_negative_control_pattern" README.md AGENTS.md docs scripts modules .agents toolset.json >/dev/null; then
    rg -n "$retired_negative_control_pattern" README.md AGENTS.md docs scripts modules .agents toolset.json >&2
    printf 'quality: use negative_control naming only\n' >&2
    exit 1
  fi
}

check_policy_suite() {
  check_project_hygiene
  check_shell
  check_helpers
  check_secrets
  check_lint
  check_toolset_manifest
  check_module_contracts
  check_duplication
  check_test_source_boundaries
}

check_native_suite() {
  check_go_tools
  check_python_tools
  check_rust_tools
}

case "$QUALITY_SCOPE" in
  all)
    check_dependencies
    check_policy_suite
    check_typescript_tools
    check_replay_semantics
    check_native_suite
    ;;
  policy)
    check_dependencies
    check_policy_suite
    ;;
  typescript)
    check_dependencies
    check_typescript_tools
    ;;
  replay)
    check_dependencies
    check_replay_semantics
    ;;
  native)
    check_native_suite
    ;;
esac

log "$QUALITY_SCOPE ok"
