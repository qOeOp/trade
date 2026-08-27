#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

node --test "$package_dir/f/trade/product_edge/source_intake_v1.metadata.test.mjs"
bash "$sealed_acceptance_runner" --static-only
