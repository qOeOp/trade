#!/usr/bin/env bash
# LANE8 PROBE, NOT FOR MERGE. A nextest target runner that loads the stack-peak shim into the test and
# prints what it recorded for this entry as soon as the test ends, so a chain that stops early still
# reports every entry it ran.
env LD_PRELOAD="${LANE8_STACK_SHIM:?}" "$@"
status=$?
awk -F'\t' -v entry="${LANE8_ENTRY:-?}" '$1 == entry {
  printf "LANE8-STACK-LIVE entry=%s peak_kib=%s stack_kib=%s thread=%s\n", $1, $3, $4, $2
}' "${LANE8_STACK_LOG:?}" >&2
exit "$status"
