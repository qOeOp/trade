BEGIN;

ALTER TABLE dashboard_source_research_run_bindings_v1
    ADD COLUMN input_custody_state TEXT NOT NULL DEFAULT 'LEGACY_UNAVAILABLE' CHECK (
        input_custody_state IN ('AVAILABLE', 'NOT_APPLICABLE', 'LEGACY_UNAVAILABLE')
    ),
    ADD COLUMN run_request_schema_version SMALLINT,
    ADD COLUMN run_request_json JSONB,
    ADD COLUMN run_request_digest TEXT CHECK (
        run_request_digest IS NULL OR run_request_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT dashboard_source_research_input_custody_v1 CHECK (
        (input_custody_state = 'AVAILABLE'
            AND requested_action = 'RUN'
            AND run_request_schema_version = 1
            AND run_request_json IS NOT NULL
            AND run_request_digest IS NOT NULL)
        OR
        (input_custody_state = 'NOT_APPLICABLE'
            AND requested_action = 'RESOLVE'
            AND run_request_schema_version IS NULL
            AND run_request_json IS NULL
            AND run_request_digest IS NULL)
        OR
        (input_custody_state = 'LEGACY_UNAVAILABLE'
            AND run_request_schema_version IS NULL
            AND run_request_json IS NULL
            AND run_request_digest IS NULL)
    );

ALTER TABLE dashboard_source_research_run_bindings_v1
    ALTER COLUMN input_custody_state DROP DEFAULT;

COMMIT;
