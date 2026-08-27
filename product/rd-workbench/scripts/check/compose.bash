#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

trap_line=$(grep -n '^trap cleanup EXIT HUP INT TERM$' "$package_dir/scripts/deploy.sh" | cut -d: -f1)
credential_copy_line=$(grep -n '^python3 - ' "$package_dir/scripts/deploy.sh" | cut -d: -f1)
[ "$trap_line" -lt "$credential_copy_line" ] || {
  echo "deployment credential cleanup must be armed before the first copy" >&2
  exit 1
}
grep -Fq 'network_mode: none' "$compose_file"
grep -Fq 'cap_drop:' "$compose_file"
grep -Fq 'read_only: true' "$compose_file"
grep -Fq 'profiles: ["authority-admin"]' "$compose_file"
test "$(grep -c 'profiles: \["authority-admin"\]' "$compose_file")" -eq 2
grep -Fq 'product-edge-authority-bootstrap' "$package_dir/Dockerfile.owner"
