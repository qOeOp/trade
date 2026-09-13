BEGIN;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_channel_check;

ALTER TABLE dashboard_operation_runs_v1
    ADD CONSTRAINT dashboard_operation_runs_v1_channel_check CHECK (
        (operation_id IN (
            'artifact_build.formation_execute.v1',
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        ) AND channel = 'DASHBOARD_DISPOSABLE_EXECUTION' AND run_kind = 'owner_effect')
        OR
        (operation_id NOT IN (
            'artifact_build.formation_execute.v1',
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        ) AND channel = 'DASHBOARD_SHADOW_READ' AND run_kind = 'owner_read')
    );

ALTER TABLE dashboard_control_plane_admission_receipts_v1
    DROP CONSTRAINT IF EXISTS dashboard_control_plane_admission_receipts_v1_operation_check,
    ADD CONSTRAINT dashboard_control_plane_admission_receipts_v1_operation_check CHECK (
        operation IN (
            'artifact_build.formation_execute.v1',
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        )
    );

ALTER TABLE dashboard_operation_audit_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_receipt_check,
    ADD CONSTRAINT dashboard_operation_audit_v1_operation_check CHECK (operation IN (
        'artifact_build.formation_execute.v1',
        'dashboard.dependency.cancel.queued.v1',
        'dashboard.operational_cache.delete.v1',
        'develop_composer.submit_or_resolve.v2',
        'exploratory_replay.submit_or_resolve.v2',
        'source_intake.research.submit_or_resolve.v1'
    )),
    ADD CONSTRAINT dashboard_operation_audit_v1_operation_receipt_check CHECK (
        (operation = 'dashboard.dependency.cancel.queued.v1' AND action_kind = 'update'
            AND receipt_identity ~ '^dashboard-operational-cancellation-v1-')
        OR
        (operation = 'dashboard.operational_cache.delete.v1' AND action_kind = 'delete'
            AND receipt_identity ~ '^dashboard-operational-cache-deletion-v1-')
        OR
        (operation IN (
            'artifact_build.formation_execute.v1',
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        ) AND action_kind = 'execute'
            AND receipt_identity ~ '^dashboard-control-plane-admission-v1-')
    );

ALTER TABLE dashboard_operation_run_logs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_source_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_event_code_check;

ALTER TABLE dashboard_operation_run_logs_v1
    ADD CONSTRAINT dashboard_operation_run_logs_v1_source_check CHECK (
        source IN (
            'run_store', 'dashboard_bff', 'owner_gateway', 'shadow_worker',
            'artifact_orchestrator', 'source_research_orchestrator', 'effect_worker'
        )
    ),
    ADD CONSTRAINT dashboard_operation_run_logs_v1_event_code_check CHECK (
        event_code IN (
            'RUN_QUEUED', 'RUN_CLAIMED', 'RUN_STARTED', 'LEASE_EXPIRED_REQUEUED',
            'OWNER_CLAIMED', 'INVOCATION_STARTED', 'SOURCE_OWNER_AVAILABLE',
            'RESEARCH_OWNER_AVAILABLE', 'REPLAY_OWNER_SUBMISSION_STARTED',
            'COMPOSER_OWNER_SUBMISSION_STARTED',
            'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
            'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE',
            'MANUAL_RECONCILIATION_REQUIRED'
        )
    );

CREATE TABLE IF NOT EXISTS dashboard_effect_workers_v1 (
    worker_identity TEXT PRIMARY KEY CHECK (
        worker_identity ~ '^dashboard-effect-worker-v1-[0-9a-f]{64}$'
    ),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    operation_ids_json JSONB NOT NULL CHECK (
        jsonb_typeof(operation_ids_json) = 'array'
        AND jsonb_array_length(operation_ids_json) = 4
        AND operation_ids_json = '["artifact_build.formation_execute.v1", "develop_composer.submit_or_resolve.v2", "exploratory_replay.submit_or_resolve.v2", "source_intake.research.submit_or_resolve.v1"]'::jsonb
    ),
    operation_ids_digest TEXT NOT NULL CHECK (operation_ids_digest ~ '^sha256:[0-9a-f]{64}$'),
    worker_artifact_digest TEXT NOT NULL CHECK (worker_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
    worker_capability_digest TEXT NOT NULL CHECK (worker_capability_digest ~ '^sha256:[0-9a-f]{64}$'),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    scan_after_enqueued_at TIMESTAMPTZ,
    scan_after_run_identity TEXT,
    CHECK (lease_expires_at > last_heartbeat_at)
);

ALTER TABLE dashboard_effect_workers_v1
    ADD COLUMN IF NOT EXISTS scan_after_enqueued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scan_after_run_identity TEXT;

DO $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'dashboard_effect_worker_scan_cursor_pair_v1'
           AND conrelid = 'dashboard_effect_workers_v1'::regclass
    ) THEN
        ALTER TABLE dashboard_effect_workers_v1
            ADD CONSTRAINT dashboard_effect_worker_scan_cursor_pair_v1 CHECK (
                (scan_after_enqueued_at IS NULL) = (scan_after_run_identity IS NULL)
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'dashboard_effect_worker_scan_cursor_identity_v1'
           AND conrelid = 'dashboard_effect_workers_v1'::regclass
    ) THEN
        ALTER TABLE dashboard_effect_workers_v1
            ADD CONSTRAINT dashboard_effect_worker_scan_cursor_identity_v1 CHECK (
                scan_after_run_identity IS NULL OR scan_after_run_identity ~
                    '^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    END IF;
END
$function$;

CREATE TABLE IF NOT EXISTS dashboard_effect_dispatch_queue_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    operation_id TEXT NOT NULL CHECK (operation_id IN (
        'artifact_build.formation_execute.v1',
        'develop_composer.submit_or_resolve.v2',
        'exploratory_replay.submit_or_resolve.v2',
        'source_intake.research.submit_or_resolve.v1'
    )),
    request_json JSONB NOT NULL CHECK (jsonb_typeof(request_json) = 'object'),
    request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
    frozen_target_json JSONB,
    frozen_target_digest TEXT,
    frozen_context_json JSONB,
    frozen_context_digest TEXT CHECK (
        frozen_context_digest IS NULL OR frozen_context_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    principal_ref TEXT NOT NULL CHECK (principal_ref ~ '^[A-Za-z0-9._:/-]{1,96}$'),
    authorization_digest TEXT NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
    admission_receipt_identity TEXT NOT NULL REFERENCES
        dashboard_control_plane_admission_receipts_v1(receipt_identity) ON DELETE RESTRICT,
    claim_attempt SMALLINT NOT NULL DEFAULT 0 CHECK (claim_attempt BETWEEN 0 AND 3),
    claimed_by TEXT REFERENCES dashboard_effect_workers_v1(worker_identity) ON DELETE RESTRICT,
    claim_token_digest TEXT CHECK (
        claim_token_digest IS NULL OR claim_token_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    lease_expires_at TIMESTAMPTZ,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK ((claimed_by IS NULL) = (claim_token_digest IS NULL)),
    CHECK ((claimed_by IS NULL) = (lease_expires_at IS NULL)),
    CHECK ((frozen_context_json IS NULL) = (frozen_context_digest IS NULL)),
    CHECK (
        (operation_id = 'artifact_build.formation_execute.v1'
            AND jsonb_typeof(frozen_context_json) = 'object')
        OR
        (operation_id IN (
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        )
            AND frozen_context_json IS NULL)
    ),
    CHECK (claimed_at IS NULL OR claimed_at >= enqueued_at),
    CHECK (completed_at IS NULL OR claimed_at IS NOT NULL)
);

ALTER TABLE dashboard_effect_dispatch_queue_v1
    ADD COLUMN IF NOT EXISTS frozen_target_json JSONB;
ALTER TABLE dashboard_effect_dispatch_queue_v1
    ADD COLUMN IF NOT EXISTS frozen_target_digest TEXT;

DO $function$
BEGIN
    IF EXISTS (
        SELECT 1 FROM dashboard_effect_dispatch_queue_v1
         WHERE frozen_target_json IS NULL OR frozen_target_digest IS NULL
    ) THEN
        RAISE EXCEPTION 'existing effect dispatch target custody is unavailable'
            USING ERRCODE = '23514';
    END IF;
END
$function$;

ALTER TABLE dashboard_effect_dispatch_queue_v1
    ALTER COLUMN frozen_target_json SET NOT NULL,
    ALTER COLUMN frozen_target_digest SET NOT NULL,
    DROP CONSTRAINT IF EXISTS dashboard_effect_dispatch_target_json_v1,
    DROP CONSTRAINT IF EXISTS dashboard_effect_dispatch_target_digest_v1,
    ADD CONSTRAINT dashboard_effect_dispatch_target_json_v1
        CHECK (jsonb_typeof(frozen_target_json) = 'object'),
    ADD CONSTRAINT dashboard_effect_dispatch_target_digest_v1
        CHECK (frozen_target_digest ~ '^sha256:[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS dashboard_effect_dispatch_queue_v1_claim_idx
    ON dashboard_effect_dispatch_queue_v1 (lease_expires_at, enqueued_at, run_identity);

CREATE TABLE IF NOT EXISTS dashboard_exploratory_replay_run_bindings_v2 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 2),
    registry_entry_digest TEXT NOT NULL CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'),
    compatibility_envelope_digest TEXT NOT NULL CHECK (
        compatibility_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    routing_state TEXT NOT NULL CHECK (routing_state = 'ACTIVE'),
    routing_dispatcher TEXT NOT NULL CHECK (routing_dispatcher = 'TRADE_DASHBOARD'),
    routing_binding_identity TEXT NOT NULL CHECK (
        routing_binding_identity ~ '^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$'
    ),
    routing_binding_digest TEXT NOT NULL CHECK (
        routing_binding_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    routing_generation BIGINT NOT NULL CHECK (routing_generation > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION dashboard_require_exploratory_replay_run_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    parent_channel TEXT;
    parent_kind TEXT;
    parent_operation TEXT;
BEGIN
    SELECT channel, run_kind, operation_id
      INTO parent_channel, parent_kind, parent_operation
      FROM dashboard_operation_runs_v1
     WHERE run_identity = NEW.run_identity;
    IF parent_channel IS DISTINCT FROM 'DASHBOARD_DISPOSABLE_EXECUTION'
       OR parent_kind IS DISTINCT FROM 'owner_effect'
       OR parent_operation IS DISTINCT FROM 'exploratory_replay.submit_or_resolve.v2' THEN
        RAISE EXCEPTION 'dashboard replay binding accepts matching owner effects only'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS dashboard_exploratory_replay_binding_owner_effect_only_v2
    ON dashboard_exploratory_replay_run_bindings_v2;
CREATE TRIGGER dashboard_exploratory_replay_binding_owner_effect_only_v2
BEFORE INSERT OR UPDATE ON dashboard_exploratory_replay_run_bindings_v2
FOR EACH ROW EXECUTE FUNCTION dashboard_require_exploratory_replay_run_v2();

CREATE OR REPLACE FUNCTION dashboard_freeze_exploratory_replay_binding_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'dashboard exploratory replay binding is immutable'
        USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS dashboard_exploratory_replay_binding_immutable_v2
    ON dashboard_exploratory_replay_run_bindings_v2;
CREATE TRIGGER dashboard_exploratory_replay_binding_immutable_v2
BEFORE UPDATE OR DELETE ON dashboard_exploratory_replay_run_bindings_v2
FOR EACH ROW EXECUTE FUNCTION dashboard_freeze_exploratory_replay_binding_v2();

CREATE TABLE IF NOT EXISTS dashboard_develop_composer_run_bindings_v2 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 2),
    registry_entry_digest TEXT NOT NULL CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'),
    compatibility_envelope_digest TEXT NOT NULL CHECK (
        compatibility_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    routing_state TEXT NOT NULL CHECK (routing_state = 'ACTIVE'),
    routing_dispatcher TEXT NOT NULL CHECK (routing_dispatcher = 'TRADE_DASHBOARD'),
    routing_binding_identity TEXT NOT NULL CHECK (
        routing_binding_identity ~ '^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$'
    ),
    routing_binding_digest TEXT NOT NULL CHECK (routing_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
    routing_generation BIGINT NOT NULL CHECK (routing_generation > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION dashboard_require_develop_composer_run_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    parent_channel TEXT;
    parent_kind TEXT;
    parent_operation TEXT;
BEGIN
    SELECT channel, run_kind, operation_id
      INTO parent_channel, parent_kind, parent_operation
      FROM dashboard_operation_runs_v1
     WHERE run_identity = NEW.run_identity;
    IF parent_channel IS DISTINCT FROM 'DASHBOARD_DISPOSABLE_EXECUTION'
       OR parent_kind IS DISTINCT FROM 'owner_effect'
       OR parent_operation IS DISTINCT FROM 'develop_composer.submit_or_resolve.v2' THEN
        RAISE EXCEPTION 'dashboard Composer binding accepts matching owner effects only'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS dashboard_develop_composer_binding_owner_effect_only_v2
    ON dashboard_develop_composer_run_bindings_v2;
CREATE TRIGGER dashboard_develop_composer_binding_owner_effect_only_v2
BEFORE INSERT OR UPDATE ON dashboard_develop_composer_run_bindings_v2
FOR EACH ROW EXECUTE FUNCTION dashboard_require_develop_composer_run_v2();

CREATE OR REPLACE FUNCTION dashboard_freeze_develop_composer_binding_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'dashboard Develop Composer binding is immutable'
        USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS dashboard_develop_composer_binding_immutable_v2
    ON dashboard_develop_composer_run_bindings_v2;
CREATE TRIGGER dashboard_develop_composer_binding_immutable_v2
BEFORE UPDATE OR DELETE ON dashboard_develop_composer_run_bindings_v2
FOR EACH ROW EXECUTE FUNCTION dashboard_freeze_develop_composer_binding_v2();

CREATE OR REPLACE FUNCTION dashboard_require_effect_run_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    parent_channel TEXT;
    parent_kind TEXT;
    parent_operation TEXT;
BEGIN
    SELECT channel, run_kind, operation_id
      INTO parent_channel, parent_kind, parent_operation
      FROM dashboard_operation_runs_v1
     WHERE run_identity = NEW.run_identity;
    IF parent_channel IS DISTINCT FROM 'DASHBOARD_DISPOSABLE_EXECUTION'
       OR parent_kind IS DISTINCT FROM 'owner_effect'
       OR parent_operation IS DISTINCT FROM NEW.operation_id THEN
        RAISE EXCEPTION 'dashboard effect queue accepts matching owner effects only'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS dashboard_effect_queue_owner_effect_only_v1
    ON dashboard_effect_dispatch_queue_v1;
CREATE TRIGGER dashboard_effect_queue_owner_effect_only_v1
BEFORE INSERT OR UPDATE ON dashboard_effect_dispatch_queue_v1
FOR EACH ROW EXECUTE FUNCTION dashboard_require_effect_run_v1();

CREATE OR REPLACE FUNCTION dashboard_freeze_effect_dispatch_custody_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.run_identity IS DISTINCT FROM OLD.run_identity
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
       OR NEW.request_json IS DISTINCT FROM OLD.request_json
       OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
       OR NEW.frozen_target_json IS DISTINCT FROM OLD.frozen_target_json
       OR NEW.frozen_target_digest IS DISTINCT FROM OLD.frozen_target_digest
       OR NEW.frozen_context_json IS DISTINCT FROM OLD.frozen_context_json
       OR NEW.frozen_context_digest IS DISTINCT FROM OLD.frozen_context_digest
       OR NEW.principal_ref IS DISTINCT FROM OLD.principal_ref
       OR NEW.authorization_digest IS DISTINCT FROM OLD.authorization_digest
       OR NEW.admission_receipt_identity IS DISTINCT FROM OLD.admission_receipt_identity
       OR NEW.enqueued_at IS DISTINCT FROM OLD.enqueued_at THEN
        RAISE EXCEPTION 'dashboard effect dispatch custody is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS dashboard_effect_queue_frozen_custody_v1
    ON dashboard_effect_dispatch_queue_v1;
CREATE TRIGGER dashboard_effect_queue_frozen_custody_v1
BEFORE UPDATE ON dashboard_effect_dispatch_queue_v1
FOR EACH ROW EXECUTE FUNCTION dashboard_freeze_effect_dispatch_custody_v1();

COMMIT;
