# shellcheck disable=SC2034
check_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
package_dir=$(CDPATH='' cd -- "$check_dir/../.." && pwd)
compose_file="$package_dir/docker-compose.yml"
app_yaml="$package_dir/f/trade/rd_workbench.raw_app/raw_app.yaml"
profile="$package_dir/mcp-profile.json"
env_example="$package_dir/.env.example"
readme="$package_dir/README.md"
rd_owner_api="$package_dir/../../crates/strategy_factory_rd_owner_api/src/main.rs"
store_admission="$package_dir/../../crates/data/src/owner/store_admission/mod.rs"
sealed_acceptance_runner="$package_dir/../../scripts/ci/test-source-intake-sealed-acceptance.bash"
