#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
package_dir="$repo_root/product/rd-workbench"
base_compose="$package_dir/docker-compose.source-intake-sealed-acceptance.yml"
overlay_compose="$package_dir/docker-compose.source-research-sealed-acceptance.yml"
dockerfile="$package_dir/Dockerfile.source-research-sealed-acceptance"
runner_file="$repo_root/scripts/ci/test-source-research-sealed-acceptance.bash"
windmill_image='ghcr.io/windmill-labs/windmill:1.791.0@sha256:1e9ec20f5a99235ccce18e4a4879a8c14ff1738af37fd23c18d87594dcee5916'
postgres_image='postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297'
rust_image='public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777'
buildkit_image='docker.io/moby/buildkit:v0.26.2@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa'

die() {
  printf 'Source Intake -> Research sealed acceptance: %s\n' "$*" >&2
  exit 1
}
require_command() { command -v "$1" > /dev/null 2>&1 || die "$1 is required"; }
random_hex() { python3 -c 'import secrets; print(secrets.token_hex(24))'; }
current_phase=bootstrap
phase() {
  current_phase=$1
  printf 'Source Intake -> Research sealed acceptance phase=%s\n' "$current_phase" >&2
}

if command -v timeout > /dev/null 2>&1; then
  timeout_command=timeout
elif command -v gtimeout > /dev/null 2>&1; then
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
  grep -Fq 'sealed-source-intake-research-acceptance' "$repo_root/crates/strategy_factory/Cargo.toml"
  grep -Fq 'bind_sealed_source_intake_research_policy' \
    "$repo_root/crates/strategy_factory/src/product_edge_postgres.rs"
  grep -Fq 'submit_source_intake_research_v1' \
    "$repo_root/crates/strategy_factory_rd_owner_api/src/source_intake_research.rs"
  grep -Fq -- '--features sealed-source-intake-acceptance' "$dockerfile"
  grep -Fq 'RD_OWNER_ENABLE_ACCEPTANCE_FAULTS: "1"' "$overlay_compose"
  grep -Fq 'source-research-probe:' "$overlay_compose"
  grep -Fq 'pull_policy: never' "$overlay_compose"
  # The acceptance contract intentionally matches the literal script expression.
  # shellcheck disable=SC2016
  grep -Fq 'consumer_run RESOLVE "$run_dir/research.json" "$run_dir/restart.json"' "$runner_file"
  if grep -Eq 'ports:|127\.0\.0\.1' "$overlay_compose"; then
    die 'host-published acceptance traffic is forbidden'
  fi
  if grep -Eq 'provider_selector' \
    "$repo_root/crates/strategy_factory_rd_owner_api/src/source_intake_research.rs"; then
    die 'caller-supplied verified evidence is forbidden'
  fi
  node --test --experimental-strip-types \
    "$package_dir/f/trade/product_edge/source_intake_research_v1.test.mjs" \
    "$package_dir/f/trade/product_edge/source_intake_research_v1.metadata.test.mjs"
}

static_check
if [[ ${1:-} == --static-only ]]; then
  [[ $# -eq 1 ]] || die 'usage: test-source-research-sealed-acceptance.bash [--static-only]'
  exit 0
fi
[[ $# -eq 0 ]] || die 'usage: test-source-research-sealed-acceptance.bash [--static-only]'
for command_name in bash docker jq openssl python3; do require_command "$command_name"; done
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]] || die 'custom Docker target is forbidden'

docker_context=desktop-linux
docker_local=(docker --context "$docker_context")
with_deadline 15 "${docker_local[@]}" info > /dev/null || die 'local Docker daemon is unavailable'
for image in "$windmill_image" "$postgres_image" "$rust_image" "$buildkit_image"; do
  with_deadline 15 "${docker_local[@]}" image inspect "$image" > /dev/null 2>&1 ||
    die "required local image is absent: $image"
done

run_dir=$(mktemp -d "${TMPDIR:-/tmp}/source-research-sealed-acceptance.XXXXXX")
project="sr-sealed-$(random_hex | cut -c1-16)"
owner_image="$project-owner:local"
builder_name="$project-buildx"
builder_node="${builder_name}0"
builder_container="buildx_buildkit_$builder_node"
builder_state_volume="${builder_container}_state"
env_file="$run_dir/compose.env"
bootstrap_config="$run_dir/product-edge-bootstrap.json"
compose_touched=0
builder_touched=0
cleanup_failed=0

cleanup() {
  local original_status=$? residue failed_phase=$current_phase
  trap - EXIT HUP INT TERM
  set +e
  printf 'Source Intake -> Research sealed acceptance phase=cleanup after=%s\n' "$failed_phase" >&2
  if [[ $compose_touched -eq 1 ]]; then
    with_deadline 90 "${compose[@]}" down --volumes --remove-orphans --timeout 20 > /dev/null 2>&1 || cleanup_failed=1
  fi
  if [[ $builder_touched -eq 1 ]]; then
    with_deadline 90 "${docker_local[@]}" buildx rm --force "$builder_name" > /dev/null 2>&1 || cleanup_failed=1
  fi
  residue=$(with_deadline 30 "${docker_local[@]}" ps -aq --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
  [[ -z $residue ]] || cleanup_failed=1
  residue=$(with_deadline 30 "${docker_local[@]}" volume ls -q --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
  [[ -z $residue ]] || cleanup_failed=1
  residue=$(with_deadline 30 "${docker_local[@]}" network ls -q --filter "label=com.docker.compose.project=$project") || cleanup_failed=1
  [[ -z $residue ]] || cleanup_failed=1
  "${docker_local[@]}" container rm --force "$builder_container" > /dev/null 2>&1 || true
  "${docker_local[@]}" volume rm "$builder_state_volume" > /dev/null 2>&1 || true
  "${docker_local[@]}" image rm "$owner_image" > /dev/null 2>&1 || true
  if "${docker_local[@]}" image inspect "$owner_image" > /dev/null 2>&1; then cleanup_failed=1; fi
  rm -rf -- "$run_dir" || cleanup_failed=1
  if [[ $cleanup_failed -eq 0 ]]; then
    printf '%s\n' 'Source Intake -> Research sealed acceptance cleanup/readback passed'
  else
    printf '%s\n' 'Source Intake -> Research sealed acceptance cleanup/readback failed' >&2
  fi
  [[ $original_status -eq 0 && $cleanup_failed -eq 0 ]] || exit 1
}
trap cleanup EXIT HUP INT TERM

postgres_password=$(random_hex)
rd_password=$(random_hex)
operator_password=$(random_hex)
qualification_password=$(random_hex)
edge_password=$(random_hex)
backtest_password=$(random_hex)
owner_token=$(random_hex)
windmill_database="wm_$(random_hex | cut -c1-20)"
issuer_identity="sealed-issuer-$(random_hex | cut -c1-20)"
issuer_key_version="sealed-key-$(random_hex | cut -c1-20)"
deployment_identity="sealed-deployment-$(random_hex | cut -c1-20)"

cat > "$bootstrap_config" << EOF
{"authorization_identity":"sealed-authorization-$(random_hex | cut -c1-20)","issuer_identity":"$issuer_identity","issuer_key_version":"$issuer_key_version","authorization_audience":"R_AND_D","deployment_identity":"$deployment_identity","binding_identity":"sealed-binding-$(random_hex | cut -c1-20)","effective_principal":"sealed-acceptance-runner","scope_policy_version":"sealed-acceptance-v1","capability_policy_digest":"sha256:$(random_hex)$(random_hex | cut -c1-16)","audit_policy_version":"sealed-acceptance-v1","valid_from_epoch_ms":1700000000000,"valid_through_epoch_ms":1900000000000}
EOF
cat > "$env_file" << EOF
SEALED_ACCEPTANCE_PROJECT=$project
SEALED_ACCEPTANCE_OWNER_IMAGE=$owner_image
SEALED_POSTGRES_PASSWORD=$postgres_password
SEALED_WINDMILL_DATABASE=$windmill_database
SEALED_RD_OWNER_DB_PASSWORD=$rd_password
SEALED_OPERATOR_AUTHORIZATION_DB_PASSWORD=$operator_password
SEALED_QUALIFICATION_OWNER_DB_PASSWORD=$qualification_password
SEALED_PRODUCT_EDGE_DB_PASSWORD=$edge_password
SEALED_BACKTEST_OWNER_DB_PASSWORD=$backtest_password
SEALED_RD_OWNER_DATABASE_URL=postgresql://rd_owner:$rd_password@postgres:5432/rd_owner
SEALED_OPERATOR_AUTHORIZATION_DATABASE_URL=postgresql://operator_authorization_writer:$operator_password@postgres:5432/rd_owner
SEALED_QUALIFICATION_OWNER_DATABASE_URL=postgresql://qualification_writer:$qualification_password@postgres:5432/rd_owner
SEALED_PRODUCT_EDGE_DATABASE_URL=postgresql://product_edge_owner:$edge_password@postgres:5432/rd_owner
SEALED_WINDMILL_DATABASE_URL=postgresql://postgres:$postgres_password@postgres:5432/$windmill_database
SEALED_RD_OWNER_API_TOKEN=$owner_token
SEALED_BOOTSTRAP_CONFIG=$bootstrap_config
SEALED_ISSUER_IDENTITY=$issuer_identity
SEALED_ISSUER_KEY_VERSION=$issuer_key_version
SEALED_DEPLOYMENT_IDENTITY=$deployment_identity
EOF

compose=("${docker_local[@]}" compose --project-directory "$package_dir"
  --file "$base_compose" --file "$overlay_compose" --env-file "$env_file" --project-name "$project")

builder_touched=1
with_deadline 60 "${docker_local[@]}" buildx create --name "$builder_name" --node "$builder_node" \
  --driver docker-container --driver-opt "image=$buildkit_image" > /dev/null
with_deadline 1800 "${docker_local[@]}" buildx build --builder "$builder_name" --load --pull=false \
  --no-cache --tag "$owner_image" --file "$dockerfile" "$repo_root"
compose_touched=1
with_deadline 300 "${compose[@]}" up --detach --no-build --pull never --wait \
  postgres authority-custody-migrate authority-bootstrap rd-owner-api source-research-probe

owner_post() {
  local path=$1 input=$2 output=$3 expected_status=$4 wire status
  wire="$output.wire"
  # The token expands only inside the isolated probe container.
  # shellcheck disable=SC2016
  with_deadline 30 "${compose[@]}" exec -T source-research-probe sh -eu -c '
    exec curl --silent --show-error --connect-timeout 2 --max-time 20 \
      --request POST --header "Authorization: Bearer $RD_OWNER_API_TOKEN" \
      --header "Content-Type: application/json" --data-binary @- \
      --write-out "\n%{http_code}\n" "http://rd-owner-api:8080$1"
  ' sh "$path" < "$input" > "$wire"
  status=$(tail -n 1 "$wire")
  sed '$d' "$wire" > "$output"
  [[ $status == "$expected_status" ]] || die "unexpected HTTP $status for $path"
}

db_scalar() {
  with_deadline 30 "${compose[@]}" exec -T postgres psql --username postgres --dbname rd_owner \
    --tuples-only --no-align --set=ON_ERROR_STOP=1 --command "$1" | tr -d '\r'
}

interpretation='{"bounded_explanation":"Sealed acceptance fixture","plausible_alternatives":["alternative-a","alternative-b"],"differentiating_prediction":"The fixed DOI resolves deterministically","falsifier":"A mismatched terminal or duplicate physical invocation"}'
source_run() {
  local request=$1 doi=$2 output=$3 payload
  payload="$run_dir/$request.source.json"
  jq -n --arg request "$request" --arg doi "$doi" --argjson interpretation "$interpretation" \
    '{request_identity:$request,channel:"WINDMILL_PRODUCT_EDGE",normalized_doi:$doi,interpretation:$interpretation}' > "$payload"
  owner_post /v1/source-intakes "$payload" "$output" 200
}

source_context() {
  local request=$1 output=$2
  db_scalar "SELECT json_build_object('admission',binding_json->'product_edge_admission','operation_manifest_identity',binding_json->>'operation_manifest_identity','operation_manifest_digest',binding_json->>'operation_manifest_digest') FROM public.rd_source_intake_bindings_v1 WHERE request_identity='$request' AND state='TERMINAL';" > "$output"
  jq -e '.admission and .operation_manifest_identity and .operation_manifest_digest' "$output" > /dev/null
}

research_payload() {
  local research_request=$1 source_request=$2 source_response=$3 context=$4 output=$5 hypothesis=${6:-'The sealed source supports one bounded hypothesis.'}
  jq -n --arg research "$research_request" --arg source "$source_request" \
    --arg attempt "$(jq -er '.binding_identity' "$source_response")" \
    --arg receipt "$(jq -er '.receipt.receipt_identity' "$source_response")" \
    --arg hypothesis "$hypothesis" --slurpfile context "$context" '
    {proposal:{request_identity:$research,channel:"WINDMILL_PRODUCT_EDGE",goal:{hypothesis:$hypothesis,mechanism:"The reported mechanism survives the fixed control.",falsification_question:"Does the fixed control erase the effect?",expected_observation:"The effect remains directionally stable.",required_data:["sealed-source-v1"],cost_assumption:"Fixed sealed cost model.",capacity_assumption:"Fixed sealed capacity model."},trial_family_proposal:{trial_budget:1,stop_rule:"Stop after the fixed sealed trial.",pit_rule_identity:"sealed-pit-rule-v1",cost_model_identity:"sealed-cost-model-v1",slippage_model_identity:"sealed-slippage-model-v1",capacity_model_identity:"sealed-capacity-model-v1",independence_rationale:"Genesis has no semantic predecessor."}},ancestry:{request_identity:$source,attempt_identity:$attempt,terminal_receipt_identity:$receipt},policy_query:{request_identity:$source,gateway:"WINDMILL_PRODUCT_EDGE",admission:$context[0].admission,operation_manifest_identity:$context[0].operation_manifest_identity,operation_manifest_digest:$context[0].operation_manifest_digest,connector_policy_locator:"sealed-source-intake-connector-policy-v1",network_policy_locator:"sealed-source-intake-network-policy-v1",rights_policy_locator:"sealed-source-intake-rights-policy-v1",retention_policy_locator:"sealed-source-intake-retention-policy-v1",dns_observation_locator:"sealed-source-intake-dns-observation-v1",shared_time_head:{head_identity:([range(32)|1]),head_digest:([range(32)|2])},shared_time_successor:null}}' > "$output"
}

consumer_run() {
  local action=$1 input=$2 output=$3
  # Bun executes the checked-in Windmill client while both HTTP and DB remain private.
  # shellcheck disable=SC2016
  with_deadline 30 "${compose[@]}" exec -T source-research-probe bun -e '
    const { main } = await import("/opt/source-research/f/trade/product_edge/source_intake_research_v1.ts");
    const operation = JSON.parse(await new Response(Bun.stdin.stream()).text());
    process.stdout.write(JSON.stringify(await main(process.argv[1], operation)));
  ' "$action" < "$input" > "$output"
}

owner_diagnostic_run() {
  local input=$1 output=$2 wire rejection stage
  wire="$output.wire"
  # Record only the status and rejection coordinate needed to distinguish an
  # Owner rejection from a consumer projection rejection. The response body
  # stays inside the disposable run directory.
  # shellcheck disable=SC2016
  with_deadline 30 "${compose[@]}" exec -T source-research-probe sh -eu -c '
    exec curl --silent --show-error --connect-timeout 2 --max-time 20 \
      --request POST --header "Authorization: Bearer $RD_OWNER_API_TOKEN" \
      --header "Content-Type: application/json" --data-binary @- \
      --write-out "\n%{http_code}\n%header{x-rd-rejection-code}\n%header{x-rd-sealed-acceptance-stage}\n" \
      http://rd-owner-api:8080/v1/source-intake-research
  ' < "$input" > "$wire"
  stage=$(tail -n 1 "$wire")
  rejection=$(tail -n 2 "$wire" | head -n 1)
  OWNER_DIAGNOSTIC_STATUS=$(tail -n 3 "$wire" | head -n 1)
  OWNER_DIAGNOSTIC_REJECTION=${rejection:-NONE}
  OWNER_DIAGNOSTIC_STAGE=${stage:-UNAVAILABLE}
  sed '$d' "$wire" | sed '$d' | sed '$d' > "$output"
  OWNER_DIAGNOSTIC_RESOLUTION=$(jq -r '.resolution // "UNAVAILABLE"' "$output")
}

assert_accepted() {
  jq -e '.schema_version==2 and .resolution=="ACCEPTED" and .owner_receipt and .research_view and .independence_basis and .protected_feedback and .trial_family_resolution=="AVAILABLE" and .trial_family' "$1" > /dev/null || die "$2"
}
research_projection_class() {
  jq -r '
    if .research_view.availability == "AVAILABLE"
       and .research_view.projection_at_epoch_ms == .owner_receipt.committed_at_epoch_ms
       and .research_view.next_legal_action == "WAIT_FOR_R_AND_D_EXECUTION"
       and .next_legal_action == "WAIT_FOR_R_AND_D_EXECUTION"
    then "AVAILABLE_CANONICAL"
    elif .research_view.availability == "STALE"
       and .research_view.projection_at_epoch_ms >= .owner_receipt.committed_at_epoch_ms
       and .research_view.next_legal_action == "RESOLVE_SAME_REQUEST_IDENTITY"
       and .next_legal_action == "RESOLVE_SAME_REQUEST_IDENTITY"
    then "STALE_REREAD"
    else "INVALID"
    end' "$1"
}
canonical_restart_custody() {
  jq --sort-keys --compact-output 'del(.research_view.projection_at_epoch_ms)' "$1"
}
report_restart_difference_classes() {
  jq -n --slurpfile before "$1" --slurpfile after "$2" '
    def scalar_paths: [paths(scalars)];
    (($before[0] | scalar_paths) + ($after[0] | scalar_paths) | unique)[] as $path
    | select(($before[0] | getpath($path)) != ($after[0] | getpath($path)))
    | {
        path: ($path | map(tostring) | join(".")),
        before_type: ($before[0] | getpath($path) | type),
        after_type: ($after[0] | getpath($path) | type)
      }' >&2
}
assert_zero_research() {
  local request=$1
  [[ $(db_scalar "SELECT count(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity='$request';") == 0 ]] || die "partial positive Research row for $request"
  [[ $(db_scalar "SELECT count(*) FROM public.rd_independence_bases_v1 WHERE request_identity='$request';") == 0 ]] || die "partial independence row for $request"
}

phase source
source_request="sealed-source-$(random_hex | cut -c1-16)"
source_run "$source_request" 10.5555/sealed-success "$run_dir/source-success.json"
jq -e '.terminal=="RETRIEVED" and .receipt.terminal=="RETRIEVED"' "$run_dir/source-success.json" > /dev/null || die 'source was not RETRIEVED'
source_context "$source_request" "$run_dir/source-context.json"

phase negative-ancestry
wrong_request="research-wrong-$(random_hex | cut -c1-16)"
research_payload "$wrong_request" "$source_request" "$run_dir/source-success.json" "$run_dir/source-context.json" "$run_dir/wrong.json"
jq '.ancestry.terminal_receipt_identity += "-mutated"' "$run_dir/wrong.json" > "$run_dir/wrong-mutated.json"
owner_post /v1/source-intake-research "$run_dir/wrong-mutated.json" "$run_dir/wrong.response" 403
assert_zero_research "$wrong_request"

rejected_source="sealed-rejected-$(random_hex | cut -c1-16)"
source_run "$rejected_source" 10.5555/sealed-rejected "$run_dir/source-rejected.json"
jq -e '.terminal=="TERMS_OR_LICENSE_BLOCKED" and .receipt.terminal=="TERMS_OR_LICENSE_BLOCKED"' "$run_dir/source-rejected.json" > /dev/null || die 'negative source was not a genuine non-RETRIEVED terminal'
source_context "$rejected_source" "$run_dir/rejected-source-context.json"
nonretrieved_request="research-nonretrieved-$(random_hex | cut -c1-16)"
research_payload "$nonretrieved_request" "$rejected_source" "$run_dir/source-rejected.json" "$run_dir/rejected-source-context.json" "$run_dir/nonretrieved.json"
owner_post /v1/source-intake-research "$run_dir/nonretrieved.json" "$run_dir/nonretrieved.response" 403
assert_zero_research "$nonretrieved_request"

canonical_provenance=$(db_scalar "SELECT provenance_json::text FROM public.rd_research_source_provenance_v1 WHERE receipt_identity='$(jq -er '.receipt.receipt_identity' "$run_dir/source-success.json")';")
stale_request="research-stale-$(random_hex | cut -c1-16)"
research_payload "$stale_request" "$source_request" "$run_dir/source-success.json" "$run_dir/source-context.json" "$run_dir/stale.json"
db_scalar "ALTER TABLE public.rd_research_source_provenance_v1 DISABLE TRIGGER rd_research_source_provenance_immutable_v1; UPDATE public.rd_research_source_provenance_v1 SET provenance_json=jsonb_set(provenance_json,'{valid_through_epoch_ms}','1800000000002'::jsonb) WHERE receipt_identity='$(jq -er '.receipt.receipt_identity' "$run_dir/source-success.json")'; ALTER TABLE public.rd_research_source_provenance_v1 ENABLE TRIGGER rd_research_source_provenance_immutable_v1;" > /dev/null
owner_post /v1/source-intake-research "$run_dir/stale.json" "$run_dir/stale.response" 403
assert_zero_research "$stale_request"
db_scalar "ALTER TABLE public.rd_research_source_provenance_v1 DISABLE TRIGGER rd_research_source_provenance_immutable_v1; UPDATE public.rd_research_source_provenance_v1 SET provenance_json=\$\$$canonical_provenance\$\$::jsonb WHERE receipt_identity='$(jq -er '.receipt.receipt_identity' "$run_dir/source-success.json")'; ALTER TABLE public.rd_research_source_provenance_v1 ENABLE TRIGGER rd_research_source_provenance_immutable_v1;" > /dev/null

phase canonical-research
research_request="research-success-$(random_hex | cut -c1-16)"
research_payload "$research_request" "$source_request" "$run_dir/source-success.json" "$run_dir/source-context.json" "$run_dir/research.json"
owner_diagnostic_run "$run_dir/research.json" "$run_dir/research-owner.json"
consumer_run RUN "$run_dir/research.json" "$run_dir/research-first.json"
if ! jq -e '.schema_version==2 and .resolution=="ACCEPTED" and .owner_receipt and .research_view and .independence_basis and .protected_feedback and .trial_family_resolution=="AVAILABLE" and .trial_family' "$run_dir/research-first.json" > /dev/null; then
  consumer_resolution=$(jq -r '.resolution // "UNAVAILABLE"' "$run_dir/research-first.json")
  consumer_next_action=$(jq -r '.next_legal_action // "UNAVAILABLE"' "$run_dir/research-first.json")
  die "Windmill consumer did not admit canonical Research (owner_status=$OWNER_DIAGNOSTIC_STATUS owner_resolution=$OWNER_DIAGNOSTIC_RESOLUTION owner_rejection=$OWNER_DIAGNOSTIC_REJECTION owner_stage=$OWNER_DIAGNOSTIC_STAGE consumer_resolution=$consumer_resolution consumer_next_action=$consumer_next_action)"
fi
consumer_run RUN "$run_dir/research.json" "$run_dir/research-replay.json"
cmp -s "$run_dir/research-first.json" "$run_dir/research-replay.json" || die 'exact replay did not join canonical Research'
[[ $(db_scalar "SELECT count(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity='$research_request';") == 1 ]] || die 'canonical Research receipt count is not one'

jq '.proposal.goal.hypothesis += " changed meaning"' "$run_dir/research.json" > "$run_dir/conflict.json"
owner_post /v1/source-intake-research "$run_dir/conflict.json" "$run_dir/conflict.response" 409

phase response-loss
loss_request="research-loss-$(random_hex | cut -c1-16)"
research_payload "$loss_request" "$source_request" "$run_dir/source-success.json" "$run_dir/source-context.json" "$run_dir/loss.json"
set +e
# shellcheck disable=SC2016
with_deadline 30 "${compose[@]}" exec -T source-research-probe sh -eu -c '
  exec curl --silent --show-error --connect-timeout 2 --max-time 5 --request POST \
    --header "Authorization: Bearer $RD_OWNER_API_TOKEN" --header "Content-Type: application/json" \
    --header "x-rd-acceptance-delay-after-commit-ms: 10000" --data-binary @- \
    http://rd-owner-api:8080/v1/source-intake-research
' < "$run_dir/loss.json" > "$run_dir/loss-dropped.response" 2> /dev/null
loss_status=$?
set -e
[[ $loss_status -ne 0 ]] || die 'response-loss probe unexpectedly received a response'
loss_committed=0
for _ in $(seq 1 60); do
  loss_count=$(db_scalar "SELECT count(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity='$loss_request';")
  [[ $loss_count == 0 || $loss_count == 1 ]] || die 'response-loss RUN created duplicate Research'
  if [[ $loss_count == 1 ]]; then
    loss_committed=1
    break
  fi
  sleep 0.1
done
[[ $loss_committed -eq 1 ]] || die 'response-loss RUN did not commit Research before RESOLVE'
owner_post "/v1/source-intake-research/$loss_request/resolve" "$run_dir/loss.json" "$run_dir/loss-resolved.json" 200
assert_accepted "$run_dir/loss-resolved.json" 'same-request RESOLVE did not recover committed Research'
[[ $(db_scalar "SELECT count(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity='$loss_request';") == 1 ]] || die 'response-loss resolution duplicated Research'

phase restart
with_deadline 60 "${compose[@]}" restart rd-owner-api source-research-probe > /dev/null
restart_ready=0
for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T source-research-probe sh -c \
    'curl --fail --silent http://rd-owner-api:8080/health >/dev/null' 2> /dev/null; then
    restart_ready=1
    break
  fi
  sleep 1
done
if [[ $restart_ready -ne 1 ]]; then
  "${compose[@]}" logs --no-color --tail 50 rd-owner-api 2>&1 |
    sed -E 's#postgres(ql)?://[^[:space:]]+#postgresql://REDACTED#g' >&2 || true
  die 'restart health did not recover through the isolated probe'
fi
consumer_run RESOLVE "$run_dir/research.json" "$run_dir/restart.json"
assert_accepted "$run_dir/restart.json" 'restart reread did not recover canonical Research'
before_projection_class=$(research_projection_class "$run_dir/research-first.json")
after_projection_class=$(research_projection_class "$run_dir/restart.json")
[[ $before_projection_class == AVAILABLE_CANONICAL ]] || die 'pre-restart Research projection was not current'
[[ $after_projection_class == AVAILABLE_CANONICAL ]] ||
  die "restart Research projection was not current (before=$before_projection_class after=$after_projection_class)"
canonical_restart_custody "$run_dir/research-first.json" > "$run_dir/research-first.canonical.json"
canonical_restart_custody "$run_dir/restart.json" > "$run_dir/restart.canonical.json"
if ! cmp -s "$run_dir/research-first.canonical.json" "$run_dir/restart.canonical.json"; then
  report_restart_difference_classes "$run_dir/research-first.json" "$run_dir/restart.json"
  die 'restart reread changed durable canonical Research custody'
fi

printf '%s\n' 'Source Intake -> Research sealed acceptance passed; cleanup/readback follows'
