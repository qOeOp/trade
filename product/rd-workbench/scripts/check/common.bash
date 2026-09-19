# shellcheck disable=SC2034
check_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
package_dir=$(CDPATH='' cd -- "$check_dir/../.." && pwd)
compose_file="$package_dir/docker-compose.yml"
env_example="$package_dir/.env.example"
readme="$package_dir/README.md"
rd_owner_api="$package_dir/../../crates/strategy_factory_rd_owner_api/src/main.rs"
store_admission="$package_dir/../../crates/data/src/owner/store_admission/mod.rs"

# Every assertion in these checks is a bare `grep -Fq`, which prints nothing when it
# fails. Under `set -eu` the script then exits non-zero with no output at all, and CI
# shows only "Error 1" - which invariant broke is invisible without re-running under
# `bash -x`. Name the failing assertion instead. `set -E` so the trap also fires from
# inside functions and subshells.
set -E
check_failed() {
  printf '%s: line %s failed (exit %s): %s\n' "$1" "$2" "$3" "$4" >&2
}
trap 'check_failed "${BASH_SOURCE[0]##*/}" "$LINENO" "$?" "$BASH_COMMAND"' ERR
