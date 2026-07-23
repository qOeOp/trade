#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT/modules/research-strategy-development/replay-execution-plane/runner"

bun run test:worker-v10
