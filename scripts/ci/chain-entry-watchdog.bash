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

# Every process below `$1`, depth first.
chain_entry_descendants() {
  local child
  for child in $(pgrep -P "$1" 2> /dev/null); do
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
  chain_entry_signal_descendants "$chain_entry_watchdog_pid" TERM ''
  kill -TERM "$chain_entry_watchdog_pid" 2> /dev/null || true
  wait "$chain_entry_watchdog_pid" 2> /dev/null || true
  chain_entry_watchdog_pid=''
}

# arm_chain_entry_watchdog <seconds> <record-file> <description>
#
# Replaces any watchdog still armed. The record file is written only if the limit is reached.
arm_chain_entry_watchdog() {
  local seconds="$1" record="$2" description="$3" chain="$$"
  disarm_chain_entry_watchdog
  (
    # A subshell inherits the chain's traps; this one must never run the chain's cleanup.
    trap - EXIT ERR
    set +e
    sleep "$seconds"
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
