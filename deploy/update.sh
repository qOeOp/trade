#!/bin/sh
# Move this workstation's compose deployment to the newest released version (README.md here, Updating): the version's
# images and its own compose.yaml, kept under $TRADE_DATA/deploy, then recreate what changed and remove what nothing
# uses (deploy/update.py). Arguments go to deploy/update.py (--check to only report, --channel main for staging,
# --revision to pick one). Not for the release host, whose release tick moves it (remote/README.md).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
env=${TRADE_ENV:-$here/.env}
cd "$here/.."
exec uv run --frozen python -m deploy.update --env "$env" "$@"
