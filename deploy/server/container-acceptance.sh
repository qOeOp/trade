#!/bin/sh
set -eu

action=${1:-}
package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

fail() {
  printf '%s\n' "container acceptance: $*" >&2
  exit 1
}

require_linux_archive_tools() {
  [ "$(uname -s)" = "Linux" ] || fail "Linux host required"
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
}

require_linux_container_tools() {
  require_linux_archive_tools
  command -v docker >/dev/null 2>&1 || fail "docker is required"
  docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
  docker buildx version >/dev/null 2>&1 || fail "docker buildx is required"
}

verify_package() {
  require_linux_archive_tools
  (
    cd "$package_root"
    sha256sum --check SHA256SUMS
  )
}

resolve_work_root() {
  work_root=${TRADE_CONTAINER_ACCEPTANCE_ROOT:-}
  case "$work_root" in
    /*) ;;
    *) fail "TRADE_CONTAINER_ACCEPTANCE_ROOT must be an absolute path" ;;
  esac
  [ "$work_root" != "/" ] || fail "TRADE_CONTAINER_ACCEPTANCE_ROOT is too broad"
}

unpack_source() {
  verify_package
  resolve_work_root
  [ ! -e "$work_root" ] || fail "acceptance root already exists"
  mkdir -p "$(dirname -- "$work_root")"
  mkdir "$work_root"
  tar -xf "$package_root/source.tar" -C "$work_root"
}

read_source_commit() {
  source_commit=$(tr -d '\r\n' < "$package_root/SOURCE_COMMIT")
  case "$source_commit" in
    *[!0-9a-f]*|"") fail "SOURCE_COMMIT is invalid" ;;
  esac
  [ "${#source_commit}" -eq 40 ] || fail "SOURCE_COMMIT must be a full Git hash"
}

prepare_evidence_dir() {
  evidence_dir=${TRADE_CONTAINER_EVIDENCE_DIR:-}
  case "$evidence_dir" in
    /*) ;;
    *) fail "TRADE_CONTAINER_EVIDENCE_DIR must be an absolute path" ;;
  esac
  [ "$evidence_dir" != "/" ] || fail "TRADE_CONTAINER_EVIDENCE_DIR is too broad"
  mkdir -p "$evidence_dir"
}

build_image() {
  require_linux_container_tools
  resolve_work_root
  read_source_commit
  prepare_evidence_dir
  [ -f "$work_root/deploy/server/Dockerfile" ] || fail "acceptance source is not unpacked"
  short_commit=$(printf '%s' "$source_commit" | cut -c1-12)
  image_tag="trade-runtime:acceptance-$short_commit"
  docker buildx build \
    --pull \
    --load \
    --provenance=mode=max \
    --sbom=true \
    --tag "$image_tag" \
    --target runtime \
    --build-arg "TRADE_SOURCE_REVISION=$source_commit" \
    --file "$work_root/deploy/server/Dockerfile" \
    "$work_root"
  image_id=$(docker image inspect --format '{{.Id}}' "$image_tag")
  created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '{"schema_version":"trade.server-container-build-evidence.v1","source_commit":"%s","image_tag":"%s","image_id":"%s","created_at":"%s","sbom_requested":true,"provenance_requested":"mode=max","live_writes_allowed":false}\n' \
    "$source_commit" "$image_tag" "$image_id" "$created_at" \
    > "$evidence_dir/build-evidence.json"
}

wait_healthy() {
  container_id=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")
    [ "$health" = "healthy" ] && return 0
    [ "$health" != "unhealthy" ] || fail "runtime container became unhealthy"
    attempts=$((attempts + 1))
    sleep 5
  done
  fail "runtime container did not become healthy within 300 seconds"
}

smoke_runtime() {
  require_linux_container_tools
  resolve_work_root
  read_source_commit
  prepare_evidence_dir
  [ -f "$work_root/deploy/server/compose.yaml" ] || fail "acceptance source is not unpacked"
  short_commit=$(printf '%s' "$source_commit" | cut -c1-12)
  acceptance_id=${TRADE_CONTAINER_ACCEPTANCE_ID:-"$short_commit-$$"}
  case "$acceptance_id" in
    *[!a-z0-9-]*|"") fail "TRADE_CONTAINER_ACCEPTANCE_ID must contain only lowercase letters, digits, and hyphens" ;;
  esac
  project_name="trade-acceptance-$acceptance_id"
  export TRADE_IMAGE_TAG="acceptance-$short_commit"
  export TRADE_ENVIRONMENT_ID="server:acceptance"
  export TRADE_SOURCE_REVISION="$source_commit"
  compose() {
    docker compose \
      --project-name "$project_name" \
      -f "$work_root/deploy/server/compose.yaml" \
      "$@"
  }
  cleanup() {
    compose down >/dev/null 2>&1 || true
  }
  trap cleanup EXIT HUP INT TERM
  compose config --quiet
  compose up --detach --no-build runtime
  container_id=$(compose ps --quiet runtime)
  [ -n "$container_id" ] || fail "runtime container was not created"
  wait_healthy "$container_id"
  compose exec -T runtime \
    bun apps/orchestration-ops/trade-flow/src/scripts/server-runtime-container-status.ts \
    > "$evidence_dir/status-before-restart.json"
  canary="acceptance-$source_commit"
  compose exec -T runtime sh -c \
    'printf "%s\n" "$1" > /app/tmp/server-runtime/acceptance-volume-canary' \
    sh "$canary"
  compose restart runtime
  container_id=$(compose ps --quiet runtime)
  [ -n "$container_id" ] || fail "runtime container disappeared after restart"
  wait_healthy "$container_id"
  observed=$(compose exec -T runtime \
    sh -c 'cat /app/tmp/server-runtime/acceptance-volume-canary')
  [ "$observed" = "$canary" ] || fail "named-volume canary did not survive restart"
  compose exec -T runtime \
    bun apps/orchestration-ops/trade-flow/src/scripts/server-runtime-container-status.ts \
    > "$evidence_dir/status-after-restart.json"
  image_id=$(docker image inspect --format '{{.Id}}' "trade-runtime:$TRADE_IMAGE_TAG")
  created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  compose down
  printf '{"schema_version":"trade.server-container-smoke-evidence.v1","source_commit":"%s","image_id":"%s","compose_project":"%s","created_at":"%s","healthy_before_restart":true,"healthy_after_restart":true,"named_volume_canary_survived":true,"containers_stopped":true,"volumes_deleted":false,"live_writes_allowed":false}\n' \
    "$source_commit" "$image_id" "$project_name" "$created_at" \
    > "$evidence_dir/smoke-evidence.json"
  trap - EXIT HUP INT TERM
}

case "$action" in
  verify)
    verify_package
    ;;
  unpack)
    unpack_source
    ;;
  build)
    verify_package
    build_image
    ;;
  smoke)
    verify_package
    smoke_runtime
    ;;
  all)
    unpack_source
    build_image
    smoke_runtime
    ;;
  *)
    fail "usage: container-acceptance.sh verify|unpack|build|smoke|all"
    ;;
esac
