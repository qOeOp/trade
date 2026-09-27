#!/usr/bin/env bash
# Self-test for scripts/lib/git-isolation.bash and scripts/check-git-isolation.py, both ways round.
#
# The check: a script that runs `git init` (shell or Python) without the helper is refused by
# name, one that sources or imports it passes, a comment is not a call, and the one self-contained
# exemption is refused once its own GIT_* clearing is gone.
#
# The helper, under the environment `git commit` gives a hook in a linked worktree (GIT_DIR and
# GIT_INDEX_FILE, measured 2026-09-24), on a disposable main + worktree pair:
# - a script that does not source it rewrites the shared config, which proves the harness can see
#   the damage;
# - one that does leaves the config and the branch alone.
# shellcheck disable=SC2016 # the fixtures below are literal scripts, expanded where they run
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/git-isolation.bash
source "$repo_root/scripts/lib/git-isolation.bash"
check="$repo_root/scripts/check-git-isolation.py"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# --- the check ---
mkdir -p "$work/files/crates/strategy_factory/tools"
cd "$work/files"
printf '#!/usr/bin/env bash\nd=$(mktemp -d)\ngit init -q "$d"\n' > bare-init.bash
printf '#!/usr/bin/env bash\nsource "$(dirname "$0")/lib/git-isolation.bash"\ngit init -q "$1"\n' > sourced.bash
printf '#!/usr/bin/env bash\n# git init would re-initialise the caller here\n' > comment.bash
printf 'import subprocess\nsubprocess.run(["git", "init", "-q"], check=True)\n' > bare-init.py
printf 'from git_isolation import init_fixture_repository\nimport subprocess\nsubprocess.run(["git", "init"])\n' > imported.py
cp "$repo_root/crates/strategy_factory/tools/seal-program.sh" crates/strategy_factory/tools/seal-program.sh

for file in bare-init.bash bare-init.py; do
  if err="$(python3 "$check" "$file" 2>&1)"; then fail "the check passed $file"; fi
  [[ "$err" == *"ERROR: $file:"* ]] || fail "the check did not name $file: $err"
done
python3 "$check" sourced.bash imported.py comment.bash crates/strategy_factory/tools/seal-program.sh ||
  fail "the check refused an isolated script, a comment or the intact exemption"
python3 - crates/strategy_factory/tools/seal-program.sh << 'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
line = 'GIT_*) unset "$name" ;;'
assert line in text, "the exemption's clearing line moved; update SELF_CONTAINED"
path.write_text(text.replace(line, ":"))
PY
if err="$(python3 "$check" crates/strategy_factory/tools/seal-program.sh 2>&1)"; then
  fail "the check passed seal-program.sh with its GIT_* clearing removed"
fi
[[ "$err" == *"seal-program.sh: lost its own GIT_* clearing"* ]] || fail "the exemption refusal did not say why: $err"

# --- the helper, under a hook's environment ---
git init -q --initial-branch=main "$work/shared"
git -C "$work/shared" -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m base
git -C "$work/shared" worktree add -q "$work/linked" -b linked
hook_git_dir="$(git -C "$work/linked" rev-parse --absolute-git-dir)"
config="$work/shared/.git/config"
branch_before="$(git -C "$work/shared" rev-parse linked)"
state() { echo "bare=$(git config --file "$config" core.bare) user=$(git config --file "$config" user.email || echo none) linked=$(git -C "$work/shared" rev-parse linked)"; }
clean="bare=false user=none linked=$branch_before"
[[ "$(state)" == "$clean" ]] || fail "the disposable repository did not start clean: $(state)"
as_hook() { (cd "$work/linked" && env GIT_DIR="$hook_git_dir" GIT_INDEX_FILE="$hook_git_dir/index" bash "$@"); }

mkdir "$work/unisolated" "$work/isolated"
printf 'cd "$1"\ngit init -q .\ngit config user.email fixture@example.invalid\n' > "$work/unisolated.bash"
as_hook "$work/unisolated.bash" "$work/unisolated" > /dev/null 2>&1 || true
[[ "$(state)" == *"bare=true"* ]] || fail "without the helper the shared config stayed clean, so this harness sees nothing: $(state)"
git config --file "$config" core.bare false
git config --file "$config" --unset user.email || true
[[ "$(state)" == "$clean" ]] || fail "could not restore the disposable repository: $(state)"

printf 'source "%s"\ninit_fixture_repository "$1"\n' "$repo_root/scripts/lib/git-isolation.bash" > "$work/isolated.bash"
as_hook "$work/isolated.bash" "$work/isolated" || fail "init_fixture_repository failed under a hook's environment"
[[ "$(state)" == "$clean" ]] || fail "with the helper the shared repository still changed: $(state)"
[[ "$(git -C "$work/isolated" config user.email)" == fixture@example.invalid ]] || fail "the fixture got no identity"

echo "ok: the check refuses un-isolated git by name, and the helper keeps a hook off the caller's repository"
