BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_operation_run_cache_deletions_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    receipt_identity TEXT NOT NULL UNIQUE CHECK (
        receipt_identity ~ '^dashboard-operational-cache-deletion-v1-[0-9a-f]{64}$'
    ),
    prior_state TEXT NOT NULL CHECK (prior_state IN ('succeeded', 'failed', 'cancelled', 'unknown')),
    prior_transition_version BIGINT NOT NULL CHECK (prior_transition_version >= 1),
    principal_ref TEXT NOT NULL CHECK (principal_ref ~ '^[A-Za-z0-9._:/-]{1,96}$'),
    authorization_digest TEXT NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
