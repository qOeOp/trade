use std::fmt::Display;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_backtest_owner_contracts::{ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2};
use vibe_product_edge::ProductEdgeAdmissionReadbackV1;

use crate::{
    artifact_build::{ArtifactBuildDisposition, verify_artifact_build_admission},
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V1, EXPLORATORY_REPLAY_MUTATION_EFFECT_V2,
        EXPLORATORY_REPLAY_OPERATION_V1, EXPLORATORY_REPLAY_OPERATION_V2,
        EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V1, EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2,
        EXPLORATORY_REPLAY_SCHEMA_V1, EXPLORATORY_REPLAY_SCHEMA_V2,
        ExploratoryReplayAvailabilityV1, ExploratoryReplayCommitReceiptV1,
        ExploratoryReplayCommitReceiptV2, ExploratoryReplayCommitResultV1,
        ExploratoryReplayCommitResultV2, ExploratoryReplayNextLegalActionV1,
        ExploratoryReplayOwnerError, ExploratoryReplayReadResultV1, ExploratoryReplayReadResultV2,
        ExploratoryReplayRecoverySelectorV2, ExploratoryReplayRequestLocatorV1,
        ExploratoryReplayRequestLocatorV2, ExploratoryReplayRequestProjectionV1,
        ExploratoryReplayRequestProposalV1, ExploratoryReplayRequestProposalV2,
        FrozenExploratoryReplayRequestV1, IdentityDigestV1, SealedExploratoryReplayReadbackV1,
        SealedExploratoryReplayReadbackV2, VersionedIdentityV1,
        exploratory_replay_admission_payload_v1, exploratory_replay_admission_payload_v2,
    },
    product_edge::{
        FrozenResearchGoalIntent, RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, ResearchRequestDisposition,
    },
    rd_owner_postgres_custody::{AttemptState, VerifiedAttemptCustodyV1},
};

const LOCK_FUNCTION: &str = "rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)";
const INTERNAL_VERIFY_FUNCTION: &str =
    "rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text)";
const LOCK_FUNCTION_V2: &str =
    "rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)";

#[derive(Debug, Clone)]
pub(crate) struct BoundBacktestReadV1 {
    pool: PgPool,
}

#[derive(Serialize)]
struct FrozenMeaningV1<'a> {
    schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_schema_version: Option<u16>,
    proposal: &'a ExploratoryReplayRequestProposalV1,
    product_edge_request_semantic_digest: &'a str,
    research_receipt_identity: &'a str,
    intent_semantic_digest: &'a str,
    trial_family_root_digest: &'a str,
    census_frontier_digest: &'a str,
    artifact_family_binding_digest: &'a str,
    artifact_family_binding_receipt_identity: &'a str,
    artifact_review_identity: &'a str,
    exact_code_bytes_sha256_digest: &'a str,
    source_capsule_digest: &'a str,
    build_recipe_digest: &'a str,
    dependency_identity: &'a str,
    trial_family_outbox_event_identity: &'a str,
    trial_family_outbox_digest: &'a str,
    trial_family_outbox_committed_at_epoch_ms: u64,
    artifact_family_outbox_event_identity: &'a str,
    artifact_family_outbox_digest: &'a str,
    artifact_family_outbox_committed_at_epoch_ms: u64,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredFrozenV1 {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_schema_version: Option<u16>,
    proposal: ExploratoryReplayRequestProposalV1,
    product_edge_request_semantic_digest: String,
    research_receipt_identity: String,
    intent_semantic_digest: String,
    trial_family_root_digest: String,
    census_frontier_digest: String,
    artifact_family_binding_digest: String,
    artifact_family_binding_receipt_identity: String,
    artifact_review_identity: String,
    exact_code_bytes_sha256_digest: String,
    source_capsule_digest: String,
    build_recipe_digest: String,
    dependency_identity: String,
    trial_family_outbox_event_identity: String,
    trial_family_outbox_digest: String,
    trial_family_outbox_committed_at_epoch_ms: u64,
    artifact_family_outbox_event_identity: String,
    artifact_family_outbox_digest: String,
    artifact_family_outbox_committed_at_epoch_ms: u64,
    committed_at_epoch_ms: u64,
    request_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FamilyFrozenOutboxV1 {
    schema_version: u32,
    research_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    root_receipt_identity: String,
    membership_receipt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay_execution_policy_v2: Option<crate::ReplayPolicyCatalogBindingV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBoundOutboxV1 {
    schema_version: u32,
    artifact_identity: String,
    build_receipt_identity: String,
    trial_family_identity: String,
    binding_identity: String,
    binding_receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    request_identity: String,
    request_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    schema_version: u32,
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    artifact_identity: String,
    census_frontier_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV2 {
    schema_version: u16,
    request_identity: String,
    meaning_digest: String,
    seal_digest: String,
    receipt_identity: String,
    lineage_request_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredReceiptV2 {
    schema_version: u16,
    receipt_identity: String,
    request_identity: String,
    meaning_digest: String,
    seal_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone)]
struct PreparedSealV2 {
    proposal: ExploratoryReplayRequestProposalV2,
    canonical_request_bytes: Vec<u8>,
    meaning_digest: String,
}

#[derive(Debug)]
struct CommittedReplay {
    frozen: StoredFrozenV1,
    receipt: StoredReceiptV1,
    v2: Option<(PreparedSealV2, StoredReceiptV2)>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedEnvelopeV1 {
    schema_version: u32,
    availability: ExploratoryReplayAvailabilityV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner_cut_epoch_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    frozen: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    outbox: Option<LockedOutboxRowV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    trial_family_outbox: Option<LockedOutboxRowV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    artifact_family_outbox: Option<LockedOutboxRowV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_canonical_request_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_meaning_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_seal_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_receipt: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_outbox: Option<LockedOutboxRowV1>,
}

struct ValidatedAvailableEnvelopeV1 {
    frozen: StoredFrozenV1,
    receipt: StoredReceiptV1,
    owner_cut_epoch_ms: u64,
}

pub(crate) async fn require_runtime_relation_name_census(pool: &PgPool) -> Result<(), sqlx::Error> {
    let relation_names_are_unambiguous: bool = sqlx::query_scalar(
        "
        WITH names AS (
          SELECT pg_catalog.to_regclass(
                   'public.rd_exploratory_replay_request_custody_v1'
                 ) AS internal_oid,
                 pg_catalog.to_regclass(
                   'public.rd_exploratory_replay_requests_v1'
                 ) AS public_oid
        )
        SELECT internal_oid IS NULL
           AND (
             public_oid IS NULL
             OR EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class relation
                WHERE relation.oid=public_oid
                  AND relation.relkind='r'
                  AND relation.relpersistence='p'
                  AND (
                    SELECT pg_catalog.count(*)=13
                       AND pg_catalog.bool_and(CASE attribute.attname
                         WHEN 'replay_request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'run_attempt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'semantic_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'request_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'handoff_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                         WHEN 'committed_at_epoch_ms' THEN attribute.atttypid='pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'research_view_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                         WHEN 'request_schema_version' THEN attribute.atttypid='pg_catalog.int2'::pg_catalog.regtype AND attribute.attnotnull
                         WHEN 'v2_canonical_request_bytes' THEN attribute.atttypid='pg_catalog.bytea'::pg_catalog.regtype AND NOT attribute.attnotnull
                         WHEN 'v2_meaning_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                         WHEN 'v2_seal_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                         WHEN 'v2_receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                         ELSE false
                       END)
                      FROM pg_catalog.pg_attribute attribute
                     WHERE attribute.attrelid=public_oid
                       AND attribute.attnum>0
                       AND NOT attribute.attisdropped
                  )
                  AND EXISTS (
                    SELECT 1
                      FROM pg_catalog.pg_constraint constraint_entry
                     WHERE constraint_entry.conrelid=public_oid
                       AND constraint_entry.contype='p'
                       AND constraint_entry.conkey=ARRAY[(
                         SELECT attribute.attnum
                           FROM pg_catalog.pg_attribute attribute
                          WHERE attribute.attrelid=public_oid
                            AND attribute.attname='replay_request_identity'
                       )]::smallint[]
                  )
                  AND EXISTS (
                    SELECT 1
                      FROM pg_catalog.pg_constraint constraint_entry
                     WHERE constraint_entry.conrelid=public_oid
                       AND constraint_entry.contype='u'
                       AND constraint_entry.conkey=ARRAY[(
                         SELECT attribute.attnum
                           FROM pg_catalog.pg_attribute attribute
                          WHERE attribute.attrelid=public_oid
                            AND attribute.attname='run_attempt_identity'
                       )]::smallint[]
                  )
             )
           )
          FROM names
        ",
    )
    .fetch_one(pool)
    .await?;

    if !relation_names_are_unambiguous {
        return Err(sqlx::Error::Protocol(
            "runtime R&D exploratory Replay relation topology is ambiguous or incompatible"
                .to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ExploratoryReplayOwnerError> {
    let mut migration = pool.begin().await.map_err(storage)?;
    sqlx::query(
        "
        DO $migration$
        DECLARE public_oid oid;
        DECLARE internal_oid oid;
        DECLARE sealed_oid oid;
        DECLARE candidate_oid oid;
        DECLARE candidate_is_current boolean;
        DECLARE public_is_current boolean := false;
        DECLARE public_is_legacy boolean := false;
        DECLARE current_candidate_count integer;
        BEGIN
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('public.rd_exploratory_replay_request_custody_v1')
          );
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('public.rd_sealed_exploratory_replay_requests_v1')
          );
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('public.rd_exploratory_replay_requests_v1')
          );
          public_oid := pg_catalog.to_regclass('public.rd_exploratory_replay_requests_v1');
          internal_oid := pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1');
          sealed_oid := pg_catalog.to_regclass('public.rd_sealed_exploratory_replay_requests_v1');

          FOREACH candidate_oid IN ARRAY ARRAY[public_oid,internal_oid,sealed_oid] LOOP
            CONTINUE WHEN candidate_oid IS NULL;
            SELECT relation.relkind='r'
               AND relation.relpersistence='p'
               AND (
                 SELECT pg_catalog.count(*)=19
                    AND pg_catalog.bool_and(CASE attribute.attname
                      WHEN 'request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'request_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'build_request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'attempt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'intent_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'trial_family_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'artifact_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'build_receipt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'artifact_family_binding_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'census_frontier_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'frozen_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'lifecycle_state' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'committed_at_epoch_ms' THEN attribute.atttypid='pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'request_schema_version' THEN attribute.atttypid='pg_catalog.int2'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'v2_canonical_request_bytes' THEN attribute.atttypid='pg_catalog.bytea'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_meaning_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_seal_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                      ELSE false
                    END)
                   FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=candidate_oid AND attribute.attnum>0 AND NOT attribute.attisdropped
               )
               AND EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
                  WHERE constraint_entry.conrelid=candidate_oid
                    AND constraint_entry.contype='p'
                    AND constraint_entry.conkey=ARRAY[(
                      SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
                       WHERE attribute.attrelid=candidate_oid AND attribute.attname='request_identity'
                    )]::smallint[]
               )
              INTO candidate_is_current
              FROM pg_catalog.pg_class relation WHERE relation.oid=candidate_oid;

            IF candidate_oid=public_oid THEN
              public_is_current := candidate_is_current;
            ELSIF NOT candidate_is_current THEN
              RAISE EXCEPTION 'unknown exploratory Replay table shape: %', candidate_oid::pg_catalog.regclass;
            END IF;
          END LOOP;

          IF public_oid IS NOT NULL THEN
            SELECT relation.relkind='r'
               AND relation.relpersistence='p'
               AND (
                 SELECT pg_catalog.count(*)=13
                    AND pg_catalog.bool_and(CASE attribute.attname
                      WHEN 'replay_request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'run_attempt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'semantic_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'request_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'handoff_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'committed_at_epoch_ms' THEN attribute.atttypid='pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'research_view_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'request_schema_version' THEN attribute.atttypid='pg_catalog.int2'::pg_catalog.regtype AND attribute.attnotnull
                      WHEN 'v2_canonical_request_bytes' THEN attribute.atttypid='pg_catalog.bytea'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_meaning_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_seal_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
                      WHEN 'v2_receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
                      ELSE false
                    END)
                   FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=public_oid AND attribute.attnum>0 AND NOT attribute.attisdropped
               )
               AND EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
                  WHERE constraint_entry.conrelid=public_oid
                    AND constraint_entry.contype='p'
                    AND constraint_entry.conkey=ARRAY[(
                      SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
                       WHERE attribute.attrelid=public_oid AND attribute.attname='replay_request_identity'
                    )]::smallint[]
               )
               AND EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
                  WHERE constraint_entry.conrelid=public_oid
                    AND constraint_entry.contype='u'
                    AND constraint_entry.conkey=ARRAY[(
                      SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
                       WHERE attribute.attrelid=public_oid AND attribute.attname='run_attempt_identity'
                    )]::smallint[]
               )
              INTO public_is_legacy
              FROM pg_catalog.pg_class relation WHERE relation.oid=public_oid;

            IF NOT public_is_current AND NOT public_is_legacy THEN
              RAISE EXCEPTION 'unknown exploratory Replay table shape: %', public_oid::pg_catalog.regclass;
            END IF;
          END IF;

          current_candidate_count :=
            CASE WHEN public_is_current THEN 1 ELSE 0 END
            + CASE WHEN internal_oid IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN sealed_oid IS NOT NULL THEN 1 ELSE 0 END;
          IF current_candidate_count>1 THEN
            RAISE EXCEPTION 'ambiguous duplicate current exploratory Replay tables';
          ELSIF public_is_current THEN
            ALTER TABLE public.rd_exploratory_replay_requests_v1
              RENAME TO rd_sealed_exploratory_replay_requests_v1;
          ELSIF internal_oid IS NOT NULL THEN
            ALTER TABLE public.rd_exploratory_replay_request_custody_v1
              RENAME TO rd_sealed_exploratory_replay_requests_v1;
          ELSIF sealed_oid IS NULL THEN
            CREATE TABLE public.rd_sealed_exploratory_replay_requests_v1 (
              request_identity TEXT PRIMARY KEY,
              request_digest TEXT NOT NULL,
              build_request_identity TEXT NOT NULL,
              attempt_identity TEXT NOT NULL,
              intent_identity TEXT NOT NULL,
              trial_family_identity TEXT NOT NULL,
              artifact_identity TEXT NOT NULL,
              build_receipt_identity TEXT NOT NULL,
              artifact_family_binding_identity TEXT NOT NULL,
              census_frontier_identity TEXT NOT NULL,
              frozen_json JSONB NOT NULL,
              receipt_json JSONB NOT NULL,
              lifecycle_state TEXT NOT NULL DEFAULT 'FROZEN',
              committed_at_epoch_ms BIGINT NOT NULL,
              request_schema_version SMALLINT NOT NULL DEFAULT 1,
              v2_canonical_request_bytes BYTEA,
              v2_meaning_digest TEXT,
              v2_seal_digest TEXT,
              v2_receipt_json JSONB
            );
          END IF;
        END
        $migration$;
        ",
    )
    .execute(&mut *migration)
    .await
    .map_err(storage)?;

    for statement in [
        "CREATE UNIQUE INDEX IF NOT EXISTS rd_exploratory_replay_artifact_request_v1 ON public.rd_sealed_exploratory_replay_requests_v1(artifact_identity, request_identity)",
        "ALTER TABLE public.rd_sealed_exploratory_replay_requests_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_sealed_exploratory_replay_requests_v1 FROM PUBLIC",
        "REVOKE ALL ON SCHEMA rd_owner_api FROM backtest_owner",
        "GRANT USAGE ON SCHEMA rd_owner_api TO backtest_owner",
    ] {
        sqlx::query(statement)
            .execute(&mut *migration)
            .await
            .map_err(storage)?;
    }
    sqlx::query(
        "
        DO $acl$
        DECLARE grantee_name text;
        DECLARE column_name text;
        BEGIN
          FOR grantee_name IN
            SELECT role.rolname
              FROM pg_catalog.pg_class relation
              CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
                relation.relacl,
                pg_catalog.acldefault('r', relation.relowner)
              )) acl
              JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
             WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
               AND acl.grantee<>relation.relowner
             GROUP BY role.rolname
          LOOP
            EXECUTE pg_catalog.format(
              'REVOKE ALL ON TABLE public.rd_sealed_exploratory_replay_requests_v1 FROM %I',
              grantee_name
            );
          END LOOP;

          FOR column_name IN
            SELECT attribute.attname
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
              CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
             WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
               AND acl.grantee=0
             GROUP BY attribute.attname
          LOOP
            EXECUTE pg_catalog.format(
              'REVOKE ALL (%I) ON TABLE public.rd_sealed_exploratory_replay_requests_v1 FROM PUBLIC',
              column_name
            );
          END LOOP;

          FOR grantee_name,column_name IN
            SELECT role.rolname,attribute.attname
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
              CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
              JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
             WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
               AND acl.grantee<>0
               AND acl.grantee<>relation.relowner
             GROUP BY role.rolname,attribute.attname
          LOOP
            EXECUTE pg_catalog.format(
              'REVOKE ALL (%I) ON TABLE public.rd_sealed_exploratory_replay_requests_v1 FROM %I',
              column_name,
              grantee_name
            );
          END LOOP;
        END
        $acl$;
        ",
    )
    .execute(&mut *migration)
    .await
    .map_err(storage)?;
    migration.commit().await.map_err(storage)?;

    let mut publication = pool.begin().await.map_err(storage)?;

    for statement in [
        "DROP FUNCTION IF EXISTS rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)",
        "DROP FUNCTION IF EXISTS rd_owner_api.resolve_exploratory_replay_request_v2(text,text)",
        "DROP FUNCTION IF EXISTS rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text)",
        "DROP FUNCTION IF EXISTS rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)",
        "DROP FUNCTION IF EXISTS rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text)",
    ] {
        sqlx::query(statement)
            .execute(&mut *publication)
            .await
            .map_err(storage)?;
    }
    sqlx::query(
        "
        CREATE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(
          requested_request_identity text,
          requested_request_digest text,
          requested_receipt_identity text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER
        SET search_path = pg_catalog
        AS $function$
        DECLARE sealed record;
        DECLARE locked_outbox record;
        DECLARE locked_trial_family_outbox record;
        DECLARE locked_artifact_family_outbox record;
        DECLARE owner_cut bigint;
        DECLARE result_availability text := 'AVAILABLE';
        BEGIN
          IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
          SELECT * INTO sealed
            FROM public.rd_sealed_exploratory_replay_requests_v1
           WHERE request_identity = requested_request_identity
             AND (requested_request_digest = '' OR request_digest = requested_request_digest)
           FOR SHARE;
          IF NOT FOUND THEN RETURN NULL; END IF;
          IF sealed.lifecycle_state = 'REVOKED'
             AND (requested_request_digest <> '' OR requested_receipt_identity <> '') THEN
            RETURN pg_catalog.jsonb_build_object('schema_version',1,'availability','STALE');
          END IF;
          IF sealed.lifecycle_state = 'REVOKED' THEN
            result_availability := 'STALE';
          END IF;
          IF sealed.lifecycle_state NOT IN ('FROZEN','REVOKED')
             OR (requested_receipt_identity <> '' AND sealed.receipt_json->>'receipt_identity' <> requested_receipt_identity)
             OR sealed.frozen_json->>'schema_version' <> '1'
             OR coalesce(sealed.frozen_json->>'request_schema_version','1') <> sealed.request_schema_version::text
             OR sealed.frozen_json->>'request_digest' <> sealed.request_digest
             OR sealed.frozen_json->>'committed_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
             OR sealed.frozen_json->'proposal'->>'request_identity' <> sealed.request_identity
             OR sealed.frozen_json->'proposal'->>'build_request_identity' <> sealed.build_request_identity
             OR sealed.frozen_json->'proposal'->>'attempt_identity' <> sealed.attempt_identity
             OR sealed.frozen_json->'proposal'->>'intent_identity' <> sealed.intent_identity
             OR sealed.frozen_json->'proposal'->>'trial_family_identity' <> sealed.trial_family_identity
             OR sealed.frozen_json->'proposal'->>'artifact_identity' <> sealed.artifact_identity
             OR sealed.frozen_json->'proposal'->>'build_receipt_identity' <> sealed.build_receipt_identity
             OR sealed.frozen_json->'proposal'->>'artifact_family_binding_identity' <> sealed.artifact_family_binding_identity
             OR sealed.frozen_json->'proposal'->>'census_frontier_identity' <> sealed.census_frontier_identity
             OR sealed.receipt_json->>'schema_version' <> '1'
             OR sealed.receipt_json->>'request_identity' <> sealed.request_identity
             OR sealed.receipt_json->>'request_digest' <> sealed.request_digest
             OR sealed.receipt_json->>'committed_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
          THEN RETURN NULL; END IF;

          SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
                 committed_at_epoch_ms
            INTO STRICT locked_trial_family_outbox
            FROM public.rd_owner_outbox_v1
           WHERE aggregate_identity=sealed.trial_family_identity
             AND event_kind='TRIAL_FAMILY_FROZEN_V1'
           FOR SHARE;
          SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
                 committed_at_epoch_ms
            INTO STRICT locked_artifact_family_outbox
            FROM public.rd_owner_outbox_v1
           WHERE aggregate_identity=sealed.artifact_identity
             AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'
           FOR SHARE;

          IF NOT EXISTS (
            SELECT 1 FROM public.rd_research_request_receipts_v1 research
             WHERE research.intent_json->>'intent_identity'=sealed.intent_identity
               AND research.intent_json->>'semantic_digest'=sealed.frozen_json->>'intent_semantic_digest'
               AND research.receipt_json->>'receipt_identity'=sealed.frozen_json->>'research_receipt_identity'
               AND research.receipt_json->>'disposition'='ACCEPTED'
               AND research.view_json->>'availability'='AVAILABLE'
               AND research.view_json->>'phase'='ARTIFACT_AVAILABLE'
               AND research.view_json->>'attempt_identity'=sealed.attempt_identity
               AND research.view_json->>'artifact_identity'=sealed.artifact_identity
               AND research.view_json->>'build_receipt_identity'=sealed.build_receipt_identity
               AND research.view_json->>'artifact_review_identity'=sealed.frozen_json->>'artifact_review_identity'
          ) OR NOT EXISTS (
            SELECT 1 FROM public.rd_trial_families_v1 family
            JOIN public.rd_trial_family_heads_v1 head USING (trial_family_identity)
             WHERE family.trial_family_identity=sealed.trial_family_identity
               AND family.intent_identity=sealed.intent_identity
               AND family.root_digest=sealed.frozen_json->>'trial_family_root_digest'
               AND head.frontier_identity=sealed.census_frontier_identity
               AND head.frontier_digest=sealed.frozen_json->>'census_frontier_digest'
          ) OR NOT EXISTS (
            SELECT 1 FROM public.rd_artifact_trial_family_bindings_v1 binding
             WHERE binding.binding_identity=sealed.artifact_family_binding_identity
               AND binding.artifact_identity=sealed.artifact_identity
               AND binding.build_receipt_identity=sealed.build_receipt_identity
               AND binding.intent_identity=sealed.intent_identity
               AND binding.trial_family_identity=sealed.trial_family_identity
               AND binding.binding_digest=sealed.frozen_json->>'artifact_family_binding_digest'
               AND binding.binding_receipt_json->>'receipt_identity'=sealed.frozen_json->>'artifact_family_binding_receipt_identity'
          ) OR NOT EXISTS (
            SELECT 1 FROM public.rd_artifact_build_attempts_v1 attempt
             WHERE attempt.build_request_identity=sealed.build_request_identity
               AND attempt.attempt_identity=sealed.attempt_identity
               AND attempt.attempt_json->>'state'='TERMINAL'
               AND attempt.attempt_json->'receipt'->>'disposition'='SUCCESS'
               AND attempt.attempt_json->'receipt'->>'artifact_identity'=sealed.artifact_identity
               AND attempt.attempt_json->'receipt'->>'build_receipt_identity'=sealed.build_receipt_identity
          ) OR NOT EXISTS (
            SELECT 1 FROM public.rd_strategy_artifacts_v1 artifact
             WHERE artifact.artifact_digest=sealed.artifact_identity
               AND artifact.intent_identity=sealed.intent_identity
               AND artifact.attempt_identity=sealed.attempt_identity
               AND artifact.build_receipt_json->>'build_receipt_identity'=sealed.build_receipt_identity
               AND artifact.build_receipt_json->>'wasm_digest'=sealed.frozen_json->'proposal'->>'exact_code_bytes_digest'
               AND ('sha256:' || pg_catalog.encode(pg_catalog.sha256(artifact.wasm_bytes),'hex'))=sealed.frozen_json->>'exact_code_bytes_sha256_digest'
               AND artifact.build_receipt_json->>'source_capsule_digest'=sealed.frozen_json->>'source_capsule_digest'
               AND artifact.build_receipt_json->>'build_recipe_digest'=sealed.frozen_json->>'build_recipe_digest'
               AND artifact.build_receipt_json->>'dependency_identity'=sealed.frozen_json->>'dependency_identity'
               AND artifact.artifact_review_json->>'review_identity'=sealed.frozen_json->>'artifact_review_identity'
          ) OR NOT EXISTS (
            SELECT 1
              FROM public.rd_owner_outbox_v1 family_outbox
              JOIN public.rd_trial_families_v1 family
                ON family.trial_family_identity=family_outbox.aggregate_identity
              JOIN public.rd_trial_family_members_v1 member
                ON member.trial_family_identity=family.trial_family_identity
               AND member.ordinal=0
              JOIN public.rd_trial_family_heads_v1 head
                ON head.trial_family_identity=family.trial_family_identity
             WHERE family_outbox.aggregate_identity=sealed.trial_family_identity
               AND family_outbox.event_kind='TRIAL_FAMILY_FROZEN_V1'
               AND family_outbox.payload_digest=sealed.frozen_json->>'trial_family_outbox_digest'
               AND family_outbox.event_identity=sealed.frozen_json->>'trial_family_outbox_event_identity'
               AND family_outbox.event_identity='rd-owner-outbox-v1-' || pg_catalog.replace(head.frontier_digest,'sha256:','')
               AND family_outbox.committed_at_epoch_ms=(sealed.frozen_json->>'trial_family_outbox_committed_at_epoch_ms')::bigint
               AND family_outbox.committed_at_epoch_ms=family.committed_at_epoch_ms
               AND family_outbox.payload_json=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                 'schema_version',1,
                 'research_receipt_identity',sealed.frozen_json->>'research_receipt_identity',
                 'intent_identity',sealed.intent_identity,
                 'trial_family_identity',sealed.trial_family_identity,
                 'root_receipt_identity',family.root_receipt_json->>'receipt_identity',
                 'membership_receipt_identity',member.membership_receipt_json->>'receipt_identity',
                 'census_frontier_identity',head.frontier_identity,
                 'census_frontier_digest',head.frontier_digest,
                 'replay_execution_policy_v2',family.root_json->'policy'->'replay_execution_policy_v2'
               ))
          ) OR NOT EXISTS (
            SELECT 1
              FROM public.rd_owner_outbox_v1 artifact_outbox
              JOIN public.rd_artifact_trial_family_bindings_v1 binding
                ON binding.artifact_identity=artifact_outbox.aggregate_identity
             WHERE artifact_outbox.aggregate_identity=sealed.artifact_identity
               AND artifact_outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'
               AND artifact_outbox.payload_digest=sealed.frozen_json->>'artifact_family_outbox_digest'
               AND artifact_outbox.event_identity=sealed.frozen_json->>'artifact_family_outbox_event_identity'
               AND artifact_outbox.event_identity='rd-owner-outbox-v1-' || pg_catalog.replace(binding.binding_digest,'sha256:','')
               AND artifact_outbox.committed_at_epoch_ms=(sealed.frozen_json->>'artifact_family_outbox_committed_at_epoch_ms')::bigint
               AND artifact_outbox.committed_at_epoch_ms=binding.committed_at_epoch_ms
               AND artifact_outbox.payload_json=pg_catalog.jsonb_build_object(
                 'schema_version',1,
                 'artifact_identity',sealed.artifact_identity,
                 'build_receipt_identity',sealed.build_receipt_identity,
                 'trial_family_identity',sealed.trial_family_identity,
                 'binding_identity',sealed.artifact_family_binding_identity,
                 'binding_receipt_identity',sealed.frozen_json->>'artifact_family_binding_receipt_identity'
               )
          ) THEN RETURN NULL; END IF;

          SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
                 committed_at_epoch_ms
            INTO STRICT locked_outbox
            FROM public.rd_owner_outbox_v1
           WHERE aggregate_identity=sealed.request_identity
             AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'
           FOR SHARE;
          owner_cut := pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint;
          RETURN pg_catalog.jsonb_build_object(
            'schema_version',1,
            'availability',result_availability,
            'owner_cut_epoch_ms',owner_cut,
            'frozen',sealed.frozen_json,
            'receipt',sealed.receipt_json,
            'outbox',pg_catalog.jsonb_build_object(
              'event_identity',locked_outbox.event_identity,
              'aggregate_identity',locked_outbox.aggregate_identity,
              'event_kind',locked_outbox.event_kind,
              'payload_digest',locked_outbox.payload_digest,
              'payload_json',locked_outbox.payload_json,
              'committed_at_epoch_ms',locked_outbox.committed_at_epoch_ms
            ),
            'trial_family_outbox',pg_catalog.jsonb_build_object(
              'event_identity',locked_trial_family_outbox.event_identity,
              'aggregate_identity',locked_trial_family_outbox.aggregate_identity,
              'event_kind',locked_trial_family_outbox.event_kind,
              'payload_digest',locked_trial_family_outbox.payload_digest,
              'payload_json',locked_trial_family_outbox.payload_json,
              'committed_at_epoch_ms',locked_trial_family_outbox.committed_at_epoch_ms
            ),
            'artifact_family_outbox',pg_catalog.jsonb_build_object(
              'event_identity',locked_artifact_family_outbox.event_identity,
              'aggregate_identity',locked_artifact_family_outbox.aggregate_identity,
              'event_kind',locked_artifact_family_outbox.event_kind,
              'payload_digest',locked_artifact_family_outbox.payload_digest,
              'payload_json',locked_artifact_family_outbox.payload_json,
              'committed_at_epoch_ms',locked_artifact_family_outbox.committed_at_epoch_ms
            )
          );
        EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN NULL;
        END
        $function$
        ",
    )
    .execute(&mut *publication)
    .await
    .map_err(storage)?;
    sqlx::query(
        "
        CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(
          requested_request_identity text,
          requested_request_digest text,
          requested_receipt_identity text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
        SET search_path = pg_catalog
        AS $function$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM public.rd_sealed_exploratory_replay_requests_v1
             WHERE request_identity=requested_request_identity
               AND request_schema_version=1
               AND coalesce(frozen_json->>'request_schema_version','1')='1'
          ) THEN RETURN NULL; END IF;
          RETURN rd_owner_api.verify_exploratory_replay_request_internal_v1(
            requested_request_identity,
            requested_request_digest,
            requested_receipt_identity
          );
        END
        $function$
        ",
    )
    .execute(&mut *publication)
    .await
    .map_err(storage)?;
    sqlx::query(
        "
        CREATE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(
          requested_request_identity text,
          requested_meaning_digest text,
          requested_receipt_identity text,
          requested_seal_digest text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER
        SET search_path = pg_catalog
        AS $function$
        DECLARE base jsonb;
        DECLARE sealed record;
        DECLARE locked_v2_outbox record;
        BEGIN
          SELECT * INTO STRICT sealed
            FROM public.rd_sealed_exploratory_replay_requests_v1
           WHERE request_identity=requested_request_identity
             AND request_schema_version=2
             AND frozen_json->>'request_schema_version'='2'
             AND v2_meaning_digest=requested_meaning_digest
             AND v2_seal_digest=requested_seal_digest
             AND v2_receipt_json->>'receipt_identity'=requested_receipt_identity
           FOR SHARE;

          IF sealed.v2_canonical_request_bytes IS NULL
             OR sealed.v2_meaning_digest IS NULL
             OR sealed.v2_seal_digest IS NULL
             OR sealed.v2_receipt_json IS NULL
             OR sealed.v2_receipt_json->>'schema_version' <> '2'
             OR sealed.v2_receipt_json->>'request_identity' <> sealed.request_identity
             OR sealed.v2_receipt_json->>'meaning_digest' <> sealed.v2_meaning_digest
             OR sealed.v2_receipt_json->>'seal_digest' <> sealed.v2_seal_digest
             OR sealed.v2_receipt_json->>'committed_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
          THEN RETURN NULL; END IF;

          base := rd_owner_api.verify_exploratory_replay_request_internal_v1(
            requested_request_identity,
            '',
            ''
          );
          IF base IS NULL
             OR base->>'availability' NOT IN ('AVAILABLE','STALE')
          THEN RETURN NULL; END IF;

          SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,
                 committed_at_epoch_ms
            INTO STRICT locked_v2_outbox
            FROM public.rd_owner_outbox_v1
           WHERE aggregate_identity=sealed.request_identity
             AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V2'
           FOR SHARE;

          IF locked_v2_outbox.payload_json <> pg_catalog.jsonb_build_object(
               'schema_version',2,
               'request_identity',sealed.request_identity,
               'meaning_digest',sealed.v2_meaning_digest,
               'seal_digest',sealed.v2_seal_digest,
               'receipt_identity',sealed.v2_receipt_json->>'receipt_identity',
               'lineage_request_digest',sealed.request_digest,
               'committed_at_epoch_ms',sealed.committed_at_epoch_ms
             )
             OR locked_v2_outbox.committed_at_epoch_ms <> sealed.committed_at_epoch_ms
          THEN RETURN NULL; END IF;

          RETURN base || pg_catalog.jsonb_build_object(
            'schema_version',2,
            'v2_canonical_request_base64',pg_catalog.replace(
              pg_catalog.encode(sealed.v2_canonical_request_bytes,'base64'),
              pg_catalog.chr(10),
              ''
            ),
            'v2_meaning_digest',sealed.v2_meaning_digest,
            'v2_seal_digest',sealed.v2_seal_digest,
            'v2_receipt',sealed.v2_receipt_json,
            'v2_outbox',pg_catalog.jsonb_build_object(
              'event_identity',locked_v2_outbox.event_identity,
              'aggregate_identity',locked_v2_outbox.aggregate_identity,
              'event_kind',locked_v2_outbox.event_kind,
              'payload_digest',locked_v2_outbox.payload_digest,
              'payload_json',locked_v2_outbox.payload_json,
              'committed_at_epoch_ms',locked_v2_outbox.committed_at_epoch_ms
            )
          );
        EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN NULL;
        END
        $function$
        ",
    )
    .execute(&mut *publication)
    .await
    .map_err(storage)?;
    sqlx::query(
        "
        CREATE FUNCTION rd_owner_api.resolve_exploratory_replay_request_v2(
          requested_request_identity text,
          requested_meaning_digest text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER
        SET search_path = pg_catalog
        AS $function$
        DECLARE stored_receipt_identity text;
        DECLARE stored_seal_digest text;
        BEGIN
          SELECT v2_receipt_json->>'receipt_identity',v2_seal_digest
            INTO STRICT stored_receipt_identity,stored_seal_digest
            FROM public.rd_sealed_exploratory_replay_requests_v1
           WHERE request_identity=requested_request_identity
             AND request_schema_version=2
             AND frozen_json->>'request_schema_version'='2'
             AND v2_meaning_digest=requested_meaning_digest
           FOR SHARE;
          IF stored_receipt_identity IS NULL OR stored_seal_digest IS NULL THEN RETURN NULL; END IF;
          RETURN rd_owner_api.verify_exploratory_replay_request_internal_v2(
            requested_request_identity,
            requested_meaning_digest,
            stored_receipt_identity,
            stored_seal_digest
          );
        EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN NULL;
        END
        $function$
        ",
    )
    .execute(&mut *publication)
    .await
    .map_err(storage)?;
    sqlx::query(
        "
        CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(
          requested_request_identity text,
          requested_meaning_digest text,
          requested_receipt_identity text,
          requested_seal_digest text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
        SET search_path = pg_catalog
        AS $function$
        BEGIN
          RETURN rd_owner_api.verify_exploratory_replay_request_internal_v2(
            requested_request_identity,
            requested_meaning_digest,
            requested_receipt_identity,
            requested_seal_digest
          );
        END
        $function$
        ",
    )
    .execute(&mut *publication)
    .await
    .map_err(storage)?;

    for statement in [
        "ALTER FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text) OWNER TO rd_owner",
        "ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text) TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, rd_owner",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) TO backtest_owner",
        "ALTER FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text) TO rd_owner",
        "ALTER FUNCTION rd_owner_api.resolve_exploratory_replay_request_v2(text,text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.resolve_exploratory_replay_request_v2(text,text) FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.resolve_exploratory_replay_request_v2(text,text) TO rd_owner",
        "ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, rd_owner",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) TO backtest_owner",
    ] {
        sqlx::query(statement)
            .execute(&mut *publication)
            .await
            .map_err(storage)?;
    }
    publication.commit().await.map_err(storage)?;
    Ok(())
}

pub(crate) async fn commit(
    pool: &PgPool,
    proposal: ExploratoryReplayRequestProposalV1,
) -> Result<ExploratoryReplayCommitResultV1, ExploratoryReplayOwnerError> {
    let committed = Box::pin(commit_inner(pool, proposal, None)).await?;
    Ok(assemble(committed.frozen, committed.receipt))
}

pub(crate) async fn commit_v2(
    pool: &PgPool,
    proposal: ExploratoryReplayRequestProposalV2,
) -> Result<ExploratoryReplayCommitResultV2, ExploratoryReplayOwnerError> {
    let request = validate_proposal_v2(&proposal)?;
    let canonical_request_bytes = request.to_canonical_bytes().map_err(unavailable)?;
    let meaning_digest = request
        .meaning_digest()
        .map_err(unavailable)?
        .as_str()
        .to_string();
    let lineage = legacy_lineage_projection(&proposal)?;
    let committed = Box::pin(commit_inner(
        pool,
        lineage,
        Some(PreparedSealV2 {
            proposal,
            canonical_request_bytes,
            meaning_digest,
        }),
    ))
    .await?;
    let (prepared, receipt) = committed.v2.ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("Replay V2 seal missing after commit".into())
    })?;
    Ok(assemble_v2(prepared, receipt))
}

async fn commit_inner(
    pool: &PgPool,
    proposal: ExploratoryReplayRequestProposalV1,
    prepared_v2: Option<PreparedSealV2>,
) -> Result<CommittedReplay, ExploratoryReplayOwnerError> {
    validate_proposal(&proposal)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(&proposal.request_identity)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

    if let Some(existing) =
        resolve_existing(&mut transaction, &proposal, prepared_v2.as_ref()).await?
    {
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    let now: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)?;
    let now = u64::try_from(now).map_err(unavailable)?;
    let (custody, replay_admission) = Box::pin(
        VerifiedAttemptCustodyV1::admit_for_exploratory_replay_in_transaction(
            &mut transaction,
            &proposal.build_request_identity,
            &proposal.admission,
            now,
        ),
    )
    .await
    .map_err(|e| ExploratoryReplayOwnerError::Unavailable(e.to_string()))?
    .ok_or_else(|| ExploratoryReplayOwnerError::Unavailable("artifact custody missing".into()))?;
    verify_replay_admission_for_commit(&replay_admission, &proposal, prepared_v2.as_ref())?;

    if !custody.research.authority_available_at(now)
        || !custody
            .product_edge_admission
            .authorizes_first_mutation_at(now)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "current R&D lineage authority unavailable".into(),
        ));
    }
    let intent = custody.research.intent().ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("research intent missing".into())
    })?;
    let receipt = custody.attempt.receipt.as_ref().ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("artifact receipt missing".into())
    })?;
    let family = custody.artifact_family.as_ref().ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("artifact family binding missing".into())
    })?;
    let review = custody.artifact_review.as_ref().ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("artifact review missing".into())
    })?;
    let research_receipt = custody.research.receipt();
    let root = family.trial_family().root();
    let frontier = family.trial_family().census_frontier();
    let binding = family.binding();
    let binding_receipt = family.binding_receipt();

    if custody.attempt.state != AttemptState::Terminal
        || receipt.disposition != ArtifactBuildDisposition::Success
        || research_receipt.disposition != ResearchRequestDisposition::Accepted
        || !matches!(intent, FrozenResearchGoalIntent::V2(_))
        || proposal.attempt_identity != custody.attempt.request.attempt_identity
        || proposal.intent_identity != intent.intent_identity()
        || proposal.trial_family_identity != root.trial_family_identity()
        || receipt.artifact_identity.as_deref() != Some(proposal.artifact_identity.as_str())
        || receipt.build_receipt_identity.as_deref()
            != Some(proposal.build_receipt_identity.as_str())
        || proposal.artifact_family_binding_identity != binding.binding_identity()
        || proposal.census_frontier_identity != frontier.frontier_identity()
        || proposal.exact_code_bytes_digest != review.build_receipt.wasm_digest
        || proposal.cost_model_identity != root.policy().cost_model_identity
        || proposal.slippage_model_identity != root.policy().slippage_model_identity
        || proposal.capacity_model_identity != root.policy().capacity_model_identity
        || prepared_v2.as_ref().is_some_and(|prepared| {
            let request = &prepared.proposal.request;
            request.frozen_research_intent.digest.as_str() != intent.semantic_digest()
                || request.trial_family.digest.as_str() != root.root_digest()
                || request.trial_family_census_frontier.digest.as_str()
                    != frontier.frontier_digest()
                || request.artifact.digest.as_str() != review.build_receipt.wasm_digest
        })
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "proposal does not equal locked R&D lineage".into(),
        ));
    }

    let trial_family_outbox = sqlx::query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1' FOR SHARE",
    )
    .bind(&proposal.trial_family_identity)
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)
    .and_then(|row| locked_outbox_from_row(&row))?;
    verify_family_dependency_outbox(
        &trial_family_outbox,
        &FamilyFrozenOutboxV1 {
            schema_version: 1,
            research_receipt_identity: research_receipt.receipt_identity.clone(),
            intent_identity: proposal.intent_identity.clone(),
            trial_family_identity: proposal.trial_family_identity.clone(),
            root_receipt_identity: family
                .trial_family()
                .root_receipt()
                .receipt_identity()
                .to_string(),
            membership_receipt_identity: family
                .trial_family()
                .membership_receipt()
                .receipt_identity()
                .to_string(),
            census_frontier_identity: proposal.census_frontier_identity.clone(),
            census_frontier_digest: frontier.frontier_digest().to_string(),
            replay_execution_policy_v2: family
                .trial_family()
                .root()
                .policy()
                .replay_execution_policy_v2()
                .cloned(),
        },
        research_receipt.committed_at_epoch_ms,
    )?;
    let artifact_family_outbox = sqlx::query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' FOR SHARE",
    )
    .bind(&proposal.artifact_identity)
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)
    .and_then(|row| locked_outbox_from_row(&row))?;
    verify_artifact_dependency_outbox(
        &artifact_family_outbox,
        &ArtifactBoundOutboxV1 {
            schema_version: 1,
            artifact_identity: proposal.artifact_identity.clone(),
            build_receipt_identity: proposal.build_receipt_identity.clone(),
            trial_family_identity: proposal.trial_family_identity.clone(),
            binding_identity: proposal.artifact_family_binding_identity.clone(),
            binding_receipt_identity: binding_receipt.receipt_identity().to_string(),
        },
        &format!(
            "rd-owner-outbox-v1-{}",
            binding.binding_digest().trim_start_matches("sha256:")
        ),
        binding_receipt.committed_at_epoch_ms(),
    )?;
    let exact_code_bytes_sha256_digest: String = sqlx::query_scalar(
        "SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(wasm_bytes),'hex') FROM public.rd_strategy_artifacts_v1 WHERE artifact_digest=$1 AND intent_identity=$2 AND attempt_identity=$3 AND build_receipt_json->>'build_receipt_identity'=$4 FOR SHARE",
    )
    .bind(&proposal.artifact_identity)
    .bind(&proposal.intent_identity)
    .bind(&proposal.attempt_identity)
    .bind(&proposal.build_receipt_identity)
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)?;

    let final_cut: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)?;
    let final_cut = u64::try_from(final_cut).map_err(unavailable)?;
    // Replay and Artifact admission rows were locked before any R&D custody row.
    // With every dependency lock/read now complete, revalidate those exact
    // readbacks at one final cut without issuing another admission query.
    verify_replay_admission_for_commit(&replay_admission, &proposal, prepared_v2.as_ref())?;
    verify_artifact_build_admission(&custody.product_edge_admission, &custody.attempt.request)
        .map_err(|e| ExploratoryReplayOwnerError::Unavailable(e.to_string()))?;
    let research_admission = custody.research.product_edge_admission().ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("research Product Edge admission missing".into())
    })?;

    if !custody.research.authority_available_at(final_cut)
        || !replay_admission.authorizes_first_mutation_at(final_cut)
        || !custody
            .product_edge_admission
            .authorizes_first_mutation_at(final_cut)
        || !same_product_edge_authority(&replay_admission, &custody.product_edge_admission)
        || !same_product_edge_authority(&replay_admission, research_admission)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "Product Edge authority changed before final Replay custody".into(),
        ));
    }
    let product_edge_request_semantic_digest = replay_admission
        .request()
        .semantic_digest()
        .map_err(unavailable)?;

    let expected = StoredFrozenV1 {
        schema_version: 1,
        request_schema_version: prepared_v2.as_ref().map(|_| 2),
        proposal: proposal.clone(),
        product_edge_request_semantic_digest,
        research_receipt_identity: research_receipt.receipt_identity.clone(),
        intent_semantic_digest: intent.semantic_digest().to_string(),
        trial_family_root_digest: root.root_digest().to_string(),
        census_frontier_digest: frontier.frontier_digest().to_string(),
        artifact_family_binding_digest: binding.binding_digest().to_string(),
        artifact_family_binding_receipt_identity: binding_receipt.receipt_identity().to_string(),
        artifact_review_identity: review.review_identity.clone(),
        exact_code_bytes_sha256_digest,
        source_capsule_digest: review.build_receipt.source_capsule_digest.clone(),
        build_recipe_digest: review.build_receipt.build_recipe_digest.clone(),
        dependency_identity: review.build_receipt.dependency_identity.clone(),
        trial_family_outbox_event_identity: trial_family_outbox.event_identity.clone(),
        trial_family_outbox_digest: trial_family_outbox.payload_digest.clone(),
        trial_family_outbox_committed_at_epoch_ms: trial_family_outbox.committed_at_epoch_ms,
        artifact_family_outbox_event_identity: artifact_family_outbox.event_identity.clone(),
        artifact_family_outbox_digest: artifact_family_outbox.payload_digest.clone(),
        artifact_family_outbox_committed_at_epoch_ms: artifact_family_outbox.committed_at_epoch_ms,
        committed_at_epoch_ms: final_cut,
        request_digest: String::new(),
    };

    let mut frozen = expected;
    frozen.request_digest = frozen_digest(&frozen)?;
    let receipt_digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v1",
        &(
            1_u32,
            &frozen.proposal.request_identity,
            &frozen.request_digest,
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let stored_receipt = StoredReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("rd-exploratory-replay-receipt-v1", &receipt_digest),
        request_identity: frozen.proposal.request_identity.clone(),
        request_digest: frozen.request_digest.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let payload = StoredOutboxV1 {
        schema_version: 1,
        request_identity: frozen.proposal.request_identity.clone(),
        request_digest: frozen.request_digest.clone(),
        receipt_identity: stored_receipt.receipt_identity.clone(),
        intent_identity: frozen.proposal.intent_identity.clone(),
        trial_family_identity: frozen.proposal.trial_family_identity.clone(),
        artifact_identity: frozen.proposal.artifact_identity.clone(),
        census_frontier_identity: frozen.proposal.census_frontier_identity.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let stored_v2 = prepared_v2
        .map(|prepared| seal_v2(prepared, &frozen))
        .transpose()?;
    sqlx::query("INSERT INTO public.rd_sealed_exploratory_replay_requests_v1 (request_identity,request_digest,build_request_identity,attempt_identity,intent_identity,trial_family_identity,artifact_identity,build_receipt_identity,artifact_family_binding_identity,census_frontier_identity,frozen_json,receipt_json,lifecycle_state,committed_at_epoch_ms,v2_canonical_request_bytes,v2_meaning_digest,v2_seal_digest,v2_receipt_json,request_schema_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'FROZEN',$13,$14,$15,$16,$17,$18)")
        .bind(&frozen.proposal.request_identity)
        .bind(&frozen.request_digest)
        .bind(&frozen.proposal.build_request_identity)
        .bind(&frozen.proposal.attempt_identity)
        .bind(&frozen.proposal.intent_identity)
        .bind(&frozen.proposal.trial_family_identity)
        .bind(&frozen.proposal.artifact_identity)
        .bind(&frozen.proposal.build_receipt_identity)
        .bind(&frozen.proposal.artifact_family_binding_identity)
        .bind(&frozen.proposal.census_frontier_identity)
        .bind(serde_json::to_value(&frozen).map_err(unavailable)?)
        .bind(serde_json::to_value(&stored_receipt).map_err(unavailable)?)
        .bind(i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?)
        .bind(stored_v2.as_ref().map(|(prepared, _)| prepared.canonical_request_bytes.as_slice()))
        .bind(stored_v2.as_ref().map(|(prepared, _)| prepared.meaning_digest.as_str()))
        .bind(stored_v2.as_ref().map(|(_, receipt)| receipt.seal_digest.as_str()))
        .bind(stored_v2.as_ref().map(|(_, receipt)| serde_json::to_value(receipt)).transpose().map_err(unavailable)?)
        .bind(if stored_v2.is_some() { 2_i16 } else { 1_i16 })
        .execute(&mut *transaction).await.map_err(storage)?;
    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(&frozen.proposal.request_identity)
        .bind(EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::to_value(payload).map_err(unavailable)?)
        .bind(i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut *transaction).await.map_err(storage)?;

    if let Some((_, receipt_v2)) = &stored_v2 {
        let payload_v2 = StoredOutboxV2 {
            schema_version: 2,
            request_identity: frozen.proposal.request_identity.clone(),
            meaning_digest: receipt_v2.meaning_digest.clone(),
            seal_digest: receipt_v2.seal_digest.clone(),
            receipt_identity: receipt_v2.receipt_identity.clone(),
            lineage_request_digest: frozen.request_digest.clone(),
            committed_at_epoch_ms: frozen.committed_at_epoch_ms,
        };
        let payload_digest_v2 = canonical_digest("rd.owner-outbox.payload.v1", &payload_v2)?;
        sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(identity("rd-owner-event-v1", &payload_digest_v2))
            .bind(&frozen.proposal.request_identity)
            .bind(EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2)
            .bind(payload_digest_v2)
            .bind(serde_json::to_value(payload_v2).map_err(unavailable)?)
            .bind(i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?)
            .execute(&mut *transaction).await.map_err(storage)?;
    }
    verify_frozen(&frozen)?;
    verify_receipt(&stored_receipt, &frozen)?;
    transaction.commit().await.map_err(storage)?;
    Ok(CommittedReplay {
        frozen,
        receipt: stored_receipt,
        v2: stored_v2,
    })
}

async fn resolve_existing(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &ExploratoryReplayRequestProposalV1,
    prepared_v2: Option<&PreparedSealV2>,
) -> Result<Option<CommittedReplay>, ExploratoryReplayOwnerError> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT rd_owner_api.verify_exploratory_replay_request_internal_v1($1,'','')",
    )
    .bind(&proposal.request_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;

    let Some(value) = value else {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1)",
        )
        .bind(&proposal.request_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;

        if exists {
            return Err(ExploratoryReplayOwnerError::Unavailable(
                "existing exploratory request failed sealed verification".into(),
            ));
        }
        return Ok(None);
    };

    let envelope: LockedEnvelopeV1 = decode_exact(&value)?;

    if envelope.availability != ExploratoryReplayAvailabilityV1::Available {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "existing exploratory request is not available".into(),
        ));
    }
    let validated = validate_available_envelope(envelope, None)?;
    let expected_request_schema_version = prepared_v2.as_ref().map(|_| 2);

    if validated.frozen.request_schema_version != expected_request_schema_version {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "stored Replay request version mismatch".into(),
        ));
    }

    if validated.frozen.proposal != *proposal {
        return Err(ExploratoryReplayOwnerError::ConflictingReplay);
    }
    let stored_v2 = if let Some(expected) = prepared_v2 {
        let row = sqlx::query("SELECT v2_canonical_request_bytes,v2_meaning_digest,v2_seal_digest,v2_receipt_json FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 FOR SHARE")
            .bind(&proposal.request_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
        let canonical_request_bytes: Option<Vec<u8>> =
            row.try_get("v2_canonical_request_bytes").map_err(storage)?;
        let meaning_digest: Option<String> = row.try_get("v2_meaning_digest").map_err(storage)?;
        let seal_digest: Option<String> = row.try_get("v2_seal_digest").map_err(storage)?;
        let receipt_json: Option<serde_json::Value> =
            row.try_get("v2_receipt_json").map_err(storage)?;
        let (
            Some(canonical_request_bytes),
            Some(meaning_digest),
            Some(seal_digest),
            Some(receipt_json),
        ) = (
            canonical_request_bytes,
            meaning_digest,
            seal_digest,
            receipt_json,
        )
        else {
            return Err(ExploratoryReplayOwnerError::ConflictingReplay);
        };

        if canonical_request_bytes != expected.canonical_request_bytes
            || meaning_digest != expected.meaning_digest
        {
            return Err(ExploratoryReplayOwnerError::ConflictingReplay);
        }
        let receipt: StoredReceiptV2 = decode_exact(&receipt_json)?;
        let prepared = PreparedSealV2 {
            proposal: expected.proposal.clone(),
            canonical_request_bytes,
            meaning_digest,
        };
        verify_v2_seal(&prepared, &receipt, &validated.frozen)?;
        if receipt.seal_digest != seal_digest {
            return Err(ExploratoryReplayOwnerError::Unavailable(
                "stored Replay V2 seal digest mismatch".into(),
            ));
        }
        Some((prepared, receipt))
    } else if sqlx::query_scalar(
        "SELECT v2_canonical_request_bytes IS NOT NULL OR v2_meaning_digest IS NOT NULL OR v2_seal_digest IS NOT NULL OR v2_receipt_json IS NOT NULL FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 FOR SHARE",
    )
    .bind(&proposal.request_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "Replay V2 custody is unavailable through the V1 API".into(),
        ));
    } else {
        None
    };
    Ok(Some(CommittedReplay {
        frozen: validated.frozen,
        receipt: validated.receipt,
        v2: stored_v2,
    }))
}

pub(crate) async fn bind_backtest_read(
    rd_pool: &PgPool,
    database_url: &str,
) -> Result<BoundBacktestReadV1, ExploratoryReplayOwnerError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(database_url)
        .await
        .map_err(storage)?;
    validate_backtest_binding(rd_pool, &pool).await?;
    Ok(BoundBacktestReadV1 { pool })
}

pub(crate) async fn lock_for_backtest(
    rd_pool: &PgPool,
    backtest: &BoundBacktestReadV1,
    locator: &ExploratoryReplayRequestLocatorV1,
) -> Result<ExploratoryReplayReadResultV1, ExploratoryReplayOwnerError> {
    validate_backtest_binding(rd_pool, &backtest.pool).await?;
    let pool = &backtest.pool;
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .fetch_one(pool)
            .await
            .map_err(storage)?;
    let Some(value) = value else {
        return Ok(unavailable_result(&locator.request_identity));
    };
    let envelope: LockedEnvelopeV1 = decode_exact(&value)?;
    match envelope.availability {
        ExploratoryReplayAvailabilityV1::Unavailable => {
            Ok(unavailable_result(&locator.request_identity))
        }
        ExploratoryReplayAvailabilityV1::Stale => Ok(ExploratoryReplayReadResultV1 {
            projection: projection(
                &locator.request_identity,
                ExploratoryReplayAvailabilityV1::Stale,
            ),
            readback: None,
        }),
        ExploratoryReplayAvailabilityV1::Available => {
            let Ok(validated) = validate_available_envelope(envelope, Some(locator)) else {
                return Ok(unavailable_result(&locator.request_identity));
            };
            let request_identity = validated.frozen.proposal.request_identity.clone();
            let readback = SealedExploratoryReplayReadbackV1 {
                frozen: into_frozen(validated.frozen),
                receipt: into_receipt(validated.receipt),
                owner_cut_epoch_ms: validated.owner_cut_epoch_ms,
            };
            Ok(ExploratoryReplayReadResultV1 {
                projection: projection(
                    &request_identity,
                    ExploratoryReplayAvailabilityV1::Available,
                ),
                readback: Some(readback),
            })
        }
    }
}

pub(crate) async fn lock_for_backtest_v2(
    rd_pool: &PgPool,
    backtest: &BoundBacktestReadV1,
    locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
    validate_backtest_binding(rd_pool, &backtest.pool).await?;
    validate_backtest_binding_v2(&backtest.pool).await?;
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v2($1,$2,$3,$4)")
            .bind(&locator.request_identity)
            .bind(&locator.meaning_digest)
            .bind(&locator.receipt_identity)
            .bind(&locator.seal_digest)
            .fetch_one(&backtest.pool)
            .await
            .map_err(storage)?;
    decode_v2_read_result(
        &locator.request_identity,
        &locator.meaning_digest,
        Some(locator),
        value,
    )
}

pub(crate) async fn resolve_for_rd_v2(
    rd_pool: &PgPool,
    selector: &ExploratoryReplayRecoverySelectorV2,
) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
    use vibe_rd_exploratory_replay_custody::{
        ExploratoryReplayAvailabilityV2 as CustodyAvailability,
        ExploratoryReplayRecoverySelectorV2 as CustodySelector,
        resolve_sealed_exploratory_replay_request_v2,
    };

    let custody = resolve_sealed_exploratory_replay_request_v2(
        rd_pool,
        &CustodySelector {
            request_identity: selector.request_identity.clone(),
            meaning_digest: selector.meaning_digest.clone(),
        },
    )
    .await
    .map_err(unavailable)?;
    let availability = match custody.availability() {
        CustodyAvailability::Available => ExploratoryReplayAvailabilityV1::Available,
        CustodyAvailability::Stale => ExploratoryReplayAvailabilityV1::Stale,
        CustodyAvailability::Unavailable => ExploratoryReplayAvailabilityV1::Unavailable,
    };
    let projection = projection_v2(custody.request_identity(), availability);
    let Some(readback) = custody.into_readback() else {
        return Ok(ExploratoryReplayReadResultV2 {
            projection,
            readback: None,
        });
    };
    Ok(ExploratoryReplayReadResultV2 {
        projection,
        readback: Some(SealedExploratoryReplayReadbackV2 {
            request: readback.request().clone(),
            canonical_request_bytes: readback.canonical_request_bytes().to_vec(),
            meaning_digest: readback.meaning_digest().to_string(),
            receipt: ExploratoryReplayCommitReceiptV2 {
                schema_version: 2,
                receipt_identity: readback.receipt_identity().to_string(),
                request_identity: selector.request_identity.clone(),
                meaning_digest: readback.meaning_digest().to_string(),
                seal_digest: readback.seal_digest().to_string(),
                committed_at_epoch_ms: readback.committed_at_epoch_ms(),
            },
            owner_cut_epoch_ms: readback.owner_cut_epoch_ms(),
        }),
    })
}

fn decode_v2_read_result(
    expected_request_identity: &str,
    expected_meaning_digest: &str,
    exact_locator: Option<&ExploratoryReplayRequestLocatorV2>,
    value: Option<serde_json::Value>,
) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
    let Some(value) = value else {
        return Ok(unavailable_result_v2(expected_request_identity));
    };
    let envelope: LockedEnvelopeV1 = decode_exact(&value)?;
    let availability = envelope.availability;
    if availability == ExploratoryReplayAvailabilityV1::Unavailable {
        return Ok(unavailable_result_v2(expected_request_identity));
    }
    let canonical_base64 = envelope.v2_canonical_request_base64.clone();
    let meaning_digest = envelope.v2_meaning_digest.clone();
    let seal_digest = envelope.v2_seal_digest.clone();
    let receipt_json = envelope.v2_receipt.clone();
    let outbox = envelope.v2_outbox.clone();
    let Ok(validated) = validate_available_envelope(envelope, None) else {
        return Ok(unavailable_result_v2(expected_request_identity));
    };
    let (
        Some(canonical_base64),
        Some(meaning_digest),
        Some(seal_digest),
        Some(receipt_json),
        Some(outbox),
    ) = (
        canonical_base64,
        meaning_digest,
        seal_digest,
        receipt_json,
        outbox,
    )
    else {
        return Ok(unavailable_result_v2(expected_request_identity));
    };
    let Ok(canonical_request_bytes) = BASE64.decode(canonical_base64) else {
        return Ok(unavailable_result_v2(expected_request_identity));
    };
    let Ok(receipt) = decode_exact::<StoredReceiptV2>(&receipt_json) else {
        return Ok(unavailable_result_v2(expected_request_identity));
    };
    let dto: ReplayRequestDtoV2 = match serde_json::from_slice(&canonical_request_bytes) {
        Ok(dto) => dto,
        Err(_) => return Ok(unavailable_result_v2(expected_request_identity)),
    };
    let request = match ReplayRequestV2::try_from(dto) {
        Ok(request) => request,
        Err(_) => return Ok(unavailable_result_v2(expected_request_identity)),
    };
    let prepared = PreparedSealV2 {
        proposal: match proposal_v2_from_stored(&validated.frozen, request.as_dto()) {
            Ok(proposal) => proposal,
            Err(_) => return Ok(unavailable_result_v2(expected_request_identity)),
        },
        canonical_request_bytes: canonical_request_bytes.clone(),
        meaning_digest: meaning_digest.clone(),
    };

    if expected_request_identity != receipt.request_identity
        || expected_meaning_digest != meaning_digest
        || exact_locator.is_some_and(|locator| {
            locator.request_identity != receipt.request_identity
                || locator.meaning_digest != meaning_digest
                || locator.receipt_identity != receipt.receipt_identity
                || locator.seal_digest != seal_digest
        })
        || verify_v2_seal(&prepared, &receipt, &validated.frozen).is_err()
        || verify_v2_outbox(&outbox, &receipt, &validated.frozen).is_err()
    {
        return Ok(unavailable_result_v2(expected_request_identity));
    }

    if availability == ExploratoryReplayAvailabilityV1::Stale {
        return Ok(ExploratoryReplayReadResultV2 {
            projection: projection_v2(&receipt.request_identity, availability),
            readback: None,
        });
    }
    Ok(ExploratoryReplayReadResultV2 {
        projection: projection_v2(
            &receipt.request_identity,
            ExploratoryReplayAvailabilityV1::Available,
        ),
        readback: Some(SealedExploratoryReplayReadbackV2 {
            request,
            canonical_request_bytes,
            meaning_digest,
            receipt: into_receipt_v2(receipt),
            owner_cut_epoch_ms: validated.owner_cut_epoch_ms,
        }),
    })
}

async fn validate_backtest_binding_v2(
    backtest_pool: &PgPool,
) -> Result<(), ExploratoryReplayOwnerError> {
    let function_ok: bool = sqlx::query_scalar(
        "SELECT procedure.prosecdef
             AND procedure.provolatile='v'
             AND procedure.proparallel='u'
             AND procedure.proisstrict
             AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND procedure.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
             AND procedure.proargtypes='25 25 25 25'::pg_catalog.oidvector
             AND owner.rolname='rd_owner'
             AND language.lanname='plpgsql'
             AND pg_catalog.strpos(procedure.prosrc,'verify_exploratory_replay_request_internal_v2') > 0
             AND pg_catalog.has_function_privilege('backtest_owner',procedure.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('rd_owner',procedure.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee NOT IN (owner.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='backtest_owner'))
             )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_roles owner ON owner.oid=procedure.proowner
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(LOCK_FUNCTION_V2)
    .fetch_optional(backtest_pool)
    .await
    .map_err(storage)?
    .unwrap_or(false);

    if !function_ok {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "sealed R&D Replay V2 lock API unavailable".into(),
        ));
    }
    Ok(())
}

async fn validate_backtest_binding(
    rd_pool: &PgPool,
    backtest_pool: &PgPool,
) -> Result<(), ExploratoryReplayOwnerError> {
    let rd_identity: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(rd_pool)
        .await
        .map_err(storage)?;

    if rd_identity != "rd_owner" {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "canonical rd_owner session required".into(),
        ));
    }
    let identity: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(backtest_pool)
        .await
        .map_err(storage)?;

    if identity != "backtest_owner" {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "canonical backtest_owner session required".into(),
        ));
    }
    let mut rd_transaction = rd_pool.begin().await.map_err(storage)?;
    let challenge: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.hashtextextended(pg_catalog.clock_timestamp()::text || ':' || pg_catalog.random()::text || ':' || pg_catalog.pg_backend_pid()::text, 0)",
    )
    .fetch_one(&mut *rd_transaction)
    .await
    .map_err(storage)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock($1)")
        .bind(challenge)
        .execute(&mut *rd_transaction)
        .await
        .map_err(storage)?;
    let rd_database: (String, i64) = sqlx::query_as(
        "SELECT pg_catalog.current_database(), database.oid::bigint FROM pg_catalog.pg_database database WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(&mut *rd_transaction)
    .await
    .map_err(storage)?;

    let mut backtest_transaction = backtest_pool.begin().await.map_err(storage)?;
    let acquired_challenge: bool =
        sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_xact_lock($1)")
            .bind(challenge)
            .fetch_one(&mut *backtest_transaction)
            .await
            .map_err(storage)?;
    let backtest_database: (String, i64) = sqlx::query_as(
        "SELECT pg_catalog.current_database(), database.oid::bigint FROM pg_catalog.pg_database database WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(&mut *backtest_transaction)
    .await
    .map_err(storage)?;
    backtest_transaction.rollback().await.map_err(storage)?;
    rd_transaction.rollback().await.map_err(storage)?;

    if acquired_challenge || backtest_database != rd_database {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "backtest read capability is not bound to the R&D Owner database".into(),
        ));
    }

    let function_ok: bool = sqlx::query_scalar(
        "SELECT procedure.prosecdef
             AND procedure.provolatile='v'
             AND procedure.proparallel='u'
             AND procedure.proisstrict
             AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND procedure.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
             AND procedure.proargtypes='25 25 25'::pg_catalog.oidvector
             AND owner.rolname='rd_owner'
             AND language.lanname='plpgsql'
             AND pg_catalog.strpos(procedure.prosrc,'rd_owner_api.verify_exploratory_replay_request_internal_v1') > 0
             AND backtest.rolcanlogin
             AND NOT (backtest.rolsuper OR backtest.rolcreatedb OR backtest.rolcreaterole OR backtest.rolreplication OR backtest.rolbypassrls)
             AND EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) acl
                WHERE acl.grantee=backtest.oid
                  AND acl.grantor=owner.oid
                  AND acl.privilege_type='EXECUTE'
                  AND NOT acl.is_grantable
             )
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee NOT IN (owner.oid,backtest.oid)
             )
             AND NOT pg_catalog.has_function_privilege('rd_owner',procedure.oid,'EXECUTE')
             AND EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_proc helper
                 JOIN pg_catalog.pg_roles helper_owner ON helper_owner.oid=helper.proowner
                 JOIN pg_catalog.pg_language helper_language ON helper_language.oid=helper.prolang
                WHERE helper.oid=pg_catalog.to_regprocedure($2)
                  AND NOT helper.prosecdef
                  AND helper.provolatile='v'
                  AND helper.proparallel='u'
                  AND helper.proisstrict
                  AND helper.proconfig=ARRAY['search_path=pg_catalog']::text[]
                  AND helper.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
                  AND helper.proargtypes='25 25 25'::pg_catalog.oidvector
                  AND helper_owner.rolname='rd_owner'
                  AND helper_language.lanname='plpgsql'
                  AND pg_catalog.has_function_privilege('rd_owner',helper.oid,'EXECUTE')
                  AND NOT pg_catalog.has_function_privilege('backtest_owner',helper.oid,'EXECUTE')
                  AND NOT EXISTS (
                    SELECT 1 FROM pg_catalog.aclexplode(helper.proacl) helper_acl
                     WHERE helper_acl.privilege_type='EXECUTE'
                       AND helper_acl.grantee<>helper_owner.oid
                  )
             )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_roles owner ON owner.oid=procedure.proowner
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
           JOIN pg_catalog.pg_roles backtest ON backtest.rolname='backtest_owner'
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(LOCK_FUNCTION)
    .bind(INTERNAL_VERIFY_FUNCTION)
    .fetch_optional(backtest_pool)
    .await
    .map_err(storage)?
    .unwrap_or(false);

    if !function_ok {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "sealed R&D lock API unavailable".into(),
        ));
    }
    Ok(())
}

fn validate_available_envelope(
    envelope: LockedEnvelopeV1,
    locator: Option<&ExploratoryReplayRequestLocatorV1>,
) -> Result<ValidatedAvailableEnvelopeV1, ExploratoryReplayOwnerError> {
    let frozen_json = envelope.frozen.ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("sealed frozen request missing".into())
    })?;
    let receipt_json = envelope
        .receipt
        .ok_or_else(|| ExploratoryReplayOwnerError::Unavailable("sealed receipt missing".into()))?;
    let frozen = decode_frozen(&frozen_json)?;
    let receipt = decode_receipt(&receipt_json)?;
    let outbox = envelope
        .outbox
        .ok_or_else(|| ExploratoryReplayOwnerError::Unavailable("sealed outbox missing".into()))?;
    verify_frozen(&frozen)?;
    verify_receipt(&receipt, &frozen)?;
    verify_outbox(&outbox, &frozen, &receipt)?;
    let trial_family_outbox = envelope.trial_family_outbox.ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("trial family outbox missing".into())
    })?;
    let _: FamilyFrozenOutboxV1 = verify_dependency_outbox(
        &trial_family_outbox,
        &frozen.proposal.trial_family_identity,
        "TRIAL_FAMILY_FROZEN_V1",
        &frozen.trial_family_outbox_event_identity,
        &frozen.trial_family_outbox_digest,
        frozen.trial_family_outbox_committed_at_epoch_ms,
    )?;
    let artifact_family_outbox = envelope.artifact_family_outbox.ok_or_else(|| {
        ExploratoryReplayOwnerError::Unavailable("artifact family outbox missing".into())
    })?;
    let _: ArtifactBoundOutboxV1 = verify_dependency_outbox(
        &artifact_family_outbox,
        &frozen.proposal.artifact_identity,
        "ARTIFACT_TRIAL_FAMILY_BOUND_V1",
        &frozen.artifact_family_outbox_event_identity,
        &frozen.artifact_family_outbox_digest,
        frozen.artifact_family_outbox_committed_at_epoch_ms,
    )?;

    if let Some(locator) = locator
        && (locator.request_identity != frozen.proposal.request_identity
            || locator.request_digest != frozen.request_digest
            || locator.receipt_identity != receipt.receipt_identity)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "sealed locator mismatch".into(),
        ));
    }
    let owner_cut_epoch_ms = envelope
        .owner_cut_epoch_ms
        .ok_or_else(|| ExploratoryReplayOwnerError::Unavailable("Owner cut missing".into()))?;
    Ok(ValidatedAvailableEnvelopeV1 {
        frozen,
        receipt,
        owner_cut_epoch_ms,
    })
}

fn validate_proposal_v2(
    proposal: &ExploratoryReplayRequestProposalV2,
) -> Result<ReplayRequestV2, ExploratoryReplayOwnerError> {
    let request = ReplayRequestV2::try_from(proposal.request.clone()).map_err(unavailable)?;
    if request.namespace() != ReplayNamespaceV2::Exploratory
        || proposal.admission.request_identity != request.request_identity().as_str()
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "Replay V2 identity or namespace mismatch".into(),
        ));
    }
    Ok(request)
}

fn legacy_lineage_projection(
    proposal: &ExploratoryReplayRequestProposalV2,
) -> Result<ExploratoryReplayRequestProposalV1, ExploratoryReplayOwnerError> {
    let request = validate_proposal_v2(proposal)?;
    let request = request.as_dto();
    Ok(ExploratoryReplayRequestProposalV1 {
        request_identity: request.request_identity.as_str().to_string(),
        admission: proposal.admission.clone(),
        build_request_identity: proposal.build_request_identity.clone(),
        attempt_identity: proposal.attempt_identity.clone(),
        intent_identity: request.frozen_research_intent.identity.as_str().to_string(),
        trial_family_identity: request.trial_family.identity.as_str().to_string(),
        artifact_identity: request.artifact.identity.as_str().to_string(),
        build_receipt_identity: proposal.build_receipt_identity.clone(),
        artifact_family_binding_identity: proposal.artifact_family_binding_identity.clone(),
        census_frontier_identity: request
            .trial_family_census_frontier
            .identity
            .as_str()
            .to_string(),
        requested_pit_scope: IdentityDigestV1 {
            identity: request.pit_scope.identity.as_str().to_string(),
            digest: request.pit_scope.digest.as_str().to_string(),
        },
        dataset: IdentityDigestV1 {
            identity: request.pit_snapshot.identity.as_str().to_string(),
            digest: request.pit_snapshot.digest.as_str().to_string(),
        },
        feature_set: IdentityDigestV1 {
            identity: request.resolved_owner_inputs.identity.as_str().to_string(),
            digest: request.resolved_owner_inputs.digest.as_str().to_string(),
        },
        strategy_spec: IdentityDigestV1 {
            identity: request.strategy_design.identity.as_str().to_string(),
            digest: request.strategy_design.digest.as_str().to_string(),
        },
        exact_code_bytes_digest: request.artifact.digest.as_str().to_string(),
        replay_config: IdentityDigestV1 {
            identity: request.replay_configuration.identity.as_str().to_string(),
            digest: request.replay_configuration.digest.as_str().to_string(),
        },
        runtime_kernel: VersionedIdentityV1 {
            identity: request.models.runtime_kernel.identity.as_str().to_string(),
            version: request.models.runtime_kernel.version.as_str().to_string(),
        },
        simulator: VersionedIdentityV1 {
            identity: request.models.simulator.identity.as_str().to_string(),
            version: request.models.simulator.version.as_str().to_string(),
        },
        backtest_engine: VersionedIdentityV1 {
            identity: request
                .runner_operational_profile
                .identity
                .as_str()
                .to_string(),
            version: request
                .runner_operational_profile
                .version
                .as_str()
                .to_string(),
        },
        cost_model_identity: request.models.cost.identity.as_str().to_string(),
        slippage_model_identity: request.models.slippage.identity.as_str().to_string(),
        capacity_model_identity: request.models.capacity.identity.as_str().to_string(),
        deterministic_seed: request.deterministic_seed,
        range_start_epoch_ms: request.window.start_event_ns,
        range_end_epoch_ms: request.window.end_event_ns_exclusive,
        calendar_identity: request.calendar.identity.as_str().to_string(),
        time_zone_identity: request.time_zone.identity.as_str().to_string(),
    })
}

fn proposal_v2_from_stored(
    frozen: &StoredFrozenV1,
    request: &ReplayRequestDtoV2,
) -> Result<ExploratoryReplayRequestProposalV2, ExploratoryReplayOwnerError> {
    let proposal = ExploratoryReplayRequestProposalV2 {
        admission: frozen.proposal.admission.clone(),
        build_request_identity: frozen.proposal.build_request_identity.clone(),
        attempt_identity: frozen.proposal.attempt_identity.clone(),
        build_receipt_identity: frozen.proposal.build_receipt_identity.clone(),
        artifact_family_binding_identity: frozen.proposal.artifact_family_binding_identity.clone(),
        request: request.clone(),
    };
    validate_proposal_v2(&proposal)?;
    Ok(proposal)
}

fn validate_proposal(
    proposal: &ExploratoryReplayRequestProposalV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let identities = [
        proposal.request_identity.as_str(),
        proposal.admission.request_identity.as_str(),
        proposal.admission.admission_identity.as_str(),
        proposal.build_request_identity.as_str(),
        proposal.attempt_identity.as_str(),
        proposal.intent_identity.as_str(),
        proposal.trial_family_identity.as_str(),
        proposal.artifact_identity.as_str(),
        proposal.build_receipt_identity.as_str(),
        proposal.artifact_family_binding_identity.as_str(),
        proposal.census_frontier_identity.as_str(),
        proposal.requested_pit_scope.identity.as_str(),
        proposal.dataset.identity.as_str(),
        proposal.feature_set.identity.as_str(),
        proposal.strategy_spec.identity.as_str(),
        proposal.replay_config.identity.as_str(),
        proposal.runtime_kernel.identity.as_str(),
        proposal.runtime_kernel.version.as_str(),
        proposal.simulator.identity.as_str(),
        proposal.simulator.version.as_str(),
        proposal.backtest_engine.identity.as_str(),
        proposal.backtest_engine.version.as_str(),
        proposal.cost_model_identity.as_str(),
        proposal.slippage_model_identity.as_str(),
        proposal.capacity_model_identity.as_str(),
        proposal.calendar_identity.as_str(),
        proposal.time_zone_identity.as_str(),
    ];

    if identities
        .iter()
        .any(|value| value.is_empty() || value.len() > 512 || value.trim() != *value)
    {
        return Err(ExploratoryReplayOwnerError::InvalidProposal("identity"));
    }

    for digest in [
        &proposal.requested_pit_scope.digest,
        &proposal.dataset.digest,
        &proposal.feature_set.digest,
        &proposal.strategy_spec.digest,
        &proposal.replay_config.digest,
        &proposal.admission.admission_digest,
    ] {
        if !valid_sha256(digest) {
            return Err(ExploratoryReplayOwnerError::InvalidProposal("digest"));
        }
    }

    if !valid_blake3(&proposal.exact_code_bytes_digest) {
        return Err(ExploratoryReplayOwnerError::InvalidProposal("digest"));
    }

    if proposal.range_start_epoch_ms >= proposal.range_end_epoch_ms {
        return Err(ExploratoryReplayOwnerError::InvalidProposal("time range"));
    }
    Ok(())
}

fn frozen_digest(frozen: &StoredFrozenV1) -> Result<String, ExploratoryReplayOwnerError> {
    canonical_digest(
        "rd.exploratory-replay-request.v1",
        &FrozenMeaningV1 {
            schema_version: frozen.schema_version,
            request_schema_version: frozen.request_schema_version,
            proposal: &frozen.proposal,
            product_edge_request_semantic_digest: &frozen.product_edge_request_semantic_digest,
            research_receipt_identity: &frozen.research_receipt_identity,
            intent_semantic_digest: &frozen.intent_semantic_digest,
            trial_family_root_digest: &frozen.trial_family_root_digest,
            census_frontier_digest: &frozen.census_frontier_digest,
            artifact_family_binding_digest: &frozen.artifact_family_binding_digest,
            artifact_family_binding_receipt_identity: &frozen
                .artifact_family_binding_receipt_identity,
            artifact_review_identity: &frozen.artifact_review_identity,
            exact_code_bytes_sha256_digest: &frozen.exact_code_bytes_sha256_digest,
            source_capsule_digest: &frozen.source_capsule_digest,
            build_recipe_digest: &frozen.build_recipe_digest,
            dependency_identity: &frozen.dependency_identity,
            trial_family_outbox_event_identity: &frozen.trial_family_outbox_event_identity,
            trial_family_outbox_digest: &frozen.trial_family_outbox_digest,
            trial_family_outbox_committed_at_epoch_ms: frozen
                .trial_family_outbox_committed_at_epoch_ms,
            artifact_family_outbox_event_identity: &frozen.artifact_family_outbox_event_identity,
            artifact_family_outbox_digest: &frozen.artifact_family_outbox_digest,
            artifact_family_outbox_committed_at_epoch_ms: frozen
                .artifact_family_outbox_committed_at_epoch_ms,
            committed_at_epoch_ms: frozen.committed_at_epoch_ms,
        },
    )
}

fn verify_replay_admission(
    admission: &ProductEdgeAdmissionReadbackV1,
    proposal: &ExploratoryReplayRequestProposalV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let admitted = admission.request();
    let expected_payload =
        exploratory_replay_admission_payload_v1(proposal).map_err(unavailable)?;
    if admission.locator() != &proposal.admission
        || proposal.admission.request_identity != proposal.request_identity
        || admitted.request_identity != proposal.request_identity
        || admitted.typed_payload != expected_payload
        || admitted.operation != EXPLORATORY_REPLAY_OPERATION_V1
        || admitted.operation_schema != EXPLORATORY_REPLAY_SCHEMA_V1
        || admitted.target_owner != RESEARCH_OWNER_V1
        || admitted.requested_effects.len() != 1
        || admitted.requested_effects[0] != EXPLORATORY_REPLAY_MUTATION_EFFECT_V1
        || !admission
            .authorized_scope()
            .iter()
            .any(|scope| scope == RESEARCH_SCOPE_V1)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "canonical Product Edge Replay admission mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_replay_admission_for_commit(
    admission: &ProductEdgeAdmissionReadbackV1,
    lineage: &ExploratoryReplayRequestProposalV1,
    prepared_v2: Option<&PreparedSealV2>,
) -> Result<(), ExploratoryReplayOwnerError> {
    let Some(prepared_v2) = prepared_v2 else {
        return verify_replay_admission(admission, lineage);
    };
    let proposal = &prepared_v2.proposal;
    let admitted = admission.request();
    let expected_payload =
        exploratory_replay_admission_payload_v2(proposal).map_err(unavailable)?;
    if admission.locator() != &proposal.admission
        || proposal.admission.request_identity != lineage.request_identity
        || admitted.request_identity != lineage.request_identity
        || admitted.typed_payload != expected_payload
        || admitted.operation != EXPLORATORY_REPLAY_OPERATION_V2
        || admitted.operation_schema != EXPLORATORY_REPLAY_SCHEMA_V2
        || admitted.target_owner != RESEARCH_OWNER_V1
        || admitted.requested_effects.len() != 1
        || admitted.requested_effects[0] != EXPLORATORY_REPLAY_MUTATION_EFFECT_V2
        || !admission
            .authorized_scope()
            .iter()
            .any(|scope| scope == RESEARCH_SCOPE_V1)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "canonical Product Edge Replay V2 admission mismatch".into(),
        ));
    }
    Ok(())
}

fn same_product_edge_authority(
    left: &ProductEdgeAdmissionReadbackV1,
    right: &ProductEdgeAdmissionReadbackV1,
) -> bool {
    left.deployment_identity() == right.deployment_identity()
        && left.binding_identity() == right.binding_identity()
        && left.binding_generation() == right.binding_generation()
        && left.effective_principal() == right.effective_principal()
        && left.scope_policy_version() == right.scope_policy_version()
        && left.capability_policy_version() == right.capability_policy_version()
        && left.audit_policy_version() == right.audit_policy_version()
        && left.authorization().locator() == right.authorization().locator()
}

fn verify_frozen(frozen: &StoredFrozenV1) -> Result<(), ExploratoryReplayOwnerError> {
    validate_proposal(&frozen.proposal)?;
    if frozen.schema_version != 1
        || !valid_sha256(&frozen.exact_code_bytes_sha256_digest)
        || !valid_sha256(&frozen.product_edge_request_semantic_digest)
        || frozen.request_digest != frozen_digest(frozen)?
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "frozen request digest mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_receipt(
    receipt: &StoredReceiptV1,
    frozen: &StoredFrozenV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v1",
        &(
            1_u32,
            &frozen.proposal.request_identity,
            &frozen.request_digest,
            frozen.committed_at_epoch_ms,
        ),
    )?;

    if receipt.schema_version != 1
        || receipt.receipt_identity != identity("rd-exploratory-replay-receipt-v1", &digest)
        || receipt.request_identity != frozen.proposal.request_identity
        || receipt.request_digest != frozen.request_digest
        || receipt.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "commit receipt mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_outbox(
    outbox: &LockedOutboxRowV1,
    frozen: &StoredFrozenV1,
    receipt: &StoredReceiptV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let payload: StoredOutboxV1 = decode_exact(&outbox.payload_json)?;
    let expected = StoredOutboxV1 {
        schema_version: 1,
        request_identity: frozen.proposal.request_identity.clone(),
        request_digest: frozen.request_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        intent_identity: frozen.proposal.intent_identity.clone(),
        trial_family_identity: frozen.proposal.trial_family_identity.clone(),
        artifact_identity: frozen.proposal.artifact_identity.clone(),
        census_frontier_identity: frozen.proposal.census_frontier_identity.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let digest = canonical_digest("rd.owner-outbox.payload.v1", &expected)?;
    if payload != expected
        || outbox.event_identity != identity("rd-owner-event-v1", &digest)
        || outbox.aggregate_identity != expected.request_identity
        || outbox.event_kind != EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V1
        || outbox.payload_digest != digest
        || outbox.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "exploratory request outbox mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_v2_outbox(
    outbox: &LockedOutboxRowV1,
    receipt: &StoredReceiptV2,
    frozen: &StoredFrozenV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let expected = StoredOutboxV2 {
        schema_version: 2,
        request_identity: frozen.proposal.request_identity.clone(),
        meaning_digest: receipt.meaning_digest.clone(),
        seal_digest: receipt.seal_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        lineage_request_digest: frozen.request_digest.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let payload: StoredOutboxV2 = decode_exact(&outbox.payload_json)?;
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &expected)?;
    if payload != expected
        || outbox.aggregate_identity != expected.request_identity
        || outbox.event_kind != EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2
        || outbox.payload_digest != payload_digest
        || outbox.event_identity != identity("rd-owner-event-v1", &payload_digest)
        || outbox.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "Replay V2 outbox mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_family_dependency_outbox(
    outbox: &LockedOutboxRowV1,
    expected: &FamilyFrozenOutboxV1,
    committed_at_epoch_ms: u64,
) -> Result<(), ExploratoryReplayOwnerError> {
    let payload: FamilyFrozenOutboxV1 = verify_dependency_outbox(
        outbox,
        &expected.trial_family_identity,
        "TRIAL_FAMILY_FROZEN_V1",
        &format!(
            "rd-owner-outbox-v1-{}",
            expected
                .census_frontier_digest
                .trim_start_matches("sha256:")
        ),
        &outbox.payload_digest,
        committed_at_epoch_ms,
    )?;

    if payload != *expected {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "trial family outbox payload mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_artifact_dependency_outbox(
    outbox: &LockedOutboxRowV1,
    expected: &ArtifactBoundOutboxV1,
    event_identity: &str,
    committed_at_epoch_ms: u64,
) -> Result<(), ExploratoryReplayOwnerError> {
    let payload: ArtifactBoundOutboxV1 = verify_dependency_outbox(
        outbox,
        &expected.artifact_identity,
        "ARTIFACT_TRIAL_FAMILY_BOUND_V1",
        event_identity,
        &outbox.payload_digest,
        committed_at_epoch_ms,
    )?;

    if payload != *expected {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "artifact family outbox payload mismatch".into(),
        ));
    }
    Ok(())
}

fn verify_dependency_outbox<T>(
    outbox: &LockedOutboxRowV1,
    aggregate_identity: &str,
    event_kind: &str,
    event_identity: &str,
    payload_digest: &str,
    committed_at_epoch_ms: u64,
) -> Result<T, ExploratoryReplayOwnerError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let payload: T = decode_exact(&outbox.payload_json)?;
    let recomputed_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    if outbox.aggregate_identity != aggregate_identity
        || outbox.event_kind != event_kind
        || outbox.event_identity != event_identity
        || outbox.payload_digest != payload_digest
        || outbox.payload_digest != recomputed_digest
        || outbox.committed_at_epoch_ms != committed_at_epoch_ms
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "dependency outbox seal mismatch".into(),
        ));
    }
    Ok(payload)
}

fn locked_outbox_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<LockedOutboxRowV1, ExploratoryReplayOwnerError> {
    Ok(LockedOutboxRowV1 {
        event_identity: row.try_get("event_identity").map_err(storage)?,
        aggregate_identity: row.try_get("aggregate_identity").map_err(storage)?,
        event_kind: row.try_get("event_kind").map_err(storage)?,
        payload_digest: row.try_get("payload_digest").map_err(storage)?,
        payload_json: row.try_get("payload_json").map_err(storage)?,
        committed_at_epoch_ms: u64::try_from(
            row.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(unavailable)?,
    })
}

fn seal_v2(
    prepared: PreparedSealV2,
    frozen: &StoredFrozenV1,
) -> Result<(PreparedSealV2, StoredReceiptV2), ExploratoryReplayOwnerError> {
    let seal_digest = canonical_digest(
        "rd.exploratory-replay-request-seal.v2",
        &(
            2_u16,
            frozen.proposal.request_identity.as_str(),
            prepared.meaning_digest.as_str(),
            BASE64.encode(&prepared.canonical_request_bytes),
            frozen.request_digest.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let receipt_digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v2",
        &(
            2_u16,
            frozen.proposal.request_identity.as_str(),
            prepared.meaning_digest.as_str(),
            seal_digest.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let receipt = StoredReceiptV2 {
        schema_version: 2,
        receipt_identity: identity("rd-exploratory-replay-receipt-v2", &receipt_digest),
        request_identity: frozen.proposal.request_identity.clone(),
        meaning_digest: prepared.meaning_digest.clone(),
        seal_digest,
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    verify_v2_seal(&prepared, &receipt, frozen)?;
    Ok((prepared, receipt))
}

fn verify_v2_seal(
    prepared: &PreparedSealV2,
    receipt: &StoredReceiptV2,
    frozen: &StoredFrozenV1,
) -> Result<(), ExploratoryReplayOwnerError> {
    let dto: ReplayRequestDtoV2 =
        serde_json::from_slice(&prepared.canonical_request_bytes).map_err(unavailable)?;
    let request = ReplayRequestV2::try_from(dto).map_err(unavailable)?;
    if request.namespace() != ReplayNamespaceV2::Exploratory
        || request.to_canonical_bytes().map_err(unavailable)? != prepared.canonical_request_bytes
        || request.meaning_digest().map_err(unavailable)?.as_str() != prepared.meaning_digest
        || legacy_lineage_projection(&prepared.proposal)? != frozen.proposal
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "sealed Replay V2 canonical meaning mismatch".into(),
        ));
    }
    let expected_seal = canonical_digest(
        "rd.exploratory-replay-request-seal.v2",
        &(
            2_u16,
            frozen.proposal.request_identity.as_str(),
            prepared.meaning_digest.as_str(),
            BASE64.encode(&prepared.canonical_request_bytes),
            frozen.request_digest.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let receipt_digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v2",
        &(
            2_u16,
            frozen.proposal.request_identity.as_str(),
            prepared.meaning_digest.as_str(),
            expected_seal.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;

    if receipt.schema_version != 2
        || receipt.request_identity != frozen.proposal.request_identity
        || receipt.meaning_digest != prepared.meaning_digest
        || receipt.seal_digest != expected_seal
        || receipt.committed_at_epoch_ms != frozen.committed_at_epoch_ms
        || receipt.receipt_identity != identity("rd-exploratory-replay-receipt-v2", &receipt_digest)
    {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "Replay V2 receipt mismatch".into(),
        ));
    }
    Ok(())
}

fn assemble(frozen: StoredFrozenV1, receipt: StoredReceiptV1) -> ExploratoryReplayCommitResultV1 {
    let locator = ExploratoryReplayRequestLocatorV1 {
        request_identity: frozen.proposal.request_identity.clone(),
        request_digest: frozen.request_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
    };
    ExploratoryReplayCommitResultV1 {
        projection: projection(
            &frozen.proposal.request_identity,
            ExploratoryReplayAvailabilityV1::Available,
        ),
        locator,
        frozen: into_frozen(frozen),
        receipt: into_receipt(receipt),
    }
}

fn assemble_v2(
    prepared: PreparedSealV2,
    receipt: StoredReceiptV2,
) -> ExploratoryReplayCommitResultV2 {
    let locator = ExploratoryReplayRequestLocatorV2 {
        request_identity: receipt.request_identity.clone(),
        meaning_digest: receipt.meaning_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        seal_digest: receipt.seal_digest.clone(),
    };
    ExploratoryReplayCommitResultV2 {
        projection: projection_v2(
            &receipt.request_identity,
            ExploratoryReplayAvailabilityV1::Available,
        ),
        locator,
        canonical_request_bytes: prepared.canonical_request_bytes,
        receipt: into_receipt_v2(receipt),
    }
}

fn into_frozen(stored: StoredFrozenV1) -> FrozenExploratoryReplayRequestV1 {
    FrozenExploratoryReplayRequestV1 {
        schema_version: stored.schema_version,
        proposal: stored.proposal,
        product_edge_request_semantic_digest: stored.product_edge_request_semantic_digest,
        research_receipt_identity: stored.research_receipt_identity,
        intent_semantic_digest: stored.intent_semantic_digest,
        trial_family_root_digest: stored.trial_family_root_digest,
        census_frontier_digest: stored.census_frontier_digest,
        artifact_family_binding_digest: stored.artifact_family_binding_digest,
        artifact_family_binding_receipt_identity: stored.artifact_family_binding_receipt_identity,
        artifact_review_identity: stored.artifact_review_identity,
        source_capsule_digest: stored.source_capsule_digest,
        build_recipe_digest: stored.build_recipe_digest,
        dependency_identity: stored.dependency_identity,
        trial_family_outbox_digest: stored.trial_family_outbox_digest,
        artifact_family_outbox_digest: stored.artifact_family_outbox_digest,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
        request_digest: stored.request_digest,
    }
}

fn into_receipt(stored: StoredReceiptV1) -> ExploratoryReplayCommitReceiptV1 {
    ExploratoryReplayCommitReceiptV1 {
        schema_version: stored.schema_version,
        receipt_identity: stored.receipt_identity,
        request_identity: stored.request_identity,
        request_digest: stored.request_digest,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn into_receipt_v2(stored: StoredReceiptV2) -> ExploratoryReplayCommitReceiptV2 {
    ExploratoryReplayCommitReceiptV2 {
        schema_version: stored.schema_version,
        receipt_identity: stored.receipt_identity,
        request_identity: stored.request_identity,
        meaning_digest: stored.meaning_digest,
        seal_digest: stored.seal_digest,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn projection(
    request_identity: &str,
    availability: ExploratoryReplayAvailabilityV1,
) -> ExploratoryReplayRequestProjectionV1 {
    ExploratoryReplayRequestProjectionV1 {
        schema_version: 1,
        request_identity: request_identity.to_string(),
        availability,
        next_legal_action: match availability {
            ExploratoryReplayAvailabilityV1::Available => {
                ExploratoryReplayNextLegalActionV1::LockByLocator
            }
            ExploratoryReplayAvailabilityV1::Stale => {
                ExploratoryReplayNextLegalActionV1::CreateSuccessorRequest
            }
            ExploratoryReplayAvailabilityV1::Unavailable => {
                ExploratoryReplayNextLegalActionV1::ResolveOwnerCustody
            }
        },
    }
}

fn projection_v2(
    request_identity: &str,
    availability: ExploratoryReplayAvailabilityV1,
) -> ExploratoryReplayRequestProjectionV1 {
    ExploratoryReplayRequestProjectionV1 {
        schema_version: 1,
        request_identity: request_identity.to_string(),
        availability,
        next_legal_action: match availability {
            ExploratoryReplayAvailabilityV1::Available => {
                ExploratoryReplayNextLegalActionV1::LockByLocator
            }
            ExploratoryReplayAvailabilityV1::Stale
            | ExploratoryReplayAvailabilityV1::Unavailable => {
                ExploratoryReplayNextLegalActionV1::ResolveOwnerCustody
            }
        },
    }
}

fn unavailable_result(request_identity: &str) -> ExploratoryReplayReadResultV1 {
    ExploratoryReplayReadResultV1 {
        projection: projection(
            request_identity,
            ExploratoryReplayAvailabilityV1::Unavailable,
        ),
        readback: None,
    }
}

fn unavailable_result_v2(request_identity: &str) -> ExploratoryReplayReadResultV2 {
    ExploratoryReplayReadResultV2 {
        projection: projection_v2(
            request_identity,
            ExploratoryReplayAvailabilityV1::Unavailable,
        ),
        readback: None,
    }
}

fn decode_frozen(value: &serde_json::Value) -> Result<StoredFrozenV1, ExploratoryReplayOwnerError> {
    decode_exact(value)
}

fn decode_receipt(
    value: &serde_json::Value,
) -> Result<StoredReceiptV1, ExploratoryReplayOwnerError> {
    decode_exact(value)
}

fn decode_exact<T>(value: &serde_json::Value) -> Result<T, ExploratoryReplayOwnerError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(unavailable)?;
    if serde_json::to_value(&decoded).map_err(unavailable)? != *value {
        return Err(ExploratoryReplayOwnerError::Unavailable(
            "stored JSON is not canonical".into(),
        ));
    }
    Ok(decoded)
}

fn canonical_digest<T: Serialize + ?Sized>(
    domain: &str,
    value: &T,
) -> Result<String, ExploratoryReplayOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T: ?Sized> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(unavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn valid_blake3(value: &str) -> bool {
    value.strip_prefix("blake3:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn storage(error: impl Display) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::Unavailable(error.to_string())
}

fn unavailable(error: impl Display) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::Unavailable(error.to_string())
}
