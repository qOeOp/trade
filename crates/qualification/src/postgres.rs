use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use vibe_backtest_owner_contracts::{
    ProtectedEconomicPolicyBundleV1, ProtectedReplayAttemptFrontierDtoV1,
    ProtectedReplayAttemptFrontierLocatorV1, ProtectedReplayRequestDtoV1,
    ProtectedReplayRequestDtoV2, ProtectedReplayRequestLocatorV1,
    ProtectedReplayRequestSetSealDtoV1, ProtectedReplayResultDtoV3,
};
use vibe_backtest_result_custody::{
    LockedProtectedReplayResultV1, LockedProtectedReplayResultV2, ProtectedReplayResultLocatorV1,
    resolve_protected_replay_attempt_frontier_for_qualification_in_transaction,
    resolve_protected_replay_result_for_qualification_in_transaction,
    resolve_protected_replay_result_v2_for_qualification_in_transaction,
    resolve_protected_replay_result_v3_for_qualification_in_transaction,
};
use vibe_data::owner::shared_time_evidence::ClockHeadSuccessorReadback;

use crate::candidate_intake::{
    ProtectedReplayAuthoritySourceV1, ResolvedRdSelectionStorageV1, decode_intake_receipt_v1,
    decode_resolved_handoff_v1, form_candidate_intake_receipt_v1,
    protected_replay_authority_source_v1,
};
use crate::protected_attempt_disposition::{
    HoldoutClosureDispositionV1, PreregisteredHoldoutTreatmentV1,
    ProtectedAttemptDispositionCommitV1, ProtectedAttemptDispositionStatusV1,
    form_diagnostic_attempt_disposition_v1, form_negative_attempt_disposition_v1,
    preregistered_holdout_treatment_v1,
};
use crate::protected_replay_request::{
    ProtectedReplayRequestReceiptV1, ProtectedReplayRequestV1, ProtectedReplayRequestV2,
    commit_projection, commit_projection_v2, decode_protected_replay_request_set_v1,
    decode_protected_replay_request_v1, decode_protected_replay_request_v2,
    decode_request_receipt_v1, decode_request_receipt_v2, form_protected_replay_request_set_v1,
    form_protected_replay_request_v1, form_protected_replay_request_v2, form_request_receipt_v1,
    form_request_receipt_v2,
};
use crate::protected_robustness_assessment::{
    ProtectedAssessmentInvalidCommitV1, ProtectedIneligibleCommitV1, ProtectedQualifiedCommitV1,
    form_all_not_applicable_assessment_v1, form_economic_failure_assessment_v1,
    form_economic_pass_assessment_v1, validate_economic_policy_bundle,
    validate_sealed_economic_policy_bundle,
};
use crate::status_summary::{
    PublicStatusFactInputV1, QualificationPublicStatusV1, decode_public_status_fact_v1,
    decode_public_status_readback_v1, digest_from_identity, form_public_status_fact_v1,
    public_status_name,
};
use crate::{CandidateIntakeReceiptV1, CandidateIntakeRequestV1, CandidateIntakeStatusV1};
use crate::{
    ProtectedFeedbackFrontierReadbackV1, ProtectedFeedbackFrontierReceiptV1,
    ProtectedFeedbackResolutionV1, QualificationOwnerError, RdIndependenceBasisLocatorV1,
};
use crate::{
    ProtectedReplayRequestCommitV1, ProtectedReplayRequestProposalV1,
    ProtectedReplayRequestProposalV2, ProtectedReplayRequestSetCommitV1,
};

const CLOCK_EPOCH_V1: &str = "unix-epoch-ms-v1";
const PROJECTION_VALIDITY_MS: u64 = 600_000;
const PROJECTED_EVENT_KIND: &str = "QUALIFICATION_PROTECTED_FEEDBACK_PROJECTED_V1";

/// The Owner's only clock read, shared by the projection path and by incident recovery. Both
/// samples of a create - the write edge that fixes `valid_through` and the response cut that
/// validates freshness before commit - come from here, so whoever could displace it would choose
/// whether the response-cut rollback ever fires. `clock_timestamp` is therefore spelled with its
/// schema: an unqualified call resolves through `search_path`, and a shadowing function would hand
/// that choice away. Nothing at runtime would notice the qualification going missing, which is why
/// `the_owner_clock_is_read_through_its_schema_and_not_through_search_path` pins it. Keeping one
/// constant is what lets that test cover recovery too: `recovery` is behind `owner-recovery`, a
/// feature no CI invocation enables, so a pin living there would never run.
pub(crate) const OWNER_CLOCK_EPOCH_MS_SQL: &str =
    "SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::BIGINT";

#[derive(Debug, Clone)]
pub struct PostgresQualificationOwnerV1 {
    pool: PgPool,
}

#[derive(Debug, Clone)]
pub struct PostgresQualificationPublicStatusReadPortV1 {
    pool: PgPool,
}

impl PostgresQualificationPublicStatusReadPortV1 {
    pub async fn connect(database_url: &str) -> Result<Self, QualificationOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let admitted: bool = sqlx::query_scalar(
            "SELECT current_user='product_edge_owner' \
             AND pg_catalog.has_schema_privilege(current_user,'qualification_api','USAGE') \
             AND pg_catalog.has_function_privilege(current_user,'qualification_api.read_public_status_v1(text)','EXECUTE') \
             AND NOT pg_catalog.has_table_privilege(current_user,'public.qualification_public_status_facts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') \
             AND NOT pg_catalog.has_table_privilege(current_user,'public.qualification_public_status_heads_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
        )
        .fetch_one(&pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(unavailable(
                "Qualification public status read role is unavailable",
            ));
        }
        Ok(Self { pool })
    }

    pub async fn resolve(
        &self,
        review_request_identity: &str,
    ) -> Result<Option<crate::QualificationPublicStatusFactV1>, QualificationOwnerError> {
        if review_request_identity.trim().is_empty()
            || review_request_identity != review_request_identity.trim()
        {
            return Err(unavailable(
                "Qualification review request identity is invalid",
            ));
        }
        let value: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT qualification_api.read_public_status_v1($1)")
                .bind(review_request_identity)
                .fetch_one(&self.pool)
                .await
                .map_err(storage)?;
        value
            .as_ref()
            .map(decode_public_status_readback_v1)
            .transpose()
    }
}

#[derive(Clone, Copy)]
enum ProtectedAttemptClosureKindV1 {
    Negative,
    Diagnostic,
}

#[cfg(test)]
type ProtectedAttemptSnapshotBarrierV1 = tokio::sync::Barrier;

#[cfg(not(test))]
struct ProtectedAttemptSnapshotBarrierV1;

enum LockedProtectedAttemptResultV1 {
    Negative(LockedProtectedReplayResultV1),
    Diagnostic(LockedProtectedReplayResultV2),
}

#[derive(Clone, Copy)]
enum ProtectedAssessmentClosureKindV1 {
    AllNotApplicable,
    EconomicFailure,
    EconomicPass,
}

enum ProtectedAssessmentCommitV1 {
    Invalid(Box<ProtectedAssessmentInvalidCommitV1>),
    Ineligible(Box<ProtectedIneligibleCommitV1>),
    Qualified(Box<ProtectedQualifiedCommitV1>),
}

fn assessment_public_status_source_v1(
    commit: &ProtectedAssessmentCommitV1,
) -> PublicStatusSourceV1<'_> {
    match commit {
        ProtectedAssessmentCommitV1::Invalid(commit) => PublicStatusSourceV1 {
            identity: commit.disposition().disposition_identity(),
            digest: commit.disposition().disposition_digest(),
            committed_at_epoch_ms: commit.assessment().committed_at_epoch_ms(),
        },
        ProtectedAssessmentCommitV1::Ineligible(commit) => PublicStatusSourceV1 {
            identity: commit.eligibility().eligibility_identity(),
            digest: commit.eligibility().eligibility_digest(),
            committed_at_epoch_ms: commit.eligibility().committed_at_epoch_ms(),
        },
        ProtectedAssessmentCommitV1::Qualified(commit) => PublicStatusSourceV1 {
            identity: commit.eligibility().eligibility_identity(),
            digest: commit.eligibility().eligibility_digest(),
            committed_at_epoch_ms: commit.eligibility().committed_at_epoch_ms(),
        },
    }
}

const fn assessment_public_status_v1(
    commit: &ProtectedAssessmentCommitV1,
) -> QualificationPublicStatusV1 {
    match commit {
        ProtectedAssessmentCommitV1::Qualified(_) => QualificationPublicStatusV1::Qualified,
        ProtectedAssessmentCommitV1::Invalid(_) | ProtectedAssessmentCommitV1::Ineligible(_) => {
            QualificationPublicStatusV1::ClosedNotQualified
        }
    }
}

struct PublicStatusSourceV1<'a> {
    identity: &'a str,
    digest: &'a str,
    committed_at_epoch_ms: u64,
}

struct VerifiedPublicStatusHeadV1 {
    sequence: i64,
    fact: crate::QualificationPublicStatusFactV1,
    native_source_identity: String,
    native_source_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug)]
enum QualificationTransactionError {
    Domain(QualificationOwnerError),
    Storage(sqlx::Error),
}

impl QualificationTransactionError {
    fn into_public(self) -> QualificationOwnerError {
        match self {
            Self::Domain(error) => error,
            Self::Storage(error) => storage(error),
        }
    }

    fn into_negative_closure(
        self,
        retryable_unique_tables: &[&str],
    ) -> NegativeClosureAttemptError {
        match self {
            Self::Domain(error) => NegativeClosureAttemptError::Public(error),
            Self::Storage(error) => negative_closure_sql_error(error, retryable_unique_tables),
        }
    }
}

impl From<QualificationOwnerError> for QualificationTransactionError {
    fn from(error: QualificationOwnerError) -> Self {
        Self::Domain(error)
    }
}

fn transaction_storage(error: sqlx::Error) -> QualificationTransactionError {
    QualificationTransactionError::Storage(error)
}

async fn persist_public_status_transition_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    candidate_identity: &str,
    status: QualificationPublicStatusV1,
    source: PublicStatusSourceV1<'_>,
    initial_source_frontier: Option<(&str, &str)>,
) -> Result<(), QualificationOwnerError> {
    persist_public_status_transition_preserving_sqlstate_v1(
        transaction,
        review_request_identity,
        candidate_identity,
        status,
        source,
        initial_source_frontier,
    )
    .await
    .map_err(QualificationTransactionError::into_public)
}

async fn persist_public_status_transition_preserving_sqlstate_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    candidate_identity: &str,
    status: QualificationPublicStatusV1,
    source: PublicStatusSourceV1<'_>,
    initial_source_frontier: Option<(&str, &str)>,
) -> Result<(), QualificationTransactionError> {
    let current = verify_public_status_history_preserving_sqlstate_in_transaction(
        transaction,
        review_request_identity,
        candidate_identity,
    )
    .await?;

    if current.is_some()
        && matches!(
            status,
            QualificationPublicStatusV1::NotAdmitted | QualificationPublicStatusV1::Admitted
        )
    {
        verify_initial_public_status_fact_v1(
            transaction,
            review_request_identity,
            candidate_identity,
            status,
            &source,
        )
        .await?;
        return Ok(());
    }

    if let Some(current) = &current
        && current.fact.status() == status
    {
        if status != QualificationPublicStatusV1::Evaluating
            && (current.native_source_identity != source.identity
                || current.native_source_digest != source.digest
                || current.committed_at_epoch_ms != source.committed_at_epoch_ms)
        {
            return Err(QualificationOwnerError::ConflictingIdentity.into());
        }
        return Ok(());
    }

    let phase_sequence = match current.as_ref().map(|current| current.fact.status()) {
        None if matches!(
            status,
            QualificationPublicStatusV1::NotAdmitted | QualificationPublicStatusV1::Admitted
        ) =>
        {
            1_i64
        }
        Some(QualificationPublicStatusV1::Admitted)
            if status == QualificationPublicStatusV1::Evaluating =>
        {
            2
        }
        Some(QualificationPublicStatusV1::Evaluating)
            if matches!(
                status,
                QualificationPublicStatusV1::ClosedNotQualified
                    | QualificationPublicStatusV1::Qualified
            ) =>
        {
            3
        }
        _ => {
            return Err(
                unavailable("Qualification public status transition is unavailable").into(),
            );
        }
    };

    let (source_frontier_identity, source_frontier_digest) = match current.as_ref() {
        Some(current) => (
            current.fact.source_frontier_identity(),
            current.fact.source_frontier_digest(),
        ),
        None => initial_source_frontier.ok_or_else(|| {
            unavailable("Qualification public status source frontier is unavailable")
        })?,
    };
    let (resolved_frontier_digest, source_frontier_is_current) =
        resolve_candidate_feedback_frontier_preserving_sqlstate_v1(
            transaction,
            source_frontier_identity,
            source.committed_at_epoch_ms,
        )
        .await?;

    if resolved_frontier_digest != source_frontier_digest {
        return Err(unavailable("Qualification public status source frontier changed").into());
    }
    let fact = form_public_status_fact_v1(&PublicStatusFactInputV1 {
        review_request_identity,
        candidate_identity,
        status,
        native_source_identity: source.identity,
        native_source_digest: source.digest,
        source_frontier_identity,
        source_frontier_digest,
        source_frontier_is_current,
    })?;
    let fact_json = fact.as_json()?;
    sqlx::query(
        "INSERT INTO public.qualification_public_status_facts_v1 \
         (fact_identity,fact_digest,review_request_identity,candidate_identity,phase_sequence,status,native_source_identity,native_source_digest,source_frontier_identity,source_frontier_digest,source_frontier_is_current,fact_json,committed_at_epoch_ms) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(fact.fact_identity())
    .bind(fact.fact_digest())
    .bind(review_request_identity)
    .bind(candidate_identity)
    .bind(phase_sequence)
    .bind(public_status_name(status))
    .bind(source.identity)
    .bind(source.digest)
    .bind(source_frontier_identity)
    .bind(source_frontier_digest)
    .bind(source_frontier_is_current)
    .bind(&fact_json)
    .bind(i64::try_from(source.committed_at_epoch_ms).map_err(json_storage)?)
    .execute(&mut **transaction)
    .await
    .map_err(transaction_storage)?;

    if let Some(current) = current {
        let updated = sqlx::query(
            "UPDATE public.qualification_public_status_heads_v1 \
             SET fact_identity=$1,fact_digest=$2,phase_sequence=$3,updated_at_epoch_ms=$4 \
             WHERE review_request_identity=$5 AND fact_identity=$6 AND fact_digest=$7 AND phase_sequence=$8",
        )
        .bind(fact.fact_identity())
        .bind(fact.fact_digest())
        .bind(phase_sequence)
        .bind(i64::try_from(source.committed_at_epoch_ms).map_err(json_storage)?)
        .bind(review_request_identity)
        .bind(current.fact.fact_identity())
        .bind(current.fact.fact_digest())
        .bind(current.sequence)
        .execute(&mut **transaction)
        .await
        .map_err(transaction_storage)?;

        if updated.rows_affected() != 1 {
            return Err(unavailable("Qualification public status head changed").into());
        }
    } else {
        sqlx::query(
            "INSERT INTO public.qualification_public_status_heads_v1 \
             (review_request_identity,candidate_identity,fact_identity,fact_digest,phase_sequence,updated_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(review_request_identity)
        .bind(candidate_identity)
        .bind(fact.fact_identity())
        .bind(fact.fact_digest())
        .bind(phase_sequence)
        .bind(i64::try_from(source.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(transaction_storage)?;
    }

    if let Some((event_identity, payload_digest, payload_json)) = fact.terminal_event_v1()? {
        sqlx::query(
            "INSERT INTO public.qualification_owner_outbox_v1 \
             (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
             VALUES ($1,$2,'QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1',$3,$4,$5)",
        )
        .bind(event_identity)
        .bind(fact.fact_identity())
        .bind(payload_digest)
        .bind(payload_json)
        .bind(i64::try_from(source.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(transaction_storage)?;
    }

    let verified = verify_public_status_history_preserving_sqlstate_in_transaction(
        transaction,
        review_request_identity,
        candidate_identity,
    )
    .await?
    .ok_or_else(|| unavailable("Qualification public status head is unavailable"))?;
    if verified.fact != fact {
        return Err(unavailable("Qualification public status commit changed").into());
    }
    Ok(())
}

#[cfg(test)]
async fn verify_public_status_history_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    candidate_identity: &str,
) -> Result<Option<VerifiedPublicStatusHeadV1>, QualificationOwnerError> {
    verify_public_status_history_preserving_sqlstate_in_transaction(
        transaction,
        review_request_identity,
        candidate_identity,
    )
    .await
    .map_err(QualificationTransactionError::into_public)
}

async fn verify_public_status_history_preserving_sqlstate_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    candidate_identity: &str,
) -> Result<Option<VerifiedPublicStatusHeadV1>, QualificationTransactionError> {
    let rows = sqlx::query(
        "SELECT fact_identity,fact_digest,candidate_identity,phase_sequence,status,native_source_identity,native_source_digest,source_frontier_identity,source_frontier_digest,source_frontier_is_current,fact_json,committed_at_epoch_ms \
         FROM public.qualification_public_status_facts_v1 \
         WHERE review_request_identity=$1 ORDER BY phase_sequence",
    )
    .bind(review_request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(transaction_storage)?;
    let mut previous_status = None;
    let mut previous_frontier: Option<(String, String)> = None;
    let mut last = None;

    for (index, row) in rows.iter().enumerate() {
        let sequence = row
            .try_get::<i64, _>("phase_sequence")
            .map_err(transaction_storage)?;
        let native_source_identity: String = row
            .try_get("native_source_identity")
            .map_err(transaction_storage)?;
        let native_source_digest: String = row
            .try_get("native_source_digest")
            .map_err(transaction_storage)?;
        let committed_at_epoch_ms = u64::try_from(
            row.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(transaction_storage)?,
        )
        .map_err(json_storage)?;
        let fact_json: serde_json::Value = row.try_get("fact_json").map_err(transaction_storage)?;
        let fact = decode_public_status_fact_v1(
            &fact_json,
            &native_source_identity,
            &native_source_digest,
        )?;
        let expected_sequence = i64::try_from(index + 1).map_err(json_storage)?;
        let transition_is_valid = matches!(
            (previous_status, fact.status()),
            (
                None,
                QualificationPublicStatusV1::NotAdmitted | QualificationPublicStatusV1::Admitted
            ) | (
                Some(QualificationPublicStatusV1::Admitted),
                QualificationPublicStatusV1::Evaluating
            ) | (
                Some(QualificationPublicStatusV1::Evaluating),
                QualificationPublicStatusV1::ClosedNotQualified
                    | QualificationPublicStatusV1::Qualified
            )
        );
        let frontier = (
            fact.source_frontier_identity().to_string(),
            fact.source_frontier_digest().to_string(),
        );

        if sequence != expected_sequence
            || !transition_is_valid
            || fact.review_request_identity() != review_request_identity
            || fact.candidate_identity() != candidate_identity
            || row
                .try_get::<String, _>("fact_identity")
                .map_err(transaction_storage)?
                != fact.fact_identity()
            || row
                .try_get::<String, _>("fact_digest")
                .map_err(transaction_storage)?
                != fact.fact_digest()
            || row
                .try_get::<String, _>("candidate_identity")
                .map_err(transaction_storage)?
                != candidate_identity
            || row
                .try_get::<String, _>("status")
                .map_err(transaction_storage)?
                != public_status_name(fact.status())
            || row
                .try_get::<String, _>("source_frontier_identity")
                .map_err(transaction_storage)?
                != fact.source_frontier_identity()
            || row
                .try_get::<String, _>("source_frontier_digest")
                .map_err(transaction_storage)?
                != fact.source_frontier_digest()
            || row
                .try_get::<bool, _>("source_frontier_is_current")
                .map_err(transaction_storage)?
                != fact.source_frontier_is_current()
            || previous_frontier
                .as_ref()
                .is_some_and(|previous| previous != &frontier)
        {
            return Err(unavailable("Qualification public status history changed").into());
        }
        let event_rows = sqlx::query(
            "SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms \
             FROM public.qualification_owner_outbox_v1 \
             WHERE aggregate_identity=$1 \
               AND event_kind IN ('QUALIFICATION_PUBLIC_STATUS_COMMITTED_V1','QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1')",
        )
        .bind(fact.fact_identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(transaction_storage)?;

        match (fact.terminal_event_v1()?, event_rows.as_slice()) {
            (None, []) => {}
            (Some((event_identity, payload_digest, payload_json)), [event])
                if event
                    .try_get::<String, _>("event_identity")
                    .map_err(transaction_storage)?
                    == event_identity
                    && event
                        .try_get::<String, _>("payload_digest")
                        .map_err(transaction_storage)?
                        == payload_digest
                    && event
                        .try_get::<serde_json::Value, _>("payload_json")
                        .map_err(transaction_storage)?
                        == payload_json
                    && u64::try_from(
                        event
                            .try_get::<i64, _>("committed_at_epoch_ms")
                            .map_err(transaction_storage)?,
                    )
                    .map_err(json_storage)?
                        == committed_at_epoch_ms => {}
            _ => {
                return Err(unavailable("Qualification public status event is unavailable").into());
            }
        }
        previous_status = Some(fact.status());
        previous_frontier = Some(frontier);
        last = Some(VerifiedPublicStatusHeadV1 {
            sequence,
            fact,
            native_source_identity,
            native_source_digest,
            committed_at_epoch_ms,
        });
    }

    let heads = sqlx::query(
        "SELECT candidate_identity,fact_identity,fact_digest,phase_sequence,updated_at_epoch_ms \
         FROM public.qualification_public_status_heads_v1 WHERE review_request_identity=$1 FOR UPDATE",
    )
    .bind(review_request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(transaction_storage)?;

    match (last.as_ref(), heads.as_slice()) {
        (None, []) => Ok(None),
        (Some(current), [head])
            if head
                .try_get::<String, _>("candidate_identity")
                .map_err(transaction_storage)?
                == candidate_identity
                && head
                    .try_get::<String, _>("fact_identity")
                    .map_err(transaction_storage)?
                    == current.fact.fact_identity()
                && head
                    .try_get::<String, _>("fact_digest")
                    .map_err(transaction_storage)?
                    == current.fact.fact_digest()
                && head
                    .try_get::<i64, _>("phase_sequence")
                    .map_err(transaction_storage)?
                    == current.sequence
                && u64::try_from(
                    head.try_get::<i64, _>("updated_at_epoch_ms")
                        .map_err(transaction_storage)?,
                )
                .map_err(json_storage)?
                    == current.committed_at_epoch_ms =>
        {
            Ok(last)
        }
        _ => Err(unavailable("Qualification public status head changed").into()),
    }
}

async fn verify_initial_public_status_fact_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    candidate_identity: &str,
    status: QualificationPublicStatusV1,
    source: &PublicStatusSourceV1<'_>,
) -> Result<(), QualificationOwnerError> {
    let rows = sqlx::query(
        "SELECT native_source_identity,native_source_digest,fact_json,committed_at_epoch_ms \
         FROM public.qualification_public_status_facts_v1 \
         WHERE review_request_identity=$1 AND phase_sequence=1",
    )
    .bind(review_request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(unavailable(
            "Qualification initial public status fact is unavailable",
        ));
    };
    let native_source_identity: String = row.try_get("native_source_identity").map_err(storage)?;
    let native_source_digest: String = row.try_get("native_source_digest").map_err(storage)?;
    let fact_json: serde_json::Value = row.try_get("fact_json").map_err(storage)?;
    let fact =
        decode_public_status_fact_v1(&fact_json, &native_source_identity, &native_source_digest)?;

    if fact.review_request_identity() != review_request_identity
        || fact.candidate_identity() != candidate_identity
        || fact.status() != status
        || native_source_identity != source.identity
        || native_source_digest != source.digest
        || u64::try_from(
            row.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(json_storage)?
            != source.committed_at_epoch_ms
    {
        return Err(QualificationOwnerError::ConflictingIdentity);
    }
    Ok(())
}

async fn resolve_candidate_feedback_frontier_v1(
    transaction: &mut Transaction<'_, Postgres>,
    source_frontier_identity: &str,
    owner_cut_epoch_ms: u64,
) -> Result<(String, bool), QualificationOwnerError> {
    resolve_candidate_feedback_frontier_preserving_sqlstate_v1(
        transaction,
        source_frontier_identity,
        owner_cut_epoch_ms,
    )
    .await
    .map_err(QualificationTransactionError::into_public)
}

async fn resolve_candidate_feedback_frontier_preserving_sqlstate_v1(
    transaction: &mut Transaction<'_, Postgres>,
    source_frontier_identity: &str,
    owner_cut_epoch_ms: u64,
) -> Result<(String, bool), QualificationTransactionError> {
    let source_frontier_digest = digest_from_identity(
        "qualification-protected-feedback-frontier-v1-",
        source_frontier_identity,
    )?;
    let projection_json = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT projection_json FROM public.qualification_protected_feedback_projections_v1 \
         WHERE projection_identity=$1 FOR SHARE",
    )
    .bind(source_frontier_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(transaction_storage)?;
    let Some(projection_json) = projection_json else {
        return Ok((source_frontier_digest, false));
    };
    let stored: StoredProjectionV1 = decode_exact(&projection_json)?;
    let scope_key = principal_scope_key(&stored.principal, &stored.request_scope)?;
    lock_principal_scope_preserving_sqlstate_in_transaction(transaction, &scope_key).await?;
    let history = verify_scope_history_preserving_sqlstate_in_transaction(
        transaction,
        &stored.principal,
        &stored.request_scope,
        &scope_key,
    )
    .await?;
    let is_current = history.current_frontier.as_ref().is_some_and(|frontier| {
        frontier.projection_identity == source_frontier_identity
            && frontier.projection_digest == source_frontier_digest
            && verify_projection_freshness(frontier, owner_cut_epoch_ms).is_ok()
    });
    Ok((source_frontier_digest, is_current))
}

impl LockedProtectedAttemptResultV1 {
    fn validate_against_request(
        &self,
        request: &ProtectedReplayRequestDtoV1,
        locator: &ProtectedReplayRequestLocatorV1,
    ) -> Result<(), QualificationOwnerError> {
        match self {
            Self::Negative(locked) => locked.result().validate_against_request(request, locator),
            Self::Diagnostic(locked) => locked.result().validate_against_request(request, locator),
        }
        .map_err(|_| unavailable("Protected Replay Result changed the frozen request"))
    }

    fn form_disposition(
        &self,
        request: &ProtectedReplayRequestDtoV1,
        treatment: &PreregisteredHoldoutTreatmentV1,
        committed_at_epoch_ms: u64,
    ) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
        match self {
            Self::Negative(locked) => form_negative_attempt_disposition_v1(
                request,
                locked.result(),
                treatment,
                committed_at_epoch_ms,
            ),
            Self::Diagnostic(locked) => form_diagnostic_attempt_disposition_v1(
                request,
                locked.result(),
                treatment,
                committed_at_epoch_ms,
            ),
        }
    }
}

async fn persist_protected_attempt_public_terminal_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &ProtectedReplayRequestDtoV1,
    request_locator: &ProtectedReplayRequestLocatorV1,
    treatment: &PreregisteredHoldoutTreatmentV1,
    commit: &ProtectedAttemptDispositionCommitV1,
) -> Result<(), NegativeClosureAttemptError> {
    let current = verify_public_status_history_preserving_sqlstate_in_transaction(
        transaction,
        &request.review_request_identity,
        &request.candidate_identity,
    )
    .await
    .map_err(|e| e.into_negative_closure(&[]))?;

    if let Some(current) = current {
        if current.fact.status() == QualificationPublicStatusV1::ClosedNotQualified {
            let source_is_exact_retry = current.native_source_identity
                == commit.disposition_identity()
                && current.native_source_digest == commit.disposition().disposition_digest()
                && current.committed_at_epoch_ms == commit.disposition().committed_at_epoch_ms();

            if !source_is_exact_retry {
                verify_existing_attempt_public_terminal_source_v1(
                    transaction,
                    request,
                    request_locator,
                    treatment,
                    &current,
                )
                .await?;
            }
            return Ok(());
        }

        if current.fact.status() == QualificationPublicStatusV1::Qualified {
            return Err(QualificationOwnerError::ConflictingIdentity.into());
        }
    }

    persist_public_status_transition_preserving_sqlstate_v1(
        transaction,
        &request.review_request_identity,
        &request.candidate_identity,
        QualificationPublicStatusV1::ClosedNotQualified,
        PublicStatusSourceV1 {
            identity: commit.disposition_identity(),
            digest: commit.disposition().disposition_digest(),
            committed_at_epoch_ms: commit.disposition().committed_at_epoch_ms(),
        },
        None,
    )
    .await
    .map_err(|e| {
        e.into_negative_closure(&[
            "qualification_public_status_facts_v1",
            "qualification_public_status_heads_v1",
            "qualification_owner_outbox_v1",
        ])
    })
}

async fn verify_existing_attempt_public_terminal_source_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &ProtectedReplayRequestDtoV1,
    request_locator: &ProtectedReplayRequestLocatorV1,
    treatment: &PreregisteredHoldoutTreatmentV1,
    current: &VerifiedPublicStatusHeadV1,
) -> Result<(), NegativeClosureAttemptError> {
    let row = sqlx::query(
        "SELECT disposition_digest,status,request_identity,result_identity,attempt_identity,holdout_reservation_identity,committed_at_epoch_ms \
         FROM public.qualification_protected_attempt_dispositions_v1 \
         WHERE disposition_identity=$1",
    )
    .bind(&current.native_source_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(negative_closure_storage)?
    .ok_or(QualificationOwnerError::ConflictingIdentity)?;
    let disposition_digest: String = row
        .try_get("disposition_digest")
        .map_err(negative_closure_storage)?;
    let status: String = row.try_get("status").map_err(negative_closure_storage)?;
    let request_identity: String = row
        .try_get("request_identity")
        .map_err(negative_closure_storage)?;
    let result_identity: String = row
        .try_get("result_identity")
        .map_err(negative_closure_storage)?;
    let attempt_identity: String = row
        .try_get("attempt_identity")
        .map_err(negative_closure_storage)?;
    let holdout_reservation_identity: String = row
        .try_get("holdout_reservation_identity")
        .map_err(negative_closure_storage)?;
    let committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(negative_closure_storage)?,
    )
    .map_err(json_storage)?;

    if disposition_digest != current.native_source_digest
        || request_identity != request.request_identity
        || holdout_reservation_identity != request.holdout_reservation_identity
        || committed_at_epoch_ms != current.committed_at_epoch_ms
    {
        return Err(QualificationOwnerError::ConflictingIdentity.into());
    }

    let prior_locator = ProtectedReplayResultLocatorV1 {
        result_identity: &result_identity,
        request_identity: &request_identity,
        attempt_identity: &attempt_identity,
    };
    let locked = match status.as_str() {
        "REPLAY_REJECTED" | "REPLAY_INVALID" => LockedProtectedAttemptResultV1::Negative(
            resolve_protected_replay_result_for_qualification_in_transaction(
                transaction,
                prior_locator,
            )
            .await
            .map_err(|_| QualificationOwnerError::ConflictingIdentity)?
            .ok_or(QualificationOwnerError::ConflictingIdentity)?,
        ),
        "DIAGNOSTIC_INVALID" | "DIAGNOSTIC_UNRESOLVED" => {
            LockedProtectedAttemptResultV1::Diagnostic(
                resolve_protected_replay_result_v2_for_qualification_in_transaction(
                    transaction,
                    prior_locator,
                )
                .await
                .map_err(|_| QualificationOwnerError::ConflictingIdentity)?
                .ok_or(QualificationOwnerError::ConflictingIdentity)?,
            )
        }
        _ => return Err(QualificationOwnerError::ConflictingIdentity.into()),
    };
    locked
        .validate_against_request(request, request_locator)
        .map_err(|_| QualificationOwnerError::ConflictingIdentity)?;
    let prior = locked
        .form_disposition(request, treatment, committed_at_epoch_ms)
        .map_err(|_| QualificationOwnerError::ConflictingIdentity)?;

    if prior.disposition_identity() != current.native_source_identity
        || prior.disposition().disposition_digest() != current.native_source_digest
        || prior.disposition().committed_at_epoch_ms() != current.committed_at_epoch_ms
    {
        return Err(QualificationOwnerError::ConflictingIdentity.into());
    }
    verify_negative_protected_attempt_commit_v1(transaction, &prior)
        .await
        .map_err(|e| match e {
            NegativeClosureAttemptError::RetryableContention => e,
            NegativeClosureAttemptError::Public(_) => {
                QualificationOwnerError::ConflictingIdentity.into()
            }
        })
}

impl PostgresQualificationOwnerV1 {
    pub async fn connect(database_url: &str) -> Result<Self, QualificationOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    /// Resolve one sealed R&D Candidate/Selection handoff and commit exactly one
    /// request-correlated Qualification intake receipt. An adequate plan reserves
    /// holdout custody in the same transaction; no protected replay is started here.
    pub async fn submit_candidate_intake_v1(
        &self,
        request: &CandidateIntakeRequestV1,
    ) -> Result<CandidateIntakeReceiptV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(request.review_request_identity())
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        if let Some(row) = sqlx::query(
            "SELECT review_request_digest,receipt_json FROM public.qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1 FOR UPDATE",
        )
        .bind(request.review_request_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        {
            if row.try_get::<String, _>("review_request_digest").map_err(storage)?
                != request.review_request_digest()
            {
                return Err(QualificationOwnerError::ConflictingIdentity);
            }
            let value: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
            let receipt = decode_intake_receipt_v1(&value)?;
            if !receipt.matches_request(request) {
                return Err(QualificationOwnerError::ConflictingIdentity);
            }
            let handoff = load_rd_selection_in_transaction(
                &mut transaction,
                receipt.decision_identity(),
                receipt.result_identity(),
            )
            .await?;
            let source_frontier_identity = handoff.candidate.protected_feedback_frontier();
            let source_frontier_digest = digest_from_identity(
                "qualification-protected-feedback-frontier-v1-",
                source_frontier_identity,
            )?;
            persist_public_status_transition_v1(
                &mut transaction,
                receipt.review_request_identity(),
                receipt.candidate_identity(),
                match receipt.status() {
                    CandidateIntakeStatusV1::Admitted => QualificationPublicStatusV1::Admitted,
                    CandidateIntakeStatusV1::NotAdmitted => {
                        QualificationPublicStatusV1::NotAdmitted
                    }
                },
                PublicStatusSourceV1 {
                    identity: receipt.receipt_identity(),
                    digest: receipt.receipt_digest(),
                    committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
                },
                Some((source_frontier_identity, &source_frontier_digest)),
            )
            .await?;
            verify_candidate_intake_commit_v1(&mut transaction, &receipt).await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(receipt);
        }
        let handoff = load_rd_selection_in_transaction(
            &mut transaction,
            request.decision_identity(),
            request.result_identity(),
        )
        .await?;
        // One Candidate resolves to exactly one intake receipt. A different review request for an
        // already intaken Candidate is changed meaning, not a new review: it neither creates a
        // second receipt nor a second holdout attempt. Serialize on the Candidate so two concurrent
        // first reviews cannot race the storage constraint into an untyped failure.
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(handoff.candidate.candidate_identity())
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let intaken_review: Option<String> = sqlx::query_scalar(
            "SELECT review_request_identity FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE candidate_identity=$1",
        )
        .bind(handoff.candidate.candidate_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?;

        if intaken_review.is_some_and(|review| review != request.review_request_identity()) {
            return Err(QualificationOwnerError::ConflictingIdentity);
        }
        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let (_, feedback_frontier_is_current) = resolve_candidate_feedback_frontier_v1(
            &mut transaction,
            handoff.candidate.protected_feedback_frontier(),
            committed_at_epoch_ms,
        )
        .await?;
        let receipt = form_candidate_intake_receipt_v1(
            request,
            &handoff,
            committed_at_epoch_ms,
            feedback_frontier_is_current,
        )?;

        if let Some(reservation_identity) = receipt.holdout_reservation_identity() {
            let holdout_treatment = preregistered_holdout_treatment_v1(
                receipt.protected_decision_policy_identity(),
                receipt.protected_decision_policy_version(),
            )?;
            sqlx::query("INSERT INTO public.qualification_holdout_reservations_v1 (reservation_identity,review_request_identity,candidate_identity,reservation_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
                .bind(reservation_identity)
                .bind(receipt.review_request_identity())
                .bind(receipt.candidate_identity())
                .bind(serde_json::json!({"schema_version":1,"reservation_identity":reservation_identity,"review_request_identity":receipt.review_request_identity(),"candidate_identity":receipt.candidate_identity()}))
                .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?)
                .execute(&mut *transaction).await.map_err(storage)?;
            let registration_json =
                holdout_treatment_registration_json_v1(reservation_identity, &holdout_treatment);
            sqlx::query("INSERT INTO public.qualification_holdout_treatment_registrations_v1 (reservation_identity,treatment_policy_identity,treatment_policy_digest,closure_disposition,registration_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
                .bind(reservation_identity)
                .bind(holdout_treatment.identity())
                .bind(holdout_treatment.digest())
                .bind(closure_status(holdout_treatment.closure_disposition()))
                .bind(registration_json)
                .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?)
                .execute(&mut *transaction).await.map_err(storage)?;
        }
        let receipt_json = receipt.as_json()?;
        sqlx::query("INSERT INTO public.qualification_candidate_intake_receipts_v1 (review_request_identity,review_request_digest,candidate_identity,receipt_identity,status,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(receipt.review_request_identity())
            .bind(receipt.review_request_digest())
            .bind(receipt.candidate_identity())
            .bind(receipt.receipt_identity())
            .bind(match receipt.status() { CandidateIntakeStatusV1::Admitted => "ADMITTED", CandidateIntakeStatusV1::NotAdmitted => "NOT_ADMITTED" })
            .bind(&receipt_json)
            .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        let event_digest =
            canonical_digest("qualification.candidate-intake-event.v1", &receipt_json)?;
        sqlx::query("INSERT INTO public.qualification_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'QUALIFICATION_CANDIDATE_INTAKE_COMMITTED_V1',$3,$4,$5)")
            .bind(identity("qualification-candidate-intake-event-v1", &event_digest))
            .bind(receipt.receipt_identity())
            .bind(event_digest)
            .bind(&receipt_json)
            .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        let source_frontier_identity = handoff.candidate.protected_feedback_frontier();
        let source_frontier_digest = digest_from_identity(
            "qualification-protected-feedback-frontier-v1-",
            source_frontier_identity,
        )?;
        persist_public_status_transition_v1(
            &mut transaction,
            receipt.review_request_identity(),
            receipt.candidate_identity(),
            match receipt.status() {
                CandidateIntakeStatusV1::Admitted => QualificationPublicStatusV1::Admitted,
                CandidateIntakeStatusV1::NotAdmitted => QualificationPublicStatusV1::NotAdmitted,
            },
            PublicStatusSourceV1 {
                identity: receipt.receipt_identity(),
                digest: receipt.receipt_digest(),
                committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
            },
            Some((source_frontier_identity, &source_frontier_digest)),
        )
        .await?;
        verify_candidate_intake_commit_v1(&mut transaction, &receipt).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(receipt)
    }

    /// Freeze one Qualification-owned protected request from an exact admitted
    /// Candidate Intake and its still-custodied holdout reservation.
    pub async fn submit_protected_replay_request_v1(
        &self,
        proposal: &ProtectedReplayRequestProposalV1,
    ) -> Result<ProtectedReplayRequestCommitV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let intake_row = sqlx::query(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE review_request_identity=$1 AND receipt_identity=$2 AND status='ADMITTED' FOR UPDATE",
        )
        .bind(proposal.review_request_identity())
        .bind(proposal.intake_receipt_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or_else(|| unavailable("ADMITTED Candidate Intake custody is unavailable"))?;
        let intake_json: serde_json::Value = intake_row.try_get("receipt_json").map_err(storage)?;
        let intake = decode_intake_receipt_v1(&intake_json)?;
        if intake.receipt_digest() != proposal.intake_receipt_digest() {
            return Err(unavailable("Candidate Intake receipt digest changed"));
        }
        let holdout_treatment =
            verify_candidate_intake_commit_v1(&mut transaction, &intake).await?;
        let handoff = load_rd_selection_in_transaction(
            &mut transaction,
            intake.decision_identity(),
            intake.result_identity(),
        )
        .await?;
        let source = protected_replay_authority_source_v1(&intake, &handoff)?;
        let request = form_protected_replay_request_v1(proposal, &intake, &source)?;

        lock_request_registration_fence_v1(
            &mut transaction,
            &source.plan_cell_set_identity,
            proposal.request_identity(),
        )
        .await?;

        if let Some(row) = sqlx::query(
            "SELECT request_digest FROM public.qualification_protected_replay_requests_v1 \
             WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(request.request_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        {
            if row
                .try_get::<String, _>("request_digest")
                .map_err(storage)?
                != request.request_digest()
            {
                return Err(QualificationOwnerError::ConflictingIdentity);
            }
            let committed_at_epoch_ms: i64 = sqlx::query_scalar(
                "SELECT committed_at_epoch_ms FROM public.qualification_protected_replay_request_receipts_v1 \
                 WHERE request_identity=$1 FOR UPDATE",
            )
            .bind(request.request_identity())
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
            let receipt = form_request_receipt_v1(
                &request,
                u64::try_from(committed_at_epoch_ms).map_err(json_storage)?,
            )?;
            verify_protected_replay_request_commit_v1(&mut transaction, &request, &receipt).await?;
            persist_public_status_transition_v1(
                &mut transaction,
                intake.review_request_identity(),
                intake.candidate_identity(),
                QualificationPublicStatusV1::Evaluating,
                PublicStatusSourceV1 {
                    identity: receipt.receipt_identity(),
                    digest: receipt.receipt_digest(),
                    committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
                },
                None,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return commit_projection(&request, &receipt);
        }

        reject_request_after_set_seal_v1(&mut transaction, &source.plan_cell_set_identity).await?;

        if holdout_treatment.is_none() {
            return Err(unavailable(
                "Candidate Intake has no preregistered holdout treatment",
            ));
        }

        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let receipt = form_request_receipt_v1(&request, committed_at_epoch_ms)?;
        let request_json = request.as_json()?;
        let request_bytes = serde_json::to_vec(&request_json).map_err(json_storage)?;
        let request_storage_digest = canonical_digest(
            "qualification.protected-replay-request.storage.v1",
            &request_bytes,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_protected_replay_requests_v1 \
             (request_identity,request_digest,review_request_identity,intake_receipt_identity,holdout_reservation_identity,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,request_json,canonical_request_bytes,storage_digest,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(request.request_identity())
        .bind(request.request_digest())
        .bind(request.review_request_identity())
        .bind(request.intake_receipt_identity())
        .bind(request.holdout_reservation_identity())
        .bind(request.protected_plan_identity())
        .bind(request.protected_plan_digest())
        .bind(request.plan_cell_identity())
        .bind(request.plan_cell_digest())
        .bind(&request_json)
        .bind(&request_bytes)
        .bind(&request_storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        let receipt_json = receipt.as_json()?;
        let receipt_bytes = serde_json::to_vec(&receipt_json).map_err(json_storage)?;
        let receipt_storage_digest = canonical_digest(
            "qualification.protected-replay-request-receipt.storage.v1",
            &receipt_bytes,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_protected_replay_request_receipts_v1 \
             (request_identity,request_digest,receipt_identity,receipt_digest,seal_digest,receipt_json,canonical_receipt_bytes,storage_digest,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(request.request_identity())
        .bind(request.request_digest())
        .bind(receipt.receipt_identity())
        .bind(receipt.receipt_digest())
        .bind(receipt.seal_digest())
        .bind(&receipt_json)
        .bind(&receipt_bytes)
        .bind(&receipt_storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        let outbox_payload = serde_json::json!({
            "schema_version": 1,
            "request_identity": request.request_identity(),
            "request_digest": request.request_digest(),
            "receipt_identity": receipt.receipt_identity(),
            "seal_digest": receipt.seal_digest(),
        });
        let event_digest = canonical_digest(
            "qualification.protected-replay-request-frozen-event.v1",
            &outbox_payload,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_owner_outbox_v1 \
             (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
             VALUES ($1,$2,'QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1',$3,$4,$5)",
        )
        .bind(identity(
            "qualification-protected-replay-request-frozen-event-v1",
            &event_digest,
        ))
        .bind(request.request_identity())
        .bind(event_digest)
        .bind(outbox_payload)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        verify_protected_replay_request_commit_v1(&mut transaction, &request, &receipt).await?;
        persist_public_status_transition_v1(
            &mut transaction,
            intake.review_request_identity(),
            intake.candidate_identity(),
            QualificationPublicStatusV1::Evaluating,
            PublicStatusSourceV1 {
                identity: receipt.receipt_identity(),
                digest: receipt.receipt_digest(),
                committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
            },
            None,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        commit_projection(&request, &receipt)
    }

    pub async fn submit_protected_replay_request_v2(
        &self,
        proposal: &ProtectedReplayRequestProposalV2,
    ) -> Result<ProtectedReplayRequestCommitV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let intake_row = sqlx::query(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE review_request_identity=$1 AND receipt_identity=$2 AND status='ADMITTED' FOR UPDATE",
        )
        .bind(proposal.review_request_identity())
        .bind(proposal.intake_receipt_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or_else(|| unavailable("ADMITTED Candidate Intake custody is unavailable"))?;
        let intake_json: serde_json::Value = intake_row.try_get("receipt_json").map_err(storage)?;
        let intake = decode_intake_receipt_v1(&intake_json)?;
        if intake.receipt_digest() != proposal.intake_receipt_digest() {
            return Err(unavailable("Candidate Intake receipt digest changed"));
        }
        let holdout_treatment =
            verify_candidate_intake_commit_v1(&mut transaction, &intake).await?;
        let handoff = load_rd_selection_in_transaction(
            &mut transaction,
            intake.decision_identity(),
            intake.result_identity(),
        )
        .await?;
        let source = protected_replay_authority_source_v1(&intake, &handoff)?;
        let request = form_protected_replay_request_v2(proposal, &intake, &source)?;

        lock_request_registration_fence_v1(
            &mut transaction,
            &source.plan_cell_set_identity,
            proposal.request_identity(),
        )
        .await?;

        if let Some(row) = sqlx::query(
            "SELECT request_digest FROM public.qualification_protected_replay_requests_v1 \
             WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(request.request_identity())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        {
            if row
                .try_get::<String, _>("request_digest")
                .map_err(storage)?
                != request.request_digest()
            {
                return Err(QualificationOwnerError::ConflictingIdentity);
            }
            let committed_at_epoch_ms: i64 = sqlx::query_scalar(
                "SELECT committed_at_epoch_ms FROM public.qualification_protected_replay_request_receipts_v1 \
                 WHERE request_identity=$1 FOR UPDATE",
            )
            .bind(request.request_identity())
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
            let receipt = form_request_receipt_v2(
                &request,
                u64::try_from(committed_at_epoch_ms).map_err(json_storage)?,
            )?;
            verify_protected_replay_request_commit_v2(&mut transaction, &request, &receipt).await?;
            persist_public_status_transition_v1(
                &mut transaction,
                intake.review_request_identity(),
                intake.candidate_identity(),
                QualificationPublicStatusV1::Evaluating,
                PublicStatusSourceV1 {
                    identity: receipt.receipt_identity(),
                    digest: receipt.receipt_digest(),
                    committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
                },
                None,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return commit_projection_v2(&request, &receipt);
        }

        reject_request_after_set_seal_v1(&mut transaction, &source.plan_cell_set_identity).await?;

        if holdout_treatment.is_none() {
            return Err(unavailable(
                "Candidate Intake has no preregistered holdout treatment",
            ));
        }

        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let receipt = form_request_receipt_v2(&request, committed_at_epoch_ms)?;
        let request_bytes = request.to_canonical_bytes()?;
        let request_json: serde_json::Value =
            serde_json::from_slice(&request_bytes).map_err(json_storage)?;
        let request_storage_digest = canonical_digest(
            "qualification.protected-replay-request.storage.v1",
            &request_bytes,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_protected_replay_requests_v1 \
             (request_identity,request_digest,review_request_identity,intake_receipt_identity,holdout_reservation_identity,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,request_json,canonical_request_bytes,storage_digest,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(request.request_identity())
        .bind(request.request_digest())
        .bind(request.review_request_identity())
        .bind(request.intake_receipt_identity())
        .bind(request.holdout_reservation_identity())
        .bind(request.protected_plan_identity())
        .bind(request.protected_plan_digest())
        .bind(request.plan_cell_identity())
        .bind(request.plan_cell_digest())
        .bind(&request_json)
        .bind(&request_bytes)
        .bind(&request_storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        let receipt_json = receipt.as_json()?;
        let receipt_bytes = serde_json::to_vec(&receipt_json).map_err(json_storage)?;
        let receipt_storage_digest = canonical_digest(
            "qualification.protected-replay-request-receipt.storage.v1",
            &receipt_bytes,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_protected_replay_request_receipts_v1 \
             (request_identity,request_digest,receipt_identity,receipt_digest,seal_digest,receipt_json,canonical_receipt_bytes,storage_digest,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(request.request_identity())
        .bind(request.request_digest())
        .bind(receipt.receipt_identity())
        .bind(receipt.receipt_digest())
        .bind(receipt.seal_digest())
        .bind(&receipt_json)
        .bind(&receipt_bytes)
        .bind(&receipt_storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        let outbox_payload = serde_json::json!({
            "schema_version": 1,
            "request_identity": request.request_identity(),
            "request_digest": request.request_digest(),
            "receipt_identity": receipt.receipt_identity(),
            "seal_digest": receipt.seal_digest(),
        });
        let event_digest = canonical_digest(
            "qualification.protected-replay-request-frozen-event.v1",
            &outbox_payload,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_owner_outbox_v1 \
             (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
             VALUES ($1,$2,'QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1',$3,$4,$5)",
        )
        .bind(identity(
            "qualification-protected-replay-request-frozen-event-v1",
            &event_digest,
        ))
        .bind(request.request_identity())
        .bind(event_digest)
        .bind(outbox_payload)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        verify_protected_replay_request_commit_v2(&mut transaction, &request, &receipt).await?;
        persist_public_status_transition_v1(
            &mut transaction,
            intake.review_request_identity(),
            intake.candidate_identity(),
            QualificationPublicStatusV1::Evaluating,
            PublicStatusSourceV1 {
                identity: receipt.receipt_identity(),
                digest: receipt.receipt_digest(),
                committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
            },
            None,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        commit_projection_v2(&request, &receipt)
    }

    /// Seal the complete, duplicate-free V2 request membership for one admitted protected plan.
    /// Qualification re-derives the admitted plan, validates the typed economic policy against its
    /// frozen references, and locks every request before it closes the registration fence.
    pub async fn seal_protected_replay_request_set_v1(
        &self,
        review_request_identity: &str,
        intake_receipt_identity: &str,
        economic_policy: &ProtectedEconomicPolicyBundleV1,
    ) -> Result<ProtectedReplayRequestSetCommitV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE review_request_identity=$1 AND receipt_identity=$2 AND status='ADMITTED' FOR UPDATE",
        )
        .bind(review_request_identity)
        .bind(intake_receipt_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or_else(|| unavailable("ADMITTED Candidate Intake custody is unavailable"))?;
        let intake = decode_intake_receipt_v1(&intake_json)?;
        verify_candidate_intake_commit_v1(&mut transaction, &intake)
            .await?
            .ok_or_else(|| unavailable("preregistered holdout treatment is unavailable"))?;
        let handoff = load_rd_selection_in_transaction(
            &mut transaction,
            intake.decision_identity(),
            intake.result_identity(),
        )
        .await?;
        let source = protected_replay_authority_source_v1(&intake, &handoff)?;
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(&source.plan_cell_set_identity)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        // The sealed `qualification_api` request-set census scopes the members it will admit to
        // current-schema rows bound to this exact frozen basis. Origin (`schema_version=1`) rows
        // stay registered for their own replay and disposition terminal but carry a different
        // canonical encoding, so reading them here would fail the set decode and strand the
        // frontier. Select on the same predicate the authority census uses.
        let rows = sqlx::query(
            "SELECT request.request_json,request.canonical_request_bytes,request.storage_digest,\
                    receipt.receipt_json \
             FROM public.qualification_protected_replay_requests_v1 request \
             JOIN public.qualification_protected_replay_request_receipts_v1 receipt \
               ON receipt.request_identity=request.request_identity \
             WHERE request.review_request_identity=$1 \
               AND request.intake_receipt_identity=$2 \
               AND request.holdout_reservation_identity=$3 \
               AND request.protected_plan_identity=$4 \
               AND request.protected_plan_digest=$5 \
               AND request.request_json->>'schema_version'='2' \
               AND request.request_json#>>'{frozen_basis,plan_cell_set_identity}'=$6 \
               AND request.request_json#>>'{frozen_basis,plan_cell_set_digest}'=$7 \
             ORDER BY request.plan_cell_identity \
             FOR UPDATE OF request,receipt",
        )
        .bind(review_request_identity)
        .bind(intake_receipt_identity)
        .bind(
            intake
                .holdout_reservation_identity()
                .ok_or_else(|| unavailable("ADMITTED holdout reservation is unavailable"))?,
        )
        .bind(&source.plan_identity)
        .bind(&source.plan_digest)
        .bind(&source.plan_cell_set_identity)
        .bind(&source.plan_cell_set_digest)
        .fetch_all(&mut *transaction)
        .await
        .map_err(storage)?;
        let mut requests = Vec::with_capacity(rows.len());
        for row in rows {
            let bytes: Vec<u8> = row.try_get("canonical_request_bytes").map_err(storage)?;
            let request = decode_protected_replay_request_v2(&bytes)?;
            if request.as_json()?
                != row
                    .try_get::<serde_json::Value, _>("request_json")
                    .map_err(storage)?
                || canonical_digest("qualification.protected-replay-request.storage.v1", &bytes)?
                    != row
                        .try_get::<String, _>("storage_digest")
                        .map_err(storage)?
            {
                return Err(unavailable(
                    "frozen Protected Replay Request storage changed",
                ));
            }
            let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
            let receipt = decode_request_receipt_v2(&receipt_json, &request)?;
            verify_protected_replay_request_commit_v2(&mut transaction, &request, &receipt).await?;
            requests.push((request, receipt));
        }
        let commit =
            form_protected_replay_request_set_v1(&intake, &source, &requests, economic_policy)?;
        validate_economic_policy_bundle(economic_policy, &source)?;

        if let Some(row) = sqlx::query(
            "SELECT seal_json,canonical_seal_bytes,storage_digest \
             FROM public.qualification_protected_replay_request_sets_v1 \
             WHERE plan_cell_set_identity=$1",
        )
        .bind(&source.plan_cell_set_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        {
            let bytes: Vec<u8> = row.try_get("canonical_seal_bytes").map_err(storage)?;
            let stored = decode_protected_replay_request_set_v1(&bytes)?;
            if stored != commit
                || stored.as_json()?
                    != row
                        .try_get::<serde_json::Value, _>("seal_json")
                        .map_err(storage)?
                || canonical_digest(
                    "qualification.protected-replay-request-set.storage.v1",
                    &bytes,
                )? != row
                    .try_get::<String, _>("storage_digest")
                    .map_err(storage)?
            {
                return Err(QualificationOwnerError::ConflictingIdentity);
            }
            verify_protected_replay_request_set_commit_v1(&mut transaction, &stored).await?;
            verify_protected_economic_policy_bundle_v1(
                &mut transaction,
                review_request_identity,
                stored.seal(),
                economic_policy,
                &source,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(stored);
        }

        let bytes = commit.to_canonical_bytes()?;
        let seal_json = commit.as_json()?;
        let storage_digest = canonical_digest(
            "qualification.protected-replay-request-set.storage.v1",
            &bytes,
        )?;
        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        sqlx::query(
            "INSERT INTO public.qualification_protected_replay_request_sets_v1 \
             (request_set_identity,request_set_digest,review_request_identity,intake_receipt_identity,\
              holdout_reservation_identity,protected_plan_identity,protected_plan_digest,\
              plan_cell_set_identity,plan_cell_set_digest,seal_json,canonical_seal_bytes,storage_digest,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(commit.request_set_identity())
        .bind(commit.request_set_digest())
        .bind(review_request_identity)
        .bind(intake_receipt_identity)
        .bind(commit.seal().holdout_reservation_identity.as_str())
        .bind(&source.plan_identity)
        .bind(&source.plan_digest)
        .bind(&source.plan_cell_set_identity)
        .bind(&source.plan_cell_set_digest)
        .bind(&seal_json)
        .bind(&bytes)
        .bind(&storage_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        persist_protected_economic_policy_bundle_v1(
            &mut transaction,
            review_request_identity,
            &commit,
            economic_policy,
            &source,
            committed_at_epoch_ms,
        )
        .await?;
        let payload = serde_json::json!({
            "schema_version": 1,
            "request_set_identity": commit.request_set_identity(),
            "request_set_digest": commit.request_set_digest(),
            "plan_cell_set_identity": source.plan_cell_set_identity,
            "plan_cell_set_digest": source.plan_cell_set_digest,
        });
        let event_digest = canonical_digest(
            "qualification.protected-replay-request-set-sealed-event.v1",
            &payload,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_owner_outbox_v1 \
             (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
             VALUES ($1,$2,'QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_SEALED_V1',$3,$4,$5)",
        )
        .bind(identity(
            "qualification-protected-replay-request-set-sealed-event-v1",
            &event_digest,
        ))
        .bind(commit.request_set_identity())
        .bind(&event_digest)
        .bind(&payload)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let custody_payload = serde_json::json!({
            "schema_version": 1,
            "request_set_identity": commit.request_set_identity(),
            "request_set_digest": commit.request_set_digest(),
            "seal_storage_digest": storage_digest,
        });
        let custody_digest = canonical_digest(
            "qualification.protected-replay-request-set-custody-event.v1",
            &custody_payload,
        )?;
        sqlx::query(
            "INSERT INTO public.qualification_owner_outbox_v1 \
             (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
             VALUES ($1,$2,'QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_CUSTODY_V1',$3,$4,$5)",
        )
        .bind(identity(
            "qualification-protected-replay-request-set-custody-event-v1",
            &custody_digest,
        ))
        .bind(commit.request_set_identity())
        .bind(&custody_digest)
        .bind(&custody_payload)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        verify_protected_replay_request_set_commit_v1(&mut transaction, &commit).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(commit)
    }

    /// Consume one sealed complete Backtest frontier and atomically close an all-not-applicable
    /// assessment. Accepted bases cannot turn an empty applicable-cell census into eligibility;
    /// rejected bases and duplicate attempts remain explicit in the sealed census.
    pub async fn close_all_not_applicable_assessment_v1(
        &self,
        frontier_locator: &ProtectedReplayAttemptFrontierLocatorV1,
        assessment_successor: &ClockHeadSuccessorReadback,
    ) -> Result<ProtectedAssessmentInvalidCommitV1, QualificationOwnerError> {
        match Box::pin(self.close_protected_assessment_v1(
            frontier_locator,
            assessment_successor,
            ProtectedAssessmentClosureKindV1::AllNotApplicable,
        ))
        .await?
        {
            ProtectedAssessmentCommitV1::Invalid(commit) => Ok(*commit),
            ProtectedAssessmentCommitV1::Ineligible(_)
            | ProtectedAssessmentCommitV1::Qualified(_) => Err(unavailable(
                "protected assessment returned the wrong terminal kind",
            )),
        }
    }

    /// Consume a complete sealed frontier whose applicable cells carry an authoritative
    /// `VALID_ECONOMIC_FAILURE`, then atomically commit `COMPLETE_FAIL` and `INELIGIBLE`.
    pub async fn close_economic_failure_assessment_v1(
        &self,
        frontier_locator: &ProtectedReplayAttemptFrontierLocatorV1,
        assessment_successor: &ClockHeadSuccessorReadback,
    ) -> Result<ProtectedIneligibleCommitV1, QualificationOwnerError> {
        match Box::pin(self.close_protected_assessment_v1(
            frontier_locator,
            assessment_successor,
            ProtectedAssessmentClosureKindV1::EconomicFailure,
        ))
        .await?
        {
            ProtectedAssessmentCommitV1::Ineligible(commit) => Ok(*commit),
            ProtectedAssessmentCommitV1::Invalid(_) | ProtectedAssessmentCommitV1::Qualified(_) => {
                Err(unavailable(
                    "protected assessment returned the wrong terminal kind",
                ))
            }
        }
    }

    /// Consume a complete sealed frontier whose applicable cells have no execution defect,
    /// then atomically commit `COMPLETE_PASS` and a capacity-bounded `QUALIFIED` fact.
    pub async fn close_economic_pass_assessment_v1(
        &self,
        frontier_locator: &ProtectedReplayAttemptFrontierLocatorV1,
        assessment_successor: &ClockHeadSuccessorReadback,
    ) -> Result<ProtectedQualifiedCommitV1, QualificationOwnerError> {
        match Box::pin(self.close_protected_assessment_v1(
            frontier_locator,
            assessment_successor,
            ProtectedAssessmentClosureKindV1::EconomicPass,
        ))
        .await?
        {
            ProtectedAssessmentCommitV1::Qualified(commit) => Ok(*commit),
            ProtectedAssessmentCommitV1::Invalid(_)
            | ProtectedAssessmentCommitV1::Ineligible(_) => Err(unavailable(
                "protected assessment returned the wrong terminal kind",
            )),
        }
    }

    async fn close_protected_assessment_v1(
        &self,
        frontier_locator: &ProtectedReplayAttemptFrontierLocatorV1,
        assessment_successor: &ClockHeadSuccessorReadback,
        kind: ProtectedAssessmentClosureKindV1,
    ) -> Result<ProtectedAssessmentCommitV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let locked_frontier =
            resolve_protected_replay_attempt_frontier_for_qualification_in_transaction(
                &mut transaction,
                frontier_locator,
            )
            .await
            .map_err(|_| unavailable("sealed Backtest attempt frontier custody is unavailable"))?
            .ok_or_else(|| unavailable("sealed Backtest attempt frontier is unavailable"))?;
        let frontier = locked_frontier.frontier();
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(&frontier.frontier_identity)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        let request_set_row = sqlx::query(
            "SELECT review_request_identity,seal_json,canonical_seal_bytes,storage_digest \
             FROM public.qualification_protected_replay_request_sets_v1 \
             WHERE request_set_identity=$1 AND request_set_digest=$2",
        )
        .bind(&frontier.request_set_identity)
        .bind(&frontier.request_set_digest)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or_else(|| unavailable("sealed Protected Replay Request set is unavailable"))?;
        let request_set_bytes: Vec<u8> = request_set_row
            .try_get("canonical_seal_bytes")
            .map_err(storage)?;
        let request_set = decode_protected_replay_request_set_v1(&request_set_bytes)?;
        if request_set.as_json()?
            != request_set_row
                .try_get::<serde_json::Value, _>("seal_json")
                .map_err(storage)?
            || canonical_digest(
                "qualification.protected-replay-request-set.storage.v1",
                &request_set_bytes,
            )? != request_set_row
                .try_get::<String, _>("storage_digest")
                .map_err(storage)?
        {
            return Err(unavailable("Protected Replay Request set storage changed"));
        }
        verify_protected_replay_request_set_commit_v1(&mut transaction, &request_set).await?;
        let review_request_identity: String = request_set_row
            .try_get("review_request_identity")
            .map_err(storage)?;

        let mut requests = Vec::with_capacity(request_set.seal().members.len());
        for member in &request_set.seal().members {
            let row = sqlx::query(
                "SELECT request_json,canonical_request_bytes,storage_digest \
                 FROM public.qualification_protected_replay_requests_v1 \
                 WHERE request_identity=$1 FOR UPDATE",
            )
            .bind(&member.request_identity)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?
            .ok_or_else(|| unavailable("frozen Protected Replay Request is unavailable"))?;
            let bytes: Vec<u8> = row.try_get("canonical_request_bytes").map_err(storage)?;
            let request = decode_protected_replay_request_v2(&bytes)?;
            let receipt_json: serde_json::Value = sqlx::query_scalar(
                "SELECT receipt_json FROM public.qualification_protected_replay_request_receipts_v1 \
                 WHERE request_identity=$1 FOR UPDATE",
            )
            .bind(&member.request_identity)
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;
            let receipt = decode_request_receipt_v2(&receipt_json, &request)?;
            if request.as_json()?
                != row
                    .try_get::<serde_json::Value, _>("request_json")
                    .map_err(storage)?
                || canonical_digest("qualification.protected-replay-request.storage.v1", &bytes)?
                    != row
                        .try_get::<String, _>("storage_digest")
                        .map_err(storage)?
            {
                return Err(unavailable(
                    "frozen Protected Replay Request storage changed",
                ));
            }
            verify_protected_replay_request_commit_v2(&mut transaction, &request, &receipt).await?;
            requests.push(request.as_contract_dto().clone());
        }

        let mut results = Vec::with_capacity(frontier.members.len());
        for member in &frontier.members {
            let locator = ProtectedReplayResultLocatorV1 {
                result_identity: &member.result.result_identity,
                request_identity: &member.request_identity,
                attempt_identity: &member.attempt_identity,
            };
            let result = resolve_protected_replay_result_v3_for_qualification_in_transaction(
                &mut transaction,
                locator,
            )
            .await
            .map_err(|_| unavailable("sealed Protected Replay Result custody is unavailable"))?
            .ok_or_else(|| unavailable("sealed Protected Replay Result is unavailable"))?;
            results.push(result.result().clone());
        }

        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE review_request_identity=$1 FOR UPDATE",
        )
        .bind(&review_request_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let intake = decode_intake_receipt_v1(&intake_json)?;
        let holdout_treatment = verify_candidate_intake_commit_v1(&mut transaction, &intake)
            .await?
            .ok_or_else(|| unavailable("preregistered holdout treatment is unavailable"))?;
        let handoff = load_rd_selection_in_transaction(
            &mut transaction,
            intake.decision_identity(),
            intake.result_identity(),
        )
        .await?;
        let source = protected_replay_authority_source_v1(&intake, &handoff)?;
        let economic_policy = load_protected_economic_policy_bundle_v1(
            &mut transaction,
            &review_request_identity,
            request_set.request_set_identity(),
            request_set.seal(),
            &source,
        )
        .await?;

        if let Some(committed_at) = sqlx::query_scalar::<_, i64>(
            "SELECT committed_at_epoch_ms FROM public.qualification_protected_robustness_assessments_v1 \
             WHERE attempt_frontier_identity=$1",
        )
        .bind(&frontier.frontier_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        {
            let commit = form_protected_assessment_commit_v1(
                kind,
                request_set.seal(),
                frontier,
                &requests,
                &results,
                &source,
                &economic_policy,
                assessment_successor,
                &holdout_treatment,
                u64::try_from(committed_at).map_err(json_storage)?,
            )?;
            verify_protected_assessment_commit_v1(&mut transaction, &commit).await?;
            persist_public_status_transition_v1(
                &mut transaction,
                &review_request_identity,
                intake.candidate_identity(),
                assessment_public_status_v1(&commit),
                assessment_public_status_source_v1(&commit),
                None,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(commit);
        }

        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let commit = form_protected_assessment_commit_v1(
            kind,
            request_set.seal(),
            frontier,
            &requests,
            &results,
            &source,
            &economic_policy,
            assessment_successor,
            &holdout_treatment,
            committed_at_epoch_ms,
        )?;
        persist_protected_assessment_commit_v1(&mut transaction, &commit).await?;
        persist_public_status_transition_v1(
            &mut transaction,
            &review_request_identity,
            intake.candidate_identity(),
            assessment_public_status_v1(&commit),
            assessment_public_status_source_v1(&commit),
            None,
        )
        .await?;
        verify_protected_assessment_commit_v1(&mut transaction, &commit).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(commit)
    }

    /// Consume one sealed Backtest negative terminal and atomically close its
    /// Qualification-owned holdout reservation. The caller supplies only a
    /// locator; neither the terminal disposition nor holdout treatment is caller-authored.
    pub async fn close_negative_protected_attempt_v1(
        &self,
        locator: ProtectedReplayResultLocatorV1<'_>,
    ) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
        self.close_protected_attempt_with_retry_v1(
            locator,
            ProtectedAttemptClosureKindV1::Negative,
            None,
        )
        .await
    }

    #[cfg(test)]
    async fn close_negative_protected_attempt_with_snapshot_barrier_v1(
        &self,
        locator: ProtectedReplayResultLocatorV1<'_>,
        snapshot_barrier: &ProtectedAttemptSnapshotBarrierV1,
    ) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
        self.close_protected_attempt_with_retry_v1(
            locator,
            ProtectedAttemptClosureKindV1::Negative,
            Some(snapshot_barrier),
        )
        .await
    }

    async fn close_protected_attempt_with_retry_v1(
        &self,
        locator: ProtectedReplayResultLocatorV1<'_>,
        kind: ProtectedAttemptClosureKindV1,
        first_attempt_snapshot_barrier: Option<&ProtectedAttemptSnapshotBarrierV1>,
    ) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
        match self
            .close_protected_attempt_once_v1(locator, kind, first_attempt_snapshot_barrier)
            .await
        {
            Err(NegativeClosureAttemptError::RetryableContention) => self
                .close_protected_attempt_once_v1(locator, kind, None)
                .await
                .map_err(NegativeClosureAttemptError::into_public),
            result => result.map_err(NegativeClosureAttemptError::into_public),
        }
    }

    /// Consume one request-equal protected terminal diagnostic result and atomically close its
    /// holdout reservation when the sealed evidence proves an execution defect or unresolved run.
    pub async fn close_terminal_diagnostic_protected_attempt_v1(
        &self,
        locator: ProtectedReplayResultLocatorV1<'_>,
    ) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
        self.close_protected_attempt_with_retry_v1(
            locator,
            ProtectedAttemptClosureKindV1::Diagnostic,
            None,
        )
        .await
    }

    async fn close_protected_attempt_once_v1(
        &self,
        locator: ProtectedReplayResultLocatorV1<'_>,
        kind: ProtectedAttemptClosureKindV1,
        snapshot_barrier: Option<&ProtectedAttemptSnapshotBarrierV1>,
    ) -> Result<ProtectedAttemptDispositionCommitV1, NegativeClosureAttemptError> {
        let mut transaction = self.pool.begin().await.map_err(negative_closure_storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(negative_closure_storage)?;

        // Keep the cross-Owner lock order: sealed Backtest aggregate first,
        // then Qualification's stable result/request aggregate lock.
        let locked = match kind {
            ProtectedAttemptClosureKindV1::Negative => LockedProtectedAttemptResultV1::Negative(
                resolve_protected_replay_result_for_qualification_in_transaction(
                    &mut transaction,
                    locator,
                )
                .await
                .map_err(|_| unavailable("sealed Protected Replay Result custody is unavailable"))?
                .ok_or_else(|| unavailable("sealed Protected Replay Result is unavailable"))?,
            ),
            ProtectedAttemptClosureKindV1::Diagnostic => {
                LockedProtectedAttemptResultV1::Diagnostic(
                    resolve_protected_replay_result_v2_for_qualification_in_transaction(
                        &mut transaction,
                        locator,
                    )
                    .await
                    .map_err(|_| {
                        unavailable("sealed Protected Replay Result custody is unavailable")
                    })?
                    .ok_or_else(|| unavailable("sealed Protected Replay Result is unavailable"))?,
                )
            }
        };
        #[cfg(test)]
        if let Some(snapshot_barrier) = snapshot_barrier {
            snapshot_barrier.wait().await;
        }
        #[cfg(not(test))]
        let _ = snapshot_barrier;
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(locator.result_identity)
            .execute(&mut *transaction)
            .await
            .map_err(negative_closure_storage)?;

        let request_row = sqlx::query(
            "SELECT request_json,canonical_request_bytes,storage_digest FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(locator.request_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(negative_closure_storage)?
        .ok_or_else(|| unavailable("frozen Protected Replay Request is unavailable"))?;
        let request_bytes: Vec<u8> = request_row
            .try_get("canonical_request_bytes")
            .map_err(storage)?;
        let request = decode_protected_replay_request_v1(&request_bytes)?;
        let request_json: serde_json::Value =
            request_row.try_get("request_json").map_err(storage)?;
        if request.as_json()? != request_json
            || canonical_digest(
                "qualification.protected-replay-request.storage.v1",
                &request_bytes,
            )? != request_row
                .try_get::<String, _>("storage_digest")
                .map_err(storage)?
        {
            return Err(unavailable("frozen Protected Replay Request storage changed").into());
        }
        let receipt_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(locator.request_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(negative_closure_storage)?;
        let request_receipt = decode_request_receipt_v1(&receipt_json, &request)?;
        verify_protected_replay_request_commit_v1(&mut transaction, &request, &request_receipt)
            .await?;
        let request_locator = ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity().to_string(),
            request_digest: request.request_digest().to_string(),
            receipt_identity: request_receipt.receipt_identity().to_string(),
            seal_digest: request_receipt.seal_digest().to_string(),
        };
        let request_dto = request.as_contract_dto();
        locked.validate_against_request(&request_dto, &request_locator)?;

        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1 FOR UPDATE",
        )
        .bind(&request_dto.review_request_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(negative_closure_storage)?;
        let intake = decode_intake_receipt_v1(&intake_json)?;
        if intake.status() != CandidateIntakeStatusV1::Admitted
            || intake.receipt_identity() != request_dto.intake_receipt_identity
            || intake.receipt_digest() != request_dto.intake_receipt_digest
            || intake.candidate_identity() != request_dto.candidate_identity
            || intake.candidate_digest() != request_dto.candidate_digest
            || intake.holdout_reservation_identity()
                != Some(request_dto.holdout_reservation_identity.as_str())
            || intake.protected_decision_policy_identity()
                != request_dto.protected_decision_policy_identity
            || intake.protected_decision_policy_version()
                != request_dto.protected_decision_policy_version
        {
            return Err(unavailable("Candidate Intake custody changed before closure").into());
        }
        let holdout_treatment = verify_candidate_intake_commit_v1(&mut transaction, &intake)
            .await?
            .ok_or_else(|| unavailable("preregistered holdout treatment is unavailable"))?;

        if let Some(committed_at) = sqlx::query_scalar::<_, i64>(
            "SELECT committed_at_epoch_ms FROM public.qualification_protected_attempt_dispositions_v1 WHERE result_identity=$1",
        )
        .bind(locator.result_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(negative_closure_storage)?
        {
            let commit = locked.form_disposition(
                &request_dto,
                &holdout_treatment,
                u64::try_from(committed_at).map_err(json_storage)?,
            )?;
            verify_negative_protected_attempt_commit_v1(&mut transaction, &commit).await?;
            persist_protected_attempt_public_terminal_v1(
                &mut transaction,
                &request_dto,
                &request_locator,
                &holdout_treatment,
                &commit,
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(negative_closure_storage)?;
            return Ok(commit);
        }

        let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let commit =
            locked.form_disposition(&request_dto, &holdout_treatment, committed_at_epoch_ms)?;
        let disposition = commit.disposition();
        let receipt = commit.receipt();
        let disposition_json = disposition.as_json()?;
        let receipt_json = receipt.as_json()?;
        sqlx::query("INSERT INTO public.qualification_protected_attempt_dispositions_v1 (disposition_identity,disposition_digest,status,request_identity,result_identity,attempt_identity,holdout_reservation_identity,disposition_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(disposition.disposition_identity())
            .bind(disposition.disposition_digest())
            .bind(disposition_status(disposition.status()))
            .bind(disposition.request_identity())
            .bind(disposition.result_identity())
            .bind(disposition.attempt_identity())
            .bind(disposition.holdout_reservation_identity())
            .bind(&disposition_json)
            .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(|e| negative_closure_sql_error(e, &["qualification_protected_attempt_dispositions_v1"]))?;
        sqlx::query("INSERT INTO public.qualification_holdout_closures_v1 (closure_identity,closure_digest,reservation_identity,disposition_identity,closure_disposition,closure_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(disposition.holdout_closure_identity())
            .bind(disposition.holdout_closure_digest())
            .bind(disposition.holdout_reservation_identity())
            .bind(disposition.disposition_identity())
            .bind(closure_status(disposition.closure_disposition()))
            .bind(serde_json::json!({"schema_version":1,"closure_identity":disposition.holdout_closure_identity(),"closure_digest":disposition.holdout_closure_digest(),"reservation_identity":disposition.holdout_reservation_identity(),"disposition_identity":disposition.disposition_identity(),"closure_disposition":closure_status(disposition.closure_disposition())}))
            .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(|e| negative_closure_sql_error(e, &["qualification_holdout_closures_v1"]))?;
        sqlx::query("INSERT INTO public.qualification_protected_attempt_disposition_receipts_v1 (disposition_identity,receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(disposition.disposition_identity())
            .bind(receipt.receipt_identity())
            .bind(receipt.receipt_digest())
            .bind(&receipt_json)
            .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(|e| negative_closure_sql_error(e, &["qualification_protected_attempt_disposition_receipts_v1"]))?;
        let payload = serde_json::to_value(&commit).map_err(json_storage)?;
        let event_digest = canonical_digest(
            "qualification.protected-attempt-disposition-event.v1",
            &payload,
        )?;
        sqlx::query("INSERT INTO public.qualification_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1',$3,$4,$5)")
            .bind(identity("qualification-protected-attempt-disposition-event-v1", &event_digest))
            .bind(disposition.disposition_identity())
            .bind(&event_digest)
            .bind(&payload)
            .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut *transaction).await.map_err(|e| negative_closure_sql_error(e, &["qualification_owner_outbox_v1"]))?;
        persist_protected_attempt_public_terminal_v1(
            &mut transaction,
            &request_dto,
            &request_locator,
            &holdout_treatment,
            &commit,
        )
        .await?;
        verify_negative_protected_attempt_commit_v1(&mut transaction, &commit).await?;
        transaction
            .commit()
            .await
            .map_err(negative_closure_storage)?;
        Ok(commit)
    }

    async fn migrate(&self) -> Result<(), QualificationOwnerError> {
        let admitted: bool = sqlx::query_scalar(
            "SELECT
                pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CONNECT')
                AND (SELECT pg_catalog.bool_and(pg_catalog.has_table_privilege(current_user, table_name, privilege_name))
                 FROM pg_catalog.unnest(ARRAY[
                   'public.qualification_protected_feedback_projections_v1',
                   'public.qualification_protected_feedback_heads_v1',
                   'public.qualification_candidate_intake_receipts_v1',
                   'public.qualification_holdout_reservations_v1',
                   'public.qualification_protected_replay_requests_v1',
                   'public.qualification_protected_replay_request_receipts_v1',
                   'public.qualification_owner_outbox_v1'
                ]) table_name
                 CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) privilege_name)
                AND NOT (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(current_user, table_name, privilege_name))
                 FROM pg_catalog.unnest(ARRAY[
                   'public.qualification_protected_feedback_projections_v1',
                   'public.qualification_protected_feedback_heads_v1',
                   'public.qualification_candidate_intake_receipts_v1',
                   'public.qualification_holdout_reservations_v1',
                   'public.qualification_protected_replay_requests_v1',
                   'public.qualification_protected_replay_request_receipts_v1',
                   'public.qualification_owner_outbox_v1'
                 ]) table_name
                 CROSS JOIN pg_catalog.unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) privilege_name)
                AND (SELECT pg_catalog.bool_and(pg_catalog.has_table_privilege(current_user, table_name, privilege_name))
                 FROM pg_catalog.unnest(ARRAY[
                   'public.qualification_protected_replay_request_sets_v1',
                   'public.qualification_protected_attempt_dispositions_v1',
                   'public.qualification_protected_robustness_assessments_v1',
                   'public.qualification_eligibility_facts_v1',
                   'public.qualification_eligibility_fact_receipts_v1',
                   'public.qualification_protected_attempt_dispositions_v2',
                   'public.qualification_holdout_closures_v1',
                   'public.qualification_holdout_closures_v2',
                   'public.qualification_protected_attempt_disposition_receipts_v1',
                   'public.qualification_protected_attempt_disposition_receipts_v2'
                 ]) table_name
                 CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT']) privilege_name)
                AND NOT (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(current_user, table_name, privilege_name))
                 FROM pg_catalog.unnest(ARRAY[
                   'public.qualification_protected_replay_request_sets_v1',
                   'public.qualification_protected_attempt_dispositions_v1',
                   'public.qualification_protected_robustness_assessments_v1',
                   'public.qualification_eligibility_facts_v1',
                   'public.qualification_eligibility_fact_receipts_v1',
                   'public.qualification_protected_attempt_dispositions_v2',
                   'public.qualification_holdout_closures_v1',
                   'public.qualification_holdout_closures_v2',
                   'public.qualification_protected_attempt_disposition_receipts_v1',
                   'public.qualification_protected_attempt_disposition_receipts_v2'
                 ]) table_name
                 CROSS JOIN pg_catalog.unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege_name)
                AND pg_catalog.has_table_privilege(current_user, 'public.qualification_public_status_facts_v1', 'SELECT,INSERT')
                AND NOT pg_catalog.has_table_privilege(current_user, 'public.qualification_public_status_facts_v1', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND pg_catalog.has_table_privilege(current_user, 'public.qualification_public_status_heads_v1', 'SELECT,INSERT,UPDATE')
                AND NOT pg_catalog.has_table_privilege(current_user, 'public.qualification_public_status_heads_v1', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND NOT EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid = relation.relnamespace
                  WHERE namespace.nspname = 'public'
                    AND relation.relkind IN ('r', 'p')
                    AND relation.relname LIKE 'rd_%'
                    AND (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(
                      current_user,
                      relation.oid,
                      privilege_name
                    )) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege_name)
                )
                AND pg_catalog.has_schema_privilege(current_user, 'rd_owner_api', 'USAGE')
                AND pg_catalog.has_function_privilege(current_user, 'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)', 'EXECUTE')
                AND pg_catalog.has_function_privilege(current_user, 'rd_owner_api.lock_ready_for_selection_for_qualification_v1(text,text)', 'EXECUTE')
                AND pg_catalog.has_schema_privilege('backtest_owner', 'qualification_api', 'USAGE')
                AND pg_catalog.has_function_privilege('backtest_owner', 'qualification_api.lock_protected_replay_request_v1(text,text,text,text)', 'EXECUTE')
                AND pg_catalog.has_function_privilege('backtest_owner', 'qualification_api.lock_protected_replay_request_set_v1(text,text)', 'EXECUTE')
                AND pg_catalog.has_schema_privilege('product_edge_owner', 'qualification_api', 'USAGE')
                AND pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.read_public_status_v1(text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_json_text_v1(jsonb)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_json_digest_v1(text,jsonb)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_bytes_storage_digest_v1(text,bytea)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_ordered_json_digest_v1(text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.protected_replay_request_semantic_digest_is_valid_v1(jsonb,bytea,text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.protected_replay_request_set_is_custodied_v1(text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.public_status_expected_opaque_reference_v1(text,text,text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.public_status_expected_fact_digest_v1(text,text,text,text,text,text,boolean)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.public_status_native_source_is_custodied_v1(text,text,bigint,text,text,text,bigint)', 'EXECUTE')
                AND NOT pg_catalog.has_table_privilege('product_edge_owner', 'public.qualification_public_status_facts_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND NOT pg_catalog.has_table_privilege('product_edge_owner', 'public.qualification_public_status_heads_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.lock_protected_replay_request_v1(text,text,text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.lock_protected_replay_request_set_v1(text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.read_public_status_v1(text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.canonical_json_text_v1(jsonb)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.canonical_json_digest_v1(text,jsonb)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.canonical_bytes_storage_digest_v1(text,bytea)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.canonical_ordered_json_digest_v1(text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.protected_replay_request_semantic_digest_is_valid_v1(jsonb,bytea,text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.protected_replay_request_set_is_custodied_v1(text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.public_status_expected_opaque_reference_v1(text,text,text,text)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.public_status_expected_fact_digest_v1(text,text,text,text,text,text,boolean)', 'EXECUTE')
                AND NOT pg_catalog.has_function_privilege(current_user, 'qualification_api.public_status_native_source_is_custodied_v1(text,text,bigint,text,text,text,bigint)', 'EXECUTE')
                AND pg_catalog.has_function_privilege(current_user, 'backtest_owner_api.resolve_protected_replay_attempt_frontier_v1(text,text)', 'EXECUTE')
                AND NOT pg_catalog.pg_has_role(current_user, 'qualification_owner', 'MEMBER')
                AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE tableowner = current_user)
                AND NOT EXISTS (
                  SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = current_user
                    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
                )
                AND pg_catalog.has_function_privilege(current_user, 'qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)', 'EXECUTE')",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(unavailable(
                "Qualification writer physical custody is unavailable",
            ));
        }
        Ok(())
    }

    /// Resolve the exact R&D basis and return its current Qualification-owned
    /// projection, appending one locked successor only when the latest exact
    /// projection is stale. The locator is never treated as evidence.
    ///
    /// Callers cannot supply the Qualification freshness cut:
    ///
    /// ```compile_fail
    /// use vibe_qualification::{PostgresQualificationOwnerV1, RdIndependenceBasisLocatorV1};
    /// fn caller_cut_is_rejected(
    ///     owner: &PostgresQualificationOwnerV1,
    ///     locator: &RdIndependenceBasisLocatorV1,
    /// ) {
    ///     let _ = owner.resolve_or_create_for_basis(locator, 1_u64);
    /// }
    /// ```
    pub async fn resolve_or_create_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        self.resolve_or_create_for_basis_inner(locator).await
    }

    async fn resolve_or_create_for_basis_inner(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let basis = load_rd_basis_in_transaction(&mut transaction, locator).await?;
        let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
        lock_principal_scope_in_transaction(&mut transaction, &principal_scope_key).await?;
        let history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;

        if let Some(existing) = history.projection_for_basis(&basis.basis_identity) {
            let owner_read_cut_epoch_ms =
                owner_clock_epoch_ms_in_transaction(&mut transaction).await?;

            if verify_projection_freshness(existing, owner_read_cut_epoch_ms).is_ok() {
                transaction.commit().await.map_err(storage)?;
                return Ok(existing.clone());
            }
        }

        let (
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
        ) = if let Some(head) = history.current_frontier.as_ref() {
            (
                ProtectedFeedbackResolutionV1::Frontier,
                head.source_sequence,
                head.source_cut.clone(),
                Some(head.projection_identity.clone()),
                Some(head.projection_digest.clone()),
            )
        } else {
            (
                ProtectedFeedbackResolutionV1::GenesisEmpty,
                0,
                "qualification-protected-feedback-cut-v1-0".to_string(),
                None,
                None,
            )
        };

        let owner_write_cut_epoch_ms =
            owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        let projection_at_epoch_ms = owner_write_cut_epoch_ms;
        let projection = form_projection(
            &basis,
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
            projection_at_epoch_ms,
        )?;
        persist_projection_in_transaction(
            &mut transaction,
            &projection,
            &principal_scope_key,
            resolution == ProtectedFeedbackResolutionV1::GenesisEmpty,
        )
        .await?;
        let verified_history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;
        let verified = verified_history
            .projection_for_basis(&basis.basis_identity)
            .ok_or_else(|| unavailable("committed Qualification projection missing"))?;

        let owner_response_cut_epoch_ms =
            owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        if let Err(e) = verify_projection_freshness(verified, owner_response_cut_epoch_ms) {
            transaction.rollback().await.map_err(storage)?;
            return Err(e);
        }
        let verified = verified.clone();
        transaction.commit().await.map_err(storage)?;
        Ok(verified)
    }

    pub async fn resolve_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let projection = admit_projection_in_transaction(&mut transaction, locator).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(projection)
    }

    pub async fn admit_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        admit_projection_in_transaction(transaction, locator).await
    }
}

async fn lock_request_registration_fence_v1(
    transaction: &mut Transaction<'_, Postgres>,
    plan_cell_set_identity: &str,
    request_identity: &str,
) -> Result<(), QualificationOwnerError> {
    for identity in [plan_cell_set_identity, request_identity] {
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(identity)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

async fn reject_request_after_set_seal_v1(
    transaction: &mut Transaction<'_, Postgres>,
    plan_cell_set_identity: &str,
) -> Result<(), QualificationOwnerError> {
    let sealed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM public.qualification_protected_replay_request_sets_v1 \
         WHERE plan_cell_set_identity=$1)",
    )
    .bind(plan_cell_set_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;

    if sealed {
        Err(unavailable(
            "Protected Replay Request registration is closed by the request-set seal",
        ))
    } else {
        Ok(())
    }
}

async fn verify_protected_replay_request_set_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedReplayRequestSetCommitV1,
) -> Result<(), QualificationOwnerError> {
    let bytes = commit.to_canonical_bytes()?;
    let seal_json = commit.as_json()?;
    let storage_digest = canonical_digest(
        "qualification.protected-replay-request-set.storage.v1",
        &bytes,
    )?;
    let rows = sqlx::query(
        "SELECT request_set_digest,seal_json,canonical_seal_bytes,storage_digest,committed_at_epoch_ms \
         FROM public.qualification_protected_replay_request_sets_v1 \
         WHERE request_set_identity=$1",
    )
    .bind(commit.request_set_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if rows.len() != 1
        || rows[0]
            .try_get::<String, _>("request_set_digest")
            .map_err(storage)?
            != commit.request_set_digest()
        || rows[0]
            .try_get::<serde_json::Value, _>("seal_json")
            .map_err(storage)?
            != seal_json
        || rows[0]
            .try_get::<Vec<u8>, _>("canonical_seal_bytes")
            .map_err(storage)?
            != bytes
        || rows[0]
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != storage_digest
    {
        return Err(unavailable("Protected Replay Request set custody changed"));
    }
    let committed_at: i64 = rows[0].try_get("committed_at_epoch_ms").map_err(storage)?;
    let outbox_rows = sqlx::query(
        "SELECT payload_digest,payload_json,committed_at_epoch_ms \
         FROM public.qualification_owner_outbox_v1 \
         WHERE aggregate_identity=$1 \
           AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_SEALED_V1' FOR UPDATE",
    )
    .bind(commit.request_set_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let expected_payload = serde_json::json!({
        "schema_version": 1,
        "request_set_identity": commit.request_set_identity(),
        "request_set_digest": commit.request_set_digest(),
        "plan_cell_set_identity": commit.seal().plan_cell_set_identity,
        "plan_cell_set_digest": commit.seal().plan_cell_set_digest,
    });
    let expected_payload_digest = canonical_digest(
        "qualification.protected-replay-request-set-sealed-event.v1",
        &expected_payload,
    )?;

    if outbox_rows.len() != 1
        || outbox_rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != expected_payload_digest
        || outbox_rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != expected_payload
        || outbox_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request set outbox changed"));
    }
    let custody_rows = sqlx::query(
        "SELECT payload_digest,payload_json,committed_at_epoch_ms \
         FROM public.qualification_owner_outbox_v1 \
         WHERE aggregate_identity=$1 \
           AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_CUSTODY_V1' FOR UPDATE",
    )
    .bind(commit.request_set_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let expected_custody_payload = serde_json::json!({
        "schema_version": 1,
        "request_set_identity": commit.request_set_identity(),
        "request_set_digest": commit.request_set_digest(),
        "seal_storage_digest": storage_digest,
    });
    let expected_custody_digest = canonical_digest(
        "qualification.protected-replay-request-set-custody-event.v1",
        &expected_custody_payload,
    )?;

    if custody_rows.len() != 1
        || custody_rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != expected_custody_digest
        || custody_rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != expected_custody_payload
        || custody_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable(
            "Protected Replay Request set custody outbox changed",
        ));
    }
    Ok(())
}

async fn persist_protected_economic_policy_bundle_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    request_set: &ProtectedReplayRequestSetCommitV1,
    policy: &ProtectedEconomicPolicyBundleV1,
    source: &ProtectedReplayAuthoritySourceV1,
    committed_at_epoch_ms: u64,
) -> Result<(), QualificationOwnerError> {
    validate_economic_policy_bundle(policy, source)?;
    let bytes = policy
        .to_canonical_bytes()
        .map_err(|e| unavailable(e.to_string()))?;
    let policy_json = serde_json::to_value(policy).map_err(json_storage)?;
    let storage_digest = canonical_digest(
        "qualification.protected-economic-policy-bundle.storage.v1",
        &bytes,
    )?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_economic_policy_bundles_v1 (request_set_identity,bundle_identity,bundle_digest,review_request_identity,protected_plan_identity,protected_plan_digest,policy_json,canonical_policy_bytes,storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(request_set.request_set_identity())
    .bind(&policy.bundle_identity)
    .bind(&policy.bundle_digest)
    .bind(review_request_identity)
    .bind(&source.plan_identity)
    .bind(&source.plan_digest)
    .bind(&policy_json)
    .bind(&bytes)
    .bind(&storage_digest)
    .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    let custody_payload = serde_json::json!({
        "schema_version": 1,
        "request_set_identity": request_set.request_set_identity(),
        "bundle_identity": policy.bundle_identity,
        "bundle_digest": policy.bundle_digest,
        "policy_storage_digest": storage_digest,
    });
    let custody_digest = canonical_digest(
        "qualification.protected-economic-policy-bundle-frozen-event.v1",
        &custody_payload,
    )?;
    sqlx::query(
        "INSERT INTO public.qualification_owner_outbox_v1 \
         (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'QUALIFICATION_PROTECTED_ECONOMIC_POLICY_BUNDLE_FROZEN_V1',$3,$4,$5)",
    )
    .bind(identity(
        "qualification-protected-economic-policy-bundle-frozen-event-v1",
        &custody_digest,
    ))
    .bind(request_set.request_set_identity())
    .bind(&custody_digest)
    .bind(&custody_payload)
    .bind(i64::try_from(committed_at_epoch_ms).map_err(json_storage)?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    verify_protected_economic_policy_bundle_v1(
        transaction,
        review_request_identity,
        request_set.seal(),
        policy,
        source,
    )
    .await
}

async fn load_protected_economic_policy_bundle_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    request_set_identity: &str,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    source: &ProtectedReplayAuthoritySourceV1,
) -> Result<ProtectedEconomicPolicyBundleV1, QualificationOwnerError> {
    if request_set_identity != request_set.request_set_identity {
        return Err(unavailable(
            "protected economic policy request set identity changed",
        ));
    }
    let row = sqlx::query(
        "SELECT bundle_identity,bundle_digest,review_request_identity,protected_plan_identity,protected_plan_digest,policy_json,canonical_policy_bytes,storage_digest,committed_at_epoch_ms FROM public.qualification_protected_economic_policy_bundles_v1 WHERE request_set_identity=$1",
    )
    .bind(request_set_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .ok_or_else(|| unavailable("frozen protected economic policy is unavailable"))?;
    let bytes: Vec<u8> = row.try_get("canonical_policy_bytes").map_err(storage)?;
    let policy = ProtectedEconomicPolicyBundleV1::from_canonical_bytes(&bytes)
        .map_err(|e| unavailable(e.to_string()))?;
    let policy_json = serde_json::to_value(&policy).map_err(json_storage)?;
    let storage_digest = canonical_digest(
        "qualification.protected-economic-policy-bundle.storage.v1",
        &bytes,
    )?;
    let committed_at_epoch_ms = row
        .try_get::<i64, _>("committed_at_epoch_ms")
        .map_err(storage)?;

    if row
        .try_get::<String, _>("bundle_identity")
        .map_err(storage)?
        != policy.bundle_identity
        || row.try_get::<String, _>("bundle_digest").map_err(storage)? != policy.bundle_digest
        || row
            .try_get::<String, _>("review_request_identity")
            .map_err(storage)?
            != review_request_identity
        || row
            .try_get::<String, _>("protected_plan_identity")
            .map_err(storage)?
            != source.plan_identity
        || row
            .try_get::<String, _>("protected_plan_digest")
            .map_err(storage)?
            != source.plan_digest
        || row
            .try_get::<serde_json::Value, _>("policy_json")
            .map_err(storage)?
            != policy_json
        || row
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != storage_digest
    {
        return Err(unavailable(
            "frozen protected economic policy custody changed",
        ));
    }
    let custody_payload = serde_json::json!({
        "schema_version": 1,
        "request_set_identity": request_set_identity,
        "bundle_identity": policy.bundle_identity,
        "bundle_digest": policy.bundle_digest,
        "policy_storage_digest": storage_digest,
    });
    let custody_digest = canonical_digest(
        "qualification.protected-economic-policy-bundle-frozen-event.v1",
        &custody_payload,
    )?;
    let custody_rows = sqlx::query(
        "SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms \
         FROM public.qualification_owner_outbox_v1 \
         WHERE aggregate_identity=$1 \
           AND event_kind='QUALIFICATION_PROTECTED_ECONOMIC_POLICY_BUNDLE_FROZEN_V1'",
    )
    .bind(request_set_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if custody_rows.len() != 1
        || custody_rows[0]
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != identity(
                "qualification-protected-economic-policy-bundle-frozen-event-v1",
                &custody_digest,
            )
        || custody_rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != custody_digest
        || custody_rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != custody_payload
        || custody_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at_epoch_ms
    {
        return Err(unavailable(
            "frozen protected economic policy custody outbox changed",
        ));
    }
    validate_sealed_economic_policy_bundle(&policy, request_set, source)?;
    Ok(policy)
}

async fn verify_protected_economic_policy_bundle_v1(
    transaction: &mut Transaction<'_, Postgres>,
    review_request_identity: &str,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    expected: &ProtectedEconomicPolicyBundleV1,
    source: &ProtectedReplayAuthoritySourceV1,
) -> Result<(), QualificationOwnerError> {
    let stored = load_protected_economic_policy_bundle_v1(
        transaction,
        review_request_identity,
        &request_set.request_set_identity,
        request_set,
        source,
    )
    .await?;

    if stored != *expected {
        return Err(QualificationOwnerError::ConflictingIdentity);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn form_protected_assessment_commit_v1(
    kind: ProtectedAssessmentClosureKindV1,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    requests: &[ProtectedReplayRequestDtoV2],
    results: &[ProtectedReplayResultDtoV3],
    source: &ProtectedReplayAuthoritySourceV1,
    economic_policy: &ProtectedEconomicPolicyBundleV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedAssessmentCommitV1, QualificationOwnerError> {
    match kind {
        ProtectedAssessmentClosureKindV1::AllNotApplicable => {
            form_all_not_applicable_assessment_v1(
                request_set,
                frontier,
                requests,
                results,
                source,
                economic_policy,
                assessment_successor,
                holdout_treatment,
                committed_at_epoch_ms,
            )
            .map(Box::new)
            .map(ProtectedAssessmentCommitV1::Invalid)
        }
        ProtectedAssessmentClosureKindV1::EconomicFailure => form_economic_failure_assessment_v1(
            request_set,
            frontier,
            requests,
            results,
            source,
            economic_policy,
            assessment_successor,
            holdout_treatment,
            committed_at_epoch_ms,
        )
        .map(Box::new)
        .map(ProtectedAssessmentCommitV1::Ineligible),
        ProtectedAssessmentClosureKindV1::EconomicPass => form_economic_pass_assessment_v1(
            request_set,
            frontier,
            requests,
            results,
            source,
            economic_policy,
            assessment_successor,
            holdout_treatment,
            committed_at_epoch_ms,
        )
        .map(Box::new)
        .map(ProtectedAssessmentCommitV1::Qualified),
    }
}

async fn persist_protected_assessment_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedAssessmentCommitV1,
) -> Result<(), QualificationOwnerError> {
    match commit {
        ProtectedAssessmentCommitV1::Invalid(commit) => {
            persist_protected_assessment_invalid_commit_v1(transaction, commit).await
        }
        ProtectedAssessmentCommitV1::Ineligible(commit) => {
            persist_protected_ineligible_commit_v1(transaction, commit).await
        }
        ProtectedAssessmentCommitV1::Qualified(commit) => {
            persist_protected_qualified_commit_v1(transaction, commit).await
        }
    }
}

async fn verify_protected_assessment_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedAssessmentCommitV1,
) -> Result<(), QualificationOwnerError> {
    match commit {
        ProtectedAssessmentCommitV1::Invalid(commit) => {
            verify_protected_assessment_invalid_commit_v1(transaction, commit).await
        }
        ProtectedAssessmentCommitV1::Ineligible(commit) => {
            verify_protected_ineligible_commit_v1(transaction, commit).await
        }
        ProtectedAssessmentCommitV1::Qualified(commit) => {
            verify_protected_qualified_commit_v1(transaction, commit).await
        }
    }
}

async fn persist_protected_assessment_invalid_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedAssessmentInvalidCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let disposition = commit.disposition();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(assessment.committed_at_epoch_ms()).map_err(json_storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_robustness_assessments_v1 \
         (assessment_identity,assessment_digest,request_set_identity,attempt_frontier_identity,\
          holdout_reservation_identity,plan_cell_set_identity,plan_cell_set_digest,status,\
          assessment_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,'INCOMPLETE_INVALID',$8,$9)",
    )
    .bind(assessment.assessment_identity())
    .bind(assessment.assessment_digest())
    .bind(assessment.request_set_identity())
    .bind(assessment.attempt_frontier_identity())
    .bind(assessment.holdout_reservation_identity())
    .bind(assessment.plan_cell_set_identity())
    .bind(assessment.plan_cell_set_digest())
    .bind(assessment.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_attempt_dispositions_v2 \
         (disposition_identity,disposition_digest,status,assessment_identity,\
          holdout_reservation_identity,disposition_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'ASSESSMENT_INVALID',$3,$4,$5,$6)",
    )
    .bind(disposition.disposition_identity())
    .bind(disposition.disposition_digest())
    .bind(disposition.assessment_identity())
    .bind(disposition.holdout_reservation_identity())
    .bind(disposition.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_holdout_closures_v2 \
         (closure_identity,closure_digest,reservation_identity,disposition_identity,\
          closure_disposition,closure_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(disposition.holdout_closure_identity())
    .bind(disposition.holdout_closure_digest())
    .bind(disposition.holdout_reservation_identity())
    .bind(disposition.disposition_identity())
    .bind(closure_status(disposition.holdout_closure_disposition()))
    .bind(serde_json::json!({
        "schema_version": 2,
        "closure_identity": disposition.holdout_closure_identity(),
        "closure_digest": disposition.holdout_closure_digest(),
        "reservation_identity": disposition.holdout_reservation_identity(),
        "disposition_identity": disposition.disposition_identity(),
        "closure_disposition": closure_status(disposition.holdout_closure_disposition()),
    }))
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_attempt_disposition_receipts_v2 \
         (disposition_identity,receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms) \
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(disposition.disposition_identity())
    .bind(receipt.receipt_identity())
    .bind(receipt.receipt_digest())
    .bind(receipt.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-assessment-invalid-event.v1",
        &payload,
    )?;
    sqlx::query(
        "INSERT INTO public.qualification_owner_outbox_v1 \
         (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'QUALIFICATION_PROTECTED_ASSESSMENT_INVALID_COMMITTED_V1',$3,$4,$5)",
    )
    .bind(identity(
        "qualification-protected-assessment-invalid-event-v1",
        &event_digest,
    ))
    .bind(disposition.disposition_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

async fn verify_protected_assessment_invalid_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedAssessmentInvalidCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let disposition = commit.disposition();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(assessment.committed_at_epoch_ms()).map_err(json_storage)?;
    let assessment_rows = sqlx::query(
        "SELECT assessment_digest,request_set_identity,attempt_frontier_identity,\
                holdout_reservation_identity,plan_cell_set_identity,plan_cell_set_digest,status,\
                assessment_json,committed_at_epoch_ms \
         FROM public.qualification_protected_robustness_assessments_v1 \
         WHERE assessment_identity=$1",
    )
    .bind(assessment.assessment_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if assessment_rows.len() != 1
        || assessment_rows[0]
            .try_get::<String, _>("assessment_digest")
            .map_err(storage)?
            != assessment.assessment_digest()
        || assessment_rows[0]
            .try_get::<String, _>("request_set_identity")
            .map_err(storage)?
            != assessment.request_set_identity()
        || assessment_rows[0]
            .try_get::<String, _>("attempt_frontier_identity")
            .map_err(storage)?
            != assessment.attempt_frontier_identity()
        || assessment_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != assessment.holdout_reservation_identity()
        || assessment_rows[0]
            .try_get::<String, _>("plan_cell_set_identity")
            .map_err(storage)?
            != assessment.plan_cell_set_identity()
        || assessment_rows[0]
            .try_get::<String, _>("plan_cell_set_digest")
            .map_err(storage)?
            != assessment.plan_cell_set_digest()
        || assessment_rows[0]
            .try_get::<String, _>("status")
            .map_err(storage)?
            != "INCOMPLETE_INVALID"
        || assessment_rows[0]
            .try_get::<serde_json::Value, _>("assessment_json")
            .map_err(storage)?
            != assessment.as_json()?
        || assessment_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable(
            "Protected Robustness Assessment custody changed",
        ));
    }
    let disposition_rows = sqlx::query(
        "SELECT disposition_digest,status,assessment_identity,holdout_reservation_identity,\
                disposition_json,committed_at_epoch_ms \
         FROM public.qualification_protected_attempt_dispositions_v2 \
         WHERE disposition_identity=$1",
    )
    .bind(disposition.disposition_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if disposition_rows.len() != 1
        || disposition_rows[0]
            .try_get::<String, _>("disposition_digest")
            .map_err(storage)?
            != disposition.disposition_digest()
        || disposition_rows[0]
            .try_get::<String, _>("status")
            .map_err(storage)?
            != "ASSESSMENT_INVALID"
        || disposition_rows[0]
            .try_get::<String, _>("assessment_identity")
            .map_err(storage)?
            != disposition.assessment_identity()
        || disposition_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != disposition.holdout_reservation_identity()
        || disposition_rows[0]
            .try_get::<serde_json::Value, _>("disposition_json")
            .map_err(storage)?
            != disposition.as_json()?
        || disposition_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable(
            "ASSESSMENT_INVALID disposition custody changed",
        ));
    }
    let expected_closure_json = serde_json::json!({
        "schema_version": 2,
        "closure_identity": disposition.holdout_closure_identity(),
        "closure_digest": disposition.holdout_closure_digest(),
        "reservation_identity": disposition.holdout_reservation_identity(),
        "disposition_identity": disposition.disposition_identity(),
        "closure_disposition": closure_status(disposition.holdout_closure_disposition()),
    });
    let closure_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_holdout_closures_v2 \
         WHERE closure_identity=$1 AND closure_digest=$2 AND reservation_identity=$3 \
           AND disposition_identity=$4 AND closure_disposition=$5 AND closure_json=$6 \
           AND committed_at_epoch_ms=$7",
    )
    .bind(disposition.holdout_closure_identity())
    .bind(disposition.holdout_closure_digest())
    .bind(disposition.holdout_reservation_identity())
    .bind(disposition.disposition_identity())
    .bind(closure_status(disposition.holdout_closure_disposition()))
    .bind(expected_closure_json)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let receipt_rows = sqlx::query(
        "SELECT receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms \
         FROM public.qualification_protected_attempt_disposition_receipts_v2 \
         WHERE disposition_identity=$1",
    )
    .bind(disposition.disposition_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-assessment-invalid-event.v1",
        &payload,
    )?;
    let outbox_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_owner_outbox_v1 \
         WHERE event_identity=$1 AND aggregate_identity=$2 \
           AND event_kind='QUALIFICATION_PROTECTED_ASSESSMENT_INVALID_COMMITTED_V1' \
           AND payload_digest=$3 AND payload_json=$4 AND committed_at_epoch_ms=$5",
    )
    .bind(identity(
        "qualification-protected-assessment-invalid-event-v1",
        &event_digest,
    ))
    .bind(disposition.disposition_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;

    if closure_count != 1
        || receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest()
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != receipt.as_json()?
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
        || outbox_count != 1
    {
        return Err(unavailable("ASSESSMENT_INVALID commit custody changed"));
    }
    Ok(())
}

async fn persist_protected_ineligible_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedIneligibleCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let eligibility = commit.eligibility();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(assessment.committed_at_epoch_ms()).map_err(json_storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_robustness_assessments_v1 \
         (assessment_identity,assessment_digest,request_set_identity,attempt_frontier_identity,\
          holdout_reservation_identity,plan_cell_set_identity,plan_cell_set_digest,status,\
          assessment_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETE_FAIL',$8,$9)",
    )
    .bind(assessment.assessment_identity())
    .bind(assessment.assessment_digest())
    .bind(assessment.request_set_identity())
    .bind(assessment.attempt_frontier_identity())
    .bind(assessment.holdout_reservation_identity())
    .bind(assessment.plan_cell_set_identity())
    .bind(assessment.plan_cell_set_digest())
    .bind(assessment.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_eligibility_facts_v1 \
         (eligibility_identity,eligibility_digest,status,candidate_identity,assessment_identity,\
          holdout_reservation_identity,holdout_closure_identity,holdout_closure_digest,\
          holdout_closure_disposition,eligibility_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'INELIGIBLE',$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(eligibility.eligibility_identity())
    .bind(eligibility.eligibility_digest())
    .bind(commit.assessment().candidate_identity())
    .bind(eligibility.assessment_identity())
    .bind(eligibility.holdout_reservation_identity())
    .bind(eligibility.holdout_closure_identity())
    .bind(eligibility.holdout_closure_digest())
    .bind(closure_status(eligibility.holdout_closure_disposition()))
    .bind(eligibility.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_eligibility_fact_receipts_v1 \
         (eligibility_identity,receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms) \
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(eligibility.eligibility_identity())
    .bind(receipt.receipt_identity())
    .bind(receipt.receipt_digest())
    .bind(receipt.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-eligibility-ineligible-event.v1",
        &payload,
    )?;
    sqlx::query(
        "INSERT INTO public.qualification_owner_outbox_v1 \
         (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'QUALIFICATION_PROTECTED_INELIGIBLE_COMMITTED_V1',$3,$4,$5)",
    )
    .bind(identity(
        "qualification-protected-eligibility-ineligible-event-v1",
        &event_digest,
    ))
    .bind(eligibility.eligibility_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

async fn verify_protected_ineligible_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedIneligibleCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let eligibility = commit.eligibility();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(eligibility.committed_at_epoch_ms()).map_err(json_storage)?;
    let assessment_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_protected_robustness_assessments_v1 \
         WHERE assessment_identity=$1 AND assessment_digest=$2 AND request_set_identity=$3 \
           AND attempt_frontier_identity=$4 AND holdout_reservation_identity=$5 \
           AND plan_cell_set_identity=$6 AND plan_cell_set_digest=$7 AND status='COMPLETE_FAIL' \
           AND assessment_json=$8 AND committed_at_epoch_ms=$9",
    )
    .bind(assessment.assessment_identity())
    .bind(assessment.assessment_digest())
    .bind(assessment.request_set_identity())
    .bind(assessment.attempt_frontier_identity())
    .bind(assessment.holdout_reservation_identity())
    .bind(assessment.plan_cell_set_identity())
    .bind(assessment.plan_cell_set_digest())
    .bind(assessment.as_json()?)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let eligibility_rows = sqlx::query(
        "SELECT eligibility_digest,status,candidate_identity,assessment_identity,\
                holdout_reservation_identity,holdout_closure_identity,holdout_closure_digest,\
                holdout_closure_disposition,eligibility_json,committed_at_epoch_ms \
         FROM public.qualification_eligibility_facts_v1 WHERE eligibility_identity=$1",
    )
    .bind(eligibility.eligibility_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let receipt_rows = sqlx::query(
        "SELECT receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms \
         FROM public.qualification_eligibility_fact_receipts_v1 WHERE eligibility_identity=$1",
    )
    .bind(eligibility.eligibility_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-eligibility-ineligible-event.v1",
        &payload,
    )?;
    let outbox_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_owner_outbox_v1 \
         WHERE event_identity=$1 AND aggregate_identity=$2 \
           AND event_kind='QUALIFICATION_PROTECTED_INELIGIBLE_COMMITTED_V1' \
           AND payload_digest=$3 AND payload_json=$4 AND committed_at_epoch_ms=$5",
    )
    .bind(identity(
        "qualification-protected-eligibility-ineligible-event-v1",
        &event_digest,
    ))
    .bind(eligibility.eligibility_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;

    if assessment_count != 1
        || eligibility_rows.len() != 1
        || eligibility_rows[0]
            .try_get::<String, _>("eligibility_digest")
            .map_err(storage)?
            != eligibility.eligibility_digest()
        || eligibility_rows[0]
            .try_get::<String, _>("status")
            .map_err(storage)?
            != "INELIGIBLE"
        || eligibility_rows[0]
            .try_get::<String, _>("candidate_identity")
            .map_err(storage)?
            != assessment.candidate_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("assessment_identity")
            .map_err(storage)?
            != eligibility.assessment_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != eligibility.holdout_reservation_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_identity")
            .map_err(storage)?
            != eligibility.holdout_closure_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_digest")
            .map_err(storage)?
            != eligibility.holdout_closure_digest()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_disposition")
            .map_err(storage)?
            != closure_status(eligibility.holdout_closure_disposition())
        || eligibility_rows[0]
            .try_get::<serde_json::Value, _>("eligibility_json")
            .map_err(storage)?
            != eligibility.as_json()?
        || eligibility_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
        || receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest()
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != receipt.as_json()?
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
        || outbox_count != 1
    {
        return Err(unavailable("INELIGIBLE Eligibility Fact custody changed"));
    }
    Ok(())
}

async fn persist_protected_qualified_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedQualifiedCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let eligibility = commit.eligibility();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(assessment.committed_at_epoch_ms()).map_err(json_storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_protected_robustness_assessments_v1 \
         (assessment_identity,assessment_digest,request_set_identity,attempt_frontier_identity,\
          holdout_reservation_identity,plan_cell_set_identity,plan_cell_set_digest,status,\
          assessment_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETE_PASS',$8,$9)",
    )
    .bind(assessment.assessment_identity())
    .bind(assessment.assessment_digest())
    .bind(assessment.request_set_identity())
    .bind(assessment.attempt_frontier_identity())
    .bind(assessment.holdout_reservation_identity())
    .bind(assessment.plan_cell_set_identity())
    .bind(assessment.plan_cell_set_digest())
    .bind(assessment.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_eligibility_facts_v1 \
         (eligibility_identity,eligibility_digest,status,candidate_identity,assessment_identity,\
          holdout_reservation_identity,holdout_closure_identity,holdout_closure_digest,\
          holdout_closure_disposition,eligibility_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'QUALIFIED',$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(eligibility.eligibility_identity())
    .bind(eligibility.eligibility_digest())
    .bind(commit.assessment().candidate_identity())
    .bind(eligibility.assessment_identity())
    .bind(eligibility.holdout_reservation_identity())
    .bind(eligibility.holdout_closure_identity())
    .bind(eligibility.holdout_closure_digest())
    .bind(closure_status(eligibility.holdout_closure_disposition()))
    .bind(eligibility.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO public.qualification_eligibility_fact_receipts_v1 \
         (eligibility_identity,receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms) \
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(eligibility.eligibility_identity())
    .bind(receipt.receipt_identity())
    .bind(receipt.receipt_digest())
    .bind(receipt.as_json()?)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-eligibility-qualified-event.v1",
        &payload,
    )?;
    sqlx::query(
        "INSERT INTO public.qualification_owner_outbox_v1 \
         (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) \
         VALUES ($1,$2,'QUALIFICATION_PROTECTED_QUALIFIED_COMMITTED_V1',$3,$4,$5)",
    )
    .bind(identity(
        "qualification-protected-eligibility-qualified-event-v1",
        &event_digest,
    ))
    .bind(eligibility.eligibility_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

async fn verify_protected_qualified_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedQualifiedCommitV1,
) -> Result<(), QualificationOwnerError> {
    let assessment = commit.assessment();
    let eligibility = commit.eligibility();
    let receipt = commit.receipt();
    let committed_at = i64::try_from(eligibility.committed_at_epoch_ms()).map_err(json_storage)?;
    let assessment_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_protected_robustness_assessments_v1 \
         WHERE assessment_identity=$1 AND assessment_digest=$2 AND request_set_identity=$3 \
           AND attempt_frontier_identity=$4 AND holdout_reservation_identity=$5 \
           AND plan_cell_set_identity=$6 AND plan_cell_set_digest=$7 AND status='COMPLETE_PASS' \
           AND assessment_json=$8 AND committed_at_epoch_ms=$9",
    )
    .bind(assessment.assessment_identity())
    .bind(assessment.assessment_digest())
    .bind(assessment.request_set_identity())
    .bind(assessment.attempt_frontier_identity())
    .bind(assessment.holdout_reservation_identity())
    .bind(assessment.plan_cell_set_identity())
    .bind(assessment.plan_cell_set_digest())
    .bind(assessment.as_json()?)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let eligibility_rows = sqlx::query(
        "SELECT eligibility_digest,status,candidate_identity,assessment_identity,\
                holdout_reservation_identity,holdout_closure_identity,holdout_closure_digest,\
                holdout_closure_disposition,eligibility_json,committed_at_epoch_ms \
         FROM public.qualification_eligibility_facts_v1 WHERE eligibility_identity=$1",
    )
    .bind(eligibility.eligibility_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let receipt_rows = sqlx::query(
        "SELECT receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms \
         FROM public.qualification_eligibility_fact_receipts_v1 WHERE eligibility_identity=$1",
    )
    .bind(eligibility.eligibility_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-eligibility-qualified-event.v1",
        &payload,
    )?;
    let outbox_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.qualification_owner_outbox_v1 \
         WHERE event_identity=$1 AND aggregate_identity=$2 \
           AND event_kind='QUALIFICATION_PROTECTED_QUALIFIED_COMMITTED_V1' \
           AND payload_digest=$3 AND payload_json=$4 AND committed_at_epoch_ms=$5",
    )
    .bind(identity(
        "qualification-protected-eligibility-qualified-event-v1",
        &event_digest,
    ))
    .bind(eligibility.eligibility_identity())
    .bind(event_digest)
    .bind(payload)
    .bind(committed_at)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;

    if assessment_count != 1
        || eligibility_rows.len() != 1
        || eligibility_rows[0]
            .try_get::<String, _>("eligibility_digest")
            .map_err(storage)?
            != eligibility.eligibility_digest()
        || eligibility_rows[0]
            .try_get::<String, _>("status")
            .map_err(storage)?
            != "QUALIFIED"
        || eligibility_rows[0]
            .try_get::<String, _>("candidate_identity")
            .map_err(storage)?
            != assessment.candidate_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("assessment_identity")
            .map_err(storage)?
            != eligibility.assessment_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != eligibility.holdout_reservation_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_identity")
            .map_err(storage)?
            != eligibility.holdout_closure_identity()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_digest")
            .map_err(storage)?
            != eligibility.holdout_closure_digest()
        || eligibility_rows[0]
            .try_get::<String, _>("holdout_closure_disposition")
            .map_err(storage)?
            != closure_status(eligibility.holdout_closure_disposition())
        || eligibility_rows[0]
            .try_get::<serde_json::Value, _>("eligibility_json")
            .map_err(storage)?
            != eligibility.as_json()?
        || eligibility_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
        || receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest()
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != receipt.as_json()?
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
        || outbox_count != 1
    {
        return Err(unavailable("QUALIFIED Eligibility Fact custody changed"));
    }
    Ok(())
}

async fn load_rd_selection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    result_identity: &str,
) -> Result<crate::candidate_intake::ResolvedRdSelectionEnvelopeV1, QualificationOwnerError> {
    let row = sqlx::query(
        "SELECT * FROM rd_owner_api.lock_ready_for_selection_for_qualification_v1($1,$2)",
    )
    .bind(decision_identity)
    .bind(result_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .ok_or_else(|| unavailable("R&D Candidate and Selection custody is unavailable"))?;
    let storage_value = ResolvedRdSelectionStorageV1 {
        candidate_json: row.try_get("candidate_json").map_err(storage)?,
        candidate_bytes: row.try_get("candidate_storage_bytes").map_err(storage)?,
        candidate_storage_digest: row.try_get("candidate_storage_digest").map_err(storage)?,
        selection_json: row.try_get("selection_json").map_err(storage)?,
        selection_bytes: row.try_get("selection_storage_bytes").map_err(storage)?,
        selection_storage_digest: row.try_get("selection_storage_digest").map_err(storage)?,
        selection_receipt_json: row.try_get("selection_receipt_json").map_err(storage)?,
        selection_receipt_bytes: row
            .try_get("selection_receipt_storage_bytes")
            .map_err(storage)?,
        selection_receipt_storage_digest: row
            .try_get("selection_receipt_storage_digest")
            .map_err(storage)?,
        candidate_outbox_count: row.try_get("candidate_outbox_count").map_err(storage)?,
        selection_outbox_count: row.try_get("selection_outbox_count").map_err(storage)?,
        selection_outbox_json: row.try_get("selection_outbox_json").map_err(storage)?,
        selection_outbox_digest: row.try_get("selection_outbox_digest").map_err(storage)?,
        selection_outbox_committed_at_epoch_ms: row
            .try_get("selection_outbox_committed_at_epoch_ms")
            .map_err(storage)?,
    };
    decode_resolved_handoff_v1(&storage_value)
}

async fn verify_protected_replay_request_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &ProtectedReplayRequestV1,
    receipt: &ProtectedReplayRequestReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let request_json = request.as_json()?;
    let request_bytes = serde_json::to_vec(&request_json).map_err(json_storage)?;
    let request_storage_digest = canonical_digest(
        "qualification.protected-replay-request.storage.v1",
        &request_bytes,
    )?;
    let request_rows = sqlx::query(
        "SELECT request_digest,review_request_identity,intake_receipt_identity,holdout_reservation_identity,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,request_json,canonical_request_bytes,storage_digest,committed_at_epoch_ms \
         FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1 FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let committed_at = i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?;

    if request_rows.len() != 1
        || request_rows[0]
            .try_get::<String, _>("request_digest")
            .map_err(storage)?
            != request.request_digest()
        || request_rows[0]
            .try_get::<String, _>("review_request_identity")
            .map_err(storage)?
            != request.review_request_identity()
        || request_rows[0]
            .try_get::<String, _>("intake_receipt_identity")
            .map_err(storage)?
            != request.intake_receipt_identity()
        || request_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != request.holdout_reservation_identity()
        || request_rows[0]
            .try_get::<String, _>("protected_plan_identity")
            .map_err(storage)?
            != request.protected_plan_identity()
        || request_rows[0]
            .try_get::<String, _>("protected_plan_digest")
            .map_err(storage)?
            != request.protected_plan_digest()
        || request_rows[0]
            .try_get::<String, _>("plan_cell_identity")
            .map_err(storage)?
            != request.plan_cell_identity()
        || request_rows[0]
            .try_get::<String, _>("plan_cell_digest")
            .map_err(storage)?
            != request.plan_cell_digest()
        || request_rows[0]
            .try_get::<serde_json::Value, _>("request_json")
            .map_err(storage)?
            != request_json
        || request_rows[0]
            .try_get::<Vec<u8>, _>("canonical_request_bytes")
            .map_err(storage)?
            != request_bytes
        || request_rows[0]
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != request_storage_digest
        || request_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request custody changed"));
    }

    let receipt_json = receipt.as_json()?;
    let receipt_bytes = serde_json::to_vec(&receipt_json).map_err(json_storage)?;
    let receipt_storage_digest = canonical_digest(
        "qualification.protected-replay-request-receipt.storage.v1",
        &receipt_bytes,
    )?;
    let receipt_rows = sqlx::query(
        "SELECT request_digest,receipt_identity,receipt_digest,seal_digest,receipt_json,canonical_receipt_bytes,storage_digest,committed_at_epoch_ms \
         FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1 FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("request_digest")
            .map_err(storage)?
            != receipt.request_digest()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest()
        || receipt_rows[0]
            .try_get::<String, _>("seal_digest")
            .map_err(storage)?
            != receipt.seal_digest()
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != receipt_json
        || receipt_rows[0]
            .try_get::<Vec<u8>, _>("canonical_receipt_bytes")
            .map_err(storage)?
            != receipt_bytes
        || receipt_rows[0]
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != receipt_storage_digest
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request receipt changed"));
    }

    let payload = serde_json::json!({
        "schema_version": 1,
        "request_identity": request.request_identity(),
        "request_digest": request.request_digest(),
        "receipt_identity": receipt.receipt_identity(),
        "seal_digest": receipt.seal_digest(),
    });
    let event_digest = canonical_digest(
        "qualification.protected-replay-request-frozen-event.v1",
        &payload,
    )?;
    let outbox = sqlx::query(
        "SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms FROM public.qualification_owner_outbox_v1 \
         WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1' FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if outbox.len() != 1
        || outbox[0]
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != identity(
                "qualification-protected-replay-request-frozen-event-v1",
                &event_digest,
            )
        || outbox[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != event_digest
        || outbox[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != payload
        || outbox[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request outbox changed"));
    }
    Ok(())
}

async fn verify_protected_replay_request_commit_v2(
    transaction: &mut Transaction<'_, Postgres>,
    request: &ProtectedReplayRequestV2,
    receipt: &ProtectedReplayRequestReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let request_bytes = request.to_canonical_bytes()?;
    let request_json: serde_json::Value =
        serde_json::from_slice(&request_bytes).map_err(json_storage)?;
    let request_storage_digest = canonical_digest(
        "qualification.protected-replay-request.storage.v1",
        &request_bytes,
    )?;
    let request_rows = sqlx::query(
        "SELECT request_digest,review_request_identity,intake_receipt_identity,holdout_reservation_identity,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,request_json,canonical_request_bytes,storage_digest,committed_at_epoch_ms \
         FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1 FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let committed_at = i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?;

    if request_rows.len() != 1
        || request_rows[0]
            .try_get::<String, _>("request_digest")
            .map_err(storage)?
            != request.request_digest()
        || request_rows[0]
            .try_get::<String, _>("review_request_identity")
            .map_err(storage)?
            != request.review_request_identity()
        || request_rows[0]
            .try_get::<String, _>("intake_receipt_identity")
            .map_err(storage)?
            != request.intake_receipt_identity()
        || request_rows[0]
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(storage)?
            != request.holdout_reservation_identity()
        || request_rows[0]
            .try_get::<String, _>("protected_plan_identity")
            .map_err(storage)?
            != request.protected_plan_identity()
        || request_rows[0]
            .try_get::<String, _>("protected_plan_digest")
            .map_err(storage)?
            != request.protected_plan_digest()
        || request_rows[0]
            .try_get::<String, _>("plan_cell_identity")
            .map_err(storage)?
            != request.plan_cell_identity()
        || request_rows[0]
            .try_get::<String, _>("plan_cell_digest")
            .map_err(storage)?
            != request.plan_cell_digest()
        || request_rows[0]
            .try_get::<serde_json::Value, _>("request_json")
            .map_err(storage)?
            != request_json
        || request_rows[0]
            .try_get::<Vec<u8>, _>("canonical_request_bytes")
            .map_err(storage)?
            != request_bytes
        || request_rows[0]
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != request_storage_digest
        || request_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request custody changed"));
    }

    let receipt_json = receipt.as_json()?;
    let receipt_bytes = serde_json::to_vec(&receipt_json).map_err(json_storage)?;
    let receipt_storage_digest = canonical_digest(
        "qualification.protected-replay-request-receipt.storage.v1",
        &receipt_bytes,
    )?;
    let receipt_rows = sqlx::query(
        "SELECT request_digest,receipt_identity,receipt_digest,seal_digest,receipt_json,canonical_receipt_bytes,storage_digest,committed_at_epoch_ms \
         FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1 FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("request_digest")
            .map_err(storage)?
            != receipt.request_digest()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest()
        || receipt_rows[0]
            .try_get::<String, _>("seal_digest")
            .map_err(storage)?
            != receipt.seal_digest()
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != receipt_json
        || receipt_rows[0]
            .try_get::<Vec<u8>, _>("canonical_receipt_bytes")
            .map_err(storage)?
            != receipt_bytes
        || receipt_rows[0]
            .try_get::<String, _>("storage_digest")
            .map_err(storage)?
            != receipt_storage_digest
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request receipt changed"));
    }

    let payload = serde_json::json!({
        "schema_version": 1,
        "request_identity": request.request_identity(),
        "request_digest": request.request_digest(),
        "receipt_identity": receipt.receipt_identity(),
        "seal_digest": receipt.seal_digest(),
    });
    let event_digest = canonical_digest(
        "qualification.protected-replay-request-frozen-event.v1",
        &payload,
    )?;
    let outbox = sqlx::query(
        "SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms FROM public.qualification_owner_outbox_v1 \
         WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1' FOR UPDATE",
    )
    .bind(request.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if outbox.len() != 1
        || outbox[0]
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != identity(
                "qualification-protected-replay-request-frozen-event-v1",
                &event_digest,
            )
        || outbox[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != event_digest
        || outbox[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != payload
        || outbox[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != committed_at
    {
        return Err(unavailable("Protected Replay Request outbox changed"));
    }
    Ok(())
}

async fn verify_candidate_intake_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    receipt: &CandidateIntakeReceiptV1,
) -> Result<Option<PreregisteredHoldoutTreatmentV1>, QualificationOwnerError> {
    let receipt_rows = sqlx::query("SELECT review_request_digest,candidate_identity,receipt_identity,status,receipt_json,committed_at_epoch_ms FROM public.qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1 FOR UPDATE")
        .bind(receipt.review_request_identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let expected_json = receipt.as_json()?;
    let expected_status = match receipt.status() {
        CandidateIntakeStatusV1::Admitted => "ADMITTED",
        CandidateIntakeStatusV1::NotAdmitted => "NOT_ADMITTED",
    };

    if receipt_rows.len() != 1
        || receipt_rows[0]
            .try_get::<String, _>("review_request_digest")
            .map_err(storage)?
            != receipt.review_request_digest()
        || receipt_rows[0]
            .try_get::<String, _>("candidate_identity")
            .map_err(storage)?
            != receipt.candidate_identity()
        || receipt_rows[0]
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity()
        || receipt_rows[0]
            .try_get::<String, _>("status")
            .map_err(storage)?
            != expected_status
        || receipt_rows[0]
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != expected_json
        || receipt_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?
        || decode_intake_receipt_v1(&expected_json)? != *receipt
    {
        return Err(unavailable("committed Candidate Intake receipt changed"));
    }

    let reservations = sqlx::query("SELECT reservation_identity,candidate_identity,reservation_json,committed_at_epoch_ms FROM public.qualification_holdout_reservations_v1 WHERE review_request_identity=$1 FOR UPDATE")
        .bind(receipt.review_request_identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let mut registered_treatment = None;

    match receipt.holdout_reservation_identity() {
        Some(reservation_identity) => {
            let expected_reservation = serde_json::json!({
                "schema_version": 1,
                "reservation_identity": reservation_identity,
                "review_request_identity": receipt.review_request_identity(),
                "candidate_identity": receipt.candidate_identity(),
            });

            // This is a readback of what this transaction just wrote, so the row being absent
            // and a column differing are different failures: the first says the write did not
            // land, the second says it landed as something else. One name for both left the
            // reader unable to tell which.
            let diverged = if reservations.len() != 1 {
                Some("row count")
            } else if reservations[0]
                .try_get::<String, _>("reservation_identity")
                .map_err(storage)?
                != reservation_identity
            {
                Some("reservation_identity")
            } else if reservations[0]
                .try_get::<String, _>("candidate_identity")
                .map_err(storage)?
                != receipt.candidate_identity()
            {
                Some("candidate_identity")
            } else if reservations[0]
                .try_get::<serde_json::Value, _>("reservation_json")
                .map_err(storage)?
                != expected_reservation
            {
                Some("reservation_json")
            } else if reservations[0]
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?
                != i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?
            {
                Some("committed_at_epoch_ms")
            } else {
                None
            };

            if let Some(field) = diverged {
                return Err(unavailable(format!(
                    "Candidate Intake holdout reservation readback diverged at {field}"
                )));
            }

            let registrations = sqlx::query("SELECT treatment_policy_identity,treatment_policy_digest,closure_disposition,registration_json,committed_at_epoch_ms FROM public.qualification_holdout_treatment_registrations_v1 WHERE reservation_identity=$1")
                .bind(reservation_identity)
                .fetch_all(&mut **transaction)
                .await
                .map_err(storage)?;

            if !registrations.is_empty() {
                let holdout_treatment = preregistered_holdout_treatment_v1(
                    receipt.protected_decision_policy_identity(),
                    receipt.protected_decision_policy_version(),
                )?;
                let expected_registration = holdout_treatment_registration_json_v1(
                    reservation_identity,
                    &holdout_treatment,
                );

                if registrations.len() != 1
                    || registrations[0]
                        .try_get::<String, _>("treatment_policy_identity")
                        .map_err(storage)?
                        != holdout_treatment.identity()
                    || registrations[0]
                        .try_get::<String, _>("treatment_policy_digest")
                        .map_err(storage)?
                        != holdout_treatment.digest()
                    || registrations[0]
                        .try_get::<String, _>("closure_disposition")
                        .map_err(storage)?
                        != closure_status(holdout_treatment.closure_disposition())
                    || registrations[0]
                        .try_get::<serde_json::Value, _>("registration_json")
                        .map_err(storage)?
                        != expected_registration
                    || registrations[0]
                        .try_get::<i64, _>("committed_at_epoch_ms")
                        .map_err(storage)?
                        != i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?
                {
                    return Err(unavailable(
                        "Candidate Intake holdout treatment registration changed",
                    ));
                }
                registered_treatment = Some(holdout_treatment);
            }
        }
        None if !reservations.is_empty() => {
            return Err(unavailable("NOT_ADMITTED intake acquired holdout custody"));
        }
        None => {}
    }

    let outbox_rows = sqlx::query("SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_CANDIDATE_INTAKE_COMMITTED_V1' FOR UPDATE")
        .bind(receipt.receipt_identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let event_digest = canonical_digest("qualification.candidate-intake-event.v1", &expected_json)?;

    if outbox_rows.len() != 1
        || outbox_rows[0]
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != identity("qualification-candidate-intake-event-v1", &event_digest)
        || outbox_rows[0]
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != event_digest
        || outbox_rows[0]
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != expected_json
        || outbox_rows[0]
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(json_storage)?
    {
        return Err(unavailable("Candidate Intake outbox/readback changed"));
    }
    Ok(registered_treatment)
}

fn holdout_treatment_registration_json_v1(
    reservation_identity: &str,
    treatment: &PreregisteredHoldoutTreatmentV1,
) -> serde_json::Value {
    serde_json::json!({
        "schema_version": 1,
        "reservation_identity": reservation_identity,
        "treatment_policy_identity": treatment.identity(),
        "treatment_policy_digest": treatment.digest(),
        "closure_disposition": closure_status(treatment.closure_disposition()),
    })
}

/// Direct, locked Qualification Owner reread. The locator is never evidence;
/// only a sealed positive readback can leave this function.
pub async fn admit_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    let basis = load_rd_basis_in_transaction(transaction, locator).await?;
    let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_projection_for_basis_v1($1,$2,$3,$4,$5,$6)",
    )
    .bind(&basis.basis_identity)
    .bind(&basis.basis_digest)
    .bind(&basis.request_identity)
    .bind(&basis.principal)
    .bind(serde_json::to_value(&basis.request_scope).map_err(json_storage)?)
    .bind(&principal_scope_key)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let raw_envelope = raw_envelope
        .ok_or_else(|| unavailable("Qualification locked admission envelope unavailable"))?;
    let envelope: QualificationAdmissionEnvelopeV1 = decode_exact(&raw_envelope)?;
    verify_admission_envelope_in_transaction(
        transaction,
        &basis,
        &principal_scope_key,
        envelope,
        ProjectionSelectionV1::Current,
    )
    .await
}

/// Direct, locked historical Qualification Owner reread for terminal R&D
/// custody. The complete canonical history is still verified; only freshness
/// is deliberately not treated as authority for a new write.
pub async fn admit_historical_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
    projection_identity: &str,
    projection_digest: &str,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    let basis = load_rd_basis_in_transaction(transaction, locator).await?;
    let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_projection_for_basis_v1($1,$2,$3,$4,$5,$6)",
    )
    .bind(&basis.basis_identity)
    .bind(&basis.basis_digest)
    .bind(&basis.request_identity)
    .bind(&basis.principal)
    .bind(serde_json::to_value(&basis.request_scope).map_err(json_storage)?)
    .bind(&principal_scope_key)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let raw_envelope = raw_envelope
        .ok_or_else(|| unavailable("Qualification locked admission envelope unavailable"))?;
    let envelope: QualificationAdmissionEnvelopeV1 = decode_exact(&raw_envelope)?;
    verify_admission_envelope_in_transaction(
        transaction,
        &basis,
        &principal_scope_key,
        envelope,
        ProjectionSelectionV1::Historical {
            projection_identity,
            projection_digest,
        },
    )
    .await
}

enum ProjectionSelectionV1<'a> {
    Current,
    Historical {
        projection_identity: &'a str,
        projection_digest: &'a str,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationAdmissionEnvelopeV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    request_identity: String,
    principal: String,
    request_scope: Vec<String>,
    principal_scope_key: String,
    owner_cut_epoch_ms: i64,
    heads: Vec<QualificationHeadEnvelopeRowV1>,
    projections: Vec<QualificationProjectionEnvelopeRowV1>,
    outboxes: Vec<QualificationOutboxEnvelopeRowV1>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationProjectionEnvelopeRowV1 {
    projection_identity: String,
    basis_identity: String,
    principal: String,
    request_scope_json: serde_json::Value,
    resolution_state: String,
    source_sequence: i64,
    source_cut: String,
    projection_digest: String,
    projection_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
    valid_through_epoch_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationHeadEnvelopeRowV1 {
    principal_scope_key: String,
    principal: String,
    request_scope_json: serde_json::Value,
    frontier_identity: String,
    frontier_digest: String,
    source_sequence: i64,
    source_cut: String,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationOutboxEnvelopeRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

async fn verify_admission_envelope_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis: &StoredRdBasisV1,
    principal_scope_key: &str,
    envelope: QualificationAdmissionEnvelopeV1,
    selection: ProjectionSelectionV1<'_>,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    if envelope.schema_version != 1
        || envelope.basis_identity != basis.basis_identity
        || envelope.basis_digest != basis.basis_digest
        || envelope.request_identity != basis.request_identity
        || envelope.principal != basis.principal
        || envelope.request_scope != basis.request_scope
        || envelope.principal_scope_key != principal_scope_key
    {
        return Err(unavailable(
            "Qualification admission envelope locator mismatch",
        ));
    }
    let owner_cut_epoch_ms = u64::try_from(envelope.owner_cut_epoch_ms).map_err(json_storage)?;
    let mut projections = Vec::with_capacity(envelope.projections.len());

    for row in &envelope.projections {
        projections.push(admit_projection_envelope_row_in_transaction(transaction, row).await?);
    }
    let projection_identities = projections
        .iter()
        .map(|projection| projection.projection_identity.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut outbox_aggregates = std::collections::BTreeSet::new();

    for row in &envelope.outboxes {
        let projection = projections
            .iter()
            .find(|projection| projection.projection_identity == row.aggregate_identity)
            .ok_or_else(|| unavailable("Qualification projection outbox is orphaned"))?;

        if !outbox_aggregates.insert(row.aggregate_identity.as_str()) {
            return Err(unavailable("Qualification projection outbox is ambiguous"));
        }
        verify_outbox_envelope_row(row, projection)?;
    }

    if outbox_aggregates != projection_identities {
        return Err(unavailable("Qualification projection outbox unavailable"));
    }

    if envelope.heads.len() > 1 {
        return Err(unavailable("Qualification feedback head is ambiguous"));
    }
    let current_frontier = envelope
        .heads
        .first()
        .map(|head| {
            verify_head_envelope_row(
                head,
                principal_scope_key,
                &basis.principal,
                &basis.request_scope,
                &projections,
            )
        })
        .transpose()?;

    if current_frontier.is_none() && !projections.is_empty() {
        return Err(unavailable(
            "Qualification feedback history exists without a head",
        ));
    }
    verify_projection_chain(&projections, current_frontier.as_ref())?;
    let history = VerifiedScopeHistoryV1 {
        projections,
        current_frontier,
    };
    let projection = match selection {
        ProjectionSelectionV1::Current => {
            let projection = history.projection_for_basis(&basis.basis_identity);

            if let Some(projection) = projection {
                verify_projection_freshness(projection, owner_cut_epoch_ms)?;
            }
            projection
        }
        ProjectionSelectionV1::Historical {
            projection_identity,
            projection_digest,
        } => {
            let mut matches = history.projections.iter().filter(|projection| {
                projection.basis_identity == basis.basis_identity
                    && projection.projection_identity == projection_identity
                    && projection.projection_digest == projection_digest
            });
            let projection = matches.next();

            if matches.next().is_some() {
                return Err(unavailable(
                    "Qualification historical projection is ambiguous",
                ));
            }
            projection
        }
    };
    Ok(projection.cloned())
}

async fn owner_clock_epoch_ms_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, QualificationOwnerError> {
    sqlx::query_scalar::<_, i64>(OWNER_CLOCK_EPOCH_MS_SQL)
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)
        .and_then(|value| u64::try_from(value).map_err(json_storage))
}

/// Re-label the failure to load the R&D Independence Basis that a *stored projection* records.
///
/// Every read of this Owner's scope history admits every stored projection, and each projection
/// carries the `basis_identity` it was formed against. So a projection whose basis is gone fails
/// reads that have nothing to do with it, under any principal, for as long as the row is there.
///
/// Until now that arrived as the same sentence as a caller whose own request locator did not
/// resolve, and the two call for opposite handling: one is a request to correct, the other is
/// storage residue to clear. The caller cannot tell them apart by looking, because it holds no
/// SELECT on either table. So the identity is named here, together with where it came from,
/// which is the part that sends the reader to the right side.
///
/// Only a domain refusal is re-labelled. A `Storage` error is a real SQL failure and saying
/// "stored projection" about it would be the same mistake this function exists to fix.
fn projection_basis_unavailable(
    projection_identity: &str,
    basis_identity: &str,
    cause: QualificationOwnerError,
) -> QualificationOwnerError {
    match cause {
        QualificationOwnerError::Unavailable(cause) => unavailable(format!(
            "scope history halted on a stored projection: projection {projection_identity} \
             records R&D Independence Basis {basis_identity}, which this read cannot load. That \
             identity is stored on the projection row and was not supplied by this request. \
             Underlying refusal: {cause}"
        )),
        other => other,
    }
}

fn projection_basis_unavailable_in_transaction(
    projection_identity: &str,
    basis_identity: &str,
    error: QualificationTransactionError,
) -> QualificationTransactionError {
    match error {
        QualificationTransactionError::Storage(error) => {
            QualificationTransactionError::Storage(error)
        }
        QualificationTransactionError::Domain(cause) => {
            projection_basis_unavailable(projection_identity, basis_identity, cause).into()
        }
    }
}

async fn admit_projection_row_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    row: &PgRow,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationTransactionError> {
    let projection_json: serde_json::Value = row
        .try_get("projection_json")
        .map_err(transaction_storage)?;
    let receipt_json: serde_json::Value =
        row.try_get("receipt_json").map_err(transaction_storage)?;
    let stored: StoredProjectionV1 = decode_exact(&projection_json)?;
    let projection_identity: String = row
        .try_get("projection_identity")
        .map_err(transaction_storage)?;
    let basis = load_rd_basis_by_locator_fields_preserving_sqlstate_in_transaction(
        transaction,
        &stored.basis_identity,
        &stored.basis_digest,
        &stored.principal,
        &stored.request_scope,
    )
    .await
    .map_err(|e| {
        projection_basis_unavailable_in_transaction(&projection_identity, &stored.basis_identity, e)
    })?;
    let receipt: StoredProjectionReceiptV1 = decode_exact(&receipt_json)?;
    let expected = form_projection(
        &basis,
        stored.resolution,
        stored.source_sequence,
        stored.source_cut.clone(),
        stored.source_frontier_identity.clone(),
        stored.source_frontier_digest.clone(),
        stored.projection_at_epoch_ms,
    )?;

    if expected.as_stored() != stored || expected.receipt_as_stored() != receipt {
        return Err(unavailable("Qualification projection canonical meaning mismatch").into());
    }

    let row_scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(transaction_storage)?,
    )?;
    let row_sequence: i64 = row
        .try_get("source_sequence")
        .map_err(transaction_storage)?;
    let row_committed_at: i64 = row
        .try_get("committed_at_epoch_ms")
        .map_err(transaction_storage)?;
    let row_valid_through: i64 = row
        .try_get("valid_through_epoch_ms")
        .map_err(transaction_storage)?;

    if row
        .try_get::<String, _>("projection_identity")
        .map_err(transaction_storage)?
        != expected.projection_identity
        || row
            .try_get::<String, _>("basis_identity")
            .map_err(transaction_storage)?
            != basis.basis_identity
        || row
            .try_get::<String, _>("principal")
            .map_err(transaction_storage)?
            != basis.principal
        || row_scope != basis.request_scope
        || row
            .try_get::<String, _>("resolution_state")
            .map_err(transaction_storage)?
            != resolution_name(expected.resolution)
        || u64::try_from(row_sequence).map_err(json_storage)? != expected.source_sequence
        || row
            .try_get::<String, _>("source_cut")
            .map_err(transaction_storage)?
            != expected.source_cut
        || row
            .try_get::<String, _>("projection_digest")
            .map_err(transaction_storage)?
            != expected.projection_digest
        || u64::try_from(row_committed_at).map_err(json_storage)?
            != expected.receipt.committed_at_epoch_ms
        || u64::try_from(row_valid_through).map_err(json_storage)?
            != expected.valid_through_epoch_ms
    {
        return Err(unavailable("Qualification projection row mismatch").into());
    }

    Ok(expected)
}

async fn admit_projection_envelope_row_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    row: &QualificationProjectionEnvelopeRowV1,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let stored: StoredProjectionV1 = decode_exact(&row.projection_json)?;
    let basis = load_rd_basis_by_locator_fields_in_transaction(
        transaction,
        &stored.basis_identity,
        &stored.basis_digest,
        &stored.principal,
        &stored.request_scope,
    )
    .await
    .map_err(|e| {
        projection_basis_unavailable(&row.projection_identity, &stored.basis_identity, e)
    })?;
    verify_projection_envelope_row(row, &basis)
}

fn verify_projection_envelope_row(
    row: &QualificationProjectionEnvelopeRowV1,
    basis: &StoredRdBasisV1,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let stored: StoredProjectionV1 = decode_exact(&row.projection_json)?;
    let receipt: StoredProjectionReceiptV1 = decode_exact(&row.receipt_json)?;
    let expected = form_projection(
        basis,
        stored.resolution,
        stored.source_sequence,
        stored.source_cut.clone(),
        stored.source_frontier_identity.clone(),
        stored.source_frontier_digest.clone(),
        stored.projection_at_epoch_ms,
    )?;
    let row_scope: Vec<String> = decode_exact(&row.request_scope_json)?;

    if expected.as_stored() != stored
        || expected.receipt_as_stored() != receipt
        || row.projection_identity != expected.projection_identity
        || row.basis_identity != basis.basis_identity
        || row.principal != basis.principal
        || row_scope != basis.request_scope
        || row.resolution_state != resolution_name(expected.resolution)
        || u64::try_from(row.source_sequence).map_err(json_storage)? != expected.source_sequence
        || row.source_cut != expected.source_cut
        || row.projection_digest != expected.projection_digest
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != expected.receipt.committed_at_epoch_ms
        || u64::try_from(row.valid_through_epoch_ms).map_err(json_storage)?
            != expected.valid_through_epoch_ms
    {
        return Err(unavailable(
            "Qualification admission envelope projection mismatch",
        ));
    }
    Ok(expected)
}

fn verify_head_envelope_row(
    row: &QualificationHeadEnvelopeRowV1,
    principal_scope_key: &str,
    principal: &str,
    request_scope: &[String],
    projections: &[ProtectedFeedbackFrontierReadbackV1],
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let scope: Vec<String> = decode_exact(&row.request_scope_json)?;
    let mut matching = projections
        .iter()
        .filter(|projection| projection.projection_identity == row.frontier_identity);
    let projection = matching
        .next()
        .ok_or_else(|| unavailable("Qualification feedback head projection unavailable"))?;

    // Three different things were named "feedback head mismatch" here. A second matching head is
    // an ambiguity, not a mismatch. The `projection.*` comparisons are the projection disagreeing
    // with the request, which is not the head's fault at all. Only the `row.*` comparisons are
    // the head itself. Each now says which it was, and against what.
    let diverged = if matching.next().is_some() {
        Some("more than one head matches this principal and scope")
    } else if row.principal_scope_key != principal_scope_key {
        Some("head principal_scope_key")
    } else if row.principal != principal {
        Some("head principal")
    } else if scope != request_scope {
        Some("head request scope")
    } else if projection.principal != principal {
        Some("projection principal does not match the request")
    } else if projection.request_scope != request_scope {
        Some("projection request scope does not match the request")
    } else if row.frontier_digest != projection.projection_digest {
        Some("head frontier_digest against the projection digest")
    } else if u64::try_from(row.source_sequence).map_err(json_storage)?
        != projection.source_sequence
    {
        Some("head source_sequence against the projection")
    } else if row.source_cut != projection.source_cut {
        Some("head source_cut against the projection")
    } else if u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
        != projection.receipt.committed_at_epoch_ms
    {
        Some("head committed_at_epoch_ms against the projection receipt")
    } else {
        None
    };

    if let Some(field) = diverged {
        return Err(unavailable(format!(
            "Qualification feedback head admission failed: {field}"
        )));
    }
    Ok(projection.clone())
}

fn verify_outbox_envelope_row(
    row: &QualificationOutboxEnvelopeRowV1,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;

    let diverged =
        if row.event_identity != identity("qualification-owner-event-v1", &payload_digest) {
            Some("event_identity")
        } else if row.aggregate_identity != projection.projection_identity {
            Some("aggregate_identity")
        } else if row.event_kind != PROJECTED_EVENT_KIND {
            Some("event_kind")
        } else if row.payload_digest != payload_digest {
            Some("payload_digest")
        } else if row.payload_json != projection_json {
            Some("payload_json")
        } else if u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
        {
            Some("committed_at_epoch_ms")
        } else {
            None
        };

    if let Some(field) = diverged {
        return Err(unavailable(format!(
            "Qualification projection outbox mismatch at {field}"
        )));
    }
    Ok(())
}

#[derive(Debug)]
pub(crate) struct VerifiedScopeHistoryV1 {
    projections: Vec<ProtectedFeedbackFrontierReadbackV1>,
    current_frontier: Option<ProtectedFeedbackFrontierReadbackV1>,
}

impl VerifiedScopeHistoryV1 {
    fn projection_for_basis(
        &self,
        basis_identity: &str,
    ) -> Option<&ProtectedFeedbackFrontierReadbackV1> {
        let mut cursor = self.current_frontier.as_ref();

        while let Some(projection) = cursor {
            if projection.basis_identity == basis_identity {
                return Some(projection);
            }
            cursor = projection
                .source_frontier_identity
                .as_deref()
                .and_then(|identity| {
                    self.projections
                        .iter()
                        .find(|candidate| candidate.projection_identity == identity)
                });
        }
        None
    }
}

pub(crate) async fn lock_principal_scope_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal_scope_key: &str,
) -> Result<(), QualificationOwnerError> {
    lock_principal_scope_preserving_sqlstate_in_transaction(transaction, principal_scope_key)
        .await
        .map_err(QualificationTransactionError::into_public)
}

async fn lock_principal_scope_preserving_sqlstate_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal_scope_key: &str,
) -> Result<(), QualificationTransactionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(principal_scope_key)
        .execute(&mut **transaction)
        .await
        .map_err(transaction_storage)?;
    Ok(())
}

pub(crate) async fn verify_scope_history_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal: &str,
    request_scope: &[String],
    principal_scope_key: &str,
) -> Result<VerifiedScopeHistoryV1, QualificationOwnerError> {
    verify_scope_history_preserving_sqlstate_in_transaction(
        transaction,
        principal,
        request_scope,
        principal_scope_key,
    )
    .await
    .map_err(QualificationTransactionError::into_public)
}

async fn verify_scope_history_preserving_sqlstate_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal: &str,
    request_scope: &[String],
    principal_scope_key: &str,
) -> Result<VerifiedScopeHistoryV1, QualificationTransactionError> {
    let head_rows = sqlx::query("SELECT principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1 FOR UPDATE")
        .bind(principal_scope_key)
        .fetch_all(&mut **transaction)
        .await
        .map_err(transaction_storage)?;

    if head_rows.len() > 1 {
        return Err(unavailable("Qualification feedback head is ambiguous").into());
    }

    let projection_rows = sqlx::query("SELECT projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms FROM qualification_protected_feedback_projections_v1 ORDER BY projection_identity FOR SHARE")
        .fetch_all(&mut **transaction)
        .await
        .map_err(transaction_storage)?;
    let mut all_projections = Vec::with_capacity(projection_rows.len());

    for row in &projection_rows {
        all_projections.push(admit_projection_row_in_transaction(transaction, row).await?);
    }

    let projection_identities = all_projections
        .iter()
        .map(|projection| projection.projection_identity.clone())
        .collect::<Vec<_>>();
    let outbox_rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM qualification_owner_outbox_v1 WHERE event_kind = $1 OR aggregate_identity = ANY($2) ORDER BY event_identity FOR SHARE")
        .bind(PROJECTED_EVENT_KIND)
        .bind(&projection_identities)
        .fetch_all(&mut **transaction)
        .await
        .map_err(transaction_storage)?;
    let mut outbox_aggregates = std::collections::BTreeSet::new();

    for row in &outbox_rows {
        let aggregate_identity: String = row
            .try_get("aggregate_identity")
            .map_err(transaction_storage)?;
        let projection = all_projections
            .iter()
            .find(|projection| projection.projection_identity == aggregate_identity)
            .ok_or_else(|| unavailable("Qualification projection outbox is orphaned"))?;

        if !outbox_aggregates.insert(aggregate_identity) {
            return Err(unavailable("Qualification projection outbox is ambiguous").into());
        }
        verify_outbox_row(row, projection)?;
    }

    if outbox_aggregates.len() != all_projections.len() {
        return Err(unavailable("Qualification projection outbox unavailable").into());
    }

    let projections = all_projections
        .into_iter()
        .filter(|projection| {
            projection.principal == principal && projection.request_scope == request_scope
        })
        .collect::<Vec<_>>();
    let current_frontier = match head_rows.first() {
        Some(head) => Some(verify_head_row(
            head,
            principal,
            request_scope,
            &projections,
        )?),
        None if projections.is_empty() => None,
        None => {
            return Err(unavailable("Qualification feedback history exists without a head").into());
        }
    };

    verify_projection_chain(&projections, current_frontier.as_ref())?;

    Ok(VerifiedScopeHistoryV1 {
        projections,
        current_frontier,
    })
}

fn verify_projection_chain(
    projections: &[ProtectedFeedbackFrontierReadbackV1],
    current_frontier: Option<&ProtectedFeedbackFrontierReadbackV1>,
) -> Result<(), QualificationOwnerError> {
    if let Some(frontier) = current_frontier {
        let mut visited = std::collections::BTreeSet::new();
        let mut cursor = frontier;
        loop {
            if !visited.insert(cursor.projection_identity.as_str()) {
                return Err(unavailable("Qualification projection history has a cycle"));
            }

            match cursor.resolution {
                ProtectedFeedbackResolutionV1::GenesisEmpty => {
                    if cursor.source_sequence != 0
                        || cursor.source_cut != "qualification-protected-feedback-cut-v1-0"
                        || cursor.source_frontier_identity.is_some()
                        || cursor.source_frontier_digest.is_some()
                    {
                        return Err(unavailable("Qualification genesis projection is malformed"));
                    }
                    break;
                }
                ProtectedFeedbackResolutionV1::Frontier => {
                    let predecessor_identity = cursor
                        .source_frontier_identity
                        .as_deref()
                        .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
                    let predecessor = projections
                        .iter()
                        .find(|projection| projection.projection_identity == predecessor_identity)
                        .ok_or_else(|| {
                            unavailable("Qualification frontier predecessor unavailable")
                        })?;

                    if cursor.source_frontier_digest.as_deref()
                        != Some(predecessor.projection_digest.as_str())
                        || cursor.source_sequence != predecessor.source_sequence
                        || cursor.source_cut != predecessor.source_cut
                    {
                        return Err(unavailable("Qualification frontier predecessor mismatch"));
                    }
                    cursor = predecessor;
                }
            }
        }

        if visited.len() != projections.len() {
            return Err(unavailable(
                "Qualification projection history has an orphan or duplicate branch",
            ));
        }
    }
    Ok(())
}

fn verify_projection_freshness(
    projection: &ProtectedFeedbackFrontierReadbackV1,
    owner_cut_epoch_ms: u64,
) -> Result<(), QualificationOwnerError> {
    // These two bounds fail in opposite directions and only one of them is staleness. A cut that
    // precedes `projection_at` is a read of a projection that did not exist yet, which is a
    // caller reading at the wrong cut; a cut at or after `valid_through` is the projection having
    // expired. Naming both "stale" sent the reader looking for an old projection in the first
    // case, when the projection was too new.
    if owner_cut_epoch_ms < projection.projection_at_epoch_ms {
        return Err(unavailable(format!(
            "Qualification projection is not yet in effect at this Owner cut: cut \
             {owner_cut_epoch_ms} precedes projection_at {}",
            projection.projection_at_epoch_ms
        )));
    }

    if owner_cut_epoch_ms >= projection.valid_through_epoch_ms {
        return Err(unavailable(format!(
            "Qualification projection is stale at this Owner cut: cut {owner_cut_epoch_ms} is at \
             or after valid_through {}",
            projection.valid_through_epoch_ms
        )));
    }
    Ok(())
}

pub(crate) async fn load_rd_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    let basis = load_rd_basis_by_locator_fields_in_transaction(
        transaction,
        &locator.basis_identity,
        &locator.basis_digest,
        &locator.principal,
        &locator.request_scope,
    )
    .await?;

    if locator.request_identity != basis.request_identity {
        return Err(unavailable(format!(
            "R&D Independence Basis locator mismatch on request_identity: locator={} row={}",
            locator.request_identity, basis.request_identity
        )));
    }
    Ok(basis)
}

async fn load_rd_basis_by_locator_fields_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
    basis_digest: &str,
    principal: &str,
    request_scope: &[String],
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    load_rd_basis_by_locator_fields_preserving_sqlstate_in_transaction(
        transaction,
        basis_identity,
        basis_digest,
        principal,
        request_scope,
    )
    .await
    .map_err(QualificationTransactionError::into_public)
}

async fn load_rd_basis_by_locator_fields_preserving_sqlstate_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
    basis_digest: &str,
    principal: &str,
    request_scope: &[String],
) -> Result<StoredRdBasisV1, QualificationTransactionError> {
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT rd_owner_api.lock_independence_basis_for_qualification_v1($1,$2,$3,$4)",
    )
    .bind(basis_identity)
    .bind(basis_digest)
    .bind(principal)
    .bind(serde_json::to_value(request_scope).map_err(json_storage)?)
    .fetch_one(&mut **transaction)
    .await
    .map_err(transaction_storage)?;
    // A bare NULL now means only one thing. The function is `STRICT`, so a NULL argument returns
    // without running; every refusal it decides for itself arrives as a named `refusal` instead.
    let raw_envelope = raw_envelope.ok_or_else(|| {
        unavailable("R&D Independence Basis lookup was passed a null locator field")
    })?;
    // The caller cannot read `rd_independence_bases_v1`: the boundary is a SECURITY DEFINER
    // function and `qualification_writer` holds no SELECT on the table. So whatever the function
    // does not say, nobody downstream can find out. It used to answer NULL for an unsupported
    // isolation, for an unknown basis identity, for a basis whose digest, principal or scope did
    // not match, and for a missing outbox event, and all five arrived here as the single sentence
    // "R&D Independence Basis unavailable".
    if let Some(refusal) = raw_envelope.get("refusal").and_then(|value| value.as_str()) {
        return Err(unavailable(format!(
            "R&D Independence Basis unavailable: {refusal} for basis_identity={basis_identity} \
             basis_digest={basis_digest} principal={principal}"
        ))
        .into());
    }
    let envelope: LockedRdBasisEnvelopeV1 = decode_exact(&raw_envelope)?;

    if envelope.schema_version != 1 {
        return Err(unavailable("R&D Independence Basis envelope mismatch").into());
    }
    let row = envelope.basis;
    let basis: StoredRdBasisV1 = decode_exact(&row.basis_json)?;
    let receipt: StoredRdBasisReceiptV1 = decode_exact(&row.receipt_json)?;
    verify_rd_basis(&basis, &receipt)?;
    let row_scope: Vec<String> = decode_exact(&row.request_scope_json)?;
    if row.basis_identity != basis.basis_identity
        || row.request_identity != basis.request_identity
        || row.principal != basis.principal
        || row_scope != basis.request_scope
        || row.lineage_digest != basis.lineage_digest
        || row.basis_digest != basis.basis_digest
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != receipt.committed_at_epoch_ms
    {
        return Err(unavailable("R&D Independence Basis row mismatch").into());
    }
    verify_rd_basis_outbox(&envelope.outbox, &basis, &receipt)?;

    // A four-way disjunction reported as one sentence: the caller learned that one of four
    // fields disagreed, not which, and had to bisect by hand to find out.
    let disagreed = if basis_identity != basis.basis_identity {
        Some("basis_identity")
    } else if basis_digest != basis.basis_digest {
        Some("basis_digest")
    } else if principal != basis.principal {
        Some("principal")
    } else if request_scope != basis.request_scope {
        Some("request_scope")
    } else {
        None
    };

    if let Some(field) = disagreed {
        return Err(unavailable(format!(
            "R&D Independence Basis locator mismatch on {field}"
        ))
        .into());
    }
    Ok(basis)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisEnvelopeV1 {
    schema_version: u32,
    basis: LockedRdBasisRowV1,
    outbox: LockedRdBasisOutboxRowV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisRowV1 {
    basis_identity: String,
    request_identity: String,
    principal: String,
    request_scope_json: serde_json::Value,
    lineage_digest: String,
    basis_digest: String,
    basis_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisOutboxRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RdBasisOutboxPayloadV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    receipt_identity: String,
    principal: String,
    request_scope: Vec<String>,
    lineage_digest: String,
}

fn verify_rd_basis_outbox(
    row: &LockedRdBasisOutboxRowV1,
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let payload: RdBasisOutboxPayloadV1 = decode_exact(&row.payload_json)?;
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;

    // Two groups under one name. The `payload` checks are the event body disagreeing with the
    // basis and receipt it claims to describe; the `row` checks are the outbox row's own columns.
    // A reader who only knows "outbox mismatch" cannot tell whether to look at what was published
    // or at where it was published.
    let diverged = if payload.schema_version != 1 {
        Some("payload schema_version")
    } else if payload.basis_identity != basis.basis_identity {
        Some("payload basis_identity")
    } else if payload.basis_digest != basis.basis_digest {
        Some("payload basis_digest")
    } else if payload.receipt_identity != receipt.receipt_identity {
        Some("payload receipt_identity")
    } else if payload.principal != basis.principal {
        Some("payload principal")
    } else if payload.request_scope != basis.request_scope {
        Some("payload request_scope")
    } else if payload.lineage_digest != basis.lineage_digest {
        Some("payload lineage_digest")
    } else if row.event_identity != identity("rd-owner-event-v1", &payload_digest) {
        Some("row event_identity")
    } else if row.aggregate_identity != basis.basis_identity {
        Some("row aggregate_identity")
    } else if row.event_kind != "INDEPENDENCE_BASIS_PRECOMMITTED_V1" {
        Some("row event_kind")
    } else if row.payload_digest != payload_digest {
        Some("row payload_digest")
    } else if u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
        != receipt.committed_at_epoch_ms
    {
        Some("row committed_at_epoch_ms")
    } else {
        None
    };

    if let Some(field) = diverged {
        return Err(unavailable(format!(
            "R&D Independence Basis outbox mismatch at {field}"
        )));
    }
    Ok(())
}

async fn persist_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
    principal_scope_key: &str,
    is_genesis: bool,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let receipt_json =
        serde_json::to_value(projection.receipt_as_stored()).map_err(json_storage)?;
    sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(&projection.projection_identity)
        .bind(&projection.basis_identity)
        .bind(&projection.principal)
        .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
        .bind(resolution_name(projection.resolution))
        .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
        .bind(&projection.source_cut)
        .bind(&projection.projection_digest)
        .bind(&projection_json)
        .bind(receipt_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .bind(i64::try_from(projection.valid_through_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if is_genesis {
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key, principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(principal_scope_key)
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    } else {
        let predecessor_identity = projection
            .source_frontier_identity
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
        let predecessor_digest = projection
            .source_frontier_digest
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor digest missing"))?;
        let updated = sqlx::query("UPDATE qualification_protected_feedback_heads_v1 SET principal = $1, request_scope_json = $2, frontier_identity = $3, frontier_digest = $4, source_sequence = $5, source_cut = $6, committed_at_epoch_ms = $7 WHERE principal_scope_key = $8 AND frontier_identity = $9 AND frontier_digest = $10")
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .bind(principal_scope_key)
            .bind(predecessor_identity)
            .bind(predecessor_digest)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(unavailable("Qualification feedback head changed"));
        }
    }

    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let event_identity = identity("qualification-owner-event-v1", &payload_digest);
    sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(&projection.projection_identity)
        .bind(PROJECTED_EVENT_KIND)
        .bind(payload_digest)
        .bind(projection_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn verify_head_row(
    row: &PgRow,
    principal: &str,
    request_scope: &[String],
    projections: &[ProtectedFeedbackFrontierReadbackV1],
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let frontier_identity: String = row.try_get("frontier_identity").map_err(storage)?;
    let mut matching = projections
        .iter()
        .filter(|projection| projection.projection_identity == frontier_identity);
    let projection = matching
        .next()
        .ok_or_else(|| unavailable("Qualification feedback head projection unavailable"))?;

    if matching.next().is_some() {
        return Err(unavailable(
            "Qualification feedback head projection is ambiguous",
        ));
    }
    let sequence: i64 = row.try_get("source_sequence").map_err(storage)?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    let diverged = if row.try_get::<String, _>("principal").map_err(storage)? != principal {
        Some("head principal")
    } else if scope != request_scope {
        Some("head request scope")
    } else if projection.principal != principal {
        Some("projection principal does not match the request")
    } else if projection.request_scope != request_scope {
        Some("projection request scope does not match the request")
    } else if row
        .try_get::<String, _>("frontier_digest")
        .map_err(storage)?
        != projection.projection_digest
    {
        Some("head frontier_digest against the projection digest")
    } else if u64::try_from(sequence).map_err(json_storage)? != projection.source_sequence {
        Some("head source_sequence against the projection")
    } else if row.try_get::<String, _>("source_cut").map_err(storage)? != projection.source_cut {
        Some("head source_cut against the projection")
    } else if u64::try_from(committed_at).map_err(json_storage)?
        != projection.receipt.committed_at_epoch_ms
    {
        Some("head committed_at_epoch_ms against the projection receipt")
    } else {
        None
    };

    if let Some(field) = diverged {
        return Err(unavailable(format!(
            "Qualification feedback head admission failed: {field}"
        )));
    }
    Ok(projection.clone())
}

fn verify_outbox_row(
    row: &PgRow,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let diverged = if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != identity("qualification-owner-event-v1", &payload_digest)
    {
        Some("event_identity")
    } else if row
        .try_get::<String, _>("aggregate_identity")
        .map_err(storage)?
        != projection.projection_identity
    {
        Some("aggregate_identity")
    } else if row.try_get::<String, _>("event_kind").map_err(storage)? != PROJECTED_EVENT_KIND {
        Some("event_kind")
    } else if row
        .try_get::<String, _>("payload_digest")
        .map_err(storage)?
        != payload_digest
    {
        Some("payload_digest")
    } else if row
        .try_get::<serde_json::Value, _>("payload_json")
        .map_err(storage)?
        != projection_json
    {
        Some("payload_json")
    } else if u64::try_from(committed_at).map_err(json_storage)?
        != projection.receipt.committed_at_epoch_ms
    {
        Some("committed_at_epoch_ms")
    } else {
        None
    };

    if let Some(field) = diverged {
        return Err(unavailable(format!(
            "Qualification projection outbox mismatch at {field}"
        )));
    }
    Ok(())
}

fn form_projection(
    basis: &StoredRdBasisV1,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    form_projection_for_basis(
        &basis.principal,
        &basis.request_scope,
        &basis.basis_identity,
        &basis.basis_digest,
        resolution,
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        now_epoch_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_projection_for_basis(
    principal: &str,
    request_scope: &[String],
    basis_identity: &str,
    basis_digest: &str,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let meaning = ProjectionMeaningV1 {
        schema_version: 1,
        resolution,
        principal,
        request_scope,
        basis_identity,
        basis_digest,
        source_sequence,
        source_cut: &source_cut,
        source_frontier_identity: source_frontier_identity.as_deref(),
        source_frontier_digest: source_frontier_digest.as_deref(),
        clock_epoch: CLOCK_EPOCH_V1,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
    };
    let projection_digest =
        canonical_digest("qualification.protected-feedback-frontier.v1", &meaning)?;
    let projection_identity = identity(
        "qualification-protected-feedback-frontier-v1",
        &projection_digest,
    );
    let receipt_meaning = ProjectionReceiptMeaningV1 {
        schema_version: 1,
        projection_identity: &projection_identity,
        projection_digest: &projection_digest,
        committed_at_epoch_ms: now_epoch_ms,
    };
    let receipt_digest = canonical_digest(
        "qualification.protected-feedback-frontier-receipt.v1",
        &receipt_meaning,
    )?;
    Ok(ProtectedFeedbackFrontierReadbackV1 {
        schema_version: 1,
        projection_identity: projection_identity.clone(),
        projection_digest: projection_digest.clone(),
        resolution,
        principal: principal.to_string(),
        request_scope: request_scope.to_vec(),
        basis_identity: basis_identity.to_string(),
        basis_digest: basis_digest.to_string(),
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        clock_epoch: CLOCK_EPOCH_V1.to_string(),
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
        receipt: ProtectedFeedbackFrontierReceiptV1 {
            schema_version: 1,
            receipt_identity: identity(
                "qualification-protected-feedback-frontier-receipt-v1",
                &receipt_digest,
            ),
            projection_identity,
            projection_digest,
            committed_at_epoch_ms: now_epoch_ms,
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisV1 {
    pub(crate) schema_version: u32,
    pub(crate) basis_identity: String,
    pub(crate) request_identity: String,
    pub(crate) principal: String,
    pub(crate) request_scope: Vec<String>,
    pub(crate) rationale_digest: String,
    pub(crate) independence_disposition: StoredIndependenceDispositionV1,
    pub(crate) lineage_resolution: StoredLineageResolutionV1,
    pub(crate) semantic_predecessor_frontier: Vec<String>,
    pub(crate) lineage_digest: String,
    pub(crate) basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredIndependenceDispositionV1 {
    Independent,
    Related,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredLineageResolutionV1 {
    GenesisEmpty,
    CompleteFrontier,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisReceiptV1 {
    pub(crate) schema_version: u32,
    pub(crate) receipt_identity: String,
    pub(crate) basis_identity: String,
    pub(crate) basis_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
}

fn verify_rd_basis(
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let meaning = RdBasisMeaningV1 {
        schema_version: basis.schema_version,
        request_identity: &basis.request_identity,
        principal: &basis.principal,
        request_scope: &basis.request_scope,
        rationale_digest: &basis.rationale_digest,
        independence_disposition: &basis.independence_disposition,
        lineage_resolution: &basis.lineage_resolution,
        semantic_predecessor_frontier: &basis.semantic_predecessor_frontier,
        lineage_digest: &basis.lineage_digest,
    };
    let digest = canonical_digest("rd.independence-basis.v1", &meaning)?;
    let receipt_meaning = RdBasisReceiptMeaningV1 {
        schema_version: 1,
        basis_identity: &basis.basis_identity,
        basis_digest: &basis.basis_digest,
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
    };
    let receipt_digest = canonical_digest("rd.independence-basis-receipt.v1", &receipt_meaning)?;
    if basis.schema_version != 1
        || basis.basis_digest != digest
        || basis.basis_identity != identity("rd-independence-basis-v1", &digest)
        || receipt.schema_version != 1
        || receipt.basis_identity != basis.basis_identity
        || receipt.basis_digest != basis.basis_digest
        || receipt.receipt_identity != identity("rd-independence-basis-receipt-v1", &receipt_digest)
        || matches!(
            basis.lineage_resolution,
            StoredLineageResolutionV1::GenesisEmpty
        ) != basis.semantic_predecessor_frontier.is_empty()
        || matches!(
            basis.independence_disposition,
            StoredIndependenceDispositionV1::Independent
        ) != basis.semantic_predecessor_frontier.is_empty()
    {
        return Err(unavailable("R&D Independence Basis canonical mismatch"));
    }
    Ok(())
}

#[derive(Serialize)]
struct RdBasisMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    rationale_digest: &'a str,
    independence_disposition: &'a StoredIndependenceDispositionV1,
    lineage_resolution: &'a StoredLineageResolutionV1,
    semantic_predecessor_frontier: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Serialize)]
struct RdBasisReceiptMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionMeaningV1<'a> {
    schema_version: u32,
    resolution: ProtectedFeedbackResolutionV1,
    principal: &'a str,
    request_scope: &'a [String],
    basis_identity: &'a str,
    basis_digest: &'a str,
    source_sequence: u64,
    source_cut: &'a str,
    source_frontier_identity: Option<&'a str>,
    source_frontier_digest: Option<&'a str>,
    clock_epoch: &'a str,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionReceiptMeaningV1<'a> {
    schema_version: u32,
    projection_identity: &'a str,
    projection_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionV1 {
    schema_version: u32,
    projection_identity: String,
    projection_digest: String,
    resolution: ProtectedFeedbackResolutionV1,
    principal: String,
    request_scope: Vec<String>,
    basis_identity: String,
    basis_digest: String,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    clock_epoch: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    projection_identity: String,
    projection_digest: String,
    committed_at_epoch_ms: u64,
}

impl ProtectedFeedbackFrontierReadbackV1 {
    pub(crate) fn as_stored(&self) -> StoredProjectionV1 {
        StoredProjectionV1 {
            schema_version: self.schema_version,
            projection_identity: self.projection_identity.clone(),
            projection_digest: self.projection_digest.clone(),
            resolution: self.resolution,
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
            basis_identity: self.basis_identity.clone(),
            basis_digest: self.basis_digest.clone(),
            source_sequence: self.source_sequence,
            source_cut: self.source_cut.clone(),
            source_frontier_identity: self.source_frontier_identity.clone(),
            source_frontier_digest: self.source_frontier_digest.clone(),
            clock_epoch: self.clock_epoch.clone(),
            projection_at_epoch_ms: self.projection_at_epoch_ms,
            valid_through_epoch_ms: self.valid_through_epoch_ms,
        }
    }

    pub(crate) fn receipt_as_stored(&self) -> StoredProjectionReceiptV1 {
        StoredProjectionReceiptV1 {
            schema_version: self.receipt.schema_version,
            receipt_identity: self.receipt.receipt_identity.clone(),
            projection_identity: self.receipt.projection_identity.clone(),
            projection_digest: self.receipt.projection_digest.clone(),
            committed_at_epoch_ms: self.receipt.committed_at_epoch_ms,
        }
    }
}

pub(crate) fn resolution_name(value: ProtectedFeedbackResolutionV1) -> &'static str {
    match value {
        ProtectedFeedbackResolutionV1::GenesisEmpty => "GENESIS_EMPTY",
        ProtectedFeedbackResolutionV1::Frontier => "FRONTIER",
    }
}

pub(crate) fn principal_scope_key(
    principal: &str,
    request_scope: &[String],
) -> Result<String, QualificationOwnerError> {
    canonical_digest(
        "qualification.principal-request-scope.v1",
        &(principal, request_scope),
    )
}

pub(crate) fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, QualificationOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub(crate) fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

pub(crate) fn decode_exact<T>(value: &serde_json::Value) -> Result<T, QualificationOwnerError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(unavailable("stored JSON is not canonical for its schema"));
    }
    Ok(decoded)
}

#[allow(clippy::needless_pass_by_value)] // exact `map_err` adapter keeps every SQL boundary uniform
fn storage(error: sqlx::Error) -> QualificationOwnerError {
    unavailable(error.to_string())
}

#[derive(Debug)]
enum NegativeClosureAttemptError {
    Public(QualificationOwnerError),
    RetryableContention,
}

impl NegativeClosureAttemptError {
    fn into_public(self) -> QualificationOwnerError {
        match self {
            Self::Public(error) => error,
            Self::RetryableContention => unavailable("protected attempt closure contention"),
        }
    }
}

impl From<QualificationOwnerError> for NegativeClosureAttemptError {
    fn from(error: QualificationOwnerError) -> Self {
        Self::Public(error)
    }
}

fn negative_closure_storage(error: sqlx::Error) -> NegativeClosureAttemptError {
    negative_closure_sql_error(error, &[])
}

fn negative_closure_sql_error(
    error: sqlx::Error,
    retryable_unique_tables: &[&str],
) -> NegativeClosureAttemptError {
    let retryable = error.as_database_error().is_some_and(|database_error| {
        negative_closure_sqlstate_is_retryable(
            database_error.code().as_deref(),
            database_error.table(),
            retryable_unique_tables,
        )
    });

    if retryable {
        NegativeClosureAttemptError::RetryableContention
    } else {
        NegativeClosureAttemptError::Public(storage(error))
    }
}

fn negative_closure_sqlstate_is_retryable(
    sqlstate: Option<&str>,
    table: Option<&str>,
    retryable_unique_tables: &[&str],
) -> bool {
    matches!(sqlstate, Some("40001" | "40P01"))
        || sqlstate == Some("23505")
            && table.is_some_and(|table| retryable_unique_tables.contains(&table))
}

fn disposition_status(status: ProtectedAttemptDispositionStatusV1) -> &'static str {
    match status {
        ProtectedAttemptDispositionStatusV1::ReplayRejected => "REPLAY_REJECTED",
        ProtectedAttemptDispositionStatusV1::ReplayInvalid => "REPLAY_INVALID",
        ProtectedAttemptDispositionStatusV1::DiagnosticInvalid => "DIAGNOSTIC_INVALID",
        ProtectedAttemptDispositionStatusV1::DiagnosticUnresolved => "DIAGNOSTIC_UNRESOLVED",
        ProtectedAttemptDispositionStatusV1::AssessmentInvalid => "ASSESSMENT_INVALID",
    }
}

fn closure_status(status: HoldoutClosureDispositionV1) -> &'static str {
    match status {
        HoldoutClosureDispositionV1::Consumed => "CONSUMED",
    }
}

async fn verify_negative_protected_attempt_commit_v1(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ProtectedAttemptDispositionCommitV1,
) -> Result<(), NegativeClosureAttemptError> {
    let disposition = commit.disposition();
    let receipt = commit.receipt();
    let disposition_json = disposition.as_json()?;
    let receipt_json = receipt.as_json()?;
    let row = sqlx::query("SELECT disposition_digest,status,request_identity,result_identity,attempt_identity,holdout_reservation_identity,disposition_json,committed_at_epoch_ms FROM public.qualification_protected_attempt_dispositions_v1 WHERE disposition_identity=$1")
        .bind(disposition.disposition_identity()).fetch_one(&mut **transaction).await.map_err(negative_closure_storage)?;

    if row
        .try_get::<String, _>("disposition_digest")
        .map_err(negative_closure_storage)?
        != disposition.disposition_digest()
        || row
            .try_get::<String, _>("status")
            .map_err(negative_closure_storage)?
            != disposition_status(disposition.status())
        || row
            .try_get::<String, _>("request_identity")
            .map_err(negative_closure_storage)?
            != disposition.request_identity()
        || row
            .try_get::<String, _>("result_identity")
            .map_err(negative_closure_storage)?
            != disposition.result_identity()
        || row
            .try_get::<String, _>("attempt_identity")
            .map_err(negative_closure_storage)?
            != disposition.attempt_identity()
        || row
            .try_get::<String, _>("holdout_reservation_identity")
            .map_err(negative_closure_storage)?
            != disposition.holdout_reservation_identity()
        || row
            .try_get::<serde_json::Value, _>("disposition_json")
            .map_err(negative_closure_storage)?
            != disposition_json
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(negative_closure_storage)?
            != i64::try_from(disposition.committed_at_epoch_ms()).map_err(json_storage)?
    {
        return Err(unavailable("Protected Attempt Disposition readback changed").into());
    }
    let closure: (String, String, String, String, serde_json::Value, i64) = sqlx::query_as("SELECT closure_digest,reservation_identity,disposition_identity,closure_disposition,closure_json,committed_at_epoch_ms FROM public.qualification_holdout_closures_v1 WHERE closure_identity=$1")
        .bind(disposition.holdout_closure_identity()).fetch_one(&mut **transaction).await.map_err(negative_closure_storage)?;
    let expected_closure_json = serde_json::json!({"schema_version":1,"closure_identity":disposition.holdout_closure_identity(),"closure_digest":disposition.holdout_closure_digest(),"reservation_identity":disposition.holdout_reservation_identity(),"disposition_identity":disposition.disposition_identity(),"closure_disposition":closure_status(disposition.closure_disposition())});

    if closure
        != (
            disposition.holdout_closure_digest().to_string(),
            disposition.holdout_reservation_identity().to_string(),
            disposition.disposition_identity().to_string(),
            closure_status(disposition.closure_disposition()).to_string(),
            expected_closure_json,
            i64::try_from(disposition.committed_at_epoch_ms()).map_err(json_storage)?,
        )
    {
        return Err(unavailable("holdout closure readback changed").into());
    }
    let receipt_row: (String, String, serde_json::Value, i64) = sqlx::query_as("SELECT receipt_identity,receipt_digest,receipt_json,committed_at_epoch_ms FROM public.qualification_protected_attempt_disposition_receipts_v1 WHERE disposition_identity=$1")
        .bind(disposition.disposition_identity()).fetch_one(&mut **transaction).await.map_err(negative_closure_storage)?;

    if receipt_row
        != (
            receipt.receipt_identity().to_string(),
            receipt.receipt_digest().to_string(),
            receipt_json,
            i64::try_from(disposition.committed_at_epoch_ms()).map_err(json_storage)?,
        )
    {
        return Err(unavailable("Protected Attempt Disposition receipt readback changed").into());
    }
    let payload = serde_json::to_value(commit).map_err(json_storage)?;
    let event_digest = canonical_digest(
        "qualification.protected-attempt-disposition-event.v1",
        &payload,
    )?;
    let outbox: (String, String, serde_json::Value, i64) = sqlx::query_as("SELECT event_identity,payload_digest,payload_json,committed_at_epoch_ms FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1' FOR UPDATE")
        .bind(disposition.disposition_identity()).fetch_one(&mut **transaction).await.map_err(negative_closure_storage)?;

    if outbox
        != (
            identity(
                "qualification-protected-attempt-disposition-event-v1",
                &event_digest,
            ),
            event_digest,
            payload,
            i64::try_from(disposition.committed_at_epoch_ms()).map_err(json_storage)?,
        )
    {
        return Err(unavailable("Protected Attempt Disposition outbox readback changed").into());
    }
    Ok(())
}

fn json_storage(error: impl Display) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn unavailable(error: impl Into<String>) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(error.into())
}

#[cfg(test)]
mod postgres_tests {
    use rstest::rstest;

    use super::*;

    /// The two freshness bounds fail in opposite directions, and one name for both pointed the
    /// reader the wrong way in half the cases.
    ///
    /// A cut before `projection_at` is a read of a projection that did not exist yet: the caller
    /// is reading at the wrong cut. A cut at or after `valid_through` is expiry. Calling the
    /// first "stale" sent the reader looking for an old projection when the projection was too
    /// new. The accept case is asserted too, because without it both refusals would be satisfied
    /// by a function that had started refusing everything.
    ///
    /// This is a pure function, so the proof needs no database and no ordered chain entry.
    #[rstest]
    fn projection_freshness_names_which_bound_it_failed() {
        fn projection_between(at: u64, valid_through: u64) -> ProtectedFeedbackFrontierReadbackV1 {
            ProtectedFeedbackFrontierReadbackV1 {
                schema_version: 1,
                projection_identity: "qualification-protected-feedback-frontier-v1-probe".into(),
                projection_digest: "sha256:probe".into(),
                resolution: ProtectedFeedbackResolutionV1::GenesisEmpty,
                principal: "rd-operator-local-v1".into(),
                request_scope: vec!["research:submit".into()],
                basis_identity: "rd-independence-basis-v1-probe".into(),
                basis_digest: "sha256:probe-basis".into(),
                source_sequence: 1,
                source_cut: "cut-probe".into(),
                source_frontier_identity: None,
                source_frontier_digest: None,
                clock_epoch: CLOCK_EPOCH_V1.to_string(),
                projection_at_epoch_ms: at,
                valid_through_epoch_ms: valid_through,
                receipt: ProtectedFeedbackFrontierReceiptV1 {
                    schema_version: 1,
                    receipt_identity: "qualification-protected-feedback-frontier-receipt-v1-probe"
                        .into(),
                    projection_identity: "qualification-protected-feedback-frontier-v1-probe"
                        .into(),
                    projection_digest: "sha256:probe".into(),
                    committed_at_epoch_ms: at,
                },
            }
        }

        let projection = projection_between(100, 200);

        // Accept-state control: a cut inside the window is admitted.
        verify_projection_freshness(&projection, 150).expect("a cut inside the window is fresh");

        let too_early = verify_projection_freshness(&projection, 50)
            .expect_err("a cut before projection_at is refused")
            .to_string();
        let expired = verify_projection_freshness(&projection, 200)
            .expect_err("a cut at valid_through is refused")
            .to_string();

        assert!(
            too_early.contains("not yet in effect"),
            "a cut before projection_at is not staleness: {too_early}"
        );
        assert!(
            !too_early.contains("is stale"),
            "the early bound must not borrow the staleness name: {too_early}"
        );
        assert!(
            expired.contains("is stale"),
            "a cut at or after valid_through is staleness: {expired}"
        );
        assert_ne!(
            too_early, expired,
            "the two bounds are distinguishable by their message alone"
        );
    }

    #[rstest]
    fn negative_closure_retry_classification_is_structurally_bounded() {
        assert!(negative_closure_sqlstate_is_retryable(
            Some("40001"),
            None,
            &[]
        ));
        assert!(negative_closure_sqlstate_is_retryable(
            Some("40P01"),
            None,
            &[]
        ));
        assert!(negative_closure_sqlstate_is_retryable(
            Some("23505"),
            Some("qualification_protected_attempt_dispositions_v1"),
            &["qualification_protected_attempt_dispositions_v1"]
        ));
        assert!(!negative_closure_sqlstate_is_retryable(
            Some("23505"),
            Some("qualification_candidate_intake_receipts_v1"),
            &["qualification_protected_attempt_dispositions_v1"]
        ));
        assert!(!negative_closure_sqlstate_is_retryable(
            Some("23505"),
            Some("qualification_protected_attempt_dispositions_v1"),
            &[]
        ));
        assert!(!negative_closure_sqlstate_is_retryable(
            Some("23503"),
            Some("qualification_protected_attempt_dispositions_v1"),
            &["qualification_protected_attempt_dispositions_v1"]
        ));
    }

    #[rstest]
    fn public_terminal_frontier_helper_chain_preserves_sqlstate() {
        let source = include_str!("postgres.rs");
        let public_terminal_persist = source
            .split_once("async fn persist_public_status_transition_preserving_sqlstate_v1(")
            .expect("preserving public terminal persistence")
            .1
            .split_once("async fn verify_public_status_history_in_transaction(")
            .expect("public terminal persistence boundary")
            .0;
        assert_eq!(
            public_terminal_persist
                .matches("resolve_candidate_feedback_frontier_preserving_sqlstate_v1(")
                .count(),
            1
        );
        assert!(!public_terminal_persist.contains("resolve_candidate_feedback_frontier_v1("));

        let frontier = source
            .split_once("async fn resolve_candidate_feedback_frontier_preserving_sqlstate_v1(")
            .expect("preserving frontier resolver")
            .1
            .split_once("impl LockedProtectedAttemptResultV1")
            .expect("frontier resolver boundary")
            .0;
        assert_eq!(
            frontier.matches(".map_err(transaction_storage)?").count(),
            1
        );
        assert!(!frontier.contains(".map_err(storage)?"));
        assert!(frontier.contains("lock_principal_scope_preserving_sqlstate_in_transaction"));
        assert!(frontier.contains("verify_scope_history_preserving_sqlstate_in_transaction"));

        let scope_lock = source
            .split_once("async fn lock_principal_scope_preserving_sqlstate_in_transaction(")
            .expect("preserving principal lock")
            .1
            .split_once("pub(crate) async fn verify_scope_history_in_transaction(")
            .expect("principal lock boundary")
            .0;
        assert_eq!(
            scope_lock.matches(".map_err(transaction_storage)?").count(),
            1
        );
        assert!(!scope_lock.contains(".map_err(storage)?"));

        let scope_history = source
            .split_once("async fn verify_scope_history_preserving_sqlstate_in_transaction(")
            .expect("preserving scope history verifier")
            .1
            .split_once("fn verify_projection_chain(")
            .expect("scope history verifier boundary")
            .0;
        assert_eq!(
            scope_history
                .matches(".map_err(transaction_storage)?")
                .count(),
            4
        );
        assert!(scope_history.contains("admit_projection_row_in_transaction"));
        assert!(!scope_history.contains(".map_err(storage)?"));

        let projection_admission = source
            .split_once("async fn admit_projection_row_in_transaction(")
            .expect("preserving projection admission")
            .1
            .split_once("async fn admit_projection_envelope_row_in_transaction(")
            .expect("projection admission boundary")
            .0;
        assert!(
            projection_admission
                .contains("load_rd_basis_by_locator_fields_preserving_sqlstate_in_transaction")
        );
        assert!(!projection_admission.contains(".map_err(storage)?"));

        let basis = source
            .split_once(
                "async fn load_rd_basis_by_locator_fields_preserving_sqlstate_in_transaction(",
            )
            .expect("preserving R&D basis admission")
            .1
            .split_once("#[derive(Debug, Deserialize, Serialize)]")
            .expect("R&D basis admission boundary")
            .0;
        assert!(basis.contains(".map_err(transaction_storage)?"));
        assert!(!basis.contains(".map_err(storage)?"));
    }

    #[rstest]
    fn prior_attempt_source_read_preserves_append_only_writer_acl() {
        let source = include_str!("postgres.rs");
        let verifier = source
            .split_once("async fn verify_existing_attempt_public_terminal_source_v1(")
            .expect("prior attempt source verifier")
            .1
            .split_once("impl PostgresQualificationOwnerV1")
            .expect("verifier boundary")
            .0;
        assert!(verifier.contains("FROM public.qualification_protected_attempt_dispositions_v1"));
        assert!(verifier.contains("WHERE disposition_identity=$1"));
        assert!(!verifier.contains("FOR SHARE"));
        assert!(!verifier.contains("FOR UPDATE"));

        let migration_admission = source
            .split_once("    async fn migrate(&self) -> Result<(), QualificationOwnerError> {")
            .expect("Qualification writer admission")
            .1
            .split_once("    /// Resolve one sealed R&D basis")
            .expect("admission boundary")
            .0;
        let select_insert_prefix = migration_admission
            .split_once("CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT']) privilege_name)")
            .expect("append-only allowlist")
            .0;
        let select_insert_clause = select_insert_prefix
            .rsplit_once("AND (SELECT pg_catalog.bool_and")
            .expect("append-only allowlist clause")
            .1;
        assert!(
            select_insert_clause
                .contains("'public.qualification_protected_attempt_dispositions_v1'")
        );

        let mutation_deny_prefix = migration_admission
            .split_once(
                "CROSS JOIN pg_catalog.unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege_name)",
            )
            .expect("append-only denylist")
            .0;
        let mutation_deny_clause = mutation_deny_prefix
            .rsplit_once("AND NOT (SELECT pg_catalog.bool_or")
            .expect("append-only denylist clause")
            .1;
        assert!(
            mutation_deny_clause
                .contains("'public.qualification_protected_attempt_dispositions_v1'")
        );
    }

    /// An unqualified `clock_timestamp()` resolves through `search_path`, so anyone who could place
    /// a function ahead of `pg_catalog` would choose the write edge and the response cut, and with
    /// them whether the freshness rollback ever fires. Comparing the two counts fails on a second,
    /// unqualified call as much as on an edit to this one; pinning the qualified count at one fails
    /// if the read is dropped. One constant serves both readers, so this covers recovery as well,
    /// which a test inside the `owner-recovery` feature could not - nothing in CI enables it.
    #[rstest]
    fn the_owner_clock_is_read_through_its_schema_and_not_through_search_path() {
        assert_eq!(
            OWNER_CLOCK_EPOCH_MS_SQL.matches("clock_timestamp(").count(),
            OWNER_CLOCK_EPOCH_MS_SQL
                .matches("pg_catalog.clock_timestamp(")
                .count(),
        );
        assert_eq!(
            OWNER_CLOCK_EPOCH_MS_SQL
                .matches("pg_catalog.clock_timestamp(")
                .count(),
            1,
        );
    }

    #[rstest]
    fn forged_raw_envelope_cannot_construct_a_positive_readback() {
        let basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: "basis-1".into(),
            request_identity: "request-1".into(),
            principal: "principal-1".into(),
            request_scope: vec!["research:submit".into()],
            rationale_digest: "sha256:rationale".into(),
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest: "sha256:lineage".into(),
            basis_digest: "sha256:basis".into(),
        };
        let projection = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::GenesisEmpty,
            0,
            "qualification-protected-feedback-cut-v1-0".into(),
            None,
            None,
            100,
        )
        .unwrap();
        assert!(projection.is_current_at(projection.valid_through_epoch_ms() - 1));
        assert!(!projection.is_current_at(projection.valid_through_epoch_ms()));
        let mut row = QualificationProjectionEnvelopeRowV1 {
            projection_identity: projection.projection_identity().into(),
            basis_identity: projection.basis_identity().into(),
            principal: projection.principal().into(),
            request_scope_json: serde_json::to_value(projection.request_scope()).unwrap(),
            resolution_state: resolution_name(projection.resolution()).into(),
            source_sequence: i64::try_from(projection.source_sequence()).unwrap(),
            source_cut: projection.source_cut().into(),
            projection_digest: projection.projection_digest().into(),
            projection_json: serde_json::to_value(projection.as_stored()).unwrap(),
            receipt_json: serde_json::to_value(projection.receipt_as_stored()).unwrap(),
            committed_at_epoch_ms: i64::try_from(projection.receipt().committed_at_epoch_ms())
                .unwrap(),
            valid_through_epoch_ms: i64::try_from(projection.valid_through_epoch_ms()).unwrap(),
        };
        row.projection_json["basis_digest"] = serde_json::json!("sha256:forged");

        assert!(verify_projection_envelope_row(&row, &basis).is_err());
    }

    #[rstest]
    fn same_basis_successor_is_latest_and_refuting_histories_fail_closed() {
        let basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: "basis-1".into(),
            request_identity: "request-1".into(),
            principal: "principal-1".into(),
            request_scope: vec!["research:submit".into()],
            rationale_digest: "sha256:rationale".into(),
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest: "sha256:lineage".into(),
            basis_digest: "sha256:basis".into(),
        };
        let first = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::GenesisEmpty,
            0,
            "qualification-protected-feedback-cut-v1-0".into(),
            None,
            None,
            100,
        )
        .unwrap();
        let successor = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::Frontier,
            first.source_sequence(),
            first.source_cut().into(),
            Some(first.projection_identity().into()),
            Some(first.projection_digest().into()),
            first.valid_through_epoch_ms(),
        )
        .unwrap();
        assert_eq!(
            successor,
            form_projection(
                &basis,
                ProtectedFeedbackResolutionV1::Frontier,
                first.source_sequence(),
                first.source_cut().into(),
                Some(first.projection_identity().into()),
                Some(first.projection_digest().into()),
                first.valid_through_epoch_ms(),
            )
            .unwrap()
        );
        let history = VerifiedScopeHistoryV1 {
            projections: vec![first.clone(), successor.clone()],
            current_frontier: Some(successor.clone()),
        };
        verify_projection_chain(&history.projections, history.current_frontier.as_ref()).unwrap();
        assert_eq!(
            history.projection_for_basis(&basis.basis_identity),
            Some(&successor)
        );

        let branch = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::Frontier,
            first.source_sequence(),
            first.source_cut().into(),
            Some(first.projection_identity().into()),
            Some(first.projection_digest().into()),
            first.valid_through_epoch_ms().saturating_add(1),
        )
        .unwrap();
        assert!(
            verify_projection_chain(
                &[first.clone(), successor.clone(), branch],
                Some(&successor),
            )
            .is_err()
        );
        let mut tampered = successor;
        tampered.source_frontier_digest = Some("sha256:tampered".into());
        assert!(verify_projection_chain(&[first, tampered.clone()], Some(&tampered)).is_err());
    }

    /// The sixteen execution-defining bindings every ordered-gate protected request freezes. The
    /// plan, artifact, purge/embargo policy, multiplicity basis, and alternatives thresholds repeat
    /// the Qualification authority source exactly, the cost, slippage, and capacity models repeat
    /// its identities, and the remaining fields carry fixed acceptance identities.
    fn chain_protected_bindings(
        source: &ProtectedReplayAuthoritySourceV1,
    ) -> Vec<crate::protected_replay_request::ProtectedReplayBindingV1> {
        use crate::protected_replay_request::{
            ProtectedReplayBindingFieldV1, ProtectedReplayBindingV1,
        };

        let mut bindings = ProtectedReplayBindingFieldV1::ALL
            .into_iter()
            .enumerate()
            .map(|(index, field)| ProtectedReplayBindingV1 {
                field,
                identity: format!("protected-requested-binding-{index}"),
                digest: format!("sha256:{index:064x}"),
            })
            .collect::<Vec<_>>();

        for (index, identity_value, digest_value) in [
            (0, &source.plan_identity, &source.plan_digest),
            (1, &source.artifact_identity, &source.artifact_digest),
            (
                12,
                &source.purge_embargo_policy_identity,
                &source.purge_embargo_policy_digest,
            ),
            (
                14,
                &source.multiplicity_basis_identity,
                &source.multiplicity_basis_digest,
            ),
            (
                15,
                &source.alternatives_thresholds_identity,
                &source.alternatives_thresholds_digest,
            ),
        ] {
            bindings[index].identity = identity_value.clone();
            bindings[index].digest = digest_value.clone();
        }

        for (index, identity_value) in [
            (9, &source.cost_model_identity),
            (10, &source.slippage_model_identity),
            (11, &source.capacity_model_identity),
        ] {
            bindings[index].identity = identity_value.clone();
        }
        bindings
    }

    /// The ordered gate's frozen economic policy bundle. Every policy reference repeats the
    /// admitted plan; the numeric policy is the fixed acceptance threshold the Backtest gate step
    /// measures every applicable cell against (`crates/backtest_owner/src/lib.rs`).
    fn chain_economic_policy(
        source: &ProtectedReplayAuthoritySourceV1,
    ) -> ProtectedEconomicPolicyBundleV1 {
        use vibe_backtest_owner_contracts::{
            ProtectedEconomicAggregationV1, ProtectedEconomicComparisonV1,
            ProtectedEconomicPolicyReferenceV1,
        };

        let reference = |identity: &str, digest: &str| ProtectedEconomicPolicyReferenceV1 {
            identity: identity.to_string(),
            digest: digest.to_string(),
        };
        let policy = ProtectedEconomicPolicyBundleV1 {
            schema_version: 1,
            bundle_identity: "pending-policy".to_string(),
            bundle_digest: format!("blake3:{}", "0".repeat(64)),
            protected_decision_policy_identity: source.protected_decision_policy_identity.clone(),
            protected_decision_policy_version: source.protected_decision_policy_version,
            metric: reference(&source.metric_policy_identity, &source.metric_policy_digest),
            coverage_policy: reference(
                &source.coverage_policy_identity,
                &source.coverage_policy_digest,
            ),
            tolerance_policy: reference(
                &source.tolerance_policy_identity,
                &source.tolerance_policy_digest,
            ),
            threshold_policy: reference(
                &source.threshold_policy_identity,
                &source.threshold_policy_digest,
            ),
            aggregation_policy: reference(
                &source.aggregation_policy_identity,
                &source.aggregation_policy_digest,
            ),
            unit: "basis-points".to_string(),
            decimal_scale: 4,
            comparison: ProtectedEconomicComparisonV1::GreaterThanOrEqual,
            // The gate's fixed acceptance corpus is one short round trip whose real net return is
            // slightly negative, so this floor is set below it. It is the threshold that makes the
            // frozen corpus an admitted pass, never a judgement that losing a hundred basis points
            // is economically acceptable; a deployed policy states its own floor.
            threshold_raw: -100,
            tolerance_raw: 5,
            minimum_coverage_bps: 9_500,
            aggregation: ProtectedEconomicAggregationV1::EveryApplicableCell,
        };
        // The identity rule belongs to the bundle. Spelling it out here meant a drift in the
        // contract would still produce a corpus policy that looked sealed to every reader.
        policy.seal().expect("chain economic policy seals")
    }

    /// The Candidate lineages the ordered gate's READY entry mints for the protected-evaluation
    /// terminals, one per terminal because a Candidate reserves holdout and seals one request set
    /// exactly once.
    const PROTECTED_TERMINAL_LINEAGES_V1: [&str; 3] =
        ["economic-pass", "economic-failure", "all-not-applicable"];

    /// Exact row counts of every Qualification relation, one `name=count` per non-empty table.
    ///
    /// Zero counts are dropped so a table that does not exist and a table that is empty read the
    /// same, which keeps this comparable across stores. Scoped counts answer whether this entry
    /// wrote what it meant to; this answers whether it touched anything else, including rows
    /// another gate entry owns, which no identity-scoped count can see.
    async fn qualification_schema_row_counts(pool: &PgPool) -> Vec<String> {
        sqlx::query_scalar::<_, String>(
            "SELECT c.relname||'='||(xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint \
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace \
             WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'qualification\\_%' \
             ORDER BY c.relname",
        )
        .fetch_all(pool)
        .await
        .expect("Qualification schema row counts")
        .into_iter()
        .filter(|row| !row.ends_with("=0"))
        .collect()
    }

    /// The `ADMITTED` intake of one exact gate lineage. Its public status has not reached a
    /// terminal phase, so this entry owns the lineage's protected attempt.
    async fn admitted_intake_for_lineage(
        pool: &PgPool,
        lineage: &str,
    ) -> crate::CandidateIntakeReceiptV1 {
        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt.receipt_json \
             FROM public.qualification_candidate_intake_receipts_v1 receipt \
             JOIN public.qualification_public_status_heads_v1 head \
               ON head.review_request_identity=receipt.review_request_identity \
             WHERE receipt.status='ADMITTED' AND head.phase_sequence<3 \
               AND receipt.review_request_identity LIKE 'qualification-review-' || $1 || '-%' \
             ORDER BY receipt.committed_at_epoch_ms DESC, receipt.review_request_identity DESC \
             LIMIT 1",
        )
        .bind(lineage)
        .fetch_one(pool)
        .await
        .expect("gate lineage ADMITTED intake");
        decode_intake_receipt_v1(&intake_json).expect("canonical intake")
    }

    async fn authority_source_for_intake(
        owner: &PostgresQualificationOwnerV1,
        intake: &crate::CandidateIntakeReceiptV1,
    ) -> ProtectedReplayAuthoritySourceV1 {
        let mut source_transaction = owner.pool.begin().await.expect("source transaction");
        let handoff = load_rd_selection_in_transaction(
            &mut source_transaction,
            intake.decision_identity(),
            intake.result_identity(),
        )
        .await
        .expect("sealed R&D handoff");
        let source = protected_replay_authority_source_v1(intake, &handoff)
            .expect("Qualification authority source");
        source_transaction
            .rollback()
            .await
            .expect("source rollback");
        source
    }

    #[tokio::test]
    #[ignore = "requires the repository-authoritative disposable Owner PostgreSQL topology"]
    async fn protected_replay_request_is_atomic_retry_exact_and_backtest_sealed() {
        use crate::protected_replay_request::ProtectedReplayRequestProposalV1;

        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE status='ADMITTED' ORDER BY committed_at_epoch_ms DESC, review_request_identity DESC LIMIT 1",
        )
        .fetch_one(&owner.pool)
        .await
        .expect("prior exact ADMITTED intake");
        let intake = decode_intake_receipt_v1(&intake_json).expect("canonical intake");
        let reservation_identity = intake
            .holdout_reservation_identity()
            .expect("ADMITTED intake reservation")
            .to_string();
        let registration: (String, String, String, serde_json::Value, i64) = sqlx::query_as(
            "SELECT treatment_policy_identity,treatment_policy_digest,closure_disposition,registration_json,committed_at_epoch_ms \
             FROM public.qualification_holdout_treatment_registrations_v1 WHERE reservation_identity=$1",
        )
        .bind(&reservation_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("current preregistered treatment");
        let test_marker = std::env::var("VIBE_POSTGRES_TEST_INSTANCE_MARKER")
            .expect("dedicated PostgreSQL marker");
        sqlx::query(
            "SELECT vibe_test_admin.remove_qualification_holdout_treatment_registration_v1($1,$2)",
        )
        .bind(&test_marker)
        .bind(&reservation_identity)
        .execute(&owner.pool)
        .await
        .expect("simulate an Origin ADMITTED intake upgraded without treatment registration");
        let legacy_retry_request = CandidateIntakeRequestV1::new(
            intake.review_request_identity().to_string(),
            intake.decision_identity().to_string(),
            intake.result_identity().to_string(),
            intake.candidate_identity().to_string(),
            intake_json["selection_identity"]
                .as_str()
                .expect("selection identity")
                .to_string(),
            intake.protected_decision_policy_identity().to_string(),
            intake.protected_decision_policy_version(),
        )
        .expect("legacy retry request");
        let legacy_retry = owner
            .submit_candidate_intake_v1(&legacy_retry_request)
            .await
            .expect("Origin intake exact replay remains available after upgrade");
        assert_eq!(legacy_retry, intake);
        let source = authority_source_for_intake(&owner, &intake).await;
        let mut bindings = chain_protected_bindings(&source);
        let request_identity = format!(
            "qualification-protected-request-{}",
            intake.receipt_identity()
        );
        let proposal = ProtectedReplayRequestProposalV1::new(
            request_identity.clone(),
            intake.review_request_identity().to_string(),
            intake.receipt_identity().to_string(),
            intake.receipt_digest().to_string(),
            0,
            bindings.clone(),
        )
        .expect("canonical protected proposal");
        assert!(matches!(
            owner.submit_protected_replay_request_v1(&proposal).await,
            Err(QualificationOwnerError::Unavailable(message))
                if message == "Candidate Intake has no preregistered holdout treatment"
        ));
        sqlx::query(
            "INSERT INTO public.qualification_holdout_treatment_registrations_v1 \
             (reservation_identity,treatment_policy_identity,treatment_policy_digest,closure_disposition,registration_json,committed_at_epoch_ms) \
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(&reservation_identity)
        .bind(&registration.0)
        .bind(&registration.1)
        .bind(&registration.2)
        .bind(&registration.3)
        .bind(registration.4)
        .execute(&owner.pool)
        .await
        .expect("restore current preregistration fixture");
        let first = owner
            .submit_protected_replay_request_v1(&proposal)
            .await
            .expect("protected request commit");
        let retry = owner
            .submit_protected_replay_request_v1(&proposal)
            .await
            .expect("protected request response-loss retry");
        assert_eq!(first, retry);
        let counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1), \
             (SELECT count(*) FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1')",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("protected aggregate counts");
        assert_eq!(counts, (1, 1, 1));

        bindings[2].digest = format!("sha256:{}", "f".repeat(64));
        let conflicting = ProtectedReplayRequestProposalV1::new(
            request_identity,
            intake.review_request_identity().to_string(),
            intake.receipt_identity().to_string(),
            intake.receipt_digest().to_string(),
            0,
            bindings,
        )
        .expect("changed-meaning proposal");
        assert!(matches!(
            owner.submit_protected_replay_request_v1(&conflicting).await,
            Err(QualificationOwnerError::ConflictingIdentity)
        ));

        let locator = serde_json::to_value(first.locator()).expect("locator JSON");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");
        assert!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM public.qualification_protected_replay_requests_v1",
            )
            .fetch_one(&backtest)
            .await
            .is_err()
        );
        let mut backtest_transaction = backtest.begin().await.expect("Backtest transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *backtest_transaction)
            .await
            .expect("serializable request read");
        let locked: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
        )
        .bind(locator["request_identity"].as_str().unwrap())
        .bind(locator["request_digest"].as_str().unwrap())
        .bind(locator["receipt_identity"].as_str().unwrap())
        .bind(locator["seal_digest"].as_str().unwrap())
        .fetch_one(&mut *backtest_transaction)
        .await
        .expect("sealed Backtest read");
        // Not `is_some()`. A refusal is also Some now that this function names its causes, so
        // the old assertion would accept the very outcome it exists to rule out.
        let locked = locked.expect("sealed Backtest read returns an envelope");
        assert!(
            locked.get("refusal").is_none(),
            "sealed envelope expected; this read was refused as {:?}",
            locked.get("refusal")
        );
        backtest_transaction
            .rollback()
            .await
            .expect("Backtest rollback");
    }

    /// Every admission these two sealed reads can refuse names itself.
    ///
    /// Both functions used to answer a bare `NULL` for six causes each: a three-way admission
    /// guard and a three-way exception handler. The boundary is built so the caller cannot look
    /// for itself - `backtest_owner` holds no `SELECT` on the underlying tables - so a cause the
    /// function does not name is a cause nobody downstream can recover.
    ///
    /// The refusals control each other. The isolation case and the missing-row case below use the
    /// same role and the same identity and differ only in the transaction's isolation level, so
    /// two different codes prove the guard discriminates rather than the row merely being absent.
    /// Without that pairing, either assertion alone would also pass if the function refused
    /// everything for one reason.
    ///
    /// Three of the twelve are not driven here:
    ///
    /// - `CALLER_NOT_BACKTEST_OWNER` is not constructible today, and the reason was measured
    ///   rather than assumed: driving it returned SQLSTATE 42501 before the guard ran. `EXECUTE`
    ///   on both functions is granted to `backtest_owner` alone and no role anywhere is granted
    ///   membership in `backtest_owner`, so every caller that clears the ACL has
    ///   `session_user = 'backtest_owner'`. One `GRANT backtest_owner TO <role>` makes it
    ///   reachable, which is the shape every other Owner already has as `X_owner TO X_writer`.
    ///   The ACL refusal it collapses into is asserted below.
    ///
    /// - `DEFINER_NOT_QUALIFICATION_OWNER` is not constructible. The function is `SECURITY
    ///   DEFINER` and `ALTER FUNCTION ... OWNER TO qualification_owner` follows it, so
    ///   `current_user` inside the body is always the owner. Control that this is not a blanket
    ///   property of the migration: four functions in the same file are `SECURITY INVOKER`.
    ///   Live control: the accept-state assertion at the end of this test reads an admitted
    ///   request back as a three-part envelope, which this branch firing would replace with a
    ///   refusal. No invocation count is claimed from the chain's PostgreSQL log, which is dumped
    ///   as a partial window and cannot carry one.
    /// - `REQUEST_AMBIGUOUS` is constructible but not driven here, and the mechanism is recorded
    ///   so the next person does not have to rediscover it: the three filtered identity columns
    ///   are each `TEXT PRIMARY KEY`, so they cannot multiply, but the outbox is joined on
    ///   `payload_json->>'request_identity'` and its siblings, which carry no unique constraint,
    ///   and `qualification_writer` holds `INSERT` on that table. A second outbox row with the
    ///   same payload fields raises `too_many_rows`.
    /// Two reads fail on the same helper for opposite reasons, and they must not say the same
    /// thing.
    ///
    /// A caller whose own request locator does not resolve has a request to correct. A stored
    /// projection whose recorded basis is gone is storage residue to clear, and it fails every
    /// read of this Owner's scope history until the row goes, under any principal: the projection
    /// query carries no `WHERE`, so one orphan anywhere halts all of them. Both used to arrive as
    /// `R&D Independence Basis unavailable`, which sends the reader to the wrong side.
    ///
    /// The tamper runs inside a transaction that is rolled back, and the row is read back
    /// afterwards to show it is unchanged. The untampered call is asserted first so the failure
    /// below is attributable to the tamper and not to a state an earlier entry left behind.
    #[tokio::test]
    #[ignore = "requires the repository-authoritative disposable Owner PostgreSQL topology"]
    async fn an_orphaned_projection_names_itself_rather_than_the_caller_request() {
        const ABSENT_BASIS: &str = "rd-independence-basis-v1-that-no-row-carries";

        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let (projection_identity, principal, scope_json, projection_json): (
            String,
            String,
            serde_json::Value,
            serde_json::Value,
        ) = sqlx::query_as(
            "SELECT projection_identity, principal, request_scope_json, projection_json
               FROM public.qualification_protected_feedback_projections_v1
              ORDER BY projection_identity
              LIMIT 1",
        )
        .fetch_one(&owner.pool)
        .await
        .expect("an earlier ordered entry stored a protected feedback projection");
        let request_scope: Vec<String> =
            serde_json::from_value(scope_json).expect("canonical stored request scope");
        let scope_key =
            principal_scope_key(&principal, &request_scope).expect("principal scope key");

        // Accept-state control. Without it the failure below is not attributable to the tamper.
        let mut admitted = owner.pool.begin().await.expect("control transaction");
        verify_scope_history_in_transaction(&mut admitted, &principal, &request_scope, &scope_key)
            .await
            .expect("scope history admits before the tamper");
        admitted.rollback().await.expect("control rollback");

        // The caller's own locator does not resolve. Same helper, different object.
        let mut caller = owner.pool.begin().await.expect("caller transaction");
        let caller_error = load_rd_basis_in_transaction(
            &mut caller,
            &RdIndependenceBasisLocatorV1 {
                basis_identity: ABSENT_BASIS.to_owned(),
                basis_digest: "sha256:absent".to_owned(),
                request_identity: "rd-research-request-v2-that-no-row-carries".to_owned(),
                principal: principal.clone(),
                request_scope: request_scope.clone(),
            },
        )
        .await
        .expect_err("an absent request locator is refused");
        caller.rollback().await.expect("caller rollback");
        let caller_error = caller_error.to_string();

        // A stored projection records a basis that is gone.
        let mut orphaned = owner.pool.begin().await.expect("tamper transaction");
        let mut tampered = projection_json.clone();
        tampered["basis_identity"] = serde_json::Value::String(ABSENT_BASIS.to_owned());
        let updated = sqlx::query(
            "UPDATE public.qualification_protected_feedback_projections_v1
                SET projection_json = $1
              WHERE projection_identity = $2",
        )
        .bind(&tampered)
        .bind(&projection_identity)
        .execute(&mut *orphaned)
        .await
        .expect("tamper applies")
        .rows_affected();
        assert_eq!(updated, 1, "the tamper reached exactly the row under test");

        let orphan_error = verify_scope_history_in_transaction(
            &mut orphaned,
            &principal,
            &request_scope,
            &scope_key,
        )
        .await
        .expect_err("an orphaned projection is refused");
        orphaned.rollback().await.expect("tamper rollback");
        let orphan_error = orphan_error.to_string();

        assert!(
            orphan_error.contains(&projection_identity),
            "the refusal names the projection an operator has to clear: {orphan_error}"
        );
        assert!(
            orphan_error.contains(ABSENT_BASIS),
            "the refusal names the basis identity that could not be loaded: {orphan_error}"
        );
        assert!(
            orphan_error.contains("stored on the projection row"),
            "the refusal says where that identity came from: {orphan_error}"
        );
        assert!(
            !caller_error.contains("stored projection"),
            "a caller locator failure is not attributed to stored state: {caller_error}"
        );
        assert_ne!(
            caller_error, orphan_error,
            "the two causes are distinguishable by their message alone"
        );

        // Nothing was written. Read the row back rather than trusting the rollback.
        let after: serde_json::Value = sqlx::query_scalar(
            "SELECT projection_json
               FROM public.qualification_protected_feedback_projections_v1
              WHERE projection_identity = $1",
        )
        .bind(&projection_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("the projection row is still there");
        assert_eq!(after, projection_json, "the tamper was rolled back in full");
    }

    #[tokio::test]
    #[ignore = "requires the repository-authoritative disposable Owner PostgreSQL topology"]
    async fn sealed_request_reads_name_the_admission_they_refused() {
        async fn refusal_of(pool: &PgPool, serializable: bool, identity: &str) -> Option<String> {
            let mut transaction = pool.begin().await.expect("probe transaction");

            if serializable {
                sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                    .execute(&mut *transaction)
                    .await
                    .expect("probe isolation");
            }
            let value: Option<serde_json::Value> = sqlx::query_scalar(
                "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
            )
            .bind(identity)
            .bind("absent-request-digest")
            .bind("absent-receipt-identity")
            .bind("absent-seal-digest")
            .fetch_one(&mut *transaction)
            .await
            .expect("sealed read answers");
            transaction.rollback().await.expect("probe rollback");
            value.and_then(|v| v.get("refusal").and_then(|r| r.as_str().map(str::to_owned)))
        }

        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let qualification = PgPool::connect(&qualification_url)
            .await
            .expect("Qualification pool");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");

        // One identity that belongs to no row, reused everywhere below so the only thing that
        // changes between cases is the admission under test.
        let absent = "protected-replay-request-that-was-never-admitted";

        // `CALLER_NOT_BACKTEST_OWNER` cannot be driven: the ACL refuses a foreign caller one
        // layer earlier than the guard, so the guard never runs. Assert the layer that does
        // fire, because that is the boundary the caller actually meets.
        let mut foreign_transaction = qualification.begin().await.expect("foreign transaction");
        let foreign: Result<Option<serde_json::Value>, sqlx::Error> = sqlx::query_scalar(
            "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
        )
        .bind(absent)
        .bind("absent-request-digest")
        .bind("absent-receipt-identity")
        .bind("absent-seal-digest")
        .fetch_one(&mut *foreign_transaction)
        .await;
        foreign_transaction
            .rollback()
            .await
            .expect("foreign rollback");
        assert_eq!(
            foreign
                .expect_err("a foreign caller is refused")
                .as_database_error()
                .and_then(sqlx::error::DatabaseError::code)
                .as_deref(),
            Some("42501"),
            "the Qualification role holds no EXECUTE on its own Backtest-facing function"
        );

        // Same role, same identity, non-serializable transaction.
        assert_eq!(
            refusal_of(&backtest, false, absent).await.as_deref(),
            Some("ISOLATION_NOT_SERIALIZABLE"),
        );

        // Same role, same identity, serializable: the admission passes and the row is missing.
        // This is the control for the case above - one variable changed, a different code.
        assert_eq!(
            refusal_of(&backtest, true, absent).await.as_deref(),
            Some("REQUEST_NOT_FOUND"),
        );

        let mut set_transaction = backtest.begin().await.expect("request set transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *set_transaction)
            .await
            .expect("request set isolation");
        let set_value: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT qualification_api.lock_protected_replay_request_set_v1($1,$2)",
        )
        .bind("protected-replay-request-set-that-was-never-sealed")
        .bind("absent-request-set-digest")
        .fetch_one(&mut *set_transaction)
        .await
        .expect("sealed request set read answers");
        set_transaction
            .rollback()
            .await
            .expect("request set rollback");
        assert_eq!(
            set_value
                .as_ref()
                .and_then(|v| v.get("refusal"))
                .and_then(serde_json::Value::as_str),
            Some("REQUEST_SET_NOT_FOUND"),
        );

        // Accept-state control. Without it every assertion above is satisfied by a function that
        // refuses everything, so the four codes would prove only that the boundary is closed, not
        // that it still discriminates. The coordinates are read under the Qualification role
        // because `backtest_owner` holds no SELECT on these tables - that asymmetry is the reason
        // the refusal has to be named in the return value rather than looked up by the caller.
        let (request_identity, request_digest, receipt_identity, seal_digest): (
            String,
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT request.request_identity,
                    request.request_digest,
                    receipt.receipt_identity,
                    receipt.seal_digest
               FROM public.qualification_protected_replay_requests_v1 request
               JOIN public.qualification_protected_replay_request_receipts_v1 receipt
                 ON receipt.request_identity = request.request_identity
                AND receipt.request_digest = request.request_digest
               JOIN public.qualification_owner_outbox_v1 outbox
                 ON outbox.aggregate_identity = request.request_identity
                AND outbox.event_kind = 'QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1'
                AND outbox.payload_json->>'request_identity' = request.request_identity
                AND outbox.payload_json->>'request_digest' = request.request_digest
                AND outbox.payload_json->>'receipt_identity' = receipt.receipt_identity
                AND outbox.payload_json->>'seal_digest' = receipt.seal_digest
              ORDER BY request.request_identity
              LIMIT 1",
        )
        .fetch_one(&qualification)
        .await
        .expect("an earlier ordered entry sealed at least one protected replay request");
        // The join above mirrors the function's own WHERE clause, including the outbox
        // conditions, so a row selected here is a row the function must admit. Selecting on the
        // request and receipt alone would let this control fail for a reason that has nothing
        // to do with the refusal codes under test.

        let mut accept_transaction = backtest.begin().await.expect("accept transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *accept_transaction)
            .await
            .expect("accept isolation");
        let accepted: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
        )
        .bind(&request_identity)
        .bind(&request_digest)
        .bind(&receipt_identity)
        .bind(&seal_digest)
        .fetch_one(&mut *accept_transaction)
        .await
        .expect("sealed read answers");
        accept_transaction
            .rollback()
            .await
            .expect("accept rollback");
        let accepted = accepted.expect("sealed Backtest read returns an envelope");
        assert!(
            accepted.get("refusal").is_none(),
            "sealed envelope expected; this read was refused as {:?}",
            accepted.get("refusal")
        );
        assert!(
            accepted.get("request").is_some()
                && accepted.get("receipt").is_some()
                && accepted.get("outbox").is_some(),
            "the admitted envelope carries all three sealed parts"
        );
    }

    #[tokio::test]
    #[ignore = "requires the ordered canonical Owner PostgreSQL gate after protected diagnostic Result custody"]
    async fn diagnostic_protected_attempt_closure_is_atomic_and_creates_no_assessment_or_eligibility()
     {
        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");
        let legacy_terminal: (String, String, String) = sqlx::query_as(
            "SELECT result_identity,request_identity,attempt_identity
               FROM public.backtest_protected_replay_results_v1
              WHERE terminal='TERMINAL_RESULT'
                AND convert_from(canonical_bytes,'UTF8')::jsonb->>'schema_version'='1'
              ORDER BY result_identity LIMIT 1",
        )
        .fetch_one(&backtest)
        .await
        .expect("legacy protected terminal Result");
        assert!(
            owner
                .close_terminal_diagnostic_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &legacy_terminal.0,
                    request_identity: &legacy_terminal.1,
                    attempt_identity: &legacy_terminal.2,
                },)
                .await
                .is_err()
        );
        let legacy_closures: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE result_identity=$1",
        )
        .bind(&legacy_terminal.0)
        .fetch_one(&owner.pool)
        .await
        .expect("legacy terminal remains unclosed");
        assert_eq!(legacy_closures, 0);
        let rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT result.result_identity,result.request_identity,result.attempt_identity,
                    convert_from(result.canonical_bytes,'UTF8')::jsonb->'diagnostic_category_set'->>0
               FROM public.backtest_protected_replay_results_v1 result
               JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity)
              WHERE result.terminal='TERMINAL_RESULT'
                AND convert_from(result.canonical_bytes,'UTF8')::jsonb->>'schema_version'='2'
              ORDER BY result.attempt_identity",
        )
        .fetch_all(&backtest)
        .await
        .expect("sealed protected diagnostic Results");
        assert_eq!(rows.len(), 2);
        let diagnostic_request_identity = rows[0].1.clone();
        assert!(
            rows.iter()
                .all(|(_, request_identity, _, _)| request_identity
                    == &diagnostic_request_identity)
        );
        let diagnostic_result_identities = rows
            .iter()
            .map(|(result_identity, _, _, _)| result_identity.clone())
            .collect::<Vec<_>>();
        let preexisting_public_terminal: serde_json::Value = sqlx::query_scalar(
            "SELECT pg_catalog.jsonb_build_object( \
               'fact',pg_catalog.to_jsonb(fact), \
               'head',pg_catalog.to_jsonb(head), \
               'event',pg_catalog.to_jsonb(event)) \
             FROM public.qualification_protected_replay_requests_v1 request \
             JOIN public.qualification_public_status_facts_v1 fact \
               ON fact.review_request_identity=request.review_request_identity \
              AND fact.phase_sequence=3 \
             JOIN public.qualification_public_status_heads_v1 head \
               ON head.review_request_identity=fact.review_request_identity \
              AND head.fact_identity=fact.fact_identity \
              AND head.fact_digest=fact.fact_digest \
              AND head.phase_sequence=fact.phase_sequence \
             JOIN public.qualification_owner_outbox_v1 event \
               ON event.aggregate_identity=fact.fact_identity \
              AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1' \
             WHERE request.request_identity=$1",
        )
        .bind(&diagnostic_request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("preexisting negative public terminal custody");
        assert_eq!(
            preexisting_public_terminal["fact"]["status"],
            serde_json::json!("CLOSED_NOT_QUALIFIED")
        );
        assert_eq!(
            preexisting_public_terminal["head"]["fact_identity"],
            preexisting_public_terminal["fact"]["fact_identity"]
        );
        assert_eq!(
            preexisting_public_terminal["head"]["fact_digest"],
            preexisting_public_terminal["fact"]["fact_digest"]
        );
        assert_eq!(
            preexisting_public_terminal["head"]["phase_sequence"],
            preexisting_public_terminal["fact"]["phase_sequence"]
        );
        assert_eq!(
            preexisting_public_terminal["event"]["aggregate_identity"],
            preexisting_public_terminal["fact"]["fact_identity"]
        );
        assert_eq!(
            preexisting_public_terminal["event"]["event_kind"],
            serde_json::json!("QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1")
        );
        assert_eq!(
            preexisting_public_terminal["event"]["committed_at_epoch_ms"],
            preexisting_public_terminal["fact"]["committed_at_epoch_ms"]
        );
        let preexisting_source_identity =
            preexisting_public_terminal["fact"]["native_source_identity"]
                .as_str()
                .expect("preexisting negative public terminal source identity")
                .to_string();
        let (
            resolved_source_identity,
            preexisting_source_digest,
            preexisting_source_status,
            preexisting_source_request_identity,
            preexisting_source_time,
        ): (String, String, String, String, i64) = sqlx::query_as(
            "SELECT disposition_identity,disposition_digest,status,request_identity,committed_at_epoch_ms \
               FROM public.qualification_protected_attempt_dispositions_v1 \
              WHERE disposition_identity=$1",
        )
        .bind(&preexisting_source_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("preexisting negative public terminal source disposition");
        assert_eq!(resolved_source_identity, preexisting_source_identity);
        assert!(matches!(
            preexisting_source_status.as_str(),
            "REPLAY_REJECTED" | "REPLAY_INVALID"
        ));
        assert_eq!(
            preexisting_source_request_identity,
            diagnostic_request_identity
        );
        assert_eq!(
            preexisting_public_terminal["fact"]["native_source_digest"],
            serde_json::json!(preexisting_source_digest)
        );
        assert_eq!(
            preexisting_public_terminal["fact"]["committed_at_epoch_ms"],
            serde_json::json!(preexisting_source_time)
        );
        let preexisting_public_terminal_bytes = serde_json::to_vec(&preexisting_public_terminal)
            .expect("preexisting negative public terminal bytes");
        let mut diagnostic_disposition_identities = Vec::with_capacity(rows.len());

        for (result_identity, request_identity, attempt_identity, category) in rows {
            let first = owner
                .close_terminal_diagnostic_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &attempt_identity,
                })
                .await
                .expect("diagnostic closure commit");
            let retry = owner
                .close_terminal_diagnostic_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &attempt_identity,
                })
                .await
                .expect("diagnostic closure exact retry");
            assert_eq!(first, retry);
            assert_eq!(
                first.status(),
                if category == "MARKET_DATA" {
                    ProtectedAttemptDispositionStatusV1::DiagnosticInvalid
                } else {
                    assert_eq!(category, "UNRESOLVED_FAILURE");
                    ProtectedAttemptDispositionStatusV1::DiagnosticUnresolved
                }
            );
            assert_eq!(
                first.holdout_closure_disposition(),
                HoldoutClosureDispositionV1::Consumed
            );
            let counts: (i64, i64, i64, i64) = sqlx::query_as(
                "SELECT
                   (SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE result_identity=$1),
                   (SELECT count(*) FROM public.qualification_holdout_closures_v1 closure JOIN public.qualification_protected_attempt_dispositions_v1 disposition USING(disposition_identity) WHERE disposition.result_identity=$1),
                   (SELECT count(*) FROM public.qualification_protected_attempt_disposition_receipts_v1 WHERE disposition_identity=$2),
                   (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1')",
            )
            .bind(&result_identity)
            .bind(first.disposition_identity())
            .fetch_one(&owner.pool)
            .await
            .expect("diagnostic terminal aggregate counts");
            assert_eq!(counts, (1, 1, 1, 1));
            assert_ne!(first.disposition_identity(), preexisting_source_identity);
            diagnostic_disposition_identities.push(first.disposition_identity().to_string());
            let public_terminal: serde_json::Value = sqlx::query_scalar(
                "SELECT pg_catalog.jsonb_build_object( \
                   'fact',pg_catalog.to_jsonb(fact), \
                   'head',pg_catalog.to_jsonb(head), \
                   'event',pg_catalog.to_jsonb(event)) \
                 FROM public.qualification_protected_replay_requests_v1 request \
                 JOIN public.qualification_public_status_facts_v1 fact \
                   ON fact.review_request_identity=request.review_request_identity \
                  AND fact.phase_sequence=3 \
                 JOIN public.qualification_public_status_heads_v1 head \
                   ON head.review_request_identity=fact.review_request_identity \
                  AND head.fact_identity=fact.fact_identity \
                  AND head.fact_digest=fact.fact_digest \
                  AND head.phase_sequence=fact.phase_sequence \
                 JOIN public.qualification_owner_outbox_v1 event \
                   ON event.aggregate_identity=fact.fact_identity \
                  AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1' \
                 WHERE request.request_identity=$1",
            )
            .bind(&request_identity)
            .fetch_one(&owner.pool)
            .await
            .expect("diagnostic public terminal custody");
            assert_eq!(&public_terminal, &preexisting_public_terminal);
            assert_eq!(
                serde_json::to_vec(&public_terminal).expect("diagnostic public terminal bytes"),
                preexisting_public_terminal_bytes
            );
        }
        let aggregate_counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE result_identity=ANY($1)), \
             (SELECT count(*) FROM public.qualification_holdout_closures_v1 closure JOIN public.qualification_protected_attempt_dispositions_v1 disposition USING(disposition_identity) WHERE disposition.result_identity=ANY($1)), \
             (SELECT count(*) FROM public.qualification_protected_attempt_disposition_receipts_v1 WHERE disposition_identity=ANY($2)), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=ANY($2) AND event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1'), \
             (SELECT count(*) FROM public.qualification_public_status_facts_v1 fact JOIN public.qualification_protected_replay_requests_v1 request ON request.review_request_identity=fact.review_request_identity WHERE request.request_identity=$3 AND fact.phase_sequence=3), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 event JOIN public.qualification_public_status_facts_v1 fact ON fact.fact_identity=event.aggregate_identity JOIN public.qualification_protected_replay_requests_v1 request ON request.review_request_identity=fact.review_request_identity WHERE request.request_identity=$3 AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1')",
        )
        .bind(&diagnostic_result_identities)
        .bind(&diagnostic_disposition_identities)
        .bind(&diagnostic_request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("same-request diagnostic aggregate counts");
        assert_eq!(aggregate_counts, (2, 2, 2, 2, 1, 1));
        let forbidden_events: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE event_kind ILIKE '%ASSESSMENT%' OR event_kind ILIKE '%ELIGIBILITY%'",
        )
        .fetch_one(&owner.pool)
        .await
        .expect("absence of assessment and Eligibility events");
        assert_eq!(forbidden_events, 0);
    }

    #[tokio::test]
    #[ignore = "requires the ordered canonical Owner PostgreSQL gate after protected Result custody"]
    async fn negative_protected_attempt_closure_is_atomic_retry_exact_and_eligibility_absent() {
        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");
        let (result_identity, request_identity, attempt_identity): (String, String, String) =
            sqlx::query_as(
                "SELECT result.result_identity,result.request_identity,result.attempt_identity \
                 FROM public.backtest_protected_replay_results_v1 result \
                 JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity) \
                 WHERE result.terminal='INVALID_REPLAY_EVIDENCE' \
                 ORDER BY receipt.committed_at_epoch_ms DESC,result.result_identity DESC LIMIT 1",
            )
            .fetch_one(&backtest)
            .await
            .expect("prior sealed negative protected Result");
        let original_request: (Vec<u8>, serde_json::Value, serde_json::Value) = sqlx::query_as(
            "SELECT request.canonical_request_bytes,request.request_json,reservation.reservation_json FROM public.qualification_protected_replay_requests_v1 request JOIN public.qualification_holdout_reservations_v1 reservation ON reservation.reservation_identity=request.holdout_reservation_identity WHERE request.request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("original Qualification custody");

        let first_owner = owner.clone();
        let second_owner = owner.clone();
        let first_result = result_identity.clone();
        let first_request = request_identity.clone();
        let first_attempt = attempt_identity.clone();
        let second_result = result_identity.clone();
        let second_request = request_identity.clone();
        let second_attempt = attempt_identity.clone();
        let exact_retry_snapshot_barrier = tokio::sync::Barrier::new(2);
        let (first, retry) = tokio::join!(
            first_owner.close_negative_protected_attempt_with_snapshot_barrier_v1(
                ProtectedReplayResultLocatorV1 {
                    result_identity: &first_result,
                    request_identity: &first_request,
                    attempt_identity: &first_attempt,
                },
                &exact_retry_snapshot_barrier,
            ),
            second_owner.close_negative_protected_attempt_with_snapshot_barrier_v1(
                ProtectedReplayResultLocatorV1 {
                    result_identity: &second_result,
                    request_identity: &second_request,
                    attempt_identity: &second_attempt,
                },
                &exact_retry_snapshot_barrier,
            )
        );
        let first = first.expect("negative closure commit");
        let retry = retry.expect("concurrent exact retry");
        assert_eq!(first, retry);
        assert_eq!(
            first.status(),
            ProtectedAttemptDispositionStatusV1::ReplayInvalid
        );
        assert_eq!(
            first.holdout_closure_disposition(),
            HoldoutClosureDispositionV1::Consumed
        );
        let counts: (i64, i64, i64, i64, bool, bool) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE result_identity=$1),(SELECT count(*) FROM public.qualification_holdout_closures_v1 closure JOIN public.qualification_protected_attempt_dispositions_v1 disposition USING(disposition_identity) WHERE disposition.result_identity=$1),(SELECT count(*) FROM public.qualification_protected_attempt_disposition_receipts_v1 WHERE disposition_identity=$2),(SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$2 AND event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1'),NOT EXISTS (SELECT 1 FROM public.qualification_eligibility_facts_v1),NOT EXISTS (SELECT 1 FROM public.qualification_owner_outbox_v1 WHERE event_kind ILIKE '%ELIGIBILITY%')",
        )
        .bind(&result_identity)
        .bind(first.disposition_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("terminal aggregate counts");
        assert_eq!(counts, (1, 1, 1, 1, true, true));
        let reservation_unique_constraints: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_catalog.pg_constraint constraint_row \
             JOIN pg_catalog.pg_attribute attribute \
               ON attribute.attrelid=constraint_row.conrelid \
              AND attribute.attnum=ANY(constraint_row.conkey) \
             WHERE constraint_row.contype='u' \
               AND constraint_row.conrelid IN ( \
                 'public.qualification_protected_attempt_dispositions_v1'::pg_catalog.regclass, \
                 'public.qualification_holdout_closures_v1'::pg_catalog.regclass \
               ) \
               AND attribute.attname IN ('request_identity','attempt_identity','holdout_reservation_identity','reservation_identity')",
        )
        .fetch_one(&owner.pool)
        .await
        .expect("one reservation admits multiple plan-cell attempt closures");
        assert_eq!(reservation_unique_constraints, 0);
        let unchanged_request: (Vec<u8>, serde_json::Value, serde_json::Value) = sqlx::query_as(
            "SELECT request.canonical_request_bytes,request.request_json,reservation.reservation_json FROM public.qualification_protected_replay_requests_v1 request JOIN public.qualification_holdout_reservations_v1 reservation ON reservation.reservation_identity=request.holdout_reservation_identity WHERE request.request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("unchanged Qualification custody");
        assert_eq!(unchanged_request, original_request);

        sqlx::query(
            "UPDATE public.qualification_holdout_reservations_v1 SET reservation_json='{}'::jsonb WHERE reservation_identity=$1",
        )
        .bind(first.disposition().holdout_reservation_identity())
        .execute(&owner.pool)
        .await
        .expect("tamper mutable preexisting reservation fixture");
        assert!(
            owner
                .close_negative_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &attempt_identity,
                })
                .await
                .is_err()
        );
        sqlx::query(
            "UPDATE public.qualification_holdout_reservations_v1 SET reservation_json=$1 WHERE reservation_identity=$2",
        )
        .bind(&original_request.2)
        .bind(first.disposition().holdout_reservation_identity())
        .execute(&owner.pool)
        .await
        .expect("restore reservation fixture");

        assert!(
            owner
                .close_negative_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &result_identity,
                    request_identity: &request_identity,
                    attempt_identity: "wrong-protected-attempt",
                })
                .await
                .is_err()
        );
        let public_terminal_before: serde_json::Value = sqlx::query_scalar(
            "SELECT pg_catalog.jsonb_build_object( \
               'fact',pg_catalog.to_jsonb(fact), \
               'head',pg_catalog.to_jsonb(head), \
               'event',pg_catalog.to_jsonb(event)) \
             FROM public.qualification_protected_replay_requests_v1 request \
             JOIN public.qualification_public_status_facts_v1 fact \
               ON fact.review_request_identity=request.review_request_identity \
              AND fact.phase_sequence=3 \
             JOIN public.qualification_public_status_heads_v1 head \
               ON head.review_request_identity=fact.review_request_identity \
              AND head.fact_identity=fact.fact_identity \
              AND head.fact_digest=fact.fact_digest \
              AND head.phase_sequence=fact.phase_sequence \
             JOIN public.qualification_owner_outbox_v1 event \
               ON event.aggregate_identity=fact.fact_identity \
              AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1' \
             WHERE request.request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("first negative public terminal custody");
        assert_eq!(
            public_terminal_before["fact"]["native_source_identity"],
            serde_json::json!(first.disposition_identity())
        );
        assert_eq!(
            public_terminal_before["fact"]["status"],
            serde_json::json!("CLOSED_NOT_QUALIFIED")
        );
        assert_eq!(
            public_terminal_before["head"]["fact_identity"],
            public_terminal_before["fact"]["fact_identity"]
        );
        assert_eq!(
            public_terminal_before["head"]["fact_digest"],
            public_terminal_before["fact"]["fact_digest"]
        );
        assert_eq!(
            public_terminal_before["event"]["aggregate_identity"],
            public_terminal_before["fact"]["fact_identity"]
        );
        assert_eq!(
            public_terminal_before["event"]["event_kind"],
            serde_json::json!("QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1")
        );
        let (rejected_result_identity, rejected_attempt_identity): (String, String) =
            sqlx::query_as(
                "SELECT result_identity,attempt_identity FROM public.backtest_protected_replay_results_v1 \
                 WHERE request_identity=$1 AND terminal='RUN_REJECTED' \
                 ORDER BY result_identity LIMIT 1",
            )
            .bind(&request_identity)
            .fetch_one(&backtest)
            .await
            .expect("same-request sealed RUN_REJECTED Result");
        let distinct_attempt_snapshot_barrier = tokio::sync::Barrier::new(2);
        let (first_during_distinct, rejected) = tokio::join!(
            owner.close_negative_protected_attempt_with_snapshot_barrier_v1(
                ProtectedReplayResultLocatorV1 {
                    result_identity: &result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &attempt_identity,
                },
                &distinct_attempt_snapshot_barrier,
            ),
            owner.close_negative_protected_attempt_with_snapshot_barrier_v1(
                ProtectedReplayResultLocatorV1 {
                    result_identity: &rejected_result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &rejected_attempt_identity,
                },
                &distinct_attempt_snapshot_barrier,
            )
        );
        assert_eq!(
            first_during_distinct.expect("first attempt remains byte-identical during contention"),
            first
        );
        let rejected = rejected.expect("same request concurrent second attempt closure");
        assert_eq!(
            rejected.status(),
            ProtectedAttemptDispositionStatusV1::ReplayRejected
        );
        assert_eq!(
            rejected.holdout_closure_disposition(),
            HoldoutClosureDispositionV1::Consumed
        );
        let rejected_retry = owner
            .close_negative_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                result_identity: &rejected_result_identity,
                request_identity: &request_identity,
                attempt_identity: &rejected_attempt_identity,
            })
            .await
            .expect("same request second attempt exact retry");
        assert_eq!(rejected_retry, rejected);
        let same_request_counts: (i64, i64, i64, i64, i64, i64, bool, bool) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE request_identity=$1), \
             (SELECT count(*) FROM public.qualification_holdout_closures_v1 WHERE reservation_identity=$2), \
             (SELECT count(*) FROM public.qualification_protected_attempt_disposition_receipts_v1 receipt JOIN public.qualification_protected_attempt_dispositions_v1 disposition USING(disposition_identity) WHERE disposition.request_identity=$1), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 event JOIN public.qualification_protected_attempt_dispositions_v1 disposition ON disposition.disposition_identity=event.aggregate_identity WHERE disposition.request_identity=$1 AND event.event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1'), \
             (SELECT count(*) FROM public.qualification_public_status_facts_v1 fact JOIN public.qualification_protected_replay_requests_v1 request ON request.review_request_identity=fact.review_request_identity WHERE request.request_identity=$1 AND fact.phase_sequence=3), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 event JOIN public.qualification_public_status_facts_v1 fact ON fact.fact_identity=event.aggregate_identity JOIN public.qualification_protected_replay_requests_v1 request ON request.review_request_identity=fact.review_request_identity WHERE request.request_identity=$1 AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1'), \
             NOT EXISTS (SELECT 1 FROM public.qualification_eligibility_facts_v1), \
             NOT EXISTS (SELECT 1 FROM public.qualification_owner_outbox_v1 WHERE event_kind ILIKE '%ELIGIBILITY%')",
        )
        .bind(&request_identity)
        .bind(first.disposition().holdout_reservation_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("same request and reservation close every negative attempt");
        assert_eq!(same_request_counts, (2, 2, 2, 2, 1, 1, true, true));
        let public_terminal_after: serde_json::Value = sqlx::query_scalar(
            "SELECT pg_catalog.jsonb_build_object( \
               'fact',pg_catalog.to_jsonb(fact), \
               'head',pg_catalog.to_jsonb(head), \
               'event',pg_catalog.to_jsonb(event)) \
             FROM public.qualification_protected_replay_requests_v1 request \
             JOIN public.qualification_public_status_facts_v1 fact \
               ON fact.review_request_identity=request.review_request_identity \
              AND fact.phase_sequence=3 \
             JOIN public.qualification_public_status_heads_v1 head \
               ON head.review_request_identity=fact.review_request_identity \
              AND head.fact_identity=fact.fact_identity \
              AND head.fact_digest=fact.fact_digest \
              AND head.phase_sequence=fact.phase_sequence \
             JOIN public.qualification_owner_outbox_v1 event \
               ON event.aggregate_identity=fact.fact_identity \
              AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1' \
             WHERE request.request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("preserved first negative public terminal custody");
        assert_eq!(public_terminal_after, public_terminal_before);
        assert!(
            owner
                .close_negative_protected_attempt_v1(ProtectedReplayResultLocatorV1 {
                    result_identity: &rejected_result_identity,
                    request_identity: &request_identity,
                    attempt_identity: &attempt_identity,
                })
                .await
                .is_err()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM public.qualification_protected_attempt_dispositions_v1 WHERE request_identity=$1",
            )
            .bind(&request_identity)
            .fetch_one(&owner.pool)
            .await
            .expect("cross-attempt rejection preserves disposition count"),
            2
        );
        let frozen_request = decode_protected_replay_request_v1(&original_request.0)
            .expect("frozen request for terminal-source negative oracles");
        let request_receipt_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("frozen request receipt for terminal-source negative oracles");
        let request_receipt = decode_request_receipt_v1(&request_receipt_json, &frozen_request)
            .expect("canonical request receipt for terminal-source negative oracles");
        let request_locator = ProtectedReplayRequestLocatorV1 {
            request_identity: frozen_request.request_identity().to_string(),
            request_digest: frozen_request.request_digest().to_string(),
            receipt_identity: request_receipt.receipt_identity().to_string(),
            seal_digest: request_receipt.seal_digest().to_string(),
        };
        let request_dto = frozen_request.as_contract_dto();
        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1",
        )
        .bind(&request_dto.review_request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("intake for terminal-source negative oracles");
        let intake = decode_intake_receipt_v1(&intake_json)
            .expect("canonical intake for terminal-source negative oracles");
        let treatment = preregistered_holdout_treatment_v1(
            intake.protected_decision_policy_identity(),
            intake.protected_decision_policy_version(),
        )
        .expect("preregistered treatment for terminal-source negative oracles");

        for (
            native_source_identity,
            native_source_digest,
            committed_at_delta,
            request_delta,
            candidate_delta,
        ) in [
            (
                None,
                Some("sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
                0_i64,
                None,
                None,
            ),
            (None, None, 1, None, None),
            (
                Some("qualification-protected-eligibility-fact-v1-missing"),
                None,
                0,
                None,
                None,
            ),
            (
                Some("qualification-protected-attempt-disposition-v2-missing"),
                None,
                0,
                None,
                None,
            ),
            (None, None, 0, Some("cross-request"), None),
            (None, None, 0, None, Some("cross-candidate")),
        ] {
            let mut transaction = owner
                .pool
                .begin()
                .await
                .expect("negative oracle transaction");
            sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                .execute(&mut *transaction)
                .await
                .expect("negative oracle isolation");
            let mut current = verify_public_status_history_in_transaction(
                &mut transaction,
                &request_dto.review_request_identity,
                &request_dto.candidate_identity,
            )
            .await
            .expect("canonical public history for negative oracle")
            .expect("terminal public head for negative oracle");

            if let Some(identity) = native_source_identity {
                current.native_source_identity = identity.to_string();
            }

            if let Some(digest) = native_source_digest {
                current.native_source_digest = digest.to_string();
            }
            current.committed_at_epoch_ms = current
                .committed_at_epoch_ms
                .checked_add_signed(committed_at_delta)
                .expect("bounded negative oracle time");
            let mut checked_request = request_dto.clone();
            if let Some(identity) = request_delta {
                checked_request.request_identity = identity.to_string();
            }

            if let Some(identity) = candidate_delta {
                checked_request.candidate_identity = identity.to_string();
            }
            assert!(matches!(
                verify_existing_attempt_public_terminal_source_v1(
                    &mut transaction,
                    &checked_request,
                    &request_locator,
                    &treatment,
                    &current,
                )
                .await
                .map_err(NegativeClosureAttemptError::into_public),
                Err(QualificationOwnerError::ConflictingIdentity)
            ));
            transaction
                .rollback()
                .await
                .expect("negative oracle rollback");
        }

        let mut outbox_tamper = owner.pool.begin().await.expect("outbox tamper transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *outbox_tamper)
            .await
            .expect("outbox tamper isolation");
        let current = verify_public_status_history_in_transaction(
            &mut outbox_tamper,
            &request_dto.review_request_identity,
            &request_dto.candidate_identity,
        )
        .await
        .expect("canonical public history before outbox tamper")
        .expect("terminal public head before outbox tamper");
        sqlx::query(
            "UPDATE public.qualification_owner_outbox_v1 SET payload_digest='sha256:tampered' WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_ATTEMPT_DISPOSITION_COMMITTED_V1'",
        )
        .bind(&current.native_source_identity)
        .execute(&mut *outbox_tamper)
        .await
        .expect("tamper mutable prior disposition outbox in rollback transaction");
        assert!(matches!(
            verify_existing_attempt_public_terminal_source_v1(
                &mut outbox_tamper,
                &request_dto,
                &request_locator,
                &treatment,
                &current,
            )
            .await
            .map_err(NegativeClosureAttemptError::into_public),
            Err(QualificationOwnerError::ConflictingIdentity)
        ));
        outbox_tamper
            .rollback()
            .await
            .expect("restore prior disposition outbox by rollback");

        for statement in [
            "UPDATE public.qualification_protected_attempt_dispositions_v1 SET disposition_json=disposition_json WHERE disposition_identity=$1",
            "UPDATE public.qualification_protected_attempt_disposition_receipts_v1 SET receipt_json=receipt_json WHERE disposition_identity=$1",
        ] {
            let error = sqlx::query(statement)
                .bind(first.disposition_identity())
                .execute(&owner.pool)
                .await
                .expect_err("runtime writer cannot tamper append-only prior disposition custody");
            assert_eq!(
                error.as_database_error().and_then(|value| value.code()),
                Some(std::borrow::Cow::Borrowed("42501"))
            );
        }
        let error = sqlx::query(
            "SELECT disposition_identity FROM public.qualification_protected_attempt_dispositions_v1 LIMIT 1",
        )
        .execute(&backtest)
        .await
        .expect_err("Backtest cannot read Qualification disposition custody");
        assert_eq!(
            error.as_database_error().and_then(|value| value.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );
    }

    #[tokio::test]
    #[ignore = "requires the ordered canonical Owner PostgreSQL gate after the READY terminal lineages"]
    async fn protected_replay_request_sets_seal_every_terminal_lineage_and_close_registration() {
        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");

        for lineage in PROTECTED_TERMINAL_LINEAGES_V1 {
            Box::pin(seal_protected_request_set_for_lineage(
                &owner, &backtest, lineage,
            ))
            .await;
        }
    }

    /// Freezes one current request per plan cell of a lineage, seals the complete set with its
    /// frozen economic policy, and proves the registration fence the seal closes.
    async fn seal_protected_request_set_for_lineage(
        owner: &PostgresQualificationOwnerV1,
        backtest: &PgPool,
        lineage: &str,
    ) {
        use crate::protected_replay_request::{
            ProtectedReplayRequestProposalV1, ProtectedReplayRequestProposalV2,
        };
        use vibe_data::owner::sealed_acceptance::issue_protected_evaluation_shared_time_v1;

        let intake = admitted_intake_for_lineage(&owner.pool, lineage).await;
        let source = authority_source_for_intake(owner, &intake).await;
        let bindings = chain_protected_bindings(&source);
        let shared_time =
            issue_protected_evaluation_shared_time_v1().expect("sealed acceptance Shared Time");
        let proposal_for = |request_identity: String, ordinal: u32, bindings: Vec<_>| {
            ProtectedReplayRequestProposalV1::new(
                request_identity,
                intake.review_request_identity().to_string(),
                intake.receipt_identity().to_string(),
                intake.receipt_digest().to_string(),
                ordinal,
                bindings,
            )
            .expect("canonical protected proposal")
        };

        let cell_count = source.plan_cells.len();
        assert!(
            cell_count > 1,
            "the gate plan must carry more than one cell"
        );
        let mut request_identities = Vec::with_capacity(cell_count);
        for ordinal in 0..cell_count {
            let request_identity = format!(
                "qualification-protected-request-v2-{ordinal}-{}",
                intake.receipt_identity()
            );
            let proposal = ProtectedReplayRequestProposalV2::new(
                proposal_for(
                    request_identity.clone(),
                    u32::try_from(ordinal).expect("bounded cell ordinal"),
                    bindings.clone(),
                ),
                shared_time.request_head(),
            );
            let first = owner
                .submit_protected_replay_request_v2(&proposal)
                .await
                .expect("current protected request commit");
            let retry = owner
                .submit_protected_replay_request_v2(&proposal)
                .await
                .expect("current protected request response-loss retry");
            assert_eq!(first, retry);
            let custody: (i64, i64, i64, String, String) = sqlx::query_as(
                "SELECT \
                 (SELECT count(*) FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1), \
                 (SELECT count(*) FROM public.qualification_protected_replay_request_receipts_v1 WHERE request_identity=$1), \
                 (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='QUALIFICATION_PROTECTED_REPLAY_REQUEST_FROZEN_V1'), \
                 (SELECT request_json->>'schema_version' FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1), \
                 (SELECT request_json#>>'{request_time_evidence,stage}' FROM public.qualification_protected_replay_requests_v1 WHERE request_identity=$1)",
            )
            .bind(&request_identity)
            .fetch_one(&owner.pool)
            .await
            .expect("current protected request custody");
            assert_eq!(custody, (1, 1, 1, "2".to_string(), "REQUEST".to_string()));
            request_identities.push(request_identity);
        }
        let mut changed_bindings = bindings.clone();
        changed_bindings[2].digest = format!("sha256:{}", "f".repeat(64));
        assert!(matches!(
            owner
                .submit_protected_replay_request_v2(&ProtectedReplayRequestProposalV2::new(
                    proposal_for(request_identities[0].clone(), 0, changed_bindings),
                    shared_time.request_head(),
                ))
                .await,
            Err(QualificationOwnerError::ConflictingIdentity)
        ));
        let evaluating: (i64, String) = sqlx::query_as(
            "SELECT head.phase_sequence,fact.status \
             FROM public.qualification_public_status_heads_v1 head \
             JOIN public.qualification_public_status_facts_v1 fact \
               ON fact.fact_identity=head.fact_identity AND fact.fact_digest=head.fact_digest \
             WHERE head.review_request_identity=$1",
        )
        .bind(intake.review_request_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("gate lineage review public status");
        assert_eq!(evaluating, (2, "EVALUATING".to_string()));

        let policy = chain_economic_policy(&source);
        let sealed = owner
            .seal_protected_replay_request_set_v1(
                intake.review_request_identity(),
                intake.receipt_identity(),
                &policy,
            )
            .await
            .expect("complete current request set seal");
        let members = &sealed.seal().members;
        assert_eq!(members.len(), cell_count);
        let mut sealed_identities = members
            .iter()
            .map(|member| member.request_identity.clone())
            .collect::<Vec<_>>();
        sealed_identities.sort();
        let mut expected_identities = request_identities.clone();
        expected_identities.sort();
        assert_eq!(sealed_identities, expected_identities);
        assert_eq!(
            sealed.seal().holdout_reservation_identity,
            intake
                .holdout_reservation_identity()
                .expect("ADMITTED reservation")
        );
        let retry = owner
            .seal_protected_replay_request_set_v1(
                intake.review_request_identity(),
                intake.receipt_identity(),
                &policy,
            )
            .await
            .expect("request set seal response-loss retry");
        assert_eq!(retry, sealed);

        let mut changed_policy = policy.clone();
        changed_policy.threshold_raw += 1;
        let changed_policy = changed_policy.seal().expect("changed policy seals");
        assert!(matches!(
            owner
                .seal_protected_replay_request_set_v1(
                    intake.review_request_identity(),
                    intake.receipt_identity(),
                    &changed_policy,
                )
                .await,
            Err(QualificationOwnerError::ConflictingIdentity)
        ));

        for late in [
            owner
                .submit_protected_replay_request_v2(&ProtectedReplayRequestProposalV2::new(
                    proposal_for(
                        format!(
                            "qualification-protected-late-request-v2-{}",
                            intake.receipt_identity()
                        ),
                        0,
                        bindings.clone(),
                    ),
                    shared_time.request_head(),
                ))
                .await
                .map(|_| ()),
            owner
                .submit_protected_replay_request_v1(&proposal_for(
                    format!(
                        "qualification-protected-late-request-v1-{}",
                        intake.receipt_identity()
                    ),
                    0,
                    bindings.clone(),
                ))
                .await
                .map(|_| ()),
        ] {
            assert!(matches!(
                late,
                Err(QualificationOwnerError::Unavailable(message))
                    if message == "Protected Replay Request registration is closed by the request-set seal"
            ));
        }
        let counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_replay_request_sets_v1 WHERE request_set_identity=$1), \
             (SELECT count(*) FROM public.qualification_protected_replay_request_sets_v1 WHERE plan_cell_set_identity=$2), \
             (SELECT count(*) FROM public.qualification_protected_economic_policy_bundles_v1 WHERE request_set_identity=$1 AND bundle_identity=$3), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind IN ('QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_SEALED_V1','QUALIFICATION_PROTECTED_REPLAY_REQUEST_SET_CUSTODY_V1')), \
             (SELECT count(*) FROM public.qualification_protected_replay_requests_v1 WHERE intake_receipt_identity=$4 AND request_json->>'schema_version'='2')",
        )
        .bind(sealed.request_set_identity())
        .bind(&source.plan_cell_set_identity)
        .bind(&policy.bundle_identity)
        .bind(intake.receipt_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("request set aggregate counts");
        assert_eq!(
            counts,
            (
                1,
                1,
                1,
                2,
                i64::try_from(cell_count).expect("bounded cell count")
            )
        );
        let error = sqlx::query(
            "UPDATE public.qualification_protected_replay_request_sets_v1 SET storage_digest=storage_digest WHERE request_set_identity=$1",
        )
        .bind(sealed.request_set_identity())
        .execute(&owner.pool)
        .await
        .expect_err("runtime writer cannot tamper append-only request set custody");
        assert_eq!(
            error.as_database_error().and_then(|value| value.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );

        let mut backtest_transaction = backtest.begin().await.expect("Backtest transaction");
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *backtest_transaction)
            .await
            .expect("serializable request set read");
        let locked: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT qualification_api.lock_protected_replay_request_set_v1($1,$2)",
        )
        .bind(sealed.request_set_identity())
        .bind(sealed.request_set_digest())
        .fetch_one(&mut *backtest_transaction)
        .await
        .expect("sealed Backtest request set read");
        // Not `is_some()`: see the sibling read above. A refusal object is Some too.
        let locked = locked.expect("sealed Backtest request set read returns an envelope");
        assert!(
            locked.get("refusal").is_none(),
            "sealed envelope expected; this read was refused as {:?}",
            locked.get("refusal")
        );
        backtest_transaction
            .rollback()
            .await
            .expect("Backtest rollback");
    }

    #[tokio::test]
    #[ignore = "requires the ordered canonical Owner PostgreSQL gate after the sealed Backtest attempt frontiers"]
    async fn protected_assessments_close_every_terminal_once_and_project_public_status() {
        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let backtest_url =
            std::env::var("BACKTEST_TEST_DATABASE_URL").expect("explicit disposable Backtest URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let backtest = PgPool::connect(&backtest_url).await.expect("Backtest pool");

        for (lineage, terminal) in [
            ("economic-pass", ProtectedTerminalV1::Qualified),
            ("economic-failure", ProtectedTerminalV1::Ineligible),
            ("all-not-applicable", ProtectedTerminalV1::AssessmentInvalid),
        ] {
            Box::pin(close_protected_terminal_for_lineage(
                &owner, &backtest, lineage, terminal,
            ))
            .await;
        }
    }

    /// The three protected terminals a complete sealed attempt frontier can close into. Each one
    /// is the categorical outcome of one frozen census; the caller never chooses it, the sealed
    /// per-cell evidence does.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum ProtectedTerminalV1 {
        Qualified,
        Ineligible,
        AssessmentInvalid,
    }

    /// One closed protected terminal, projected onto the fields every terminal shares.
    struct ClosedProtectedTerminalV1 {
        assessment_identity: String,
        assessment_status: &'static str,
        /// The native fact the public terminal cites: an Eligibility Fact, or the attempt
        /// disposition when no Eligibility Fact exists.
        native_source_identity: String,
        eligibility_identity: Option<String>,
        public_status: &'static str,
        outbox_event_kind: &'static str,
    }

    /// Closes one lineage's complete sealed frontier into its exact terminal, proving the other
    /// closures are rejected before and after, the commit is retry-exact, and the public terminal
    /// carries no protected detail.
    async fn close_protected_terminal_for_lineage(
        owner: &PostgresQualificationOwnerV1,
        backtest: &PgPool,
        lineage: &str,
        terminal: ProtectedTerminalV1,
    ) {
        use crate::{ProtectedAssessmentStatusV1, ProtectedEligibilityStatusV1};
        use vibe_data::owner::sealed_acceptance::issue_protected_evaluation_shared_time_v1;

        // Backtest custody and Qualification custody are read under their own identities: the
        // sealed request set names this lineage, and Backtest answers only about the frontier.
        let (request_set_identity, request_set_digest, review_request_identity): (
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT request_set_identity,request_set_digest,review_request_identity \
             FROM public.qualification_protected_replay_request_sets_v1 \
             WHERE review_request_identity LIKE 'qualification-review-' || $1 || '-%' \
             ORDER BY committed_at_epoch_ms DESC,request_set_identity DESC LIMIT 1",
        )
        .bind(lineage)
        .fetch_one(&owner.pool)
        .await
        .expect("sealed request set of this gate lineage");
        let (frontier_identity, frontier_digest, receipt_identity, receipt_digest): (
            String,
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT frontier.frontier_identity,frontier.frontier_digest,receipt.receipt_identity,receipt.receipt_digest \
             FROM public.backtest_protected_replay_attempt_frontiers_v1 frontier \
             JOIN public.backtest_protected_replay_attempt_frontier_receipts_v1 receipt USING(frontier_identity) \
             WHERE frontier.request_set_identity=$1 AND frontier.request_set_digest=$2 \
             ORDER BY frontier.committed_at_epoch_ms DESC,frontier.frontier_identity DESC LIMIT 1",
        )
        .bind(&request_set_identity)
        .bind(&request_set_digest)
        .fetch_one(backtest)
        .await
        .expect("sealed Backtest attempt frontier of this gate lineage");
        let frontier_locator = ProtectedReplayAttemptFrontierLocatorV1 {
            frontier_identity: frontier_identity.clone(),
            frontier_digest: frontier_digest.clone(),
            receipt_identity,
            receipt_digest,
        };
        let intake_json: serde_json::Value = sqlx::query_scalar(
            "SELECT receipt_json FROM public.qualification_candidate_intake_receipts_v1 WHERE review_request_identity=$1",
        )
        .bind(&review_request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("sealed request set intake");
        let intake = decode_intake_receipt_v1(&intake_json).expect("canonical intake");
        let source = authority_source_for_intake(owner, &intake).await;
        let shared_time =
            issue_protected_evaluation_shared_time_v1().expect("sealed acceptance Shared Time");
        let successor = shared_time.assessment_successor();

        // The sealed per-cell evidence admits exactly one terminal: the other two closures reject
        // this frontier and leave no assessment behind, and no closure accepts a changed frontier
        // digest.
        for rejected in [
            ProtectedTerminalV1::Qualified,
            ProtectedTerminalV1::Ineligible,
            ProtectedTerminalV1::AssessmentInvalid,
        ] {
            let mut locator = frontier_locator.clone();

            if rejected == terminal {
                locator.frontier_digest = format!("blake3:{}", "f".repeat(64));
            }
            let closed = match rejected {
                ProtectedTerminalV1::Qualified => owner
                    .close_economic_pass_assessment_v1(&locator, &successor)
                    .await
                    .map(|_| ()),
                ProtectedTerminalV1::Ineligible => owner
                    .close_economic_failure_assessment_v1(&locator, &successor)
                    .await
                    .map(|_| ()),
                ProtectedTerminalV1::AssessmentInvalid => owner
                    .close_all_not_applicable_assessment_v1(&locator, &successor)
                    .await
                    .map(|_| ()),
            };
            assert!(closed.is_err());
        }
        let premature: (i64, i64) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_robustness_assessments_v1 WHERE attempt_frontier_identity=$1), \
             (SELECT count(*) FROM public.qualification_eligibility_facts_v1 WHERE candidate_identity=$2)",
        )
        .bind(&frontier_identity)
        .bind(intake.candidate_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("no assessment before the admitted closure");
        assert_eq!(premature, (0, 0));

        let closed = match terminal {
            ProtectedTerminalV1::Qualified => {
                let first = owner
                    .close_economic_pass_assessment_v1(&frontier_locator, &successor)
                    .await
                    .expect("economic pass assessment commit");
                assert_eq!(first.status(), ProtectedEligibilityStatusV1::Qualified);
                assert_eq!(
                    first.assessment_status(),
                    ProtectedAssessmentStatusV1::CompletePass
                );
                assert_eq!(
                    first.qualified_capacity_ceiling(),
                    Some(source.preregistered_capacity_ceiling)
                );
                assert_eq!(
                    owner
                        .close_economic_pass_assessment_v1(&frontier_locator, &successor)
                        .await
                        .expect("economic pass assessment response-loss retry"),
                    first
                );
                ClosedProtectedTerminalV1 {
                    assessment_identity: first.assessment_identity().to_string(),
                    assessment_status: "COMPLETE_PASS",
                    native_source_identity: first.eligibility_identity().to_string(),
                    eligibility_identity: Some(first.eligibility_identity().to_string()),
                    public_status: "QUALIFIED",
                    outbox_event_kind: "QUALIFICATION_PROTECTED_QUALIFIED_COMMITTED_V1",
                }
            }
            ProtectedTerminalV1::Ineligible => {
                let first = owner
                    .close_economic_failure_assessment_v1(&frontier_locator, &successor)
                    .await
                    .expect("economic failure assessment commit");
                assert_eq!(first.status(), ProtectedEligibilityStatusV1::Ineligible);
                assert_eq!(
                    first.assessment_status(),
                    ProtectedAssessmentStatusV1::CompleteFail
                );
                assert_eq!(
                    owner
                        .close_economic_failure_assessment_v1(&frontier_locator, &successor)
                        .await
                        .expect("economic failure assessment response-loss retry"),
                    first
                );
                ClosedProtectedTerminalV1 {
                    assessment_identity: first.assessment_identity().to_string(),
                    assessment_status: "COMPLETE_FAIL",
                    native_source_identity: first.eligibility_identity().to_string(),
                    eligibility_identity: Some(first.eligibility_identity().to_string()),
                    public_status: "CLOSED_NOT_QUALIFIED",
                    outbox_event_kind: "QUALIFICATION_PROTECTED_INELIGIBLE_COMMITTED_V1",
                }
            }
            ProtectedTerminalV1::AssessmentInvalid => {
                let first = owner
                    .close_all_not_applicable_assessment_v1(&frontier_locator, &successor)
                    .await
                    .expect("all-not-applicable assessment commit");
                assert_eq!(
                    first.status(),
                    ProtectedAssessmentStatusV1::IncompleteInvalid
                );
                assert_eq!(
                    first.holdout_closure_disposition(),
                    HoldoutClosureDispositionV1::Consumed
                );
                assert_eq!(
                    owner
                        .close_all_not_applicable_assessment_v1(&frontier_locator, &successor)
                        .await
                        .expect("all-not-applicable assessment response-loss retry"),
                    first
                );
                ClosedProtectedTerminalV1 {
                    assessment_identity: first.assessment_identity().to_string(),
                    assessment_status: "INCOMPLETE_INVALID",
                    native_source_identity: first.disposition_identity().to_string(),
                    eligibility_identity: None,
                    public_status: "CLOSED_NOT_QUALIFIED",
                    outbox_event_kind: "QUALIFICATION_PROTECTED_ASSESSMENT_INVALID_COMMITTED_V1",
                }
            }
        };

        // The committed terminal is final for this frontier: a later closure of any kind, this one
        // included under a different name, cannot reinterpret the frozen census.
        for rejected in [
            ProtectedTerminalV1::Qualified,
            ProtectedTerminalV1::Ineligible,
            ProtectedTerminalV1::AssessmentInvalid,
        ] {
            if rejected == terminal {
                continue;
            }
            let closed = match rejected {
                ProtectedTerminalV1::Qualified => owner
                    .close_economic_pass_assessment_v1(&frontier_locator, &successor)
                    .await
                    .map(|_| ()),
                ProtectedTerminalV1::Ineligible => owner
                    .close_economic_failure_assessment_v1(&frontier_locator, &successor)
                    .await
                    .map(|_| ()),
                ProtectedTerminalV1::AssessmentInvalid => owner
                    .close_all_not_applicable_assessment_v1(&frontier_locator, &successor)
                    .await
                    .map(|_| ()),
            };
            assert!(closed.is_err());
        }
        let eligibility_rows = i64::from(closed.eligibility_identity.is_some());
        let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT \
             (SELECT count(*) FROM public.qualification_protected_robustness_assessments_v1 WHERE attempt_frontier_identity=$1), \
             (SELECT count(*) FROM public.qualification_protected_robustness_assessments_v1 WHERE assessment_identity=$2 AND status=$3), \
             (SELECT count(*) FROM public.qualification_eligibility_facts_v1 WHERE candidate_identity=$4), \
             (SELECT count(*) FROM public.qualification_eligibility_fact_receipts_v1 eligibility_receipt JOIN public.qualification_eligibility_facts_v1 eligibility USING(eligibility_identity) WHERE eligibility.assessment_identity=$2), \
             (SELECT count(*) FROM public.qualification_holdout_closures_v2 closure JOIN public.qualification_protected_attempt_dispositions_v2 disposition USING(disposition_identity) WHERE disposition.assessment_identity=$2), \
             (SELECT count(*) FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$5 AND event_kind=$6)",
        )
        .bind(&frontier_identity)
        .bind(&closed.assessment_identity)
        .bind(closed.assessment_status)
        .bind(intake.candidate_identity())
        .bind(&closed.native_source_identity)
        .bind(closed.outbox_event_kind)
        .fetch_one(&owner.pool)
        .await
        .expect("closed terminal aggregate counts");
        assert_eq!(
            counts,
            (
                1,
                1,
                eligibility_rows,
                eligibility_rows,
                1 - eligibility_rows,
                1
            )
        );

        let public_terminal: serde_json::Value = sqlx::query_scalar(
            "SELECT pg_catalog.jsonb_build_object( \
               'fact',pg_catalog.to_jsonb(fact), \
               'head',pg_catalog.to_jsonb(head), \
               'event',pg_catalog.to_jsonb(event)) \
             FROM public.qualification_public_status_facts_v1 fact \
             JOIN public.qualification_public_status_heads_v1 head \
               ON head.review_request_identity=fact.review_request_identity \
              AND head.fact_identity=fact.fact_identity \
              AND head.fact_digest=fact.fact_digest \
              AND head.phase_sequence=fact.phase_sequence \
             JOIN public.qualification_owner_outbox_v1 event \
               ON event.aggregate_identity=fact.fact_identity \
              AND event.event_kind='QUALIFICATION_PUBLIC_STATUS_TERMINAL_V1' \
             WHERE fact.review_request_identity=$1 AND fact.phase_sequence=3",
        )
        .bind(&review_request_identity)
        .fetch_one(&owner.pool)
        .await
        .expect("closed public terminal custody");
        assert_eq!(
            public_terminal["fact"]["status"],
            serde_json::json!(closed.public_status)
        );
        assert_eq!(
            public_terminal["fact"]["native_source_identity"],
            serde_json::json!(closed.native_source_identity)
        );
        assert_eq!(
            public_terminal["fact"]["candidate_identity"],
            serde_json::json!(intake.candidate_identity())
        );
        let public_bytes = serde_json::to_vec(&public_terminal).expect("public terminal bytes");

        for forbidden in [
            closed.assessment_status,
            "observed_raw",
            "plan_cell",
            "measurement",
            "census",
            "INELIGIBLE",
            "ASSESSMENT_INVALID",
        ] {
            assert!(
                !String::from_utf8_lossy(&public_bytes).contains(forbidden),
                "public terminal custody leaks protected detail: {forbidden}"
            );
        }

        if let Some(eligibility_identity) = &closed.eligibility_identity {
            for statement in [
                "UPDATE public.qualification_eligibility_facts_v1 SET eligibility_json=eligibility_json WHERE eligibility_identity=$1",
                "UPDATE public.qualification_eligibility_fact_receipts_v1 SET receipt_json=receipt_json WHERE eligibility_identity=$1",
            ] {
                let error = sqlx::query(statement)
                    .bind(eligibility_identity)
                    .execute(&owner.pool)
                    .await
                    .expect_err("runtime writer cannot tamper append-only Eligibility custody");
                assert_eq!(
                    error.as_database_error().and_then(|value| value.code()),
                    Some(std::borrow::Cow::Borrowed("42501"))
                );
            }
            // Append-only means the fact cannot be removed either, not just that it
            // cannot be edited. This Owner is granted SELECT and INSERT on
            // `qualification_eligibility_facts_v1` and nothing else, so the delete is
            // refused for want of the privilege rather than by a rule that a later
            // migration could drop.
            //
            // The statement literal has to sit inside this call. The chain's
            // destructive-SQL guard strips `assert_statement_is_refused(...)` and judges
            // what is left, so hoisting the string to a binding would keep the literal,
            // lose the marker, and be refused by the guard - deliberately, because a
            // guard should fail loudly rather than pass a file that merely contains one
            // sanctioned call somewhere else.
            vibe_testkit::postgres::assert_statement_is_refused(
                &owner.pool,
                &format!(
                    "DELETE FROM public.qualification_eligibility_facts_v1 WHERE eligibility_identity='{eligibility_identity}'"
                ),
                "42501",
            )
            .await;
        }
        let error = sqlx::query(
            "UPDATE public.qualification_protected_robustness_assessments_v1 SET assessment_json=assessment_json WHERE assessment_identity=$1",
        )
        .bind(&closed.assessment_identity)
        .execute(&owner.pool)
        .await
        .expect_err("runtime writer cannot tamper append-only assessment custody");
        assert_eq!(
            error.as_database_error().and_then(|value| value.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );
        let error = sqlx::query(
            "SELECT assessment_identity FROM public.qualification_protected_robustness_assessments_v1 LIMIT 1",
        )
        .execute(backtest)
        .await
        .expect_err("Backtest cannot read Qualification assessment custody");
        assert_eq!(
            error.as_database_error().and_then(|value| value.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );
    }
    #[tokio::test]
    #[ignore = "requires the ordered canonical Owner PostgreSQL gate after the stale-frontier lineage"]
    async fn protected_feedback_projection_readback_fails_closed_on_corruption_and_writes_nothing()
    {
        let qualification_url = std::env::var("QUALIFICATION_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification URL");
        let rd_url =
            std::env::var("RD_OWNER_TEST_DATABASE_URL").expect("explicit disposable R&D Owner URL");
        let owner = PostgresQualificationOwnerV1::connect(&qualification_url)
            .await
            .expect("Qualification topology");
        let rd = PgPool::connect(&rd_url).await.expect("R&D Owner pool");

        // The inadequate-plan lineage's basis carries a projection R&D obtained through
        // Qualification's sealed admission API and no admitted protected attempt, so this entry can
        // renew and corrupt its custody without touching a lineage the terminal entries own. Its
        // review request and its Research request share the gate suffix, the only correlation
        // Qualification can follow without a raw R&D read.
        let review_request_identity: String = sqlx::query_scalar(
            "SELECT review_request_identity FROM public.qualification_candidate_intake_receipts_v1 \
             WHERE review_request_identity LIKE 'qualification-review-inadequate-plan-%' \
             ORDER BY committed_at_epoch_ms DESC LIMIT 1",
        )
        .fetch_one(&owner.pool)
        .await
        .expect("inadequate-plan lineage intake");
        let suffix = review_request_identity
            .strip_prefix("qualification-review-inadequate-plan-")
            .expect("gate lineage suffix")
            .to_string();
        let request_identity = format!("repair-replay-research-{suffix}");
        let basis_row = sqlx::query(
            "SELECT basis_identity,basis_digest,principal,request_scope_json \
             FROM public.rd_independence_bases_v1 WHERE request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(&rd)
        .await
        .expect("R&D Independence Basis of this gate lineage");
        let locator = RdIndependenceBasisLocatorV1 {
            basis_identity: basis_row.try_get("basis_identity").expect("basis identity"),
            basis_digest: basis_row.try_get("basis_digest").expect("basis digest"),
            request_identity,
            principal: basis_row.try_get("principal").expect("basis principal"),
            request_scope: serde_json::from_value(
                basis_row
                    .try_get::<serde_json::Value, _>("request_scope_json")
                    .expect("basis request scope"),
            )
            .expect("canonical request scope"),
        };
        let scope_key =
            principal_scope_key(&locator.principal, &locator.request_scope).expect("scope key");
        // Taken before this entry writes anything, so a row it disturbs cannot already be inside
        // the baseline.
        let schema_before = qualification_schema_row_counts(&owner.pool).await;
        let own_counts = |pool: PgPool, basis_identity: String, scope_key: String| async move {
            // This entry writes into custody the gate shares, so "nothing was written" is proved
            // by this basis's own counts before and after, never by a global emptiness.
            sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT \
                 (SELECT count(*) FROM public.qualification_protected_feedback_projections_v1 WHERE basis_identity=$1), \
                 (SELECT count(*) FROM public.qualification_protected_feedback_heads_v1 WHERE principal_scope_key=$2), \
                 (SELECT count(*) FROM public.qualification_owner_outbox_v1 event WHERE EXISTS (SELECT 1 FROM public.qualification_protected_feedback_projections_v1 projection WHERE projection.projection_identity=event.aggregate_identity AND projection.basis_identity=$1))",
            )
            .bind(basis_identity)
            .bind(scope_key)
            .fetch_one(&pool)
            .await
            .expect("own protected-feedback custody counts")
        };
        let before = own_counts(
            owner.pool.clone(),
            locator.basis_identity.clone(),
            scope_key.clone(),
        )
        .await;
        assert_eq!(before, (1, 1, 1));

        // Qualification already holds this basis's projection: R&D obtained it through the sealed
        // admission API while forming the TrialFamily policy. A resolve is therefore an exact
        // replay that writes nothing. Neither the create nor the renewal path is reachable from
        // *this* entry, because this basis already has its frontier, and a projection's stored
        // validity cannot be aged without breaking the canonical row it is part of; the
        // response-cut rollback stays unproven here by construction.
        let projection = owner
            .resolve_for_basis(&locator)
            .await
            .expect("stored projection readback")
            .expect("R&D-admitted projection");
        assert_eq!(projection.basis_identity(), locator.basis_identity);
        assert_eq!(projection.principal(), locator.principal);
        // The create branch did run, earlier in this gate, and this is where its committed shape
        // is read back. `GENESIS_EMPTY` is written by that branch alone - `resolution_name` maps
        // exactly two variants - and the branch fixes the rest of the shape with it: sequence
        // zero, the canonical genesis cut, and no source frontier. Asserting the four together
        // fails if a renewal ever reaches this lineage, and fails if the genesis constants drift.
        // What it does not prove is the branch's condition, that a frontier commits only on an
        // empty history; driving that needs an entry whose own basis has none.
        assert_eq!(
            projection.resolution(),
            ProtectedFeedbackResolutionV1::GenesisEmpty
        );
        assert_eq!(projection.source_sequence(), 0);
        assert_eq!(
            projection.source_cut(),
            "qualification-protected-feedback-cut-v1-0"
        );
        assert_eq!(
            (
                projection.source_frontier_identity(),
                projection.source_frontier_digest()
            ),
            (None, None)
        );
        assert!(
            verify_projection_freshness(&projection, projection.projection_at_epoch_ms()).is_ok()
        );
        assert!(
            verify_projection_freshness(&projection, projection.valid_through_epoch_ms()).is_err()
        );
        assert_eq!(
            projection.valid_through_epoch_ms(),
            projection.projection_at_epoch_ms() + PROJECTION_VALIDITY_MS
        );
        assert_eq!(
            projection.receipt().committed_at_epoch_ms(),
            projection.projection_at_epoch_ms()
        );
        assert_eq!(
            owner
                .resolve_or_create_for_basis(&locator)
                .await
                .expect("exact replay"),
            projection
        );
        assert_eq!(
            own_counts(
                owner.pool.clone(),
                locator.basis_identity.clone(),
                scope_key.clone()
            )
            .await,
            before
        );

        // A corrupted head and a corrupted projection event each fail the readback closed; every
        // tamper is restored exactly and read back before the next one.
        let head_digest: String = sqlx::query_scalar(
            "SELECT frontier_digest FROM public.qualification_protected_feedback_heads_v1 WHERE principal_scope_key=$1",
        )
        .bind(&scope_key)
        .fetch_one(&owner.pool)
        .await
        .expect("current head digest");
        sqlx::query(
            "UPDATE public.qualification_protected_feedback_heads_v1 SET frontier_digest='sha256:corrupt' WHERE principal_scope_key=$1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .expect("corrupt the head");
        // Capture, restore, then assert. Asserting here would skip the restoration on exactly the
        // run that matters - a readback that wrongly succeeds is the regression this entry exists
        // to catch, and panicking before the restore would leave the corrupted digest in a chain
        // database that is shared and never reset, so the first failure a reader sees would be
        // some later entry with no apparent cause.
        let corrupted_head_readback = owner.resolve_for_basis(&locator).await;
        sqlx::query(
            "UPDATE public.qualification_protected_feedback_heads_v1 SET frontier_digest=$2 WHERE principal_scope_key=$1",
        )
        .bind(&scope_key)
        .bind(&head_digest)
        .execute(&owner.pool)
        .await
        .expect("restore the head exactly");
        assert!(corrupted_head_readback.is_err());
        assert_eq!(
            owner
                .resolve_for_basis(&locator)
                .await
                .expect("readback after exact head restoration"),
            Some(projection.clone())
        );

        let event_digest: String = sqlx::query_scalar(
            "SELECT payload_digest FROM public.qualification_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(projection.projection_identity())
        .fetch_one(&owner.pool)
        .await
        .expect("current projection event digest");
        sqlx::query(
            "UPDATE public.qualification_owner_outbox_v1 SET payload_digest='sha256:tampered' WHERE aggregate_identity=$1",
        )
        .bind(projection.projection_identity())
        .execute(&owner.pool)
        .await
        .expect("corrupt the projection event");
        let corrupted_event_readback = owner.resolve_for_basis(&locator).await;
        sqlx::query(
            "UPDATE public.qualification_owner_outbox_v1 SET payload_digest=$2 WHERE aggregate_identity=$1",
        )
        .bind(projection.projection_identity())
        .bind(&event_digest)
        .execute(&owner.pool)
        .await
        .expect("restore the projection event exactly");
        assert!(corrupted_event_readback.is_err());
        assert_eq!(
            owner
                .resolve_for_basis(&locator)
                .await
                .expect("readback after exact projection event restoration"),
            Some(projection.clone())
        );

        // The R&D source event belongs to R&D, so its tamper and its exact restoration run under
        // the R&D identity.
        let rd_event: (String, String) = sqlx::query_as(
            "SELECT event_identity,payload_digest FROM public.rd_owner_outbox_v1 \
             WHERE aggregate_identity=$1 AND event_kind='INDEPENDENCE_BASIS_PRECOMMITTED_V1'",
        )
        .bind(&locator.basis_identity)
        .fetch_one(&rd)
        .await
        .expect("R&D basis event");
        sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_digest='sha256:corrupt' WHERE event_identity=$1")
            .bind(&rd_event.0)
            .execute(&rd)
            .await
            .expect("corrupt the R&D source event");
        let corrupted_source_readback = owner.resolve_for_basis(&locator).await;
        sqlx::query(
            "UPDATE public.rd_owner_outbox_v1 SET payload_digest=$2 WHERE event_identity=$1",
        )
        .bind(&rd_event.0)
        .bind(&rd_event.1)
        .execute(&rd)
        .await
        .expect("restore the R&D source event exactly");
        assert!(corrupted_source_readback.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT payload_digest FROM public.rd_owner_outbox_v1 WHERE event_identity=$1",
            )
            .bind(&rd_event.0)
            .fetch_one(&rd)
            .await
            .expect("R&D source event readback"),
            rd_event.1
        );
        assert_eq!(
            owner
                .resolve_for_basis(&locator)
                .await
                .expect("readback after exact R&D restoration"),
            Some(projection.clone())
        );

        // Every tamper above was restored exactly and read back, so this entry leaves the shared
        // custody exactly as it found it: its own rows by identity, and every other Qualification
        // relation by row count.
        assert_eq!(
            qualification_schema_row_counts(&owner.pool).await,
            schema_before
        );
        assert_eq!(
            own_counts(owner.pool.clone(), locator.basis_identity, scope_key).await,
            before
        );
    }
}
