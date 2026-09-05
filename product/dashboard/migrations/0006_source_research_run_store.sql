BEGIN;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_channel_check;

ALTER TABLE dashboard_operation_runs_v1
    ADD CONSTRAINT dashboard_operation_runs_v1_channel_check CHECK (
        (operation_id IN (
            'artifact_build.formation_execute.v1',
            'source_intake.research.submit_or_resolve.v1'
        ) AND channel = 'DASHBOARD_DISPOSABLE_EXECUTION' AND run_kind = 'owner_effect')
        OR
        (operation_id NOT IN (
            'artifact_build.formation_execute.v1',
            'source_intake.research.submit_or_resolve.v1'
        ) AND channel = 'DASHBOARD_SHADOW_READ' AND run_kind = 'owner_read')
    );

ALTER TABLE dashboard_operation_run_logs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_source_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_event_code_check;

ALTER TABLE dashboard_operation_run_logs_v1
    ADD CONSTRAINT dashboard_operation_run_logs_v1_source_check CHECK (
        source IN (
            'run_store', 'dashboard_bff', 'owner_gateway', 'shadow_worker',
            'artifact_orchestrator', 'source_research_orchestrator'
        )
    ),
    ADD CONSTRAINT dashboard_operation_run_logs_v1_event_code_check CHECK (
        event_code IN (
            'RUN_QUEUED', 'RUN_CLAIMED', 'RUN_STARTED', 'LEASE_EXPIRED_REQUEUED',
            'OWNER_CLAIMED', 'INVOCATION_STARTED', 'SOURCE_OWNER_AVAILABLE',
            'RESEARCH_OWNER_AVAILABLE', 'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE',
            'OWNER_AVAILABLE', 'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE',
            'MANUAL_RECONCILIATION_REQUIRED'
        )
    );

CREATE TABLE IF NOT EXISTS dashboard_source_research_run_bindings_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    requested_action TEXT NOT NULL CHECK (requested_action IN ('RUN', 'RESOLVE')),
    operation_manifest_digest TEXT NOT NULL CHECK (
        operation_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    source_routing_state TEXT NOT NULL CHECK (source_routing_state IN ('ACTIVE', 'UNAVAILABLE')),
    source_routing_dispatcher TEXT NOT NULL CHECK (
        source_routing_dispatcher IN ('TRADE_DASHBOARD', 'NONE')
    ),
    source_routing_binding_identity TEXT CHECK (
        source_routing_binding_identity IS NULL OR
        source_routing_binding_identity ~ '^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$'
    ),
    source_routing_binding_digest TEXT CHECK (
        source_routing_binding_digest IS NULL OR
        source_routing_binding_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    source_routing_generation BIGINT CHECK (
        source_routing_generation IS NULL OR source_routing_generation >= 1
    ),
    research_routing_state TEXT NOT NULL CHECK (research_routing_state IN ('ACTIVE', 'UNAVAILABLE')),
    research_routing_dispatcher TEXT NOT NULL CHECK (
        research_routing_dispatcher IN ('TRADE_DASHBOARD', 'NONE')
    ),
    research_routing_binding_identity TEXT CHECK (
        research_routing_binding_identity IS NULL OR
        research_routing_binding_identity ~ '^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$'
    ),
    research_routing_binding_digest TEXT CHECK (
        research_routing_binding_digest IS NULL OR
        research_routing_binding_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    research_routing_generation BIGINT CHECK (
        research_routing_generation IS NULL OR research_routing_generation >= 1
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (requested_action = 'RUN'
            AND source_routing_state = 'ACTIVE'
            AND source_routing_dispatcher = 'TRADE_DASHBOARD'
            AND source_routing_binding_identity IS NOT NULL
            AND source_routing_binding_digest IS NOT NULL
            AND source_routing_generation IS NOT NULL
            AND research_routing_state = 'ACTIVE'
            AND research_routing_dispatcher = 'TRADE_DASHBOARD'
            AND research_routing_binding_identity IS NOT NULL
            AND research_routing_binding_digest IS NOT NULL
            AND research_routing_generation IS NOT NULL)
        OR
        (requested_action = 'RESOLVE'
            AND source_routing_state = 'UNAVAILABLE'
            AND source_routing_dispatcher = 'NONE'
            AND source_routing_binding_identity IS NULL
            AND source_routing_binding_digest IS NULL
            AND source_routing_generation IS NULL
            AND research_routing_state = 'UNAVAILABLE'
            AND research_routing_dispatcher = 'NONE'
            AND research_routing_binding_identity IS NULL
            AND research_routing_binding_digest IS NULL
            AND research_routing_generation IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_source_research_active_recovery_v1
    ON dashboard_operation_runs_v1 (operation_id, recovery_identity_digest)
    WHERE operation_id = 'source_intake.research.submit_or_resolve.v1'
      AND state IN ('queued', 'running');

COMMIT;
