BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_control_plane_admission_receipts_v1 (
    receipt_identity TEXT PRIMARY KEY CHECK (
        receipt_identity ~ '^dashboard-control-plane-admission-v1-[0-9a-f]{64}$'
    ),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    admitted_at TIMESTAMPTZ NOT NULL,
    principal_ref TEXT NOT NULL CHECK (principal_ref ~ '^[A-Za-z0-9._:/-]{1,96}$'),
    operation TEXT NOT NULL CHECK (operation IN (
        'artifact_build.formation_execute.v1',
        'source_intake.research.submit_or_resolve.v1'
    )),
    requested_action TEXT NOT NULL CHECK (requested_action IN ('RUN', 'RESOLVE')),
    execution_mode TEXT NOT NULL CHECK (execution_mode IN (
        'FRESH_RUN', 'CONTINUE_CLAIMED_ONCE', 'RESOLVE_ONLY'
    )),
    run_identity TEXT NOT NULL REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    authorization_digest TEXT NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
    CHECK (
        operation = 'artifact_build.formation_execute.v1'
        OR execution_mode <> 'CONTINUE_CLAIMED_ONCE'
    )
);

CREATE INDEX IF NOT EXISTS dashboard_control_plane_admission_receipts_v1_run_idx
    ON dashboard_control_plane_admission_receipts_v1 (run_identity, admitted_at, receipt_identity);

CREATE OR REPLACE FUNCTION dashboard_control_plane_admission_receipts_v1_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'DASHBOARD_CONTROL_PLANE_ADMISSION_APPEND_ONLY' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS dashboard_control_plane_admission_receipts_v1_no_update_delete
    ON dashboard_control_plane_admission_receipts_v1;
CREATE TRIGGER dashboard_control_plane_admission_receipts_v1_no_update_delete
BEFORE UPDATE OR DELETE ON dashboard_control_plane_admission_receipts_v1
FOR EACH ROW EXECUTE FUNCTION dashboard_control_plane_admission_receipts_v1_reject_mutation();

ALTER TABLE dashboard_operation_audit_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_action_kind_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_receipt_identity_check,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_check1,
    DROP CONSTRAINT IF EXISTS dashboard_operation_audit_v1_operation_receipt_check;

ALTER TABLE dashboard_operation_audit_v1
    ADD CONSTRAINT dashboard_operation_audit_v1_operation_check CHECK (operation IN (
        'artifact_build.formation_execute.v1',
        'dashboard.dependency.cancel.queued.v1',
        'dashboard.operational_cache.delete.v1',
        'source_intake.research.submit_or_resolve.v1'
    )),
    ADD CONSTRAINT dashboard_operation_audit_v1_action_kind_check CHECK (
        action_kind IN ('execute', 'update', 'delete')
    ),
    ADD CONSTRAINT dashboard_operation_audit_v1_receipt_identity_check CHECK (
        receipt_identity ~ '^dashboard-(operational-(cancellation|cache-deletion)|control-plane-admission)-v1-[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT dashboard_operation_audit_v1_operation_receipt_check CHECK (
        (operation = 'dashboard.dependency.cancel.queued.v1' AND action_kind = 'update'
            AND receipt_identity ~ '^dashboard-operational-cancellation-v1-')
        OR
        (operation = 'dashboard.operational_cache.delete.v1' AND action_kind = 'delete'
            AND receipt_identity ~ '^dashboard-operational-cache-deletion-v1-')
        OR
        (operation IN (
            'artifact_build.formation_execute.v1',
            'source_intake.research.submit_or_resolve.v1'
        ) AND action_kind = 'execute'
            AND receipt_identity ~ '^dashboard-control-plane-admission-v1-')
    );

COMMIT;
