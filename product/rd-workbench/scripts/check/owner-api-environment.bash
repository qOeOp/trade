#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2154
# Every environment variable the Owner API requires unconditionally must be delivered to its
# container.
#
# `compose-config.bash` already runs `docker compose config`, but that answers a different
# question: whether the compose file *interpolates* without error. A variable the binary reads and
# the service never passes in resolves fine there and the service still dies at startup, before it
# binds a port, so every route reads as unreachable for a reason no route owns. That is how
# `RD_FACT_WRITER_DATABASE_URL` sat missing while a check that names it passed - it was named only
# as interpolation input, and nothing in the compose file interpolated it.
#
# Conditional reads are deliberately excluded. A `#[cfg(feature = ...)]` read belongs to a build
# the deployment image does not make, and demanding it here would force the default image to carry
# acceptance-surface configuration it never uses.

set -euo pipefail

# shellcheck source=product/rd-workbench/scripts/check/common.bash
check_self_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$check_self_dir/common.bash"

service=rd-owner-api

echo "Checking that every unconditional Owner API environment variable is delivered to $service..."

missing=$(
  RD_OWNER_API="$rd_owner_api" COMPOSE_FILE="$compose_file" SERVICE="$service" python3 - << 'PY'
import os
import re
import sys

source = open(os.environ["RD_OWNER_API"], encoding="utf-8").read().split("\n")

# `async fn main()` only: reads in other functions belong to other binaries or to helpers this
# service never reaches on its startup path.
try:
    start = next(i for i, line in enumerate(source) if line.startswith("async fn main()"))
except StopIteration:
    print("owner-api-environment: `async fn main()` not found; the check cannot run", file=sys.stderr)
    raise SystemExit(2)

depth = 0
opened = False
end = len(source) - 1
for index in range(start, len(source)):
    depth += source[index].count("{") - source[index].count("}")
    if "{" in source[index]:
        opened = True
    if opened and depth == 0:
        end = index
        break

required = []
for index in range(start, end + 1):
    for match in re.finditer(r'required_env\("([A-Z_0-9]+)"\)', source[index]):
        # A `#[cfg]` attribute binds to the statement that follows it, not to every later line, so
        # look back only as far as the end of the previous statement.
        conditional = False
        for back in range(index, start, -1):
            if "cfg(feature" in source[back]:
                conditional = True
                break
            if back != index and source[back].rstrip().endswith((";", "{", "}")):
                break
        if not conditional:
            required.append((match.group(1), index + 1))

compose = open(os.environ["COMPOSE_FILE"], encoding="utf-8").read().split("\n")
service = os.environ["SERVICE"]
try:
    service_start = next(i for i, line in enumerate(compose) if line.strip() == f"{service}:")
except StopIteration:
    print(f"owner-api-environment: service {service} not found in the compose file", file=sys.stderr)
    raise SystemExit(2)
service_end = next(
    (i for i in range(service_start + 1, len(compose)) if re.match(r"^  [a-z-]+:$", compose[i])),
    len(compose),
)
block = "\n".join(compose[service_start:service_end])

for name, line in required:
    if re.search(rf"^\s+{re.escape(name)}:", block, re.M) is None:
        print(f"{name} (main.rs:{line})")
PY
)

if [ -n "$missing" ]; then
  echo "ERROR: the Owner API reads these environment variables unconditionally, and $service does not pass them in:" >&2
  printf '%s\n' "$missing" | while IFS= read -r line; do printf '  %s\n' "$line" >&2; done
  echo "       The service will exit before it binds a port, so every route looks unreachable." >&2
  echo "       Add each one to the $service 'environment:' block in docker-compose.yml." >&2
  exit 1
fi

echo "Every unconditional Owner API environment variable is delivered to $service"
