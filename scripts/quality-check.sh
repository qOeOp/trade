#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUALITY_LOCK_DIR="$ROOT/tmp/check/quality-check.lock"
sh scripts/quality-lock.sh acquire "$QUALITY_LOCK_DIR" "$$"
release_quality_lock() {
  sh scripts/quality-lock.sh release "$QUALITY_LOCK_DIR" "$$"
}
trap release_quality_lock EXIT HUP INT TERM

log() {
  printf 'quality: %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'quality: missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

check_shell() {
  log "shell syntax"
  for file in scripts/*.sh; do
    [ -f "$file" ] || continue
    sh -n "$file"
  done
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

check_toolset_manifest() {
  require_cmd bun
  log "quality judge regression"
  # Replay negative-control judges execute the full maturity scanner in subprocesses;
  # keep their fail-closed assertions while allowing normal concurrent repository load.
  bun test --timeout 15000 ./scripts/*.test.ts >/dev/null
  log "doc contracts"
  bun scripts/check-doc-contracts.ts >/dev/null
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
  bun scripts/check-package-tests.ts
  bun install --frozen-lockfile
  find modules -name package.json -type f | sort | while IFS= read -r package; do
    [ -f "$package" ] || continue
    dir="$(dirname "$package")"
    if grep -q '"check"' "$package"; then
      (cd "$dir" && bun run check)
    fi
  done
}

check_duplication() {
  require_cmd bun
  log "duplicated code"
  bun scripts/check-duplication.ts
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
  log "project hygiene"
  git diff --check
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
    if rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts modules .agents toolset.json >/dev/null; then
      rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts modules .agents toolset.json >&2
      printf 'quality: local absolute path leaked into project files\n' >&2
      exit 1
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

check_project_hygiene
check_shell
check_helpers
check_secrets
check_toolset_manifest
check_module_contracts
check_duplication
check_typescript_tools
check_go_tools
check_python_tools
check_rust_tools

log "ok"
