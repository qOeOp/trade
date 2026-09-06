use std::{fmt::Display, sync::Arc};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::Digest as _;
use sqlx::{PgPool, Row};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1, ProductEdgeInvocationClaimReadbackV1,
    ProductEdgeInvocationStateV1, resolve_admission_for_downstream_in_transaction,
};
use vibe_rd_artifact_invocation_custody::resolve_invocation_start_reservation_in_transaction;

use crate::{
    artifact_build::{
        ArtifactBuildCandidateV1, ArtifactBuildDisposition, ArtifactBuildError,
        ArtifactBuildInvocationCustodyV1, ArtifactBuildNextLegalAction, ArtifactBuildOwnerPort,
        ArtifactBuildPreparationV1, ArtifactBuildReceiptV1, ArtifactBuildRequestV1,
        ArtifactBuildResolution, ArtifactBuildResultV1, ArtifactBuildSandboxPort,
        ArtifactDirectoryCompletenessV1, ArtifactDirectoryCursorV1, ArtifactDirectoryItemV1,
        ArtifactDirectoryOwnerPort, ArtifactDirectoryReadbackV1,
        ArtifactRequestIdentityPreflightV1, ArtifactSourceOwnerPort, ArtifactSourceReadbackV1,
        ArtifactWasmPreviewStatusV1, LegacyPreparedAttemptDrainReadbackV1,
        ReservedArtifactBuildInvocationV1, StoredArtifactBuildInvocationSnapshotV1,
        UnixArtifactBuildSandboxV1, artifact_review, artifact_review_action_projection,
        build_receipt, build_request_semantic_digest, canonical_intent_bytes, issue_artifact,
        sandbox_request, validate_candidate, verify_artifact_build_admission,
        verify_sandbox_product,
    },
    legacy_prepared_attempt_drain::{
        LegacyPreparedAttemptBindingV1, append_receipt_and_outbox_in_transaction,
        attempt_json_digest, form_receipt, materialize_family as materialize_legacy_drain_family,
        validate_family_in_transaction as validate_legacy_drain_family_in_transaction,
        verify_drain_in_transaction, verify_live_predicates_in_transaction,
    },
    product_edge::{
        FrozenResearchGoalIntent, ResearchNextLegalAction, ResearchViewAvailability,
        ResearchViewPhase, canonical_research_view_identity_v2,
    },
    rd_owner_postgres_custody::{
        AttemptState, ResearchCustodyLookupV1, StoredAttemptV1, StoredInvocationClaimBindingV1,
        VerifiedAttemptCustodyV1, VerifiedResearchCustodyV1,
        admit_attempt_custody_for_request_in_transaction, admit_attempt_custody_in_transaction,
        admit_attempt_custody_with_admission_mode_in_transaction,
        admit_attempt_reservation_header_in_transaction,
        admit_attempt_with_research_in_transaction, admit_research_custody_in_transaction,
        no_artifact_receipt, require_rd_owner_api_schema,
    },
    trial_family::{TrialFamilyError, TrialFamilyResolutionV1},
    trial_family_postgres::{migrate as migrate_trial_family, persist_artifact_binding},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyPreparedAttemptDrainSummaryV1 {
    pub schema_version: u32,
    pub target_count: u32,
    pub target_set_digest: String,
    pub receipt_identities: Vec<String>,
    pub receipt_digests: Vec<String>,
}

#[derive(Clone)]
pub struct PostgresArtifactBuildOwnerV1 {
    pool: PgPool,
    database_endpoint_resource_fingerprint: String,
    sandbox: Arc<dyn ArtifactBuildSandboxPort>,
    attempt_timeout_ms: u64,
    clock: Arc<dyn Fn() -> Result<u64, ArtifactBuildError> + Send + Sync>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyStoredAttemptV1 {
    schema_version: u32,
    request: LegacyArtifactBuildRequestV1,
    request_semantic_digest: String,
    intent: Option<crate::product_edge::FrozenResearchGoalIntentV1>,
    state: AttemptState,
    candidate_digest: Option<String>,
    #[serde(default)]
    candidate: Option<serde_json::Value>,
    prepared_at_epoch_ms: u64,
    receipt: Option<ArtifactBuildReceiptV1>,
    research_view: Option<crate::product_edge::ResearchViewV1>,
    artifact_review: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SparseLegacyStoredAttemptV1 {
    schema_version: u32,
    request: LegacyArtifactBuildRequestV1,
    request_semantic_digest: String,
    state: AttemptState,
    candidate_digest: Option<String>,
    #[serde(default)]
    candidate: Option<serde_json::Value>,
    prepared_at_epoch_ms: u64,
    receipt: Option<ArtifactBuildReceiptV1>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FamilyLegacyStoredAttemptV1 {
    schema_version: u32,
    request: LegacyArtifactBuildRequestV1,
    request_semantic_digest: String,
    intent: Option<serde_json::Value>,
    state: AttemptState,
    candidate_digest: Option<String>,
    #[serde(default)]
    candidate: Option<serde_json::Value>,
    prepared_at_epoch_ms: u64,
    receipt: Option<ArtifactBuildReceiptV1>,
    research_view: Option<crate::product_edge::ResearchViewV1>,
    artifact_review: Option<serde_json::Value>,
    trial_family_resolution: serde_json::Value,
    artifact_trial_family: serde_json::Value,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyArtifactBuildRequestV1 {
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    channel: LegacyProductEdgeChannelV1,
    context: serde_json::Value,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AdmittedLegacyPreparedAttemptV1 {
    schema_version: u32,
    request: AdmittedLegacyPreparedRequestV1,
    request_semantic_digest: String,
    state: AttemptState,
    candidate_digest: Option<String>,
    #[serde(default)]
    candidate: Option<serde_json::Value>,
    prepared_at_epoch_ms: u64,
    receipt: Option<ArtifactBuildReceiptV1>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AdmittedLegacyPreparedRequestV1 {
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    channel: AdmittedLegacyPreparedChannelV1,
    admission: ProductEdgeAdmissionLocatorV1,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum AdmittedLegacyPreparedChannelV1 {
    App,
    Mcp,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum LegacyProductEdgeChannelV1 {
    App,
    Mcp,
    WindmillProductEdge,
}

#[derive(Serialize)]
struct LegacyRequestMeaningV1<'a> {
    build_request_identity: &'a str,
    attempt_identity: &'a str,
    intent_identity: &'a str,
    context: &'a serde_json::Value,
}

const ARTIFACT_BUILD_TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_artifact_build_attempts_v1",
        columns: &[
            crate::schema_materialization::required("build_request_identity", "text"),
            crate::schema_materialization::required("attempt_identity", "text"),
            crate::schema_materialization::required("semantic_digest", "text"),
            crate::schema_materialization::required("attempt_json", "jsonb"),
            crate::schema_materialization::required("prepared_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "p:build_request_identity:::false:false:true:",
            "u:attempt_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("build_request_identity"),
            crate::schema_materialization::unique_index("attempt_identity"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_strategy_artifacts_v1",
        columns: &[
            crate::schema_materialization::required("artifact_digest", "text"),
            crate::schema_materialization::required("intent_identity", "text"),
            crate::schema_materialization::required("attempt_identity", "text"),
            crate::schema_materialization::required("identity_json", "jsonb"),
            crate::schema_materialization::required("wasm_bytes", "bytea"),
            crate::schema_materialization::required("source_capsule", "bytea"),
            crate::schema_materialization::required("build_recipe", "bytea"),
            crate::schema_materialization::required("build_receipt_json", "jsonb"),
            crate::schema_materialization::required("artifact_review_json", "jsonb"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "p:artifact_digest:::false:false:true:",
            "u:attempt_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("artifact_digest"),
            crate::schema_materialization::unique_index("attempt_identity"),
        ],
    },
];

impl PostgresArtifactBuildOwnerV1 {
    /// Materializes Artifact tables during the bounded pre-cutover deployment phase.
    pub async fn materialize_schema(database_url: &str) -> Result<(), ArtifactBuildError> {
        let database_endpoint_resource_fingerprint =
            crate::legacy_prepared_attempt_drain::database_endpoint_resource_fingerprint(
                database_url,
            )?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(database_url)
            .await
            .map_err(storage)?;

        let materialization =
            crate::schema_materialization::pre_cutover_materialization_is_admitted(&pool)
                .await
                .map_err(storage)?;
        let owner = Self {
            pool,
            database_endpoint_resource_fingerprint,
            sandbox: Arc::new(UnixArtifactBuildSandboxV1::new(
                "/schema-materialization-no-sandbox",
            )),
            attempt_timeout_ms: 0,
            clock: Arc::new(current_epoch_ms),
        };

        if materialization {
            owner.migrate().await?;
            crate::schema_materialization::verify_materialized_public_tables(
                &owner.pool,
                ARTIFACT_BUILD_TABLES,
            )
            .await
            .map_err(storage)
        } else {
            crate::schema_materialization::require_existing_public_tables(
                &owner.pool,
                ARTIFACT_BUILD_TABLES,
            )
            .await
            .map_err(storage)
        }
    }

    pub async fn connect(
        database_url: &str,
        sandbox_socket: &str,
        attempt_timeout_ms: u64,
    ) -> Result<Self, ArtifactBuildError> {
        let database_endpoint_resource_fingerprint =
            crate::legacy_prepared_attempt_drain::database_endpoint_resource_fingerprint(
                database_url,
            )?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self {
            pool,
            database_endpoint_resource_fingerprint,
            sandbox: Arc::new(UnixArtifactBuildSandboxV1::new(sandbox_socket)),
            attempt_timeout_ms,
            clock: Arc::new(current_epoch_ms),
        };
        crate::schema_materialization::require_existing_public_tables(
            &owner.pool,
            ARTIFACT_BUILD_TABLES,
        )
        .await
        .map_err(storage)?;
        owner.assert_activation_safe().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), ArtifactBuildError> {
        for (relation_name, statement) in [
            (
                "rd_artifact_build_attempts_v1",
                "CREATE TABLE IF NOT EXISTS rd_artifact_build_attempts_v1 (build_request_identity TEXT PRIMARY KEY, attempt_identity TEXT NOT NULL UNIQUE, semantic_digest TEXT NOT NULL, attempt_json JSONB NOT NULL, prepared_at_epoch_ms BIGINT NOT NULL)",
            ),
            (
                "rd_strategy_artifacts_v1",
                "CREATE TABLE IF NOT EXISTS rd_strategy_artifacts_v1 (artifact_digest TEXT PRIMARY KEY, intent_identity TEXT NOT NULL, attempt_identity TEXT NOT NULL UNIQUE, identity_json JSONB NOT NULL, wasm_bytes BYTEA NOT NULL, source_capsule BYTEA NOT NULL, build_recipe BYTEA NOT NULL, build_receipt_json JSONB NOT NULL, artifact_review_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            ),
        ] {
            crate::schema_materialization::materialize_public_table(
                &self.pool,
                relation_name,
                statement,
            )
            .await
            .map_err(storage)?;
        }
        require_rd_owner_api_schema(&self.pool)
            .await
            .map_err(storage)?;
        sqlx::query(
            "
            CREATE OR REPLACE FUNCTION rd_owner_api.lock_artifact_invocation_reservation_v1(
              requested_build_request_identity text,
              requested_attempt_identity text,
              requested_claim_identity text,
              requested_reservation_identity text,
              requested_reservation_digest text
            ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
            SET search_path = pg_catalog
            AS $function$
            DECLARE sealed record;
            DECLARE reservation jsonb;
            BEGIN
              IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
              SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms
                INTO sealed
                FROM public.rd_artifact_build_attempts_v1
               WHERE build_request_identity = requested_build_request_identity
                 AND attempt_identity = requested_attempt_identity
               FOR SHARE;
              IF NOT FOUND THEN RETURN NULL; END IF;
              reservation := sealed.attempt_json->'invocation_claim';
              IF sealed.attempt_json->>'schema_version' <> '1'
                 OR sealed.attempt_json->>'state' <> 'INVOCATION_RESERVED'
                 OR sealed.attempt_json->>'request_semantic_digest' <> sealed.semantic_digest
                 OR sealed.attempt_json->>'prepared_at_epoch_ms' <> sealed.prepared_at_epoch_ms::text
                 OR sealed.attempt_json->'request'->>'build_request_identity' <> sealed.build_request_identity
                 OR sealed.attempt_json->'request'->>'attempt_identity' <> sealed.attempt_identity
                 OR reservation IS NULL
                 OR sealed.attempt_json->'invocation_custody' IS NULL
                 OR reservation->>'request_identity' <> sealed.build_request_identity
                 OR reservation->>'attempt_identity' <> sealed.attempt_identity
                 OR reservation->>'admission_identity' <> sealed.attempt_json->'request'->'admission'->>'admission_identity'
                 OR reservation->>'claim_identity' <> requested_claim_identity
                 OR reservation->>'reservation_identity' <> requested_reservation_identity
                 OR reservation->>'reservation_digest' <> requested_reservation_digest
                 OR reservation->>'execution_custody_digest' <> sealed.attempt_json->'invocation_custody'->>'custody_digest'
                 OR reservation->>'reserved_at_epoch_ms' IS NULL
              THEN RETURN NULL; END IF;
              RETURN pg_catalog.jsonb_build_object(
                'schema_version', 1,
                'build_request_identity', sealed.build_request_identity,
                'attempt_identity', sealed.attempt_identity,
                'admission_identity', reservation->>'admission_identity',
                'claim_identity', reservation->>'claim_identity',
                'claim_digest', reservation->>'claim_digest',
                'invocation_admission_receipt_identity', reservation->>'invocation_admission_receipt_identity',
                'invocation_admission_receipt_digest', reservation->>'invocation_admission_receipt_digest',
                'claimed_state_digest', reservation->>'claimed_state_digest',
                'execution_custody_digest', reservation->>'execution_custody_digest',
                'reservation_identity', reservation->>'reservation_identity',
                'reservation_digest', reservation->>'reservation_digest',
                'reserved_at_epoch_ms', (reservation->>'reserved_at_epoch_ms')::bigint
              );
            END
            $function$
            ",
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;

        for statement in [
            "ALTER FUNCTION rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text) OWNER TO rd_owner",
            "REVOKE ALL ON FUNCTION rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
            "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text) TO product_edge_owner",
            "REVOKE ALL ON TABLE rd_artifact_build_attempts_v1 FROM product_edge_owner",
        ] {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        }
        migrate_trial_family(&self.pool)
            .await
            .map_err(|e| trial_family_storage(&e))?;
        materialize_legacy_drain_family(&self.pool).await?;
        Ok(())
    }

    async fn assert_activation_safe(&self) -> Result<(), ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 FOR SHARE")
            .fetch_all(&mut *transaction).await.map_err(storage)?;

        for row in rows {
            let value: serde_json::Value = row.try_get("attempt_json").map_err(storage)?;
            if serde_json::from_value::<StoredAttemptV1>(value.clone())
                .ok()
                .is_some_and(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(&value))
            {
                continue;
            }

            if let Ok(prepared) = decode_admitted_legacy_prepared(&value) {
                let binding = verify_admitted_legacy_prepared_binding(&row, &value, &prepared)?;
                verify_drain_in_transaction(
                    &mut transaction,
                    &binding,
                    &self.database_endpoint_resource_fingerprint,
                )
                .await?;
                continue;
            }
            let (legacy, _) = decode_legacy_attempt(&value)?;
            if legacy.schema_version != 1 {
                return Err(ArtifactBuildError::Storage(
                    "noncanonical legacy attempt custody".into(),
                ));
            }

            if legacy.state != AttemptState::Terminal {
                return Err(ArtifactBuildError::Storage(
                    "undrained legacy nonterminal S2 blocks activation".into(),
                ));
            }
        }
        transaction.commit().await.map_err(storage)?;
        Ok(())
    }

    async fn preflight_request_identity_in_store(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
    ) -> Result<ArtifactRequestIdentityPreflightV1, ArtifactBuildError> {
        let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1 OR attempt_identity=$2")
            .bind(build_request_identity)
            .bind(attempt_identity)
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?;

        if rows.is_empty() {
            return Ok(ArtifactRequestIdentityPreflightV1::Vacant);
        }

        if rows.len() != 1 {
            return Err(ArtifactBuildError::Storage(
                "attempt identity preflight is ambiguous".into(),
            ));
        }
        let row = &rows[0];
        let value: serde_json::Value = row.try_get("attempt_json").map_err(storage)?;
        if serde_json::from_value::<StoredAttemptV1>(value.clone())
            .ok()
            .is_some_and(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(&value))
        {
            let mut transaction = self.pool.begin().await.map_err(storage)?;
            let custody = Box::pin(admit_attempt_custody_for_request_in_transaction(
                &mut transaction,
                build_request_identity,
                attempt_identity,
            ))
            .await?
            .ok_or_else(|| ArtifactBuildError::Storage("current attempt custody missing".into()))?;
            if custody.attempt.request.build_request_identity != build_request_identity
                || custody.attempt.request.attempt_identity != attempt_identity
            {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
            transaction.commit().await.map_err(storage)?;
            return Ok(ArtifactRequestIdentityPreflightV1::Current);
        }

        if let Ok(prepared) = decode_admitted_legacy_prepared(&value) {
            let binding = verify_admitted_legacy_prepared_binding(row, &value, &prepared)?;
            if binding.build_request_identity != build_request_identity
                || binding.attempt_identity != attempt_identity
            {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
            let mut transaction = self.pool.begin().await.map_err(storage)?;
            verify_drain_in_transaction(
                &mut transaction,
                &binding,
                &self.database_endpoint_resource_fingerprint,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined);
        }
        let (legacy, _) = decode_legacy_attempt(&value)?;
        if legacy.schema_version != 1
            || legacy.request.build_request_identity
                != row
                    .try_get::<String, _>("build_request_identity")
                    .map_err(storage)?
            || legacy.request.attempt_identity
                != row
                    .try_get::<String, _>("attempt_identity")
                    .map_err(storage)?
            || legacy.request_semantic_digest
                != row
                    .try_get::<String, _>("semantic_digest")
                    .map_err(storage)?
            || i64::try_from(legacy.prepared_at_epoch_ms).map_err(json_storage)?
                != row
                    .try_get::<i64, _>("prepared_at_epoch_ms")
                    .map_err(storage)?
        {
            return Err(ArtifactBuildError::Storage(
                "noncanonical legacy attempt custody".into(),
            ));
        }

        if legacy.request.build_request_identity != build_request_identity
            || legacy.request.attempt_identity != attempt_identity
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if legacy.state != AttemptState::Terminal {
            return Err(ArtifactBuildError::Storage(
                "undrained legacy nonterminal S2 blocks activation".into(),
            ));
        }
        Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined)
    }

    async fn resolve_legacy_terminal_in_store(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let mut locks = [
            format!("artifact-build-attempt:{attempt_identity}"),
            format!("artifact-build-request:{build_request_identity}"),
        ];
        locks.sort();
        for identity in locks {
            lock(&mut transaction, &identity).await?;
        }
        let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1 OR attempt_identity=$2 FOR SHARE")
            .bind(build_request_identity).bind(attempt_identity)
            .fetch_all(&mut *transaction).await.map_err(storage)?;

        if rows.len() != 1 {
            return Err(ArtifactBuildError::Storage(
                "legacy terminal attempt custody unavailable".into(),
            ));
        }
        let row = &rows[0];
        let value: serde_json::Value = row.try_get("attempt_json").map_err(storage)?;
        if serde_json::from_value::<StoredAttemptV1>(value.clone())
            .ok()
            .is_some_and(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(&value))
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if let Ok(prepared) = decode_admitted_legacy_prepared(&value) {
            let binding = verify_admitted_legacy_prepared_binding(row, &value, &prepared)?;
            if binding.build_request_identity != build_request_identity
                || binding.attempt_identity != attempt_identity
            {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
            let receipt = verify_drain_in_transaction(
                &mut transaction,
                &binding,
                &self.database_endpoint_resource_fingerprint,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(drained_prepared_result(&prepared, &receipt));
        }
        let (legacy, complete_projection_fields) = decode_legacy_attempt(&value)?;
        verify_legacy_terminal_attempt(
            &mut transaction,
            row,
            &value,
            &legacy,
            complete_projection_fields,
            build_request_identity,
            attempt_identity,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(legacy_terminal_result(legacy))
    }

    fn now(&self) -> Result<u64, ArtifactBuildError> {
        (self.clock)()
    }

    async fn read_attempt_custody(
        &self,
        build_request_identity: &str,
    ) -> Result<Option<VerifiedAttemptCustodyV1>, ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let custody = Box::pin(admit_attempt_custody_in_transaction(
            &mut transaction,
            build_request_identity,
        ))
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(custody)
    }

    async fn terminal_no_artifact(
        &self,
        request: &ArtifactBuildRequestV1,
        failure_code: &str,
        invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let started_binding = invocation
            .map(|claim| verify_started_invocation(claim, request))
            .transpose()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let admission_mode = if started_binding.is_some() {
            DownstreamAdmissionModeV1::Historical
        } else {
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: self.now()?,
            }
        };
        let custody = Box::pin(admit_attempt_custody_with_admission_mode_in_transaction(
            &mut transaction,
            &request.build_request_identity,
            admission_mode,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("attempt missing".to_string()))?;
        if custody.attempt.request.attempt_identity != request.attempt_identity
            || custody.attempt.request_semantic_digest != build_request_semantic_digest(request)?
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if custody.attempt.state == AttemptState::Terminal {
            let read_cut = self.now()?;
            transaction.commit().await.map_err(storage)?;
            return result_from_verified(custody, read_cut);
        }

        if custody.attempt.state == AttemptState::InvocationReserved {
            match (
                custody.attempt.invocation_claim.as_ref(),
                started_binding.as_ref(),
            ) {
                (Some(expected), Some(actual)) if same_invocation_claim(expected, actual) => {}
                (Some(_), None) => {
                    let read_cut = self.now()?;
                    transaction.commit().await.map_err(storage)?;
                    return result_from_verified(custody, read_cut);
                }
                _ => return Err(ArtifactBuildError::ConflictingReplay),
            }
        } else if let (Some(expected), Some(actual)) = (
            custody.attempt.invocation_claim.as_ref(),
            started_binding.as_ref(),
        ) && !same_invocation_claim(expected, actual)
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }
        let write_cut = self.now()?;

        if started_binding.is_none()
            && (!custody
                .product_edge_admission
                .authorizes_first_mutation_at(write_cut)
                || !research_view_is_available(&custody.research, write_cut))
        {
            transaction.rollback().await.map_err(storage)?;
            return result_from_verified(custody, write_cut);
        }
        let product_edge_admission = custody.product_edge_admission;
        let research = custody.research;
        let old_attempt = custody.attempt;
        let mut attempt = old_attempt.clone();
        attempt.state = AttemptState::Terminal;
        attempt.receipt = Some(no_artifact_receipt(
            &attempt,
            &research,
            failure_code,
            write_cut,
        )?);
        persist_attempt(&mut transaction, &old_attempt, &attempt).await?;
        let custody = Box::pin(admit_attempt_with_research_in_transaction(
            &mut transaction,
            &request.build_request_identity,
            research,
            product_edge_admission,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("terminal attempt missing".to_string()))?;
        transaction.commit().await.map_err(storage)?;
        result_from_verified(custody, write_cut)
    }
}

#[async_trait]
impl ArtifactBuildOwnerPort for PostgresArtifactBuildOwnerV1 {
    async fn preflight_request_identity(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
    ) -> Result<ArtifactRequestIdentityPreflightV1, ArtifactBuildError> {
        Box::pin(self.preflight_request_identity_in_store(build_request_identity, attempt_identity))
            .await
    }

    async fn prepare(
        &self,
        request: ArtifactBuildRequestV1,
    ) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
        let semantic_digest = build_request_semantic_digest(&request)?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let existing_hint: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 OR attempt_identity = $2)",
        )
        .bind(&request.build_request_identity)
        .bind(&request.attempt_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let product_edge_admission = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &request.admission,
            if existing_hint {
                DownstreamAdmissionModeV1::Historical
            } else {
                DownstreamAdmissionModeV1::FirstMutation {
                    read_cut_epoch_ms: self.now()?,
                }
            },
        )
        .await
        .map_err(|_| ArtifactBuildError::Unauthorized("Product Edge admission unavailable"))?;
        verify_artifact_build_admission(&product_edge_admission, &request)?;
        lock_request_attempt(&mut transaction, &request).await?;
        if let Some(custody) = Box::pin(admit_attempt_custody_for_request_in_transaction(
            &mut transaction,
            &request.build_request_identity,
            &request.attempt_identity,
        ))
        .await?
        {
            if custody.attempt.request_semantic_digest != semantic_digest
                || custody.attempt.request.build_request_identity != request.build_request_identity
                || custody.attempt.request.attempt_identity != request.attempt_identity
                || custody.product_edge_admission.locator() != &request.admission
            {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
            let read_cut = self.now()?;
            transaction.commit().await.map_err(storage)?;
            return preparation_from_verified(custody, read_cut);
        }
        let research = Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::Intent(&request.intent_identity),
        ))
        .await;
        let research = match research {
            Ok(research) => research,
            Err(_) => {
                transaction.rollback().await.map_err(storage)?;
                return Ok(unavailable_preparation(&request, semantic_digest));
            }
        };
        let Some(research) = research else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(unavailable_preparation(&request, semantic_digest));
        };
        research.intent().ok_or_else(|| {
            ArtifactBuildError::Storage("accepted research intent missing".to_string())
        })?;
        let write_cut = self.now()?;
        if !product_edge_admission.authorizes_first_mutation_at(write_cut) {
            transaction.rollback().await.map_err(storage)?;
            return Ok(unavailable_preparation(&request, semantic_digest));
        }
        verify_artifact_build_admission(&product_edge_admission, &request)?;

        if !research_view_is_available(&research, write_cut) {
            transaction.rollback().await.map_err(storage)?;
            return Ok(unavailable_preparation(&request, semantic_digest));
        }
        let now = write_cut;
        let attempt = StoredAttemptV1 {
            schema_version: 1,
            request,
            request_semantic_digest: semantic_digest,
            state: AttemptState::Prepared,
            candidate_digest: None,
            candidate: None,
            invocation_claim: None,
            invocation_custody: None,
            prepared_at_epoch_ms: now,
            receipt: None,
        };

        sqlx::query("INSERT INTO rd_artifact_build_attempts_v1 (build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(&attempt.request.build_request_identity)
            .bind(&attempt.request.attempt_identity)
            .bind(&attempt.request_semantic_digest)
            .bind(encode(&attempt)?)
            .bind(i64::try_from(now).map_err(json_storage)?)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let custody = Box::pin(admit_attempt_custody_in_transaction(
            &mut transaction,
            &attempt.request.build_request_identity,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("prepared attempt missing".to_string()))?;
        let response_cut = self.now()?;
        transaction.commit().await.map_err(storage)?;
        preparation_from_verified(custody, response_cut)
    }

    async fn reserve_provider_invocation_custody(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
        claim: ProductEdgeInvocationClaimReadbackV1,
    ) -> Result<ReservedArtifactBuildInvocationV1, ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let header = admit_attempt_reservation_header_in_transaction(
            &mut transaction,
            build_request_identity,
        )
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("prepared attempt missing".to_string()))?;
        if header.attempt.request.build_request_identity != build_request_identity
            || header.attempt.request.attempt_identity != attempt_identity
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }
        let execution_custody = match header.attempt.state {
            AttemptState::Prepared => {
                let custody = Box::pin(admit_attempt_custody_in_transaction(
                    &mut transaction,
                    build_request_identity,
                ))
                .await?
                .ok_or_else(|| {
                    ArtifactBuildError::Storage("prepared attempt missing".to_string())
                })?;
                let request = &custody.attempt.request;
                let claim_binding = verify_claimed_invocation(&claim, request)?;
                let semantic_digest = build_request_semantic_digest(request)?;
                if custody.attempt.request_semantic_digest != semantic_digest
                    || custody.product_edge_admission.locator() != &request.admission
                {
                    return Err(ArtifactBuildError::ConflictingReplay);
                }
                let reserved_at_epoch_ms = self.now()?;
                let snapshot = seal_invocation_execution_snapshot(
                    &custody,
                    &claim_binding,
                    semantic_digest,
                    reserved_at_epoch_ms,
                )?;
                let reservation = claim_binding
                    .seal_reservation(reserved_at_epoch_ms, snapshot.custody_digest.clone())?;
                let old_attempt = custody.attempt;
                let mut current = old_attempt.clone();
                current.state = AttemptState::InvocationReserved;
                current.invocation_claim = Some(reservation);
                current.invocation_custody = Some(snapshot);
                persist_attempt(&mut transaction, &old_attempt, &current).await?;
                let persisted = admit_attempt_reservation_header_in_transaction(
                    &mut transaction,
                    build_request_identity,
                )
                .await?
                .ok_or_else(|| {
                    ArtifactBuildError::Storage("reserved attempt missing".to_string())
                })?;
                execution_custody_from_snapshot(&persisted.attempt)?
            }

            AttemptState::InvocationReserved => {
                let claim_matches = matches!(
                    claim.state(),
                    ProductEdgeInvocationStateV1::Claimed
                        | ProductEdgeInvocationStateV1::InvocationStarted
                ) && header.attempt.invocation_claim.as_ref().is_some_and(
                    |stored| {
                        invocation_binding(&claim, &header.attempt.request)
                            .is_ok_and(|incoming| same_invocation_claim(stored, &incoming))
                    },
                );

                if !claim_matches {
                    return Err(ArtifactBuildError::Unauthorized(
                        "claimed or started provider invocation unavailable",
                    ));
                }
                execution_custody_from_snapshot(&header.attempt)?
            }
            AttemptState::Building | AttemptState::Terminal => {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
        };
        let claim_custody = claim.into_custody();
        let start_reservation = resolve_invocation_start_reservation_in_transaction(
            &mut transaction,
            &execution_custody.request.build_request_identity,
            &execution_custody.request.attempt_identity,
            &claim_custody,
            &execution_custody.reservation_identity,
            &execution_custody.reservation_digest,
        )
        .await
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
        transaction.commit().await.map_err(storage)?;
        Ok(ReservedArtifactBuildInvocationV1::new(
            start_reservation,
            execution_custody,
        ))
    }

    async fn submit_candidate(
        &self,
        request: ArtifactBuildRequestV1,
        candidate: ArtifactBuildCandidateV1,
        invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let started_binding = invocation
            .map(|claim| verify_started_invocation(claim, &request))
            .transpose()?;
        let prepared = if started_binding.is_some() {
            None
        } else {
            Some(self.prepare(request.clone()).await?)
        };

        if prepared
            .as_ref()
            .is_some_and(|value| value.resolution != ArtifactBuildResolution::Prepared)
        {
            return match Box::pin(self.read_attempt_custody(&request.build_request_identity))
                .await?
            {
                Some(custody) => result_from_verified(custody, self.now()?),
                None => Ok(unknown_result(
                    &request.build_request_identity,
                    &request.attempt_identity,
                )),
            };
        }
        let custody = Box::pin(self.read_attempt_custody(&request.build_request_identity))
            .await?
            .ok_or_else(|| ArtifactBuildError::Storage("prepared attempt missing".to_string()))?;
        let intent = custody
            .research
            .intent()
            .ok_or(ArtifactBuildError::Candidate("intent unavailable"))?
            .clone();
        let digest = match validate_candidate(&candidate, &intent) {
            Ok(digest) => digest,
            Err(ArtifactBuildError::Candidate(_)) => {
                return Box::pin(self.terminal_no_artifact(
                    &request,
                    "CANDIDATE_MALFORMED",
                    invocation,
                ))
                .await;
            }
            Err(e) => return Err(e),
        };
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let custody = Box::pin(admit_attempt_custody_in_transaction(
            &mut transaction,
            &request.build_request_identity,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("attempt missing".to_string()))?;
        match custody.attempt.state {
            AttemptState::Terminal => {
                transaction.commit().await.map_err(storage)?;
                return result_from_verified(custody, self.now()?);
            }
            AttemptState::Building => {
                if custody.attempt.candidate_digest.as_deref() != Some(&digest) {
                    return Err(ArtifactBuildError::ConflictingReplay);
                }

                if let (Some(expected), Some(actual)) = (
                    custody.attempt.invocation_claim.as_ref(),
                    started_binding.as_ref(),
                ) && !same_invocation_claim(expected, actual)
                {
                    return Err(ArtifactBuildError::ConflictingReplay);
                }
                let transition_cut = self.now()?;
                if started_binding.is_none()
                    && !research_view_is_available(&custody.research, transition_cut)
                {
                    transaction.rollback().await.map_err(storage)?;
                    return result_from_verified(custody, transition_cut);
                }
                transaction.commit().await.map_err(storage)?;
            }
            AttemptState::InvocationReserved => {
                let Some(started_binding) = started_binding.as_ref() else {
                    let read_cut = self.now()?;
                    transaction.commit().await.map_err(storage)?;
                    return result_from_verified(custody, read_cut);
                };

                if !custody
                    .attempt
                    .invocation_claim
                    .as_ref()
                    .is_some_and(|expected| same_invocation_claim(expected, started_binding))
                {
                    return Err(ArtifactBuildError::ConflictingReplay);
                }
                let old_attempt = custody.attempt;
                let mut current = old_attempt.clone();
                current.state = AttemptState::Building;
                current.candidate_digest = Some(digest.clone());
                current.candidate = Some(candidate.clone());
                persist_attempt(&mut transaction, &old_attempt, &current).await?;
                transaction.commit().await.map_err(storage)?;
            }
            AttemptState::Prepared => {
                let transition_cut = self.now()?;

                if started_binding.is_none()
                    && (!custody
                        .product_edge_admission
                        .authorizes_first_mutation_at(transition_cut)
                        || !research_view_is_available(&custody.research, transition_cut))
                {
                    transaction.rollback().await.map_err(storage)?;
                    return result_from_verified(custody, transition_cut);
                }
                let old_attempt = custody.attempt;
                let mut current = old_attempt.clone();
                current.state = AttemptState::Building;
                current.candidate_digest = Some(digest.clone());
                current.candidate = Some(candidate.clone());
                persist_attempt(&mut transaction, &old_attempt, &current).await?;
                transaction.commit().await.map_err(storage)?;
            }
        }
        let sandbox_request = sandbox_request(&candidate, &digest);
        let expected_source = sandbox_request.source.clone();
        let product = match self.sandbox.build(sandbox_request).await {
            Ok(product) => product,
            Err(_) => {
                return Box::pin(self.terminal_no_artifact(
                    &request,
                    "DEVELOPMENT_SANDBOX_FAILED",
                    invocation,
                ))
                .await;
            }
        };
        let build = match verify_sandbox_product(&product, &expected_source) {
            Ok(build) => build,
            Err(_) => {
                return Box::pin(self.terminal_no_artifact(
                    &request,
                    "ARTIFACT_SECURITY_ADMISSION_REJECTED",
                    invocation,
                ))
                .await;
            }
        };
        let intent_bytes = canonical_intent_bytes(&intent)?;
        let artifact =
            issue_artifact(&intent_bytes, &request.attempt_identity, &candidate, &build)?;
        let build_receipt = build_receipt(
            &request.attempt_identity,
            intent.intent_identity(),
            &digest,
            &build,
            &artifact,
        );
        let review = artifact_review(&intent, &candidate, &artifact, build_receipt.clone());
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let custody = Box::pin(admit_attempt_custody_in_transaction(
            &mut transaction,
            &request.build_request_identity,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("attempt missing".to_string()))?;
        if custody.attempt.state == AttemptState::Terminal {
            transaction.commit().await.map_err(storage)?;
            return result_from_verified(custody, self.now()?);
        }
        let now = self.now()?;
        if started_binding.is_none() && !research_view_is_available(&custody.research, now) {
            transaction.rollback().await.map_err(storage)?;
            return result_from_verified(custody, now);
        }
        let authoritative_intent = custody
            .research
            .intent()
            .ok_or_else(|| ArtifactBuildError::Storage("attempt intent missing".to_string()))?;
        if authoritative_intent != &intent {
            return Err(ArtifactBuildError::Storage(
                "attempt intent changed during build".to_string(),
            ));
        }
        let research_request_identity = custody.research.receipt().request_identity.clone();
        let locked_research_receipt = custody.research.receipt().clone();
        let verified_family = custody.research.family().cloned();
        let old_view = custody
            .research
            .view()
            .cloned()
            .ok_or_else(|| ArtifactBuildError::Storage("research view missing".to_string()))?;
        let mut view = old_view.clone();
        let mut current = custody.attempt.clone();
        if current.state != AttemptState::Building
            || current.candidate_digest.as_deref() != Some(&digest)
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }
        view.phase = ResearchViewPhase::ArtifactAvailable;
        view.availability = ResearchViewAvailability::Available;
        view.attempt_identity = Some(request.attempt_identity.clone());
        view.artifact_identity = Some(artifact.identity().artifact_digest.clone());
        view.build_receipt_identity = Some(build_receipt.build_receipt_identity.clone());
        view.artifact_review_identity = Some(review.review_identity.clone());
        view.next_legal_action = ResearchNextLegalAction::ReviewArtifact;
        view.source_cut = format!("rd-artifact-cut-v1-{}", artifact.identity().artifact_digest);
        view.observed_at_epoch_ms = now;
        view.projection_at_epoch_ms = now;
        view.valid_through_epoch_ms = now.saturating_add(600_000);
        view.projection_identity = canonical_research_view_identity_v2(&view);
        let receipt = ArtifactBuildReceiptV1 {
            schema_version: 1,
            receipt_identity: format!(
                "rd-artifact-build-receipt-v1-{}",
                artifact
                    .identity()
                    .artifact_digest
                    .trim_start_matches("blake3:")
            ),
            build_request_identity: request.build_request_identity.clone(),
            attempt_identity: request.attempt_identity.clone(),
            request_semantic_digest: current.request_semantic_digest.clone(),
            intent_identity: Some(intent.intent_identity().to_string()),
            intent_semantic_digest: Some(intent.semantic_digest().to_string()),
            disposition: ArtifactBuildDisposition::Success,
            artifact_identity: Some(artifact.identity().artifact_digest.clone()),
            build_receipt_identity: Some(build_receipt.build_receipt_identity.clone()),
            failure_code: None,
            committed_at_epoch_ms: now,
        };
        let write_cut = self.now()?;

        if started_binding.is_none()
            && (!custody
                .product_edge_admission
                .authorizes_first_mutation_at(write_cut)
                || !research_view_is_available(&custody.research, write_cut))
        {
            transaction.rollback().await.map_err(storage)?;
            return result_from_verified(custody, write_cut);
        }
        sqlx::query("INSERT INTO rd_strategy_artifacts_v1 (artifact_digest, intent_identity, attempt_identity, identity_json, wasm_bytes, source_capsule, build_recipe, build_receipt_json, artifact_review_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&artifact.identity().artifact_digest)
            .bind(intent.intent_identity())
            .bind(&request.attempt_identity)
            .bind(encode(artifact.identity())?)
            .bind(artifact.wasm())
            .bind(build.source_capsule.as_ref())
            .bind(build.build_recipe.as_ref())
            .bind(encode(&build_receipt)?)
            .bind(encode(&review)?)
            .bind(i64::try_from(now).map_err(json_storage)?)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let updated = sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json = $1 WHERE request_identity = $2 AND intent_json = $3 AND view_json = $4 AND receipt_json = $5")
            .bind(encode(&view)?)
            .bind(&research_request_identity)
            .bind(encode(&intent)?)
            .bind(encode(&old_view)?)
            .bind(encode(custody.research.receipt())?)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(ArtifactBuildError::Storage(
                "research view custody update mismatch".to_string(),
            ));
        }
        current.state = AttemptState::Terminal;
        current.receipt = Some(receipt);

        if intent.is_v2() {
            let family = verified_family.clone().ok_or_else(|| {
                ArtifactBuildError::Storage("V2 family custody missing".to_string())
            })?;
            persist_artifact_binding(
                &mut transaction,
                family,
                artifact.identity().artifact_digest.as_str(),
                &build_receipt.build_receipt_identity,
                intent.intent_identity(),
                now,
            )
            .await
            .map_err(|e| trial_family_storage(&e))?;
        }
        persist_attempt(&mut transaction, &custody.attempt, &current).await?;
        let refreshed_research = Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::Intent(&request.intent_identity),
        ))
        .await
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?
        .ok_or_else(|| {
            ArtifactBuildError::Storage(
                "successful artifact research custody missing after view update".to_string(),
            )
        })?;

        if refreshed_research.receipt() != &locked_research_receipt
            || refreshed_research.intent() != Some(&intent)
            || refreshed_research.family() != verified_family.as_ref()
        {
            return Err(ArtifactBuildError::Storage(
                "successful artifact research custody changed after view update".to_string(),
            ));
        }
        let custody = Box::pin(admit_attempt_with_research_in_transaction(
            &mut transaction,
            &request.build_request_identity,
            refreshed_research,
            custody.product_edge_admission,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("terminal attempt missing".to_string()))?;
        transaction.commit().await.map_err(storage)?;
        result_from_verified(custody, now)
    }

    async fn fail_no_artifact(
        &self,
        request: ArtifactBuildRequestV1,
        failure_code: &str,
        invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        if ![
            "NOT_CONFIGURED",
            "POLICY_UNAVAILABLE",
            "PROVIDER_EMPTY",
            "PROVIDER_ERROR",
            "CANDIDATE_MALFORMED",
        ]
        .contains(&failure_code)
        {
            return Err(ArtifactBuildError::Candidate("provider failure code"));
        }
        let invocation_started = invocation
            .map(|claim| verify_started_invocation(claim, &request))
            .transpose()?
            .is_some();
        let prepared = if invocation_started {
            None
        } else {
            Some(self.prepare(request.clone()).await?)
        };

        if prepared
            .as_ref()
            .is_some_and(|value| value.resolution != ArtifactBuildResolution::Prepared)
        {
            return match Box::pin(self.read_attempt_custody(&request.build_request_identity))
                .await?
            {
                Some(custody) => result_from_verified(custody, self.now()?),
                None => Ok(unknown_result(
                    &request.build_request_identity,
                    &request.attempt_identity,
                )),
            };
        }
        Box::pin(self.terminal_no_artifact(&request, failure_code, invocation)).await
    }

    async fn resolve(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let read_cut = self.now()?;
        let Some(custody) = Box::pin(self.read_attempt_custody(build_request_identity)).await?
        else {
            return Ok(unknown_result(build_request_identity, attempt_identity));
        };

        if custody.attempt.request.attempt_identity != attempt_identity {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if &custody.attempt.request.admission != admission {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if !matches!(
            custody.attempt.state,
            AttemptState::Terminal | AttemptState::InvocationReserved
        ) && self
            .now()?
            .saturating_sub(custody.attempt.prepared_at_epoch_ms)
            > self.attempt_timeout_ms
        {
            return Box::pin(self.terminal_no_artifact(
                &custody.attempt.request,
                "ATTEMPT_CUSTODY_EXPIRED",
                None,
            ))
            .await;
        }

        if custody.attempt.state == AttemptState::Building {
            let candidate = custody.attempt.candidate.clone().ok_or_else(|| {
                ArtifactBuildError::Storage("building candidate missing".to_string())
            })?;
            return self
                .submit_candidate(custody.attempt.request.clone(), candidate, None)
                .await;
        }
        result_from_verified(custody, read_cut)
    }

    async fn resolve_legacy_terminal_quarantined(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        self.resolve_legacy_terminal_in_store(build_request_identity, attempt_identity)
            .await
    }
}

#[async_trait]
impl ArtifactSourceOwnerPort for PostgresArtifactBuildOwnerV1 {
    async fn read_source(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
    ) -> Result<Option<ArtifactSourceReadbackV1>, ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let Some(custody) = Box::pin(admit_attempt_custody_in_transaction(
            &mut transaction,
            build_request_identity,
        ))
        .await?
        else {
            transaction.commit().await.map_err(storage)?;
            return Ok(None);
        };

        if custody.attempt.request.attempt_identity != attempt_identity {
            return Err(ArtifactBuildError::ConflictingReplay);
        }
        let Some(receipt) = custody.attempt.receipt.as_ref() else {
            return Ok(None);
        };

        if receipt.disposition != ArtifactBuildDisposition::Success {
            return Ok(None);
        }
        let candidate = custody.attempt.candidate.as_ref().ok_or_else(|| {
            ArtifactBuildError::Storage("successful candidate missing".to_string())
        })?;
        let candidate_digest = custody.attempt.candidate_digest.as_deref().ok_or_else(|| {
            ArtifactBuildError::Storage("successful candidate digest missing".to_string())
        })?;
        let review = custody.artifact_review.as_ref().ok_or_else(|| {
            ArtifactBuildError::Storage("successful artifact review missing".to_string())
        })?;
        let artifact_identity = receipt.artifact_identity.as_deref().ok_or_else(|| {
            ArtifactBuildError::Storage("successful artifact identity missing".to_string())
        })?;

        if review.artifact_identity.artifact_digest != artifact_identity
            || review.build_receipt.candidate_digest != candidate_digest
            || review.build_receipt.attempt_identity != attempt_identity
        {
            return Err(ArtifactBuildError::Storage(
                "artifact source custody mismatch".to_string(),
            ));
        }
        let source = crate::artifact_build::render_program_source(candidate, candidate_digest);
        let source_digest = format!("sha256:{:x}", sha2::Sha256::digest(source.as_bytes()));
        let readback = ArtifactSourceReadbackV1 {
            schema_version: 1,
            build_request_identity: build_request_identity.to_string(),
            attempt_identity: attempt_identity.to_string(),
            artifact_identity: artifact_identity.to_string(),
            observed_at_epoch_ms: receipt.committed_at_epoch_ms,
            file_name: "strategy.rs".to_string(),
            language: "rust".to_string(),
            source,
            source_digest,
            wasm_preview_status: ArtifactWasmPreviewStatusV1::NotRun,
            wasm_preview_reason: "WASM_PREVIEW_NOT_RUN".to_string(),
        };
        transaction.commit().await.map_err(storage)?;
        Ok(Some(readback))
    }
}

const ARTIFACT_DIRECTORY_MAX_RETURNED: u32 = 20;
const ARTIFACT_DIRECTORY_MAX_SCANNED: i64 = 60;

#[async_trait]
impl ArtifactDirectoryOwnerPort for PostgresArtifactBuildOwnerV1 {
    async fn list_artifacts(
        &self,
        after: Option<&ArtifactDirectoryCursorV1>,
        limit: u32,
    ) -> Result<ArtifactDirectoryReadbackV1, ArtifactBuildError> {
        if !(1..=ARTIFACT_DIRECTORY_MAX_RETURNED).contains(&limit)
            || after.is_some_and(|cursor| {
                cursor.build_request_identity.is_empty()
                    || cursor.build_request_identity.len() > 192
                    || !cursor.build_request_identity.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.')
                    })
            })
        {
            return Err(ArtifactBuildError::Candidate(
                "artifact directory cursor or limit is invalid",
            ));
        }

        let scan_limit = ARTIFACT_DIRECTORY_MAX_SCANNED + 1;
        let candidate_rows = if let Some(cursor) = after {
            sqlx::query(
                "SELECT build_request_identity, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE (prepared_at_epoch_ms, build_request_identity COLLATE \"C\") < ($1, $2 COLLATE \"C\") ORDER BY prepared_at_epoch_ms DESC, build_request_identity COLLATE \"C\" DESC LIMIT $3",
            )
            .bind(i64::try_from(cursor.prepared_at_epoch_ms).map_err(json_storage)?)
            .bind(&cursor.build_request_identity)
            .bind(scan_limit)
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?
        } else {
            sqlx::query(
                "SELECT build_request_identity, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 ORDER BY prepared_at_epoch_ms DESC, build_request_identity COLLATE \"C\" DESC LIMIT $1",
            )
            .bind(scan_limit)
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?
        };

        let has_unscanned_candidate = candidate_rows.len()
            > usize::try_from(ARTIFACT_DIRECTORY_MAX_SCANNED).map_err(json_storage)?;
        let candidates = candidate_rows
            .into_iter()
            .take(usize::try_from(ARTIFACT_DIRECTORY_MAX_SCANNED).map_err(json_storage)?)
            .collect::<Vec<_>>();
        let candidate_count = candidates.len();
        let mut items = Vec::with_capacity(usize::try_from(limit).map_err(json_storage)?);
        let mut omitted_count = 0_u32;
        let mut last_cursor = None;
        let mut scanned = 0_usize;

        for row in candidates {
            let build_request_identity = row
                .try_get::<String, _>("build_request_identity")
                .map_err(storage)?;
            let prepared_at_epoch_ms = u64::try_from(
                row.try_get::<i64, _>("prepared_at_epoch_ms")
                    .map_err(storage)?,
            )
            .map_err(json_storage)?;
            last_cursor = Some(ArtifactDirectoryCursorV1 {
                prepared_at_epoch_ms,
                build_request_identity: build_request_identity.clone(),
            });
            scanned += 1;

            let mut transaction = self.pool.begin().await.map_err(storage)?;
            let custody = Box::pin(admit_attempt_custody_in_transaction(
                &mut transaction,
                &build_request_identity,
            ))
            .await;

            match custody {
                Ok(Some(custody)) => {
                    let receipt = custody.attempt.receipt.as_ref();
                    let review = custody.artifact_review.as_ref();
                    if let (Some(receipt), Some(review)) = (receipt, review)
                        && receipt.disposition == ArtifactBuildDisposition::Success
                        && receipt.artifact_identity.as_deref()
                            == Some(review.artifact_identity.artifact_digest.as_str())
                    {
                        items.push(ArtifactDirectoryItemV1 {
                            build_request_identity,
                            attempt_identity: custody.attempt.request.attempt_identity.clone(),
                            artifact_identity: review.artifact_identity.artifact_digest.clone(),
                            intent_identity: custody.attempt.request.intent_identity.clone(),
                            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
                            build_target: review.build_receipt.target.clone(),
                            build_security_state: review.build_security_state.clone(),
                        });
                    } else {
                        omitted_count = omitted_count.saturating_add(1);
                    }
                    transaction.commit().await.map_err(storage)?;
                }
                Ok(None) => {
                    omitted_count = omitted_count.saturating_add(1);
                    transaction.commit().await.map_err(storage)?;
                }
                Err(e) => return Err(e),
            }

            if items.len() == usize::try_from(limit).map_err(json_storage)? {
                break;
            }
        }

        let next_cursor = (has_unscanned_candidate || scanned < candidate_count)
            .then_some(last_cursor)
            .flatten();
        Ok(ArtifactDirectoryReadbackV1 {
            schema_version: 1,
            observed_at_epoch_ms: (self.clock)()?,
            completeness: if omitted_count == 0 {
                ArtifactDirectoryCompletenessV1::Complete
            } else {
                ArtifactDirectoryCompletenessV1::Partial
            },
            omitted_count,
            next_cursor,
            items,
        })
    }
}

fn decode_legacy_attempt(
    value: &serde_json::Value,
) -> Result<(LegacyStoredAttemptV1, bool), ArtifactBuildError> {
    let complete = serde_json::from_value::<LegacyStoredAttemptV1>(value.clone())
        .ok()
        .filter(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(value));
    let sparse = serde_json::from_value::<SparseLegacyStoredAttemptV1>(value.clone())
        .ok()
        .filter(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(value));
    let family = serde_json::from_value::<FamilyLegacyStoredAttemptV1>(value.clone())
        .ok()
        .filter(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(value));
    match (complete, sparse, family) {
        (Some(decoded), None, None) => Ok((decoded, true)),
        (None, Some(decoded), None) => Ok((
            LegacyStoredAttemptV1 {
                schema_version: decoded.schema_version,
                request: decoded.request,
                request_semantic_digest: decoded.request_semantic_digest,
                intent: None,
                state: decoded.state,
                candidate_digest: decoded.candidate_digest,
                candidate: decoded.candidate,
                prepared_at_epoch_ms: decoded.prepared_at_epoch_ms,
                receipt: decoded.receipt,
                research_view: None,
                artifact_review: None,
            },
            false,
        )),
        (None, None, Some(decoded)) => Ok((
            LegacyStoredAttemptV1 {
                schema_version: decoded.schema_version,
                request: decoded.request,
                request_semantic_digest: decoded.request_semantic_digest,
                intent: None,
                state: decoded.state,
                candidate_digest: decoded.candidate_digest,
                candidate: decoded.candidate,
                prepared_at_epoch_ms: decoded.prepared_at_epoch_ms,
                receipt: decoded.receipt,
                research_view: decoded.research_view,
                artifact_review: decoded.artifact_review,
            },
            false,
        )),
        _ => Err(ArtifactBuildError::Storage(
            "unclassified legacy attempt custody".into(),
        )),
    }
}

fn decode_admitted_legacy_prepared(
    value: &serde_json::Value,
) -> Result<AdmittedLegacyPreparedAttemptV1, ArtifactBuildError> {
    serde_json::from_value::<AdmittedLegacyPreparedAttemptV1>(value.clone())
        .ok()
        .filter(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(value))
        .ok_or_else(|| {
            ArtifactBuildError::Storage(
                "unclassified admitted legacy PREPARED attempt custody".into(),
            )
        })
}

fn verify_admitted_legacy_prepared_binding(
    row: &sqlx::postgres::PgRow,
    encoded: &serde_json::Value,
    legacy: &AdmittedLegacyPreparedAttemptV1,
) -> Result<LegacyPreparedAttemptBindingV1, ArtifactBuildError> {
    if legacy.schema_version != 1
        || legacy.state != AttemptState::Prepared
        || !matches!(
            legacy.request.channel,
            AdmittedLegacyPreparedChannelV1::App | AdmittedLegacyPreparedChannelV1::Mcp
        )
        || legacy.candidate_digest.is_some()
        || legacy.candidate.is_some()
        || legacy.receipt.is_some()
        || legacy.request.admission.request_identity != legacy.request.build_request_identity
        || legacy.request.build_request_identity
            != row
                .try_get::<String, _>("build_request_identity")
                .map_err(storage)?
        || legacy.request.attempt_identity
            != row
                .try_get::<String, _>("attempt_identity")
                .map_err(storage)?
        || legacy.request_semantic_digest
            != row
                .try_get::<String, _>("semantic_digest")
                .map_err(storage)?
        || i64::try_from(legacy.prepared_at_epoch_ms).map_err(json_storage)?
            != row
                .try_get::<i64, _>("prepared_at_epoch_ms")
                .map_err(storage)?
    {
        return Err(ArtifactBuildError::Storage(
            "noncanonical legacy PREPARED attempt custody".into(),
        ));
    }

    if legacy.request_semantic_digest.trim().is_empty() {
        return Err(ArtifactBuildError::Storage(
            "legacy PREPARED attempt semantic digest unavailable".into(),
        ));
    }
    Ok(LegacyPreparedAttemptBindingV1 {
        build_request_identity: legacy.request.build_request_identity.clone(),
        attempt_identity: legacy.request.attempt_identity.clone(),
        request_semantic_digest: legacy.request_semantic_digest.clone(),
        attempt_json_digest: attempt_json_digest(encoded)?,
        prepared_at_epoch_ms: legacy.prepared_at_epoch_ms,
        admission: legacy.request.admission.clone(),
    })
}

async fn verify_legacy_terminal_attempt(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    row: &sqlx::postgres::PgRow,
    _encoded: &serde_json::Value,
    legacy: &LegacyStoredAttemptV1,
    complete_projection_fields: bool,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Result<(), ArtifactBuildError> {
    if legacy.schema_version != 1
        || legacy.state != AttemptState::Terminal
        || legacy.request.build_request_identity != build_request_identity
        || legacy.request.attempt_identity != attempt_identity
        || legacy.request.build_request_identity
            != row
                .try_get::<String, _>("build_request_identity")
                .map_err(storage)?
        || legacy.request.attempt_identity
            != row
                .try_get::<String, _>("attempt_identity")
                .map_err(storage)?
        || legacy.request_semantic_digest
            != row
                .try_get::<String, _>("semantic_digest")
                .map_err(storage)?
        || i64::try_from(legacy.prepared_at_epoch_ms).map_err(json_storage)?
            != row
                .try_get::<i64, _>("prepared_at_epoch_ms")
                .map_err(storage)?
    {
        return Err(ArtifactBuildError::Storage(
            "noncanonical legacy terminal attempt custody".into(),
        ));
    }
    let semantic_bytes = serde_json::to_vec(&LegacyRequestMeaningV1 {
        build_request_identity: &legacy.request.build_request_identity,
        attempt_identity: &legacy.request.attempt_identity,
        intent_identity: &legacy.request.intent_identity,
        context: &legacy.request.context,
    })
    .map_err(json_storage)?;
    let expected_semantic_digest = format!("sha256:{:x}", sha2::Sha256::digest(semantic_bytes));
    if legacy.request_semantic_digest != expected_semantic_digest {
        return Err(ArtifactBuildError::Storage(
            "legacy attempt semantic digest mismatch".into(),
        ));
    }
    let receipt = legacy
        .receipt
        .as_ref()
        .ok_or_else(|| ArtifactBuildError::Storage("legacy terminal receipt missing".into()))?;
    let intent = legacy.intent.as_ref();
    if receipt.schema_version != 1
        || receipt.build_request_identity != legacy.request.build_request_identity
        || receipt.attempt_identity != legacy.request.attempt_identity
        || receipt.request_semantic_digest != legacy.request_semantic_digest
        || receipt.committed_at_epoch_ms < legacy.prepared_at_epoch_ms
        || receipt
            .intent_identity
            .as_deref()
            .is_some_and(|identity| identity != legacy.request.intent_identity)
        || receipt.intent_identity.is_some() != receipt.intent_semantic_digest.is_some()
        || (complete_projection_fields
            && receipt.intent_identity.as_deref()
                != intent.map(|value| value.intent_identity.as_str()))
        || (complete_projection_fields
            && receipt.intent_semantic_digest.as_deref()
                != intent.map(|value| value.semantic_digest.as_str()))
        || intent.is_some_and(|value| {
            value.schema_version != 1
                || value.intent_identity != legacy.request.intent_identity
                || value.request_identity.trim().is_empty()
                || value.semantic_digest.trim().is_empty()
        })
    {
        return Err(ArtifactBuildError::Storage(
            "legacy terminal receipt relation mismatch".into(),
        ));
    }

    let artifact_rows = sqlx::query("SELECT artifact_digest, intent_identity, attempt_identity, identity_json, build_receipt_json, artifact_review_json, committed_at_epoch_ms FROM rd_strategy_artifacts_v1 WHERE attempt_identity=$1 FOR SHARE")
        .bind(attempt_identity).fetch_all(&mut **transaction).await.map_err(storage)?;

    match receipt.disposition {
        ArtifactBuildDisposition::Success => {
            return Err(ArtifactBuildError::Storage(
                "legacy successful artifact lacks sealed build security evidence".into(),
            ));
        }
        ArtifactBuildDisposition::FailedNoArtifact
        | ArtifactBuildDisposition::RejectedNoWrite
        | ArtifactBuildDisposition::OutcomeUnknown => {
            let failure_code = receipt.failure_code.as_deref().ok_or_else(|| {
                ArtifactBuildError::Storage("legacy no-artifact failure code missing".into())
            })?;
            let expected_suffix = format!(
                "{:x}",
                sha2::Sha256::digest(
                    format!("{}:{failure_code}", legacy.request_semantic_digest).as_bytes()
                )
            );

            if receipt.receipt_identity != format!("rd-artifact-build-receipt-v1-{expected_suffix}")
                || receipt.artifact_identity.is_some()
                || receipt.build_receipt_identity.is_some()
                || legacy.artifact_review.is_some()
                || !artifact_rows.is_empty()
            {
                return Err(ArtifactBuildError::Storage(
                    "legacy no-artifact custody mismatch".into(),
                ));
            }
        }
    }
    Ok(())
}

fn drained_prepared_result(
    legacy: &AdmittedLegacyPreparedAttemptV1,
    receipt: &crate::legacy_prepared_attempt_drain::LegacyPreparedAttemptDrainReceiptV1,
) -> ArtifactBuildResultV1 {
    ArtifactBuildResultV1 {
        schema_version: 1,
        resolution: ArtifactBuildResolution::LegacyTerminalQuarantined,
        build_request_identity: legacy.request.build_request_identity.clone(),
        attempt_identity: legacy.request.attempt_identity.clone(),
        owner_receipt: None,
        legacy_prepared_attempt_drain: Some(LegacyPreparedAttemptDrainReadbackV1 {
            schema_version: 1,
            receipt_identity: receipt.receipt_identity.clone(),
            receipt_digest: receipt.receipt_digest.clone(),
            attempt_json_digest: receipt.attempt.attempt_json_digest.clone(),
            admission_digest: receipt.attempt.admission.admission_digest.clone(),
            disposition: crate::artifact_build::ArtifactBuildDisposition::OutcomeUnknown,
            provider_disposition: receipt.provider_disposition.clone(),
            target_database_resource_fingerprint: receipt
                .database_endpoint_resource_fingerprint
                .clone(),
            target_database_fingerprint: receipt.database_resource_fingerprint.clone(),
        }),
        research_view: None,
        artifact_review: None,
        artifact_review_actions: None,
        trial_family_resolution: None,
        artifact_trial_family: None,
        next_legal_action: ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
    }
}

fn legacy_terminal_result(legacy: LegacyStoredAttemptV1) -> ArtifactBuildResultV1 {
    ArtifactBuildResultV1 {
        schema_version: 1,
        resolution: ArtifactBuildResolution::LegacyTerminalQuarantined,
        build_request_identity: legacy.request.build_request_identity,
        attempt_identity: legacy.request.attempt_identity,
        owner_receipt: legacy.receipt,
        legacy_prepared_attempt_drain: None,
        research_view: None,
        artifact_review: None,
        artifact_review_actions: None,
        trial_family_resolution: Some(TrialFamilyResolutionV1::legacy_unavailable()),
        artifact_trial_family: None,
        next_legal_action: ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
    }
}

fn preparation_from_verified(
    custody: VerifiedAttemptCustodyV1,
    read_cut_epoch_ms: u64,
) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
    if custody.attempt.state == AttemptState::Terminal {
        let semantic_digest = custody.attempt.request_semantic_digest.clone();
        let intent_identity = custody
            .research
            .intent()
            .map(|intent| intent.intent_identity().to_string());
        let intent_semantic_digest = custody
            .research
            .intent()
            .map(|intent| intent.semantic_digest().to_string());
        let result = result_from_verified(custody, read_cut_epoch_ms)?;
        return Ok(ArtifactBuildPreparationV1 {
            schema_version: 1,
            resolution: result.resolution,
            build_request_identity: result.build_request_identity,
            attempt_identity: result.attempt_identity,
            semantic_digest,
            canonical_intent_bytes: None,
            intent_identity,
            intent_semantic_digest,
            owner_receipt: result.owner_receipt,
            next_legal_action: result.next_legal_action,
        });
    }
    let research_available = custody.research.authority_available_at(read_cut_epoch_ms);
    let intent = custody.research.intent().cloned();
    let attempt = custody.attempt;
    let (resolution, next) = if matches!(
        attempt.state,
        AttemptState::Prepared | AttemptState::Building
    ) && research_available
    {
        (
            ArtifactBuildResolution::Prepared,
            ArtifactBuildNextLegalAction::RunBoundedExecutionAgent,
        )
    } else {
        (
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        )
    };
    Ok(ArtifactBuildPreparationV1 {
        schema_version: 1,
        resolution,
        build_request_identity: attempt.request.build_request_identity.clone(),
        attempt_identity: attempt.request.attempt_identity.clone(),
        semantic_digest: attempt.request_semantic_digest,
        canonical_intent_bytes: intent
            .as_ref()
            .map(canonical_intent_bytes)
            .transpose()?
            .map(String::from_utf8)
            .transpose()
            .map_err(json_storage)?,
        intent_identity: intent
            .as_ref()
            .map(|intent| intent.intent_identity().to_string()),
        intent_semantic_digest: intent
            .as_ref()
            .map(|intent| intent.semantic_digest().to_string()),
        owner_receipt: None,
        next_legal_action: next,
    })
}

fn research_view_is_available(
    research: &VerifiedResearchCustodyV1,
    read_cut_epoch_ms: u64,
) -> bool {
    research.authority_available_at(read_cut_epoch_ms)
}

fn invocation_binding(
    claim: &ProductEdgeInvocationClaimReadbackV1,
    request: &ArtifactBuildRequestV1,
) -> Result<StoredInvocationClaimBindingV1, ArtifactBuildError> {
    if claim.request_identity() != request.build_request_identity
        || claim.admission_identity() != request.admission.admission_identity
        || claim.attempt_identity() != request.attempt_identity
        || claim.claim_identity().is_empty()
        || claim.claim_digest().is_empty()
        || claim.invocation_admission_receipt_identity().is_empty()
        || claim.invocation_admission_receipt_digest().is_empty()
    {
        return Err(ArtifactBuildError::Unauthorized(
            "provider invocation claim unavailable",
        ));
    }
    Ok(StoredInvocationClaimBindingV1 {
        request_identity: claim.request_identity().to_string(),
        admission_identity: claim.admission_identity().to_string(),
        attempt_identity: claim.attempt_identity().to_string(),
        claim_identity: claim.claim_identity().to_string(),
        claim_digest: claim.claim_digest().to_string(),
        invocation_admission_receipt_identity: claim
            .invocation_admission_receipt_identity()
            .to_string(),
        invocation_admission_receipt_digest: claim
            .invocation_admission_receipt_digest()
            .to_string(),
        claimed_state_digest: claim.state_digest().to_string(),
        execution_custody_digest: String::new(),
        reservation_identity: String::new(),
        reservation_digest: String::new(),
        reserved_at_epoch_ms: 0,
    })
}

fn verify_claimed_invocation(
    claim: &ProductEdgeInvocationClaimReadbackV1,
    request: &ArtifactBuildRequestV1,
) -> Result<StoredInvocationClaimBindingV1, ArtifactBuildError> {
    if claim.state() != ProductEdgeInvocationStateV1::Claimed {
        return Err(ArtifactBuildError::Unauthorized(
            "claimed provider invocation unavailable",
        ));
    }
    invocation_binding(claim, request)
}

fn verify_started_invocation(
    claim: &ProductEdgeInvocationClaimReadbackV1,
    request: &ArtifactBuildRequestV1,
) -> Result<StoredInvocationClaimBindingV1, ArtifactBuildError> {
    if claim.state() != ProductEdgeInvocationStateV1::InvocationStarted {
        return Err(ArtifactBuildError::Unauthorized(
            "started provider invocation unavailable",
        ));
    }
    invocation_binding(claim, request)
}

fn same_invocation_claim(
    expected: &StoredInvocationClaimBindingV1,
    actual: &StoredInvocationClaimBindingV1,
) -> bool {
    expected.claim_identity == actual.claim_identity
        && expected.request_identity == actual.request_identity
        && expected.admission_identity == actual.admission_identity
        && expected.attempt_identity == actual.attempt_identity
        && expected.claim_digest == actual.claim_digest
        && expected.invocation_admission_receipt_identity
            == actual.invocation_admission_receipt_identity
        && expected.invocation_admission_receipt_digest
            == actual.invocation_admission_receipt_digest
}

fn seal_invocation_execution_snapshot(
    custody: &VerifiedAttemptCustodyV1,
    claim: &StoredInvocationClaimBindingV1,
    request_semantic_digest: String,
    reserved_at_epoch_ms: u64,
) -> Result<StoredArtifactBuildInvocationSnapshotV1, ArtifactBuildError> {
    let intent = custody
        .research
        .intent()
        .ok_or_else(|| ArtifactBuildError::Storage("reservation intent missing".to_string()))?;
    let family = custody
        .research
        .family()
        .ok_or_else(|| ArtifactBuildError::Storage("reservation family missing".to_string()))?;
    let research_valid_through_epoch_ms = custody
        .research
        .view()
        .ok_or_else(|| {
            ArtifactBuildError::Storage("reservation research view missing".to_string())
        })?
        .valid_through_epoch_ms;

    if reserved_at_epoch_ms >= research_valid_through_epoch_ms {
        return Err(ArtifactBuildError::Unauthorized(
            "current research unavailable at invocation reservation",
        ));
    }
    let canonical_intent_bytes = String::from_utf8(canonical_intent_bytes(intent)?)
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
    StoredArtifactBuildInvocationSnapshotV1 {
        schema_version: 1,
        request: custody.attempt.request.clone(),
        request_semantic_digest,
        canonical_intent_bytes,
        intent_semantic_digest: intent.semantic_digest().to_string(),
        research_request_identity: custody.research.receipt().request_identity.clone(),
        research_valid_through_epoch_ms,
        trial_family_identity: family.root().trial_family_identity().to_string(),
        trial_family_root_digest: family.root().root_digest().to_string(),
        census_frontier_identity: family.census_frontier().frontier_identity().to_string(),
        census_frontier_digest: family.census_frontier().frontier_digest().to_string(),
        claim_identity: claim.claim_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        invocation_admission_receipt_identity: claim.invocation_admission_receipt_identity.clone(),
        invocation_admission_receipt_digest: claim.invocation_admission_receipt_digest.clone(),
        claimed_state_digest: claim.claimed_state_digest.clone(),
        reserved_at_epoch_ms,
        custody_digest: String::new(),
    }
    .seal()
}

fn execution_custody_from_snapshot(
    attempt: &StoredAttemptV1,
) -> Result<ArtifactBuildInvocationCustodyV1, ArtifactBuildError> {
    if attempt.state != AttemptState::InvocationReserved
        || attempt.receipt.is_some()
        || attempt.candidate_digest.is_some()
        || attempt.candidate.is_some()
    {
        return Err(ArtifactBuildError::Storage(
            "reserved invocation attempt state mismatch".to_string(),
        ));
    }
    let reservation = attempt
        .invocation_claim
        .as_ref()
        .ok_or_else(|| ArtifactBuildError::Storage("reservation binding missing".to_string()))?;
    let snapshot = attempt.invocation_custody.as_ref().ok_or_else(|| {
        ArtifactBuildError::Storage("invocation execution custody missing".to_string())
    })?;
    snapshot.verify_digest()?;
    let request_semantic_digest = build_request_semantic_digest(&snapshot.request)?;
    let complete = snapshot.request == attempt.request
        && snapshot.request_semantic_digest == attempt.request_semantic_digest
        && snapshot.request_semantic_digest == request_semantic_digest
        && snapshot.claim_identity == reservation.claim_identity
        && snapshot.claim_digest == reservation.claim_digest
        && snapshot.invocation_admission_receipt_identity
            == reservation.invocation_admission_receipt_identity
        && snapshot.invocation_admission_receipt_digest
            == reservation.invocation_admission_receipt_digest
        && snapshot.claimed_state_digest == reservation.claimed_state_digest
        && snapshot.reserved_at_epoch_ms == reservation.reserved_at_epoch_ms
        && snapshot.custody_digest == reservation.execution_custody_digest
        && reservation.is_complete()
        && reservation.matches_request(&attempt.request)
        && snapshot.research_valid_through_epoch_ms > snapshot.reserved_at_epoch_ms
        && [
            snapshot.canonical_intent_bytes.as_str(),
            snapshot.intent_semantic_digest.as_str(),
            snapshot.research_request_identity.as_str(),
            snapshot.trial_family_identity.as_str(),
            snapshot.trial_family_root_digest.as_str(),
            snapshot.census_frontier_identity.as_str(),
            snapshot.census_frontier_digest.as_str(),
        ]
        .into_iter()
        .all(|value| !value.trim().is_empty());

    if !complete {
        return Err(ArtifactBuildError::Storage(
            "invocation execution custody mismatch".to_string(),
        ));
    }
    Ok(ArtifactBuildInvocationCustodyV1 {
        schema_version: snapshot.schema_version,
        request: snapshot.request.clone(),
        request_semantic_digest: snapshot.request_semantic_digest.clone(),
        canonical_intent_bytes: snapshot.canonical_intent_bytes.clone(),
        intent_semantic_digest: snapshot.intent_semantic_digest.clone(),
        research_request_identity: snapshot.research_request_identity.clone(),
        research_valid_through_epoch_ms: snapshot.research_valid_through_epoch_ms,
        trial_family_identity: snapshot.trial_family_identity.clone(),
        trial_family_root_digest: snapshot.trial_family_root_digest.clone(),
        census_frontier_identity: snapshot.census_frontier_identity.clone(),
        census_frontier_digest: snapshot.census_frontier_digest.clone(),
        claim_identity: snapshot.claim_identity.clone(),
        claim_digest: snapshot.claim_digest.clone(),
        invocation_admission_receipt_identity: snapshot
            .invocation_admission_receipt_identity
            .clone(),
        invocation_admission_receipt_digest: snapshot.invocation_admission_receipt_digest.clone(),
        claimed_state_digest: snapshot.claimed_state_digest.clone(),
        execution_custody_digest: snapshot.custody_digest.clone(),
        reservation_identity: reservation.reservation_identity.clone(),
        reservation_digest: reservation.reservation_digest.clone(),
        reserved_at_epoch_ms: snapshot.reserved_at_epoch_ms,
    })
}

fn unavailable_preparation(
    request: &ArtifactBuildRequestV1,
    semantic_digest: String,
) -> ArtifactBuildPreparationV1 {
    ArtifactBuildPreparationV1 {
        schema_version: 1,
        resolution: ArtifactBuildResolution::SubmittedOrUnknown,
        build_request_identity: request.build_request_identity.clone(),
        attempt_identity: request.attempt_identity.clone(),
        semantic_digest,
        canonical_intent_bytes: None,
        intent_identity: None,
        intent_semantic_digest: None,
        owner_receipt: None,
        next_legal_action: ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
    }
}

fn result_from_verified(
    custody: VerifiedAttemptCustodyV1,
    read_cut_epoch_ms: u64,
) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
    let is_v2 = custody
        .research
        .intent()
        .is_some_and(FrozenResearchGoalIntent::is_v2);
    let research_view = custody
        .research
        .view()
        .map(|view| crate::product_edge::project_research_view_at(view, read_cut_epoch_ms));
    let research_available = custody.research.authority_available_at(read_cut_epoch_ms);
    let artifact_review = custody.artifact_review;
    let attempt = custody.attempt;
    let (resolution, next) = match attempt.receipt.as_ref().map(|receipt| receipt.disposition) {
        Some(ArtifactBuildDisposition::Success) => (
            ArtifactBuildResolution::Success,
            ArtifactBuildNextLegalAction::ReviewArtifact,
        ),
        Some(ArtifactBuildDisposition::FailedNoArtifact) => (
            ArtifactBuildResolution::FailedNoArtifact,
            ArtifactBuildNextLegalAction::CreateSuccessorBuildRequest,
        ),
        Some(ArtifactBuildDisposition::RejectedNoWrite) => (
            ArtifactBuildResolution::RejectedNoWrite,
            ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
        Some(ArtifactBuildDisposition::OutcomeUnknown) => (
            ArtifactBuildResolution::OutcomeUnknown,
            ArtifactBuildNextLegalAction::CreateSuccessorBuildRequest,
        ),
        None => (
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
    };
    let artifact_review_actions = research_available
        .then(|| {
            artifact_review
                .as_ref()
                .map(|review| artifact_review_action_projection(&review.allowed_next_actions))
        })
        .flatten();
    let is_v2_success = attempt
        .receipt
        .as_ref()
        .is_some_and(|receipt| receipt.disposition == ArtifactBuildDisposition::Success)
        && is_v2;

    if is_v2_success && custody.artifact_family.is_none() {
        return Err(ArtifactBuildError::Storage(
            "verified V2 artifact family missing".to_string(),
        ));
    }
    Ok(ArtifactBuildResultV1 {
        schema_version: 1,
        resolution,
        build_request_identity: attempt.request.build_request_identity.clone(),
        attempt_identity: attempt.request.attempt_identity.clone(),
        owner_receipt: attempt.receipt,
        legacy_prepared_attempt_drain: None,
        research_view,
        artifact_review,
        artifact_review_actions,
        trial_family_resolution: is_v2_success.then(TrialFamilyResolutionV1::available),
        artifact_trial_family: custody.artifact_family,
        next_legal_action: if research_available {
            next
        } else {
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity
        },
    })
}

fn unknown_result(build_request_identity: &str, attempt_identity: &str) -> ArtifactBuildResultV1 {
    ArtifactBuildResultV1 {
        schema_version: 1,
        resolution: ArtifactBuildResolution::SubmittedOrUnknown,
        build_request_identity: build_request_identity.to_string(),
        attempt_identity: attempt_identity.to_string(),
        owner_receipt: None,
        legacy_prepared_attempt_drain: None,
        research_view: None,
        artifact_review: None,
        artifact_review_actions: None,
        trial_family_resolution: None,
        artifact_trial_family: None,
        next_legal_action: ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
    }
}

async fn lock(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    identity: &str,
) -> Result<(), ArtifactBuildError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn lock_request_attempt(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &ArtifactBuildRequestV1,
) -> Result<(), ArtifactBuildError> {
    let mut identities = [
        format!("artifact-build-attempt:{}", request.attempt_identity),
        format!("artifact-build-request:{}", request.build_request_identity),
    ];
    identities.sort();

    for identity in identities {
        lock(transaction, &identity).await?;
    }
    Ok(())
}

async fn persist_attempt(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    expected: &StoredAttemptV1,
    replacement: &StoredAttemptV1,
) -> Result<(), ArtifactBuildError> {
    let updated = sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = $1 WHERE build_request_identity = $2 AND attempt_identity = $3 AND semantic_digest = $4 AND prepared_at_epoch_ms = $5 AND attempt_json = $6")
        .bind(encode(replacement)?)
        .bind(&expected.request.build_request_identity)
        .bind(&expected.request.attempt_identity)
        .bind(&expected.request_semantic_digest)
        .bind(i64::try_from(expected.prepared_at_epoch_ms).map_err(json_storage)?)
        .bind(encode(expected)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if updated.rows_affected() != 1 {
        return Err(ArtifactBuildError::Storage(
            "attempt custody update mismatch".to_string(),
        ));
    }
    Ok(())
}

fn encode(value: &impl Serialize) -> Result<serde_json::Value, ArtifactBuildError> {
    serde_json::to_value(value).map_err(json_storage)
}

fn current_epoch_ms() -> Result<u64, ArtifactBuildError> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(json_storage)?;
    u64::try_from(duration.as_millis()).map_err(json_storage)
}

fn storage(error: impl Display) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}

fn json_storage(error: impl Display) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}

/// Explicit Owner-admin operation for sealing an exact, immutable set of
/// admitted legacy PREPARED attempts. It never modifies attempt rows or invokes
/// a provider.
pub async fn drain_legacy_prepared_attempts_v1(
    database_url: &str,
    expected_target_database_resource_fingerprint: &str,
    expected_target_database_fingerprint: &str,
    expected_target_count: u32,
    expected_target_set_digest: &str,
    fail_after_receipt_count: Option<u32>,
) -> Result<LegacyPreparedAttemptDrainSummaryV1, ArtifactBuildError> {
    if database_url.trim().is_empty()
        || !is_sha256_digest(expected_target_database_resource_fingerprint)
        || !is_sha256_digest(expected_target_database_fingerprint)
        || expected_target_count == 0
    {
        return Err(ArtifactBuildError::Storage(
            "legacy PREPARED drain requires an explicit database fingerprint and nonzero target count"
                .into(),
        ));
    }
    let target_database_resource_fingerprint =
        crate::legacy_prepared_attempt_drain::database_endpoint_resource_fingerprint(database_url)?;

    if target_database_resource_fingerprint != expected_target_database_resource_fingerprint {
        return Err(ArtifactBuildError::Storage(
            "legacy PREPARED drain target database resource mismatch".into(),
        ));
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .map_err(storage)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    crate::legacy_prepared_attempt_drain::lock_product_edge_effects_for_drain_in_transaction(
        &mut transaction,
    )
    .await?;
    let target_database_identity =
        crate::legacy_prepared_attempt_drain::current_database_identity(&mut transaction).await?;
    let target_database_fingerprint =
        crate::legacy_prepared_attempt_drain::database_fingerprint(&target_database_identity)?;

    if target_database_fingerprint != expected_target_database_fingerprint {
        return Err(ArtifactBuildError::Storage(
            "legacy PREPARED drain target database mismatch".into(),
        ));
    }
    validate_legacy_drain_family_in_transaction(&mut transaction).await?;

    for statement in [
        "LOCK TABLE rd_artifact_build_attempts_v1 IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE rd_strategy_artifacts_v1 IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE rd_legacy_prepared_attempt_drain_receipts_v1 IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE rd_owner_outbox_v1 IN SHARE ROW EXCLUSIVE MODE",
    ] {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
    }
    let rows = sqlx::query("SELECT build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 ORDER BY build_request_identity,attempt_identity FOR SHARE")
        .fetch_all(&mut *transaction).await.map_err(storage)?;
    let mut targets = Vec::new();

    for row in rows {
        let value: serde_json::Value = row.try_get("attempt_json").map_err(storage)?;
        if let Ok(candidate) = decode_admitted_legacy_prepared(&value) {
            targets.push(verify_admitted_legacy_prepared_binding(
                &row, &value, &candidate,
            )?);
            continue;
        }

        if serde_json::from_value::<StoredAttemptV1>(value.clone())
            .ok()
            .is_some_and(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(&value))
        {
            continue;
        }
        let (legacy, _) = decode_legacy_attempt(&value)?;
        if legacy.schema_version != 1 || legacy.state != AttemptState::Terminal {
            return Err(ArtifactBuildError::Storage(
                "unknown or undrainable legacy attempt blocks drain".into(),
            ));
        }
    }
    targets.sort_by(|left, right| {
        (&left.build_request_identity, &left.attempt_identity)
            .cmp(&(&right.build_request_identity, &right.attempt_identity))
    });
    let target_set_digest = legacy_drain_target_set_digest(&targets)?;
    if targets.len() != usize::try_from(expected_target_count).map_err(json_storage)?
        || target_set_digest != expected_target_set_digest
    {
        return Err(ArtifactBuildError::Storage(
            "legacy PREPARED drain target set mismatch".into(),
        ));
    }
    let existing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1 WHERE attempt_identity=ANY($1)",
    )
    .bind(targets.iter().map(|target| target.attempt_identity.as_str()).collect::<Vec<_>>())
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)?;

    if existing_count != 0 && existing_count != i64::from(expected_target_count) {
        return Err(ArtifactBuildError::Storage(
            "partial legacy PREPARED drain set is forbidden".into(),
        ));
    }
    let committed_at_epoch_ms = current_epoch_ms()?;
    let mut receipts = Vec::with_capacity(targets.len());
    if existing_count == 0 {
        for (index, target) in targets.iter().enumerate() {
            let (database, absence) =
                verify_live_predicates_in_transaction(&mut transaction, target).await?;

            if database != target_database_identity {
                return Err(ArtifactBuildError::Storage(
                    "legacy PREPARED drain target database changed".into(),
                ));
            }
            let receipt = form_receipt(
                target.clone(),
                absence,
                target_database_identity.clone(),
                target_database_resource_fingerprint.clone(),
                target_database_fingerprint.clone(),
                committed_at_epoch_ms,
            )?;
            append_receipt_and_outbox_in_transaction(&mut transaction, &receipt).await?;
            receipts.push(receipt);

            if fail_after_receipt_count == Some(u32::try_from(index + 1).map_err(json_storage)?) {
                return Err(ArtifactBuildError::Storage(
                    "injected legacy PREPARED drain rollback".into(),
                ));
            }
        }
    } else {
        for target in &targets {
            let receipt = verify_drain_in_transaction(
                &mut transaction,
                target,
                &target_database_resource_fingerprint,
            )
            .await?;
            receipts.push(receipt);
        }
    }
    transaction.commit().await.map_err(storage)?;
    Ok(LegacyPreparedAttemptDrainSummaryV1 {
        schema_version: 1,
        target_count: expected_target_count,
        target_set_digest,
        receipt_identities: receipts
            .iter()
            .map(|value| value.receipt_identity.clone())
            .collect(),
        receipt_digests: receipts
            .iter()
            .map(|value| value.receipt_digest.clone())
            .collect(),
    })
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn legacy_drain_target_set_digest(
    targets: &[LegacyPreparedAttemptBindingV1],
) -> Result<String, ArtifactBuildError> {
    let mut digest = sha2::Sha256::new();
    digest.update(b"rd.legacy-prepared-attempt-drain-target-set.v1\0");
    digest.update(serde_json::to_vec(targets).map_err(json_storage)?);
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn trial_family_storage(error: &TrialFamilyError) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}

#[cfg(test)]
mod admitted_legacy_prepared_tests {
    use super::*;
    use rstest::rstest;

    fn fixture(channel: &str) -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "request": {
                "build_request_identity": "build-1",
                "attempt_identity": "attempt-1",
                "intent_identity": "intent-1",
                "channel": channel,
                "admission": {
                    "request_identity": "build-1",
                    "admission_identity": "admission-1",
                    "admission_digest": format!("sha256:{}", "a".repeat(64))
                }
            },
            "request_semantic_digest": format!("sha256:{}", "b".repeat(64)),
            "state": "PREPARED",
            "candidate_digest": null,
            "candidate": null,
            "prepared_at_epoch_ms": 1,
            "receipt": null
        })
    }

    #[rstest]
    fn exact_real_app_and_mcp_prepared_shapes_are_uniquely_admitted() {
        for channel in ["APP", "MCP"] {
            let value = fixture(channel);
            let decoded = decode_admitted_legacy_prepared(&value).unwrap();
            assert_eq!(serde_json::to_value(decoded).unwrap(), value);
            assert!(decode_legacy_attempt(&value).is_err());
        }
    }

    #[rstest]
    fn unknown_admitted_prepared_request_key_or_channel_fails_closed() {
        let mut unknown_key = fixture("APP");
        unknown_key["request"]["context"] = serde_json::json!({});
        assert!(decode_admitted_legacy_prepared(&unknown_key).is_err());
        let unknown_channel = fixture("WINDMILL_PRODUCT_EDGE");
        assert!(decode_admitted_legacy_prepared(&unknown_channel).is_err());
    }

    #[rstest]
    fn drained_wire_is_quarantined_and_normal_wire_omits_drain_readback() {
        let prepared = decode_admitted_legacy_prepared(&fixture("APP")).unwrap();
        let receipt = crate::legacy_prepared_attempt_drain::tests::fixture_receipt();
        let drained = drained_prepared_result(&prepared, &receipt);
        let encoded = serde_json::to_value(&drained).unwrap();
        assert_eq!(encoded["resolution"], "LEGACY_TERMINAL_QUARANTINED");
        assert!(encoded["owner_receipt"].is_null());
        assert_eq!(
            encoded["legacy_prepared_attempt_drain"]["disposition"],
            "OUTCOME_UNKNOWN"
        );
        assert_eq!(
            encoded["legacy_prepared_attempt_drain"]["provider_disposition"],
            "PROVIDER_NEVER_STARTED"
        );
        assert_eq!(
            encoded["legacy_prepared_attempt_drain"]["target_database_resource_fingerprint"],
            receipt.database_endpoint_resource_fingerprint
        );
        assert_eq!(
            encoded["legacy_prepared_attempt_drain"]["target_database_fingerprint"],
            receipt.database_resource_fingerprint
        );
        assert!(encoded["research_view"].is_null());
        assert!(encoded["artifact_review"].is_null());
        assert!(encoded["trial_family_resolution"].is_null());

        let normal = serde_json::to_value(ArtifactBuildResultV1::submitted_or_unknown(
            "build-1",
            "attempt-1",
        ))
        .unwrap();
        assert!(normal.get("legacy_prepared_attempt_drain").is_none());
    }
}

#[cfg(test)]
mod postgres_freshness_tests {
    use super::*;
    use crate::{
        artifact_build::{
            ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ARTIFACT_BUILD_SCOPE_V1,
            ArtifactBuildOwnerPort, GeneratedDirectionV1, GeneratedSignalV1,
            GeneratedStrategyLogicV1, SandboxBuildProductV1, SandboxBuildRequestV1,
            candidate_digest, canonical_sandbox_source_capsule,
        },
        cargo_artifact::{
            RD_SANDBOX_DOCKERFILE, RUSTC_COMMIT, RUSTC_RELEASE, SANDBOX_POLICY_V1, TARGET,
        },
        family_adapters::verified_price_build,
        product_edge::{
            ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
            RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1,
            ResearchGoalOwnerPortV2, ResearchSourceV1,
        },
        product_edge_postgres::{
            PostgresResearchGoalOwnerV1, reseal_current_research_artifact_evidence_for_test,
        },
    };
    use rstest::rstest;
    use sha2::{Digest, Sha256};
    use std::{
        collections::VecDeque,
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };
    use vibe_operator_authorization::{
        OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
        OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
    };
    use vibe_product_edge::{
        AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1,
        ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
        ProductEdgeInvocationClaimRequestV1, ProductEdgePostgresOwnerV1,
    };
    use vibe_testkit::postgres::{
        CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1,
        DedicatedPostgresTestDatabase, DedicatedPostgresTestMutation,
    };

    async fn legacy_drain_family_snapshot(pool: &PgPool) -> serde_json::Value {
        sqlx::query_scalar(
            "SELECT pg_catalog.jsonb_build_object(
               'table_oid',relation.oid,
               'table_acl',relation.relacl::text,
               'function_oid',function.oid,
               'function_acl',function.proacl::text,
               'function_definition',pg_catalog.pg_get_functiondef(function.oid),
               'trigger_oid',trigger_fact.oid,
               'trigger_definition',pg_catalog.pg_get_triggerdef(trigger_fact.oid,false)
             )
             FROM pg_catalog.pg_class relation
             JOIN pg_catalog.pg_namespace relation_namespace ON relation_namespace.oid=relation.relnamespace
             JOIN pg_catalog.pg_proc function ON function.proname='rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1'
             JOIN pg_catalog.pg_namespace function_namespace ON function_namespace.oid=function.pronamespace
             JOIN pg_catalog.pg_trigger trigger_fact ON trigger_fact.tgrelid=relation.oid AND trigger_fact.tgfoid=function.oid
            WHERE relation_namespace.nspname='public'
              AND relation.relname='rd_legacy_prepared_attempt_drain_receipts_v1'
              AND function_namespace.nspname='public'
              AND trigger_fact.tgname='rd_legacy_prepared_attempt_drain_immutable_v1'
              AND NOT trigger_fact.tgisinternal",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires an explicitly supplied read-only attempt-custody database URL"]
    async fn stored_attempt_catalog_is_exactly_classifiable_without_writes() {
        let database_url = std::env::var("RD_OWNER_CLASSIFICATION_DATABASE_URL")
            .expect("RD_OWNER_CLASSIFICATION_DATABASE_URL must be explicitly supplied");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> =
            sqlx::query_scalar("SELECT attempt_json FROM rd_artifact_build_attempts_v1")
                .fetch_all(&pool)
                .await
                .unwrap();

        assert!(
            !rows.is_empty(),
            "attempt custody catalog must not be empty"
        );

        for value in rows {
            let current = serde_json::from_value::<StoredAttemptV1>(value.clone())
                .ok()
                .is_some_and(|decoded| serde_json::to_value(decoded).ok().as_ref() == Some(&value));
            if !current && let Err(e) = decode_legacy_attempt(&value) {
                let keys = value
                    .as_object()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>();
                let digest = format!(
                    "sha256:{:x}",
                    Sha256::digest(serde_json::to_vec(&value).unwrap())
                );
                let complete = serde_json::from_value::<LegacyStoredAttemptV1>(value.clone())
                    .map(|decoded| serde_json::to_value(decoded).unwrap() == value)
                    .map_err(|failure| failure.to_string());
                let sparse = serde_json::from_value::<SparseLegacyStoredAttemptV1>(value.clone())
                    .map(|decoded| serde_json::to_value(decoded).unwrap() == value)
                    .map_err(|failure| failure.to_string());
                let family = serde_json::from_value::<FamilyLegacyStoredAttemptV1>(value.clone())
                    .map(|decoded| serde_json::to_value(decoded).unwrap() == value)
                    .map_err(|failure| failure.to_string());
                panic!(
                    "{e}; digest={digest}; keys={keys:?}; complete={complete:?}; sparse={sparse:?}; family={family:?}"
                );
            }
        }
    }

    #[tokio::test]
    #[ignore = "requires admitted OA/PE/R&D test database URLs"]
    async fn exact_origin_terminal_legacy_is_read_only_and_nonterminal_blocks_activation() {
        let test_database = test_database().await;
        let _mutation = test_database.mutation();
        let database_url = test_database.database_url().to_string();
        let owner = PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();
        let suffix = unique_suffix();
        let build_request_identity = format!("artifact-build-request-legacy-{suffix}");
        let attempt_identity = format!("artifact-build-attempt-legacy-{suffix}");
        let request = LegacyArtifactBuildRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity: format!("rd-research-intent-v1-legacy-{suffix}"),
            channel: LegacyProductEdgeChannelV1::App,
            context: serde_json::json!({
                "schema_version": 1,
                "trusted_principal": "legacy-principal",
                "authorized_scope": ["research:artifact-build"],
                "authorization_policy_cut": "legacy-policy-cut"
            }),
        };
        let semantic_digest = format!(
            "sha256:{:x}",
            Sha256::digest(
                serde_json::to_vec(&LegacyRequestMeaningV1 {
                    build_request_identity: &request.build_request_identity,
                    attempt_identity: &request.attempt_identity,
                    intent_identity: &request.intent_identity,
                    context: &request.context,
                })
                .unwrap()
            )
        );
        let failure_code = "INTENT_NOT_ELIGIBLE";
        let receipt_identity = format!(
            "rd-artifact-build-receipt-v1-{:x}",
            Sha256::digest(format!("{semantic_digest}:{failure_code}").as_bytes())
        );
        let committed_at = current_epoch_ms().unwrap();
        let legacy = LegacyStoredAttemptV1 {
            schema_version: 1,
            request,
            request_semantic_digest: semantic_digest.clone(),
            intent: None,
            state: AttemptState::Terminal,
            candidate_digest: None,
            candidate: None,
            prepared_at_epoch_ms: committed_at,
            receipt: Some(ArtifactBuildReceiptV1 {
                schema_version: 1,
                receipt_identity: receipt_identity.clone(),
                build_request_identity: build_request_identity.clone(),
                attempt_identity: attempt_identity.clone(),
                request_semantic_digest: semantic_digest.clone(),
                intent_identity: None,
                intent_semantic_digest: None,
                disposition: ArtifactBuildDisposition::RejectedNoWrite,
                artifact_identity: None,
                build_receipt_identity: None,
                failure_code: Some(failure_code.to_string()),
                committed_at_epoch_ms: committed_at,
            }),
            research_view: None,
            artifact_review: None,
        };
        sqlx::query("INSERT INTO rd_artifact_build_attempts_v1 (build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(&build_request_identity).bind(&attempt_identity).bind(&semantic_digest)
            .bind(serde_json::to_value(&legacy).unwrap()).bind(i64::try_from(committed_at).unwrap())
            .execute(&owner.pool).await.unwrap();

        assert_eq!(
            owner
                .preflight_request_identity(&build_request_identity, &attempt_identity)
                .await
                .unwrap(),
            ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined
        );
        let result = owner
            .resolve_legacy_terminal_quarantined(&build_request_identity, &attempt_identity)
            .await
            .unwrap();
        assert_eq!(
            result.resolution(),
            ArtifactBuildResolution::LegacyTerminalQuarantined
        );
        assert_eq!(
            result.owner_receipt().unwrap().receipt_identity,
            receipt_identity
        );
        assert!(result.research_view().is_none());
        assert!(result.artifact_review().is_none());

        let terminal_json = serde_json::to_value(&legacy).unwrap();
        let mut nonterminal = legacy;
        nonterminal.state = AttemptState::Prepared;
        sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2")
            .bind(serde_json::to_value(&nonterminal).unwrap()).bind(&build_request_identity)
            .execute(&owner.pool).await.unwrap();
        assert!(matches!(
            PostgresArtifactBuildOwnerV1::connect(
                &database_url,
                "/tmp/unused-rd-sandbox.sock",
                u64::MAX,
            )
            .await,
            Err(ArtifactBuildError::Storage(message))
                if message.contains("undrained legacy nonterminal")
        ));
        sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2")
            .bind(terminal_json).bind(&build_request_identity)
            .execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner
                .resolve_legacy_terminal_quarantined(&build_request_identity, &attempt_identity)
                .await
                .unwrap(),
            result
        );
    }

    #[tokio::test]
    #[ignore = "requires admitted OA/PE/R&D test database URLs"]
    async fn legacy_prepared_drain_is_atomic_idempotent_and_read_only() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
        let _ = mutation;
        let database_url = test_database
            .database_url(CanonicalOwnerTestRoleV1::RdOwner)
            .to_string();
        let product_edge_pool =
            PgPool::connect(test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner))
                .await
                .unwrap();
        let owner = PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();
        let materialized_drain_family = legacy_drain_family_snapshot(&owner.pool).await;
        let suffix = unique_suffix();
        let research_identity = format!("legacy-drain-research-{suffix}");
        let (edge, research_admission) = bootstrap_authority(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &research_identity,
            &suffix,
        )
        .await;
        let research_owner = PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap();
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        {
            let catalog_admin_pool =
                mutation.pool(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter);
            crate::replay_policy_catalog_postgres_v2::ensure_authenticated_sealed_acceptance_fixture_v1(
                catalog_admin_pool,
            )
            .await
            .unwrap();
        }
        let research_result = research_owner
            .submit_v2(research_request(&research_identity, research_admission))
            .await
            .unwrap();
        let intent_identity = research_result
            .owner_receipt()
            .unwrap_or_else(|| {
                panic!("legacy drain research submission unresolved: {research_result:#?}")
            })
            .resulting_research_intent_identity
            .as_deref()
            .unwrap()
            .to_string();
        let mut target_bindings = Vec::new();
        let mut identities = Vec::new();

        for (ordinal, channel) in [(1, "APP"), (2, "MCP")] {
            let build = format!("legacy-drain-build-{ordinal}-{suffix}");
            let attempt = format!("legacy-drain-attempt-{ordinal}-{suffix}");
            let intent = intent_identity.clone();
            let admission = edge
                .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                    request_identity: build.clone(),
                    typed_payload: serde_json::json!({
                        "build_request_identity": build,
                        "attempt_identity": attempt,
                        "intent_identity": intent,
                        "channel": "WINDMILL_PRODUCT_EDGE",
                    }),
                    operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                    operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                    target_owner: RESEARCH_OWNER_V1.to_string(),
                    requested_effects: vibe_product_edge::ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
                        .iter()
                        .map(|effect| (*effect).to_string())
                        .collect(),
                    request_proof_digest: "sha256:test-proof".to_string(),
                    audit_correlation: format!("test:{build}"),
                })
                .await
                .unwrap()
                .locator()
                .clone();
            let semantic = format!(
                "sha256:{:x}",
                Sha256::digest(format!("{build}:{attempt}").as_bytes())
            );
            let value = serde_json::json!({
                "schema_version": 1,
                "request": {
                    "build_request_identity": build,
                    "attempt_identity": attempt,
                    "intent_identity": intent,
                    "channel": channel,
                    "admission": admission,
                },
                "request_semantic_digest": semantic,
                "state": "PREPARED",
                "candidate_digest": null,
                "candidate": null,
                "prepared_at_epoch_ms": 1,
                "receipt": null,
            });
            sqlx::query("INSERT INTO rd_artifact_build_attempts_v1(build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms) VALUES($1,$2,$3,$4,1)")
                .bind(&build).bind(&attempt).bind(&semantic).bind(&value)
                .execute(&owner.pool).await.unwrap();
            let row = sqlx::query("SELECT build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1")
                .bind(&build).fetch_one(&owner.pool).await.unwrap();
            let decoded = decode_admitted_legacy_prepared(&value).unwrap();
            target_bindings
                .push(verify_admitted_legacy_prepared_binding(&row, &value, &decoded).unwrap());
            identities.push((build, attempt));
        }
        target_bindings.sort_by(|left, right| {
            left.build_request_identity
                .cmp(&right.build_request_identity)
        });
        let target_digest = legacy_drain_target_set_digest(&target_bindings).unwrap();
        let target_database_resource_fingerprint =
            crate::legacy_prepared_attempt_drain::database_endpoint_resource_fingerprint(
                &database_url,
            )
            .unwrap();
        let mut transaction = owner.pool.begin().await.unwrap();
        let target_database_identity =
            crate::legacy_prepared_attempt_drain::current_database_identity(&mut transaction)
                .await
                .unwrap();
        transaction.rollback().await.unwrap();
        let target_database_fingerprint =
            crate::legacy_prepared_attempt_drain::database_fingerprint(&target_database_identity)
                .unwrap();
        let mut clone_database_identity = target_database_identity.clone();
        clone_database_identity.database_name.push_str("-clone");
        clone_database_identity.database_oid =
            clone_database_identity.database_oid.checked_add(1).unwrap();
        let clone_database_fingerprint =
            crate::legacy_prepared_attempt_drain::database_fingerprint(&clone_database_identity)
                .unwrap();
        let alias_database_url = std::env::var("RD_OWNER_DRAIN_ALIAS_TEST_DATABASE_URL").unwrap();
        let alias_database_resource_fingerprint =
            crate::legacy_prepared_attempt_drain::database_endpoint_resource_fingerprint(
                &alias_database_url,
            )
            .unwrap();
        assert_ne!(
            target_database_resource_fingerprint,
            alias_database_resource_fingerprint
        );
        let alias_pool = PgPool::connect(&alias_database_url).await.unwrap();
        let mut alias_transaction = alias_pool.begin().await.unwrap();
        let alias_database_identity =
            crate::legacy_prepared_attempt_drain::current_database_identity(&mut alias_transaction)
                .await
                .unwrap();
        alias_transaction.rollback().await.unwrap();
        assert_eq!(target_database_identity, alias_database_identity);
        let primary_attempts: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT build_request_identity,attempt_identity,semantic_digest FROM rd_artifact_build_attempts_v1 ORDER BY build_request_identity,attempt_identity",
        )
        .fetch_all(&owner.pool)
        .await
        .unwrap();
        let alias_attempts: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT build_request_identity,attempt_identity,semantic_digest FROM rd_artifact_build_attempts_v1 ORDER BY build_request_identity,attempt_identity",
        )
        .fetch_all(&alias_pool)
        .await
        .unwrap();
        assert_eq!(primary_attempts, alias_attempts);
        assert!(owner.assert_activation_safe().await.is_err());
        assert!(matches!(
        drain_legacy_prepared_attempts_v1(
            &alias_database_url,
            &target_database_resource_fingerprint,
            &target_database_fingerprint,
            2,
            &target_digest,
            None,
        )
        .await,
        Err(ArtifactBuildError::Storage(message))
            if message == "legacy PREPARED drain target database resource mismatch"
        ));
        let rejected_database_catalog: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(rejected_database_catalog, (0, 0));
        assert_eq!(
            legacy_drain_family_snapshot(&owner.pool).await,
            materialized_drain_family
        );
        assert!(
            drain_legacy_prepared_attempts_v1(
                &database_url,
                &target_database_resource_fingerprint,
                &clone_database_fingerprint,
                2,
                &target_digest,
                None,
            )
            .await
            .is_err()
        );
        assert!(
            drain_legacy_prepared_attempts_v1(
                &database_url,
                &target_database_resource_fingerprint,
                &target_database_fingerprint,
                2,
                &format!("sha256:{}", "0".repeat(64)),
                None,
            )
            .await
            .is_err()
        );
        let rolled_back_catalog: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(rolled_back_catalog, (0, 0));
        assert_eq!(
            legacy_drain_family_snapshot(&owner.pool).await,
            materialized_drain_family
        );
        assert!(
            drain_legacy_prepared_attempts_v1(
                &database_url,
                &target_database_resource_fingerprint,
                &target_database_fingerprint,
                2,
                &target_digest,
                Some(1),
            )
            .await
            .is_err()
        );
        let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1),(SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)")
            .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND).fetch_one(&owner.pool).await.unwrap();
        assert_eq!(counts, (0, 0));
        assert_eq!(
            legacy_drain_family_snapshot(&owner.pool).await,
            materialized_drain_family
        );
        let first = drain_legacy_prepared_attempts_v1(
            &database_url,
            &target_database_resource_fingerprint,
            &target_database_fingerprint,
            2,
            &target_digest,
            None,
        )
        .await
        .unwrap();
        let replay = drain_legacy_prepared_attempts_v1(
            &database_url,
            &target_database_resource_fingerprint,
            &target_database_fingerprint,
            2,
            &target_digest,
            None,
        )
        .await
        .unwrap();
        assert_eq!(first, replay);
        assert_eq!(
            legacy_drain_family_snapshot(&owner.pool).await,
            materialized_drain_family
        );
        let restarted = PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();

        for (build, attempt) in identities {
            let result = restarted
                .resolve_legacy_terminal_quarantined(&build, &attempt)
                .await
                .unwrap();
            assert_eq!(
                result.resolution(),
                ArtifactBuildResolution::LegacyTerminalQuarantined
            );
            assert!(result.owner_receipt().is_none());
            assert_eq!(
                result
                    .legacy_prepared_attempt_drain()
                    .unwrap()
                    .provider_disposition(),
                "PROVIDER_NEVER_STARTED"
            );
        }
        let drain_state_sql =
            "SELECT
               COALESCE((SELECT jsonb_agg(to_jsonb(attempt_row) ORDER BY build_request_identity,attempt_identity) FROM (SELECT build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1) attempt_row),'[]'::jsonb),
               COALESCE((SELECT jsonb_agg(to_jsonb(receipt_row) ORDER BY receipt_identity) FROM (SELECT receipt_identity,receipt_digest,build_request_identity,attempt_identity,receipt_json,committed_at_epoch_ms FROM rd_legacy_prepared_attempt_drain_receipts_v1) receipt_row),'[]'::jsonb),
               COALESCE((SELECT jsonb_agg(to_jsonb(outbox_row) ORDER BY event_identity) FROM (SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE event_kind=$1) outbox_row),'[]'::jsonb)";
        let before_alias_rejection: (serde_json::Value, serde_json::Value, serde_json::Value) =
            sqlx::query_as(drain_state_sql)
                .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
                .fetch_one(&owner.pool)
                .await
                .unwrap();
        assert!(matches!(
            PostgresArtifactBuildOwnerV1::connect(
                &alias_database_url,
                "/tmp/unused-rd-sandbox.sock",
                u64::MAX,
            )
            .await,
            Err(ArtifactBuildError::Storage(message))
                if message == "legacy PREPARED drain database endpoint mismatch"
        ));
        let after_alias_rejection: (serde_json::Value, serde_json::Value, serde_json::Value) =
            sqlx::query_as(drain_state_sql)
                .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
                .fetch_one(&owner.pool)
                .await
                .unwrap();
        assert_eq!(before_alias_rejection, after_alias_rejection);
        let first_target = &target_bindings[0];
        assert!(
            sqlx::query("SELECT 1 FROM product_edge_effect_invocation_admissions_v1")
                .fetch_optional(&owner.pool)
                .await
                .is_err()
        );
        sqlx::query("INSERT INTO product_edge_effect_invocation_admissions_v1(receipt_identity,receipt_digest,admission_identity,attempt_identity,claim_identity,receipt_json,write_cut_epoch_ms) VALUES($1,$2,$3,$4,$5,'{}'::jsonb,1)")
            .bind(format!("effect-receipt-{suffix}"))
            .bind(format!("sha256:{}", "e".repeat(64)))
            .bind(&first_target.admission.admission_identity)
            .bind(&first_target.attempt_identity)
            .bind(format!("effect-claim-{suffix}"))
            .execute(&product_edge_pool).await.unwrap();
        assert!(owner.assert_activation_safe().await.is_err());
        sqlx::query(
            "DELETE FROM product_edge_effect_invocation_admissions_v1 WHERE attempt_identity=$1",
        )
        .bind(&first_target.attempt_identity)
        .execute(&product_edge_pool)
        .await
        .unwrap();
        let unknown_build = format!("legacy-drain-unknown-build-{suffix}");
        let unknown_attempt = format!("legacy-drain-unknown-attempt-{suffix}");
        sqlx::query("INSERT INTO rd_artifact_build_attempts_v1(build_request_identity,attempt_identity,semantic_digest,attempt_json,prepared_at_epoch_ms) VALUES($1,$2,$3,$4,1)")
            .bind(&unknown_build).bind(&unknown_attempt)
            .bind(format!("sha256:{}", "f".repeat(64)))
            .bind(serde_json::json!({"schema_version":1,"state":"PREPARED","unknown":true}))
            .execute(&owner.pool).await.unwrap();
        assert!(owner.assert_activation_safe().await.is_err());
        sqlx::query("DELETE FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1")
            .bind(&unknown_build)
            .execute(&owner.pool)
            .await
            .unwrap();
        assert!(sqlx::query("UPDATE rd_legacy_prepared_attempt_drain_receipts_v1 SET receipt_digest='sha256:forbidden'")
            .execute(&owner.pool).await.is_err());

        sqlx::query("DROP TRIGGER rd_legacy_prepared_attempt_drain_immutable_v1 ON public.rd_legacy_prepared_attempt_drain_receipts_v1")
            .execute(&owner.pool).await.unwrap();
        let partial_before: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT 'public.rd_legacy_prepared_attempt_drain_receipts_v1'::pg_catalog.regclass::oid::bigint,
                    'public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()'::pg_catalog.regprocedure::oid::bigint,
                    (SELECT COUNT(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.rd_legacy_prepared_attempt_drain_receipts_v1'::pg_catalog.regclass AND tgname='rd_legacy_prepared_attempt_drain_immutable_v1' AND NOT tgisinternal),
                    (SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert!(
            drain_legacy_prepared_attempts_v1(
                &database_url,
                &target_database_resource_fingerprint,
                &target_database_fingerprint,
                2,
                &target_digest,
                None,
            )
            .await
            .is_err()
        );
        let partial_after: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT 'public.rd_legacy_prepared_attempt_drain_receipts_v1'::pg_catalog.regclass::oid::bigint,
                    'public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()'::pg_catalog.regprocedure::oid::bigint,
                    (SELECT COUNT(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.rd_legacy_prepared_attempt_drain_receipts_v1'::pg_catalog.regclass AND tgname='rd_legacy_prepared_attempt_drain_immutable_v1' AND NOT tgisinternal),
                    (SELECT COUNT(*) FROM rd_legacy_prepared_attempt_drain_receipts_v1),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(partial_before, partial_after);
        assert_eq!(partial_after.2, 0);

        sqlx::query("DROP TABLE public.rd_legacy_prepared_attempt_drain_receipts_v1")
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query(
            "DROP FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()",
        )
        .execute(&owner.pool)
        .await
        .unwrap();
        let missing_before: (bool, bool, i64, i64) = sqlx::query_as(
            "SELECT pg_catalog.to_regclass('public.rd_legacy_prepared_attempt_drain_receipts_v1') IS NULL,
                    pg_catalog.to_regprocedure('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()') IS NULL,
                    (SELECT COUNT(*) FROM pg_catalog.pg_trigger WHERE tgname='rd_legacy_prepared_attempt_drain_immutable_v1' AND NOT tgisinternal),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert!(
            drain_legacy_prepared_attempts_v1(
                &database_url,
                &target_database_resource_fingerprint,
                &target_database_fingerprint,
                2,
                &target_digest,
                None,
            )
            .await
            .is_err()
        );
        let missing_after: (bool, bool, i64, i64) = sqlx::query_as(
            "SELECT pg_catalog.to_regclass('public.rd_legacy_prepared_attempt_drain_receipts_v1') IS NULL,
                    pg_catalog.to_regprocedure('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()') IS NULL,
                    (SELECT COUNT(*) FROM pg_catalog.pg_trigger WHERE tgname='rd_legacy_prepared_attempt_drain_immutable_v1' AND NOT tgisinternal),
                    (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind=$1)",
        )
        .bind(crate::legacy_prepared_attempt_drain::DRAIN_EVENT_KIND)
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(missing_before, missing_after);
        assert!(missing_after.0);
        assert!(missing_after.1);
        assert_eq!(missing_after.2, 0);
    }

    #[tokio::test]
    #[ignore = "requires admitted OA/PE/R&D test database URLs"]
    async fn opaque_legacy_success_is_classified_but_never_promoted() {
        let test_database = test_database().await;
        let _mutation = test_database.mutation();
        let database_url = test_database.database_url().to_string();
        let owner = PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();
        let suffix = unique_suffix();
        let build_request_identity = format!("artifact-build-request-legacy-success-{suffix}");
        let attempt_identity = format!("artifact-build-attempt-legacy-success-{suffix}");
        let request = LegacyArtifactBuildRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity: format!("rd-research-intent-v1-legacy-success-{suffix}"),
            channel: LegacyProductEdgeChannelV1::App,
            context: serde_json::json!({
                "schema_version": 1,
                "trusted_principal": "legacy-principal",
                "authorized_scope": ["research:artifact-build"],
                "authorization_policy_cut": "legacy-policy-cut"
            }),
        };
        let semantic_digest = format!(
            "sha256:{:x}",
            Sha256::digest(
                serde_json::to_vec(&LegacyRequestMeaningV1 {
                    build_request_identity: &request.build_request_identity,
                    attempt_identity: &request.attempt_identity,
                    intent_identity: &request.intent_identity,
                    context: &request.context,
                })
                .unwrap()
            )
        );
        let committed_at = current_epoch_ms().unwrap();
        let legacy = LegacyStoredAttemptV1 {
            schema_version: 1,
            request,
            request_semantic_digest: semantic_digest.clone(),
            intent: None,
            state: AttemptState::Terminal,
            candidate_digest: Some("sha256:legacy-candidate".to_string()),
            candidate: Some(serde_json::json!({"historical_candidate": true})),
            prepared_at_epoch_ms: committed_at,
            receipt: Some(ArtifactBuildReceiptV1 {
                schema_version: 1,
                receipt_identity: format!("rd-artifact-build-receipt-v1-{suffix}"),
                build_request_identity: build_request_identity.clone(),
                attempt_identity: attempt_identity.clone(),
                request_semantic_digest: semantic_digest.clone(),
                intent_identity: None,
                intent_semantic_digest: None,
                disposition: ArtifactBuildDisposition::Success,
                artifact_identity: Some(format!("blake3:legacy-artifact-{suffix}")),
                build_receipt_identity: Some(format!("legacy-build-receipt-{suffix}")),
                failure_code: None,
                committed_at_epoch_ms: committed_at,
            }),
            research_view: None,
            artifact_review: Some(serde_json::json!({
                "schema_version": 1,
                "historical_security_review": {
                    "policy": "pre-sealed-evidence",
                    "accepted": true
                }
            })),
        };
        let terminal_json = serde_json::to_value(&legacy).unwrap();
        sqlx::query("INSERT INTO rd_artifact_build_attempts_v1 (build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(&build_request_identity).bind(&attempt_identity).bind(&semantic_digest)
            .bind(&terminal_json).bind(i64::try_from(committed_at).unwrap())
            .execute(&owner.pool).await.unwrap();

        owner.assert_activation_safe().await.unwrap();
        assert_eq!(
            owner
                .preflight_request_identity(&build_request_identity, &attempt_identity)
                .await
                .unwrap(),
            ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined
        );
        assert!(matches!(
            owner
                .resolve_legacy_terminal_quarantined(&build_request_identity, &attempt_identity)
                .await,
            Err(ArtifactBuildError::Storage(message))
                if message == "legacy successful artifact lacks sealed build security evidence"
        ));

        let mut nonterminal = terminal_json.clone();
        nonterminal["state"] = serde_json::json!("PREPARED");
        sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2")
            .bind(nonterminal).bind(&build_request_identity)
            .execute(&owner.pool).await.unwrap();
        assert!(matches!(
            owner.assert_activation_safe().await,
            Err(ArtifactBuildError::Storage(message))
                if message.contains("undrained legacy nonterminal")
        ));

        let mut unknown = terminal_json;
        unknown["unrecognized_custody"] = serde_json::json!(true);
        sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2")
            .bind(unknown).bind(&build_request_identity)
            .execute(&owner.pool).await.unwrap();
        assert!(matches!(
            owner.assert_activation_safe().await,
            Err(ArtifactBuildError::Storage(message))
                if message.contains("unclassified legacy attempt custody")
        ));
    }

    #[tokio::test]
    #[ignore = "requires admitted OA/PE/R&D test database URLs"]
    async fn exact_stale_cut_blocks_every_artifact_transition_without_writes() {
        let test_database = test_database().await;
        let mutation = test_database.mutation();
        let database_url = test_database.database_url().to_string();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&database_url)
            .await
            .unwrap();
        let suffix = unique_suffix();
        let research_request_identity = format!("research-request-v2-stale-writes-{suffix}");
        let (product_edge, research_admission) = bootstrap_authority(
            &database_url,
            &database_url,
            &research_request_identity,
            &suffix,
        )
        .await;
        let research_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
            .await
            .unwrap();
        let accepted = research_owner
            .submit_v2(research_request(
                &research_request_identity,
                research_admission,
            ))
            .await
            .unwrap();
        assert_eq!(
            accepted.resolution(),
            crate::product_edge::ProductEdgeResolution::Accepted,
            "fresh canonical research authority must be admitted: {accepted:#?}"
        );
        let intent_identity = accepted
            .owner_receipt()
            .unwrap()
            .resulting_research_intent_identity
            .as_deref()
            .unwrap()
            .to_string();
        let family_identity = accepted
            .trial_family()
            .unwrap()
            .root
            .trial_family_identity()
            .to_string();
        let valid_through = accepted.research_view().unwrap().valid_through_epoch_ms;
        let intent_json: serde_json::Value = sqlx::query_scalar(
            "SELECT intent_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
        )
        .bind(&research_request_identity)
        .fetch_one(&pool)
        .await
        .unwrap();
        let intent_digest =
            serde_json::from_value::<crate::product_edge::FrozenResearchGoalIntentV2>(intent_json)
                .unwrap()
                .semantic_digest;

        let mut owner = PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();
        owner.clock = Arc::new(move || Ok(valid_through));

        let stale_prepare =
            artifact_request(&product_edge, &suffix, &intent_identity, "stale-prepare").await;
        let before = state_snapshot(
            &pool,
            &research_request_identity,
            &stale_prepare,
            &intent_identity,
            &family_identity,
        )
        .await;
        let result = owner.prepare(stale_prepare.clone()).await.unwrap();
        assert_eq!(
            result.resolution(),
            ArtifactBuildResolution::SubmittedOrUnknown
        );
        assert_eq!(
            state_snapshot(
                &pool,
                &research_request_identity,
                &stale_prepare,
                &intent_identity,
                &family_identity,
            )
            .await,
            before
        );

        let fresh_cut = valid_through.saturating_sub(1);
        owner.clock = Arc::new(move || Ok(fresh_cut));
        let prepared_request = artifact_request(
            &product_edge,
            &suffix,
            &intent_identity,
            "stale-transitions",
        )
        .await;
        assert_eq!(
            owner
                .prepare(prepared_request.clone())
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let candidate = candidate(&intent_identity, &intent_digest);
        let invocation_claim_request = ProductEdgeInvocationClaimRequestV1 {
            admission: prepared_request.admission.clone(),
            attempt_identity: prepared_request.attempt_identity.clone(),
        };
        let invocation_claim = product_edge
            .claim_provider_invocation(invocation_claim_request.clone())
            .await
            .unwrap();
        owner.clock = Arc::new(move || Ok(valid_through));
        let reserved_invocation = owner
            .reserve_provider_invocation_custody(
                &prepared_request.build_request_identity,
                &prepared_request.attempt_identity,
                invocation_claim,
            )
            .await
            .unwrap();
        let (_start_reservation, invocation_custody) = reserved_invocation.into_parts();
        assert_eq!(invocation_custody.request(), &prepared_request);
        assert_eq!(
            invocation_custody.request_semantic_digest(),
            build_request_semantic_digest(&prepared_request).unwrap()
        );
        let reserved = state_snapshot(
            &pool,
            &research_request_identity,
            &prepared_request,
            &intent_identity,
            &family_identity,
        )
        .await;
        let recovered_invocation_claim = product_edge
            .claim_provider_invocation(invocation_claim_request.clone())
            .await
            .unwrap();
        owner
            .reserve_provider_invocation_custody(
                &prepared_request.build_request_identity,
                &prepared_request.attempt_identity,
                recovered_invocation_claim,
            )
            .await
            .unwrap();
        assert_eq!(
            state_snapshot(
                &pool,
                &research_request_identity,
                &prepared_request,
                &intent_identity,
                &family_identity,
            )
            .await,
            reserved,
            "same sealed claim must join the existing reservation without a write"
        );
        let mut wrong_attempt = prepared_request.clone();
        wrong_attempt.attempt_identity.push_str("-wrong");
        let mut wrong_intent = prepared_request.clone();
        wrong_intent.intent_identity.push_str("-wrong");
        let mut wrong_admission = prepared_request.clone();
        wrong_admission
            .admission
            .admission_identity
            .push_str("-wrong");
        for wrong in [wrong_attempt, wrong_intent, wrong_admission] {
            let recovered_invocation_claim = product_edge
                .claim_provider_invocation(invocation_claim_request.clone())
                .await
                .unwrap();
            assert!(matches!(
                owner
                    .reserve_provider_invocation_custody(
                        &wrong.build_request_identity,
                        &wrong.attempt_identity,
                        recovered_invocation_claim,
                    )
                    .await,
                Err(ArtifactBuildError::ConflictingReplay
                    | ArtifactBuildError::Storage(_)
                    | ArtifactBuildError::Unauthorized(_))
            ));
        }
        let before = state_snapshot(
            &pool,
            &research_request_identity,
            &prepared_request,
            &intent_identity,
            &family_identity,
        )
        .await;
        assert_eq!(
            owner
                .submit_candidate(prepared_request.clone(), candidate.clone(), None)
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::SubmittedOrUnknown
        );
        assert_eq!(
            owner
                .fail_no_artifact(prepared_request.clone(), "PROVIDER_ERROR", None)
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::SubmittedOrUnknown
        );
        owner.attempt_timeout_ms = 0;
        assert_eq!(
            owner
                .resolve(
                    &prepared_request.build_request_identity,
                    &prepared_request.attempt_identity,
                    &prepared_request.admission,
                )
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::SubmittedOrUnknown
        );
        assert_eq!(
            state_snapshot(
                &pool,
                &research_request_identity,
                &prepared_request,
                &intent_identity,
                &family_identity,
            )
            .await,
            before
        );

        let sealed_failure_request = artifact_request(
            &product_edge,
            &suffix,
            &intent_identity,
            "sealed-failure-after-expiry",
        )
        .await;
        owner.clock = Arc::new(move || Ok(fresh_cut));
        assert_eq!(
            owner
                .prepare(sealed_failure_request.clone())
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let claim_request = ProductEdgeInvocationClaimRequestV1 {
            admission: sealed_failure_request.admission.clone(),
            attempt_identity: sealed_failure_request.attempt_identity.clone(),
        };
        let claim = product_edge
            .claim_provider_invocation(claim_request.clone())
            .await
            .unwrap();
        owner.clock = Arc::new(move || Ok(valid_through));
        let recovered_claim = product_edge
            .claim_provider_invocation(claim_request)
            .await
            .unwrap();
        assert_eq!(recovered_claim.claim_identity(), claim.claim_identity());
        let reserved_invocation = owner
            .reserve_provider_invocation_custody(
                &sealed_failure_request.build_request_identity,
                &sealed_failure_request.attempt_identity,
                recovered_claim,
            )
            .await
            .unwrap();
        let (start_reservation, _invocation_custody) = reserved_invocation.into_parts();
        product_edge
            .start_provider_invocation(start_reservation)
            .await
            .unwrap();
        let started_claim = product_edge
            .resolve_provider_invocation_claim(
                &sealed_failure_request.admission,
                &sealed_failure_request.attempt_identity,
            )
            .await
            .unwrap()
            .unwrap();
        owner.clock = Arc::new(move || Ok(valid_through));
        let terminal = owner
            .fail_no_artifact(
                sealed_failure_request.clone(),
                "PROVIDER_ERROR",
                Some(&started_claim),
            )
            .await
            .unwrap();
        assert_eq!(
            terminal.resolution(),
            ArtifactBuildResolution::FailedNoArtifact
        );
        assert_eq!(
            owner
                .resolve(
                    &sealed_failure_request.build_request_identity,
                    &sealed_failure_request.attempt_identity,
                    &sealed_failure_request.admission,
                )
                .await
                .unwrap()
                .owner_receipt(),
            terminal.owner_receipt()
        );

        let sealed_success_request = artifact_request(
            &product_edge,
            &suffix,
            &intent_identity,
            "sealed-success-after-expiry",
        )
        .await;
        owner.clock = Arc::new(move || Ok(fresh_cut));
        assert_eq!(
            owner
                .prepare(sealed_success_request.clone())
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let claim = product_edge
            .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
                admission: sealed_success_request.admission.clone(),
                attempt_identity: sealed_success_request.attempt_identity.clone(),
            })
            .await
            .unwrap();
        owner.clock = Arc::new(move || Ok(valid_through));
        let reserved_invocation = owner
            .reserve_provider_invocation_custody(
                &sealed_success_request.build_request_identity,
                &sealed_success_request.attempt_identity,
                claim,
            )
            .await
            .unwrap();
        let (start_reservation, _invocation_custody) = reserved_invocation.into_parts();
        product_edge
            .start_provider_invocation(start_reservation)
            .await
            .unwrap();
        let started_claim = product_edge
            .resolve_provider_invocation_claim(
                &sealed_success_request.admission,
                &sealed_success_request.attempt_identity,
            )
            .await
            .unwrap()
            .unwrap();
        owner.sandbox = Arc::new(ValidSandbox);
        let terminal = owner
            .submit_candidate(
                sealed_success_request.clone(),
                candidate.clone(),
                Some(&started_claim),
            )
            .await
            .unwrap();
        assert_eq!(terminal.resolution(), ArtifactBuildResolution::Success);
        let before_source_read = state_snapshot(
            &pool,
            &research_request_identity,
            &sealed_success_request,
            &intent_identity,
            &family_identity,
        )
        .await;
        let source = owner
            .read_source(
                &sealed_success_request.build_request_identity,
                &sealed_success_request.attempt_identity,
            )
            .await
            .unwrap()
            .expect("terminal-success custody exposes verified source");
        assert_eq!(source.schema_version, 1);
        assert_eq!(
            source.artifact_identity,
            terminal
                .owner_receipt()
                .unwrap()
                .artifact_identity
                .as_deref()
                .unwrap()
        );
        assert_eq!(
            source.source,
            crate::artifact_build::render_program_source(
                &candidate,
                &crate::artifact_build::candidate_digest(&candidate).unwrap(),
            )
        );
        assert_eq!(
            source.source_digest,
            format!("sha256:{:x}", Sha256::digest(source.source.as_bytes()))
        );
        assert_eq!(
            source.wasm_preview_status,
            ArtifactWasmPreviewStatusV1::NotRun
        );
        assert!(matches!(
            owner
                .read_source(
                    &sealed_success_request.build_request_identity,
                    "different-attempt",
                )
                .await,
            Err(ArtifactBuildError::ConflictingReplay)
        ));
        assert_eq!(
            state_snapshot(
                &pool,
                &research_request_identity,
                &sealed_success_request,
                &intent_identity,
                &family_identity,
            )
            .await,
            before_source_read,
            "source read must not mutate terminal custody",
        );
        let directory = owner.list_artifacts(None, 20).await.unwrap();
        let directory_item = directory
            .items
            .iter()
            .find(|item| {
                item.build_request_identity == sealed_success_request.build_request_identity
            })
            .expect("terminal-success custody appears in the verified directory");
        assert_eq!(
            directory_item.attempt_identity,
            sealed_success_request.attempt_identity
        );
        assert_eq!(directory_item.artifact_identity, source.artifact_identity);
        assert_eq!(directory_item.intent_identity, intent_identity);
        assert_eq!(directory_item.build_security_state, "ADMITTED");
        assert_eq!(
            state_snapshot(
                &pool,
                &research_request_identity,
                &sealed_success_request,
                &intent_identity,
                &family_identity,
            )
            .await,
            before_source_read,
            "directory read must not mutate terminal custody",
        );
        assert_eq!(
            owner
                .resolve(
                    &sealed_success_request.build_request_identity,
                    &sealed_success_request.attempt_identity,
                    &sealed_success_request.admission,
                )
                .await
                .unwrap()
                .owner_receipt(),
            terminal.owner_receipt()
        );

        let final_request = artifact_request(
            &product_edge,
            &suffix,
            &intent_identity,
            "stale-final-write",
        )
        .await;
        owner.clock = Arc::new(move || Ok(fresh_cut));
        assert_eq!(
            owner
                .prepare(final_request.clone())
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let before_final = state_snapshot(
            &pool,
            &research_request_identity,
            &final_request,
            &intent_identity,
            &family_identity,
        )
        .await;
        owner.sandbox = Arc::new(ValidSandbox);
        let cuts = Arc::new(Mutex::new(VecDeque::from([
            fresh_cut,
            fresh_cut,
            fresh_cut,
            valid_through,
        ])));
        let clock_cuts = Arc::clone(&cuts);
        owner.clock = Arc::new(move || {
            clock_cuts
                .lock()
                .map_err(json_storage)?
                .pop_front()
                .ok_or_else(|| ArtifactBuildError::Storage("test clock exhausted".to_string()))
        });
        assert_eq!(
            owner
                .submit_candidate(final_request.clone(), candidate.clone(), None)
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::SubmittedOrUnknown
        );
        assert!(cuts.lock().unwrap().is_empty());
        let after_final = state_snapshot(
            &pool,
            &research_request_identity,
            &final_request,
            &intent_identity,
            &family_identity,
        )
        .await;
        assert_eq!(after_final.view_json, before_final.view_json);
        assert_eq!(after_final.artifact_count, before_final.artifact_count);
        assert_eq!(after_final.binding_count, before_final.binding_count);
        assert_eq!(
            after_final.binding_outbox_count,
            before_final.binding_outbox_count
        );
        assert_eq!(
            after_final.family_outbox_count,
            before_final.family_outbox_count
        );
        let final_attempt = after_final
            .attempt_json
            .expect("fresh admission persists only the nonterminal BUILDING transition");
        assert_eq!(final_attempt["state"], "BUILDING");
        assert_eq!(final_attempt["receipt"], serde_json::Value::Null);
        assert_eq!(
            final_attempt["candidate_digest"],
            candidate_digest(&candidate).unwrap()
        );

        sqlx::query(
            "DELETE FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = ANY($1)",
        )
        .bind(vec![
            prepared_request.build_request_identity,
            final_request.build_request_identity,
        ])
        .execute(&pool)
        .await
        .unwrap();
        cleanup_research(&mutation, &research_request_identity, &family_identity).await;
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE/R&D/Qualification PostgreSQL topology"]
    async fn specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let suffix = unique_suffix();
        let research_request_identity = format!("research-request-v2-race-{suffix}");
        let (product_edge, research_admission) = bootstrap_authority(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &research_request_identity,
            &suffix,
        )
        .await;
        let research_owner = PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap();
        let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap();
        let accepted = research_owner
            .submit_v2(research_request(
                &research_request_identity,
                research_admission,
            ))
            .await
            .unwrap();
        let intent_identity = accepted
            .owner_receipt()
            .unwrap()
            .resulting_research_intent_identity
            .as_deref()
            .unwrap()
            .to_string();
        let build_request_identity = format!("artifact-build-request-race-{suffix}");
        let attempt_identity = format!("artifact-build-attempt-race-{suffix}");
        let typed_payload = serde_json::json!({
            "build_request_identity": build_request_identity,
            "attempt_identity": attempt_identity,
            "intent_identity": intent_identity,
            "channel": ProductEdgeChannel::WindmillProductEdge,
        });
        let exact_request = ProductEdgeAdmissionRequestV1 {
            request_identity: build_request_identity.clone(),
            typed_payload: typed_payload.clone(),
            operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
            operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects: vibe_product_edge::ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
                .iter()
                .map(|effect| (*effect).to_string())
                .collect(),
            request_proof_digest: "sha256:test-proof".to_string(),
            audit_correlation: format!("test-race:{suffix}"),
        };

        let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let before: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_admissions_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_states_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        let rd_attempts_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM rd_artifact_build_attempts_v1")
                .fetch_one(rd_pool)
                .await
                .unwrap();

        for requested_effects in [
            vec![],
            vec!["R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string()],
            vec!["R_AND_D_PROVIDER_INVOCATION_V1".to_string()],
            vec![
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
            ],
            vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
            ],
            vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                "EXTRA_EFFECT_V1".to_string(),
            ],
        ] {
            let mut refuting = exact_request.clone();
            refuting.request_identity = format!(
                "artifact-build-request-effects-{}-{suffix}",
                requested_effects.len()
            );
            refuting.typed_payload["build_request_identity"] =
                serde_json::json!(refuting.request_identity);
            refuting.requested_effects = requested_effects;
            assert!(matches!(
                product_edge.admit_artifact_build_request(refuting).await,
                Err(vibe_product_edge::ProductEdgeError::Unavailable)
            ));
        }
        assert!(matches!(
            product_edge.admit_request(exact_request.clone()).await,
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));

        let mut rd_row_gate = rd_pool.begin().await.unwrap();
        let original: (serde_json::Value, serde_json::Value, String) = sqlx::query_as(
            "SELECT view_json, artifact_evidence_json, artifact_evidence_digest FROM rd_research_request_receipts_v1 WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(&research_request_identity)
        .fetch_one(&mut *rd_row_gate)
        .await
        .unwrap();
        let waiting = product_edge.admit_artifact_build_request(exact_request.clone());
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), &mut waiting)
                .await
                .is_err(),
            "specialized admission must wait on the canonical R&D row"
        );
        let deployment_lock_available: bool =
            sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))")
                .bind(format!("deploymentproduct-edge-deployment-{suffix}"))
                .fetch_one(pe_pool)
                .await
                .unwrap();
        assert!(
            !deployment_lock_available,
            "PE must hold its deployment lock before waiting on R&D"
        );
        let expired_cut = current_epoch_ms().unwrap();
        let expired = reseal_current_research_artifact_evidence_for_test(
            original.0.clone(),
            original.1.clone(),
            expired_cut,
        )
        .unwrap();
        sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json=$1, artifact_evidence_json=$2, artifact_evidence_digest=$3 WHERE request_identity=$4")
            .bind(expired.0).bind(expired.1).bind(expired.2).bind(&research_request_identity)
            .execute(&mut *rd_row_gate).await.unwrap();
        rd_row_gate.commit().await.unwrap();
        assert!(matches!(
            tokio::time::timeout(std::time::Duration::from_secs(5), &mut waiting)
                .await
                .unwrap(),
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));
        let after_failure: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_admissions_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_states_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(after_failure, before);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rd_artifact_build_attempts_v1",)
                .fetch_one(rd_pool)
                .await
                .unwrap(),
            rd_attempts_before
        );

        sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json=$1, artifact_evidence_json=$2, artifact_evidence_digest=$3 WHERE request_identity=$4")
            .bind(&original.0).bind(&original.1).bind(&original.2).bind(&research_request_identity)
            .execute(rd_pool).await.unwrap();
        let admission = product_edge
            .admit_artifact_build_request(exact_request.clone())
            .await
            .unwrap();
        let invocation_privileges: (bool, bool, bool, bool, bool, bool) = sqlx::query_as(
            "SELECT has_table_privilege('product_edge_owner', 'public.rd_artifact_build_attempts_v1', 'SELECT'), has_table_privilege('product_edge_owner', 'public.rd_artifact_build_attempts_v1', 'INSERT'), has_table_privilege('product_edge_owner', 'public.rd_artifact_build_attempts_v1', 'UPDATE'), has_table_privilege('product_edge_owner', 'public.rd_artifact_build_attempts_v1', 'DELETE'), has_function_privilege('product_edge_owner', 'rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text)', 'EXECUTE'), has_function_privilege('public', 'rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text)', 'EXECUTE')",
        )
        .fetch_one(rd_pool)
        .await
        .unwrap();
        assert_eq!(
            invocation_privileges,
            (false, false, false, false, true, false),
            "Product Edge receives execute-only R&D reservation custody"
        );
        let artifact_request = ArtifactBuildRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity: intent_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: admission.locator().clone(),
        };
        assert_eq!(
            artifact_owner
                .prepare(artifact_request.clone())
                .await
                .unwrap()
                .resolution(),
            ArtifactBuildResolution::Prepared
        );
        let claim_request = ProductEdgeInvocationClaimRequestV1 {
            admission: admission.locator().clone(),
            attempt_identity: attempt_identity.clone(),
        };
        let claim = product_edge
            .claim_provider_invocation(claim_request.clone())
            .await
            .unwrap();
        assert_eq!(
            product_edge
                .claim_provider_invocation(claim_request.clone())
                .await
                .unwrap()
                .claim_digest(),
            claim.claim_digest()
        );
        let mut changed_attempt = claim_request.clone();
        changed_attempt.attempt_identity.push_str("-changed");
        assert!(matches!(
            product_edge
                .claim_provider_invocation(changed_attempt)
                .await,
            Err(vibe_product_edge::ProductEdgeError::ConflictingReplay)
        ));

        let receipt_row: (String, serde_json::Value) = sqlx::query_as(
            "SELECT receipt_digest, receipt_json FROM product_edge_effect_invocation_admissions_v1 WHERE claim_identity=$1",
        )
        .bind(claim.claim_identity()).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_effect_invocation_admissions_v1 SET receipt_digest='sha256:corrupt' WHERE claim_identity=$1")
            .bind(claim.claim_identity()).execute(pe_pool).await.unwrap();
        assert!(matches!(
            product_edge
                .claim_provider_invocation(claim_request.clone())
                .await,
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_effect_invocation_admissions_v1 SET receipt_digest=$1, receipt_json=$2 WHERE claim_identity=$3")
            .bind(&receipt_row.0).bind(&receipt_row.1).bind(claim.claim_identity())
            .execute(pe_pool).await.unwrap();
        let original_claim_digest: String = sqlx::query_scalar(
            "SELECT claim_digest FROM product_edge_effect_invocation_claims_v1 WHERE claim_identity=$1",
        )
        .bind(claim.claim_identity()).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_effect_invocation_claims_v1 SET claim_digest='sha256:corrupt' WHERE claim_identity=$1")
            .bind(claim.claim_identity()).execute(pe_pool).await.unwrap();
        assert!(matches!(
            product_edge
                .claim_provider_invocation(claim_request.clone())
                .await,
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_effect_invocation_claims_v1 SET claim_digest=$1 WHERE claim_identity=$2")
            .bind(&original_claim_digest).bind(claim.claim_identity()).execute(pe_pool).await.unwrap();

        let reservation_claim = product_edge
            .claim_provider_invocation(claim_request.clone())
            .await
            .unwrap();
        let reserved_invocation = artifact_owner
            .reserve_provider_invocation_custody(
                &build_request_identity,
                &attempt_identity,
                reservation_claim,
            )
            .await
            .unwrap();
        let (tampered_start_reservation, _invocation_custody) = reserved_invocation.into_parts();

        let original_attempt_json: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_pool)
        .await
        .unwrap();
        let mut tampered_attempt_json = original_attempt_json.clone();
        tampered_attempt_json["invocation_claim"]["reservation_digest"] =
            serde_json::json!("sha256:corrupt");
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&tampered_attempt_json)
        .bind(&build_request_identity)
        .execute(rd_pool)
        .await
        .unwrap();
        let before_rejected_start: (serde_json::Value, i64) = sqlx::query_as(
            "SELECT state_json, (SELECT COUNT(*) FROM product_edge_owner_outbox_v1) FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert!(matches!(
            product_edge
                .start_provider_invocation(tampered_start_reservation)
                .await,
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));
        let after_rejected_start: (serde_json::Value, i64) = sqlx::query_as(
            "SELECT state_json, (SELECT COUNT(*) FROM product_edge_owner_outbox_v1) FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(
            after_rejected_start, before_rejected_start,
            "a reservation that no longer resolves canonically must not start or emit an outbox event"
        );
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&original_attempt_json)
        .bind(&build_request_identity)
        .execute(rd_pool)
        .await
        .unwrap();
        let start_claim = product_edge
            .claim_provider_invocation(claim_request.clone())
            .await
            .unwrap();
        let start_reservation = artifact_owner
            .reserve_provider_invocation_custody(
                &build_request_identity,
                &attempt_identity,
                start_claim,
            )
            .await
            .unwrap();
        let (start_reservation, _invocation_custody) = start_reservation.into_parts();

        let historical_expired = reseal_current_research_artifact_evidence_for_test(
            original.0.clone(),
            original.1.clone(),
            current_epoch_ms().unwrap(),
        )
        .unwrap();
        sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json=$1, artifact_evidence_json=$2, artifact_evidence_digest=$3 WHERE request_identity=$4")
            .bind(historical_expired.0).bind(historical_expired.1).bind(historical_expired.2)
            .bind(&research_request_identity).execute(rd_pool).await.unwrap();
        let started_events_before: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        let mut rd_start_gate = rd_pool.begin().await.unwrap();
        sqlx::query(
            "SELECT build_request_identity FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1 FOR UPDATE",
        )
        .bind(&build_request_identity)
        .fetch_one(&mut *rd_start_gate)
        .await
        .unwrap();
        let starting = product_edge.start_provider_invocation(start_reservation);
        tokio::pin!(starting);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), &mut starting)
                .await
                .is_err(),
            "Product Edge start must wait for canonical R&D reservation custody"
        );
        let lock_error = sqlx::query_scalar::<_, i64>(
            "SELECT 1 FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1 FOR UPDATE NOWAIT",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap_err();
        assert_eq!(
            lock_error
                .as_database_error()
                .and_then(|e| e.code())
                .as_deref(),
            Some("55P03"),
            "Product Edge must hold its state lock before waiting on R&D"
        );
        rd_start_gate.commit().await.unwrap();
        let started = tokio::time::timeout(std::time::Duration::from_secs(5), &mut starting)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            started.disposition(),
            vibe_product_edge::ProductEdgeInvocationStartDispositionV1::StartedNew
        );
        let started_events_after_first: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_first, started_events_before + 1);
        let retry_claim = product_edge
            .claim_provider_invocation(claim_request.clone())
            .await
            .unwrap();
        let retry_reservation = artifact_owner
            .reserve_provider_invocation_custody(
                &build_request_identity,
                &attempt_identity,
                retry_claim,
            )
            .await
            .unwrap();
        let (retry_start_reservation, _invocation_custody) = retry_reservation.into_parts();
        assert_eq!(
            product_edge
                .start_provider_invocation(retry_start_reservation)
                .await
                .unwrap()
                .disposition(),
            vibe_product_edge::ProductEdgeInvocationStartDispositionV1::OutcomeUnknown
        );
        let started_events_after_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(claim.claim_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_retry, started_events_after_first);
        let state_row: (String, serde_json::Value) = sqlx::query_as(
            "SELECT state_digest, state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(claim.claim_identity()).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_effect_invocation_states_v1 SET state_digest='sha256:corrupt' WHERE claim_identity=$1")
            .bind(claim.claim_identity()).execute(pe_pool).await.unwrap();
        assert!(matches!(
            product_edge
                .claim_provider_invocation(claim_request.clone())
                .await,
            Err(vibe_product_edge::ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_effect_invocation_states_v1 SET state_digest=$1, state_json=$2 WHERE claim_identity=$3")
            .bind(&state_row.0).bind(&state_row.1).bind(claim.claim_identity())
            .execute(pe_pool).await.unwrap();
        let after_started: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_admissions_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_states_v1)",
        )
        .fetch_one(pe_pool).await.unwrap();
        assert_eq!(
            product_edge
                .admit_artifact_build_request(exact_request)
                .await
                .unwrap(),
            admission,
            "historical exact replay must not refresh current R&D authority"
        );
        let after_replay: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_admissions_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1), (SELECT COUNT(*) FROM product_edge_effect_invocation_states_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(after_replay, after_started);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rd_artifact_build_attempts_v1",)
                .fetch_one(rd_pool)
                .await
                .unwrap(),
            rd_attempts_before + 1
        );
        sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json=$1, artifact_evidence_json=$2, artifact_evidence_digest=$3 WHERE request_identity=$4")
            .bind(&original.0).bind(&original.1).bind(&original.2).bind(&research_request_identity)
            .execute(rd_pool).await.unwrap();
    }

    #[derive(Debug, PartialEq)]
    struct StateSnapshot {
        view_json: serde_json::Value,
        attempt_json: Option<serde_json::Value>,
        artifact_count: i64,
        binding_count: i64,
        binding_outbox_count: i64,
        family_outbox_count: i64,
    }

    async fn state_snapshot(
        pool: &PgPool,
        research_request_identity: &str,
        request: &ArtifactBuildRequestV1,
        intent_identity: &str,
        family_identity: &str,
    ) -> StateSnapshot {
        StateSnapshot {
            view_json: sqlx::query_scalar(
                "SELECT view_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            )
            .bind(research_request_identity)
            .fetch_one(pool)
            .await
            .unwrap(),
            attempt_json: sqlx::query_scalar(
                "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
            )
            .bind(&request.build_request_identity)
            .fetch_optional(pool)
            .await
            .unwrap(),
            artifact_count: sqlx::query_scalar(
                "SELECT COUNT(*) FROM rd_strategy_artifacts_v1 WHERE attempt_identity = $1",
            )
            .bind(&request.attempt_identity)
            .fetch_one(pool)
            .await
            .unwrap(),
            binding_count: sqlx::query_scalar(
                "SELECT COUNT(*) FROM rd_artifact_trial_family_bindings_v1 WHERE intent_identity = $1",
            )
            .bind(intent_identity)
            .fetch_one(pool)
            .await
            .unwrap(),
            binding_outbox_count: sqlx::query_scalar(
                "SELECT COUNT(*) FROM rd_owner_outbox_v1 o JOIN rd_artifact_trial_family_bindings_v1 b ON b.artifact_identity = o.aggregate_identity WHERE o.event_kind = 'ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND b.trial_family_identity = $1",
            )
            .bind(family_identity)
            .fetch_one(pool)
            .await
            .unwrap(),
            family_outbox_count: sqlx::query_scalar(
                "SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1",
            )
            .bind(family_identity)
            .fetch_one(pool)
            .await
            .unwrap(),
        }
    }

    #[derive(Clone)]
    struct ValidSandbox;

    #[async_trait]
    impl ArtifactBuildSandboxPort for ValidSandbox {
        async fn build(
            &self,
            request: SandboxBuildRequestV1,
        ) -> Result<SandboxBuildProductV1, ArtifactBuildError> {
            let wasm = verified_price_build()
                .map_err(|e| ArtifactBuildError::Sandbox(e.to_string()))?
                .wasm
                .to_vec();
            Ok(SandboxBuildProductV1 {
                source_capsule: canonical_sandbox_source_capsule(request.source.as_bytes())?,
                build_recipe: sandbox_recipe(),
                wasm_one: wasm.clone(),
                wasm_two: wasm,
            })
        }
    }

    fn sandbox_recipe() -> Vec<u8> {
        let dockerfile_digest = format!(
            "sha256:{:x}",
            Sha256::digest(RD_SANDBOX_DOCKERFILE.as_bytes())
        );
        let mut bytes = serde_json::to_vec(&serde_json::json!({
            "build_platform": "linux/arm64",
            "dependency_policy": "locked_no_external_dependencies",
            "dockerfile_sha256": dockerfile_digest,
            "frontend": "docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d",
            "manifest": "Cargo.toml",
            "network_policy": "container_network_none_cargo_offline",
            "rust_image": "public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777",
            "rustc_commit": RUSTC_COMMIT,
            "rustc_release": RUSTC_RELEASE,
            "sandbox_policy": SANDBOX_POLICY_V1,
            "schema_version": 2,
            "target": TARGET,
            "wasm_target": "rd_generated_strategy",
        }))
        .unwrap();
        bytes.push(b'\n');
        bytes
    }

    async fn artifact_request(
        product_edge: &ProductEdgePostgresOwnerV1,
        suffix: &str,
        intent_identity: &str,
        label: &str,
    ) -> ArtifactBuildRequestV1 {
        let build_request_identity = format!("artifact-build-request-{label}-{suffix}");
        let attempt_identity = format!("artifact-build-attempt-{label}-{suffix}");
        let typed_payload = serde_json::json!({
            "build_request_identity": build_request_identity,
            "attempt_identity": attempt_identity,
            "intent_identity": intent_identity,
            "channel": ProductEdgeChannel::WindmillProductEdge,
        });
        let admission = product_edge
            .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                request_identity: build_request_identity.clone(),
                typed_payload,
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vibe_product_edge::ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
                    .iter()
                    .map(|effect| (*effect).to_string())
                    .collect(),
                request_proof_digest: "sha256:test-proof".to_string(),
                audit_correlation: format!("test:{build_request_identity}"),
            })
            .await
            .unwrap();
        ArtifactBuildRequestV1 {
            build_request_identity,
            attempt_identity: format!("artifact-build-attempt-{label}-{suffix}"),
            intent_identity: intent_identity.to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: admission.locator().clone(),
        }
    }

    fn candidate(intent_identity: &str, intent_digest: &str) -> ArtifactBuildCandidateV1 {
        ArtifactBuildCandidateV1 {
            schema_version: 1,
            candidate_identity: "agent-program-candidate-v1-stale-boundary".to_string(),
            intent_identity: intent_identity.to_string(),
            intent_semantic_digest: intent_digest.to_string(),
            logic: GeneratedStrategyLogicV1 {
                signal: GeneratedSignalV1::Momentum,
                direction: GeneratedDirectionV1::LongOnly,
                lookback_bars: 24,
                entry_threshold_bps: 50,
                exit_threshold_bps: 10,
            },
            structured_logic_summary: "Bounded stale-boundary candidate for Owner regression."
                .to_string(),
            agent_change_explanation:
                "Exercises exact Owner freshness admission without external execution.".to_string(),
        }
    }

    fn research_request(
        request_identity: &str,
        admission: ProductEdgeAdmissionLocatorV1,
    ) -> ProductEdgeResearchGoalRequestV2 {
        ProductEdgeResearchGoalRequestV2 {
            request_identity: request_identity.to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission,
            goal: crate::product_edge::SourcedResearchGoalV2 {
                hypothesis: "A bounded point-in-time momentum effect persists after exact costs."
                    .to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question: "Does the effect disappear after exact modeled costs?"
                    .to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact model identity below.".to_string(),
                capacity_assumption: "Capacity model identity below.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/research".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-21T00:00:00Z".to_string(),
                    source_cut: "source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded source interpretation only.".to_string(),
                }],
            },
            trial_family_proposal: crate::product_edge::TrialFamilyProposalV1 {
                trial_budget: 8,
                stop_rule: "Stop on falsifier, exhausted budget, or unavailable PIT input."
                    .to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "No known local predecessor before Owner resolution."
                    .to_string(),
            },
        }
    }

    async fn bootstrap_authority(
        operator_authorization_database_url: &str,
        product_edge_database_url: &str,
        research_request_identity: &str,
        suffix: &str,
    ) -> (ProductEdgePostgresOwnerV1, ProductEdgeAdmissionLocatorV1) {
        let now = current_epoch_ms().unwrap();
        let principal = format!("admin-{suffix}");
        let mut manifests = vec![
            AgentOperationManifestProposalV1 {
                operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
            AgentOperationManifestProposalV1 {
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "d".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let bindings = manifests
            .iter()
            .map(|manifest| OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().unwrap(),
                manifest_digest: manifest.manifest_digest().unwrap(),
            })
            .collect();
        let issuer =
            OperatorAuthorizationIssuerPostgresV1::connect(operator_authorization_database_url)
                .await
                .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: RESEARCH_OWNER_V1.to_string(),
                    permissions: vec![
                        ARTIFACT_BUILD_SCOPE_V1.to_string(),
                        RESEARCH_SCOPE_V1.to_string(),
                        RESEARCH_VIEW_SCOPE_V1.to_string(),
                    ],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: bindings,
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let deployment_identity = format!("product-edge-deployment-{suffix}");
        let edge = ProductEdgePostgresOwnerV1::connect(
            product_edge_database_url,
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: RESEARCH_OWNER_V1.to_string(),
            },
        )
        .await
        .unwrap();
        edge.bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("product-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "research-scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
            authorization: authorization.locator(),
            manifests,
        })
        .await
        .unwrap();
        let empty_locator = ProductEdgeAdmissionLocatorV1 {
            request_identity: research_request_identity.to_string(),
            admission_identity: String::new(),
            admission_digest: String::new(),
        };
        let request = research_request(research_request_identity, empty_locator);
        let typed_payload = serde_json::json!({
            "request_identity": request.request_identity,
            "channel": request.channel,
            "goal": request.goal,
            "trial_family_proposal": request.trial_family_proposal,
        });
        let admission = edge
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: research_request_identity.to_string(),
                typed_payload,
                operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                request_proof_digest: "sha256:test-proof".to_string(),
                audit_correlation: format!("test:{research_request_identity}"),
            })
            .await
            .unwrap()
            .locator()
            .clone();
        (edge, admission)
    }

    async fn test_database() -> DedicatedPostgresTestDatabase {
        DedicatedPostgresTestDatabase::admit_cross_owner(&[
            "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
            "PRODUCT_EDGE_TEST_DATABASE_URL",
            "RD_OWNER_TEST_DATABASE_URL",
        ])
        .await
        .unwrap()
    }

    fn unique_suffix() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    async fn cleanup_research(
        mutation: &DedicatedPostgresTestMutation<'_>,
        request_identity: &str,
        family_identity: &str,
    ) {
        let pool = mutation.pool();
        let basis_identity = sqlx::query_scalar::<_, String>(
            "SELECT basis_identity FROM rd_independence_bases_v1 WHERE request_identity = $1",
        )
        .bind(request_identity)
        .fetch_optional(pool)
        .await
        .unwrap();
        let projection_identity = if let Some(basis_identity) = basis_identity.as_deref() {
            sqlx::query_scalar::<_, String>("SELECT projection_identity FROM qualification_protected_feedback_projections_v1 WHERE basis_identity = $1")
                .bind(basis_identity).fetch_optional(pool).await.unwrap()
        } else {
            None
        };
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_trial_families_v1 WHERE trial_family_identity = $1")
            .bind(family_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
            .bind(request_identity)
            .execute(pool)
            .await
            .unwrap();
        if let Some(projection_identity) = projection_identity {
            sqlx::query("DELETE FROM qualification_protected_feedback_heads_v1 WHERE frontier_identity = $1").bind(&projection_identity).execute(pool).await.unwrap();
            sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1")
                .bind(&projection_identity)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1").bind(&projection_identity).execute(pool).await.unwrap();
        }

        if let Some(basis_identity) = basis_identity {
            sqlx::query("DELETE FROM rd_independence_basis_heads_v1 WHERE basis_identity = $1")
                .bind(&basis_identity)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
                .bind(&basis_identity)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM rd_independence_bases_v1 WHERE basis_identity = $1")
                .bind(&basis_identity)
                .execute(pool)
                .await
                .unwrap();
        }
    }

    #[rstest]
    fn invocation_reservation_identity_excludes_only_the_mutable_state_digest() {
        let binding = StoredInvocationClaimBindingV1 {
            request_identity: "request-1".to_string(),
            admission_identity: "admission-1".to_string(),
            attempt_identity: "attempt-1".to_string(),
            claim_identity: "claim-1".to_string(),
            claim_digest: "sha256:claim-1".to_string(),
            invocation_admission_receipt_identity: "receipt-1".to_string(),
            invocation_admission_receipt_digest: "sha256:receipt-1".to_string(),
            claimed_state_digest: "sha256:claimed-state".to_string(),
            execution_custody_digest: String::new(),
            reservation_identity: String::new(),
            reservation_digest: String::new(),
            reserved_at_epoch_ms: 0,
        }
        .seal_reservation(10, "sha256:custody".to_string())
        .unwrap();
        let mut started = binding.clone();
        started.claimed_state_digest = "sha256:started-state".to_string();
        assert!(same_invocation_claim(&binding, &started));

        let mut foreign = started;
        foreign.claim_digest = "sha256:foreign-claim".to_string();
        assert!(!same_invocation_claim(&binding, &foreign));
    }

    #[rstest]
    fn invocation_execution_snapshot_rejects_tampered_custody() {
        let snapshot = StoredArtifactBuildInvocationSnapshotV1 {
            schema_version: 1,
            request: ArtifactBuildRequestV1 {
                build_request_identity: "request-1".to_string(),
                attempt_identity: "attempt-1".to_string(),
                intent_identity: "intent-1".to_string(),
                channel: ProductEdgeChannel::WindmillProductEdge,
                admission: ProductEdgeAdmissionLocatorV1 {
                    request_identity: "request-1".to_string(),
                    admission_identity: "admission-1".to_string(),
                    admission_digest: "sha256:admission-1".to_string(),
                },
            },
            request_semantic_digest: "sha256:request-1".to_string(),
            canonical_intent_bytes: "canonical-intent".to_string(),
            intent_semantic_digest: "sha256:intent-1".to_string(),
            research_request_identity: "research-1".to_string(),
            research_valid_through_epoch_ms: 20,
            trial_family_identity: "family-1".to_string(),
            trial_family_root_digest: "sha256:family-1".to_string(),
            census_frontier_identity: "census-1".to_string(),
            census_frontier_digest: "sha256:census-1".to_string(),
            claim_identity: "claim-1".to_string(),
            claim_digest: "sha256:claim-1".to_string(),
            invocation_admission_receipt_identity: "receipt-1".to_string(),
            invocation_admission_receipt_digest: "sha256:receipt-1".to_string(),
            claimed_state_digest: "sha256:state-1".to_string(),
            reserved_at_epoch_ms: 10,
            custody_digest: String::new(),
        }
        .seal()
        .unwrap();
        snapshot.verify_digest().unwrap();

        let mut tampered = snapshot.clone();
        tampered.trial_family_root_digest = "sha256:forged".to_string();
        assert!(tampered.verify_digest().is_err());
        let mut extended = serde_json::to_value(snapshot).unwrap();
        extended["caller_authority"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<StoredArtifactBuildInvocationSnapshotV1>(extended).is_err()
        );
    }
}
