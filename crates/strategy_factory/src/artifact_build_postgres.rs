use std::{fmt::Display, sync::Arc};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

use crate::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ARTIFACT_BUILD_SCOPE_V1,
        ARTIFACT_VIEW_SCOPE_V1, ArtifactBuildCandidateV1, ArtifactBuildDisposition,
        ArtifactBuildError, ArtifactBuildNextLegalAction, ArtifactBuildOwnerPort,
        ArtifactBuildPreparationV1, ArtifactBuildReceiptV1, ArtifactBuildRequestV1,
        ArtifactBuildResolution, ArtifactBuildResultV1, ArtifactBuildSandboxPort, ArtifactReviewV1,
        UnixArtifactBuildSandboxV1, artifact_review, build_receipt, build_request_semantic_digest,
        canonical_intent_bytes, issue_artifact, sandbox_request, validate_candidate,
        verify_sandbox_product,
    },
    product_edge::{
        FrozenResearchGoalIntentV1, ProductEdgeAdmissionPolicyV1, RESEARCH_OWNER_V1,
        ResearchNextLegalAction, ResearchRequestDisposition, ResearchRequestReceiptV1,
        ResearchViewAvailability, ResearchViewPhase, ResearchViewV1, TrustedProductEdgeContextV1,
    },
};

#[derive(Clone)]
pub struct PostgresArtifactBuildOwnerV1 {
    pool: PgPool,
    policy: ProductEdgeAdmissionPolicyV1,
    sandbox: Arc<dyn ArtifactBuildSandboxPort>,
    attempt_timeout_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum AttemptState {
    Prepared,
    Building,
    Terminal,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredAttemptV1 {
    schema_version: u32,
    request: ArtifactBuildRequestV1,
    request_semantic_digest: String,
    intent: Option<FrozenResearchGoalIntentV1>,
    state: AttemptState,
    candidate_digest: Option<String>,
    #[serde(default)]
    candidate: Option<ArtifactBuildCandidateV1>,
    prepared_at_epoch_ms: u64,
    receipt: Option<ArtifactBuildReceiptV1>,
    research_view: Option<ResearchViewV1>,
    artifact_review: Option<ArtifactReviewV1>,
}

impl PostgresArtifactBuildOwnerV1 {
    pub async fn connect(
        database_url: &str,
        policy: ProductEdgeAdmissionPolicyV1,
        sandbox_socket: &str,
        attempt_timeout_ms: u64,
    ) -> Result<Self, ArtifactBuildError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self {
            pool,
            policy,
            sandbox: Arc::new(UnixArtifactBuildSandboxV1::new(sandbox_socket)),
            attempt_timeout_ms,
        };
        owner.migrate().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), ArtifactBuildError> {
        for statement in [
            "CREATE TABLE IF NOT EXISTS rd_artifact_build_attempts_v1 (build_request_identity TEXT PRIMARY KEY, attempt_identity TEXT NOT NULL UNIQUE, semantic_digest TEXT NOT NULL, attempt_json JSONB NOT NULL, prepared_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rd_strategy_artifacts_v1 (artifact_digest TEXT PRIMARY KEY, intent_identity TEXT NOT NULL, attempt_identity TEXT NOT NULL UNIQUE, identity_json JSONB NOT NULL, wasm_bytes BYTEA NOT NULL, source_capsule BYTEA NOT NULL, build_recipe BYTEA NOT NULL, build_receipt_json JSONB NOT NULL, artifact_review_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        ] {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        }
        Ok(())
    }

    async fn load(
        &self,
        build_request_identity: &str,
    ) -> Result<Option<StoredAttemptV1>, ArtifactBuildError> {
        sqlx::query("SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
            .bind(build_request_identity)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?
            .map(|row| decode(row.try_get("attempt_json").map_err(storage)?))
            .transpose()
    }

    async fn terminal_no_artifact(
        &self,
        request: &ArtifactBuildRequestV1,
        failure_code: &str,
        disposition: ArtifactBuildDisposition,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock(&mut transaction, &request.build_request_identity).await?;
        let row = sqlx::query("SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 FOR UPDATE")
            .bind(&request.build_request_identity)
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
        let mut attempt: StoredAttemptV1 = decode(row.try_get("attempt_json").map_err(storage)?)?;
        if attempt.request.attempt_identity != request.attempt_identity {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if attempt.state == AttemptState::Terminal {
            transaction.commit().await.map_err(storage)?;
            return Ok(result(&attempt));
        }
        attempt.state = AttemptState::Terminal;
        attempt.receipt = Some(no_artifact_receipt(
            &attempt,
            disposition,
            failure_code,
            current_epoch_ms()?,
        ));
        persist_attempt(&mut transaction, &attempt).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result(&attempt))
    }
}

#[async_trait]
impl ArtifactBuildOwnerPort for PostgresArtifactBuildOwnerV1 {
    async fn prepare(
        &self,
        request: ArtifactBuildRequestV1,
    ) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
        validate_context(&request.context, &self.policy)?;
        let semantic_digest = build_request_semantic_digest(&request)?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock_request_attempt(&mut transaction, &request).await?;
        if let Some(row) = sqlx::query("SELECT semantic_digest, attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 OR attempt_identity = $2 FOR UPDATE")
            .bind(&request.build_request_identity)
            .bind(&request.attempt_identity)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?
        {
            let existing_digest: String = row.try_get("semantic_digest").map_err(storage)?;
            let attempt: StoredAttemptV1 = decode(row.try_get("attempt_json").map_err(storage)?)?;
            if existing_digest != semantic_digest
                || attempt.request.build_request_identity != request.build_request_identity
                || attempt.request.attempt_identity != request.attempt_identity
            {
                return Err(ArtifactBuildError::ConflictingReplay);
            }
            transaction.commit().await.map_err(storage)?;
            return preparation(&attempt);
        }
        let row = sqlx::query("SELECT receipt_json, intent_json, view_json FROM rd_research_request_receipts_v1 WHERE intent_json ->> 'intent_identity' = $1")
            .bind(&request.intent_identity)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?;
        let now = current_epoch_ms()?;
        let (intent, view) = match row {
            Some(row) => {
                let receipt: ResearchRequestReceiptV1 =
                    decode(row.try_get("receipt_json").map_err(storage)?)?;

                if receipt.disposition == ResearchRequestDisposition::Accepted {
                    (
                        Some(decode(row.try_get("intent_json").map_err(storage)?)?),
                        Some(decode(row.try_get("view_json").map_err(storage)?)?),
                    )
                } else {
                    (None, None)
                }
            }
            None => (None, None),
        };
        let mut attempt = StoredAttemptV1 {
            schema_version: 1,
            request,
            request_semantic_digest: semantic_digest,
            intent,
            state: AttemptState::Prepared,
            candidate_digest: None,
            candidate: None,
            prepared_at_epoch_ms: now,
            receipt: None,
            research_view: view,
            artifact_review: None,
        };

        if attempt.intent.is_none() {
            attempt.state = AttemptState::Terminal;
            attempt.receipt = Some(no_artifact_receipt(
                &attempt,
                ArtifactBuildDisposition::RejectedNoWrite,
                "FOREIGN_OR_UNAVAILABLE_INTENT",
                now,
            ));
        }
        sqlx::query("INSERT INTO rd_artifact_build_attempts_v1 (build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(&attempt.request.build_request_identity)
            .bind(&attempt.request.attempt_identity)
            .bind(&attempt.request_semantic_digest)
            .bind(encode(&attempt)?)
            .bind(i64::try_from(now).map_err(json_storage)?)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        transaction.commit().await.map_err(storage)?;
        preparation(&attempt)
    }

    async fn submit_candidate(
        &self,
        request: ArtifactBuildRequestV1,
        candidate: ArtifactBuildCandidateV1,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        let prepared = self.prepare(request.clone()).await?;
        if !matches!(
            prepared.resolution,
            ArtifactBuildResolution::Prepared | ArtifactBuildResolution::SubmittedOrUnknown
        ) {
            return self
                .load(&request.build_request_identity)
                .await?
                .map(|attempt| result(&attempt))
                .ok_or_else(|| {
                    ArtifactBuildError::Storage("terminal attempt missing".to_string())
                });
        }
        let attempt = self
            .load(&request.build_request_identity)
            .await?
            .ok_or_else(|| ArtifactBuildError::Storage("prepared attempt missing".to_string()))?;
        let intent = attempt
            .intent
            .as_ref()
            .ok_or(ArtifactBuildError::Candidate("intent unavailable"))?;
        let digest = match validate_candidate(&candidate, intent) {
            Ok(digest) => digest,
            Err(ArtifactBuildError::Candidate(_)) => {
                return self
                    .terminal_no_artifact(
                        &request,
                        "CANDIDATE_MALFORMED",
                        ArtifactBuildDisposition::FailedNoArtifact,
                    )
                    .await;
            }
            Err(e) => return Err(e),
        };
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock(&mut transaction, &request.build_request_identity).await?;
        let row = sqlx::query("SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 FOR UPDATE")
            .bind(&request.build_request_identity)
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
        let mut current: StoredAttemptV1 = decode(row.try_get("attempt_json").map_err(storage)?)?;
        match current.state {
            AttemptState::Terminal => {
                transaction.commit().await.map_err(storage)?;
                return Ok(result(&current));
            }
            AttemptState::Building => {
                if current.candidate_digest.as_deref() != Some(&digest) {
                    return Err(ArtifactBuildError::ConflictingReplay);
                }
                transaction.commit().await.map_err(storage)?;
            }
            AttemptState::Prepared => {
                current.state = AttemptState::Building;
                current.candidate_digest = Some(digest.clone());
                current.candidate = Some(candidate.clone());
                persist_attempt(&mut transaction, &current).await?;
                transaction.commit().await.map_err(storage)?;
            }
        }
        let sandbox_request = sandbox_request(&candidate, &digest);
        let expected_source = sandbox_request.source.clone();
        let product = match self.sandbox.build(sandbox_request).await {
            Ok(product) => product,
            Err(_) => {
                return self
                    .terminal_no_artifact(
                        &request,
                        "DEVELOPMENT_SANDBOX_FAILED",
                        ArtifactBuildDisposition::FailedNoArtifact,
                    )
                    .await;
            }
        };
        let build = match verify_sandbox_product(&product, &expected_source) {
            Ok(build) => build,
            Err(_) => {
                return self
                    .terminal_no_artifact(
                        &request,
                        "ARTIFACT_SECURITY_ADMISSION_REJECTED",
                        ArtifactBuildDisposition::FailedNoArtifact,
                    )
                    .await;
            }
        };
        let intent_bytes = canonical_intent_bytes(intent)?;
        let artifact =
            issue_artifact(&intent_bytes, &request.attempt_identity, &candidate, &build)?;
        let build_receipt = build_receipt(
            &request.attempt_identity,
            &intent.intent_identity,
            &digest,
            &build,
            &artifact,
        );
        let review = artifact_review(intent, &candidate, &artifact, build_receipt.clone());
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock(&mut transaction, &request.build_request_identity).await?;
        let row = sqlx::query("SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 FOR UPDATE")
            .bind(&request.build_request_identity)
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
        let mut current: StoredAttemptV1 = decode(row.try_get("attempt_json").map_err(storage)?)?;
        if current.state == AttemptState::Terminal {
            transaction.commit().await.map_err(storage)?;
            return Ok(result(&current));
        }

        if current.state != AttemptState::Building
            || current.candidate_digest.as_deref() != Some(&digest)
        {
            return Err(ArtifactBuildError::ConflictingReplay);
        }
        let now = current_epoch_ms()?;
        let mut view = current
            .research_view
            .clone()
            .ok_or_else(|| ArtifactBuildError::Storage("research view missing".to_string()))?;
        view.phase = ResearchViewPhase::ArtifactAvailable;
        view.availability = ResearchViewAvailability::Available;
        view.artifact_identity = Some(artifact.identity().artifact_digest.clone());
        view.build_receipt_identity = Some(build_receipt.build_receipt_identity.clone());
        view.artifact_review_identity = Some(review.review_identity.clone());
        view.next_legal_action = ResearchNextLegalAction::ReviewArtifact;
        view.source_cut = format!("rd-artifact-cut-v1-{}", artifact.identity().artifact_digest);
        view.observed_at_epoch_ms = now;
        view.projection_at_epoch_ms = now;
        view.valid_through_epoch_ms = now.saturating_add(600_000);
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
            intent_identity: Some(intent.intent_identity.clone()),
            intent_semantic_digest: Some(intent.semantic_digest.clone()),
            disposition: ArtifactBuildDisposition::Success,
            artifact_identity: Some(artifact.identity().artifact_digest.clone()),
            build_receipt_identity: Some(build_receipt.build_receipt_identity.clone()),
            failure_code: None,
            committed_at_epoch_ms: now,
        };
        sqlx::query("INSERT INTO rd_strategy_artifacts_v1 (artifact_digest, intent_identity, attempt_identity, identity_json, wasm_bytes, source_capsule, build_recipe, build_receipt_json, artifact_review_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&artifact.identity().artifact_digest)
            .bind(&intent.intent_identity)
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
        sqlx::query("UPDATE rd_research_request_receipts_v1 SET view_json = $1 WHERE intent_json ->> 'intent_identity' = $2")
            .bind(encode(&view)?)
            .bind(&intent.intent_identity)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        current.state = AttemptState::Terminal;
        current.receipt = Some(receipt);
        current.research_view = Some(view);
        current.artifact_review = Some(review);
        persist_attempt(&mut transaction, &current).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result(&current))
    }

    async fn fail_no_artifact(
        &self,
        request: ArtifactBuildRequestV1,
        failure_code: &str,
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
        self.prepare(request.clone()).await?;
        self.terminal_no_artifact(
            &request,
            failure_code,
            ArtifactBuildDisposition::FailedNoArtifact,
        )
        .await
    }

    async fn resolve(
        &self,
        build_request_identity: &str,
        attempt_identity: &str,
        context: &TrustedProductEdgeContextV1,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        validate_context(context, &self.policy)?;
        let Some(attempt) = self.load(build_request_identity).await? else {
            return Ok(unknown_result(build_request_identity, attempt_identity));
        };

        if attempt.request.attempt_identity != attempt_identity {
            return Err(ArtifactBuildError::ConflictingReplay);
        }

        if attempt.state != AttemptState::Terminal
            && current_epoch_ms()?.saturating_sub(attempt.prepared_at_epoch_ms)
                > self.attempt_timeout_ms
        {
            return self
                .terminal_no_artifact(
                    &attempt.request,
                    "ATTEMPT_CUSTODY_EXPIRED",
                    ArtifactBuildDisposition::OutcomeUnknown,
                )
                .await;
        }

        if attempt.state == AttemptState::Building {
            let candidate = attempt.candidate.clone().ok_or_else(|| {
                ArtifactBuildError::Storage("building candidate missing".to_string())
            })?;
            return self
                .submit_candidate(attempt.request.clone(), candidate)
                .await;
        }
        Ok(result(&attempt))
    }
}

fn validate_context(
    context: &TrustedProductEdgeContextV1,
    policy: &ProductEdgeAdmissionPolicyV1,
) -> Result<(), ArtifactBuildError> {
    if context.effective_principal != policy.effective_principal
        || context.permissioned_as != policy.permissioned_as
        || context.authorized_scope
            != [
                ARTIFACT_BUILD_SCOPE_V1.to_string(),
                ARTIFACT_VIEW_SCOPE_V1.to_string(),
            ]
        || context.shell_binding_identity != policy.shell_binding_identity
        || context.shell_history_head != policy.shell_history_head
        || context.shell_binding_generation != 1
        || context.shell_binding_state != "ACTIVE"
        || context.authorization_identity != policy.authorization_identity
        || context.authorization_policy_version != policy.authorization_policy_version
        || context.manifest_identity != policy.manifest_identity
        || context.manifest_version != policy.manifest_version
        || context.capability_policy_version != policy.capability_policy_version
        || context.audit_policy_version != policy.audit_policy_version
        || context.target_owner != RESEARCH_OWNER_V1
        || context.target_operation != ARTIFACT_BUILD_OPERATION_V1
        || context.operation_schema != ARTIFACT_BUILD_SCHEMA_V1
    {
        return Err(ArtifactBuildError::Unauthorized(
            "artifact operation lineage",
        ));
    }
    Ok(())
}

fn preparation(
    attempt: &StoredAttemptV1,
) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
    if attempt.state == AttemptState::Terminal {
        let result = result(attempt);
        return Ok(ArtifactBuildPreparationV1 {
            schema_version: 1,
            resolution: result.resolution,
            build_request_identity: result.build_request_identity,
            attempt_identity: result.attempt_identity,
            semantic_digest: attempt.request_semantic_digest.clone(),
            canonical_intent_bytes: None,
            intent_identity: attempt
                .intent
                .as_ref()
                .map(|intent| intent.intent_identity.clone()),
            intent_semantic_digest: attempt
                .intent
                .as_ref()
                .map(|intent| intent.semantic_digest.clone()),
            owner_receipt: result.owner_receipt,
            next_legal_action: result.next_legal_action,
        });
    }
    let (resolution, next) = if attempt.state == AttemptState::Prepared {
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
        semantic_digest: attempt.request_semantic_digest.clone(),
        canonical_intent_bytes: attempt
            .intent
            .as_ref()
            .map(canonical_intent_bytes)
            .transpose()?
            .map(String::from_utf8)
            .transpose()
            .map_err(json_storage)?,
        intent_identity: attempt
            .intent
            .as_ref()
            .map(|intent| intent.intent_identity.clone()),
        intent_semantic_digest: attempt
            .intent
            .as_ref()
            .map(|intent| intent.semantic_digest.clone()),
        owner_receipt: None,
        next_legal_action: next,
    })
}

fn result(attempt: &StoredAttemptV1) -> ArtifactBuildResultV1 {
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
    ArtifactBuildResultV1 {
        schema_version: 1,
        resolution,
        build_request_identity: attempt.request.build_request_identity.clone(),
        attempt_identity: attempt.request.attempt_identity.clone(),
        owner_receipt: attempt.receipt.clone(),
        research_view: attempt.research_view.clone(),
        artifact_review: attempt.artifact_review.clone(),
        next_legal_action: next,
    }
}

fn unknown_result(build_request_identity: &str, attempt_identity: &str) -> ArtifactBuildResultV1 {
    ArtifactBuildResultV1 {
        schema_version: 1,
        resolution: ArtifactBuildResolution::SubmittedOrUnknown,
        build_request_identity: build_request_identity.to_string(),
        attempt_identity: attempt_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        artifact_review: None,
        next_legal_action: ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
    }
}

fn no_artifact_receipt(
    attempt: &StoredAttemptV1,
    disposition: ArtifactBuildDisposition,
    failure_code: &str,
    now: u64,
) -> ArtifactBuildReceiptV1 {
    let suffix = format!(
        "{:x}",
        Sha256::digest(format!("{}:{failure_code}", attempt.request_semantic_digest).as_bytes())
    );
    ArtifactBuildReceiptV1 {
        schema_version: 1,
        receipt_identity: format!("rd-artifact-build-receipt-v1-{suffix}"),
        build_request_identity: attempt.request.build_request_identity.clone(),
        attempt_identity: attempt.request.attempt_identity.clone(),
        request_semantic_digest: attempt.request_semantic_digest.clone(),
        intent_identity: attempt
            .intent
            .as_ref()
            .map(|intent| intent.intent_identity.clone()),
        intent_semantic_digest: attempt
            .intent
            .as_ref()
            .map(|intent| intent.semantic_digest.clone()),
        disposition,
        artifact_identity: None,
        build_receipt_identity: None,
        failure_code: Some(failure_code.to_string()),
        committed_at_epoch_ms: now,
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
    attempt: &StoredAttemptV1,
) -> Result<(), ArtifactBuildError> {
    sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = $1 WHERE build_request_identity = $2")
        .bind(encode(attempt)?)
        .bind(&attempt.request.build_request_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn encode(value: &impl Serialize) -> Result<serde_json::Value, ArtifactBuildError> {
    serde_json::to_value(value).map_err(json_storage)
}

fn decode<T: for<'de> Deserialize<'de>>(value: serde_json::Value) -> Result<T, ArtifactBuildError> {
    serde_json::from_value(value).map_err(json_storage)
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
