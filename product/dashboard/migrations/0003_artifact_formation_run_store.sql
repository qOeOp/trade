BEGIN;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_channel_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_run_kind_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_terminal_code_check;

ALTER TABLE dashboard_operation_runs_v1
    ADD CONSTRAINT dashboard_operation_runs_v1_channel_check CHECK (
        (operation_id = 'artifact_build.formation_execute.v1'
            AND channel = 'DASHBOARD_DISPOSABLE_EXECUTION'
            AND run_kind = 'owner_effect')
        OR
        (operation_id <> 'artifact_build.formation_execute.v1'
            AND channel = 'DASHBOARD_SHADOW_READ'
            AND run_kind = 'owner_read')
    ),
    ADD CONSTRAINT dashboard_operation_runs_v1_terminal_code_check CHECK (
        terminal_code IS NULL OR terminal_code IN (
            'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
            'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE',
            'MANUAL_RECONCILIATION_REQUIRED'
        )
    );

ALTER TABLE dashboard_operation_run_logs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_source_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_event_code_check;

ALTER TABLE dashboard_operation_run_logs_v1
    ADD CONSTRAINT dashboard_operation_run_logs_v1_source_check CHECK (
        source IN ('run_store', 'dashboard_bff', 'owner_gateway', 'shadow_worker', 'artifact_orchestrator')
    ),
    ADD CONSTRAINT dashboard_operation_run_logs_v1_event_code_check CHECK (
        event_code IN (
            'RUN_QUEUED', 'RUN_CLAIMED', 'RUN_STARTED', 'LEASE_EXPIRED_REQUEUED',
            'OWNER_CLAIMED', 'INVOCATION_STARTED', 'CLAIM_LIMIT_REACHED',
            'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE', 'OWNER_REJECTED',
            'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE', 'MANUAL_RECONCILIATION_REQUIRED'
        )
    );

CREATE TABLE IF NOT EXISTS dashboard_artifact_formation_run_bindings_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    requested_action TEXT NOT NULL CHECK (requested_action IN ('RUN', 'RESOLVE')),
    registry_entry_digest TEXT NOT NULL CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'),
    compatibility_envelope_digest TEXT NOT NULL CHECK (
        compatibility_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    routing_state TEXT NOT NULL CHECK (routing_state IN ('ACTIVE', 'UNAVAILABLE')),
    routing_dispatcher TEXT NOT NULL CHECK (routing_dispatcher IN ('TRADE_DASHBOARD', 'NONE')),
    routing_binding_identity TEXT CHECK (
        routing_binding_identity IS NULL OR
        routing_binding_identity ~ '^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$'
    ),
    routing_binding_digest TEXT CHECK (
        routing_binding_digest IS NULL OR routing_binding_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    routing_generation BIGINT CHECK (routing_generation IS NULL OR routing_generation >= 1),
    continuation_count SMALLINT NOT NULL DEFAULT 0 CHECK (continuation_count BETWEEN 0 AND 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (requested_action = 'RUN' AND routing_state = 'ACTIVE'
            AND routing_dispatcher = 'TRADE_DASHBOARD'
            AND routing_binding_identity IS NOT NULL
            AND routing_binding_digest IS NOT NULL
            AND routing_generation IS NOT NULL)
        OR
        (requested_action = 'RESOLVE' AND routing_state = 'UNAVAILABLE'
            AND routing_dispatcher = 'NONE'
            AND routing_binding_identity IS NULL
            AND routing_binding_digest IS NULL
            AND routing_generation IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_artifact_formation_active_recovery_v1
    ON dashboard_operation_runs_v1 (operation_id, recovery_identity_digest)
    WHERE operation_id = 'artifact_build.formation_execute.v1'
      AND state IN ('queued', 'running');

CREATE OR REPLACE FUNCTION dashboard_require_shadow_read_run_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    parent_channel TEXT;
    parent_kind TEXT;
BEGIN
    SELECT channel, run_kind INTO parent_channel, parent_kind
      FROM dashboard_operation_runs_v1
     WHERE run_identity = NEW.run_identity;
    IF parent_channel IS DISTINCT FROM 'DASHBOARD_SHADOW_READ'
       OR parent_kind IS DISTINCT FROM 'owner_read' THEN
        RAISE EXCEPTION 'dashboard shadow queue accepts owner reads only'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS dashboard_shadow_queue_read_only_v1
    ON dashboard_shadow_dispatch_queue_v1;
CREATE TRIGGER dashboard_shadow_queue_read_only_v1
BEFORE INSERT OR UPDATE OF run_identity ON dashboard_shadow_dispatch_queue_v1
FOR EACH ROW EXECUTE FUNCTION dashboard_require_shadow_read_run_v1();

COMMIT;
