#!/usr/bin/env bash
# Build replay/ in a disposable root and replay every job from xcheck/export.py through the repository's
# BacktestEngine. Outputs land in xcheck/out/; the build root is removed on exit.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPLAY="$(cd "$HERE/../replay" && pwd)"
df -h /tmp | tail -1
ROOT_DIR="$(mktemp -d)"
cleanup() {
  jobs -p | xargs -r kill 2> /dev/null || true
  wait || true
  rm -rf "$ROOT_DIR"
  [ ! -e "$ROOT_DIR" ] && echo "removed $ROOT_DIR"
  df -h /tmp | tail -1
}
trap cleanup EXIT HUP INT TERM
export CARGO_TARGET_DIR="$ROOT_DIR/target"
export CARGO_INCREMENTAL=0
(cd "$REPLAY" && cargo build --release)
BIN="$CARGO_TARGET_DIR/release/engine-replay"
mkdir -p "$HERE/out"
while read -r key bars; do
  "$BIN" "$HERE/work/$bars" "$HERE/work/$key.json" "$key" 0 "$HERE/out/$key.csv" 2> "$HERE/out/$key.log" || echo "FAILED $key"
  echo "done $key"
done < "$HERE/work/jobs.txt"
