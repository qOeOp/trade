BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_operation_runs_v1 (
    run_identity TEXT PRIMARY KEY CHECK (
        run_identity ~ '^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    operation_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel = 'DASHBOARD_SHADOW_READ'),
    run_kind TEXT NOT NULL CHECK (run_kind = 'owner_read'),
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('dashboard_bff', 'dashboard_api')),
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')),
    owner_outcome_state TEXT NOT NULL CHECK (
        owner_outcome_state IN ('available', 'rejected', 'unknown', 'unavailable', 'not_applicable')
    ),
    recovery_identity_json JSONB NOT NULL CHECK (jsonb_typeof(recovery_identity_json) = 'object'),
    recovery_identity_digest TEXT NOT NULL CHECK (recovery_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
    transition_version BIGINT NOT NULL CHECK (transition_version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    retained_until TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '7 days'),
    terminal_code TEXT CHECK (terminal_code IS NULL OR terminal_code IN (
        'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
        'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE'
    )),
    CHECK ((state = 'queued') = (started_at IS NULL)),
    CHECK ((state IN ('succeeded', 'failed', 'cancelled', 'unknown')) = (finished_at IS NOT NULL)),
    CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)),
    CHECK (retained_until > created_at)
);

CREATE INDEX IF NOT EXISTS dashboard_operation_runs_v1_created_idx
    ON dashboard_operation_runs_v1 (created_at DESC, run_identity DESC);

CREATE INDEX IF NOT EXISTS dashboard_operation_runs_v1_recovery_idx
    ON dashboard_operation_runs_v1 (operation_id, recovery_identity_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_operation_run_logs_v1 (
    run_identity TEXT NOT NULL REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    sequence SMALLINT NOT NULL CHECK (sequence BETWEEN 1 AND 256),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    source TEXT NOT NULL CHECK (source IN ('run_store', 'dashboard_bff', 'owner_gateway', 'shadow_worker')),
    event_code TEXT NOT NULL CHECK (event_code IN (
        'RUN_QUEUED', 'RUN_CLAIMED', 'RUN_STARTED', 'LEASE_EXPIRED_REQUEUED',
        'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
        'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE'
    )),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    PRIMARY KEY (run_identity, sequence)
);

CREATE TABLE IF NOT EXISTS dashboard_shadow_workers_v1 (
    worker_identity TEXT PRIMARY KEY CHECK (worker_identity ~ '^[A-Za-z0-9._:/-]{1,192}$'),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    capabilities_json JSONB NOT NULL CHECK (jsonb_typeof(capabilities_json) = 'array'),
    capabilities_digest TEXT NOT NULL CHECK (capabilities_digest ~ '^sha256:[0-9a-f]{64}$'),
    worker_artifact_digest TEXT NOT NULL CHECK (worker_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
    worker_capability_digest TEXT NOT NULL CHECK (worker_capability_digest ~ '^sha256:[0-9a-f]{64}$'),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    CHECK (lease_expires_at > last_heartbeat_at)
);

CREATE TABLE IF NOT EXISTS dashboard_shadow_dispatch_queue_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    registry_entry_digest TEXT NOT NULL CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'),
    compatibility_envelope_set_digest TEXT NOT NULL CHECK (
        compatibility_envelope_set_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    claim_attempt SMALLINT NOT NULL DEFAULT 0 CHECK (claim_attempt BETWEEN 0 AND 3),
    claimed_by TEXT REFERENCES dashboard_shadow_workers_v1(worker_identity) ON DELETE RESTRICT,
    claim_token_digest TEXT CHECK (claim_token_digest ~ '^sha256:[0-9a-f]{64}$'),
    lease_expires_at TIMESTAMPTZ,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK ((claimed_by IS NULL) = (claim_token_digest IS NULL)),
    CHECK ((claimed_by IS NULL) = (lease_expires_at IS NULL)),
    CHECK (claimed_at IS NULL OR claimed_at >= enqueued_at),
    CHECK (completed_at IS NULL OR claimed_at IS NOT NULL)
);

-- Pre-admission development databases can contain the earlier queue shape. The
-- application terminalizes every legacy row with a missing or invalid binding
-- before considering its next claim; fresh rows always enter through the exact
-- root-registry plus composed-envelope-set digest insert above.
ALTER TABLE dashboard_shadow_dispatch_queue_v1
    ADD COLUMN IF NOT EXISTS registry_entry_digest TEXT
    CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE dashboard_shadow_dispatch_queue_v1
    ADD COLUMN IF NOT EXISTS compatibility_envelope_set_digest TEXT
    CHECK (compatibility_envelope_set_digest ~ '^sha256:[0-9a-f]{64}$');

-- The immediately preceding pre-admission schema required the superseded
-- single-operation digest. Keep its bytes as incident evidence when present,
-- but stop requiring new composed-set-bound submissions to write that column.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'dashboard_shadow_dispatch_queue_v1'
           AND column_name = 'compatibility_envelope_digest'
    ) THEN
        ALTER TABLE dashboard_shadow_dispatch_queue_v1
            ALTER COLUMN compatibility_envelope_digest DROP NOT NULL;
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS dashboard_shadow_dispatch_queue_v1_claim_idx
    ON dashboard_shadow_dispatch_queue_v1 (lease_expires_at, enqueued_at, run_identity);

COMMIT;
