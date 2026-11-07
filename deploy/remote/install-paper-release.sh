#!/bin/sh
# Install reviewed release-control code; only Paper router is created during initial wiring.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Install as the deployment administrator'; exit 1; }
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ -f /var/lib/trade-release/router/active.json ] || { echo 'Install Web continuous delivery first'; exit 1; }
[ ! -f /var/lib/trade-release/paper-router/active.json ] || { echo 'Paper routing already installed; use reviewed control-code upgrades'; exit 1; }
systemctl stop trade-release.timer
release_state=$(systemctl show trade-release.service -p ActiveState --value)
if [ "$release_state" != inactive ] && [ "$release_state" != failed ]; then
  systemctl start trade-release.timer
  echo 'Wait for the in-flight release to finish before installing control code'; exit 1
fi
# Verify the actual legacy image uses the shared protocol before claiming it can be drained.
docker exec trade-ide-paper-1 python -c 'import inspect; from paper import recovery,runs; s=inspect.getsource(recovery.operation); assert "paper-lifecycle" in s and "GET_LOCK(%s, %s)" in s; assert all(hasattr(f,"__wrapped__") for f in (runs.start,runs.request_stop,runs.stop,runs.seal))'
for module in __init__ release release_host runtime_inputs paper_host paper_release; do
  install -m 644 "$source_root/deploy/$module.py" /opt/trade-release/deploy/
done
install -m 644 "$source_root/deploy/remote/paper-cd.compose.yaml" /opt/trade-release/deploy/remote/
cd /opt/trade-release
python3 -c 'from deploy.paper_host import PaperHost,OLD_PAPER; from deploy.release_host import Config; h=PaperHost(Config()); h.persist_route(OLD_PAPER)'
docker compose --env-file /etc/trade/remote.env \
  -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
  -f /opt/trade-release/deploy/remote/cd.compose.yaml \
  -f /opt/trade-release/deploy/remote/paper-cd.compose.yaml up -d --no-deps paper-router
install -m 644 "$source_root/deploy/remote/trade-release.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable trade-release.timer
systemctl start --no-block trade-release.timer
echo 'Paper routing installed; the timer will upgrade Web before handing over the Paper controller.'
