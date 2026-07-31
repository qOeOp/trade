#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun -e 'import { readFileSync } from "node:fs"; const root = JSON.parse(readFileSync("package.json", "utf8")); if (root.packageManager !== `bun@${Bun.version}`) { console.error(`replay-release: expected ${root.packageManager}, got bun@${Bun.version}`); process.exit(1) }'
bun scripts/check-rd-replay-maturity-gate.ts
bun apps/research-strategy-development/replay-execution-plane/certification/replay-certification/src/scripts/main.ts --suite all
