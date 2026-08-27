#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
package_dir="$repo_root/product/rd-workbench"
compose_file="$package_dir/docker-compose.source-intake-sealed-acceptance.yml"
source_file="$package_dir/f/trade/product_edge/source_intake_v1.ts"
metadata_file="$package_dir/f/trade/product_edge/source_intake_v1.script.yaml"
lock_file="$package_dir/f/trade/product_edge/source_intake_v1.script.lock"
wmill_lock="$package_dir/wmill-lock.yaml"
script_path=f/trade/product_edge/source_intake_v1
windmill_image='ghcr.io/windmill-labs/windmill:1.791.0@sha256:1e9ec20f5a99235ccce18e4a4879a8c14ff1738af37fd23c18d87594dcee5916'
postgres_image='postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297'
rust_image='public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777'
buildkit_image='docker.io/moby/buildkit:v0.26.2@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa'
expected_script_lock_sha256=96bca8ffe5e516fdc9a4198fbb353f5ede225b5ca65d69abe6e1526b4a53e3b9

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" > /dev/null 2>&1 || die "$1 is required"
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

random_hex() {
  python3 -c 'import secrets; print(secrets.token_hex(24))'
}

canonical_positive_counts() {
  jq -cer '
    if type == "array" and length == 4
      and all(.[]; type == "number" and floor == . and . >= 0)
    then .
    else error("invalid positive count tuple")
    end
  '
}

stage_failure_message() {
  printf 'Source Intake SEALED_ACCEPTANCE stage failed: %s\n' "$1"
}

diagnostic_message() {
  case $1 in
    OWNER_OUTCOME_UNKNOWN | OWNER_TERMINAL_TOP_LEVEL | AUTHORITY_TUPLE | RECEIPT_KEYS | \
      SHARED_TIME | RECEIPT_BINDING | RETRIEVED_PAYLOAD | \
      PRODUCT_EDGE_UNKNOWN_WITH_OWNER_VALID | DIAGNOSTIC_EFFECT_CHANGED | \
      DIAGNOSTIC_UNAVAILABLE) ;;
    *) return 1 ;;
  esac
  printf 'Source Intake SEALED_ACCEPTANCE diagnostic: %s\n' "$1"
}

owner_terminal_diagnostic_code() {
  local request_identity=$1 response_file=$2
  [[ $request_identity =~ ^[A-Za-z0-9._-]{1,192}$ ]] || return 1
  [[ $response_file == "$run_dir/"* ]] || return 1
  jq -er --arg request "$request_identity" '
    def exact_keys($expected):
      type == "object" and ((keys | sort) == ($expected | sort));
    def identity:
      type == "string" and length > 0 and length <= 192
      and test("^[A-Za-z0-9._:/-]+$");
    def digest: type == "string" and test("^sha256:[0-9a-f]{64}$");
    def nonnegative_safe_integer:
      type == "number" and floor == . and . >= 0 and . <= 9007199254740991;
    def terminal:
      . == "RETRIEVED" or . == "NOT_FOUND" or . == "AUTH_REQUIRED"
      or . == "ACCESS_DENIED" or . == "RATE_LIMITED"
      or . == "TERMS_OR_LICENSE_BLOCKED" or . == "MALFORMED" or . == "UNAVAILABLE";
    def shared_time:
      exact_keys([
        "clock_epoch", "clock_identity", "comparison_rule", "decision_cut_epoch_ms",
        "epoch_successor_proof_identity", "head_digest", "head_identity",
        "monotonic_sequence", "predecessor_head_digest", "restart_continuity_digest",
        "skew_bound_ms", "successor_proof_commit_cut_epoch_ms", "uncertainty_bound_ms",
        "valid_through_epoch_ms", "wall_observed_epoch_ms"
      ])
      and (.head_identity | digest) and (.head_digest | digest)
      and (.clock_identity | identity) and (.clock_epoch | identity)
      and (.monotonic_sequence | nonnegative_safe_integer)
      and (.wall_observed_epoch_ms | nonnegative_safe_integer)
      and (.decision_cut_epoch_ms | nonnegative_safe_integer)
      and (.valid_through_epoch_ms | nonnegative_safe_integer)
      and (.decision_cut_epoch_ms < .valid_through_epoch_ms)
      and (.restart_continuity_digest | digest)
      and (.uncertainty_bound_ms | nonnegative_safe_integer)
      and (.skew_bound_ms | nonnegative_safe_integer)
      and .comparison_rule == "EXCLUSIVE_VALID_THROUGH"
      and (((.predecessor_head_digest == null)
        and (.epoch_successor_proof_identity == null)
        and (.successor_proof_commit_cut_epoch_ms == null))
        or ((.predecessor_head_digest | digest)
          and (.epoch_successor_proof_identity | digest)
          and (.successor_proof_commit_cut_epoch_ms | nonnegative_safe_integer)));
    def top_level:
      exact_keys([
        "authority_class", "binding_identity", "content_digest", "content_locator",
        "environment_identity", "fixture_corpus_digest", "outbox_event_identity",
        "provenance_identity", "provider_profile_digest", "receipt", "request_identity",
        "source_candidate_identity", "state", "terminal"
      ])
      and .request_identity == $request and (.binding_identity | identity)
      and .state == "TERMINAL" and (.terminal | terminal);
    def sealed_authority:
      .authority_class == "SEALED_ACCEPTANCE"
      and .environment_identity == "source-intake-sealed-acceptance-environment-v1"
      and .provider_profile_digest == "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15"
      and .fixture_corpus_digest == "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18";
    def receipt_keys:
      .receipt | exact_keys([
        "attempt_identity", "binding_identity", "committed_at_epoch_ms", "connected_address",
        "content_digest", "invocation_identity", "policy_decision_digest",
        "policy_decision_identity", "policy_decision_time", "receipt_identity",
        "request_identity", "response_header_digest", "response_media_type",
        "response_size_bytes", "response_status", "retrieval_time",
        "retrieval_time_evidence_digest", "retrieval_time_evidence_identity",
        "schema_version", "terminal", "terminal_evidence_digest", "terminal_evidence_identity"
      ]);
    def shared_times:
      (.receipt.policy_decision_time | shared_time)
      and (.receipt.retrieval_time | shared_time)
      and .receipt.policy_decision_time.clock_identity == .receipt.retrieval_time.clock_identity
      and .receipt.policy_decision_time.clock_epoch == .receipt.retrieval_time.clock_epoch
      and .receipt.policy_decision_time.monotonic_sequence
        < .receipt.retrieval_time.monotonic_sequence
      and .receipt.policy_decision_time.head_digest != .receipt.retrieval_time.head_digest
      and .receipt.policy_decision_time.decision_cut_epoch_ms
        <= .receipt.retrieval_time.decision_cut_epoch_ms;
    def receipt_binding:
      .receipt.schema_version == 1 and (.receipt.receipt_identity | identity)
      and .receipt.request_identity == $request
      and .receipt.binding_identity == .binding_identity
      and .receipt.attempt_identity == .binding_identity
      and (.receipt.invocation_identity == null or (.receipt.invocation_identity | identity))
      and .receipt.terminal == .terminal
      and (.receipt.terminal_evidence_identity | digest)
      and (.receipt.terminal_evidence_digest | digest)
      and (.receipt.policy_decision_identity | identity)
      and (.receipt.policy_decision_digest | digest)
      and (.receipt.response_status == null
        or ((.receipt.response_status | nonnegative_safe_integer)
          and .receipt.response_status >= 100 and .receipt.response_status <= 599))
      and (.receipt.response_header_digest == null or (.receipt.response_header_digest | digest))
      and (((.receipt.connected_address == null) and (.receipt.response_media_type == null)
        and (.receipt.response_size_bytes == null))
        or ((.receipt.connected_address | type == "string" and length > 0)
          and (.receipt.response_media_type | type == "string" and length > 0)
          and (.receipt.response_size_bytes | nonnegative_safe_integer)))
      and (.receipt.content_digest == null or (.receipt.content_digest | digest))
      and (.receipt.retrieval_time_evidence_identity | identity)
      and (.receipt.retrieval_time_evidence_digest | digest)
      and (.receipt.committed_at_epoch_ms | nonnegative_safe_integer);
    def retrieved_payload:
      .terminal == "RETRIEVED" and (.receipt.invocation_identity | identity)
      and .receipt.response_status == 200 and (.receipt.response_header_digest | digest)
      and (.receipt.connected_address | type == "string" and length > 0)
      and (.receipt.response_media_type | type == "string" and length > 0)
      and (.receipt.response_size_bytes | nonnegative_safe_integer)
      and (.receipt.content_digest | digest)
      and .content_digest == .receipt.content_digest
      and .content_locator == ("rd-owner://source-payload/sha256/" + .receipt.content_digest)
      and (.provenance_identity | identity) and (.source_candidate_identity | identity)
      and (.outbox_event_identity | identity);

    if exact_keys(["next_legal_action", "request_identity", "resolution"])
      and .request_identity == $request and .resolution == "SUBMITTED_OR_UNKNOWN"
      and .next_legal_action == "RESOLVE_SAME_REQUEST" then "OWNER_OUTCOME_UNKNOWN"
    elif (top_level | not) then "OWNER_TERMINAL_TOP_LEVEL"
    elif (sealed_authority | not) then "AUTHORITY_TUPLE"
    elif (receipt_keys | not) then "RECEIPT_KEYS"
    elif (shared_times | not) then "SHARED_TIME"
    elif (receipt_binding | not) then "RECEIPT_BINDING"
    elif (retrieved_payload | not) then "RETRIEVED_PAYLOAD"
    else "PRODUCT_EDGE_UNKNOWN_WITH_OWNER_VALID"
    end
  ' "$response_file"
}

stage_fail() {
  case $1 in
    initial-audit-count | initial-positive-counts | \
      success-run-payload | success-resolve-payload | success-first-run | success-second-run | \
      success-resolve | success-retrieved-shape | success-run-idempotency | \
      success-resolve-idempotency | success-audit-count | success-positive-counts | \
      rejected-run-payload | rejected-run | rejected-shape | rejected-audit-count | \
      rejected-positive-counts | response-loss-run-payload | response-loss-resolve-payload | \
      response-loss-first-run | response-loss-first-shape | response-loss-second-run | \
      response-loss-resolve | response-loss-retrieved-shape | \
      response-loss-resolve-idempotency | response-loss-audit-count | \
      response-loss-positive-counts) ;;
    *) die 'invalid sealed acceptance stage label' ;;
  esac
  die "$(stage_failure_message "$1")"
}

expect_value() {
  local stage=$1 expected=$2 actual=$3
  [[ $actual == "$expected" ]] || stage_fail "$stage"
}

if command -v timeout > /dev/null 2>&1; then
  timeout_command=timeout
elif command -v gtimeout > /dev/null 2>&1; then
  timeout_command=gtimeout
else
  die 'timeout or gtimeout is required'
fi

with_deadline() {
  local seconds=$1
  shift
  "$timeout_command" --signal=TERM --kill-after=5 "$seconds" "$@"
}

if [[ -n ${DOCKER_HOST:-} || -n ${DOCKER_CONTEXT:-} ]]; then
  die 'DOCKER_HOST and DOCKER_CONTEXT must be unset for sealed acceptance'
fi
docker_context=desktop-linux
require_command docker
docker_local=(docker --context "$docker_context")
docker_endpoint=$(with_deadline 15 "${docker_local[@]}" context inspect "$docker_context" \
  --format '{{.Endpoints.docker.Host}}')
[[ $docker_endpoint == unix:///* ]] || die 'desktop-linux must expose an absolute Unix socket endpoint'
docker_socket=${docker_endpoint#unix://}
[[ $docker_socket == /* ]] || die 'desktop-linux Docker socket path must be absolute'
[[ -S $docker_socket && ! -L $docker_socket ]] ||
  die 'desktop-linux Docker endpoint must be an existing non-symlink Unix socket'

static_check() {
  require_command bash
  require_command docker
  require_command jq
  require_command python3
  require_command shasum
  require_command yq

  bash -n "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  test "$(printf '%s\n' '[0, 0, 0, 0]' | canonical_positive_counts)" = '[0,0,0,0]'
  if printf '%s\n' '[-1, 0, 0, 0]' | canonical_positive_counts > /dev/null 2>&1; then
    die 'negative positive-count tuple must be rejected'
  fi
  test "$(stage_failure_message initial-positive-counts)" = \
    'Source Intake SEALED_ACCEPTANCE stage failed: initial-positive-counts'
  test -s "$lock_file"
  test "$(grep -Fc "$windmill_image" "$compose_file")" -eq 2
  test "$(grep -Ec '^[[:space:]]+pull_policy: never$' "$compose_file")" -eq 6
  grep -Fq -- '--features sealed-source-intake-acceptance' \
    "$package_dir/Dockerfile.owner-sealed-acceptance"
  if head -n 1 "$package_dir/Dockerfile.owner-sealed-acceptance" | grep -Fq '# syntax='; then
    die 'sealed acceptance build must not resolve an external Dockerfile frontend'
  fi
  if grep -Eq -- '--mount=type=cache|sharing=locked' \
    "$package_dir/Dockerfile.owner-sealed-acceptance"; then
    die 'sealed acceptance build must not use shared mutable BuildKit caches'
  fi
  python3 - "$package_dir/Dockerfile.owner-sealed-acceptance" "$repo_root/Cargo.lock" << 'PY'
import pathlib
import re
import sys
import tomllib

dockerfile_path, cargo_lock_path = map(pathlib.Path, sys.argv[1:])
logical = []
current = ""
for raw_line in dockerfile_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    current = f"{current} {line}".strip()
    if current.endswith("\\"):
        current = current[:-1].rstrip()
        continue
    logical.append(current)
    current = ""
if current:
    raise SystemExit("unterminated Dockerfile continuation")

from_instructions = [instruction for instruction in logical if instruction.startswith("FROM ")]
if len(from_instructions) != 2 or any(
    not re.fullmatch(r"FROM [^ ]+@sha256:[0-9a-f]{64}(?: AS [A-Za-z0-9_-]+)?", instruction)
    for instruction in from_instructions
):
    raise SystemExit("every sealed acceptance base image must be exactly digest pinned")

run_instructions = [instruction for instruction in logical if instruction.startswith("RUN ")]
fetch_instructions = [instruction for instruction in run_instructions if "cargo fetch" in instruction]
if fetch_instructions != ["RUN cargo fetch --locked"]:
    raise SystemExit("sealed acceptance must have exactly one separate locked Cargo fetch phase")
networked_runs = [
    instruction for instruction in run_instructions if not instruction.startswith("RUN --network=none ")
]
if networked_runs != fetch_instructions:
    raise SystemExit("only the exact Cargo fetch phase may have build network access")

build_instructions = [instruction for instruction in run_instructions if "cargo build" in instruction]
if len(build_instructions) != 1 or build_instructions[0].count("cargo build") != 2:
    raise SystemExit("both sealed acceptance binaries must share one network-disabled build phase")
if logical.count("ENV CARGO_NET_OFFLINE=true") != 1:
    raise SystemExit("sealed acceptance build must enable Cargo offline mode exactly once")
fetch_index = logical.index(fetch_instructions[0])
offline_index = logical.index("ENV CARGO_NET_OFFLINE=true")
build_index = logical.index(build_instructions[0])
if not fetch_index < offline_index < build_index:
    raise SystemExit("Cargo offline mode must begin after fetch and before every build step")
if not build_instructions[0].startswith("RUN --network=none "):
    raise SystemExit("every Cargo build and build script must execute without a BuildKit network")

cargo_subcommands = re.findall(r"\bcargo\s+([a-z-]+)", "\n".join(run_instructions))
if sorted(cargo_subcommands) != ["build", "build", "fetch"]:
    raise SystemExit("sealed acceptance Dockerfile contains an unauthorized Cargo command")
if re.search(r"\b(curl|wget|git|ssh|nc|netcat|socat)\s", "\n".join(run_instructions)):
    raise SystemExit("sealed acceptance Dockerfile contains an arbitrary network client")
lock = tomllib.loads(cargo_lock_path.read_text(encoding="utf-8"))
registry_source = "registry+https://github.com/rust-lang/crates.io-index"
for package in lock.get("package", []):
    source = package.get("source")
    if source is None:
        continue
    if source != registry_source:
        raise SystemExit(f"sealed acceptance Cargo.lock has an unauthorized dependency source: {source}")
    if not re.fullmatch(r"[0-9a-f]{64}", package.get("checksum", "")):
        raise SystemExit("every crates.io package must be bound by a Cargo.lock checksum")
PY
  local runner_file run_dir_line cleanup_trap_line first_secret_line
  local authority_reject_line context_inspect_line socket_check_line static_check_line
  local docker_local_word compose_array_word rmi_local keep_state pull_word
  runner_file="$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  run_dir_line=$(grep -n '^run_dir=' "$runner_file" | cut -d: -f1)
  cleanup_trap_line=$(grep -n '^trap cleanup EXIT HUP INT TERM$' "$runner_file" | cut -d: -f1)
  first_secret_line=$(grep -n '^postgres_password=' "$runner_file" | cut -d: -f1)
  [[ $cleanup_trap_line -eq $((run_dir_line + 1)) && $cleanup_trap_line -lt $first_secret_line ]] ||
    die 'cleanup must be armed immediately after run directory creation and before secret materialization'
  grep -Fq 'set +e +u' "$runner_file"
  grep -Fq "\${compose_touched:-0}" "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq '"$timeout_command" --signal=TERM --kill-after=5 "$seconds" "$@"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq 'rm -rf -- "$run_dir" || cleanup_failed=1' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq '[[ ! -e $run_dir && ! -L $run_dir ]] || cleanup_failed=1' "$runner_file"
  authority_reject_line=$(awk '/^if \[\[ -n \$\{DOCKER_HOST:-\}/ { print NR }' "$runner_file")
  context_inspect_line=$(awk '/^docker_endpoint=\$\(with_deadline 15 / { print NR }' "$runner_file")
  socket_check_line=$(awk '/^\[\[ -S \$docker_socket/ { print NR }' "$runner_file")
  static_check_line=$(awk '/^static_check\(\) \{/ { print NR }' "$runner_file")
  [[ $authority_reject_line -lt $context_inspect_line &&
    $context_inspect_line -lt $socket_check_line && $socket_check_line -lt $static_check_line ]] ||
    die 'local Docker authority must be validated before any acceptance Docker operation'
  grep -Fxq 'docker_context=desktop-linux' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fxq 'docker_local=(docker --context "$docker_context")' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq '[[ $docker_endpoint == unix:///* ]]' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq '[[ -S $docker_socket && ! -L $docker_socket ]]' "$runner_file"
  docker_local_word='$''{docker_local[@]}'
  compose_array_word='$''{compose[@]}'
  # shellcheck disable=SC2016
  if grep -E '(^|[[:space:];|&(])docker([[:space:]\\]|$)' "$runner_file" |
    grep -Fv 'docker_local=(docker --context "$docker_context")' |
    grep -Fv 'require_command docker' |
    grep -Fv 'for command_name in bash cmp docker jq'; then
    die 'bare Docker client operations are forbidden outside the local context array'
  fi
  # shellcheck disable=SC2016
  if grep -F "$docker_local_word" "$runner_file" |
    grep -Fv 'with_deadline ' |
    grep -Fv 'compose=("${docker_local[@]}" compose'; then
    die 'every local Docker client operation must use the host-side deadline wrapper'
  fi
  if grep -F "$compose_array_word" "$runner_file" | grep -Fv 'with_deadline '; then
    die 'every Compose client operation must use the host-side deadline wrapper'
  fi
  pull_word=pull
  if grep -F "\"$docker_local_word\" $pull_word" "$runner_file" ||
    grep -F "\"$docker_local_word\" compose $pull_word" "$runner_file"; then
    die 'sealed acceptance must never issue an image pull command'
  fi
  test "$(grep -Fc "with_deadline 60 \"$docker_local_word\" image rm" "$runner_file")" -eq 1
  test "$(grep -Fc "\"$docker_local_word\" image ls -q" "$runner_file")" -ge 3
  grep -Fq "with_deadline 30 \"$docker_local_word\" compose" "$runner_file"
  [[ $buildkit_image =~ ^docker\.io/moby/buildkit:v0\.26\.2@sha256:[0-9a-f]{64}$ ]] ||
    die 'BuildKit image must be an immutable v0.26.2 digest reference'
  # shellcheck disable=SC2016
  grep -Fq 'for image in "$windmill_image" "$postgres_image" "$rust_image" "$buildkit_image"' \
    "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq "with_deadline 60 \"$docker_local_word\" buildx create --name \"\$builder_name\"" \
    "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq -- '--node "$builder_node" --driver docker-container' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq -- '--driver-opt "image=$buildkit_image"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq "with_deadline 900 \"$docker_local_word\" buildx build --builder \"\$builder_name\"" \
    "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq -- '--load --pull=false --no-cache --tag "$owner_image"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq -- '--file "$package_dir/Dockerfile.owner-sealed-acceptance" "$repo_root"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq "with_deadline 90 \"$docker_local_word\" buildx rm --force" "$runner_file"
  grep -Fq 'builder_residue_absent || cleanup_failed=1' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq 'builder_name="$project-buildx"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq 'builder_state_volume="${builder_container}_state"' "$runner_file"
  keep_state='--keep-'"state"
  if grep -Fq -- "$keep_state" "$runner_file"; then
    die 'acceptance builder state must be disposable'
  fi
  if grep -Fq "\"$compose_array_word\" build" "$runner_file"; then
    die 'sealed acceptance must not use the default Compose builder'
  fi
  rmi_local='--rmi '"local"
  if grep -Fq -- "$rmi_local" "$runner_file"; then
    die 'cleanup must remove only the exact acceptance owner image'
  fi
  grep -Fq 'internal: true' "$compose_file"
  grep -Fq 'BASE_URL: http://windmill-server:8000' "$compose_file"
  grep -Fq 'exec -T windmill-server curl --config -' "$runner_file"
  if grep -Eq '^[[:space:]]*curl([[:space:]\\]|$)' "$runner_file"; then
    die 'host-side curl operations are forbidden in sealed acceptance'
  fi
  # shellcheck disable=SC2016
  grep -Fq -- '--header "Authorization: Bearer $RD_OWNER_API_TOKEN"' "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq '[[ $audit_before != "$audit_after" || $counts_before != "$counts_after" ]]' \
    "$runner_file"
  # shellcheck disable=SC2016
  grep -Fq 'diagnostic_message "$code" >&2' "$runner_file"
  if sed -n '/^diagnose_product_edge_unknown() {$/,/^}$/p' "$runner_file" |
    grep -E '(^|[[:space:]])(cat|tee|printf|echo)([[:space:]]|$)'; then
    die 'diagnostic response bytes must remain private'
  fi
  # shellcheck disable=SC2016
  grep -Fq 'BACKTEST_OWNER_DB_PASSWORD: ${SEALED_BACKTEST_OWNER_DB_PASSWORD' "$compose_file"
  grep -Fq 'POST /api/auth/login' "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Fq '/api/workspaces/create' "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Fq '/api/workspaces/exists' "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Fq '/api/users/tokens/create' "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Fq "/api/w/\$workspace/scripts/create" "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Fq "/api/w/\$workspace/jobs/run_wait_result/p/\$script_path" \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  grep -Eq '^printf .*\{"email":"admin@windmill\.dev","password":"changeme"\}' \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"
  local forbidden_user_route forbidden_user_suffix forbidden_provider forbidden_provider_host
  local caller_login_prefix caller_wmill_prefix caller_email_name caller_password_name
  forbidden_user_suffix=create
  forbidden_user_route="/api/users/$forbidden_user_suffix"
  forbidden_provider_host=openalex.org
  forbidden_provider="api.$forbidden_provider_host"
  caller_login_prefix="WINDMILL_"LOGIN
  caller_wmill_prefix=WMILL_
  caller_email_name="${caller_wmill_prefix}EMAIL"
  caller_password_name="${caller_wmill_prefix}PASSWORD"
  if grep -Fq "$forbidden_user_route" \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"; then
    die 'unsupported Windmill user-creation route is forbidden'
  fi
  if grep -Eq '(^|[[:space:]])docker([[:space:]]+compose)?[[:space:]]+pull([[:space:]]|$)' \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"; then
    die 'image pull command is forbidden'
  fi
  if grep -Fq "$forbidden_provider" "$compose_file" \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"; then
    die 'live provider URL is forbidden in the sealed acceptance topology'
  fi
  if grep -Fq "$caller_login_prefix" \
    "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash" ||
    grep -Fq "$caller_email_name" \
      "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash" ||
    grep -Fq "$caller_password_name" \
      "$repo_root/scripts/ci/test-source-intake-sealed-acceptance.bash"; then
    die 'caller-selected Windmill bootstrap credentials are forbidden'
  fi
  grep -Eq "^[[:space:]]+$script_path: [0-9a-f]{64}$" "$wmill_lock"
  local calculated_wmill_hash locked_wmill_hash
  calculated_wmill_hash=$(
    {
      printf '{}'
      cat "$source_file" "$metadata_file"
    } | shasum -a 256 | awk '{print $1}'
  )
  locked_wmill_hash=$(yq -er ".locks[\"$script_path\"]" "$wmill_lock")
  [[ $calculated_wmill_hash == "$locked_wmill_hash" ]] ||
    die 'Source Intake script content/metadata hash does not match wmill-lock.yaml'
  [[ $(sha256_file "$lock_file") == "$expected_script_lock_sha256" ]] ||
    die 'Source Intake dependency lock bytes changed without an explicit lock rebind'

  local static_dir static_env static_config static_json diagnostic_fixture diagnostic_case run_dir
  static_dir=$(mktemp -d "${TMPDIR:-/tmp}/source-intake-sealed-static.XXXXXX")
  trap 'rm -rf -- "$static_dir"' RETURN
  run_dir=$static_dir
  static_env="$static_dir/compose.env"
  static_config="$static_dir/bootstrap.json"
  static_json="$static_dir/compose.json"
  diagnostic_fixture="$package_dir/tests/fixtures/source_intake_terminal_v1.json"
  diagnostic_case="$static_dir/owner-terminal.json"
  jq '
    .authority_class = "SEALED_ACCEPTANCE"
    | .environment_identity = "source-intake-sealed-acceptance-environment-v1"
    | .provider_profile_digest = "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15"
    | .fixture_corpus_digest = "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18"
  ' "$diagnostic_fixture" > "$diagnostic_case"
  test "$(owner_terminal_diagnostic_code source-request-1 "$diagnostic_case")" = \
    PRODUCT_EDGE_UNKNOWN_WITH_OWNER_VALID
  jq '.unexpected = true' "$diagnostic_case" > "$static_dir/top-level.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/top-level.json")" = \
    OWNER_TERMINAL_TOP_LEVEL
  jq '.fixture_corpus_digest = null' "$diagnostic_case" > "$static_dir/authority.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/authority.json")" = \
    AUTHORITY_TUPLE
  jq '.receipt.unexpected = true' "$diagnostic_case" > "$static_dir/receipt-keys.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/receipt-keys.json")" = \
    RECEIPT_KEYS
  jq '.receipt.policy_decision_time.head_identity += "-invalid"' \
    "$diagnostic_case" > "$static_dir/shared-time.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/shared-time.json")" = \
    SHARED_TIME
  jq '.receipt.policy_decision_time.monotonic_sequence = 9007199254740992' \
    "$diagnostic_case" > "$static_dir/shared-time-unsafe-integer.json"
  test "$(owner_terminal_diagnostic_code source-request-1 \
    "$static_dir/shared-time-unsafe-integer.json")" = SHARED_TIME
  jq '.receipt.attempt_identity = "other-binding"' \
    "$diagnostic_case" > "$static_dir/receipt-binding.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/receipt-binding.json")" = \
    RECEIPT_BINDING
  jq '.receipt.committed_at_epoch_ms = 9007199254740992' \
    "$diagnostic_case" > "$static_dir/receipt-binding-unsafe-integer.json"
  test "$(owner_terminal_diagnostic_code source-request-1 \
    "$static_dir/receipt-binding-unsafe-integer.json")" = RECEIPT_BINDING
  jq '.content_digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
    "$diagnostic_case" > "$static_dir/retrieved-payload.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/retrieved-payload.json")" = \
    RETRIEVED_PAYLOAD
  jq -n --arg request source-request-1 \
    '{request_identity: $request, resolution: "SUBMITTED_OR_UNKNOWN", next_legal_action: "RESOLVE_SAME_REQUEST"}' \
    > "$static_dir/owner-unknown.json"
  test "$(owner_terminal_diagnostic_code source-request-1 "$static_dir/owner-unknown.json")" = \
    OWNER_OUTCOME_UNKNOWN
  test "$(diagnostic_message PRODUCT_EDGE_UNKNOWN_WITH_OWNER_VALID)" = \
    'Source Intake SEALED_ACCEPTANCE diagnostic: PRODUCT_EDGE_UNKNOWN_WITH_OWNER_VALID'
  if (diagnostic_message 'untrusted-value') > /dev/null 2>&1; then
    die 'diagnostic output must reject non-allowlisted values'
  fi
  printf '{}\n' > "$static_config"
  cat > "$static_env" << EOF
SEALED_ACCEPTANCE_PROJECT=source-intake-sealed-static-check
SEALED_ACCEPTANCE_OWNER_IMAGE=source-intake-sealed-static-check-owner:local
SEALED_POSTGRES_PASSWORD=static-only
SEALED_WINDMILL_DATABASE=windmill_static_only
SEALED_RD_OWNER_DB_PASSWORD=static-only
SEALED_OPERATOR_AUTHORIZATION_DB_PASSWORD=static-only
SEALED_QUALIFICATION_OWNER_DB_PASSWORD=static-only
SEALED_PRODUCT_EDGE_DB_PASSWORD=static-only
SEALED_BACKTEST_OWNER_DB_PASSWORD=static-only
SEALED_RD_OWNER_DATABASE_URL=postgresql://rd_owner:static-only@postgres:5432/rd_owner
SEALED_OPERATOR_AUTHORIZATION_DATABASE_URL=postgresql://operator_authorization_writer:static-only@postgres:5432/rd_owner
SEALED_QUALIFICATION_OWNER_DATABASE_URL=postgresql://qualification_writer:static-only@postgres:5432/rd_owner
SEALED_PRODUCT_EDGE_DATABASE_URL=postgresql://product_edge_owner:static-only@postgres:5432/rd_owner
SEALED_WINDMILL_DATABASE_URL=postgresql://postgres:static-only@postgres:5432/windmill_static_only
SEALED_RD_OWNER_API_TOKEN=static-only
SEALED_BOOTSTRAP_CONFIG=$static_config
SEALED_ISSUER_IDENTITY=static-only
SEALED_ISSUER_KEY_VERSION=static-only
SEALED_DEPLOYMENT_IDENTITY=static-only
EOF
  with_deadline 30 "${docker_local[@]}" compose \
    --project-directory "$package_dir" --file "$compose_file" \
    --env-file "$static_env" config --format json > "$static_json"
  jq -e --arg windmill "$windmill_image" --arg postgres "$postgres_image" \
    --arg owner 'source-intake-sealed-static-check-owner:local' '
    .networks["sealed-internal"].internal == true
    and (.networks | keys == ["sealed-internal"])
    and (.services["windmill-server"] | has("ports") | not)
    and (.services["windmill-server"].networks | keys == ["sealed-internal"])
    and .services["windmill-server"].environment.BASE_URL == "http://windmill-server:8000"
    and .services["windmill-server"].image == $windmill
    and .services["windmill-worker"].image == $windmill
    and .services.postgres.image == $postgres
    and .services["authority-bootstrap"].image == $owner
    and .services["rd-owner-api"].image == $owner
    and (.services["rd-owner-api"] | has("build") | not)
    and (.services["windmill-server"].environment.DATABASE_URL | contains("windmill_static_only"))
    and ([.services[] | select(has("pull_policy")) | .pull_policy] | all(. == "never"))
  ' "$static_json" > /dev/null
  trap - RETURN
  rm -rf -- "$static_dir"
}

if [[ ${1:-} == --static-only ]]; then
  [[ $# -eq 1 ]] || die 'usage: test-source-intake-sealed-acceptance.bash [--static-only]'
  static_check
  exit 0
fi
[[ $# -eq 0 ]] || die 'usage: test-source-intake-sealed-acceptance.bash [--static-only]'

for command_name in bash cmp docker jq python3 shasum sort yq; do
  require_command "$command_name"
done
with_deadline 15 "${docker_local[@]}" compose version > /dev/null 2>&1 ||
  die 'Docker Compose v2 is required'

static_check
with_deadline 15 "${docker_local[@]}" info > /dev/null
for image in "$windmill_image" "$postgres_image" "$rust_image" "$buildkit_image"; do
  with_deadline 15 "${docker_local[@]}" image inspect "$image" > /dev/null 2>&1 ||
    die "required local image is absent: $image"
done

capture_shared_baseline() {
  with_deadline 30 "${docker_local[@]}" ps -a \
    --format '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}' | sort > "$1"
  with_deadline 30 "${docker_local[@]}" volume ls \
    --format '{{.Name}}\t{{.Driver}}\t{{.Label "com.docker.compose.project"}}' | sort > "$2"
  with_deadline 30 "${docker_local[@]}" network ls \
    --format '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Label "com.docker.compose.project"}}' | sort > "$3"
}

project_residue_absent() {
  local project_name=${project:-} image_ref=${owner_image:-} residue
  [[ -n $project_name ]] || return 0
  residue=$(with_deadline 30 "${docker_local[@]}" ps -aq \
    --filter "label=com.docker.compose.project=$project_name") || return 1
  [[ -z $residue ]] || return 1
  residue=$(with_deadline 30 "${docker_local[@]}" volume ls -q \
    --filter "label=com.docker.compose.project=$project_name") || return 1
  [[ -z $residue ]] || return 1
  residue=$(with_deadline 30 "${docker_local[@]}" network ls -q \
    --filter "label=com.docker.compose.project=$project_name") || return 1
  [[ -z $residue ]] || return 1
  if [[ -n $image_ref ]]; then
    residue=$(with_deadline 30 "${docker_local[@]}" image ls -q \
      --filter "reference=$image_ref") || return 1
    [[ -z $residue ]] || return 1
  fi
}

builder_residue_absent() {
  local name=${builder_name:-} container=${builder_container:-} state=${builder_state_volume:-}
  local builder_names container_names volume_names
  [[ -n $name && -n $container && -n $state ]] || return 0
  builder_names=$(with_deadline 30 "${docker_local[@]}" buildx ls \
    --format '{{.Name}}') || return 1
  ! grep -Fxq "$name" <<< "$builder_names" || return 1
  container_names=$(with_deadline 30 "${docker_local[@]}" ps -a \
    --format '{{.Names}}') || return 1
  ! grep -Fxq "$container" <<< "$container_names" || return 1
  volume_names=$(with_deadline 30 "${docker_local[@]}" volume ls \
    --format '{{.Name}}') || return 1
  ! grep -Fxq "$state" <<< "$volume_names"
}

api_json() {
  local method=$1 header_file=$2 url=$3 output=$4 payload=${5:-}
  [[ $method == GET || $method == POST || $method == DELETE ]] || return 1
  [[ $url == http://windmill-server:8000/* ]] || return 1
  [[ $header_file == /dev/null || $header_file == "$run_dir/"* ]] || return 1
  [[ $output == /dev/null || $output == "$run_dir/"* ]] || return 1
  [[ -z $payload || $payload == "$run_dir/"* ]] || return 1
  python3 - "$method" "$header_file" "$url" "$payload" << 'PY' |
import pathlib
import sys

method, header_path, url, payload_path = sys.argv[1:]

def quote(value):
    escaped = (value.replace("\\", "\\\\").replace('"', '\\"')
               .replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n"))
    return f'"{escaped}"'

print("fail-with-body")
print("silent")
print("show-error")
print("connect-timeout = 3")
print("max-time = 60")
print(f"request = {quote(method)}")
print(f"url = {quote(url)}")
header = pathlib.Path(header_path).read_text(encoding="utf-8").rstrip("\n")
if header:
    print(f"header = {quote(header)}")
if payload_path:
    payload = pathlib.Path(payload_path).read_text(encoding="utf-8")
    print('header = "Content-Type: application/json"')
    print(f"data-binary = {quote(payload)}")
PY
    with_deadline 70 "${compose[@]}" exec -T windmill-server curl --config - > "$output"
}

cleanup() {
  local original_status=$?
  local role_database_count running_services owner_image_ids container_names volume_names
  trap - EXIT HUP INT TERM
  set +e +u
  cleanup_failed=${cleanup_failed:-0}

  if [[ ${token_created:-0} -eq 1 && -n ${token_prefix:-} ]]; then
    api_json DELETE "${session_header:-}" \
      "${base_url:-}/api/users/tokens/delete/$token_prefix" /dev/null || cleanup_failed=1
  fi
  if [[ ${workspace_created:-0} -eq 1 ]]; then
    api_json DELETE "${session_header:-}" \
      "${base_url:-}/api/workspaces/delete/${workspace:-}" /dev/null || cleanup_failed=1
    if api_json POST "${session_header:-}" "${base_url:-}/api/workspaces/exists" \
      "${run_dir:-}/workspace-absent.response" "${workspace_exists_payload:-}"; then
      jq -e '. == false' "${run_dir:-}/workspace-absent.response" > /dev/null || cleanup_failed=1
    else
      cleanup_failed=1
    fi
  fi

  if [[ ${compose_touched:-0} -eq 1 && ${#compose[@]} -gt 0 ]]; then
    with_deadline 60 "${compose[@]}" stop \
      windmill-worker windmill-server rd-owner-api > /dev/null 2>&1 || cleanup_failed=1
    running_services=$(with_deadline 30 "${compose[@]}" ps \
      --status running --services 2> /dev/null) || cleanup_failed=1
    if grep -Fxq postgres <<< "$running_services"; then
      with_deadline 60 "${compose[@]}" exec -T postgres psql \
        --username postgres --dbname postgres --set=ON_ERROR_STOP=1 \
        --set=windmill_database="${windmill_database:-}" > /dev/null << 'SQL' || cleanup_failed=1
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('rd_owner', :'windmill_database') AND pid<>pg_backend_pid();
DROP DATABASE IF EXISTS rd_owner WITH (FORCE);
SELECT pg_catalog.format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'windmill_database') \gexec
REVOKE operator_authorization_owner FROM operator_authorization_writer;
DROP ROLE IF EXISTS qualification_writer, backtest_owner, product_edge_owner, rd_owner, operator_authorization_writer;
DROP ROLE IF EXISTS qualification_owner, operator_authorization_owner, portfolio_owner;
SQL
      role_database_count=$(with_deadline 60 "${compose[@]}" exec -T postgres psql \
        --username postgres --dbname postgres --tuples-only --no-align \
        --set=ON_ERROR_STOP=1 \
        --command "SELECT (SELECT count(*) FROM pg_database WHERE datname IN ('rd_owner','${windmill_database:-}')) + (SELECT count(*) FROM pg_roles WHERE rolname IN ('rd_owner','operator_authorization_owner','operator_authorization_writer','qualification_owner','qualification_writer','product_edge_owner','backtest_owner','portfolio_owner'));" \
        2> /dev/null) || cleanup_failed=1
      [[ $role_database_count == 0 ]] || cleanup_failed=1
    fi
    with_deadline 90 "${compose[@]}" down --volumes --remove-orphans \
      --timeout 20 > /dev/null 2>&1 || cleanup_failed=1
  fi

  if [[ ${builder_touched:-0} -eq 1 && -n ${builder_name:-} ]]; then
    with_deadline 90 "${docker_local[@]}" buildx rm --force \
      "$builder_name" > /dev/null 2>&1 || cleanup_failed=1
  fi
  if [[ -n ${builder_container:-} && -n ${builder_state_volume:-} ]]; then
    container_names=$(with_deadline 30 "${docker_local[@]}" ps -a \
      --format '{{.Names}}') || cleanup_failed=1
    if grep -Fxq "$builder_container" <<< "$container_names"; then
      with_deadline 60 "${docker_local[@]}" container rm --force \
        "$builder_container" > /dev/null 2>&1 || cleanup_failed=1
    fi
    volume_names=$(with_deadline 30 "${docker_local[@]}" volume ls \
      --format '{{.Name}}') || cleanup_failed=1
    if grep -Fxq "$builder_state_volume" <<< "$volume_names"; then
      with_deadline 60 "${docker_local[@]}" volume rm \
        "$builder_state_volume" > /dev/null 2>&1 || cleanup_failed=1
    fi
    builder_residue_absent || cleanup_failed=1
  fi

  if [[ -n ${owner_image:-} ]]; then
    owner_image_ids=$(with_deadline 30 "${docker_local[@]}" image ls -q \
      --filter "reference=$owner_image") || cleanup_failed=1
    if [[ -n $owner_image_ids ]]; then
      with_deadline 60 "${docker_local[@]}" image rm \
        "$owner_image" > /dev/null 2>&1 || cleanup_failed=1
    fi
    owner_image_ids=$(with_deadline 30 "${docker_local[@]}" image ls -q \
      --filter "reference=$owner_image") || cleanup_failed=1
    [[ -z $owner_image_ids ]] || cleanup_failed=1
  fi

  if [[ -n ${project:-} ]]; then
    project_residue_absent || cleanup_failed=1
  fi
  if [[ ${baseline_captured:-0} -eq 1 ]]; then
    if capture_shared_baseline "$post_containers" "$post_volumes" "$post_networks"; then
      cmp -s "$baseline_containers" "$post_containers" || cleanup_failed=1
      cmp -s "$baseline_volumes" "$post_volumes" || cleanup_failed=1
      cmp -s "$baseline_networks" "$post_networks" || cleanup_failed=1
    else
      cleanup_failed=1
    fi
  fi
  if [[ -n ${run_dir:-} ]]; then
    rm -rf -- "$run_dir" || cleanup_failed=1
    [[ ! -e $run_dir && ! -L $run_dir ]] || cleanup_failed=1
  fi

  if [[ $original_status -ne 0 || $cleanup_failed -ne 0 ]]; then
    [[ $cleanup_failed -eq 0 ]] || printf '%s\n' 'sealed acceptance cleanup/readback failed' >&2
    exit 1
  fi
  exit 0
}

run_dir=$(mktemp -d "${TMPDIR:-/tmp}/source-intake-sealed-acceptance.XXXXXX")
trap cleanup EXIT HUP INT TERM
project="si-sealed-$(random_hex | cut -c1-16)"
owner_image="$project-owner:local"
builder_name="$project-buildx"
builder_node="${builder_name}0"
builder_container="buildx_buildkit_$builder_node"
builder_state_volume="${builder_container}_state"
workspace="si-sealed-$(random_hex | cut -c1-20)"
base_url=http://windmill-server:8000
env_file="$run_dir/compose.env"
bootstrap_config="$run_dir/product-edge-bootstrap.json"
session_header="$run_dir/session.header"
token_header="$run_dir/token.header"
login_payload="$run_dir/login.json"
login_response="$run_dir/login.response"
token_payload="$run_dir/token.json"
token_response="$run_dir/token.response"
workspace_payload="$run_dir/workspace.json"
workspace_exists_payload="$run_dir/workspace-exists.json"
script_payload="$run_dir/script.json"
script_create_response="$run_dir/script-create.response"
script_readback="$run_dir/script-readback.json"
metadata_json="$run_dir/source-intake-metadata.json"
baseline_containers="$run_dir/baseline-containers"
baseline_volumes="$run_dir/baseline-volumes"
baseline_networks="$run_dir/baseline-networks"
post_containers="$run_dir/post-containers"
post_volumes="$run_dir/post-volumes"
post_networks="$run_dir/post-networks"
workspace_created=0
token_created=0
token_prefix=
compose_touched=0
cleanup_failed=0
baseline_captured=0
builder_touched=0

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
{
  "authorization_identity": "sealed-authorization-$(random_hex | cut -c1-20)",
  "issuer_identity": "$issuer_identity",
  "issuer_key_version": "$issuer_key_version",
  "authorization_audience": "R_AND_D",
  "deployment_identity": "$deployment_identity",
  "binding_identity": "sealed-binding-$(random_hex | cut -c1-20)",
  "effective_principal": "sealed-acceptance-runner",
  "scope_policy_version": "sealed-acceptance-v1",
  "capability_policy_digest": "sha256:$(random_hex)$(random_hex | cut -c1-16)",
  "audit_policy_version": "sealed-acceptance-v1",
  "valid_from_epoch_ms": 1700000000000,
  "valid_through_epoch_ms": 1900000000000
}
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

compose=("${docker_local[@]}" compose --project-directory "$package_dir" --file "$compose_file"
  --env-file "$env_file" --project-name "$project")

write_auth_header() {
  python3 - "$1" "$2" << 'PY'
import json
import os
import sys

source, target = sys.argv[1:]
raw = open(source, encoding="utf-8").read().strip()
try:
    parsed = json.loads(raw)
    token = parsed if isinstance(parsed, str) else parsed.get("token", "")
except json.JSONDecodeError:
    token = raw
if not isinstance(token, str) or not token:
    raise SystemExit("Windmill returned an empty token")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as output:
    output.write("Authorization: Bearer " + token + "\n")
PY
}

capture_shared_baseline "$baseline_containers" "$baseline_volumes" "$baseline_networks"
baseline_captured=1
project_residue_absent || die "compose project already exists: $project"
builder_residue_absent || die "acceptance builder already exists: $builder_name"

builder_touched=1
with_deadline 60 "${docker_local[@]}" buildx create --name "$builder_name" \
  --node "$builder_node" --driver docker-container \
  --driver-opt "image=$buildkit_image" > /dev/null
with_deadline 900 "${docker_local[@]}" buildx build --builder "$builder_name" \
  --load --pull=false --no-cache --tag "$owner_image" \
  --file "$package_dir/Dockerfile.owner-sealed-acceptance" "$repo_root"
compose_touched=1
with_deadline 300 "${compose[@]}" up --detach --no-build --pull never --wait

for _ in $(seq 1 120); do
  if with_deadline 10 "${compose[@]}" exec -T windmill-server curl \
    --fail --silent --connect-timeout 1 --max-time 2 \
    "$base_url/api/version" > /dev/null; then
    break
  fi
  sleep 1
done
with_deadline 10 "${compose[@]}" exec -T windmill-server curl \
  --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  "$base_url/api/version" > /dev/null || die 'Windmill internal API did not become ready'

# Windmill v1.791.0 documents these public credentials for a fresh self-host DB:
# https://github.com/windmill-labs/windmill/blob/v1.791.0/README.md
# This runner owns that internal ephemeral DB and accepts no caller override.
printf '%s\n' '{"email":"admin@windmill.dev","password":"changeme"}' > "$login_payload"
# Pinned Windmill v1.791.0 OpenAPI route: POST /api/auth/login.
api_json POST /dev/null "$base_url/api/auth/login" "$login_response" "$login_payload"
write_auth_header "$login_response" "$session_header"

jq -n --arg id "$workspace" '{id: $id, name: $id}' > "$workspace_payload"
jq -n --arg id "$workspace" '{id: $id}' > "$workspace_exists_payload"
api_json POST "$session_header" "$base_url/api/workspaces/exists" \
  "$run_dir/workspace-preexisting.response" "$workspace_exists_payload"
jq -e '. == false' "$run_dir/workspace-preexisting.response" > /dev/null
api_json POST "$session_header" "$base_url/api/workspaces/create" \
  "$run_dir/workspace-create.response" "$workspace_payload"
workspace_created=1
api_json POST "$session_header" "$base_url/api/workspaces/exists" \
  "$run_dir/workspace-created.response" "$workspace_exists_payload"
jq -e '. == true' "$run_dir/workspace-created.response" > /dev/null

expiration=$(
  python3 - << 'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"))
PY
)
token_label="sealed-acceptance-$(random_hex | cut -c1-16)"
jq -n --arg label "$token_label" --arg expiration "$expiration" --arg workspace "$workspace" \
  '{label: $label, expiration: $expiration, workspace_id: $workspace}' > "$token_payload"
api_json POST "$session_header" "$base_url/api/users/tokens/create" \
  "$token_response" "$token_payload"
write_auth_header "$token_response" "$token_header"
token_created=1
api_json GET "$session_header" "$base_url/api/users/tokens/list?exclude_ephemeral=false" \
  "$run_dir/tokens.json"
token_prefix=$(jq -er --arg label "$token_label" \
  '[.[] | select(.label == $label)] | if length == 1 then .[0].token_prefix else error("token readback mismatch") end' \
  "$run_dir/tokens.json")

yq -o=json "$metadata_file" > "$metadata_json"
python3 - "$source_file" "$lock_file" "$metadata_json" "$script_payload" "$script_path" << 'PY'
import json
import os
import sys

source_path, lock_path, metadata_path, output_path, script_path = sys.argv[1:]
metadata = json.load(open(metadata_path, encoding="utf-8"))
body = {
    "content": open(source_path, encoding="utf-8").read(),
    "description": metadata["description"],
    "language": "bun",
    "path": script_path,
    "summary": metadata["summary"],
    "kind": metadata["kind"],
    "lock": open(lock_path, encoding="utf-8").read(),
    "schema": metadata["schema"],
    "tag": metadata["tag"],
    "deployment_message": "isolated Source Intake SEALED_ACCEPTANCE",
}
fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as output:
    json.dump(body, output, separators=(",", ":"), ensure_ascii=False)
PY

api_json POST "$token_header" "$base_url/api/w/$workspace/scripts/create" \
  "$script_create_response" "$script_payload"
api_json GET "$token_header" "$base_url/api/w/$workspace/scripts/get/p/$script_path" \
  "$script_readback"
source_sha256=$(sha256_file "$source_file")
python3 - "$source_file" "$lock_file" "$script_create_response" "$script_readback" \
  "$script_path" "$source_sha256" << 'PY'
import hashlib
import json
import sys

source_path, lock_path, create_path, readback_path, expected_path, expected_sha = sys.argv[1:]
source = open(source_path, "rb").read()
lock = open(lock_path, encoding="utf-8").read()
readback = json.load(open(readback_path, encoding="utf-8"))
create_raw = open(create_path, encoding="utf-8").read().strip()
try:
    create_value = json.loads(create_raw)
except json.JSONDecodeError:
    create_value = create_raw
if isinstance(create_value, dict):
    create_hash = create_value.get("hash")
else:
    create_hash = create_value
if readback.get("path") != expected_path or readback.get("language") != "bun":
    raise SystemExit("deployed script identity/language mismatch")
if readback.get("content", "").encode() != source:
    raise SystemExit("deployed script content differs from repository bytes")
if readback.get("lock", "") != lock:
    raise SystemExit("deployed script lock differs from repository bytes")
if not readback.get("hash") or str(readback["hash"]) != str(create_hash):
    raise SystemExit("deployed script create/readback hash mismatch")
if hashlib.sha256(source).hexdigest() != expected_sha:
    raise SystemExit("source content hash mismatch")
PY

interpretation='{"bounded_explanation":"Sealed acceptance fixture","plausible_alternatives":["alternative-a","alternative-b"],"differentiating_prediction":"The fixed DOI resolves deterministically","falsifier":"A mismatched terminal or duplicate physical invocation"}'
make_run_payload() {
  jq -n --arg action "$1" --arg request_identity "$2" --arg doi "$3" \
    --argjson interpretation "$interpretation" \
    'if $action == "RUN" then {action: $action, request_identity: $request_identity, normalized_doi: $doi, interpretation: $interpretation} else {action: $action, request_identity: $request_identity} end' \
    > "$4" || stage_fail "$5"
}
run_deployed() {
  api_json POST "$token_header" \
    "$base_url/api/w/$workspace/jobs/run_wait_result/p/$script_path" "$2" "$1"
}
audit_count() {
  # The expansion is intentionally inside the worker, where the token is an
  # allowlisted environment secret and never appears in the host command line.
  # shellcheck disable=SC2016
  with_deadline 30 "${compose[@]}" exec -T windmill-worker sh -c \
    'curl --fail --silent --show-error --connect-timeout 2 --max-time 10 -H "Authorization: Bearer $RD_OWNER_API_TOKEN" http://rd-owner-api:8080/v1/source-intakes/sealed-acceptance/audit' |
    jq -er '.physical_provider_invocations'
}
positive_counts() {
  with_deadline 30 "${compose[@]}" exec -T postgres psql --username postgres --dbname rd_owner \
    --tuples-only --no-align --set=ON_ERROR_STOP=1 --command \
    "SELECT json_build_array((SELECT count(*) FROM public.rd_source_raw_payloads_v1),(SELECT count(*) FROM public.rd_research_source_provenance_v1),(SELECT count(*) FROM public.rd_source_candidates_v1),(SELECT count(*) FROM public.rd_source_intake_receipts_v1 WHERE terminal='RETRIEVED'));" |
    canonical_positive_counts
}
private_owner_resolve() {
  local request_identity=$1 output=$2
  [[ $request_identity =~ ^[A-Za-z0-9._-]{1,192}$ ]] || return 1
  [[ $output == "$run_dir/"* ]] || return 1
  # Both the request identity and Owner response use stdin/stdout. The worker
  # expands its allowlisted token internally, so no credential reaches argv.
  # shellcheck disable=SC2016
  printf '%s\n' "$request_identity" |
    with_deadline 30 "${compose[@]}" exec -T windmill-worker sh -eu -c '
      IFS= read -r request_identity
      case $request_identity in
        "" | *[!A-Za-z0-9._-]*) exit 2 ;;
      esac
      exec curl --fail --silent --show-error --connect-timeout 2 --max-time 10 \
        --max-filesize 2097152 --request POST \
        --header "Authorization: Bearer $RD_OWNER_API_TOKEN" \
        --header "Content-Type: application/json" --data "{}" \
        "http://rd-owner-api:8080/v1/source-intakes/$request_identity/resolve"
    ' > "$output"
}
diagnose_product_edge_unknown() {
  local request_identity=$1 diagnostic_file=$2
  local audit_before audit_after counts_before counts_after code
  if ! audit_before=$(audit_count 2> /dev/null) ||
    ! counts_before=$(positive_counts 2> /dev/null) ||
    ! private_owner_resolve "$request_identity" "$diagnostic_file" 2> /dev/null ||
    ! audit_after=$(audit_count 2> /dev/null) ||
    ! counts_after=$(positive_counts 2> /dev/null); then
    diagnostic_message DIAGNOSTIC_UNAVAILABLE >&2
    return
  fi
  if [[ $audit_before != "$audit_after" || $counts_before != "$counts_after" ]]; then
    diagnostic_message DIAGNOSTIC_EFFECT_CHANGED >&2
    return
  fi
  if ! code=$(owner_terminal_diagnostic_code "$request_identity" "$diagnostic_file" 2> /dev/null); then
    diagnostic_message DIAGNOSTIC_UNAVAILABLE >&2
    return
  fi
  diagnostic_message "$code" >&2 || diagnostic_message DIAGNOSTIC_UNAVAILABLE >&2
}
assert_retrieved() {
  local response_file=$1 stage=$2 request_identity=$3
  if jq -e '
    .resolution == "RETRIEVED"
    and .authority_class == "SEALED_ACCEPTANCE"
    and .environment_identity == "source-intake-sealed-acceptance-environment-v1"
    and .provider_profile_digest == "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15"
    and .fixture_corpus_digest == "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18"
    and (.content_locator | type == "string" and length > 0)
    and (.content_digest | test("^sha256:[0-9a-f]{64}$"))
    and (.provenance_identity | type == "string" and length > 0)
    and (.source_candidate_identity | type == "string" and length > 0)
    and (.outbox_event_identity | type == "string" and length > 0)
    and (.receipt.receipt_identity | type == "string" and length > 0)
  ' "$response_file" > /dev/null; then
    return
  fi
  diagnose_product_edge_unknown "$request_identity" "$run_dir/$stage.owner-diagnostic.json"
  stage_fail "$stage"
}

expect_value initial-audit-count 0 "$(audit_count)"
expect_value initial-positive-counts '[0,0,0,0]' "$(positive_counts)"

success_request="sealed-success-$(random_hex | cut -c1-16)"
make_run_payload RUN "$success_request" 10.5555/sealed-success \
  "$run_dir/success-run.json" success-run-payload
make_run_payload RESOLVE "$success_request" '' \
  "$run_dir/success-resolve.json" success-resolve-payload
run_deployed "$run_dir/success-run.json" "$run_dir/success-1.response" ||
  stage_fail success-first-run
run_deployed "$run_dir/success-run.json" "$run_dir/success-2.response" ||
  stage_fail success-second-run
run_deployed "$run_dir/success-resolve.json" "$run_dir/success-resolve.response" ||
  stage_fail success-resolve
assert_retrieved "$run_dir/success-1.response" success-retrieved-shape "$success_request"
cmp -s "$run_dir/success-1.response" "$run_dir/success-2.response" ||
  stage_fail success-run-idempotency
cmp -s "$run_dir/success-1.response" "$run_dir/success-resolve.response" ||
  stage_fail success-resolve-idempotency
expect_value success-audit-count 1 "$(audit_count)"
expect_value success-positive-counts '[1,1,1,1]' "$(positive_counts)"

rejected_request="sealed-rejected-$(random_hex | cut -c1-16)"
make_run_payload RUN "$rejected_request" 10.5555/sealed-rejected \
  "$run_dir/rejected-run.json" rejected-run-payload
run_deployed "$run_dir/rejected-run.json" "$run_dir/rejected.response" ||
  stage_fail rejected-run
jq -e '
  .resolution == "TERMS_OR_LICENSE_BLOCKED"
  and .authority_class == "SEALED_ACCEPTANCE"
  and .environment_identity == "source-intake-sealed-acceptance-environment-v1"
  and .provider_profile_digest == "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15"
  and .fixture_corpus_digest == "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18"
  and (.content_locator? == null)
  and (.content_digest? == null)
  and (.provenance_identity? == null)
  and (.source_candidate_identity? == null)
  and (.outbox_event_identity | type == "string" and length > 0)
' "$run_dir/rejected.response" > /dev/null || stage_fail rejected-shape
expect_value rejected-audit-count 1 "$(audit_count)"
expect_value rejected-positive-counts '[1,1,1,1]' "$(positive_counts)"

loss_request="sealed-response-loss-$(random_hex | cut -c1-16)"
make_run_payload RUN "$loss_request" 10.5555/sealed-response-loss \
  "$run_dir/loss-run.json" response-loss-run-payload
make_run_payload RESOLVE "$loss_request" '' \
  "$run_dir/loss-resolve.json" response-loss-resolve-payload
run_deployed "$run_dir/loss-run.json" "$run_dir/loss-first.response" ||
  stage_fail response-loss-first-run
jq -e --arg request "$loss_request" '
  .request_identity == $request
  and .resolution == "SUBMITTED_OR_UNKNOWN"
  and .next_legal_action == "RESOLVE_SAME_REQUEST"
' "$run_dir/loss-first.response" > /dev/null || stage_fail response-loss-first-shape
run_deployed "$run_dir/loss-run.json" "$run_dir/loss-second.response" ||
  stage_fail response-loss-second-run
run_deployed "$run_dir/loss-resolve.json" "$run_dir/loss-resolve.response" ||
  stage_fail response-loss-resolve
assert_retrieved "$run_dir/loss-second.response" response-loss-retrieved-shape "$loss_request"
cmp -s "$run_dir/loss-second.response" "$run_dir/loss-resolve.response" ||
  stage_fail response-loss-resolve-idempotency
expect_value response-loss-audit-count 2 "$(audit_count)"
expect_value response-loss-positive-counts '[2,2,2,2]' "$(positive_counts)"

printf '%s\n' 'Source Intake SEALED_ACCEPTANCE passed; cleanup/readback follows'
