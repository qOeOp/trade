#!/bin/sh
# Bootstrap the release plane once: the launcher, the unit and timer, the compose overlays and a bootstrap copy of
# deploy/*.py whose only job is to hand control to the newest admitted version (`deploy-ready`, which CI moves only
# for a version tag). That version's own control code, copied out of its service image, does everything else.
#
#   install-release.sh          a new host, after the whole-project `up` of README.md: the first Paper controller,
#                               Web and Agent, then the timer
#   install-release.sh control  once, on a host installed before the handoff, with its timer stopped: the next
#                               tick hands control over
set -eu
[ "$(id -u)" = 0 ] || { echo 'Install the release plane as the deployment administrator'; exit 1; }
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mode=${1:-new}
case "$mode" in
  new)
    [ ! -e /var/lib/trade-release/router/active.json ] || {
      echo 'The release plane is already installed; its timer hands each admitted version its own control (README.md)'
      exit 1
    } ;;
  control)
    [ -e /var/lib/trade-release/router/active.json ] || {
      echo 'No release plane is installed here; run install-release.sh without arguments'; exit 1;
    }
    ! systemctl is-active --quiet trade-release.timer || { echo 'Stop trade-release.timer first (README.md)'; exit 1; }
    case $(systemctl show --property ActiveState --value trade-release.service) in
      inactive|failed) ;;
      *) echo 'A release tick is still running; let it finish, then run this again'; exit 1 ;;
    esac ;;
  *) echo 'usage: install-release.sh [control]'; exit 1 ;;
esac
install -d -m 755 /opt/trade-release /opt/trade-release/deploy /opt/trade-release/deploy/remote
rm -f /opt/trade-release/deploy/*.py
install -m 644 "$source_root"/deploy/*.py /opt/trade-release/deploy/
install -m 644 "$source_root/deploy/remote/cd.compose.yaml" "$source_root/deploy/remote/paper-cd.compose.yaml" \
  /opt/trade-release/deploy/remote/
install -m 755 "$source_root/deploy/remote/trade-release-tick" /opt/trade-release/
install -d -m 700 /var/lib/trade-release
units() {
  install -m 644 "$source_root/deploy/remote/trade-release.service" "$source_root/deploy/remote/trade-release.timer" \
    /etc/systemd/system/
  systemctl daemon-reload
}
if [ "$mode" = control ]; then
  units
  systemctl start trade-release.timer
  echo 'Launcher installed; the next tick hands release control to the admitted version (journalctl -u trade-release.service).'
  exit 0
fi
cd /opt/trade-release
# The Paper controller's scratch directory under TRADE_DATA, owned by the service identity the ledger runs as.
data=$(python3 -c 'from deploy.release_host import Config; print(Config.installed().data)')
user=$(docker inspect --format '{{.Config.User}}' trade-ide-ledger-1)
install -d -m 700 -o "${user%%:*}" -g "${user##*:}" "$data/paper-tmp"
python3 -m deploy.release handoff
cd "$(readlink -f /var/lib/trade-release/control/current)"
python3 -m deploy.release install
compose() {
  docker compose --env-file /etc/trade/remote.env \
    -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
    -f /opt/trade-release/deploy/remote/cd.compose.yaml -f /opt/trade-release/deploy/remote/paper-cd.compose.yaml "$@"
}
compose config --quiet
# The routers read the routes `install` wrote; OAuth2 Proxy already forwards to the Web router.
compose up -d --no-deps ide-router paper-router
python3 -m deploy.release verify
units
systemctl enable --now trade-release.timer
echo 'Release plane installed; the timer releases each newer admitted version (deploy-ready) with its own control.'
