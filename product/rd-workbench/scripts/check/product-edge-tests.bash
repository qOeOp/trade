#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

node --experimental-strip-types --test \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.test.mjs" \
  "$package_dir/f/trade/product_edge/artifact_build_v1.test.mjs" \
  "$package_dir/f/trade/product_edge/source_intake_v1.test.mjs"
