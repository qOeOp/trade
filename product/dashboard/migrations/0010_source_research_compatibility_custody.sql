BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dashboard_source_research_run_bindings_v1) THEN
        RAISE EXCEPTION 'SOURCE_RESEARCH_COMPATIBILITY_CUSTODY_BACKFILL_REQUIRED';
    END IF;
END
$$;

ALTER TABLE dashboard_source_research_run_bindings_v1
    ADD COLUMN source_registry_entry_digest TEXT NOT NULL CHECK (
        source_registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    ADD COLUMN source_compatibility_envelope_digest TEXT CHECK (
        source_compatibility_envelope_digest IS NULL OR
        source_compatibility_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    ADD COLUMN research_registry_entry_digest TEXT NOT NULL CHECK (
        research_registry_entry_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    ADD COLUMN research_compatibility_envelope_digest TEXT CHECK (
        research_compatibility_envelope_digest IS NULL OR
        research_compatibility_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT dashboard_source_research_compatibility_custody_v1 CHECK (
        (requested_action = 'RUN'
            AND source_compatibility_envelope_digest IS NOT NULL
            AND research_compatibility_envelope_digest IS NOT NULL)
        OR
        (requested_action = 'RESOLVE'
            AND source_compatibility_envelope_digest IS NULL
            AND research_compatibility_envelope_digest IS NULL)
    );

COMMIT;
