BEGIN;

-- A queued dependency may become terminal without ever starting. Replace the
-- original anonymous timing checks with named constraints that retain every
-- previous invariant and admit only that exact cancellation shape.
DO $migration$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'dashboard_operation_runs_v1'::regclass
           AND contype = 'c'
           AND (
               (pg_get_constraintdef(oid) LIKE '%state%'
                AND (pg_get_constraintdef(oid) LIKE '%started_at%'
                     OR pg_get_constraintdef(oid) LIKE '%finished_at%'))
               OR (pg_get_constraintdef(oid) LIKE '%finished_at%'
                   AND pg_get_constraintdef(oid) LIKE '%started_at%')
           )
    LOOP
        EXECUTE format('ALTER TABLE dashboard_operation_runs_v1 DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$migration$;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_started_state_v2,
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_finished_state_v2,
    ADD CONSTRAINT dashboard_operation_runs_v1_started_state_v2 CHECK (
        (state = 'queued' AND started_at IS NULL AND finished_at IS NULL)
        OR (state = 'cancelled' AND finished_at IS NOT NULL)
        OR (state IN ('running', 'succeeded', 'failed', 'unknown') AND started_at IS NOT NULL)
    ),
    ADD CONSTRAINT dashboard_operation_runs_v1_finished_state_v2 CHECK (
        (state IN ('queued', 'running')) = (finished_at IS NULL)
        AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
    );

CREATE TABLE IF NOT EXISTS dashboard_operation_run_cancellations_v1 (
    run_identity TEXT PRIMARY KEY REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    receipt_identity TEXT NOT NULL UNIQUE CHECK (
        receipt_identity ~ '^dashboard-operational-cancellation-v1-[0-9a-f]{64}$'
    ),
    action_identity TEXT NOT NULL UNIQUE CHECK (
        action_identity ~ '^dashboard-operational-action-v1-[0-9a-f]{64}$'
    ),
    prior_state TEXT NOT NULL CHECK (prior_state = 'queued'),
    prior_transition_version BIGINT NOT NULL CHECK (prior_transition_version >= 1),
    state TEXT NOT NULL CHECK (state = 'cancelled'),
    transition_version BIGINT NOT NULL CHECK (transition_version = prior_transition_version + 1),
    principal_ref TEXT NOT NULL CHECK (principal_ref ~ '^[A-Za-z0-9._:/-]{1,96}$'),
    authorization_digest TEXT NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
    cancelled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
