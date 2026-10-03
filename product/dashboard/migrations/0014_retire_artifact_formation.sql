-- Artifact Formation is retired: the user decided on 2026-10-03 that the R&D agent works outside
-- the product, so the product makes no model call and the Dashboard no longer runs
-- `artifact_build.formation_execute.v1`. This migration removes it from every constraint the
-- earlier migrations wrote. Those migrations are rerun on every start, so this one runs after them
-- each time and leaves the same final shape.
--
-- A store that still holds a record of the retired operation is refused rather than rewritten:
-- the Dashboard no longer reads such a record, and the disposable preview store it can only come
-- from is recreated instead.
BEGIN;

DO $function$
BEGIN
    IF EXISTS (
        SELECT 1 FROM dashboard_operation_runs_v1
         WHERE operation_id = 'artifact_build.formation_execute.v1'
    ) OR EXISTS (
        SELECT 1 FROM dashboard_operation_run_logs_v1
         WHERE source = 'artifact_orchestrator'
            OR event_code IN ('OWNER_CLAIMED', 'INVOCATION_STARTED', 'MANUAL_RECONCILIATION_REQUIRED')
    ) OR EXISTS (
        SELECT 1 FROM dashboard_operation_audit_v1
         WHERE operation = 'artifact_build.formation_execute.v1'
    ) OR EXISTS (
        SELECT 1 FROM dashboard_control_plane_admission_receipts_v1
         WHERE operation = 'artifact_build.formation_execute.v1'
            OR execution_mode = 'CONTINUE_CLAIMED_ONCE'
    ) OR EXISTS (
        -- Read through to_jsonb: this migration drops the column below and runs again on every start.
        SELECT 1 FROM dashboard_effect_dispatch_queue_v1 q
         WHERE q.operation_id = 'artifact_build.formation_execute.v1'
            OR to_jsonb(q) ->> 'frozen_context_json' IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'the store holds a retired Artifact Formation record; recreate the disposable store'
            USING ERRCODE = '23514';
    END IF;
END
$function$;

DROP INDEX IF EXISTS dashboard_artifact_formation_active_recovery_v1;
DROP TABLE IF EXISTS dashboard_artifact_formation_run_bindings_v1;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_channel_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_terminal_code_check;

ALTER TABLE dashboard_operation_runs_v1
    ADD CONSTRAINT dashboard_operation_runs_v1_channel_check CHECK (
        (operation_id IN (
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
    ),
    ADD CONSTRAINT dashboard_operation_runs_v1_terminal_code_check CHECK (
        terminal_code IS NULL OR terminal_code IN (
            'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
            'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE'
        )
    );

ALTER TABLE dashboard_operation_run_logs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_source_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_run_logs_v1_event_code_check;

ALTER TABLE dashboard_operation_run_logs_v1
    ADD CONSTRAINT dashboard_operation_run_logs_v1_source_check CHECK (
        source IN (
            'run_store', 'dashboard_bff', 'owner_gateway', 'shadow_worker',
            'source_research_orchestrator', 'effect_worker'
        )
    ),
    ADD CONSTRAINT dashboard_operation_run_logs_v1_event_code_check CHECK (
        event_code IN (
            'RUN_QUEUED', 'RUN_CLAIMED', 'RUN_STARTED', 'LEASE_EXPIRED_REQUEUED',
            'SOURCE_OWNER_AVAILABLE', 'RESEARCH_OWNER_AVAILABLE',
            'REPLAY_OWNER_SUBMISSION_STARTED', 'COMPOSER_OWNER_SUBMISSION_STARTED',
            'CLAIM_LIMIT_REACHED', 'DEPLOYMENT_UNAVAILABLE', 'OWNER_AVAILABLE',
            'OWNER_REJECTED', 'OWNER_UNKNOWN', 'OWNER_UNAVAILABLE'
        )
    );

ALTER TABLE dashboard_control_plane_admission_receipts_v1
    DROP CONSTRAINT IF EXISTS dashboard_control_plane_admission_receipts_v1_operation_check,
    DROP CONSTRAINT IF EXISTS dashboard_control_plane_admission_receipts_v1_execution_mode_check,
    DROP CONSTRAINT IF EXISTS dashboard_control_plane_admission_receipts_v1_check;

ALTER TABLE dashboard_control_plane_admission_receipts_v1
    ADD CONSTRAINT dashboard_control_plane_admission_receipts_v1_operation_check CHECK (
        operation IN (
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        )
    ),
    ADD CONSTRAINT dashboard_control_plane_admission_receipts_v1_execution_mode_check CHECK (
        execution_mode IN ('FRESH_RUN', 'RESOLVE_ONLY')
    );

ALTER TABLE dashboard_operation_audit_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_receipt_check;

ALTER TABLE dashboard_operation_audit_v1
    ADD CONSTRAINT dashboard_operation_audit_v1_operation_check CHECK (operation IN (
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
            'develop_composer.submit_or_resolve.v2',
            'exploratory_replay.submit_or_resolve.v2',
            'source_intake.research.submit_or_resolve.v1'
        ) AND action_kind = 'execute'
            AND receipt_identity ~ '^dashboard-control-plane-admission-v1-')
    );

-- A worker registered before this migration bound the retired operation into its identity and
-- never runs again; its row stays for the claims that name it, and only new rows are checked.
ALTER TABLE dashboard_effect_workers_v1
    DROP CONSTRAINT IF EXISTS dashboard_effect_workers_v1_operation_ids_json_check,
    DROP CONSTRAINT IF EXISTS dashboard_effect_workers_v1_operation_ids_v2;

ALTER TABLE dashboard_effect_workers_v1
    ADD CONSTRAINT dashboard_effect_workers_v1_operation_ids_v2 CHECK (
        jsonb_typeof(operation_ids_json) = 'array'
        AND jsonb_array_length(operation_ids_json) = 3
        AND operation_ids_json = '["develop_composer.submit_or_resolve.v2", "exploratory_replay.submit_or_resolve.v2", "source_intake.research.submit_or_resolve.v1"]'::jsonb
    ) NOT VALID;

ALTER TABLE dashboard_effect_dispatch_queue_v1
    DROP CONSTRAINT IF EXISTS dashboard_effect_dispatch_queue_v1_operation_id_check,
    DROP COLUMN IF EXISTS frozen_context_json,
    DROP COLUMN IF EXISTS frozen_context_digest;

ALTER TABLE dashboard_effect_dispatch_queue_v1
    ADD CONSTRAINT dashboard_effect_dispatch_queue_v1_operation_id_check CHECK (operation_id IN (
        'develop_composer.submit_or_resolve.v2',
        'exploratory_replay.submit_or_resolve.v2',
        'source_intake.research.submit_or_resolve.v1'
    ));

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

COMMIT;
