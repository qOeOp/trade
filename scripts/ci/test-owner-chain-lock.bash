#!/usr/bin/env bash
# Exercises owner-chain-lock.bash in both directions, on a lock file of its own: a second taker is
# refused and told who holds the lock, and once the holder dies the kernel has released it and a
# new taker gets it. A lock that never refuses and a lock that never releases would each pass half.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_SCRIPT="${SCRIPT_DIR}/owner-chain-lock.bash"

test_root="$(mktemp -d)"
holder_pid=""
cleanup() {
  [[ -z "$holder_pid" ]] || kill -9 "$holder_pid" 2> /dev/null || true
  rm -rf "$test_root"
}
trap cleanup EXIT

export OWNER_CHAIN_LOCK_FILE="${test_root}/owner-chain.lock"
# Taking the lock also reaps orphaned chain containers. A test must not reach this machine's real
# Docker - it would remove another lane's orphans - so the reaper talks to `true`, which lists nothing.
# test-owner-chain-reap.bash exercises the reaper itself.
export OWNER_CHAIN_DOCKER=true

take_lock() {
  bash -c 'source "$1" && acquire_owner_chain_lock' _ "$LOCK_SCRIPT"
}

# The holder becomes `sleep` in place, so the pid that holds descriptor 9 is the pid this test
# kills. A holder with a child would pass the descriptor on and keep the lock after its own death.
bash -c 'source "$1" && acquire_owner_chain_lock && touch "$2" && exec sleep 300' \
  _ "$LOCK_SCRIPT" "${test_root}/held" &
holder_pid=$!

# Wait on the condition, not a clock; the bound is only against a hang.
for _ in $(seq 600); do
  [[ -e "${test_root}/held" ]] && break
  kill -0 "$holder_pid" 2> /dev/null || {
    echo "FAIL: the first taker exited without the lock" >&2
    exit 1
  }
  sleep 0.1
done
[[ -e "${test_root}/held" ]] || {
  echo "FAIL: the first taker never took the lock" >&2
  exit 1
}

if take_lock 2> "${test_root}/refused"; then
  echo "FAIL: a second taker got the lock while the first still held it" >&2
  exit 1
fi
if ! grep -q "running on this machine: pid ${holder_pid}," "${test_root}/refused"; then
  echo "FAIL: the refusal did not name the holder, pid ${holder_pid}:" >&2
  cat "${test_root}/refused" >&2
  exit 1
fi

kill -9 "$holder_pid"
wait "$holder_pid" 2> /dev/null || true
holder_pid=""

if ! take_lock 2> "${test_root}/after"; then
  echo "FAIL: the lock was not released when its holder died:" >&2
  cat "${test_root}/after" >&2
  exit 1
fi

echo "owner-chain-lock: a second taker is refused and told the holder's pid; a dead holder releases it"
