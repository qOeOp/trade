#!/bin/sh
# Run the reviewed installer from the accepted source checkout on the existing remote host.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Install the release plane as the deployment administrator'; exit 1; }
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ ! -e /var/lib/trade-release/router/active.json ] || {
  echo 'Release routing is already installed; do not overwrite it with bootstrap'; exit 1;
}
install -d -m 755 /opt/trade-release/deploy /opt/trade-release/deploy/remote
install -d -m 700 /var/lib/trade-release
install -m 644 "$source_root/deploy/__init__.py" "$source_root/deploy/release.py" "$source_root/deploy/release_host.py" /opt/trade-release/deploy/
install -m 644 "$source_root/deploy/remote/cd.compose.yaml" /opt/trade-release/deploy/remote/
cd /opt/trade-release
python3 -m deploy.release prepare
# Only the internal router and the existing authentication proxy change during initial adoption.
docker compose --env-file /etc/trade/remote.env \
  -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
  -f /opt/trade-release/deploy/remote/cd.compose.yaml -f /etc/trade/images.json config --quiet
docker compose --env-file /etc/trade/remote.env \
  -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
  -f /opt/trade-release/deploy/remote/cd.compose.yaml -f /etc/trade/images.json up -d --no-deps ide-router oauth2
python3 -m deploy.release bootstrap
install -m 644 "$source_root/deploy/remote/trade-release.service" /etc/systemd/system/
install -m 644 "$source_root/deploy/remote/trade-release.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now trade-release.timer
echo 'Automatic Web publication installed; Paper, ledger and runner containers were not recreated.'
