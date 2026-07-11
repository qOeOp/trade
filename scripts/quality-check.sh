#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
}

check_toolset_manifest() {
  require_cmd bun
  log "toolset manifest"
  bun scripts/toolset.ts --validate >/dev/null
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
  find modules \( -name package.json -o -name go.mod -o -name requirements.txt \) -type f | sort | while IFS= read -r marker; do
    module_dir="$(dirname "$marker")"
    if [ ! -f "$module_dir/CONTRACT.md" ]; then
      printf 'quality: missing module contract: %s/CONTRACT.md\n' "$module_dir" >&2
      exit 1
    fi
  done
  find modules/orchestration-ops/trade-flow/src/domain -mindepth 1 -maxdepth 1 -type d | sort | while IFS= read -r domain_dir; do
    if [ ! -f "$domain_dir/CONTRACT.md" ]; then
      printf 'quality: missing domain contract: %s/CONTRACT.md\n' "$domain_dir" >&2
      exit 1
    fi
    if [ ! -f "$domain_dir/index.ts" ]; then
      printf 'quality: missing domain index: %s/index.ts\n' "$domain_dir" >&2
      exit 1
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
  bun install --frozen-lockfile
  find modules -name package.json -type f | sort | while IFS= read -r package; do
    [ -f "$package" ] || continue
    dir="$(dirname "$package")"
    if grep -q '"check"' "$package"; then
      (cd "$dir" && bun run check)
    fi
  done
}

check_go_tools() {
  require_cmd go
  log "go tools"
  find modules -name go.mod -type f | sort | while IFS= read -r mod; do
    [ -f "$mod" ] || continue
    dir="$(dirname "$mod")"
    go_files="$(find "$dir" -name '*.go' -type f | sort)"
    if [ -n "$go_files" ]; then
      unformatted="$(gofmt -l $go_files)"
      if [ -n "$unformatted" ]; then
        printf 'quality: gofmt required:\n%s\n' "$unformatted" >&2
        exit 1
      fi
    fi
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

check_project_hygiene() {
  require_cmd rg
  log "project hygiene"
  git diff --check
  if [ -n "${HOME:-}" ]; then
    if rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts modules toolset.json >/dev/null; then
      rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts modules toolset.json >&2
      printf 'quality: local absolute path leaked into project files\n' >&2
      exit 1
    fi
  fi
  if [ -d toolset ]; then
    printf 'quality: tool registry belongs at ./toolset.json; do not recreate toolset/\n' >&2
    exit 1
  fi
  legacy_tool_dir='.agents''/skills'
  if [ -d "$legacy_tool_dir" ]; then
    printf 'quality: project tools belong under modules/, not the legacy agent tool directory\n' >&2
    exit 1
  fi
  retired_negative_control_pattern='n''ull[_ -]?control|n''ullControl|N''ULL[_ -]?CONTROL'
  if rg -n "$retired_negative_control_pattern" README.md AGENTS.md docs scripts modules toolset.json data/rd >/dev/null; then
    rg -n "$retired_negative_control_pattern" README.md AGENTS.md docs scripts modules toolset.json data/rd >&2
    printf 'quality: use negative_control naming only\n' >&2
    exit 1
  fi
}

check_project_hygiene
check_shell
check_helpers
check_toolset_manifest
check_module_contracts
check_typescript_tools
check_go_tools
check_python_tools

log "ok"
