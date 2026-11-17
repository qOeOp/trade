#!/bin/sh
# Move this workstation's compose deployment to the newest released version (README.md here, Updating): name the
# version's images in .env (deploy/images.py), take the version's own compose.yaml, pull, and recreate what changed.
# Arguments go to deploy/images.py (--channel main for staging, --revision to pick one). Not for the release host,
# whose release tick moves it (remote/README.md).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
env=${TRADE_ENV:-$here/.env}
if [ -d /opt/trade-release ]; then
  echo "This is the release host: its release tick moves it (deploy/remote/README.md)." >&2
  exit 1
fi
version=$(mktemp -d)
trap 'rm -rf "$version"' EXIT
(cd "$here/.." && uv run --frozen python -m deploy.images --env "$env" --compose "$version/compose.yaml" "$@")
docker compose -p trade-ide --env-file "$env" -f "$version/compose.yaml" pull
docker compose -p trade-ide --env-file "$env" -f "$version/compose.yaml" up -d
docker compose -p trade-ide --env-file "$env" -f "$version/compose.yaml" ps
