#!/bin/sh
# Start the trade IDE service on a read-only copy of the public DoltHub databases.
#
# First start: clone both databases into /data (the market is several GB), create the service's
# accounts and write its files. Every start: run Dolt's sql-server on the copy, with the ledger's
# commit verification group the product requires of any service, then start the chat service and serve the page. The ledger
# profile names no lifecycle (kind null), so the product never publishes from here, and the service
# file holds only reader accounts; the administrator password is used only by trade-ide-pull.
set -eu

RESEARCH_REMOTE=${RESEARCH_REMOTE:-https://doltremoteapi.dolthub.com/vincent/trade-research}
MARKET_REMOTE=${MARKET_REMOTE:-https://doltremoteapi.dolthub.com/vincent/trade-market}
SERVICE=/data/dolt
PROFILES=$TRADE_LEDGER_HOME
mkdir -p "$SERVICE/data" "$SERVICE/cfg" "$DOLT_ROOT_PATH" "$PROFILES"
chmod 700 "$SERVICE" "$PROFILES"

if [ ! -f "$DOLT_ROOT_PATH/.dolt/config_global.json" ]; then
  dolt config --global --add user.name "Research graph copy"
  dolt config --global --add user.email "trade-ide@example.invalid"
fi
clone() {  # database remote
  if [ ! -d "$SERVICE/data/$1/.dolt" ]; then
    echo "cloning $2 into $1 (first start)" >&2
    rm -rf "$SERVICE/data/$1.partial"
    (cd "$SERVICE/data" && dolt clone "$2" "$1.partial" && mv "$1.partial" "$1")
  fi
}
clone research "$RESEARCH_REMOTE"
clone market "$MARKET_REMOTE"

cat > "$SERVICE/config.yaml" <<YAML
log_level: warning
behavior:
  autocommit: true
listener:
  host: 127.0.0.1
  port: 3306
  socket: $SERVICE/mysql.sock
data_dir: $SERVICE/data
cfg_dir: $SERVICE/cfg
privilege_file: $SERVICE/cfg/privileges.db
branch_control_file: $SERVICE/cfg/branch_control.db
YAML

rm -f "$SERVICE/mysql.sock"  # left by an earlier container on this volume; only this one serves it
(cd "$SERVICE" && exec dolt sql-server --config "$SERVICE/config.yaml" >>"$SERVICE/server.log" 2>&1) &
for _ in $(seq 1 300); do
  [ -S "$SERVICE/mysql.sock" ] && dolt --host 127.0.0.1 --port 3306 --no-tls --user root \
    --password "$(cat "$SERVICE/admin.password" 2>/dev/null || true)" sql -q "SELECT 1" >/dev/null 2>&1 && break
  sleep 0.2
done

if [ ! -f "$SERVICE/service.json" ]; then
  python3 - "$SERVICE" <<'PY'
import json, os, secrets, subprocess, sys
service = sys.argv[1]
admin = secrets.token_urlsafe(24)
accounts = {db: {"reader": {"user": f"{db}_reader", "password": secrets.token_urlsafe(24)}} for db in ("research", "market")}
statements = [f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{admin}'"]
for db, roles in accounts.items():
    reader = roles["reader"]
    statements += [f"CREATE USER IF NOT EXISTS '{reader['user']}'@'%' IDENTIFIED BY '{reader['password']}'",
                   f"GRANT SELECT ON `{db}`.* TO '{reader['user']}'@'%'"]
subprocess.run(["dolt", "--host", "127.0.0.1", "--port", "3306", "--no-tls", "--user", "root", "--password", "",
                "sql", "-q", ";\n".join(statements)], check=True, stdout=subprocess.DEVNULL)
def private(name, text):
    with open(os.open(os.path.join(service, name), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
        stream.write(text)
private("admin.password", admin)
private("service.json", json.dumps({"binary": "/usr/local/bin/dolt", "socket": f"{service}/mysql.sock", "port": 3306,
                                    "databases": accounts, "secured": True}, indent=2))
PY
fi
dolt --host 127.0.0.1 --port 3306 --no-tls --user root --password "$(cat "$SERVICE/admin.password")" \
  sql -q "SET PERSIST dolt_commit_verification_groups = 'commit'" >/dev/null

cat > "$PROFILES/research.json" <<JSON
{"name": "research", "holds": "research", "kind": null, "database": "research", "service": "$SERVICE",
 "research_branch": "main"}
JSON
cat > "$PROFILES/market.json" <<JSON
{"name": "market", "kind": "market", "database": "market", "service": "$SERVICE"}
JSON

# The chat service listens inside the container only; the page reaches it through serve's /api/agent/.
# Its agents (with their API keys) and threads stay in the volume, never in a database.
mkdir -p /data/agent && chmod 700 /data/agent
node /opt/trade/services/ide/agent/src/main.ts --product=/opt/trade --ledger=research --market=market \
  --data=/data/agent --host=127.0.0.1 --port=8766 &

exec python3 /opt/trade/services/ide/ide.py serve --ledger=research --product=/opt/trade \
  --host=0.0.0.0 --port=8765 --allow-host="127.0.0.1:${PUBLISHED_PORT:-8765}" \
  --allow-host="localhost:${PUBLISHED_PORT:-8765}" --pull=/usr/local/bin/trade-ide-pull \
  --agent=http://127.0.0.1:8766 "$@"
