#!/bin/sh
# Start the trade IDE service on the compose ledger service (docs/plans/ide-reads-ledger-service.zh.md).
#
# The ledger and market profiles under $TRADE_LEDGER_HOME are compose configs. They name the
# reader-only service file ledger writes (the port and the reader accounts: no root password, no
# writer) and no lifecycle (kind null), and the service is reached at $TRADE_DOLT_HOST, so nothing in
# this container can write or publish. Start the chat service, then serve the page.
set -eu

# The chat service listens inside the container only; the page reaches it through serve's /api/agent/.
# Its agents (with their API keys) and threads stay in the volume, never in a database.
mkdir -p /data/agent && chmod 700 /data/agent
node /opt/trade/ide/agent/src/main.ts --product=/opt/trade --ledger=research --market=market \
  --data=/data/agent --host=127.0.0.1 --port=8766 &

exec python3 /opt/trade/ide/ide.py serve --ledger=research --product=/opt/trade \
  --host=0.0.0.0 --port=8765 --allow-host="127.0.0.1:${PUBLISHED_PORT:-8765}" \
  --allow-host="localhost:${PUBLISHED_PORT:-8765}" --agent=http://127.0.0.1:8766 "$@"
