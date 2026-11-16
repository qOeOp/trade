#!/bin/sh
# Start the trade IDE service on the compose ledger service (docs/plans/ide-reads-ledger-service.zh.md).
#
# The ledger and market profiles under $TRADE_LEDGER_HOME are compose configs. They name the
# reader-only service file ledger writes (the port and the reader accounts: no root password, no
# writer) and no lifecycle (kind null), and the service is reached at $TRADE_DOLT_HOST, so nothing in
# this container can write or publish. Start the chat service and the Market page's overview, then
# serve the page.
set -eu

# Keep one background service running: nothing else in the container restarts it (doctor 20261116-02, the kernel
# killed the overview on a memory limit and the Market page answered 502 until the container restarted). A run
# shorter than a minute doubles the pause before the next, up to a minute. serve stays the main process, so stopping
# the container stops it, and these loops end with it.
supervise() {
  name=$1
  shift
  pause=1
  while :; do
    started=$(date +%s)
    status=0
    "$@" || status=$?
    if [ $(($(date +%s) - started)) -ge 60 ]; then pause=1; fi
    echo "trade-ide-entrypoint: $name exited with status $status; restarting in ${pause}s" >&2
    sleep "$pause"
    if [ "$pause" -lt 60 ]; then pause=$((pause * 2)); fi
  done
}

# The chat service listens inside the container only; the page reaches it through serve's /api/agent/.
# Its agents (with their API keys) and threads stay in the volume, never in a database.
if [ "${TRADE_IDE_CHAT:-1}" = 1 ]; then
  mkdir -p /data/agent && chmod 700 /data/agent
  supervise chat node /opt/trade/ide/agent/src/main.ts --product=/opt/trade --ledger=research --market=market \
    --data=/data/agent --host=127.0.0.1 --port=8766 &
  set -- --agent=http://127.0.0.1:8766 "$@"
fi

# The Market page's data: free public market endpoints read without any credential, kept in memory only.
supervise overview node /opt/trade/ide/overview/src/main.ts --host=127.0.0.1 --port=8768 &

exec python3 /opt/trade/ide/ide.py serve --ledger=research --market=market --product=/opt/trade \
  --host=0.0.0.0 --port=8765 --allow-host="127.0.0.1:${PUBLISHED_PORT:-8765}" \
  --allow-host="localhost:${PUBLISHED_PORT:-8765}" --overview=http://127.0.0.1:8768 "$@"
