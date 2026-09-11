BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_operation_audit_v1 (
    audit_identity TEXT PRIMARY KEY CHECK (
        audit_identity ~ '^dashboard-operation-audit-v1-[0-9a-f]{64}$'
    ),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    observed_at TIMESTAMPTZ NOT NULL,
    principal_ref TEXT NOT NULL CHECK (principal_ref ~ '^[A-Za-z0-9._:/-]{1,96}$'),
    operation TEXT NOT NULL CHECK (operation IN (
        'dashboard.dependency.cancel.queued.v1',
        'dashboard.operational_cache.delete.v1'
    )),
    action_kind TEXT NOT NULL CHECK (action_kind IN ('update', 'delete')),
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'denied', 'unknown')),
    target_kind TEXT NOT NULL CHECK (target_kind = 'operation_run'),
    target_identity TEXT NOT NULL REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    correlation_identity TEXT NOT NULL REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    receipt_identity TEXT NOT NULL UNIQUE CHECK (
        receipt_identity ~ '^dashboard-operational-(cancellation|cache-deletion)-v1-[0-9a-f]{64}$'
    ),
    authorization_digest TEXT NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
    CHECK (target_identity = correlation_identity),
    CHECK (
        (operation = 'dashboard.dependency.cancel.queued.v1' AND action_kind = 'update'
            AND receipt_identity ~ '^dashboard-operational-cancellation-v1-')
        OR
        (operation = 'dashboard.operational_cache.delete.v1' AND action_kind = 'delete'
            AND receipt_identity ~ '^dashboard-operational-cache-deletion-v1-')
    ),
    CHECK (audit_identity = 'dashboard-operation-audit-v1-' || right(receipt_identity, 64))
);

CREATE INDEX IF NOT EXISTS dashboard_operation_audit_v1_observed_idx
    ON dashboard_operation_audit_v1 (observed_at DESC, audit_identity DESC);
CREATE INDEX IF NOT EXISTS dashboard_operation_audit_v1_correlation_idx
    ON dashboard_operation_audit_v1 (correlation_identity, observed_at, audit_identity);

CREATE OR REPLACE FUNCTION dashboard_operation_audit_v1_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'DASHBOARD_OPERATION_AUDIT_APPEND_ONLY' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS dashboard_operation_audit_v1_no_update_delete
    ON dashboard_operation_audit_v1;
CREATE TRIGGER dashboard_operation_audit_v1_no_update_delete
BEFORE UPDATE OR DELETE ON dashboard_operation_audit_v1
FOR EACH ROW EXECUTE FUNCTION dashboard_operation_audit_v1_reject_mutation();

INSERT INTO dashboard_operation_audit_v1
    (audit_identity, schema_version, observed_at, principal_ref, operation, action_kind,
     outcome, target_kind, target_identity, correlation_identity, receipt_identity,
     authorization_digest)
SELECT 'dashboard-operation-audit-v1-' || right(receipt_identity, 64), 1, cancelled_at,
       principal_ref, 'dashboard.dependency.cancel.queued.v1', 'update', 'succeeded',
       'operation_run', run_identity, run_identity, receipt_identity, authorization_digest
  FROM dashboard_operation_run_cancellations_v1
ON CONFLICT (audit_identity) DO NOTHING;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM dashboard_operation_run_cancellations_v1 receipt
          LEFT JOIN dashboard_operation_audit_v1 audit
            ON audit.audit_identity = 'dashboard-operation-audit-v1-' || right(receipt.receipt_identity, 64)
         WHERE audit.audit_identity IS NULL
            OR audit.observed_at <> receipt.cancelled_at
            OR audit.principal_ref <> receipt.principal_ref
            OR audit.operation <> 'dashboard.dependency.cancel.queued.v1'
            OR audit.action_kind <> 'update'
            OR audit.outcome <> 'succeeded'
            OR audit.target_kind <> 'operation_run'
            OR audit.target_identity <> receipt.run_identity
            OR audit.correlation_identity <> receipt.run_identity
            OR audit.receipt_identity <> receipt.receipt_identity
            OR audit.authorization_digest <> receipt.authorization_digest
    ) THEN
        RAISE EXCEPTION 'DASHBOARD_OPERATION_AUDIT_CANCELLATION_BACKFILL_CONFLICT' USING ERRCODE = '55000';
    END IF;
END
$block$;

INSERT INTO dashboard_operation_audit_v1
    (audit_identity, schema_version, observed_at, principal_ref, operation, action_kind,
     outcome, target_kind, target_identity, correlation_identity, receipt_identity,
     authorization_digest)
SELECT 'dashboard-operation-audit-v1-' || right(receipt_identity, 64), 1, deleted_at,
       principal_ref, 'dashboard.operational_cache.delete.v1', 'delete', 'succeeded',
       'operation_run', run_identity, run_identity, receipt_identity, authorization_digest
  FROM dashboard_operation_run_cache_deletions_v1
ON CONFLICT (audit_identity) DO NOTHING;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM dashboard_operation_run_cache_deletions_v1 receipt
          LEFT JOIN dashboard_operation_audit_v1 audit
            ON audit.audit_identity = 'dashboard-operation-audit-v1-' || right(receipt.receipt_identity, 64)
         WHERE audit.audit_identity IS NULL
            OR audit.observed_at <> receipt.deleted_at
            OR audit.principal_ref <> receipt.principal_ref
            OR audit.operation <> 'dashboard.operational_cache.delete.v1'
            OR audit.action_kind <> 'delete'
            OR audit.outcome <> 'succeeded'
            OR audit.target_kind <> 'operation_run'
            OR audit.target_identity <> receipt.run_identity
            OR audit.correlation_identity <> receipt.run_identity
            OR audit.receipt_identity <> receipt.receipt_identity
            OR audit.authorization_digest <> receipt.authorization_digest
    ) THEN
        RAISE EXCEPTION 'DASHBOARD_OPERATION_AUDIT_DELETION_BACKFILL_CONFLICT' USING ERRCODE = '55000';
    END IF;
END
$block$;

COMMIT;
