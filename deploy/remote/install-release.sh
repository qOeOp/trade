#!/bin/sh
# Install the reviewed release plane on a new host, after the whole-project `up` of README.md: the first
# Paper controller, Web and Agent come from the newest admitted main build, then the timer releases newer ones.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Install the release plane as the deployment administrator'; exit 1; }
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ ! -e /var/lib/trade-release/router/active.json ] || {
  echo 'The release plane is already installed; install reviewed control code by hand (README.md)'; exit 1;
}
install -d -m 755 /opt/trade-release/deploy /opt/trade-release/deploy/remote
install -d -m 700 /var/lib/trade-release
for module in __init__ release release_host runtime_inputs live_host live_configuration paper_host paper_release telegram; do
  install -m 644 "$source_root/deploy/$module.py" /opt/trade-release/deploy/
done
install -m 644 "$source_root/deploy/remote/cd.compose.yaml" "$source_root/deploy/remote/paper-cd.compose.yaml" \
  /opt/trade-release/deploy/remote/
cd /opt/trade-release
# The Paper controller's scratch directory under TRADE_DATA, owned by the service identity the ledger runs as.
data=$(python3 -c 'from deploy.release_host import Config; print(Config.installed().data)')
user=$(docker inspect --format '{{.Config.User}}' trade-ide-ledger-1)
install -d -m 700 -o "${user%%:*}" -g "${user##*:}" "$data/paper-tmp"
python3 -m deploy.release install
compose() {
  docker compose --env-file /etc/trade/remote.env \
    -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
    -f /opt/trade-release/deploy/remote/cd.compose.yaml -f /opt/trade-release/deploy/remote/paper-cd.compose.yaml "$@"
}
compose config --quiet
# The routers read the routes `install` wrote; OAuth2 Proxy moves its upstream to the Web router.
compose up -d --no-deps ide-router paper-router oauth2
python3 -m deploy.release verify
install -m 644 "$source_root/deploy/remote/trade-release.service" "$source_root/deploy/remote/trade-release.timer" \
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now trade-release.timer
echo 'Release plane installed; the timer publishes newer checked main builds.'
