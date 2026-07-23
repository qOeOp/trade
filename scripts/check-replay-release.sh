#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun scripts/check-rd-replay-maturity-gate.ts
bun modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/scripts/main.ts --suite all
