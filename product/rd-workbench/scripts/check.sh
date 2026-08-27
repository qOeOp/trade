#!/bin/sh
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/check" && pwd)

bash "$check_dir/windmill.bash"
bash "$check_dir/store-admission.bash"
bash "$check_dir/research.bash"
bash "$check_dir/artifact.bash"
bash "$check_dir/compose.bash"
bash "$check_dir/artifact-custody.bash"
bash "$check_dir/authority.bash"
bash "$check_dir/consumer-tests.bash"
bash "$check_dir/source-intake.bash"
bash "$check_dir/product-edge-tests.bash"
bash "$check_dir/mcp.bash"
bash "$check_dir/compose-config.bash" "${1:-}"
