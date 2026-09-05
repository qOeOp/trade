BEGIN;

ALTER TABLE dashboard_operation_runs_v1
    DROP CONSTRAINT IF EXISTS dashboard_operation_runs_v1_trigger_kind_check;
ALTER TABLE dashboard_operation_runs_v1
    ADD CONSTRAINT dashboard_operation_runs_v1_trigger_kind_check
    CHECK (trigger_kind IN ('dashboard_bff', 'dashboard_api', 'dashboard_scheduler'));

CREATE TABLE IF NOT EXISTS dashboard_shadow_read_schedules_v1 (
    schedule_identity TEXT PRIMARY KEY CHECK (
        schedule_identity ~ '^dashboard-schedule-v1-[0-9a-f]{64}$'
    ),
    schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
    schedule_digest TEXT NOT NULL CHECK (schedule_digest ~ '^sha256:[0-9a-f]{64}$'),
    operation_id TEXT NOT NULL,
    recovery_identity_json JSONB NOT NULL CHECK (jsonb_typeof(recovery_identity_json) = 'object'),
    recovery_identity_digest TEXT NOT NULL CHECK (recovery_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
    cadence_seconds INTEGER NOT NULL CHECK (cadence_seconds BETWEEN 60 AND 86400),
    anchor_at TIMESTAMPTZ NOT NULL,
    next_due_at TIMESTAMPTZ NOT NULL,
    registry_entry_digest TEXT NOT NULL CHECK (registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'),
    compatibility_envelope_set_digest TEXT NOT NULL CHECK (
        compatibility_envelope_set_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    last_due_at TIMESTAMPTZ,
    last_run_identity TEXT REFERENCES dashboard_operation_runs_v1(run_identity) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((last_due_at IS NULL) = (last_run_identity IS NULL)),
    CHECK (last_due_at IS NULL OR last_due_at >= anchor_at),
    CHECK (next_due_at >= anchor_at),
    CHECK (last_due_at IS NULL OR next_due_at > last_due_at)
);

CREATE INDEX IF NOT EXISTS dashboard_shadow_read_schedules_v1_due_idx
    ON dashboard_shadow_read_schedules_v1 (next_due_at, schedule_identity);

COMMIT;
