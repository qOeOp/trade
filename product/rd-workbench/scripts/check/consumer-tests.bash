#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

node --test "$package_dir/f/trade/rd_workbench.raw_app/control-policy.test.mjs"
node --test "$package_dir/f/trade/product_edge/artifact_build_v1.metadata.test.mjs"
node --test "$package_dir/f/trade/product_edge/exploratory_replay_v2.test.mjs"
node --test "$package_dir/f/trade/product_edge/exploratory_replay_v2.metadata.test.mjs"
