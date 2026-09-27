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

# A watchdog whose token disarm has already claimed never fires, even once its own sleep runs out. The
# claim, not how quickly disarm's kills land, is what keeps a disarmed watchdog from writing a record,
# so this removes the token without killing anything and lets the limit pass.
rm -f "${test_root}/007.timeout"
claimed_status=0
bash -c '
  set -Eeuo pipefail
  source "$1"
  arm_chain_entry_watchdog 1 "$2/007.timeout" "ordered chain entry 7/9 (a claimed watchdog)"
  rm -f -- "$chain_entry_watchdog_token"
  sleep 3
  disarm_chain_entry_watchdog
' _ "$WATCHDOG" "$test_root" 2> "${test_root}/stderr" || claimed_status=$?
# The record is checked first: a watchdog that fires anyway also stops the entry, and that exit
# status alone would not say why.
if [[ -e "${test_root}/007.timeout" ]]; then
  echo "FAIL: a watchdog whose token was already claimed still fired and wrote a record" >&2
  exit 1
fi
if ((claimed_status != 0)); then
  echo "FAIL: the entry under a claimed watchdog ended with status ${claimed_status}:" >&2
  cat "${test_root}/stderr" >&2
  exit 1
fi

# A chain killed outright - SIGKILL, a closed terminal - leaves its armed watchdog asleep for up to its
# whole limit. The watchdog is not load, so it must not hold the machine's chain lock meanwhile: the
# lock would outlive the run by up to 900s, and the next chain would be refused and would not reap the
# dead run's containers. This takes the real lock, arms a long watchdog, kills the chain, and requires
# the lock to be free while the orphaned watchdog still sleeps.
LOCK_SCRIPT="${SCRIPT_DIR}/owner-chain-lock.bash"
export OWNER_CHAIN_LOCK_FILE="${test_root}/owner-chain.lock"
# Taking the lock also reaps orphaned chain containers; `true` lists none, so this never reaches Docker.
export OWNER_CHAIN_DOCKER=true
bash -c '
  source "$1"
  source "$2"
  acquire_owner_chain_lock
  arm_chain_entry_watchdog 300 "$3/008.timeout" "ordered chain entry 8/9 (an orphaned watchdog)"
  echo "$chain_entry_watchdog_pid" > "$3/watchdog"
  touch "$3/armed"
  exec sleep 300
' _ "$LOCK_SCRIPT" "$WATCHDOG" "$test_root" 2> "${test_root}/stderr" &
chain_pid=$!
for _ in $(seq 600); do
  [[ -e "${test_root}/armed" ]] && break
  sleep 0.1
done
watchdog_pid="$(cat "${test_root}/watchdog")"
kill -9 "$chain_pid"
wait "$chain_pid" 2> /dev/null || true
lock_status=0
if kill -0 "$watchdog_pid" 2> /dev/null; then
  bash -c 'source "$1" && acquire_owner_chain_lock' _ "$LOCK_SCRIPT" 2> "${test_root}/lock" || lock_status=$?
else
  lock_status=-1
fi
# Only the pids this test started: the orphaned watchdog and what it runs.
kill -TERM $(pgrep -P "$watchdog_pid") "$watchdog_pid" 2> /dev/null || true
if ((lock_status == -1)); then
  echo "FAIL: the orphaned watchdog had already exited, so the lock was not tested against it" >&2
  exit 1
fi
if ((lock_status != 0)); then
  echo "FAIL: the chain lock was still held after the chain was killed, by its sleeping watchdog:" >&2
  cat "${test_root}/lock" >&2
  exit 1
fi

echo "chain-entry-watchdog: an entry past its limit is stopped by name with a record and cleanup; one inside it is left alone; a claimed watchdog never fires;"
echo "                      an orphaned watchdog does not hold the chain lock"
