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
  bun test \
    ./scripts/audit-workspace-footprint.test.ts \
    ./scripts/check-convergence-budget.test.ts \
    ./scripts/check-test-source-boundaries.test.ts \
    ./scripts/check-workspace-hygiene.test.ts \
    ./scripts/check-workspace-side-effects.test.ts \
    ./scripts/mission-impact-evidence.test.ts \
    ./scripts/quality-judges.test.ts \
    ./scripts/rd-developer-patch-adoption.test.ts \
    ./scripts/rd-developer-workspace-cycle.test.ts \
    ./scripts/rd-forward-candle-segment.test.ts \
    ./scripts/rd-forward-market-data-demand.test.ts \
    ./scripts/rd-strategy-source-adoption.test.ts \
    ./scripts/run-cached-quality-check.test.ts \
    >/dev/null
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

check_typescript_tools() {
  require_cmd bun
  log "typescript tools"
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
    sh scripts/check-native-package.sh go "$dir"
  done
}

check_python_tools() {
  log "python tools"
  find modules -type d -name scripts | sort | while IFS= read -r scripts_dir; do
    dir="$(dirname "$scripts_dir")"
    [ -d "$dir/scripts" ] || continue
    if find "$dir/scripts" -name '*.py' -type f | grep -q .; then
      sh scripts/check-native-package.sh python "$dir"
    fi
  done
}

check_rust_tools() {
  require_cmd cargo
  log "rust tools"
  find modules -name Cargo.toml -type f | sort | while IFS= read -r manifest; do
    [ -f "$manifest" ] || continue
    dir="$(dirname "$manifest")"
    sh scripts/check-native-package.sh rust "$dir"
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
}

check_policy_suite() {
  check_project_hygiene
  check_shell
  check_helpers
  check_secrets
  check_lint
  check_toolset_manifest
  check_test_source_boundaries
}

check_native_suite() {
  check_go_tools
  check_python_tools
  check_rust_tools
}

case "$QUALITY_SCOPE" in
  all)
    check_policy_suite
    check_typescript_tools
    check_replay_semantics
    check_native_suite
    ;;
  policy)
    check_policy_suite
    ;;
  typescript)
    check_typescript_tools
    ;;
  replay)
    check_replay_semantics
    ;;
  native)
    check_native_suite
    ;;
esac

log "$QUALITY_SCOPE ok"
