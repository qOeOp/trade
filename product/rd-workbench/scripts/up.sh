#!/usr/bin/env bash
# Brings up the local R&D deployment with one command, re-entrantly.
#
# Every credential, signing seed and sealed command is generated on this machine into a private
# state directory (default product/rd-workbench/.local, ignored by Git) and never printed. Each step
# first measures whether it has already happened and, if so, says "skip <step>: <reason>" instead
# of running again. The compose project and its volumes are trade-rd-local, separate from any other
# deployment of this package; nothing here reads or touches another project's volume.
#
# Docker runs with an empty environment plus the state directory's env file, so no API key from the
# calling shell (DATABENTO_API_KEY, DEEPSEEK_API_KEY, ...) can reach a container. Exchange
# credentials are never read.
#
# Optional:
#   RD_LOCAL_STATE_DIR          state directory (default: product/rd-workbench/.local)
#   RD_LOCAL_API_PORT           loopback port for rd-owner-api (default: 18080)
#   RD_LOCAL_ACCEPTANCE_SCRIPT  a script run last as `<script> probe http://127.0.0.1:<port>`, with
#                               RD_OWNER_API_TOKEN exported from the env file
set -euo pipefail

package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH='' cd -- "$package_dir/../.." && pwd)
state_dir=${RD_LOCAL_STATE_DIR:-$package_dir/.local}
api_port=${RD_LOCAL_API_PORT:-18080}
project=trade-rd-local
env_file=$state_dir/.env
catalog_dir=$state_dir/catalog
owner_image=$project-rd-owner-api
owner_services=(rd-owner-api schema-materialize authority-schema-materialize authority-additive-table-migrate
  replay-policy-catalog-bootstrap replay-policy-catalog-owner-readback authority-bootstrap)

log() { printf '%s\n' "$*"; }
skip() { log "skip $1: $2"; }
run() { log "run  $1"; }

umask 077
mkdir -p "$state_dir" "$catalog_dir" "$state_dir/steps"

# Docker Desktop's credential helper can hang every registry resolution, and the build then dies
# silently. A private Docker config without the helper avoids it and leaves the user's untouched.
docker_config=$state_dir/docker-config
mkdir -p "$docker_config"
python3 - "$HOME/.docker/config.json" "$docker_config/config.json" << 'EOF'
import json, os, sys
source, target = sys.argv[1], sys.argv[2]
config = json.load(open(source)) if os.path.exists(source) else {}
config.pop("credsStore", None)
config.pop("auths", None)
config.pop("credHelpers", None)
open(target, "w").write(json.dumps(config))
EOF
for link in cli-plugins contexts; do
  if [ -e "$HOME/.docker/$link" ]; then ln -sfn "$HOME/.docker/$link" "$docker_config/$link"; fi
done

dock() { env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$docker_config" RD_LOCAL_API_PORT="$api_port" docker "$@"; }
compose() {
  dock compose --project-name "$project" --env-file "$env_file" \
    -f "$package_dir/docker-compose.yml" -f "$package_dir/local/docker-compose.local.yml" \
    --profile authority-admin "$@"
}
psql_scalar() { compose exec -T postgres psql -U postgres -d rd_owner -v ON_ERROR_STOP=1 -tAc "$1"; }

# 1. The env file: one random value per secret, every URL pointing at this stack's own database.
# A key already in the file is never regenerated or rewritten - the postgres volume's roles were
# provisioned with whatever password is already there, so changing it would lock the stack out of
# its own database. Only a key .env.example gained since this file was written is added, so a
# build that needs a new credential (RD_SCHEMA_MIGRATOR_DATABASE_URL, say) still gets one on an
# existing deployment, without regenerating anything that already works.
env_fill_result=$(
  python3 - "$package_dir/.env.example" "$env_file" "$state_dir" << 'EOF'
import os, secrets, sys
example, target, state = sys.argv[1:4]
urls = {
    "RD_OWNER_DATABASE_URL": ("rd_owner", "RD_OWNER_DB_PASSWORD"),
    "RD_FACT_WRITER_DATABASE_URL": ("rd_fact_writer", "RD_FACT_WRITER_DB_PASSWORD"),
    "MARKET_DATA_OWNER_DATABASE_URL": ("market_data_owner", "MARKET_DATA_OWNER_DB_PASSWORD"),
    "MARKET_DATA_RD_ROLE_SET_DATABASE_URL": ("market_data_reader", "MARKET_DATA_READER_DB_PASSWORD"),
    "INSTRUMENT_OWNER_DATABASE_URL": ("instrument_owner", "INSTRUMENT_OWNER_DB_PASSWORD"),
    "REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL": (
        "replay_policy_catalog_admin_writer", "REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD"),
    "QUALIFICATION_OWNER_DATABASE_URL": ("qualification_writer", "QUALIFICATION_OWNER_DB_PASSWORD"),
    "OPERATOR_AUTHORIZATION_DATABASE_URL": (
        "operator_authorization_writer", "OPERATOR_AUTHORIZATION_DB_PASSWORD"),
    "PRODUCT_EDGE_DATABASE_URL": ("product_edge_owner", "PRODUCT_EDGE_DB_PASSWORD"),
    "RD_SCHEMA_MIGRATOR_DATABASE_URL": ("rd_schema_migrator", "RD_SCHEMA_MIGRATOR_DB_PASSWORD"),
}
paths = {
    "PRODUCT_EDGE_BOOTSTRAP_CONFIG": "product-edge-bootstrap.json",
    "PRODUCT_EDGE_RECOVERY_CONFIG": "product-edge-recovery.json",
    "REPLAY_POLICY_CATALOG_BOOTSTRAP_CREATE_COMMAND": "catalog/create-command.json",
    "REPLAY_POLICY_CATALOG_BOOTSTRAP_ADVANCE_COMMAND": "catalog/advance-command.json",
    "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY": "catalog/verifier-public-key.hex",
}
empty = {"STORE_CUSTODY_PUBLISHER_DATABASE_URL"}
existing = {}
if os.path.exists(target):
    for line in open(target):
        line = line.rstrip("\n")
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            existing[key] = value
lines = [line.rstrip("\n") for line in open(example)]
keys = [
    line.split("=", 1)[0]
    for line in lines
    if line and not line.startswith("#") and "=" in line
]
added = [key for key in keys if key not in existing]
values = {}
for key in added:
    if key.endswith("_PASSWORD") or key.endswith("_TOKEN") or key.endswith("_HMAC_KEY"):
        values[key] = secrets.token_hex(32)
values.setdefault("PRODUCT_EDGE_DEPLOYMENT_IDENTITY", "trade-rd-local-v1")
for key in added:
    if key in urls:
        role, password = urls[key]
        value = f"postgres://{role}:{values[password]}@postgres:5432/rd_owner"
    elif key in paths:
        value = os.path.join(state, paths[key])
    elif key in empty:
        value = ""
    elif key in values:
        value = values[key]
    else:
        value = next(
            line.split("=", 1)[1] for line in lines if line.startswith(f"{key}=")
        )
    if "replace-with" in value or "/absolute/path/to" in value:
        sys.exit(f"{key} kept a placeholder")
    existing[key] = value
if os.path.exists(target):
    with open(target, "a") as handle:
        for key in added:
            handle.write(f"{key}={existing[key]}\n")
else:
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write("\n".join(f"{key}={existing[key]}" for key in keys) + "\n")
print(",".join(added))
EOF
)
if [ -n "$env_fill_result" ]; then
  run env
  log "added keys: $env_fill_result"
else
  skip env "$env_file already has every key .env.example names"
fi
env_value() { sed -n "s/^$1=//p" "$env_file"; }
if grep -Eq 'replace-with|/absolute/path/to' "$env_file"; then
  log "$env_file still holds a placeholder"
  exit 1
fi

# 2. The images, from this checkout. Inputs that are committed, clean and already built are not
# rebuilt; the key is what the Owner image copies in, so a commit elsewhere does not rebuild it.
build_inputs=(Cargo.toml Cargo.lock crates patches examples/tutorials product/rd-workbench/Dockerfile.owner
  product/rd-workbench/Dockerfile.sandbox product/rd-workbench/postgres-init)
tree=$(git -C "$repo_root" ls-tree HEAD -- "${build_inputs[@]}" | shasum -a 256 | cut -d' ' -f1)
dirty=$(git -C "$repo_root" status --porcelain -- "${build_inputs[@]}")
if [ -z "$dirty" ] && [ "$(cat "$state_dir/steps/build" 2> /dev/null)" = "$tree" ] &&
  dock image inspect "$owner_image" > /dev/null 2>&1; then
  skip build "images already built from these inputs"
else
  run build
  compose build "${owner_services[@]}"
  if [ -z "$dirty" ]; then printf '%s\n' "$tree" > "$state_dir/steps/build"; else rm -f "$state_dir/steps/build"; fi
fi
image_id=$(dock image inspect --format '{{.Id}}' "$owner_image")

# 3. The sealed Replay Policy Catalog commands, from local/replay-policy-catalog.json and a signing
# seed generated here. The sealer runs in the Owner image with no network; the seed never leaves
# the state directory. The policy's replay configuration digest is the economic configuration's,
# which only the sealer computes, so the first seal is a measurement and is discarded.
if [ -f "$catalog_dir/create-command.json" ] && [ -f "$catalog_dir/advance-command.json" ] &&
  [ -f "$catalog_dir/verifier-public-key.hex" ]; then
  skip catalog-seal "sealed commands exist in $catalog_dir"
else
  run catalog-seal
  rm -f "$catalog_dir"/create-command.json "$catalog_dir"/advance-command.json "$catalog_dir"/measure.json
  [ -f "$catalog_dir/signing-key.hex" ] || openssl rand -hex 32 > "$catalog_dir/signing-key.hex"
  seal() { # authoring output
    dock run --rm --network none --user "$(id -u):$(id -g)" -v "$catalog_dir:/work" \
      -e REPLAY_POLICY_CATALOG_COMMAND_AUTHORING_PATH="/work/$1" \
      -e REPLAY_POLICY_CATALOG_SIGNING_KEY_PATH=/work/signing-key.hex \
      -e REPLAY_POLICY_CATALOG_SEALED_COMMAND_OUTPUT_PATH="/work/$2" \
      --entrypoint /usr/local/bin/replay-policy-catalog-command-seal "$owner_image"
  }
  author() { # kind digest-or-empty output
    python3 - "$package_dir/local/replay-policy-catalog.json" "$1" "$2" \
      "$(env_value REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY)" "$catalog_dir/$3" << 'EOF'
import json, sys
template, kind, digest, verifier, target = sys.argv[1:6]
doc = json.load(open(template))
if digest:
    doc["policy"]["replay_configuration"]["digest"] = "sha256:" + digest
else:
    doc["policy"]["replay_configuration"]["digest"] = "sha256:" + "0" * 64
record = "trade-rd-local-replay-policy-v1"
authoring = {
    "command_identity": f"{record}-{kind.lower()}",
    "command_kind": kind,
    "administrator_identity": "trade-rd-local-catalog-administrator-v1",
    "verifier_identity": verifier,
    "expected_predecessor_record_id": None,
    "expected_head_record_id": None,
    "catalog_record_id": record,
    "catalog_version": 1,
    "policy": doc["policy"],
    "economic_configuration": doc["economic_configuration"],
    "runner_operational_profile": doc["runner_operational_profile"],
    "now_epoch_ms": 1,
}
open(target, "w").write(json.dumps(authoring))
EOF
  }
  author CREATE "" measure-authoring.json
  seal measure-authoring.json measure.json > /dev/null
  economic_digest=$(
    python3 - "$catalog_dir/measure.json" << 'EOF'
import json, sys
def find(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "economic_configuration_digest_hex":
                return value
            found = find(value)
            if found:
                return found
    if isinstance(node, list):
        for value in node:
            found = find(value)
            if found:
                return found
    return None
digest = find(json.load(open(sys.argv[1])))
if not digest:
    sys.exit("the sealed command carries no economic_configuration_digest_hex")
print(digest)
EOF
  )
  rm -f "$catalog_dir/measure.json" "$catalog_dir/measure-authoring.json"
  author CREATE "$economic_digest" create-authoring.json
  author ADVANCE "$economic_digest" advance-authoring.json
  seal advance-authoring.json advance-command.json > /dev/null
  seal create-authoring.json create-command.json > "$catalog_dir/create-summary.json"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["verifier_public_key_hex"])' \
    "$catalog_dir/create-summary.json" > "$catalog_dir/verifier-public-key.hex"
fi

# 4. The Product Edge genesis configuration: plain JSON whose identities equal the trust variables.
if [ -f "$(env_value PRODUCT_EDGE_BOOTSTRAP_CONFIG)" ]; then
  skip product-edge-config "$(env_value PRODUCT_EDGE_BOOTSTRAP_CONFIG) exists"
else
  run product-edge-config
  python3 - "$(env_value PRODUCT_EDGE_BOOTSTRAP_CONFIG)" "$(env_value PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY)" \
    "$(env_value PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION)" "$(env_value PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE)" \
    "$(env_value PRODUCT_EDGE_DEPLOYMENT_IDENTITY)" << 'EOF'
import hashlib, json, sys, time
target, issuer, key_version, audience, deployment = sys.argv[1:6]
config = {
    "authorization_identity": "trade-rd-local-operator-authorization-v1",
    "issuer_identity": issuer,
    "issuer_key_version": key_version,
    "authorization_audience": audience,
    "deployment_identity": deployment,
    "binding_identity": "trade-rd-local-product-edge-binding-v1",
    "effective_principal": "trade-rd-local-operator",
    "scope_policy_version": "trade-rd-local-scope-policy-v1",
    "capability_policy_digest": "sha256:" + hashlib.sha256(b"trade-rd-local-capability-policy-v1").hexdigest(),
    "audit_policy_version": "trade-rd-local-audit-policy-v1",
    "valid_from_epoch_ms": int(time.time() * 1000),
    "valid_through_epoch_ms": 4102444800000,
}
open(target, "w").write(json.dumps(config, indent=2) + "\n")
EOF
fi

# 5. PostgreSQL on this project's own volume.
postgres_container=$(compose ps -q postgres 2> /dev/null || true)
if [ -n "$postgres_container" ] &&
  [ "$(dock inspect --format '{{.State.Health.Status}}' "$postgres_container" 2> /dev/null)" = healthy ]; then
  skip postgres "running and healthy"
else
  run postgres
  compose up -d --wait postgres
fi
volume_created=$(dock volume inspect --format '{{.CreatedAt}}' "${project}_postgres-data")

# 6. The R&D schema. It can run only before the custody cutover, so a cut-over store skips it.
private_schemas=$(psql_scalar "SELECT count(*) FROM pg_namespace WHERE nspname IN ('replay_policy_catalog_private','composer_private')")
case "$private_schemas" in
  2) skip schema-materialize "the store is already cut over" ;;
  0)
    run schema-materialize
    compose run --rm --no-deps schema-materialize
    ;;
  *)
    log "schema-materialize: the store is partly cut over ($private_schemas of 2 private schemas)"
    exit 1
    ;;
esac

# 7 and 8. The custody migration and the authority schema. Both are idempotent; each is skipped
# once it has run on this volume with this script and this image.
once() { # step key command...
  local step=$1 key=$2
  shift 2
  if [ "$(cat "$state_dir/steps/$step" 2> /dev/null)" = "$key" ]; then
    skip "$step" "already ran on this volume with these inputs"
  else
    run "$step"
    "$@"
    printf '%s\n' "$key" > "$state_dir/steps/$step"
  fi
}
migrate_digest=$(shasum -a 256 "$package_dir/postgres-init/10-migrate-authority-custody.sh" | cut -d' ' -f1)
once authority-custody-migrate "$volume_created $migrate_digest $image_id" \
  compose run --rm --no-deps authority-custody-migrate
once authority-schema-materialize "$volume_created $image_id" \
  compose run --rm --no-deps authority-schema-materialize
# A new build may add an R&D table this volume's custody was already cut over before; keyed by
# image so a rebuild always re-checks, same as authority-schema-materialize. Additive only: see
# crates/strategy_factory/src/schema_materialization.rs.
once authority-additive-table-migrate "$volume_created $image_id" \
  compose run --rm --no-deps authority-additive-table-migrate

# 9. Product Edge genesis.
if [ "$(psql_scalar 'SELECT count(*) FROM public.product_edge_deployment_bindings_v1')" != 0 ]; then
  skip authority-bootstrap "a Product Edge deployment binding exists"
else
  run authority-bootstrap
  compose run --rm --no-deps authority-bootstrap > /dev/null
fi

# 10. Replay Policy Catalog genesis, then the Owner's readback of it, which gates every start.
if [ "$(psql_scalar 'SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_execution_profiles_v3')" != 0 ]; then
  skip replay-policy-catalog-bootstrap "a Catalog V3 head is published"
else
  run replay-policy-catalog-bootstrap
  compose run --rm --no-deps replay-policy-catalog-bootstrap > /dev/null
fi
log "check replay-policy-catalog-owner-readback"
compose run --rm --no-deps replay-policy-catalog-owner-readback > /dev/null

# 11. The R&D Owner API on 127.0.0.1:$api_port.
api_container=$(compose ps -q rd-owner-api 2> /dev/null || true)
if [ -n "$api_container" ] &&
  [ "$(dock inspect --format '{{.Image}}' "$api_container")" = "$image_id" ] &&
  [ "$(dock inspect --format '{{.State.Health.Status}}' "$api_container")" = healthy ]; then
  skip rd-owner-api "running and healthy on the current image"
else
  run rd-owner-api
  compose up -d --no-deps --wait rd-owner-api
fi
health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$api_port/health")
if [ "$health" != 200 ]; then
  log "rd-owner-api /health answered $health"
  exit 1
fi
log "ready rd-owner-api http://127.0.0.1:$api_port"

if [ -n "${RD_LOCAL_ACCEPTANCE_SCRIPT:-}" ]; then
  RD_OWNER_API_TOKEN=$(env_value RD_OWNER_API_TOKEN) \
    bash "$RD_LOCAL_ACCEPTANCE_SCRIPT" probe "http://127.0.0.1:$api_port"
fi
