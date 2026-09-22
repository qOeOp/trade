//! Append-only PostgreSQL custody for R&D admission of one exact Backtest Result.
//!
//! One admission exists for each admitted Result. A retry that repeats the same operation request
//! reads the committed admission back; a retry that changes the Result digest, the TrialFamily, or
//! the candidate strategy proposal set is a conflict and writes nothing.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};

use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeError, resolve_admission_for_downstream_in_transaction,
};

use crate::{
    iteration_result_admission::{
        ITERATION_RESULT_ADMITTED_EVENT_V1, IterationResultAdmissionErrorV1,
        IterationResultAdmissionInputV1, IterationResultAdmissionLocatorV1,
        IterationResultAdmissionOperationRequestV1, IterationResultAdmissionProposalV1,
        IterationResultAdmissionReadbackV1, IterationResultBudgetBindingV1,
        IterationResultTrialFamilyBindingV1, canonical_digest, ensure_same_admission_request_v1,
        identity, issue_iteration_result_admission_v1, owner_storage_digest,
        project_locked_backtest_result_v1, validate_locator, verify_iteration_result_admission_v1,
    },
    rd_owner_postgres_custody::{
        ExploratoryReplayResultLocatorV2, resolve_exploratory_replay_outcome_for_rd_in_transaction,
    },
    trial_family::TrialFamilyCensusReadbackV2,
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

const ADMISSION_STORAGE_DOMAIN_V1: &str = "rd.iteration-result-admission.storage.v1";
const RECEIPT_STORAGE_DOMAIN_V1: &str = "rd.iteration-result-admission-receipt.storage.v1";
const RESULT_STORAGE_DOMAIN_V1: &str = "vibe.backtest.replay-result-bytes.v1";
const OUTBOX_PAYLOAD_DOMAIN_V1: &str = "rd.iteration-result-admitted.payload.v1";
const OUTBOX_PAYLOAD_STORAGE_DOMAIN_V1: &str = "rd.iteration-result-admitted.payload.storage.v1";
const OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1: &str = "rd.iteration-result-admitted.envelope.storage.v1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] =
    &[crate::schema_materialization::PublicTableSpec {
        name: "rd_iteration_result_admissions_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("admission_identity", "text"),
            crate::schema_materialization::required("admission_digest", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("attempt_identity", "text"),
            crate::schema_materialization::required("admitted_proposal_count", "integer"),
            crate::schema_materialization::required("admission_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("admission_storage_bytes", "bytea"),
            crate::schema_materialization::required("admission_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "p:admission_identity:::false:false:true:",
            "u:admission_digest:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("admission_identity"),
            crate::schema_materialization::unique_index("admission_digest"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    }];

/// Materializes the admission table under exact R&D Owner authority.
///
/// # Errors
///
/// Returns [`IterationResultAdmissionErrorV1::Storage`] if materialization is unavailable.
pub(crate) async fn migrate(pool: &PgPool) -> Result<(), IterationResultAdmissionErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_iteration_result_admissions_v1",
        "CREATE TABLE IF NOT EXISTS public.rd_iteration_result_admissions_v1 (admission_identity TEXT PRIMARY KEY, admission_digest TEXT NOT NULL UNIQUE, trial_family_identity TEXT NOT NULL, result_identity TEXT NOT NULL UNIQUE, request_identity TEXT NOT NULL, attempt_identity TEXT NOT NULL, admitted_proposal_count INTEGER NOT NULL, admission_json JSONB NOT NULL, receipt_json JSONB NOT NULL, admission_storage_bytes BYTEA NOT NULL, admission_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(|e| storage(e.to_string()))?;

    for statement in [
        "ALTER TABLE public.rd_iteration_result_admissions_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_iteration_result_admissions_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

/// Admits one exact Backtest Result and its next-iteration candidate strategy proposal set.
///
/// The caller supplies only the locator, the Result digests it believes it observed, and the
/// proposal set. Every admitted fact is re-read under this transaction's locks: the Result comes
/// from Backtest-owned custody and the budget from the family's sealed policy and committed census.
///
/// # Errors
///
/// Returns [`IterationResultAdmissionErrorV1::Conflict`] when a different admission already exists
/// for the Result, [`IterationResultAdmissionErrorV1::BudgetExceeded`] when the proposal set does
/// not fit the remaining sealed trial budget, and the identity, applicability, or storage error
/// that closed the admission otherwise.
pub(crate) async fn admit_iteration_result_v1(
    pool: &PgPool,
    proposal: &IterationResultAdmissionProposalV1,
) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1> {
    let request = &proposal.operation_request();
    request.validate()?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    lock_admission_key(&mut transaction, &request.locator.result_identity).await?;

    let existing = load_by_result_in_transaction(&mut transaction, &request.locator).await?;

    // The admission is resolved inside the same serializable transaction that holds the Result
    // lock, so a revocation between resolution and mutation cannot slip through. A replay resolves
    // it historically: the committed fact is content-addressed on the request meaning, and
    // re-proving a past authorization against the present cut would make replays expire.
    let admission_cut = current_epoch_ms(&mut transaction).await?;
    let admission = resolve_admission_for_downstream_in_transaction(
        &mut transaction,
        &proposal.admission,
        if existing.is_some() {
            DownstreamAdmissionModeV1::Historical
        } else {
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: admission_cut,
            }
        },
    )
    .await
    .map_err(map_product_edge_error)?;
    verify_iteration_result_admission_v1(&admission, proposal)?;

    if let Some(existing) = existing {
        ensure_same_admission_request_v1(&existing, request)?;
        verify_outbox(&mut transaction, &existing).await?;
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    if !admission.authorizes_first_mutation_at(admission_cut) {
        return Err(IterationResultAdmissionErrorV1::Unavailable(
            "Product Edge iteration-result admission is not current".to_string(),
        ));
    }

    let input = compose_locked_input(&mut transaction, request).await?;
    let committed_at_epoch_ms = current_epoch_ms(&mut transaction).await?;
    if !admission.authorizes_first_mutation_at(committed_at_epoch_ms) {
        return Err(IterationResultAdmissionErrorV1::Unavailable(
            "Product Edge iteration-result admission expired before mutation".to_string(),
        ));
    }
    let issued = issue_iteration_result_admission_v1(request, input, committed_at_epoch_ms)?;
    persist(&mut transaction, &issued).await?;

    let readback = load_by_result_in_transaction(&mut transaction, &request.locator)
        .await?
        .ok_or_else(|| storage("committed iteration result admission is missing"))?;
    if readback != issued {
        return Err(storage("committed iteration result admission changed"));
    }
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// Reads one committed admission back after a lost response.
///
/// This path creates no custody: an absent admission is `None`, never a new admission.
///
/// # Errors
///
/// Returns [`IterationResultAdmissionErrorV1::InvalidLocator`] for a malformed locator and
/// [`IterationResultAdmissionErrorV1::Storage`] when stored custody is incomplete or inconsistent.
pub(crate) async fn resolve_iteration_result_admission_v1(
    pool: &PgPool,
    locator: &IterationResultAdmissionLocatorV1,
) -> Result<Option<IterationResultAdmissionReadbackV1>, IterationResultAdmissionErrorV1> {
    validate_locator(locator)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    let Some(readback) = load_by_result_in_transaction(&mut transaction, locator).await? else {
        transaction.commit().await.map_err(storage)?;
        return Ok(None);
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(storage)?;
    Ok(Some(readback))
}

async fn compose_locked_input(
    transaction: &mut Transaction<'_, Postgres>,
    request: &IterationResultAdmissionOperationRequestV1,
) -> Result<IterationResultAdmissionInputV1, IterationResultAdmissionErrorV1> {
    let locator = &request.locator;
    let locked = resolve_exploratory_replay_outcome_for_rd_in_transaction(
        transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &locator.result_identity,
            request_identity: &locator.request_identity,
            attempt_identity: &locator.attempt_identity,
        },
    )
    .await
    .map_err(|e| IterationResultAdmissionErrorV1::Unavailable(e.to_string()))?
    .ok_or_else(|| {
        IterationResultAdmissionErrorV1::Unavailable(
            "the exact exploratory Backtest Result is unavailable".to_owned(),
        )
    })?;
    let backtest = project_locked_backtest_result_v1(
        locked.replay().result(),
        &owner_storage_digest(
            RESULT_STORAGE_DOMAIN_V1,
            locked.replay().result_canonical_bytes(),
        ),
    )?;

    let census = load_trial_family_census_v2_by_family_in_transaction(
        transaction,
        &locator.trial_family_identity,
    )
    .await
    .map_err(|e| IterationResultAdmissionErrorV1::Unavailable(e.to_string()))?;
    Ok(IterationResultAdmissionInputV1 {
        backtest,
        family: family_binding(&census),
        budget: budget_binding(&census),
        proposals: request.proposals.clone(),
    })
}

fn family_binding(census: &TrialFamilyCensusReadbackV2) -> IterationResultTrialFamilyBindingV1 {
    IterationResultTrialFamilyBindingV1 {
        trial_family_identity: census.legacy_family.root.trial_family_identity().to_owned(),
        census_frontier_identity: census.census_frontier.frontier_identity().to_owned(),
        census_frontier_digest: census.census_frontier.frontier_digest().to_owned(),
        candidate_set_frontier_identity: census
            .candidate_set_frontier
            .frontier_identity()
            .to_owned(),
        candidate_set_frontier_digest: census.candidate_set_frontier.frontier_digest().to_owned(),
        frontier_candidate_identities: census
            .candidate_set_frontier
            .candidates()
            .iter()
            .map(|candidate| candidate.candidate_identity().to_owned())
            .collect(),
    }
}

fn budget_binding(census: &TrialFamilyCensusReadbackV2) -> IterationResultBudgetBindingV1 {
    IterationResultBudgetBindingV1 {
        trial_budget: census.legacy_family.root.policy().trial_budget,
        consumed_trial_budget: census.consumed_trial_budget(),
    }
}

async fn lock_admission_key(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
) -> Result<(), IterationResultAdmissionErrorV1> {
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
        .bind(result_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn current_epoch_ms(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, IterationResultAdmissionErrorV1> {
    let epoch_ms: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    u64::try_from(epoch_ms).map_err(storage)
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationResultAdmissionReadbackV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    let admission = readback.admission();
    let receipt = readback.receipt();
    let locator = admission.locator();
    let admission_bytes = admission.to_canonical_bytes()?;
    let receipt_bytes = receipt.to_canonical_bytes()?;

    sqlx::query("INSERT INTO public.rd_iteration_result_admissions_v1 (admission_identity,admission_digest,trial_family_identity,result_identity,request_identity,attempt_identity,admitted_proposal_count,admission_json,receipt_json,admission_storage_bytes,admission_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
        .bind(admission.admission_identity())
        .bind(admission.admission_digest())
        .bind(&locator.trial_family_identity)
        .bind(&locator.result_identity)
        .bind(&locator.request_identity)
        .bind(&locator.attempt_identity)
        .bind(i32::try_from(receipt.admitted_proposal_count()).map_err(storage)?)
        .bind(serde_json::from_slice::<serde_json::Value>(&admission_bytes).map_err(storage)?)
        .bind(serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?)
        .bind(&admission_bytes)
        .bind(owner_storage_digest(ADMISSION_STORAGE_DOMAIN_V1, &admission_bytes))
        .bind(&receipt_bytes)
        .bind(owner_storage_digest(RECEIPT_STORAGE_DOMAIN_V1, &receipt_bytes))
        .bind(i64::try_from(admission.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    let payload = outbox_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &payload)?;
    let envelope = outbox_envelope(readback, &payload, &payload_digest);
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;

    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(identity("rd-owner-event-v1", &payload_digest))
        .bind(admission.admission_identity())
        .bind(ITERATION_RESULT_ADMITTED_EVENT_V1)
        .bind(&payload_digest)
        .bind(serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(storage)?)
        .bind(&payload_bytes)
        .bind(owner_storage_digest(OUTBOX_PAYLOAD_STORAGE_DOMAIN_V1, &payload_bytes))
        .bind(&envelope_bytes)
        .bind(owner_storage_digest(OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, &envelope_bytes))
        .bind(i64::try_from(admission.committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_by_result_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &IterationResultAdmissionLocatorV1,
) -> Result<Option<IterationResultAdmissionReadbackV1>, IterationResultAdmissionErrorV1> {
    let rows = sqlx::query("SELECT admission_identity,admission_digest,trial_family_identity,result_identity,request_identity,attempt_identity,admitted_proposal_count,admission_json,receipt_json,admission_storage_bytes,admission_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM public.rd_iteration_result_admissions_v1 WHERE result_identity=$1 FOR SHARE")
        .bind(&locator.result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let [row] = rows.as_slice() else {
        if rows.is_empty() {
            return Ok(None);
        }
        return Err(storage("iteration result admission custody is ambiguous"));
    };

    let admission_bytes: Vec<u8> = row.try_get("admission_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    let readback = decode_stored_readback(&admission_bytes, &receipt_bytes)?;
    let admission = readback.admission();
    let stored = admission.locator();

    if row
        .try_get::<String, _>("admission_storage_digest")
        .map_err(storage)?
        != owner_storage_digest(ADMISSION_STORAGE_DOMAIN_V1, &admission_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(RECEIPT_STORAGE_DOMAIN_V1, &receipt_bytes)
        || row
            .try_get::<serde_json::Value, _>("admission_json")
            .map_err(storage)?
            != serde_json::from_slice::<serde_json::Value>(&admission_bytes).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?
        || row
            .try_get::<String, _>("admission_identity")
            .map_err(storage)?
            != admission.admission_identity()
        || row
            .try_get::<String, _>("admission_digest")
            .map_err(storage)?
            != admission.admission_digest()
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != stored.trial_family_identity
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != stored.result_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != stored.request_identity
        || row
            .try_get::<String, _>("attempt_identity")
            .map_err(storage)?
            != stored.attempt_identity
        || row
            .try_get::<i32, _>("admitted_proposal_count")
            .map_err(storage)?
            != i32::try_from(readback.receipt().admitted_proposal_count()).map_err(storage)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(admission.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage(
            "iteration result admission row storage is inconsistent",
        ));
    }

    if stored.result_identity != locator.result_identity
        || stored.request_identity != locator.request_identity
        || stored.attempt_identity != locator.attempt_identity
        || stored.trial_family_identity != locator.trial_family_identity
    {
        return Err(IterationResultAdmissionErrorV1::Conflict);
    }
    Ok(Some(readback))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredAdmissionV1 {
    schema_version: u16,
    admission_identity: String,
    admission_digest: String,
    locator: IterationResultAdmissionLocatorV1,
    input: IterationResultAdmissionInputV1,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredAdmissionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    admission_identity: String,
    admission_digest: String,
    trial_family_identity: String,
    result_identity: String,
    admitted_proposal_count: u32,
    committed_at_epoch_ms: u64,
}

fn decode_stored_readback(
    admission_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1> {
    let stored: StoredAdmissionV1 = serde_json::from_slice(admission_bytes).map_err(storage)?;
    let stored_receipt: StoredAdmissionReceiptV1 =
        serde_json::from_slice(receipt_bytes).map_err(storage)?;
    if stored.schema_version != 1 || stored_receipt.schema_version != 1 {
        return Err(storage("stored iteration result admission schema changed"));
    }
    let request = IterationResultAdmissionOperationRequestV1 {
        locator: stored.locator,
        result_digest: stored.input.backtest.result_digest.clone(),
        request_meaning_digest: stored.input.backtest.request_meaning_digest.clone(),
        proposals: stored.input.proposals.clone(),
    };
    let expected =
        issue_iteration_result_admission_v1(&request, stored.input, stored.committed_at_epoch_ms)?;
    let receipt = expected.receipt();

    if stored.admission_identity != expected.admission().admission_identity()
        || stored.admission_digest != expected.admission().admission_digest()
        || stored_receipt.receipt_identity != receipt.receipt_identity()
        || stored_receipt.receipt_digest != receipt.receipt_digest()
        || stored_receipt.admission_identity != expected.admission().admission_identity()
        || stored_receipt.admission_digest != expected.admission().admission_digest()
        || stored_receipt.trial_family_identity != request.locator.trial_family_identity
        || stored_receipt.result_identity != request.locator.result_identity
        || stored_receipt.admitted_proposal_count != receipt.admitted_proposal_count()
        || stored_receipt.committed_at_epoch_ms != expected.admission().committed_at_epoch_ms()
    {
        return Err(storage(
            "stored iteration result admission positive changed",
        ));
    }
    Ok(expected)
}

#[derive(Serialize)]
struct ResultAdmittedPayloadV1 {
    schema_version: u16,
    admission_identity: String,
    admission_digest: String,
    receipt_identity: String,
    receipt_digest: String,
    trial_family_identity: String,
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    candidate_set_frontier_identity: String,
    candidate_set_frontier_digest: String,
    generation_rule_identity: String,
    generation_rule_digest: String,
    admitted_proposal_count: u32,
    remaining_trial_budget: u32,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ResultAdmittedEnvelopeV1<'a> {
    event_identity: String,
    aggregate_identity: String,
    event_kind: &'a str,
    payload_digest: &'a str,
    payload: &'a ResultAdmittedPayloadV1,
    committed_at_epoch_ms: u64,
}

fn outbox_payload(readback: &IterationResultAdmissionReadbackV1) -> ResultAdmittedPayloadV1 {
    let admission = readback.admission();
    let receipt = readback.receipt();
    let locator = admission.locator();
    let input = admission.input();
    ResultAdmittedPayloadV1 {
        schema_version: 1,
        admission_identity: admission.admission_identity().to_owned(),
        admission_digest: admission.admission_digest().to_owned(),
        receipt_identity: receipt.receipt_identity().to_owned(),
        receipt_digest: receipt.receipt_digest().to_owned(),
        trial_family_identity: locator.trial_family_identity.clone(),
        result_identity: locator.result_identity.clone(),
        request_identity: locator.request_identity.clone(),
        attempt_identity: locator.attempt_identity.clone(),
        census_frontier_identity: input.family.census_frontier_identity.clone(),
        census_frontier_digest: input.family.census_frontier_digest.clone(),
        candidate_set_frontier_identity: input.family.candidate_set_frontier_identity.clone(),
        candidate_set_frontier_digest: input.family.candidate_set_frontier_digest.clone(),
        generation_rule_identity: input.proposals.generation_rule_identity.clone(),
        generation_rule_digest: input.proposals.generation_rule_digest.clone(),
        admitted_proposal_count: receipt.admitted_proposal_count(),
        remaining_trial_budget: input.budget.remaining_trial_budget(),
        committed_at_epoch_ms: admission.committed_at_epoch_ms(),
    }
}

fn outbox_envelope<'a>(
    readback: &IterationResultAdmissionReadbackV1,
    payload: &'a ResultAdmittedPayloadV1,
    payload_digest: &'a str,
) -> ResultAdmittedEnvelopeV1<'a> {
    ResultAdmittedEnvelopeV1 {
        event_identity: identity("rd-owner-event-v1", payload_digest),
        aggregate_identity: readback.admission().admission_identity().to_owned(),
        event_kind: ITERATION_RESULT_ADMITTED_EVENT_V1,
        payload_digest,
        payload,
        committed_at_epoch_ms: readback.admission().committed_at_epoch_ms(),
    }
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &IterationResultAdmissionReadbackV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    let admission = readback.admission();
    let rows = sqlx::query("SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(admission.admission_identity())
        .bind(ITERATION_RESULT_ADMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let [row] = rows.as_slice() else {
        return Err(storage(
            "iteration result admission outbox is missing or ambiguous",
        ));
    };

    let payload = outbox_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &payload)?;
    let envelope = outbox_envelope(readback, &payload, &payload_digest);
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(storage)?;

    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != identity("rd-owner-event-v1", &payload_digest)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != admission.admission_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != ITERATION_RESULT_ADMITTED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(storage)?
        || row
            .try_get::<Vec<u8>, _>("canonical_payload_bytes")
            .map_err(storage)?
            != payload_bytes
        || row
            .try_get::<String, _>("canonical_payload_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(OUTBOX_PAYLOAD_STORAGE_DOMAIN_V1, &payload_bytes)
        || row
            .try_get::<Vec<u8>, _>("canonical_envelope_bytes")
            .map_err(storage)?
            != envelope_bytes
        || row
            .try_get::<String, _>("canonical_envelope_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, &envelope_bytes)
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(admission.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage(
            "iteration result admission outbox custody mismatch",
        ));
    }
    Ok(())
}

fn storage(error: impl Display) -> IterationResultAdmissionErrorV1 {
    IterationResultAdmissionErrorV1::Storage(error.to_string())
}

fn map_product_edge_error(error: ProductEdgeError) -> IterationResultAdmissionErrorV1 {
    match error {
        ProductEdgeError::Storage(message) => IterationResultAdmissionErrorV1::Storage(message),
        ProductEdgeError::InvalidProposal(message) => {
            IterationResultAdmissionErrorV1::Unavailable(message.to_string())
        }
        ProductEdgeError::ConflictingReplay => IterationResultAdmissionErrorV1::Unavailable(
            "Product Edge iteration-result admission conflicts with committed meaning".to_string(),
        ),
        ProductEdgeError::Unavailable(detail) => IterationResultAdmissionErrorV1::Unavailable(
            format!("Product Edge iteration-result admission is unavailable: {detail}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_product_edge::ProductEdgeAdmissionLocatorV1;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use crate::iteration_result_admission::tests::{
        admission_fixture, seeded_admission_fixture, seeded_admission_request_fixture,
    };

    const OUTBOX_DDL: &str = "CREATE TABLE rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, canonical_payload_bytes BYTEA, canonical_payload_storage_digest TEXT, canonical_envelope_bytes BYTEA, canonical_envelope_storage_digest TEXT, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))";

    #[rstest]
    fn the_outbox_event_carries_one_frozen_kind_and_the_exact_admission_identities() {
        let readback = admission_fixture();
        let payload = outbox_payload(&readback);
        let digest = canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &payload).expect("payload digest");
        let envelope = outbox_envelope(&readback, &payload, &digest);

        assert_eq!(envelope.event_kind, ITERATION_RESULT_ADMITTED_EVENT_V1);
        assert_eq!(
            envelope.aggregate_identity,
            readback.admission().admission_identity()
        );
        assert_eq!(
            envelope.event_identity,
            identity("rd-owner-event-v1", &digest)
        );
        assert_eq!(
            payload.admitted_proposal_count,
            readback.receipt().admitted_proposal_count()
        );
        assert_eq!(
            payload.remaining_trial_budget,
            readback.admission().input().budget.remaining_trial_budget()
        );
        assert_eq!(
            payload.candidate_set_frontier_digest,
            readback
                .admission()
                .input()
                .family
                .candidate_set_frontier_digest
        );
    }

    #[rstest]
    fn the_outbox_payload_digest_changes_with_every_projected_admission_fact() {
        let readback = admission_fixture();
        let baseline =
            canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &outbox_payload(&readback)).expect("digest");

        let mut tampered = outbox_payload(&readback);
        tampered.admitted_proposal_count += 1;
        assert_ne!(
            baseline,
            canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &tampered).expect("digest")
        );

        let mut tampered = outbox_payload(&readback);
        tampered.remaining_trial_budget += 1;
        assert_ne!(
            baseline,
            canonical_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &tampered).expect("digest")
        );
    }

    #[rstest]
    fn stored_bytes_reconstruct_the_positive_readback_and_reject_tamper() {
        let readback = admission_fixture();
        let admission_bytes = readback
            .admission()
            .to_canonical_bytes()
            .expect("canonical admission bytes");
        let receipt_bytes = readback
            .receipt()
            .to_canonical_bytes()
            .expect("canonical receipt bytes");

        assert_eq!(
            decode_stored_readback(&admission_bytes, &receipt_bytes).expect("exact stored custody"),
            readback
        );

        let mut admission_value: serde_json::Value =
            serde_json::from_slice(&admission_bytes).expect("stored admission JSON");
        admission_value["input"]["budget"]["consumed_trial_budget"] = serde_json::json!(1);
        let tampered = serde_json::to_vec(&admission_value).expect("tampered admission bytes");
        assert!(matches!(
            decode_stored_readback(&tampered, &receipt_bytes),
            Err(IterationResultAdmissionErrorV1::Storage(_))
        ));

        let mut receipt_value: serde_json::Value =
            serde_json::from_slice(&receipt_bytes).expect("stored receipt JSON");
        receipt_value["admitted_proposal_count"] = serde_json::json!(9);
        let tampered_receipt = serde_json::to_vec(&receipt_value).expect("tampered receipt bytes");
        assert!(matches!(
            decode_stored_readback(&admission_bytes, &tampered_receipt),
            Err(IterationResultAdmissionErrorV1::Storage(_))
        ));
    }

    #[rstest]
    fn a_stored_proposal_set_that_no_longer_fits_its_budget_cannot_be_read_back() {
        let readback = admission_fixture();
        let receipt_bytes = readback
            .receipt()
            .to_canonical_bytes()
            .expect("canonical receipt bytes");
        let mut admission_value: serde_json::Value = serde_json::from_slice(
            &readback
                .admission()
                .to_canonical_bytes()
                .expect("canonical admission bytes"),
        )
        .expect("stored admission JSON");
        admission_value["input"]["budget"]["trial_budget"] = serde_json::json!(3);
        admission_value["input"]["budget"]["consumed_trial_budget"] = serde_json::json!(3);
        let starved = serde_json::to_vec(&admission_value).expect("starved admission bytes");

        assert!(matches!(
            decode_stored_readback(&starved, &receipt_bytes),
            Err(IterationResultAdmissionErrorV1::BudgetExceeded)
        ));
    }

    async fn prepare_admission_custody() -> (CanonicalOwnerPostgresTestDatabaseV1, PgPool) {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let pool = database
            .mutation()
            .pool(CanonicalOwnerTestRoleV1::RdOwner)
            .clone();
        // A store the deployment has already materialized carries both relations and is past the
        // cutover, where `rd_owner` holds no CREATE on public and materialization is refused by
        // design. Creating them again there is neither possible nor wanted; a fresh store still
        // needs both. Either way the readback below is what decides the schema is exact.
        let materialized: bool = sqlx::query_scalar(
            "SELECT pg_catalog.to_regclass('public.rd_owner_outbox_v1') IS NOT NULL
                AND pg_catalog.to_regclass('public.rd_iteration_result_admissions_v1') IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("materialization state");

        if materialized {
            crate::schema_materialization::require_existing_public_tables(&pool, TABLES)
                .await
                .expect("exact admission schema");
        } else {
            sqlx::query(OUTBOX_DDL)
                .execute(&pool)
                .await
                .expect("R&D outbox");
            migrate(&pool).await.expect("admission schema");
            crate::schema_materialization::verify_materialized_public_tables(&pool, TABLES)
                .await
                .expect("exact admission schema");
        }
        (database, pool)
    }

    /// Bootstraps one Product Edge admission that authorizes exactly this request.
    ///
    /// Each distinct request needs its own admission: the Owner verifies that the resolved
    /// admission's payload equals the request it is about to commit, so one admission cannot
    /// authorize a changed meaning.
    async fn admitted(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        request: IterationResultAdmissionOperationRequestV1,
    ) -> IterationResultAdmissionProposalV1 {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let (locator, _) = crate::product_edge_postgres::tests::bootstrap_operation_admission(
            crate::product_edge_postgres::tests::BootstrapAdmissionTopology::Existing {
                operator_authorization_database_url: database
                    .database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
                product_edge_database_url: database
                    .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            },
            &request.locator.result_identity,
            suffix,
            crate::product_edge_postgres::tests::BootstrapAdmittedOperationV1 {
                operation: crate::iteration_result_admission::ITERATION_RESULT_ADMISSION_OPERATION_V1,
                operation_schema:
                    crate::iteration_result_admission::ITERATION_RESULT_ADMISSION_SCHEMA_V1,
                effect:
                    crate::iteration_result_admission::ITERATION_RESULT_ADMISSION_MUTATION_EFFECT_V1,
                typed_payload: serde_json::to_value(&request).expect("typed admission payload"),
            },
        )
        .await;
        request
            .with_admission(locator)
            .expect("the bootstrapped admission authorizes this request")
    }

    async fn commit_admission(pool: &PgPool, readback: &IterationResultAdmissionReadbackV1) {
        let mut transaction = pool.begin().await.expect("admission transaction");
        persist(&mut transaction, readback)
            .await
            .expect("committed admission custody");
        transaction.commit().await.expect("admission commit");
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn a_committed_admission_is_read_back_by_its_locator_and_never_created_by_one() {
        let (_database, pool) = prepare_admission_custody().await;
        // Each durable test carries its own locator: the chain shares one store, so an assertion
        // about "the" admission table would be an assertion about its neighbours.
        let readback = seeded_admission_fixture("readback");
        let locator = readback.admission().locator().clone();

        assert!(
            resolve_iteration_result_admission_v1(&pool, &locator)
                .await
                .expect("absent admission resolves")
                .is_none()
        );
        let absent_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.rd_iteration_result_admissions_v1
              WHERE trial_family_identity=$1",
        )
        .bind(&locator.trial_family_identity)
        .fetch_one(&pool)
        .await
        .expect("admission count");
        assert_eq!(absent_count, 0);

        commit_admission(&pool, &readback).await;
        assert_eq!(
            resolve_iteration_result_admission_v1(&pool, &locator)
                .await
                .expect("committed admission resolves")
                .expect("committed admission is present"),
            readback
        );
    }

    /// Not selected by the ordered chain, and the reason is the Product Edge seam, not this test.
    ///
    /// It is the only durable admission proof that needs a Product Edge admission, and
    /// `bootstrap_operation_admission` raises its own genesis under a fresh deployment identity.
    /// That is right for a private store and wrong for the chain's shared one, where a genesis
    /// already exists: the admission is written under one deployment and resolved under another, so
    /// the Owner correctly reports it unavailable. Selecting it would report that gap as this
    /// proof's failure. The gap is that the iteration-result operation has no Product Edge seam
    /// yet; its `..._OPERATION_V1`, `..._MUTATION_EFFECT_V1` and `..._SCHEMA_V1` constants still
    /// have no production consumer.
    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn a_retry_reads_the_committed_admission_back_and_a_changed_request_conflicts() {
        let (database, pool) = prepare_admission_custody().await;
        let readback = seeded_admission_fixture("retry");
        commit_admission(&pool, &readback).await;

        let retried = Box::pin(admit_iteration_result_v1(
            &pool,
            &admitted(&database, seeded_admission_request_fixture("retry")).await,
        ))
        .await
        .expect("retry reads the committed admission back");
        assert_eq!(retried, readback);

        let mut changed = seeded_admission_request_fixture("retry");
        changed.proposals.proposals.truncate(1);
        changed.proposals.expected_cardinality = 1;
        // A changed meaning needs its own admission; the committed fact still refuses it.
        let changed = admitted(&database, changed).await;
        assert!(matches!(
            Box::pin(admit_iteration_result_v1(&pool, &changed)).await,
            Err(IterationResultAdmissionErrorV1::Conflict)
        ));

        let locator = readback.admission().locator().clone();
        let admissions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.rd_iteration_result_admissions_v1
              WHERE trial_family_identity=$1",
        )
        .bind(&locator.trial_family_identity)
        .fetch_one(&pool)
        .await
        .expect("admission count");
        let events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rd_owner_outbox_v1
              WHERE event_kind=$1 AND aggregate_identity=$2",
        )
        .bind(ITERATION_RESULT_ADMITTED_EVENT_V1)
        .bind(readback.admission().admission_identity())
        .fetch_one(&pool)
        .await
        .expect("outbox count");
        assert_eq!((admissions, events), (1, 1));
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn a_locator_from_another_experiment_never_reads_this_admission_back() {
        let (_database, pool) = prepare_admission_custody().await;
        let readback = seeded_admission_fixture("foreign-locator");
        commit_admission(&pool, &readback).await;

        let mut foreign = readback.admission().locator().clone();
        foreign.trial_family_identity = "rd-trial-family-2".to_owned();
        assert!(matches!(
            resolve_iteration_result_admission_v1(&pool, &foreign).await,
            Err(IterationResultAdmissionErrorV1::Conflict)
        ));

        let mut unknown = readback.admission().locator().clone();
        unknown.result_identity = "backtest-result-2".to_owned();
        assert!(
            resolve_iteration_result_admission_v1(&pool, &unknown)
                .await
                .expect("unknown Result resolves")
                .is_none()
        );
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn row_scalar_storage_or_outbox_tamper_closes_the_readback() {
        let (_database, pool) = prepare_admission_custody().await;
        let readback = seeded_admission_fixture("tamper");
        let locator = readback.admission().locator().clone();
        commit_admission(&pool, &readback).await;

        sqlx::query(
            "UPDATE public.rd_iteration_result_admissions_v1 SET admitted_proposal_count=9 WHERE result_identity=$1",
        )
        .bind(&locator.result_identity)
        .execute(&pool)
        .await
        .expect("scalar tamper fixture");
        assert!(matches!(
            resolve_iteration_result_admission_v1(&pool, &locator).await,
            Err(IterationResultAdmissionErrorV1::Storage(_))
        ));
        sqlx::query(
            "UPDATE public.rd_iteration_result_admissions_v1 SET admitted_proposal_count=$2 WHERE result_identity=$1",
        )
        .bind(&locator.result_identity)
        .bind(i32::from(
            u8::try_from(readback.receipt().admitted_proposal_count()).expect("fixture count"),
        ))
        .execute(&pool)
        .await
        .expect("scalar restore");
        assert!(
            resolve_iteration_result_admission_v1(&pool, &locator)
                .await
                .expect("restored admission resolves")
                .is_some()
        );

        sqlx::query("UPDATE rd_owner_outbox_v1 SET payload_digest=$2 WHERE aggregate_identity=$1")
            .bind(readback.admission().admission_identity())
            .bind(format!("sha256:{}", "f".repeat(64)))
            .execute(&pool)
            .await
            .expect("outbox tamper fixture");
        assert!(matches!(
            resolve_iteration_result_admission_v1(&pool, &locator).await,
            Err(IterationResultAdmissionErrorV1::Storage(_))
        ));
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn a_malformed_request_never_reaches_owner_custody() {
        let (_database, pool) = prepare_admission_custody().await;
        let mut malformed = seeded_admission_request_fixture("malformed");
        malformed.locator.result_identity = "backtest result 1".to_owned();
        let trial_family_identity = malformed.locator.trial_family_identity.clone();
        // A malformed request cannot even become a proposal, so it never reaches an admission,
        // a transaction or the Owner.
        assert!(matches!(
            malformed.with_admission(ProductEdgeAdmissionLocatorV1 {
                request_identity: "backtest result 1".to_owned(),
                admission_identity: "iteration-result-admission-1".to_owned(),
                admission_digest: format!("sha256:{}", "b".repeat(64)),
            }),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.rd_iteration_result_admissions_v1
              WHERE trial_family_identity=$1",
        )
        .bind(&trial_family_identity)
        .fetch_one(&pool)
        .await
        .expect("admission count");
        assert_eq!(count, 0);
    }
}
