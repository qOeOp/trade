# Sourced by scripts/ci/test-rd-owner-postgres.bash and crates/data/tests/run_market_data_owner_postgres.bash.
# One local Owner chain per machine, whichever chain it is.
#
# Several lanes share one machine, and when their chains overlapped the load average sat near 100
# and reached 250. Entries whose assertions carry a time window then failed for load alone - entry
# 10's expiry at now+500ms, entry 84's valid_through, entry 35's WindowNotCurrent, entry 28's 8000ms
# - and each such failure costs a lane an investigation into nothing. "Only one chain at a time" was
# a rule each run had to remember to keep; this makes the second run refuse on its own and name the
# run it is waiting for.
#
# The lock is flock(2) on one path every worktree names the same way, held on descriptor 9. The
# kernel drops it when the last process holding that descriptor exits, so a killed run leaves no
# stale lock behind. It also means a child that outlives the script - one that inherited descriptor
# 9 - keeps holding it, which is right: that child is still load. macOS ships no flock(1), so perl
# makes the one system call on the inherited descriptor; the lock belongs to the open file, which
# this shell keeps open after perl exits.
#
# Hosted CI does not take it: a runner runs one job, and nothing else there contends.

owner_chain_lock_file="${OWNER_CHAIN_LOCK_FILE:-/tmp/vibe-owner-chain.lock}"

# Returns 0 holding the lock on descriptor 9, or 1 after naming the run that holds it.
acquire_owner_chain_lock() {
  local status=0 holder recorded_pid

  # `>>`, not `>`: opening must not truncate the holder's record before the lock is even tried.
  exec 9>> "$owner_chain_lock_file"
  perl -MFcntl=:flock -e '
    open(my $fh, ">>&=", 9) or do { print STDERR "descriptor 9: $!\n"; exit 2 };
    flock($fh, LOCK_EX | LOCK_NB) and exit 0;
    $!{EWOULDBLOCK} and exit 1;
    print STDERR "flock: $!\n";
    exit 2;
  ' || status=$?

  if [[ "$status" -eq 0 ]]; then
    printf 'pid %s, since %s, in %s at %s\n' \
      "$$" "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$PWD" \
      "$(git rev-parse --short HEAD 2> /dev/null || echo 'no git')" > "$owner_chain_lock_file"
    reap_orphaned_owner_chain_containers
    return 0
  fi

  exec 9>&-
  if [[ "$status" -ne 1 ]]; then
    echo "ERROR: could not take the local Owner chain lock at ${owner_chain_lock_file}." >&2
    return 1
  fi
  holder="$(cat "$owner_chain_lock_file" 2> /dev/null || true)"
  recorded_pid="$(sed -n 's/^pid \([0-9][0-9]*\),.*/\1/p' <<< "$holder")"

  # The record names the run that took the lock, not whoever holds it now. When that run is gone,
  # the holder is a process that inherited descriptor 9 from it - after a run is killed, typically
  # the proof watchdog's `sleep` - and waiting for the recorded pid to exit waits for nothing.
  if [[ -n "$recorded_pid" ]] && ! kill -0 "$recorded_pid" 2> /dev/null; then
    echo "ERROR: the local Owner chain recorded in the lock has exited (${holder}), but the lock is" >&2
    echo "       still held by a process that inherited its descriptor 9:" >&2
    list_owner_chain_lock_holders >&2
    echo "       It is still load while it runs; stop it if its run is gone for good. To wait for the" >&2
    echo "       lock, probe the lock itself (flock with LOCK_NB on the file), not the recorded pid." >&2
    echo "       Lock: ${owner_chain_lock_file}" >&2
    return 1
  fi
  echo "ERROR: another local Owner chain is running on this machine: ${holder:-holder not recorded}." >&2
  echo "       One chain at a time: overlapping chains load the machine until entries with a time" >&2
  echo "       window fail for load alone. Run again once that run has exited; a process it started" >&2
  echo "       holds the lock too, until it exits as well." >&2
  echo "       Lock: ${owner_chain_lock_file}" >&2
  return 1
}

# Names every process holding the lock file open for writing, which is every process that can hold
# the lock: descriptor 9 is opened for appending, and a descriptor only reading the file cannot.
list_owner_chain_lock_holders() {
  if ! command -v lsof > /dev/null 2>&1; then
    echo "       (lsof is not installed, so the holder cannot be named here)"
    return 0
  fi
  lsof -F pcfa "$owner_chain_lock_file" 2> /dev/null | awk '
    /^p/ { pid = substr($0, 2) }
    /^c/ { command = substr($0, 2) }
    /^f/ { descriptor = substr($0, 2) }
    /^a/ { if ($0 ~ /^a[wu]/) print "       pid " pid " (" command "), descriptor " descriptor }
  '
}

# A chain removes its containers in its EXIT trap, so a run that is killed outright - SIGKILL, a
# closed terminal, a crashed agent - leaves them running, each holding a PostgreSQL and a volume.
# They were found by hand, a dozen at a time. Whoever holds the lock is by definition the only chain
# on this machine, so every chain container whose run has exited is an orphan; the holder removes
# them before it starts its own.
#
# Both chains end their names with the pid of the script that made them:
# vibe-rd-owner-{test,impersonator}-<random>-<pid> (containers and volumes) and
# vibe-md-d1-<ppid>-<pid> (containers only). A name whose pid is alive is left alone. That includes
# a reused pid, which only ever spares an orphan, never removes a live chain. `ps -p`, not `kill -0`:
# kill -0 fails for a process of another user, which would read a live run as dead.
#
# A container kept on purpose to inspect a failed run survives in either of two ways. It can carry
# the label vibe.keep=1, set when it was created, since Docker cannot label an existing container.
# Or it can be renamed with a -keep suffix: `docker rename <name> <name>-keep`. A kept container
# keeps its volume mounted, and only volumes nothing mounts are removed.
reap_orphaned_owner_chain_containers() {
  local docker="${OWNER_CHAIN_DOCKER:-docker}" name keep pid containers volumes

  if ! containers="$("$docker" ps --all --filter 'name=^vibe-rd-owner-' --filter 'name=^vibe-md-d1-' \
    --format '{{.Names}}	{{.Label "vibe.keep"}}' 2> /dev/null)"; then
    echo "owner chain cleanup: docker did not answer; leaving any orphaned chain containers in place" >&2
    return 0
  fi
  while IFS=$'\t' read -r name keep; do
    [[ -n "$name" ]] || continue
    if [[ "$keep" == 1 || "$name" == *-keep ]]; then
      echo "owner chain cleanup: skipping ${name}: keep marker" >&2
      continue
    fi
    pid="${name##*-}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    ps -p "$pid" > /dev/null 2>&1 && continue
    echo "owner chain cleanup: removing ${name}: its run, pid ${pid}, has exited" >&2
    "$docker" rm --force "$name" > /dev/null ||
      echo "owner chain cleanup: could not remove ${name}" >&2
  done <<< "$containers"

  volumes="$("$docker" volume ls --quiet --filter dangling=true --filter 'name=^vibe-rd-owner-' 2> /dev/null)" ||
    return 0
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    pid="${name##*-}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    ps -p "$pid" > /dev/null 2>&1 && continue
    echo "owner chain cleanup: removing volume ${name}: its run, pid ${pid}, has exited" >&2
    "$docker" volume rm "$name" > /dev/null ||
      echo "owner chain cleanup: could not remove volume ${name}" >&2
  done <<< "$volumes"
  return 0
}
