#!/usr/bin/env bash
# LANE8 PROBE, NOT FOR MERGE. A nextest target runner that loads the stack-peak shim into the test and
# prints what it recorded for this entry as soon as the test ends, so a chain that stops early still
# reports every entry it ran. On a ref with `-gdb-` and `-e<entry>-<KiB>-`, that entry runs under gdb
# instead, which prints the faulting thread's frames when its stack overflows.
# nextest also calls the runner to list the binary's tests (`--list`); that call must run as it is.
if [[ " $* " != *" --list "* && "${GITHUB_REF_NAME:-}" == *-gdb-* &&
  "${GITHUB_REF_NAME:-}" =~ -e([0-9]+)-[0-9]+- && "${LANE8_ENTRY:-}" == "${BASH_REMATCH[1]}" ]]; then
  gdb -batch -nx -x "$(dirname "${BASH_SOURCE[0]}")/overflow-frames.py" --args "$@"
  exit 1
fi
env LD_PRELOAD="${LANE8_STACK_SHIM:?}" "$@"
status=$?
awk -F'\t' -v entry="${LANE8_ENTRY:-?}" '$1 == entry {
  printf "LANE8-STACK-LIVE entry=%s peak_kib=%s stack_kib=%s thread=%s\n", $1, $3, $4, $2
}' "${LANE8_STACK_LOG:?}" >&2
exit "$status"
