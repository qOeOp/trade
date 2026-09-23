#!/usr/bin/env bash

# Every hook that can abort on a failing command must name the command that aborted it.
#
# These hooks assert with bare commands - `rg`, `grep`, `test`, `[[ ]]` - 176 of them across the
# twenty-three here. Under `set -e` a bare assertion that fails ends the script, and none of those
# forms prints anything on its own, so the author who tripped it saw an exit code and nothing else.
# Measured before this was added: injecting a single `false` into a hook produced exit 1, zero lines
# of stdout and zero lines of stderr.
#
# The fix is one line per hook, and `-E` is half of it: without `-E` the ERR trap is not inherited
# into a function body, and a hook whose assertions live inside functions reports nothing at all.
#
# This test does not read the hooks for the trap. It drives each one: a copy with `false` injected
# immediately after its `set` line must print a message naming a line number. A hook that has the
# text and does not report is the failure mode a text search cannot see.

set -Eeuo pipefail
trap 'echo "$(basename "${BASH_SOURCE[0]}"):${LINENO}: this check failed: ${BASH_COMMAND}" >&2' ERR

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

checked=0
exempt=()
failures=()

for hook in .pre-commit-hooks/*.sh; do
  name="$(basename "$hook")"
  case "$name" in
    test_*) continue ;;
  esac

  # A hook with no errexit cannot abort on a bare assertion, so it has nothing to report and needs
  # no trap. The exemption is derived from the file, not listed here: a list would go stale the day
  # someone adds `set -e` to one of them.
  if ! grep -q '^set -[A-Za-z]*e' "$hook"; then
    exempt+=("$name")
    continue
  fi

  copy="$work/$name"
  # After the trap, not after the `set` line. Injecting between them puts the failing command
  # before the trap exists, which reports nothing for every hook and reads as "none of them work"
  # rather than "the injection is in the wrong place".
  awk '
    !armed && /^trap .* ERR$/ {
      print
      # Inside a function, not at the top level. A top-level failure reports with or without `-E`,
      # so injecting one there would pass on a hook missing the half of the fix that matters: an
      # assertion inside a function reports only when the trap was inherited.
      print "__probe_failure_inside_a_function() { false; }"
      print "__probe_failure_inside_a_function"
      armed = 1
      next
    }
    { print }
    END { if (!armed) exit 3 }
  ' "$hook" > "$copy" || {
    failures+=("$name: has no ERR trap to inject after")
    continue
  }

  if ! grep -q '__probe_failure_inside_a_function$' "$copy"; then
    failures+=("$name: could not inject a failing command after its set line")
    continue
  fi

  observed="$(bash "$copy" 2>&1 > /dev/null || true)"
  checked=$((checked + 1))

  if [[ "$observed" != *": this check failed: false"* ]]; then
    failures+=("$name: a failing bare command produced no report")
    continue
  fi
  if ! [[ "$observed" =~ :[0-9]+:\ this\ check\ failed: ]]; then
    failures+=("$name: reported a failure without a line number")
  fi
done

if [[ "${#failures[@]}" -gt 0 ]]; then
  echo "ERROR: these hooks abort without saying which command aborted them:" >&2
  for failure in "${failures[@]}"; do
    echo "       $failure" >&2
  done
  echo "       Add '-E' to the set line and an ERR trap under it. '-E' is not optional: without" >&2
  echo "       it the trap never reaches an assertion inside a function." >&2
  exit 1
fi

if [[ "$checked" -eq 0 ]]; then
  echo "ERROR: no hook was driven, so this test proved nothing." >&2
  echo "       That is the shape a broken enumeration has, not the shape this repository has." >&2
  exit 1
fi

echo "Every one of the $checked hooks that can abort names the command that aborted it"
if [[ "${#exempt[@]}" -gt 0 ]]; then
  echo "(${#exempt[@]} without errexit are exempt by construction: ${exempt[*]})"
fi
