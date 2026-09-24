#!/usr/bin/env bash
# Exercises reap_orphaned_owner_chain_containers against a stand-in `docker` that serves a fixed
# listing and records what it is asked to remove. Every kind of name the function must tell apart
# appears once, so a reaper that removes too much and one that removes too little both fail here:
# a dead run's RD and MD containers and its unmounted volume go; a live run's container and volume,
# a keep-labelled container, a -keep renamed one and an unrelated name stay.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_SCRIPT="${OWNER_CHAIN_LOCK_SCRIPT:-${SCRIPT_DIR}/owner-chain-lock.bash}"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

# A pid that has certainly exited: a child the test started and waited for.
sleep 0 &
dead=$!
wait "$dead"
if ps -p "$dead" > /dev/null 2>&1; then
  echo "FAIL: the pid chosen as dead ($dead) is alive again; rerun" >&2
  exit 1
fi
live=$$

cat > "${test_root}/docker" << EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "ps --all")
    printf '%s\t%s\n' \\
      "vibe-rd-owner-test-aaaa-${dead}" "" \\
      "vibe-rd-owner-impersonator-aaaa-${dead}" "" \\
      "vibe-md-d1-1-${dead}" "" \\
      "vibe-rd-owner-test-bbbb-${live}" "" \\
      "vibe-rd-owner-test-cccc-${dead}" "1" \\
      "vibe-rd-owner-test-dddd-${dead}-keep" ""
    ;;
  "volume ls")
    # Only unmounted volumes when asked for them: the kept container's volume is mounted, so a
    # reaper that drops the dangling filter would be handed it, and remove it.
    printf '%s\n' "vibe-rd-owner-test-aaaa-${dead}" "vibe-rd-owner-test-bbbb-${live}"
    case " \$* " in *" dangling=true "*) ;; *) echo "vibe-rd-owner-test-cccc-${dead}" ;; esac
    ;;
  "rm --force") echo "container \$3" >> "${test_root}/removed" ;;
  "volume rm") echo "volume \$3" >> "${test_root}/removed" ;;
  *) echo "unexpected docker call: \$*" >&2; exit 9 ;;
esac
EOF
chmod +x "${test_root}/docker"
touch "${test_root}/removed"

OWNER_CHAIN_DOCKER="${test_root}/docker" bash -c 'source "$1" && reap_orphaned_owner_chain_containers' \
  _ "$LOCK_SCRIPT" 2> "${test_root}/said"

expected="$(printf '%s\n' \
  "container vibe-md-d1-1-${dead}" \
  "container vibe-rd-owner-impersonator-aaaa-${dead}" \
  "container vibe-rd-owner-test-aaaa-${dead}" \
  "volume vibe-rd-owner-test-aaaa-${dead}")"
actual="$(sort "${test_root}/removed")"
if [[ "$actual" != "$expected" ]]; then
  echo "FAIL: removed the wrong set." >&2
  echo "expected:" >&2
  echo "$expected" >&2
  echo "actual:" >&2
  echo "$actual" >&2
  exit 1
fi
for kept in "vibe-rd-owner-test-cccc-${dead}" "vibe-rd-owner-test-dddd-${dead}-keep"; do
  if ! grep -qF "skipping ${kept}: keep marker" "${test_root}/said"; then
    echo "FAIL: ${kept} was spared without saying why:" >&2
    cat "${test_root}/said" >&2
    exit 1
  fi
done

# Docker absent or not answering: nothing is removed and the chain is not stopped here.
OWNER_CHAIN_DOCKER=false bash -c 'source "$1" && reap_orphaned_owner_chain_containers' \
  _ "$LOCK_SCRIPT" 2> "${test_root}/nodocker" || {
  echo "FAIL: an unanswering docker stopped the caller" >&2
  exit 1
}
grep -q 'docker did not answer' "${test_root}/nodocker" || {
  echo "FAIL: an unanswering docker was not reported" >&2
  exit 1
}

echo "owner-chain-reap: a dead run's RD and MD containers and unmounted volume are removed; live, kept and unrelated ones stay"
