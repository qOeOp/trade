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
  local status=0 holder

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
    return 0
  fi

  exec 9>&-
  if [[ "$status" -ne 1 ]]; then
    echo "ERROR: could not take the local Owner chain lock at ${owner_chain_lock_file}." >&2
    return 1
  fi
  holder="$(cat "$owner_chain_lock_file" 2> /dev/null || true)"
  echo "ERROR: another local Owner chain is running on this machine: ${holder:-holder not recorded}." >&2
  echo "       One chain at a time: overlapping chains load the machine until entries with a time" >&2
  echo "       window fail for load alone. Run again once that pid has exited." >&2
  echo "       Lock: ${owner_chain_lock_file}" >&2
  return 1
}
