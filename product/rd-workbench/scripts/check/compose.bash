#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

grep -Fq 'network_mode: none' "$compose_file"
grep -Fq 'cap_drop:' "$compose_file"
grep -Fq 'read_only: true' "$compose_file"
grep -Fq 'profiles: ["authority-admin"]' "$compose_file"
test "$(grep -c 'profiles: \["authority-admin"\]' "$compose_file")" -eq 3
grep -Fq 'product-edge-authority-bootstrap' "$package_dir/Dockerfile.owner"

# The owner image runs the Develop Composer, which builds wasm in its own process rather than in
# the build sandbox. Losing this line does not break the build; it breaks every Composer run in
# the deployed image, and nothing else here would notice.
grep -Fq 'rustup target add wasm32v1-none' "$package_dir/Dockerfile.owner"
