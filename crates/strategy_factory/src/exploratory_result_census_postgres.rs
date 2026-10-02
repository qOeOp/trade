//! Every exploratory Result R&D admits is a trial its TrialFamily census counts.
//!
//! A Result is counted in the R&D transaction that locks it through the Backtest custody
//! adapter, after Backtest has committed it: the Backtest commit is a `backtest_owner` session,
//! the census append is R&D's own canonical encoding, and a successor's commit relock requires
//! the census head it was frozen against, so the count cannot run inside or before that commit.
//! Between the two commits a Result exists uncounted. Every R&D read that shows a Result or what
//! it produced therefore refuses one its census does not count, so a Result someone has seen is
//! one that was counted.

use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use vibe_backtest_owner_contracts::{ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2};

use crate::{
    rd_owner_postgres_custody::{
        BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
        LockedExploratoryReplayResultV2, resolve_exploratory_replay_result_for_rd_in_transaction,
    },
    trial_family::{TrialFamilyAttemptTerminalDispositionV2, TrialFamilyError},
    trial_family_postgres::{
        TrialFamilyAttemptCountV2, TrialFamilyAttemptFactsV2, census_counts_request_in_transaction,
        count_trial_family_attempt_in_transaction,
    },
};

/// Why an exploratory Result was not counted, or not shown.
#[derive(Debug, Error)]
pub enum ExploratoryResultCensusErrorV1 {
    /// The Result exists, but its TrialFamily census does not count its request, so it is not
    /// shown.
    #[error("the exploratory Result is not counted in its TrialFamily census")]
    NotCounted,
    /// The Backtest Owner holds no Result at this locator.
    #[error("the exploratory Result is absent")]
    ResultAbsent,
    /// Backtest custody refused or could not answer the Result read.
    #[error("Backtest Result custody failed: {0}")]
    Custody(#[from] BacktestResultCustodyErrorV2),
    /// The Result is not an exploratory one.
    #[error("the Result is not exploratory")]
    NotExploratory,
    /// The sealed Replay request the Result answers is missing, or does not verify against it.
    #[error("the Replay request the Result answers is unavailable: {0}")]
    RequestUnavailable(&'static str),
    /// The census could not be read or advanced.
    #[error("the TrialFamily census is unavailable: {0}")]
    Census(#[from] TrialFamilyError),
    /// The R&D transaction could not be opened, read or committed.
    #[error("R&D storage is unavailable: {0}")]
    Storage(String),
}

impl ExploratoryResultCensusErrorV1 {
    /// The code a consumer receives.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::NotCounted => "EXPLORATORY_RESULT_NOT_COUNTED",
            Self::ResultAbsent | Self::Custody(_) => "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE",
            Self::NotExploratory => "EXPLORATORY_RESULT_NOT_EXPLORATORY",
            Self::RequestUnavailable(_) => "EXPLORATORY_RESULT_REQUEST_UNAVAILABLE",
            Self::Census(_) | Self::Storage(_) => "EXPLORATORY_RESULT_CENSUS_UNAVAILABLE",
        }
    }
}

/// The family and Intent a sealed Replay request binds, read from its own canonical bytes.
struct SealedRequestBindingV1 {
    trial_family_identity: String,
    intent_identity: String,
    intent_digest: String,
}

/// Reads the family and Intent of the sealed request a Result answers.
///
/// The row's canonical request bytes are decoded and their meaning digest recomputed, so the
/// binding is proved by the same digest Backtest bound the Result to, whether the request is a
/// legacy or a COMPOSER_V3 one and whether or not its census has since advanced. The statement
/// takes no row lock, so a `READ ONLY` transaction can make it.
async fn read_sealed_request_binding_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    request_meaning_digest: &str,
) -> Result<SealedRequestBindingV1, ExploratoryResultCensusErrorV1> {
    let rows = sqlx::query(
        "SELECT intent_identity,trial_family_identity,v2_canonical_request_bytes,v2_meaning_digest FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 AND request_schema_version=2",
    )
    .bind(request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|e| ExploratoryResultCensusErrorV1::Storage(e.to_string()))?;
    let [row] = rows.as_slice() else {
        return Err(ExploratoryResultCensusErrorV1::RequestUnavailable(
            "sealed Replay request row is missing or ambiguous",
        ));
    };
    let column = |e: sqlx::Error| ExploratoryResultCensusErrorV1::Storage(e.to_string());
    let intent_identity: String = row.try_get("intent_identity").map_err(column)?;
    let trial_family_identity: String = row.try_get("trial_family_identity").map_err(column)?;
    let canonical_bytes: Option<Vec<u8>> =
        row.try_get("v2_canonical_request_bytes").map_err(column)?;
    let stored_meaning_digest: Option<String> = row.try_get("v2_meaning_digest").map_err(column)?;
    let (Some(canonical_bytes), Some(stored_meaning_digest)) =
        (canonical_bytes, stored_meaning_digest)
    else {
        return Err(ExploratoryResultCensusErrorV1::RequestUnavailable(
            "sealed Replay request has no V2 canonical bytes",
        ));
    };
    let request = serde_json::from_slice::<ReplayRequestDtoV2>(&canonical_bytes)
        .ok()
        .and_then(|dto| ReplayRequestV2::try_from(dto).ok())
        .ok_or(ExploratoryResultCensusErrorV1::RequestUnavailable(
            "sealed Replay request bytes do not decode",
        ))?;
    let meaning_digest = request.meaning_digest().map_err(|_| {
        ExploratoryResultCensusErrorV1::RequestUnavailable(
            "sealed Replay request meaning cannot be digested",
        )
    })?;

    if request.to_canonical_bytes().ok().as_deref() != Some(canonical_bytes.as_slice())
        || request.request_identity().as_str() != request_identity
        || meaning_digest.as_str() != request_meaning_digest
        || stored_meaning_digest != request_meaning_digest
        || request.as_dto().frozen_research_intent.identity.as_str() != intent_identity
        || request.as_dto().trial_family.identity.as_str() != trial_family_identity
    {
        return Err(ExploratoryResultCensusErrorV1::RequestUnavailable(
            "sealed Replay request does not verify against the Result",
        ));
    }
    Ok(SealedRequestBindingV1 {
        intent_digest: request
            .as_dto()
            .frozen_research_intent
            .digest
            .as_str()
            .to_owned(),
        trial_family_identity,
        intent_identity,
    })
}

/// Counts one committed exploratory Result in its family's census, in the caller's R&D
/// transaction.
///
/// The Result is locked through the Backtest custody adapter first, as Iteration Result
/// Admission locks it, and the census head after it. The attempt binds the Result's own
/// identities and its terminal, counted one for one. A Result whose request the census already
/// counts is an exact replay: it joins that attempt and writes nothing.
pub(crate) async fn count_exploratory_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<TrialFamilyAttemptCountV2, ExploratoryResultCensusErrorV1> {
    let locked = resolve_exploratory_replay_result_for_rd_in_transaction(transaction, locator)
        .await?
        .ok_or(ExploratoryResultCensusErrorV1::ResultAbsent)?;
    let result = locked.result();

    if result.namespace != ReplayNamespaceV2::Exploratory {
        return Err(ExploratoryResultCensusErrorV1::NotExploratory);
    }
    let request = read_sealed_request_binding_in_transaction(
        transaction,
        result.request_identity.as_str(),
        result.request_meaning_digest.as_str(),
    )
    .await?;
    let now_epoch_ms: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| ExploratoryResultCensusErrorV1::Storage(e.to_string()))?;
    let now_epoch_ms = u64::try_from(now_epoch_ms)
        .map_err(|e| ExploratoryResultCensusErrorV1::Storage(e.to_string()))?;
    Ok(count_trial_family_attempt_in_transaction(
        transaction,
        &request.trial_family_identity,
        TrialFamilyAttemptFactsV2 {
            intent_identity: request.intent_identity,
            intent_digest: request.intent_digest,
            request_identity: result.request_identity.as_str().to_owned(),
            request_digest: result.request_meaning_digest.as_str().to_owned(),
            result_identity: result.result_identity.as_str().to_owned(),
            result_digest: result.result_digest.as_str().to_owned(),
            terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::of_replay_terminal(
                result.terminal,
            ),
        },
        now_epoch_ms,
    )
    .await?)
}

/// Refuses a Result its family's census does not count.
///
/// It reads without a row lock, so the `READ ONLY` transactions of the read API can call it.
pub(crate) async fn require_counted_exploratory_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    request_meaning_digest: &str,
) -> Result<(), ExploratoryResultCensusErrorV1> {
    let request = read_sealed_request_binding_in_transaction(
        transaction,
        request_identity,
        request_meaning_digest,
    )
    .await?;

    if census_counts_request_in_transaction(
        transaction,
        &request.trial_family_identity,
        request_identity,
        request_meaning_digest,
    )
    .await?
    {
        Ok(())
    } else {
        Err(ExploratoryResultCensusErrorV1::NotCounted)
    }
}

/// Reads one complete exploratory Result for display, refusing it unless its census counts it.
pub(crate) async fn resolve_counted_exploratory_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<LockedExploratoryReplayResultV2>, ExploratoryResultCensusErrorV1> {
    let Some(locked) =
        resolve_exploratory_replay_result_for_rd_in_transaction(transaction, locator).await?
    else {
        return Ok(None);
    };
    require_counted_exploratory_result_in_transaction(
        transaction,
        locked.result().request_identity.as_str(),
        locked.result().request_meaning_digest.as_str(),
    )
    .await?;
    Ok(Some(locked))
}
