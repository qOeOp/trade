#!/usr/bin/env bash
# Exercises chain-entry-watchdog.bash in both directions, in a child shell shaped like the chain
# (`set -Eeuo pipefail`, an EXIT trap that reports where it stopped): an entry that outruns its limit
# is stopped, named on stderr and in its own record, and the cleanup still runs; an entry that
# finishes inside its limit is left alone and leaves no record. A watchdog that never fires and one
# that fires on everything would each pass half.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG="${SCRIPT_DIR}/chain-entry-watchdog.bash"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

run_chain_like() {
  # $1 = the entry's command, $2 = the limit in seconds
  bash -c '
    set -Eeuo pipefail
    source "$1"
    trap '"'"'status=$?; disarm_chain_entry_watchdog; echo "cleanup ran, status ${status}" > "$2/cleanup"'"'"' EXIT
    arm_chain_entry_watchdog "$4" "$2/007.timeout" "ordered chain entry 7/9 (a test entry)"
    eval "$3"
    disarm_chain_entry_watchdog
  ' _ "$WATCHDOG" "$test_root" "$1" "$2"
}

start=$SECONDS
if run_chain_like 'sleep 60' 2 2> "${test_root}/stderr"; then
  echo "FAIL: an entry that outran its limit ended the chain successfully" >&2
  exit 1
fi
elapsed=$((SECONDS - start))
if [[ "$elapsed" -ge 30 ]]; then
  echo "FAIL: the hung entry was not stopped near its limit (took ${elapsed}s against 2s)" >&2
  exit 1
fi
if ! grep -q "ordered chain entry 7/9 (a test entry) ran past its 2s wall-clock limit" "${test_root}/007.timeout" 2> /dev/null; then
  echo "FAIL: the stopped entry left no record naming it" >&2
  exit 1
fi
if ! grep -q "ERROR: ordered chain entry 7/9 (a test entry) ran past its 2s" "${test_root}/stderr"; then
  echo "FAIL: stderr did not name the stopped entry:" >&2
  cat "${test_root}/stderr" >&2
  exit 1
fi
if ! grep -q "^cleanup ran, status [1-9]" "${test_root}/cleanup" 2> /dev/null; then
  echo "FAIL: the chain's cleanup did not run after the entry was stopped" >&2
  exit 1
fi

rm -f "${test_root}/007.timeout" "${test_root}/cleanup"
if ! run_chain_like 'sleep 1' 5 2> "${test_root}/stderr"; then
  echo "FAIL: an entry that finished inside its limit was stopped:" >&2
  cat "${test_root}/stderr" >&2
  exit 1
fi
sleep 6
if [[ -e "${test_root}/007.timeout" ]]; then
  echo "FAIL: a disarmed watchdog still fired and wrote a record" >&2
  exit 1
fi

echo "chain-entry-watchdog: an entry past its limit is stopped by name with a record and cleanup; one inside it is left alone"
