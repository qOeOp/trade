#!/usr/bin/env bash
# Every environment variable the Owner API requires in the build the deployment image makes must be
# delivered to its container: unconditional reads, reads under a feature the image's `cargo build`
# enables, and the variables Market Data constructors on the startup path read inside the data crate.
# owner_api_environment.py holds the readings and the self-test that runs before every check.
#
# `compose-config.bash` already runs `docker compose config`, but that answers a different
# question: whether the compose file *interpolates* without error. A variable the binary reads and
# the service never passes in resolves fine there and the service still dies at startup, before it
# binds a port, so every route reads as unreachable for a reason no route owns. That is how
# `RD_FACT_WRITER_DATABASE_URL` sat missing while a check that names it passed, and how
# `INSTRUMENT_OWNER_DATABASE_URL` would have stopped an image built with the production Replay
# features (measured 2026-10-03).

set -euo pipefail

check_self_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_self_dir/common.bash"

echo "Checking that every environment variable the Owner API requires is delivered to rd-owner-api..."
python3 "$check_self_dir/owner_api_environment.py" --self-test
python3 "$check_self_dir/owner_api_environment.py" "$rd_owner_api" "$compose_file" \
  "$package_dir/Dockerfile.owner" "$package_dir/../../crates/strategy_factory_rd_owner_api/Cargo.toml" \
  "$package_dir/../../crates/data/src"
