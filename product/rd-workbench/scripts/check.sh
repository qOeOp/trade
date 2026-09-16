#!/bin/sh
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/check" && pwd)

bash "$check_dir/store-admission.bash"
bash "$check_dir/compose.bash"
bash "$check_dir/authority.bash"
bash "$check_dir/compose-config.bash" "${1:-}"
