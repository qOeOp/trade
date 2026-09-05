#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
package_dir="$repo_root/product/rd-workbench"
base_compose="$package_dir/docker-compose.source-intake-sealed-acceptance.yml"
overlay_compose="$package_dir/docker-compose.source-research-composer-sealed-acceptance.yml"
dockerfile="$package_dir/Dockerfile.source-research-composer-sealed-acceptance"
runner_file="$repo_root/scripts/ci/test-source-research-composer-sealed-acceptance.bash"
windmill_image='ghcr.io/windmill-labs/windmill:1.791.0@sha256:1e9ec20f5a99235ccce18e4a4879a8c14ff1738af37fd23c18d87594dcee5916'
postgres_image='postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297'
rust_image='public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777'
buildkit_image='docker.io/moby/buildkit:v0.26.2@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa'
research_request_one='sealed-source-intake-composer-research-v2-a'
research_request_two='sealed-source-intake-composer-research-v2-b'

script_paths=(
	f/trade/product_edge/source_intake_v1
	f/trade/product_edge/source_intake_research_v1
	f/trade/product_edge/develop_composer_v2
)
dependency_script_paths=(
	f/trade/product_edge/consumer_projection_v1
)

die() {
	printf 'Source -> Research -> Composer sealed acceptance: %s\n' "$*" >&2
	exit 1
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
random_hex() { python3 -c 'import secrets; print(secrets.token_hex(24))'; }

if command -v timeout >/dev/null 2>&1; then
	timeout_command=timeout
elif command -v gtimeout >/dev/null 2>&1; then
	timeout_command=gtimeout
else
	timeout_command=
fi
with_deadline() {
	local seconds=$1
	shift
	if [[ -n $timeout_command ]]; then
		"$timeout_command" --signal=TERM --kill-after=5 "$seconds" "$@"
	else
		"$@"
	fi
}

static_check() {
	bash -n "$runner_file"
	grep -Fq 'sealed-source-intake-composer-acceptance' \
		"$repo_root/crates/strategy_factory_rd_owner_api/Cargo.toml"
	grep -Fq -- '--features sealed-source-intake-composer-acceptance' "$dockerfile"
	grep -Fq 'COPY product/rd-workbench/postgres-init/10-migrate-authority-custody.sh' "$dockerfile"
	grep -Fq 'RD_FACT_WRITER_DATABASE_URL:' "$overlay_compose"
	grep -Fq 'MARKET_DATA_OWNER_DATABASE_URL:' "$overlay_compose"
	grep -Fq 'MARKET_DATA_RD_ROLE_SET_DATABASE_URL:' "$overlay_compose"
	grep -Fq 'POSTGRES_INITDB_ARGS: --auth-host=trust' "$overlay_compose"
	grep -Fq 'POSTGRES_HOST_AUTH_METHOD: trust' "$overlay_compose"
	grep -Fq '/v2/develop-composer/request-projections?research_request_locator=' "$runner_file"
	grep -Fq 'rd_develop_artifact_build_receipt_uses_v2' "$runner_file"
	grep -Fq 'x-rd-acceptance-delay-after-commit-ms' "$runner_file"
	grep -Fq 'run_deployed source RUN' "$runner_file"
	grep -Fq '.resolution=="RETRIEVED" and .receipt.terminal=="RETRIEVED"' "$runner_file"
	grep -Fq 'run_deployed research RUN' "$runner_file"
	grep -Fq 'run_deployed composer RUN' "$runner_file"
	grep -Fq 'run_deployed source RESOLVE' "$runner_file"
	grep -Fq 'run_deployed research RESOLVE' "$runner_file"
	grep -Fq 'run_deployed composer RESOLVE' "$runner_file"
	if grep -Eq 'ports:|127\.0\.0\.1' "$overlay_compose"; then
		die 'host-published acceptance traffic is forbidden'
	fi
	for path in "${dependency_script_paths[@]}" "${script_paths[@]}"; do
		test -f "$package_dir/$path.ts"
		test -f "$package_dir/$path.script.yaml"
		test -f "$package_dir/$path.script.lock"
	done
	node --test --experimental-strip-types \
		"$package_dir/f/trade/product_edge/source_intake_v1.test.mjs" \
		"$package_dir/f/trade/product_edge/source_intake_research_v1.test.mjs" \
		"$package_dir/f/trade/product_edge/develop_composer_v2.test.mjs"

	yq -e '.services.postgres.environment.POSTGRES_INITDB_ARGS == "--auth-host=trust"' "$overlay_compose" >/dev/null
	yq -e '.services.postgres.environment.POSTGRES_HOST_AUTH_METHOD == "trust"' "$overlay_compose" >/dev/null
	yq -e '.services."rd-owner-api".environment.RD_OWNER_ENABLE_ACCEPTANCE_FAULTS == "1"' "$overlay_compose" >/dev/null
}

if [[ ${1:-} == --static-only ]]; then
	[[ $# -eq 1 ]] || die 'usage: test-source-research-composer-sealed-acceptance.bash [--static-only]'
	static_check
	exit 0
fi
[[ $# -eq 0 ]] || die 'usage: test-source-research-composer-sealed-acceptance.bash [--static-only]'

for command_name in bash cmp docker jq python3 yq; do require_command "$command_name"; done
static_check

docker_context=desktop-linux
docker_local=(docker --context "$docker_context")
with_deadline 15 "${docker_local[@]}" info >/dev/null || die 'local Docker daemon is unavailable'
for image in "$windmill_image" "$postgres_image" "$rust_image" "$buildkit_image"; do
	with_deadline 15 "${docker_local[@]}" image inspect "$image" >/dev/null 2>&1 ||
		die "required local image is absent: $image"
done

run_dir=$(mktemp -d "${TMPDIR:-/tmp}/source-research-composer-sealed.XXXXXX")
project="src-sealed-$(random_hex | cut -c1-16)"
owner_image="$project-owner:local"
builder_name="$project-buildx"
builder_node="${builder_name}0"
builder_container="buildx_buildkit_$builder_node"
builder_state_volume="${builder_container}_state"
workspace="src-sealed-$(random_hex | cut -c1-16)"
postgres_container=
base_url=http://windmill-server:8000
env_file="$run_dir/compose.env"
bootstrap_config="$run_dir/product-edge-bootstrap.json"
session_header="$run_dir/session.header"
token_header="$run_dir/token.header"
workspace_created=0
token_created=0
token_prefix=
compose_touched=0
builder_touched=0
cleanup_failed=0

api_json() {
	local method=$1 header_file=$2 url=$3 output=$4 payload=${5:-}
	[[ $method == GET || $method == POST || $method == DELETE ]] || return 1
	[[ $url == http://windmill-server:8000/* ]] || return 1
	[[ $header_file == /dev/null || $header_file == "$run_dir/"* ]] || return 1
	[[ $output == /dev/null || $output == "$run_dir/"* ]] || return 1
	[[ -z $payload || $payload == "$run_dir/"* ]] || return 1
	if ! python3 - "$method" "$header_file" "$url" "$payload" <<'PY' |
import pathlib
import sys

method, header_path, url, payload_path = sys.argv[1:]
def quote(value):
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'
print("fail-with-body")
print("silent")
print("show-error")
print("connect-timeout = 3")
print("max-time = 120")
print(f"request = {quote(method)}")
print(f"url = {quote(url)}")
header = pathlib.Path(header_path).read_text(encoding="utf-8").rstrip("\n")
if header:
    print(f"header = {quote(header)}")
if payload_path:
    print('header = "Content-Type: application/json"')
    print(f"data-binary = {quote(pathlib.Path(payload_path).read_text(encoding='utf-8'))}")
PY
		with_deadline 130 "${compose[@]}" exec -T windmill-server curl --config - >"$output"; then
		sed -n '1,200p' "$output" >&2 || true
		return 1
	fi
}

write_auth_header() {
	python3 - "$1" "$2" <<'PY'
import json
import os
import sys
raw = open(sys.argv[1], encoding="utf-8").read().strip()
try:
    parsed = json.loads(raw)
    token = parsed if isinstance(parsed, str) else parsed.get("token", "")
except json.JSONDecodeError:
    token = raw
if not isinstance(token, str) or not token:
    raise SystemExit("Windmill returned an empty token")
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as output:
    output.write("Authorization: Bearer " + token + "\n")
PY
}

cleanup() {
	local original_status=$? residue
	trap - EXIT HUP INT TERM
	set +e
	if [[ $token_created -eq 1 && -n $token_prefix ]]; then
		api_json DELETE "$session_header" "$base_url/api/users/tokens/delete/$token_prefix" /dev/null || cleanup_failed=1
	fi
	if [[ $workspace_created -eq 1 ]]; then
		api_json DELETE "$session_header" "$base_url/api/workspaces/delete/$workspace" /dev/null || cleanup_failed=1
	fi
	if [[ $compose_touched -eq 1 ]]; then
		with_deadline 90 "${compose[@]}" down --volumes --remove-orphans --timeout 20 >/dev/null 2>&1 || cleanup_failed=1
	fi
	if [[ $builder_touched -eq 1 ]]; then
		with_deadline 90 "${docker_local[@]}" buildx rm --force "$builder_name" >/dev/null 2>&1 || cleanup_failed=1
	fi
	"${docker_local[@]}" container rm --force "$builder_container" >/dev/null 2>&1 || true
	"${docker_local[@]}" volume rm "$builder_state_volume" >/dev/null 2>&1 || true
	"${docker_local[@]}" image rm "$owner_image" >/dev/null 2>&1 || true
	residue=$(with_deadline 30 "${docker_local[@]}" ps -aq --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
	[[ -z $residue ]] || cleanup_failed=1
	residue=$(with_deadline 30 "${docker_local[@]}" volume ls -q --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
	[[ -z $residue ]] || cleanup_failed=1
	residue=$(with_deadline 30 "${docker_local[@]}" network ls -q --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
	[[ -z $residue ]] || cleanup_failed=1
	"${docker_local[@]}" image inspect "$owner_image" >/dev/null 2>&1 && cleanup_failed=1
	rm -rf -- "$run_dir" || cleanup_failed=1
	[[ $original_status -eq 0 && $cleanup_failed -eq 0 ]] || exit 1
	printf '%s\n' 'Source -> Research -> Composer cleanup/readback passed'
}
trap cleanup EXIT HUP INT TERM

postgres_password=$(random_hex)
rd_password=$(random_hex)
fact_writer_password=$(random_hex)
market_owner_password=$(random_hex)
catalog_password=$(random_hex)
operator_password=$(random_hex)
qualification_password=$(random_hex)
edge_password=$(random_hex)
backtest_password=$(random_hex)
owner_token=$(random_hex)
windmill_database="wm_$(random_hex | cut -c1-20)"
issuer_identity="sealed-issuer-$(random_hex | cut -c1-20)"
issuer_key_version="sealed-key-$(random_hex | cut -c1-20)"
deployment_identity="sealed-deployment-$(random_hex | cut -c1-20)"

jq -n --arg authorization "sealed-authorization-$(random_hex | cut -c1-20)" \
	--arg issuer "$issuer_identity" --arg key "$issuer_key_version" \
	--arg deployment "$deployment_identity" \
	'{authorization_identity:$authorization,issuer_identity:$issuer,issuer_key_version:$key,
    authorization_audience:"R_AND_D",deployment_identity:$deployment,
    binding_identity:"sealed-binding-a2",effective_principal:"sealed-acceptance-runner",
    scope_policy_version:"sealed-acceptance-v1",capability_policy_digest:("sha256:" + ("1" * 64)),
    audit_policy_version:"sealed-acceptance-v1",valid_from_epoch_ms:1700000000000,
    valid_through_epoch_ms:1900000000000}' >"$bootstrap_config"
cat >"$env_file" <<EOF
SEALED_ACCEPTANCE_PROJECT=$project
SEALED_ACCEPTANCE_OWNER_IMAGE=$owner_image
SEALED_POSTGRES_PASSWORD=$postgres_password
SEALED_WINDMILL_DATABASE=$windmill_database
SEALED_RD_OWNER_DB_PASSWORD=$rd_password
SEALED_RD_FACT_WRITER_DB_PASSWORD=$fact_writer_password
SEALED_MARKET_DATA_OWNER_DB_PASSWORD=$market_owner_password
SEALED_REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD=$catalog_password
SEALED_OPERATOR_AUTHORIZATION_DB_PASSWORD=$operator_password
SEALED_QUALIFICATION_OWNER_DB_PASSWORD=$qualification_password
SEALED_PRODUCT_EDGE_DB_PASSWORD=$edge_password
SEALED_BACKTEST_OWNER_DB_PASSWORD=$backtest_password
SEALED_RD_OWNER_DATABASE_URL=postgresql://rd_owner:$rd_password@postgres:5432/rd_owner
SEALED_RD_FACT_WRITER_DATABASE_URL=postgresql://rd_fact_writer:$fact_writer_password@postgres:5432/rd_owner
SEALED_MARKET_DATA_OWNER_DATABASE_URL=postgresql://market_data_owner:$market_owner_password@postgres:5432/rd_owner
SEALED_MARKET_DATA_RD_ROLE_SET_DATABASE_URL=postgresql://market_data_reader@postgres:5432/rd_owner
SEALED_OPERATOR_AUTHORIZATION_DATABASE_URL=postgresql://operator_authorization_writer:$operator_password@postgres:5432/rd_owner
SEALED_QUALIFICATION_OWNER_DATABASE_URL=postgresql://qualification_writer:$qualification_password@postgres:5432/rd_owner
SEALED_PRODUCT_EDGE_DATABASE_URL=postgresql://product_edge_owner:$edge_password@postgres:5432/rd_owner
SEALED_WINDMILL_DATABASE_URL=postgresql://postgres:$postgres_password@postgres:5432/$windmill_database
SEALED_RD_OWNER_API_TOKEN=$owner_token
SEALED_BOOTSTRAP_CONFIG=$bootstrap_config
SEALED_ISSUER_IDENTITY=$issuer_identity
SEALED_ISSUER_KEY_VERSION=$issuer_key_version
SEALED_DEPLOYMENT_IDENTITY=$deployment_identity
SEALED_REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL=postgresql://replay_policy_catalog_admin_writer:$catalog_password@postgres:5432/rd_owner
SEALED_REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY=unused-by-a2
SEALED_REPLAY_POLICY_CATALOG_BOOTSTRAP_REQUEST=$bootstrap_config
SEALED_REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY=$bootstrap_config
EOF
compose=("${docker_local[@]}" compose --project-directory "$package_dir"
	--file "$base_compose" --file "$overlay_compose" --env-file "$env_file" --project-name "$project")

builder_touched=1
with_deadline 60 "${docker_local[@]}" buildx create --name "$builder_name" --node "$builder_node" \
	--driver docker-container --driver-opt "image=$buildkit_image" >/dev/null
with_deadline 1800 "${docker_local[@]}" buildx build --builder "$builder_name" --load --pull=false \
	--no-cache --tag "$owner_image" --file "$dockerfile" "$repo_root"
compose_touched=1
if ! with_deadline 300 "${compose[@]}" up --detach --no-build --pull never --wait \
	postgres schema-materialize authority-custody-migrate authority-bootstrap rd-owner-api \
	windmill-server windmill-worker; then
	"${compose[@]}" logs --no-color rd-owner-api >&2 || true
	die 'isolated acceptance topology did not become healthy'
fi
postgres_container=$(with_deadline 10 "${compose[@]}" ps -q postgres) ||
	die 'isolated PostgreSQL container identity is unavailable'
[[ $postgres_container =~ ^[0-9a-f]{64}$ ]] ||
	die 'isolated PostgreSQL container identity is malformed'

printf '%s\n' '{"email":"admin@windmill.dev","password":"changeme"}' >"$run_dir/login.json"
api_json POST /dev/null "$base_url/api/auth/login" "$run_dir/login.response" "$run_dir/login.json"
write_auth_header "$run_dir/login.response" "$session_header"
jq -n --arg id "$workspace" '{id:$id,name:$id}' >"$run_dir/workspace.json"
api_json POST "$session_header" "$base_url/api/workspaces/create" "$run_dir/workspace.response" "$run_dir/workspace.json"
workspace_created=1
expiration=$(python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat().replace("+00:00","Z"))')
token_label="a2-sealed-$(random_hex | cut -c1-16)"
jq -n --arg label "$token_label" --arg expiration "$expiration" --arg workspace "$workspace" \
	'{label:$label,expiration:$expiration,workspace_id:$workspace}' >"$run_dir/token.json"
api_json POST "$session_header" "$base_url/api/users/tokens/create" "$run_dir/token.response" "$run_dir/token.json"
write_auth_header "$run_dir/token.response" "$token_header"
token_created=1
api_json GET "$session_header" "$base_url/api/users/tokens/list?exclude_ephemeral=false" "$run_dir/tokens.json"
token_prefix=$(jq -er --arg label "$token_label" '[.[]|select(.label==$label)]|if length==1 then .[0].token_prefix else error("token readback mismatch") end' "$run_dir/tokens.json")

deploy_script() {
	local name=$1 source="$package_dir/$1.ts" metadata="$package_dir/$1.script.yaml"
	local lock="$package_dir/$1.script.lock" stem
	stem=${1##*/}
	local metadata_json="$run_dir/$stem.metadata.json"
	local payload="$run_dir/$stem.create.json" response="$run_dir/$stem.create.response"
	yq -o=json "$metadata" >"$metadata_json"
	python3 - "$source" "$lock" "$metadata_json" "$payload" "$name" <<'PY'
import json
import os
import sys
source, lock, metadata, output, path = sys.argv[1:]
schema = json.load(open(metadata, encoding="utf-8"))
body = {"content":open(source, encoding="utf-8").read(),"description":schema["description"],
        "language":"bun","path":path,"summary":schema["summary"],"kind":schema["kind"],
        "lock":open(lock, encoding="utf-8").read(),"schema":schema["schema"],"tag":schema["tag"],
        "deployment_message":"isolated Source -> Research -> Composer SEALED_ACCEPTANCE"}
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as target:
    json.dump(body, target, separators=(",", ":"), ensure_ascii=False)
PY
	api_json POST "$token_header" "$base_url/api/w/$workspace/scripts/create" "$response" "$payload"
	api_json GET "$token_header" "$base_url/api/w/$workspace/scripts/get/p/$name" "$run_dir/$stem.readback.json"
	python3 - "$source" "$lock" "$response" "$run_dir/$stem.readback.json" "$name" <<'PY'
import json
import sys
source_path, lock_path, create_path, readback_path, expected_path = sys.argv[1:]
source = open(source_path, encoding="utf-8").read()
lock = open(lock_path, encoding="utf-8").read()
raw_create = open(create_path, encoding="utf-8").read().strip()
try:
    parsed_create = json.loads(raw_create)
    create_hash = parsed_create.get("hash") if isinstance(parsed_create, dict) else parsed_create
except json.JSONDecodeError:
    create_hash = raw_create
readback = json.load(open(readback_path, encoding="utf-8"))
if (readback.get("path") != expected_path or readback.get("language") != "bun"
        or readback.get("content") != source or readback.get("lock") != lock
        or not readback.get("hash") or str(readback["hash"]) != str(create_hash)):
    raise SystemExit("deployed Windmill script identity differs from repository bytes")
PY
}
for script_path in "${dependency_script_paths[@]}" "${script_paths[@]}"; do deploy_script "$script_path"; done

run_deployed() {
	local stage=$1 action=$2 request_identity=$3 operation=$4 output=$5 path
	case $stage in
	source) path=${script_paths[0]} ;;
	research) path=${script_paths[1]} ;;
	composer) path=${script_paths[2]} ;;
	*) return 2 ;;
	esac
	case "$stage:$action" in
	source:RUN)
		jq -n --arg action "$action" --arg request "$request_identity" \
			'{action:$action,request_identity:$request,normalized_doi:"10.5555/sealed-success",interpretation:{bounded_explanation:"A2 sealed fixture",plausible_alternatives:["alternative-a","alternative-b"],differentiating_prediction:"fixed DOI resolves",falsifier:"Owner receipt mismatch"}}' >"$run_dir/job.json"
		;;
	source:RESOLVE)
		jq -n --arg action "$action" --arg request "$request_identity" '{action:$action,request_identity:$request}' >"$run_dir/job.json"
		;;
	research:RUN)
		jq -n --arg action "$action" --arg request "$request_identity" --slurpfile operation "$operation" '{action:$action,request_identity:$request,operation:$operation[0]}' >"$run_dir/job.json"
		;;
	research:RESOLVE)
		jq -n --arg action "$action" --arg request "$request_identity" '{action:$action,request_identity:$request,operation:null}' >"$run_dir/job.json"
		;;
	composer:RUN)
		jq -n --arg action "$action" --arg locator "$request_identity" '{action:$action,research_request_locator:$locator}' >"$run_dir/job.json"
		;;
	composer:RESOLVE)
		jq -n --arg action "$action" --arg locator "$request_identity" '{action:$action,research_request_locator:$locator}' >"$run_dir/job.json"
		;;
	*) return 2 ;;
	esac
	api_json POST "$token_header" "$base_url/api/w/$workspace/jobs/run_wait_result/p/$path" "$output" "$run_dir/job.json"
}

db_scalar() {
	with_deadline 20 "${docker_local[@]}" exec "$postgres_container" env \
		'PGOPTIONS=-c lock_timeout=5s -c statement_timeout=10s' \
		psql -X --username postgres --dbname rd_owner \
		--tuples-only --no-align --set=ON_ERROR_STOP=1 --command "$1" | tr -d '\r'
}
dump_db_waits() {
	with_deadline 10 "${docker_local[@]}" exec -i "$postgres_container" psql -X \
		--username postgres --dbname rd_owner --set=ON_ERROR_STOP=1 <<'SQL'
SELECT pid,usename,application_name,backend_type,state,xact_start,query_start,
       wait_event_type,wait_event,pg_catalog.pg_blocking_pids(pid) AS blocking_pids
FROM pg_catalog.pg_stat_activity
WHERE datname=pg_catalog.current_database()
ORDER BY xact_start NULLS LAST,pid;
SELECT locks.pid,namespace.nspname,relation.relname,locks.mode,locks.granted,
       pg_catalog.pg_blocking_pids(locks.pid) AS blocking_pids
FROM pg_catalog.pg_locks locks
JOIN pg_catalog.pg_class relation ON relation.oid=locks.relation
JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
WHERE namespace.nspname IN ('public','composer_private')
  AND relation.relname IN (
    'rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2',
    'rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2',
    'rd_develop_artifact_build_receipt_uses_v2','rd_develop_composer_receipts_v2',
    'rd_develop_host_receipts_v2','rd_develop_operations_v2',
    'rd_develop_strategy_design_role_set_attestations_v1',
    'rd_develop_strategy_design_native_joins_v1','rd_develop_outbox_v2'
  )
ORDER BY relation.relname,locks.granted,locks.pid,locks.mode;
SQL
	"${compose[@]}" ps --all >&2 || true
}
composer_count() {
	db_scalar "SELECT count(*) FROM composer_private.rd_develop_operations_v2 WHERE request_identity='$1';"
}
composer_total_count() {
	db_scalar "SELECT (SELECT count(*) FROM composer_private.rd_develop_designs_v2)+(SELECT count(*) FROM composer_private.rd_develop_plans_v2)+(SELECT count(*) FROM composer_private.rd_develop_artifacts_v2)+(SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2)+(SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2)+(SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2)+(SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2)+(SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2)+(SELECT count(*) FROM composer_private.rd_develop_operations_v2)+(SELECT count(*) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1)+(SELECT count(*) FROM composer_private.rd_develop_strategy_design_native_joins_v1)+(SELECT count(*) FROM composer_private.rd_develop_outbox_v2);"
}

owner_header="$run_dir/owner.header"
printf 'Authorization: Bearer %s\n' "$owner_token" >"$owner_header"

owner_call() {
	local method=$1 path=$2 output=$3 expected=$4 payload=${5:-} extra_header=${6:-}
	local raw="$output.raw" observed
	python3 - "$method" "$path" "$owner_header" "$payload" "$extra_header" <<'PY' |
import pathlib
import sys
method, path, header_path, payload_path, extra_header = sys.argv[1:]
def quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
print('silent')
print('show-error')
print('connect-timeout = 3')
print('max-time = 120')
print('request = ' + quote(method))
print('url = ' + quote('http://rd-owner-api:8080' + path))
print('header = ' + quote(pathlib.Path(header_path).read_text(encoding='utf-8').rstrip('\n')))
if extra_header:
    print('header = ' + quote(extra_header))
if payload_path:
    print('header = "Content-Type: application/json"')
    print('data-binary = ' + quote(pathlib.Path(payload_path).read_text(encoding='utf-8')))
print('write-out = "\\n%{http_code}\\n"')
PY
		with_deadline 130 "${compose[@]}" exec -T windmill-server curl --config - >"$raw"
	observed=$(tail -n 1 "$raw")
	[[ $observed == "$expected" ]] || die "Owner $method $path returned HTTP $observed, expected $expected"
	sed '$d' "$raw" >"$output"
}

form_research() {
	local source_request=$1 research_request=$2 stem=$3
	run_deployed source RUN "$source_request" /dev/null "$run_dir/$stem-source.json"
	if ! jq -e '.resolution=="RETRIEVED" and .receipt.terminal=="RETRIEVED"' \
		"$run_dir/$stem-source.json" >/dev/null; then
		jq -c . "$run_dir/$stem-source.json" >&2 || true
		"${compose[@]}" logs --no-color --tail 200 rd-owner-api windmill-worker >&2 || true
		die "$stem Source RUN was not RETRIEVED"
	fi
	db_scalar "SELECT json_build_object('admission',binding_json->'product_edge_admission','operation_manifest_identity',binding_json->>'operation_manifest_identity','operation_manifest_digest',binding_json->>'operation_manifest_digest') FROM public.rd_source_intake_bindings_v1 WHERE request_identity='$source_request' AND state='TERMINAL';" >"$run_dir/$stem-source-context.json"
	jq -n --arg research "$research_request" --arg source "$source_request" \
		--arg attempt "$(jq -er '.binding_identity' "$run_dir/$stem-source.json")" \
		--arg receipt "$(jq -er '.receipt.receipt_identity' "$run_dir/$stem-source.json")" \
		--slurpfile context "$run_dir/$stem-source-context.json" '
    {proposal:{request_identity:$research,channel:"WINDMILL_PRODUCT_EDGE",goal:{hypothesis:("A2 sealed source " + $research + " supports the fixed complex strategy."),mechanism:"The bounded mechanism survives the fixed control.",falsification_question:"Does the fixed control erase the effect?",expected_observation:"The effect remains stable.",required_data:["sealed-source-v1"],cost_assumption:"Fixed sealed cost model.",capacity_assumption:"Fixed sealed capacity model."},trial_family_proposal:{trial_budget:1,stop_rule:"Stop after the fixed sealed trial.",pit_rule_identity:"sealed-pit-rule-v1",cost_model_identity:"sealed-cost-model-v1",slippage_model_identity:"sealed-slippage-model-v1",capacity_model_identity:"sealed-capacity-model-v1",independence_rationale:"Genesis has no semantic predecessor."}},ancestry:{request_identity:$source,attempt_identity:$attempt,terminal_receipt_identity:$receipt},policy_query:{request_identity:$source,gateway:"WINDMILL_PRODUCT_EDGE",admission:$context[0].admission,operation_manifest_identity:$context[0].operation_manifest_identity,operation_manifest_digest:$context[0].operation_manifest_digest,connector_policy_locator:"sealed-source-intake-connector-policy-v1",network_policy_locator:"sealed-source-intake-network-policy-v1",rights_policy_locator:"sealed-source-intake-rights-policy-v1",retention_policy_locator:"sealed-source-intake-retention-policy-v1",dns_observation_locator:"sealed-source-intake-dns-observation-v1",shared_time_head:{head_identity:([range(32)|1]),head_digest:([range(32)|2])},shared_time_successor:null}}' >"$run_dir/$stem-research-operation.json"
	run_deployed research RUN "$research_request" "$run_dir/$stem-research-operation.json" "$run_dir/$stem-research.json"
	jq -e '.resolution=="ACCEPTED" and .owner_receipt and .research_view and .trial_family_resolution=="AVAILABLE"' "$run_dir/$stem-research.json" >/dev/null ||
		die "$stem Research RUN was not canonically accepted"
	[[ $(db_scalar "SELECT count(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity='$research_request';") == 1 ]] ||
		die "$stem canonical Research receipt count is not one"
}

if db_scalar 'SELECT 1;' >/dev/null; then
	:
else
	connection_status=$?
	dump_db_waits >&2 || true
	die "PostgreSQL scalar transport failed before Composer census (status=$connection_status)"
fi
if composer_total_before=$(composer_total_count); then
	:
else
	scalar_status=$?
	dump_db_waits >&2 || true
	die "Composer custody census failed (status=$scalar_status)"
fi
[[ $composer_total_before == 0 ]] ||
	die "Composer custody was not empty before the first operation (observed=$composer_total_before)"
source_request_one="sealed-source-a-$(random_hex | cut -c1-12)"
source_request_two="sealed-source-b-$(random_hex | cut -c1-12)"
form_research "$source_request_one" "$research_request_one" one
form_research "$source_request_two" "$research_request_two" two

# Locator-only API rejects the entire former caller-authored DTO surface.
jq -n --arg locator "$research_request_one" '{research_request_locator:$locator,request_identity:"injected",design:{},binding_requests:[],plugin_source_capsules:[]}' >"$run_dir/full-dto.json"
owner_call POST /v2/develop-composer/runs "$run_dir/full-dto.response" 400 "$run_dir/full-dto.json"
printf '%s\n' '{"research_request_locator":""}' >"$run_dir/empty-locator.json"
owner_call POST /v2/develop-composer/runs "$run_dir/empty-locator.response" 400 "$run_dir/empty-locator.json"
printf '%s\n' '{"research_request_locator":"missing-research-custody"}' >"$run_dir/missing-locator.json"
owner_call POST /v2/develop-composer/runs "$run_dir/missing-locator.response" 503 "$run_dir/missing-locator.json"
owner_call GET '/v2/develop-composer/request-projections?unknown=field' "$run_dir/unknown-query.response" 400
owner_call GET '/v2/develop-composer/request-projections?research_request_locator=' "$run_dir/empty-query.response" 400
owner_call GET '/v2/develop-composer/request-projections?research_request_locator=missing-research-custody' "$run_dir/missing-query.response" 503
oversized_locator=$(python3 -c 'print("x" * 257)')
owner_call GET "/v2/develop-composer/request-projections?research_request_locator=$oversized_locator" "$run_dir/oversized-query.response" 400
[[ $(composer_total_count) == 0 ]] || die 'locator/full-DTO negatives left partial Composer custody'

for stem in one two; do
	case $stem in one) locator=$research_request_one ;; two) locator=$research_request_two ;; esac
	owner_call GET "/v2/develop-composer/request-projections?research_request_locator=$locator" "$run_dir/$stem-projection.json" 200
	jq -e --arg locator "$locator" '
      .schema_version==2 and .research_request_locator==$locator
      and ([keys[]] | sort)==(["design_digest","design_identity","intent_digest","intent_identity","provider_identity","request_digest","request_identity","research_custody_digest","research_request_identity","research_request_locator","schema_version"] | sort)
      and (.request_identity|type=="string" and length>0)
    ' "$run_dir/$stem-projection.json" >/dev/null || die "$stem request projection was not exact"
done
composer_request_one=$(jq -er '.request_identity' "$run_dir/one-projection.json")
composer_request_two=$(jq -er '.request_identity' "$run_dir/two-projection.json")
[[ $composer_request_one != "$composer_request_two" ]] || die 'distinct Research custodies derived one Composer identity'

# Concurrent exact RUNs join one terminal. A caller has no changed-meaning field; full DTO injection above is rejected.
run_deployed composer RUN "$research_request_one" /dev/null "$run_dir/composer-one-a.json" & first_pid=$!
run_deployed composer RUN "$research_request_one" /dev/null "$run_dir/composer-one-b.json" & second_pid=$!
wait "$first_pid"; wait "$second_pid"
cmp -s "$run_dir/composer-one-a.json" "$run_dir/composer-one-b.json" || die 'concurrent exact Composer RUN did not join'
jq -e '.disposition=="SUCCESS" and .receipt_identity and .artifact' "$run_dir/composer-one-a.json" >/dev/null ||
	die 'first Composer RUN did not produce canonical success'
run_deployed composer RUN "$research_request_two" /dev/null "$run_dir/composer-two.json"
jq -e '.disposition=="SUCCESS" and .receipt_identity and .artifact' "$run_dir/composer-two.json" >/dev/null ||
	die 'second Composer RUN did not produce canonical success'

[[ $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_artifacts_v2;') == 2 ]] || die 'two Research custodies did not create two Artifacts'
[[ $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2;') == 1 ]] || die 'shared sealed corpus did not normalize to one intrinsic build fact'
[[ $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2;') == 2 ]] || die 'two Artifacts did not create two build-use rows'
[[ $(db_scalar 'SELECT count(DISTINCT artifact_identity)=2 AND count(DISTINCT receipt_identity)=1 FROM composer_private.rd_develop_artifact_build_receipt_uses_v2;') == t ]] ||
	die 'build-use relation did not preserve two-Artifacts/one-build custody'

# Existing acceptance-only after-commit delay induces response loss without adding a new fault API.
printf '%s\n' "{\"research_request_locator\":\"$research_request_two\"}" >"$run_dir/loss-request.json"
set +e
python3 - "$owner_header" "$run_dir/loss-request.json" <<'PY' |
import pathlib
import sys
print('silent')
print('show-error')
print('connect-timeout = 2')
print('max-time = 2')
print('request = "POST"')
print('url = "http://rd-owner-api:8080/v2/develop-composer/runs"')
print('header = "' + pathlib.Path(sys.argv[1]).read_text().strip() + '"')
print('header = "Content-Type: application/json"')
print('header = "x-rd-acceptance-delay-after-commit-ms: 10000"')
print('data-binary = "' + pathlib.Path(sys.argv[2]).read_text().strip().replace('"', '\\"') + '"')
PY
	with_deadline 5 "${compose[@]}" exec -T windmill-server curl --config - >"$run_dir/lost.response" 2>/dev/null
loss_status=$?
set -e
[[ $loss_status -ne 0 ]] || die 'response-loss probe unexpectedly received a response'
owner_call POST "/v2/develop-composer/runs/$composer_request_two/resolve" "$run_dir/loss-resolve.json" 200
cmp -s "$run_dir/composer-two.json" "$run_dir/loss-resolve.json" || die 'response-loss RESOLVE changed canonical Composer receipt'

composer_total_after_run=$(composer_total_count)
with_deadline 90 "${compose[@]}" restart rd-owner-api windmill-server windmill-worker >/dev/null
restart_ready=0
for _ in $(seq 1 120); do
	if with_deadline 5 "${compose[@]}" exec -T windmill-server curl --fail --silent --connect-timeout 1 --max-time 2 http://127.0.0.1:8000/api/version >/dev/null &&
		with_deadline 5 "${compose[@]}" exec -T windmill-worker sh -c 'curl --fail --silent --connect-timeout 1 --max-time 2 http://rd-owner-api:8080/health >/dev/null'; then
		restart_ready=1; break
	fi
	sleep 1
done
[[ $restart_ready -eq 1 ]] || die 'restart health did not recover'
for stem in one two; do
	case $stem in
		one) source=$source_request_one; research=$research_request_one; expected="$run_dir/composer-one-a.json" ;;
		two) source=$source_request_two; research=$research_request_two; expected="$run_dir/composer-two.json" ;;
	esac
	run_deployed source RESOLVE "$source" /dev/null "$run_dir/$stem-source-resolve.json"
	run_deployed research RESOLVE "$research" /dev/null "$run_dir/$stem-research-resolve.json"
	run_deployed composer RESOLVE "$research" /dev/null "$run_dir/$stem-composer-resolve.json"
	cmp -s "$run_dir/$stem-source.json" "$run_dir/$stem-source-resolve.json" || die "$stem Source RESOLVE changed canonical receipt"
	jq -S 'del(.research_view.projection_at_epoch_ms)' "$run_dir/$stem-research.json" >"$run_dir/$stem-research.canonical.json"
	jq -S 'del(.research_view.projection_at_epoch_ms)' "$run_dir/$stem-research-resolve.json" >"$run_dir/$stem-research-resolve.canonical.json"
	cmp -s "$run_dir/$stem-research.canonical.json" "$run_dir/$stem-research-resolve.canonical.json" || die "$stem Research RESOLVE changed canonical custody"
	cmp -s "$expected" "$run_dir/$stem-composer-resolve.json" || die "$stem Composer RESOLVE changed canonical receipt"
done
[[ $(composer_total_count) == "$composer_total_after_run" ]] || die 'restart RESOLVE changed Composer custody'
[[ $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_artifacts_v2;') == 2 && $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2;') == 1 && $(db_scalar 'SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2;') == 2 ]] ||
	die 'restart did not preserve two-Artifacts/two-uses/one-build normalization'

printf '%s\n' 'Source -> Research -> Composer sealed acceptance passed; cleanup/readback follows'
