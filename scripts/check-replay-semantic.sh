#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT/modules/research-strategy-development/replay-execution-plane/runner"

sh "$ROOT/scripts/run-exclusive-test.sh" \
  replay-runner-heavyweight \
  env REPLAY_TEST_PROFILE=1 \
  bun test ./src/lib/replay-decision-worker-input-assembly-v4.test.ts
