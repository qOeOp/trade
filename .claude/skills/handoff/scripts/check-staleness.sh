#!/usr/bin/env bash
# check-staleness.sh — validate a handoff document before a fresh agent trusts it.
#
# Usage: scripts/check-staleness.sh path/to/handoff-<timestamp>.md
#
# Exit code: 0 = looks current, 1 = problems found, 2 = usage/IO error.
# Checks (read-only, no mutations):
#   - leftover {{...}} placeholders or [TODO]
#   - obvious secrets/tokens left in the doc
#   - recorded git branch / HEAD vs the live repo
#   - <modified-files> entries that no longer exist on disk
set -euo pipefail

doc="${1:-}"
if [[ -z "$doc" || ! -f "$doc" ]]; then
  echo "usage: $0 path/to/handoff-<timestamp>.md" >&2
  exit 2
fi

problems=0
note() { printf '  - %s\n' "$1"; problems=$((problems + 1)); }

echo "Checking: $doc"

# 1. Unfilled placeholders
if grep -qE '\{\{[^}]+\}\}|\[TODO\]' "$doc"; then
  note "contains unfilled placeholders ({{...}} or [TODO]) — the handoff is incomplete"
fi

# 2. Obvious leaked secrets (heuristic, not exhaustive).
# Match real secret SHAPES, not the mere words "token"/"secret" — a handoff about an
# auth feature legitimately discusses tokens. Flag known key formats, or a
# secret-ish keyword immediately assigned a long opaque value.
if grep -qE '(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,})' "$doc" \
   || grep -qiE '(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|bearer)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9._/+-]{12,}' "$doc"; then
  note "may contain a secret/token/key — review and redact before sharing"
fi

# 3. Git branch / HEAD drift (only if we are in a git repo)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  doc_branch="$(grep -oE 'Git branch:[[:space:]]*[^ ·]+' "$doc" | head -1 | sed -E 's/.*Git branch:[[:space:]]*//')"
  doc_head="$(grep -oE 'HEAD:[[:space:]]*[0-9a-f]{4,40}' "$doc" | head -1 | sed -E 's/.*HEAD:[[:space:]]*//')"
  live_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  live_head="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

  if [[ -n "$doc_branch" && "$doc_branch" != "$live_branch" ]]; then
    note "branch drift: doc says '$doc_branch', repo is on '$live_branch'"
  fi
  if [[ -n "$doc_head" && "$doc_head" != "$live_head"* && "$live_head" != "$doc_head"* ]]; then
    note "HEAD drift: doc says '$doc_head', repo HEAD is '$live_head' (work has advanced)"
  fi
else
  echo "  (not inside a git repo — skipping branch/HEAD checks)"
fi

# 4. Modified-files that no longer exist
in_block=0
while IFS= read -r line; do
  case "$line" in
    "<modified-files>") in_block=1; continue ;;
    "</modified-files>") in_block=0; continue ;;
  esac
  if [[ "$in_block" -eq 1 ]]; then
    f="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$f" ]] && continue
    if [[ ! -e "$f" ]]; then
      note "referenced modified file is missing: $f"
    fi
  fi
done < "$doc"

if [[ "$problems" -eq 0 ]]; then
  echo "OK — no staleness problems detected."
  exit 0
fi
echo "Found $problems problem(s). Reconcile before trusting this handoff."
exit 1
