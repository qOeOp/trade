# Sourced first by every recipe: SKILL_DIR=<directory this skill was loaded from>; . "$SKILL_DIR/assets/env.sh"
# Fails fast; works from any directory, in or outside this repository.
set -euo pipefail
umask 077
A=$(cd "${SKILL_DIR:?set SKILL_DIR to the directory this skill was loaded from}/assets" && pwd -P)
ROOT=${VIDEO_EVIDENCE_ROOT:-$HOME/.local/share/video-evidence}
mkdir -p "$ROOT/sha256" "$ROOT/bundles" "$ROOT/work"
ROOT=$(cd "$ROOT" && pwd -P)
case "$ROOT/" in
  /tmp/* | /private/tmp/* | /var/folders/* | "$(cd "${TMPDIR:-/tmp}" && pwd -P)"/*)
    echo "VIDEO_EVIDENCE_ROOT must not be a temporary directory: $ROOT" >&2; exit 1 ;;
esac
if git -C "$ROOT" rev-parse --git-dir > /dev/null 2>&1; then
  echo "VIDEO_EVIDENCE_ROOT must not be inside a Git checkout: $ROOT" >&2; exit 1
fi
REPO=${VIDEO_EVIDENCE_REPO:-$(git -C "$A" rev-parse --show-toplevel)}
CHECK="$REPO/services/video-evidence/check_bundle.py"
test -f "$CHECK" || { echo "checker not found at $CHECK; set VIDEO_EVIDENCE_REPO to a checkout" >&2; exit 1; }
MLX_VENV=${MLX_VENV:-$HOME/.local/share/bilibili-note-mcp/mlx-venv}
