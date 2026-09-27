#!/usr/bin/env bash
# LANE8 PROBE, NOT FOR MERGE. A nextest target runner that loads the stack-peak shim into the test.
exec env LD_PRELOAD="${LANE8_STACK_SHIM:?}" "$@"
