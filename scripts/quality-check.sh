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

check_typescript_skills() {
  require_cmd bun
  log "typescript skills"
  for package in .agents/skills/*/package.json; do
    [ -f "$package" ] || continue
    dir="$(dirname "$package")"
    if grep -q '"check"' "$package"; then
      (cd "$dir" && bun install --frozen-lockfile && bun run check)
    fi
  done
}

check_go_skills() {
  require_cmd go
  log "go skills"
  for mod in .agents/skills/*/go.mod; do
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

check_python_skills() {
  python_cmd="$(sh scripts/resolve-python.sh)"
  log "python skills"
  for dir in .agents/skills/*; do
    [ -d "$dir/scripts" ] || continue
    if find "$dir/scripts" -name '*.py' -type f | grep -q .; then
      "$python_cmd" -m compileall -q "$dir/scripts"
      (cd "$dir" && "$python_cmd" -W error -m unittest discover -s scripts -p 'test*.py')
    fi
  done
}

check_project_hygiene() {
  require_cmd rg
  log "project hygiene"
  git diff --check
  if [ -n "${HOME:-}" ]; then
    if rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts .agents/skills >/dev/null; then
      rg -n --fixed-strings "$HOME" README.md AGENTS.md docs scripts .agents/skills >&2
      printf 'quality: local absolute path leaked into project files\n' >&2
      exit 1
    fi
  fi
}

check_project_hygiene
check_shell
check_helpers
check_typescript_skills
check_go_skills
check_python_skills

log "ok"
