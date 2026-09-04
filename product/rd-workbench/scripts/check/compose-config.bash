#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

if [ "${1:-}" = "--static-only" ]; then
  exit 0
fi

POSTGRES_PASSWORD=check-only \
  RD_OWNER_DB_PASSWORD=check-only \
  RD_FACT_WRITER_DB_PASSWORD=check-only \
  REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD=check-only \
  OPERATOR_AUTHORIZATION_DB_PASSWORD=check-only \
  QUALIFICATION_OWNER_DB_PASSWORD=check-only \
  PRODUCT_EDGE_DB_PASSWORD=check-only \
  BACKTEST_OWNER_DB_PASSWORD=check-only \
  RD_OWNER_API_TOKEN=check-only \
  WINDMILL_DATABASE_URL=check-only \
  RD_OWNER_DATABASE_URL=check-only \
  RD_FACT_WRITER_DATABASE_URL=check-only \
  REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL=check-only \
  OPERATOR_AUTHORIZATION_DATABASE_URL=check-only \
  QUALIFICATION_OWNER_DATABASE_URL=check-only \
  PRODUCT_EDGE_DATABASE_URL=check-only \
  PRODUCT_EDGE_DEPLOYMENT_IDENTITY=check-only \
  PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY=check-only \
  PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION=check-only \
  PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE=check-only \
  PRODUCT_EDGE_BOOTSTRAP_CONFIG=/tmp/check-only-product-edge-bootstrap.json \
  PRODUCT_EDGE_RECOVERY_CONFIG=/tmp/check-only-product-edge-recovery.json \
  REPLAY_POLICY_CATALOG_BOOTSTRAP_REQUEST=/tmp/check-only-replay-policy-catalog-bootstrap-request.json \
  REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY=check-only \
  REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY=/tmp/check-only-replay-policy-catalog-verifier-public-key.hex \
  docker compose --project-directory "$package_dir" --file "$compose_file" config --quiet
