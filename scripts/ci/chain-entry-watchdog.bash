# Sourced by the ordered Owner chains - scripts/ci/test-rd-owner-postgres.bash and
# crates/data/tests/run_market_data_owner_postgres.bash. A wall clock on each chain entry.
#
# Run 35900267592 (#912) sat in the R&D chain for 71 minutes against a usual 33 and was cancelled by
# hand. A cancelled job keeps neither its log nor its artifact, so nobody could say which entry had
# hung. nextest already stops a hung *test* at ten minutes and names it; what nothing stopped was an
# entry hung outside a test - a fault-injection psql, a docker exec, nextest itself.
#
# So each entry runs under a watchdog. When it fires it writes a record naming the entry into the
# chain-records directory, says the same on stderr, and stops what the chain is running. The chain
# then fails the way any failed entry does: its cleanup names where the run stopped, keeps the
# records, and the job's `always()` upload publishes them. A hang becomes a named, ordinary failure
# instead of a job that runs until the runner gives up and takes the evidence with it.

chain_entry_watchdog_pid=''
# A file that exists while the armed watchdog may still fire. Firing and disarming each claim it
# atomically before acting - the watchdog renames it, disarm removes it - so exactly one of them owns
# the outcome. Without it, disarming woke the watchdog's `sleep` before stopping the watchdog itself,
# and on a loaded machine the watchdog could run on and write a timeout record (and signal the chain)
# for an entry that had already finished: 4 of 500 disarms at a load of 64, on 2026-09-24.
chain_entry_watchdog_token=''

# Every process below `$1`, depth first. `pgrep` exits 1 when a process has no children, which is
# every leaf; left as a failing command substitution under the chains' `set -E`, that fired their ERR
# trap and printed "this failed" twice for every entry. So exit 1 is an empty answer here, and any
# other failure - pgrep missing, bad arguments - is returned and still trips the trap.
chain_entry_descendants() {
  local children child status=0
  children="$(pgrep -P "$1" 2> /dev/null)" || status=$?
  if ((status > 1)); then
    return "$status"
  fi
  for child in $children; do
    echo "$child"
    chain_entry_descendants "$child"
  done
}

# Sends signal `$2` to everything below `$1` except the watchdog `$3` and what it runs itself.
chain_entry_signal_descendants() {
  local parent="$1" signal="$2" watchdog="$3" pid
  local -a spared
  read -r -d '' -a spared < <(
    echo "$watchdog"
    chain_entry_descendants "$watchdog"
  ) || true
  for pid in $(chain_entry_descendants "$parent"); do
    [[ " ${spared[*]} " == *" ${pid} "* ]] && continue
    kill "-${signal}" "$pid" 2> /dev/null || true
  done
}

disarm_chain_entry_watchdog() {
  [[ -n "$chain_entry_watchdog_pid" ]] || return 0
  local -a children
  # Claim first: once the token is gone the watchdog can no longer fire, whatever it is doing.
  rm -f -- "$chain_entry_watchdog_token"
  # Then stop the watchdog before its children, so waking its `sleep` cannot let it run on.
  read -r -d '' -a children < <(chain_entry_descendants "$chain_entry_watchdog_pid") || true
  kill -TERM "$chain_entry_watchdog_pid" 2> /dev/null || true
  if ((${#children[@]})); then
    kill -TERM "${children[@]}" 2> /dev/null || true
  fi
  wait "$chain_entry_watchdog_pid" 2> /dev/null || true
  chain_entry_watchdog_pid=''
  chain_entry_watchdog_token=''
}

# arm_chain_entry_watchdog <seconds> <record-file> <description>
#
# Replaces any watchdog still armed. The record file is written only if the limit is reached.
arm_chain_entry_watchdog() {
  local seconds="$1" record="$2" description="$3" chain="$$" token
  disarm_chain_entry_watchdog
  token="$(mktemp "${TMPDIR:-/tmp}/chain-entry-watchdog.XXXXXX")"
  chain_entry_watchdog_token="$token"
  (
    # A subshell inherits the chain's traps; this one must never run the chain's cleanup.
    trap - EXIT ERR
    set +e
    sleep "$seconds"
    # Rename is atomic: if disarm removed the token first, this fails and the watchdog stands down.
    mv -- "$token" "$token.fired" 2> /dev/null || exit 0
    rm -f -- "$token.fired"
    message="${description} ran past its ${seconds}s wall-clock limit and was stopped"
    printf '%s\n' "$message" > "$record"
    echo "ERROR: ${message}." >&2
    chain_entry_signal_descendants "$chain" TERM "$BASHPID"
    # A child that ignores TERM is not allowed to keep the job alive either.
    sleep 30
    chain_entry_signal_descendants "$chain" KILL "$BASHPID"
  ) &
  chain_entry_watchdog_pid=$!
}
