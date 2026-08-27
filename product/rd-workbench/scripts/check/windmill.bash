#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

grep -Fq 'ghcr.io/windmill-labs/windmill:1.791.0@sha256:1e9ec20f5a99235ccce18e4a4879a8c14ff1738af37fd23c18d87594dcee5916' "$compose_file"
test "$(grep -c 'ghcr.io/windmill-labs/windmill:1.791.0@sha256:' "$compose_file")" -eq 2
if grep -Eq 'windmill[^[:space:]]*:(main|latest)(@|[[:space:]])' "$compose_file"; then
  echo "floating Windmill image tag is forbidden" >&2
  exit 1
fi
