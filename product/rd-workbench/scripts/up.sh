#!/usr/bin/env bash
# Brings up the local R&D deployment with one command, re-entrantly.
#
# Every credential, signing seed and sealed command is generated on this machine into a private
# state directory (default product/rd-workbench/.local, ignored by Git) and never printed. Each step
# first measures whether it has already happened and, if so, says "skip <step>: <reason>" instead
# of running again. The compose project and its volumes are trade-rd-local unless RD_LOCAL_PROJECT
# names another, separate from any other deployment of this package; nothing here reads or touches
# another project's volume or state directory (scripts/local-deployment.bash).
#
# Docker runs with an empty environment plus the state directory's env file, so no API key from the
# calling shell (DATABENTO_API_KEY, DEEPSEEK_API_KEY, ...) can reach a container. Exchange
# credentials are never read.
#
# Optional:
#   RD_LOCAL_PROJECT            compose project (default: trade-rd-local); another project gets its
#                               own volumes and state directory, product/rd-workbench/.local-<project>
#   RD_LOCAL_STATE_DIR          state directory (default: product/rd-workbench/.local)
#   RD_LOCAL_API_PORT           loopback port for rd-owner-api (default: the port this project last
#                               published, or 18080)
#   RD_LOCAL_ACCEPTANCE_SCRIPT  a script run last as `<script> probe http://127.0.0.1:<port>`, with
#                               RD_OWNER_API_TOKEN exported from the env file
set -euo pipefail

package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH='' cd -- "$package_dir/../.." && pwd)
# shellcheck source=product/rd-workbench/scripts/local-deployment.bash
source "$package_dir/scripts/local-deployment.bash"
project=$local_project
env_file=$state_dir/.env
catalog_dir=$state_dir/catalog
owner_image=$project-rd-owner-api
owner_services=(rd-owner-api schema-materialize authority-schema-materialize authority-additive-table-migrate
  replay-policy-catalog-bootstrap replay-policy-catalog-owner-readback authority-bootstrap
  deployment-store-publication-author deployment-store-publication-publish deployment-store-grant)

log() { printf '%s\n' "$*"; }
skip() { log "skip $1: $2"; }
run() { log "run  $1"; }

umask 077
mkdir -p "$state_dir" "$catalog_dir" "$state_dir/steps"
printf '%s\n' "$api_port" > "$state_dir/api-port"

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

# 1. The env file: one random value per secret, every URL pointing at this stack's own database.
# A key already in the file is never regenerated or rewritten - the postgres volume's roles were
# provisioned with whatever password is already there, so changing it would lock the stack out of
# its own database. Only a key .env.example gained since this file was written is added, so a
# build that needs a new credential (RD_SCHEMA_MIGRATOR_DATABASE_URL, say) still gets one on an
# existing deployment, without regenerating anything that already works. A small set of
# `force`d keys are this script's own toggles (Deployment Store Admission's mode, identities and
# directories): they are recomputed every run so an existing stage-1 deployment turns `required`
# on without wiping its volume. DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY is deliberately not
# forced - step 3a sets it from the sealed head once publication has run.
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
    "BACKTEST_OWNER_DATABASE_URL": ("backtest_owner", "BACKTEST_OWNER_DB_PASSWORD"),
    "REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL": (
        "replay_policy_catalog_admin_writer", "REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD"),
    "QUALIFICATION_OWNER_DATABASE_URL": ("qualification_writer", "QUALIFICATION_OWNER_DB_PASSWORD"),
    "OPERATOR_AUTHORIZATION_DATABASE_URL": (
        "operator_authorization_writer", "OPERATOR_AUTHORIZATION_DB_PASSWORD"),
    "PRODUCT_EDGE_DATABASE_URL": ("product_edge_owner", "PRODUCT_EDGE_DB_PASSWORD"),
    "RD_SCHEMA_MIGRATOR_DATABASE_URL": ("rd_schema_migrator", "RD_SCHEMA_MIGRATOR_DB_PASSWORD"),
    "STORE_CUSTODY_PUBLISHER_DATABASE_URL": ("deployment_store_publisher", "STORE_CUSTODY_PUBLISHER_DB_PASSWORD"),
}
paths = {
    "PRODUCT_EDGE_BOOTSTRAP_CONFIG": "product-edge-bootstrap.json",
    "PRODUCT_EDGE_RECOVERY_CONFIG": "product-edge-recovery.json",
    "REPLAY_POLICY_CATALOG_BOOTSTRAP_CREATE_COMMAND": "catalog/create-command.json",
    "REPLAY_POLICY_CATALOG_BOOTSTRAP_ADVANCE_COMMAND": "catalog/advance-command.json",
    "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY": "catalog/verifier-public-key.hex",
    "DEPLOYMENT_STORE_FILES_DIRECTORY": "deployment-store/files",
    "DEPLOYMENT_STORE_ADMIN_DIRECTORY": "deployment-store/admin",
    "POSTGRES_TLS_DIRECTORY": "postgres-tls",
}
empty = {"DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY"}
# This script's own toggles, recomputed every run so an existing deployment picks up a stage
# upgrade (disabled -> required) without touching any password or credential below.
force_values = {
    "DEPLOYMENT_STORE_ADMISSION_MODE": "required",
    "DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE": "SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS",
    "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY": "trade-rd-local",
    "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY": "trade-rd-local-deployment-store-v1",
    "DEPLOYMENT_STORE_SIGNER_IDENTITY": "trade-rd-local-deployment-store-signer-v1",
    "DEPLOYMENT_STORE_LEASE_PERIOD_MS": "86400000",
}
force = set(force_values) | {"DEPLOYMENT_STORE_FILES_DIRECTORY", "DEPLOYMENT_STORE_ADMIN_DIRECTORY",
                              "POSTGRES_TLS_DIRECTORY"}
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
changed = [key for key in keys if key in force and key not in added]
values = dict(force_values)
for key in added:
    if key.endswith("_PASSWORD") or key.endswith("_TOKEN") or key.endswith("_HMAC_KEY"):
        values[key] = secrets.token_hex(32)
values.setdefault("PRODUCT_EDGE_DEPLOYMENT_IDENTITY", "trade-rd-local-v1")
for key in set(added) | set(changed):
    if key in urls:
        role, password = urls[key]
        value = f"postgres://{role}:{values[password]}@postgres:5432/rd_owner"
    elif key in paths:
        value = os.path.join(state, paths[key])
    elif key in empty:
        value = existing.get(key, "")
    elif key in values:
        value = values[key]
    else:
        value = next(
            line.split("=", 1)[1] for line in lines if line.startswith(f"{key}=")
        )
    if "replace-with" in value or "/absolute/path/to" in value:
        sys.exit(f"{key} kept a placeholder")
    if existing.get(key) != value:
        existing[key] = value
    elif key in changed:
        changed.remove(key)
tmp = os.path.join(state, ".env.tmp")
with open(tmp, "w") as handle:
    handle.write("\n".join(f"{key}={existing[key]}" for key in keys) + "\n")
os.chmod(tmp, 0o600)
os.replace(tmp, target)
print(",".join(added), ";", ",".join(changed))
EOF
)
env_added=${env_fill_result%% ; *}
env_changed=${env_fill_result##* ; }
if [ -n "$env_added" ] || [ -n "$env_changed" ]; then
  run env
  [ -n "$env_added" ] && log "added keys: $env_added"
  [ -n "$env_changed" ] && log "updated keys: $env_changed"
else
  skip env "$env_file already has every key at its current value"
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

# 5a. Deployment Store Admission's `required` mode (README, "Turning on `required`"), so this
# deployment carries the production scheduling resolver Native Replay execution needs. Every value
# is generated here the same way the env file's secrets are: once, into the state directory, never
# printed. The store's own publication (author/seal/publish) waits for step 10a, after Product Edge
# and Replay Policy Catalog genesis exist and the admitted reader is granted its wrappers - the same
# order the acceptance script and the README both use.
ds_dir=$state_dir/deployment-store
ds_files=$(env_value DEPLOYMENT_STORE_FILES_DIRECTORY)
ds_admin=$(env_value DEPLOYMENT_STORE_ADMIN_DIRECTORY)
tls_dir=$(env_value POSTGRES_TLS_DIRECTORY)
mkdir -p "$ds_files/leased" "$ds_admin" "$tls_dir"

if [ -f "$ds_files/postgres-root.crt" ] && [ -f "$ds_dir/store-root.key" ]; then
  skip deployment-store-root "$ds_files/postgres-root.crt exists"
else
  run deployment-store-root
  openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=trade store root" -keyout "$ds_dir/store-root.key" -out "$ds_files/postgres-root.crt" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign"
fi
if [ -f "$tls_dir/server.crt" ]; then
  skip postgres-tls-cert "$tls_dir/server.crt exists"
else
  run postgres-tls-cert
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=postgres" \
    -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr"
  printf '%s\n' "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature" \
    "extendedKeyUsage=serverAuth" "subjectAltName=DNS:postgres" > "$tls_dir/server.ext"
  openssl x509 -req -in "$tls_dir/server.csr" -CA "$ds_files/postgres-root.crt" -CAkey "$ds_dir/store-root.key" \
    -CAcreateserial -days 825 -extfile "$tls_dir/server.ext" -out "$tls_dir/server.crt"
fi
once postgres-tls-install "$volume_created $(shasum -a 256 "$tls_dir/server.crt" | cut -d' ' -f1)" \
  compose run --rm postgres-tls-install
provision_digest=$(shasum -a 256 "$package_dir/postgres-init/20-deployment-store-custody.sh" \
  "$package_dir/postgres-init/25-market-data-admitted-reader.sh" | shasum -a 256 | cut -d' ' -f1)
once deployment-store-provision "$volume_created $provision_digest" compose run --rm deployment-store-provision

printf 'postgres://market_data_admitted_reader:%s@postgres:5432/rd_owner\n' "$(env_value MARKET_DATA_ADMITTED_READER_DB_PASSWORD)" \
  > "$ds_files/leased/market-data-admitted-reader"
printf 'postgres://deployment_store_custodian:%s@postgres:5432/rd_owner\n' "$(env_value STORE_CUSTODY_CUSTODIAN_DB_PASSWORD)" \
  > "$ds_files/custodian-connection"
[ -f "$ds_dir/signing-key.hex" ] || openssl rand -hex 32 > "$ds_dir/signing-key.hex"

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

# 10a. Publish the Deployment Store, now that Product Edge and the Catalog exist, re-measuring it
# every run so a later floor (a new admitted-read wrapper a rebuilt image adds) is republished
# without a manual step. The grant boot - a one-shot disabled-mode rd-owner-api, so Market Data's
# own migration grants the admitted reader its wrappers - runs only as a fallback, when measuring
# fails: a wrapper a new image adds does not exist in market_data_admitted_read, nor is it granted
# to the admitted reader, until some binary boots that image and runs that migration, and the
# measurement below reads through the admitted reader. Running it on every invocation instead (this
# script's first cut) boots a second full rd-owner-api beside the one already running and was
# measured to make authoring fail with a connection-pool timeout under that contention - a cost with
# no benefit on the steady-state run, where nothing is ungranted and authoring already succeeds.
log "check deployment-store-publish"
run_deployment_store_grant_boot() {
  grant_name=$project-deployment-store-grant
  dock rm -f "$grant_name" > /dev/null 2>&1 || true
  compose run -d --no-deps --name "$grant_name" deployment-store-grant > /dev/null
  local grant_ready=
  for _ in $(seq 1 90); do
    if dock logs "$grant_name" 2>&1 | grep -q "R&D Owner API ready"; then
      grant_ready=1
      break
    fi
    [ "$(dock inspect --format '{{.State.Running}}' "$grant_name" 2> /dev/null)" = true ] || break
    sleep 1
  done
  if [ -z "$grant_ready" ]; then
    log "deployment-store-grant: rd-owner-api (disabled, migration only) never became ready"
    dock logs "$grant_name" 2>&1 | tail -20
    dock rm -f "$grant_name" > /dev/null 2>&1
    exit 1
  fi
  dock rm -f "$grant_name" > /dev/null 2>&1
}

manifest_history=$ds_dir/manifest-history
last_authoring=$ds_admin/authoring.last-published.json
current_head=$(env_value DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY)
if [ -n "$current_head" ] && [ -f "$manifest_history" ] && [ -f "$last_authoring" ]; then
  already_published=1
else
  already_published=
fi
write_deployment_store_draft() {
  rm -f "$ds_admin/draft.json"
  python3 - "$ds_admin/draft.json" "$(env_value DEPLOYMENT_STORE_SIGNER_IDENTITY)" \
    "$(env_value DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY)" "$(env_value DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY)" \
    "${already_published:+$manifest_history}" "${already_published:+$current_head}" << 'EOF'
import json, sys
target, signer, environment, deployment, history_path, previous_head = sys.argv[1:7]
prior = (
    [line for line in open(history_path).read().splitlines() if line]
    if history_path
    else []
)
draft = {
    "signer_identity": signer,
    "environment_identity": environment,
    "deployment_identity": deployment,
    "prior_manifest_identities": prior,
    "expected_previous_head_identity": previous_head or None,
    "valid_from_epoch_ms": 0,
    "valid_through_epoch_ms": 4102444800000,
    "recovery": {
        "identity": f"{deployment}-recovery-v1",
        "restart_requires_reverification": True,
        "ambiguity_forbids_business_retry": True,
    },
    "rotation_fence_identity": f"{deployment}-rotation-v1",
    "rotation_fence_closed_at_epoch_ms": 0,
}
open(target, "w").write(json.dumps(draft))
EOF
}
write_deployment_store_draft
rm -f "$ds_admin/authoring.json" "$ds_admin/sealed.json"
if ! compose run --rm --no-deps --user "$(id -u):$(id -g)" deployment-store-publication-author; then
  run_deployment_store_grant_boot
  write_deployment_store_draft
  rm -f "$ds_admin/authoring.json"
  compose run --rm --no-deps --user "$(id -u):$(id -g)" deployment-store-publication-author
fi

# Measures the deployment's store afresh every run; a publication differs from the last one
# published only in what it measures, never in its draft fields (those are this script's own
# fixed constants, or the prior-history/previous-head pair the draft above already matches to
# `last_authoring`), so comparing the two with those two fields removed is exactly "did the store
# change" and nothing else.
measurement_changed=1
if [ -n "$already_published" ] && python3 - "$ds_admin/authoring.json" "$last_authoring" << 'EOF'; then
import json, sys
varying = {"prior_manifest_identities", "expected_previous_head_identity"}
documents = []
for path in sys.argv[1:3]:
    document = json.load(open(path))
    for key in varying:
        document.pop(key, None)
    documents.append(document)
sys.exit(0 if documents[0] == documents[1] else 1)
EOF
  measurement_changed=
fi
if [ -z "$measurement_changed" ]; then
  skip deployment-store-publish "the measured store matches the last publication"
  rm -f "$ds_admin/draft.json" "$ds_admin/authoring.json"
else
  run deployment-store-publish
  dock run --rm --network none --user "$(id -u):$(id -g)" \
    -v "$ds_admin:/work/admin" -v "$ds_dir/signing-key.hex:/work/signing-key.hex:ro" \
    -e DEPLOYMENT_STORE_PUBLICATION_AUTHORING_PATH=/work/admin/authoring.json \
    -e DEPLOYMENT_STORE_SIGNING_KEY_PATH=/work/signing-key.hex \
    -e DEPLOYMENT_STORE_SEALED_PUBLICATION_OUTPUT_PATH=/work/admin/sealed.json \
    --entrypoint /usr/local/bin/deployment-store-publication-seal "$owner_image" > "$state_dir/steps/deployment-store-seal.json"
  summary=$state_dir/steps/deployment-store-seal.json
  head_identity=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["head_identity"])' "$summary")
  manifest_identity=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["manifest_identity"])' "$summary")
  signer_hex=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["signer_public_key_hex"])' "$summary")
  # Only PUBLISHED or REPLAYED exits zero; a head mismatch or a conflict exits non-zero, naming
  # which it was, and needs the manual re-publication the README describes ("Turning on required",
  # steps 6-9) rather than a retry of this script.
  compose run --rm --no-deps --user "$(id -u):$(id -g)" deployment-store-publication-publish
  printf '%s\n' "$signer_hex" > "$ds_files/signer-public-key.hex"
  printf '%s\n' "$manifest_identity" >> "$manifest_history"
  cp "$ds_admin/authoring.json" "$last_authoring"
  env_set_value() { # key value
    python3 - "$env_file" "$1" "$2" << 'EOF'
import sys
target, key, value = sys.argv[1:4]
lines = [line.rstrip("\n") for line in open(target)]
out = []
found = False
for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={value}")
open(target, "w").write("\n".join(out) + "\n")
EOF
  }
  env_set_value DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY "$head_identity"
fi
# rd-owner-api reads these read-only as uid 10001 (Dockerfile.owner), a different uid than the one
# that created them; unlike the README's bare-metal recipe this script has no sudo to chown them to
# 10001, so it grants read access to any local account instead of narrowing to that one uid. $ds_dir
# (the signing key, the root CA key) and $tls_dir are never bind-mounted into rd-owner-api and stay
# at their umask-077 default.
chmod -R a+rX "$ds_files"

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
