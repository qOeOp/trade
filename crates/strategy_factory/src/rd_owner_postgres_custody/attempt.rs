use super::*;
use crate::{
    artifact_build::{
        ArtifactBuildCandidateV1, ArtifactBuildDisposition, ArtifactBuildError,
        ArtifactBuildReceiptV1, ArtifactBuildRequestV1, ArtifactReviewV1, BuildReceiptV1,
        SandboxBuildProductV1, StoredArtifactBuildInvocationSnapshotV1, artifact_review,
        build_receipt, build_request_semantic_digest, canonical_intent_bytes, issue_artifact,
        render_program_source, validate_candidate, verify_artifact_build_admission,
        verify_sandbox_product,
    },
    trial_family::{ArtifactTrialFamilyReadbackV1, TrialFamilyError},
    trial_family_postgres::load_artifact_trial_family_in_transaction,
};
use serde::{Deserialize, Serialize};
use vibe_product_edge::ProductEdgeAdmissionLocatorV1;

mod invocation_reservation;

pub(crate) use invocation_reservation::StoredInvocationClaimBindingV1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum AttemptState {
    Prepared,
    InvocationReserved,
    Building,
    Terminal,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StoredAttemptV1 {
    pub(crate) schema_version: u32,
    pub(crate) request: ArtifactBuildRequestV1,
    pub(crate) request_semantic_digest: String,
    pub(crate) state: AttemptState,
    pub(crate) candidate_digest: Option<String>,
    #[serde(default)]
    pub(crate) candidate: Option<ArtifactBuildCandidateV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) invocation_claim: Option<StoredInvocationClaimBindingV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) invocation_custody: Option<StoredArtifactBuildInvocationSnapshotV1>,
    pub(crate) prepared_at_epoch_ms: u64,
    pub(crate) receipt: Option<ArtifactBuildReceiptV1>,
}

pub(crate) struct VerifiedAttemptCustodyV1 {
    pub(crate) attempt: StoredAttemptV1,
    pub(crate) research: VerifiedResearchCustodyV1,
    pub(crate) product_edge_admission: ProductEdgeAdmissionReadbackV1,
    pub(crate) artifact_review: Option<ArtifactReviewV1>,
    pub(crate) artifact_family: Option<ArtifactTrialFamilyReadbackV1>,
}

impl VerifiedAttemptCustodyV1 {
    pub(crate) async fn admit_for_exploratory_replay_in_transaction(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        build_request_identity: &str,
        replay_admission: &ProductEdgeAdmissionLocatorV1,
        read_cut_epoch_ms: u64,
    ) -> Result<Option<(Self, ProductEdgeAdmissionReadbackV1)>, ArtifactBuildError> {
        let hint_rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
            .bind(build_request_identity)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;

        if hint_rows.is_empty() {
            return Ok(None);
        }

        if hint_rows.len() != 1 {
            return Err(ArtifactBuildError::Storage(
                "replay attempt custody locator is ambiguous".into(),
            ));
        }

        let hint = decode_attempt_row(&hint_rows[0], build_request_identity)?;
        let (replay, artifact) = Self::lock_exploratory_replay_admissions_in_transaction(
            transaction,
            replay_admission,
            &hint.request.admission,
            read_cut_epoch_ms,
        )
        .await?;
        verify_artifact_build_admission(&artifact, &hint.request)?;

        // Both mutation admissions are locked before any R&D row lock. Research
        // custody then preloads its own Product Edge admissions before its FOR UPDATE cut.
        let research = admit_research_row_in_transaction(
            transaction,
            ResearchCustodyLookupV1::Intent(hint.request.intent_identity.as_str()),
        )
        .await
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?
        .ok_or_else(|| ArtifactBuildError::Storage("attempt research custody missing".into()))?;
        let custody = Box::pin(admit_attempt_with_research_in_transaction(
            transaction,
            build_request_identity,
            research,
            artifact,
        ))
        .await?
        .ok_or_else(|| ArtifactBuildError::Storage("attempt custody missing".into()))?;
        verify_attempt_authority(&replay, &custody.product_edge_admission)?;
        verify_attempt_authority(
            &replay,
            custody.research.product_edge_admission().ok_or_else(|| {
                ArtifactBuildError::Storage("research Product Edge admission missing".into())
            })?,
        )?;
        Ok(Some((custody, replay)))
    }

    pub(crate) async fn lock_exploratory_replay_admissions_in_transaction(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        replay_admission: &ProductEdgeAdmissionLocatorV1,
        artifact_admission: &ProductEdgeAdmissionLocatorV1,
        read_cut_epoch_ms: u64,
    ) -> Result<
        (
            ProductEdgeAdmissionReadbackV1,
            ProductEdgeAdmissionReadbackV1,
        ),
        ArtifactBuildError,
    > {
        let mut locators = [(false, replay_admission), (true, artifact_admission)];
        locators.sort_by(|left, right| {
            (
                &left.1.request_identity,
                &left.1.admission_identity,
                &left.1.admission_digest,
                left.0,
            )
                .cmp(&(
                    &right.1.request_identity,
                    &right.1.admission_identity,
                    &right.1.admission_digest,
                    right.0,
                ))
        });

        let mut replay = None;
        let mut artifact = None;

        for (is_artifact, locator) in locators {
            let admission = resolve_admission_for_downstream_in_transaction(
                transaction,
                locator,
                DownstreamAdmissionModeV1::FirstMutation { read_cut_epoch_ms },
            )
            .await
            .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
            if is_artifact {
                artifact = Some(admission);
            } else {
                replay = Some(admission);
            }
        }

        let replay = replay.ok_or_else(|| {
            ArtifactBuildError::Storage("replay Product Edge admission missing".into())
        })?;
        let artifact = artifact.ok_or_else(|| {
            ArtifactBuildError::Storage("artifact Product Edge admission missing".into())
        })?;
        Ok((replay, artifact))
    }
}

pub(crate) struct VerifiedAttemptReservationHeaderV1 {
    pub(crate) attempt: StoredAttemptV1,
}

pub(crate) async fn admit_attempt_reservation_header_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_request_identity: &str,
) -> Result<Option<VerifiedAttemptReservationHeaderV1>, ArtifactBuildError> {
    let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 FOR UPDATE")
        .bind(build_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "attempt reservation locator is ambiguous".to_string(),
        ));
    }
    let attempt = decode_attempt_row(&rows[0], build_request_identity)?;
    let product_edge_admission = resolve_admission_for_downstream_in_transaction(
        transaction,
        &attempt.request.admission,
        DownstreamAdmissionModeV1::Historical,
    )
    .await
    .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
    verify_artifact_build_admission(&product_edge_admission, &attempt.request)?;
    Ok(Some(VerifiedAttemptReservationHeaderV1 { attempt }))
}
pub(crate) async fn admit_attempt_custody_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_request_identity: &str,
) -> Result<Option<VerifiedAttemptCustodyV1>, ArtifactBuildError> {
    Box::pin(admit_attempt_custody_with_admission_mode_in_transaction(
        transaction,
        build_request_identity,
        DownstreamAdmissionModeV1::Historical,
    ))
    .await
}

pub(crate) async fn admit_attempt_custody_with_admission_mode_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_request_identity: &str,
    admission_mode: DownstreamAdmissionModeV1,
) -> Result<Option<VerifiedAttemptCustodyV1>, ArtifactBuildError> {
    let hint_rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
        .bind(build_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if hint_rows.is_empty() {
        return Ok(None);
    }

    if hint_rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "attempt custody locator is ambiguous".to_string(),
        ));
    }
    let hint = decode_attempt_row(&hint_rows[0], build_request_identity)?;
    let product_edge_admission = resolve_admission_for_downstream_in_transaction(
        transaction,
        &hint.request.admission,
        admission_mode,
    )
    .await
    .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
    verify_artifact_build_admission(&product_edge_admission, &hint.request)?;
    let intent_identity = hint.request.intent_identity.as_str();
    let research = admit_research_row_in_transaction(
        transaction,
        ResearchCustodyLookupV1::Intent(intent_identity),
    )
    .await
    .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?
    .ok_or_else(|| ArtifactBuildError::Storage("attempt research custody missing".to_string()))?;
    Box::pin(admit_attempt_with_research_in_transaction(
        transaction,
        build_request_identity,
        research,
        product_edge_admission,
    ))
    .await
}

pub(crate) async fn admit_attempt_custody_for_request_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Result<Option<VerifiedAttemptCustodyV1>, ArtifactBuildError> {
    let rows = sqlx::query("SELECT build_request_identity FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 OR attempt_identity = $2")
        .bind(build_request_identity)
        .bind(attempt_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "attempt request locator is ambiguous".to_string(),
        ));
    }
    let canonical_request_identity: String =
        rows[0].try_get("build_request_identity").map_err(storage)?;
    Box::pin(admit_attempt_custody_in_transaction(
        transaction,
        &canonical_request_identity,
    ))
    .await
}

pub(crate) async fn admit_attempt_with_research_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_request_identity: &str,
    mut research: VerifiedResearchCustodyV1,
    product_edge_admission: ProductEdgeAdmissionReadbackV1,
) -> Result<Option<VerifiedAttemptCustodyV1>, ArtifactBuildError> {
    let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1 FOR UPDATE")
        .bind(build_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "attempt custody lookup is ambiguous".to_string(),
        ));
    }
    let attempt = decode_attempt_row(&rows[0], build_request_identity)?;
    verify_artifact_build_admission(&product_edge_admission, &attempt.request)?;
    let intent = research.intent().ok_or_else(|| {
        ArtifactBuildError::Storage("attempt research intent missing".to_string())
    })?;

    if research
        .receipt()
        .resulting_research_intent_identity
        .as_deref()
        != Some(attempt.request.intent_identity.as_str())
        || intent.intent_identity() != attempt.request.intent_identity
    {
        return Err(ArtifactBuildError::Storage(
            "attempt research custody mismatch".to_string(),
        ));
    }
    verify_attempt_authority(
        &product_edge_admission,
        research.product_edge_admission().ok_or_else(|| {
            ArtifactBuildError::Storage("attempt research Product Edge admission missing".into())
        })?,
    )?;

    let (artifact_family, artifact_review) = match attempt.state {
        AttemptState::Prepared => {
            if attempt.receipt.is_some()
                || attempt.candidate_digest.is_some()
                || attempt.candidate.is_some()
                || attempt.invocation_claim.is_some()
                || attempt.invocation_custody.is_some()
            {
                return Err(ArtifactBuildError::Storage(
                    "prepared attempt state mismatch".to_string(),
                ));
            }
            load_research_family_for_attempt(transaction, &mut research).await?;
            (None, None)
        }
        AttemptState::InvocationReserved => {
            if attempt.receipt.is_some()
                || attempt.candidate_digest.is_some()
                || attempt.candidate.is_some()
                || !attempt.invocation_claim.as_ref().is_some_and(|binding| {
                    binding.is_complete() && binding.matches_request(&attempt.request)
                })
                || attempt.invocation_custody.is_none()
            {
                return Err(ArtifactBuildError::Storage(
                    "reserved invocation attempt state mismatch".to_string(),
                ));
            }
            verify_invocation_custody_binding(&attempt)?;
            load_research_family_for_attempt(transaction, &mut research).await?;
            (None, None)
        }
        AttemptState::Building => {
            if attempt.invocation_claim.as_ref().is_some_and(|binding| {
                !binding.is_complete() || !binding.matches_request(&attempt.request)
            }) {
                return Err(ArtifactBuildError::Storage(
                    "building invocation claim binding mismatch".to_string(),
                ));
            }
            verify_invocation_custody_binding(&attempt)?;
            verify_candidate_custody(&attempt, intent)?;
            if attempt.receipt.is_some() {
                return Err(ArtifactBuildError::Storage(
                    "building attempt state mismatch".to_string(),
                ));
            }
            load_research_family_for_attempt(transaction, &mut research).await?;
            (None, None)
        }
        AttemptState::Terminal => {
            if attempt.invocation_claim.as_ref().is_some_and(|binding| {
                !binding.is_complete() || !binding.matches_request(&attempt.request)
            }) {
                return Err(ArtifactBuildError::Storage(
                    "terminal invocation claim binding mismatch".to_string(),
                ));
            }
            verify_invocation_custody_binding(&attempt)?;
            let receipt = attempt.receipt.as_ref().ok_or_else(|| {
                ArtifactBuildError::Storage("terminal attempt receipt missing".to_string())
            })?;

            if receipt.disposition == ArtifactBuildDisposition::Success {
                let (family, review) =
                    verify_terminal_success_in_transaction(transaction, &attempt, &mut research)
                        .await?;
                (family, Some(review))
            } else {
                verify_terminal_without_artifact_in_transaction(transaction, &attempt, &research)
                    .await?;
                load_research_family_for_attempt(transaction, &mut research).await?;
                (None, None)
            }
        }
    };

    Ok(Some(VerifiedAttemptCustodyV1 {
        attempt,
        research,
        product_edge_admission,
        artifact_review,
        artifact_family,
    }))
}

pub(super) async fn admit_terminal_attempt_for_research_view(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    research: VerifiedResearchCustodyV1,
    product_edge_admission: ProductEdgeAdmissionReadbackV1,
) -> Result<VerifiedAttemptCustodyV1, ArtifactBuildError> {
    let view = research
        .view()
        .ok_or_else(|| ArtifactBuildError::Storage("terminal research view missing".to_string()))?;
    let artifact_identity = view.artifact_identity.clone().ok_or_else(|| {
        ArtifactBuildError::Storage("terminal research artifact missing".to_string())
    })?;
    let build_receipt_identity = view.build_receipt_identity.clone().ok_or_else(|| {
        ArtifactBuildError::Storage("terminal research build receipt missing".to_string())
    })?;
    let attempt_identity = view.attempt_identity.as_deref().ok_or_else(|| {
        ArtifactBuildError::Storage("terminal research attempt identity missing".to_string())
    })?;
    let rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE attempt_identity = $1")
        .bind(attempt_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "terminal research attempt locator unavailable".to_string(),
        ));
    }
    let build_request_identity: String =
        rows[0].try_get("build_request_identity").map_err(storage)?;
    let hint = decode_attempt_row(&rows[0], &build_request_identity)?;
    if product_edge_admission.locator() != &hint.request.admission {
        return Err(ArtifactBuildError::Storage(
            "terminal attempt Product Edge authority mismatch".into(),
        ));
    }
    verify_artifact_build_admission(&product_edge_admission, &hint.request)?;
    let custody = Box::pin(admit_attempt_with_research_in_transaction(
        transaction,
        &build_request_identity,
        research,
        product_edge_admission,
    ))
    .await?
    .ok_or_else(|| ArtifactBuildError::Storage("terminal research attempt missing".to_string()))?;
    let receipt = custody.attempt.receipt.as_ref().ok_or_else(|| {
        ArtifactBuildError::Storage("terminal research receipt missing".to_string())
    })?;

    if custody.attempt.state != AttemptState::Terminal
        || receipt.disposition != ArtifactBuildDisposition::Success
        || receipt.artifact_identity.as_deref() != Some(artifact_identity.as_str())
        || receipt.build_receipt_identity.as_deref() != Some(build_receipt_identity.as_str())
    {
        return Err(ArtifactBuildError::Storage(
            "terminal research attempt mismatch".to_string(),
        ));
    }
    Ok(custody)
}

async fn load_research_family_for_attempt(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    research: &mut VerifiedResearchCustodyV1,
) -> Result<(), ArtifactBuildError> {
    load_research_family_in_transaction(transaction, research)
        .await
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))
}

pub(crate) fn decode_attempt_row(
    row: &sqlx::postgres::PgRow,
    expected_build_request_identity: &str,
) -> Result<StoredAttemptV1, ArtifactBuildError> {
    let row_build_request_identity: String =
        row.try_get("build_request_identity").map_err(storage)?;
    let row_attempt_identity: String = row.try_get("attempt_identity").map_err(storage)?;
    let row_semantic_digest: String = row.try_get("semantic_digest").map_err(storage)?;
    let row_prepared_at: i64 = row.try_get("prepared_at_epoch_ms").map_err(storage)?;
    let attempt: StoredAttemptV1 = decode(&row.try_get("attempt_json").map_err(storage)?)?;
    let recomputed_digest = build_request_semantic_digest(&attempt.request)
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;

    if row_build_request_identity != expected_build_request_identity
        || attempt.schema_version != 1
        || attempt.request.build_request_identity != row_build_request_identity
        || attempt.request.attempt_identity != row_attempt_identity
        || attempt.request_semantic_digest != row_semantic_digest
        || recomputed_digest != row_semantic_digest
        || i64::try_from(attempt.prepared_at_epoch_ms).map_err(json_storage)? != row_prepared_at
    {
        return Err(ArtifactBuildError::Storage(
            "attempt custody row mismatch".to_string(),
        ));
    }
    Ok(attempt)
}

fn verify_candidate_custody(
    attempt: &StoredAttemptV1,
    intent: &FrozenResearchGoalIntent,
) -> Result<(), ArtifactBuildError> {
    let candidate = attempt
        .candidate
        .as_ref()
        .ok_or_else(|| ArtifactBuildError::Storage("candidate missing".to_string()))?;
    let digest = validate_candidate(candidate, intent)
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;

    if attempt.candidate_digest.as_deref() != Some(digest.as_str()) {
        return Err(ArtifactBuildError::Storage(
            "candidate custody digest mismatch".to_string(),
        ));
    }
    Ok(())
}

fn verify_invocation_custody_binding(attempt: &StoredAttemptV1) -> Result<(), ArtifactBuildError> {
    match (&attempt.invocation_claim, &attempt.invocation_custody) {
        (None, None) => Ok(()),
        (Some(binding), Some(snapshot)) => {
            snapshot.verify_digest()?;

            if !binding.is_complete()
                || !binding.matches_request(&attempt.request)
                || snapshot.request != attempt.request
                || snapshot.request_semantic_digest != attempt.request_semantic_digest
                || snapshot.claim_identity != binding.claim_identity
                || snapshot.claim_digest != binding.claim_digest
                || snapshot.invocation_admission_receipt_identity
                    != binding.invocation_admission_receipt_identity
                || snapshot.invocation_admission_receipt_digest
                    != binding.invocation_admission_receipt_digest
                || snapshot.claimed_state_digest != binding.claimed_state_digest
                || snapshot.reserved_at_epoch_ms != binding.reserved_at_epoch_ms
                || snapshot.custody_digest != binding.execution_custody_digest
            {
                return Err(ArtifactBuildError::Storage(
                    "invocation custody binding mismatch".to_string(),
                ));
            }
            Ok(())
        }
        _ => Err(ArtifactBuildError::Storage(
            "invocation custody binding unavailable".to_string(),
        )),
    }
}

fn verify_attempt_authority(
    attempt: &ProductEdgeAdmissionReadbackV1,
    research: &ProductEdgeAdmissionReadbackV1,
) -> Result<(), ArtifactBuildError> {
    let shared = attempt.deployment_identity() == research.deployment_identity()
        && attempt.binding_identity() == research.binding_identity()
        && attempt.binding_generation() == research.binding_generation()
        && attempt.effective_principal() == research.effective_principal()
        && attempt.scope_policy_version() == research.scope_policy_version()
        && attempt.capability_policy_version() == research.capability_policy_version()
        && attempt.audit_policy_version() == research.audit_policy_version()
        && attempt.authorization().locator() == research.authorization().locator();

    if shared {
        Ok(())
    } else {
        Err(ArtifactBuildError::Storage(
            "attempt authorization custody mismatch".to_string(),
        ))
    }
}

async fn verify_terminal_without_artifact_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    attempt: &StoredAttemptV1,
    research: &VerifiedResearchCustodyV1,
) -> Result<(), ArtifactBuildError> {
    match (&attempt.candidate_digest, &attempt.candidate) {
        (Some(_), Some(_)) => verify_candidate_custody(
            attempt,
            research.intent().ok_or_else(|| {
                ArtifactBuildError::Storage("terminal research intent missing".to_string())
            })?,
        )?,
        (None, None) => {}
        _ => {
            return Err(ArtifactBuildError::Storage(
                "terminal candidate custody mismatch".to_string(),
            ));
        }
    }
    let receipt = attempt.receipt.as_ref().ok_or_else(|| {
        ArtifactBuildError::Storage("terminal attempt receipt missing".to_string())
    })?;
    let failure_code = receipt
        .failure_code
        .as_deref()
        .ok_or_else(|| ArtifactBuildError::Storage("terminal failure code missing".to_string()))?;

    if receipt
        != &no_artifact_receipt(
            attempt,
            research,
            failure_code,
            receipt.committed_at_epoch_ms,
        )?
        || receipt.disposition == ArtifactBuildDisposition::Success
        || receipt.artifact_identity.is_some()
        || receipt.build_receipt_identity.is_some()
    {
        return Err(ArtifactBuildError::Storage(
            "terminal no-artifact custody mismatch".to_string(),
        ));
    }
    let rows = sqlx::query(
        "SELECT artifact_digest FROM rd_strategy_artifacts_v1 WHERE attempt_identity = $1 FOR SHARE",
    )
    .bind(&attempt.request.attempt_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if !rows.is_empty() {
        return Err(ArtifactBuildError::Storage(
            "terminal no-artifact attempt owns an artifact".to_string(),
        ));
    }
    Ok(())
}

async fn verify_terminal_success_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    attempt: &StoredAttemptV1,
    research: &mut VerifiedResearchCustodyV1,
) -> Result<(Option<ArtifactTrialFamilyReadbackV1>, ArtifactReviewV1), ArtifactBuildError> {
    let intent = research.intent().cloned().ok_or_else(|| {
        ArtifactBuildError::Storage("successful research intent missing".to_string())
    })?;
    verify_candidate_custody(attempt, &intent)?;
    let receipt = attempt.receipt.as_ref().ok_or_else(|| {
        ArtifactBuildError::Storage("successful attempt receipt missing".to_string())
    })?;
    let artifact_identity = receipt.artifact_identity.as_deref().ok_or_else(|| {
        ArtifactBuildError::Storage("successful artifact identity missing".to_string())
    })?;
    let build_receipt_identity = receipt.build_receipt_identity.as_deref().ok_or_else(|| {
        ArtifactBuildError::Storage("successful build receipt identity missing".to_string())
    })?;
    let rows = sqlx::query("SELECT artifact_digest, intent_identity, attempt_identity, identity_json, wasm_bytes, source_capsule, build_recipe, build_receipt_json, artifact_review_json, committed_at_epoch_ms FROM rd_strategy_artifacts_v1 WHERE artifact_digest = $1 FOR SHARE")
        .bind(artifact_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(ArtifactBuildError::Storage(
            "successful artifact custody missing".to_string(),
        ));
    }
    let row = &rows[0];
    let row_artifact_identity: String = row.try_get("artifact_digest").map_err(storage)?;
    let row_intent_identity: String = row.try_get("intent_identity").map_err(storage)?;
    let row_attempt_identity: String = row.try_get("attempt_identity").map_err(storage)?;
    let row_committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let identity: crate::artifact::StrategyArtifactIdentity =
        decode(&row.try_get("identity_json").map_err(storage)?)?;
    let wasm: Vec<u8> = row.try_get("wasm_bytes").map_err(storage)?;
    let source_capsule: Vec<u8> = row.try_get("source_capsule").map_err(storage)?;
    let build_recipe: Vec<u8> = row.try_get("build_recipe").map_err(storage)?;
    let stored_build_receipt: BuildReceiptV1 =
        decode(&row.try_get("build_receipt_json").map_err(storage)?)?;
    let review: ArtifactReviewV1 = decode(&row.try_get("artifact_review_json").map_err(storage)?)?;
    let expected_owner_receipt_identity = format!(
        "rd-artifact-build-receipt-v1-{}",
        artifact_identity.trim_start_matches("blake3:")
    );
    let expected_build_receipt_identity = format!(
        "rd-build-receipt-v1-{}",
        artifact_identity.trim_start_matches("blake3:")
    );
    let expected_review_identity = format!(
        "rd-artifact-review-v1-{}",
        artifact_identity.trim_start_matches("blake3:")
    );
    let candidate = attempt
        .candidate
        .as_ref()
        .ok_or_else(|| ArtifactBuildError::Storage("successful candidate missing".to_string()))?;
    let candidate_digest = attempt.candidate_digest.as_deref().ok_or_else(|| {
        ArtifactBuildError::Storage("successful candidate digest missing".to_string())
    })?;
    let expected_source = render_program_source(candidate, candidate_digest);
    let verified_build = verify_sandbox_product(
        &SandboxBuildProductV1 {
            source_capsule: source_capsule.clone(),
            build_recipe: build_recipe.clone(),
            wasm_one: wasm.clone(),
            wasm_two: wasm.clone(),
        },
        &expected_source,
    )?;
    let expected_artifact = issue_artifact(
        &canonical_intent_bytes(&intent)?,
        &attempt.request.attempt_identity,
        candidate,
        &verified_build,
    )?;
    let expected_identity = expected_artifact.identity();
    let expected_build_receipt = build_receipt(
        &attempt.request.attempt_identity,
        intent.intent_identity(),
        candidate_digest,
        &verified_build,
        &expected_artifact,
    );
    let expected_review = artifact_review(
        &intent,
        candidate,
        &expected_artifact,
        expected_build_receipt.clone(),
    );

    if receipt.schema_version != 1
        || receipt.receipt_identity != expected_owner_receipt_identity
        || receipt.build_request_identity != attempt.request.build_request_identity
        || receipt.attempt_identity != attempt.request.attempt_identity
        || receipt.request_semantic_digest != attempt.request_semantic_digest
        || receipt.intent_identity.as_deref() != Some(intent.intent_identity())
        || receipt.intent_semantic_digest.as_deref() != Some(intent.semantic_digest())
        || receipt.disposition != ArtifactBuildDisposition::Success
        || receipt.failure_code.is_some()
        || row_artifact_identity != artifact_identity
        || row_intent_identity != intent.intent_identity()
        || row_attempt_identity != attempt.request.attempt_identity
        || i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)? != row_committed_at
        || &identity != expected_identity
        || identity.artifact_digest != artifact_identity
        || stored_build_receipt != expected_build_receipt
        || stored_build_receipt.build_receipt_identity != build_receipt_identity
        || stored_build_receipt.build_receipt_identity != expected_build_receipt_identity
        || review != expected_review
        || review.review_identity != expected_review_identity
        || research.view().is_none_or(|view| {
            view.attempt_identity.as_deref() != Some(attempt.request.attempt_identity.as_str())
                || view.artifact_identity.as_deref() != Some(artifact_identity)
                || view.build_receipt_identity.as_deref() != Some(build_receipt_identity)
                || view.artifact_review_identity.as_deref() != Some(review.review_identity.as_str())
                || view.observed_at_epoch_ms != receipt.committed_at_epoch_ms
                || view.projection_at_epoch_ms != receipt.committed_at_epoch_ms
                || view.valid_through_epoch_ms
                    != receipt.committed_at_epoch_ms.saturating_add(600_000)
        })
    {
        return Err(ArtifactBuildError::Storage(
            "successful artifact custody mismatch".to_string(),
        ));
    }

    if intent.is_v2() {
        load_research_family_for_attempt(transaction, research).await?;
        let research_family = research.family().ok_or_else(|| {
            ArtifactBuildError::Storage("successful research family missing".to_string())
        })?;
        let family = load_artifact_trial_family_in_transaction(
            transaction,
            artifact_identity,
            build_receipt_identity,
            intent.intent_identity(),
            research_family,
        )
        .await
        .map_err(|e| trial_family_storage(&e))?;
        Ok((Some(family), review))
    } else {
        let bindings = sqlx::query("SELECT binding_identity FROM rd_artifact_trial_family_bindings_v1 WHERE artifact_identity = $1 OR build_receipt_identity = $2 FOR SHARE")
            .bind(artifact_identity)
            .bind(build_receipt_identity)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;

        if !bindings.is_empty() {
            return Err(ArtifactBuildError::Storage(
                "legacy artifact has a family binding".to_string(),
            ));
        }
        Ok((None, review))
    }
}

pub(crate) async fn resolve_verified_artifact_family(
    pool: &PgPool,
    artifact_identity: &str,
    build_receipt_identity: &str,
) -> Result<ArtifactTrialFamilyReadbackV1, TrialFamilyError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    let rows = sqlx::query("SELECT artifact_digest, intent_identity, attempt_identity, build_receipt_json FROM rd_strategy_artifacts_v1 WHERE artifact_digest = $1")
        .bind(artifact_identity)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    if rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "artifact attempt custody missing".to_string(),
        ));
    }
    let row = &rows[0];
    let row_artifact_identity: String = row
        .try_get("artifact_digest")
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    let row_intent_identity: String = row
        .try_get("intent_identity")
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    let attempt_identity: String = row
        .try_get("attempt_identity")
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    let build_receipt: BuildReceiptV1 = decode(
        &row.try_get("build_receipt_json")
            .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?,
    )
    .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    if row_artifact_identity != artifact_identity
        || build_receipt.build_receipt_identity != build_receipt_identity
        || build_receipt.attempt_identity != attempt_identity
        || build_receipt.intent_identity != row_intent_identity
    {
        return Err(TrialFamilyError::Unavailable(
            "artifact build receipt locator mismatch".to_string(),
        ));
    }
    let attempt_rows = sqlx::query("SELECT build_request_identity FROM rd_artifact_build_attempts_v1 WHERE attempt_identity = $1")
            .bind(&attempt_identity)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    if attempt_rows.len() != 1 {
        return Err(TrialFamilyError::Unavailable(
            "artifact attempt custody missing".to_string(),
        ));
    }
    let build_request_identity: String = attempt_rows[0]
        .try_get("build_request_identity")
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    let custody = Box::pin(admit_attempt_custody_in_transaction(
        &mut transaction,
        &build_request_identity,
    ))
    .await
    .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?
    .ok_or_else(|| TrialFamilyError::Unavailable("artifact attempt missing".to_string()))?;
    let receipt = custody.attempt.receipt.as_ref().ok_or_else(|| {
        TrialFamilyError::Unavailable("artifact attempt receipt missing".to_string())
    })?;

    if custody.attempt.state != AttemptState::Terminal
        || receipt.disposition != ArtifactBuildDisposition::Success
        || receipt.artifact_identity.as_deref() != Some(artifact_identity)
        || receipt.build_receipt_identity.as_deref() != Some(build_receipt_identity)
    {
        return Err(TrialFamilyError::Unavailable(
            "artifact attempt identity mismatch".to_string(),
        ));
    }

    if !custody
        .research
        .intent()
        .is_some_and(FrozenResearchGoalIntent::is_v2)
    {
        return Err(TrialFamilyError::LegacyUnavailable);
    }
    let family = custody.artifact_family.ok_or_else(|| {
        TrialFamilyError::Unavailable("artifact family custody missing".to_string())
    })?;
    transaction
        .commit()
        .await
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
    Ok(family)
}

pub(crate) fn no_artifact_receipt(
    attempt: &StoredAttemptV1,
    research: &VerifiedResearchCustodyV1,
    failure_code: &str,
    now: u64,
) -> Result<ArtifactBuildReceiptV1, ArtifactBuildError> {
    let intent = research.intent().ok_or_else(|| {
        ArtifactBuildError::Storage("no-artifact research intent missing".to_string())
    })?;
    let meaning = NoArtifactReceiptMeaningV1 {
        build_request_identity: &attempt.request.build_request_identity,
        attempt_identity: &attempt.request.attempt_identity,
        request_semantic_digest: &attempt.request_semantic_digest,
        intent_identity: intent.intent_identity(),
        intent_semantic_digest: intent.semantic_digest(),
        failure_code,
        committed_at_epoch_ms: now,
    };
    let disposition = meaning.disposition()?;
    let receipt_identity = no_artifact_receipt_identity(&meaning)?;
    Ok(ArtifactBuildReceiptV1 {
        schema_version: 1,
        receipt_identity,
        build_request_identity: attempt.request.build_request_identity.clone(),
        attempt_identity: attempt.request.attempt_identity.clone(),
        request_semantic_digest: attempt.request_semantic_digest.clone(),
        intent_identity: Some(intent.intent_identity().to_string()),
        intent_semantic_digest: Some(intent.semantic_digest().to_string()),
        disposition,
        artifact_identity: None,
        build_receipt_identity: None,
        failure_code: Some(failure_code.to_string()),
        committed_at_epoch_ms: now,
    })
}

struct NoArtifactReceiptMeaningV1<'a> {
    build_request_identity: &'a str,
    attempt_identity: &'a str,
    request_semantic_digest: &'a str,
    intent_identity: &'a str,
    intent_semantic_digest: &'a str,
    failure_code: &'a str,
    committed_at_epoch_ms: u64,
}

impl NoArtifactReceiptMeaningV1<'_> {
    fn disposition(&self) -> Result<ArtifactBuildDisposition, ArtifactBuildError> {
        no_artifact_disposition(self.failure_code)
    }
}

fn no_artifact_receipt_identity(
    meaning: &NoArtifactReceiptMeaningV1<'_>,
) -> Result<String, ArtifactBuildError> {
    let disposition = meaning.disposition()?;
    let mut payload = Vec::new();

    for (field, value) in [
        ("domain", "rd.artifact-build.no-artifact-receipt.v1"),
        ("schema_version", "1"),
        ("build_request_identity", meaning.build_request_identity),
        ("attempt_identity", meaning.attempt_identity),
        ("request_semantic_digest", meaning.request_semantic_digest),
        ("intent_identity", meaning.intent_identity),
        ("intent_semantic_digest", meaning.intent_semantic_digest),
        ("disposition", no_artifact_disposition_name(disposition)),
        ("artifact_identity", "NULL"),
        ("build_receipt_identity", "NULL"),
        ("failure_code", meaning.failure_code),
    ] {
        push_receipt_frame(&mut payload, field.as_bytes())?;
        push_receipt_frame(&mut payload, value.as_bytes())?;
    }
    push_receipt_frame(&mut payload, b"committed_at_epoch_ms")?;
    push_receipt_frame(&mut payload, &meaning.committed_at_epoch_ms.to_be_bytes())?;
    if payload.len() > 16_384 {
        return Err(ArtifactBuildError::Storage(
            "no-artifact receipt meaning exceeds bound".to_string(),
        ));
    }
    let suffix = format!("{:x}", Sha256::digest(&payload));
    Ok(format!("rd-artifact-build-receipt-v1-{suffix}"))
}

fn no_artifact_disposition(
    failure_code: &str,
) -> Result<ArtifactBuildDisposition, ArtifactBuildError> {
    match failure_code {
        "ATTEMPT_CUSTODY_EXPIRED" => Ok(ArtifactBuildDisposition::OutcomeUnknown),
        "NOT_CONFIGURED"
        | "POLICY_UNAVAILABLE"
        | "PROVIDER_EMPTY"
        | "PROVIDER_ERROR"
        | "CANDIDATE_MALFORMED"
        | "DEVELOPMENT_SANDBOX_FAILED"
        | "ARTIFACT_SECURITY_ADMISSION_REJECTED" => Ok(ArtifactBuildDisposition::FailedNoArtifact),
        _ => Err(ArtifactBuildError::Storage(
            "unrecognized no-artifact failure code".to_string(),
        )),
    }
}

fn no_artifact_disposition_name(disposition: ArtifactBuildDisposition) -> &'static str {
    match disposition {
        ArtifactBuildDisposition::Success => "SUCCESS",
        ArtifactBuildDisposition::FailedNoArtifact => "FAILED_NO_ARTIFACT",
        ArtifactBuildDisposition::RejectedNoWrite => "REJECTED_NO_WRITE",
        ArtifactBuildDisposition::OutcomeUnknown => "OUTCOME_UNKNOWN",
    }
}

fn push_receipt_frame(output: &mut Vec<u8>, value: &[u8]) -> Result<(), ArtifactBuildError> {
    let length = u32::try_from(value.len()).map_err(json_storage)?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
    Ok(())
}

fn decode<T>(value: &serde_json::Value) -> Result<T, ArtifactBuildError>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(ArtifactBuildError::Storage(
            "stored JSON is not canonical for its schema".to_string(),
        ));
    }
    Ok(decoded)
}
fn storage(error: impl Display) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}
fn json_storage(error: impl Display) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}
fn trial_family_storage(error: &TrialFamilyError) -> ArtifactBuildError {
    ArtifactBuildError::Storage(error.to_string())
}

#[cfg(test)]
mod receipt_identity_tests {
    use super::*;
    use rstest::rstest;

    fn meaning(
        failure_code: &'static str,
        committed_at_epoch_ms: u64,
    ) -> NoArtifactReceiptMeaningV1<'static> {
        NoArtifactReceiptMeaningV1 {
            build_request_identity: "build-request-1",
            attempt_identity: "attempt-1",
            request_semantic_digest: "sha256:request",
            intent_identity: "intent-1",
            intent_semantic_digest: "sha256:intent",
            failure_code,
            committed_at_epoch_ms,
        }
    }

    #[rstest]
    fn full_terminal_meaning_changes_receipt_identity() {
        let ordinary = no_artifact_receipt_identity(&meaning("PROVIDER_ERROR", 10)).unwrap();
        let changed_time = no_artifact_receipt_identity(&meaning("PROVIDER_ERROR", 11)).unwrap();
        let expired =
            no_artifact_receipt_identity(&meaning("ATTEMPT_CUSTODY_EXPIRED", 10)).unwrap();

        assert_ne!(ordinary, changed_time);
        assert_ne!(ordinary, expired);
        assert_eq!(
            meaning("PROVIDER_ERROR", 10).disposition().unwrap(),
            ArtifactBuildDisposition::FailedNoArtifact
        );
        assert_eq!(
            meaning("ATTEMPT_CUSTODY_EXPIRED", 10)
                .disposition()
                .unwrap(),
            ArtifactBuildDisposition::OutcomeUnknown
        );
    }
}
