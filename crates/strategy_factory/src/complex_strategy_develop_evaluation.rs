//! R&D-owned pre-Artifact custody for a complex-strategy develop evaluation.
//!
//! The public proposal and locator are claims only. A positive readback can only be produced after
//! the R&D Owner re-admits current research custody and consumes a Market Data Owner-sealed PIT
//! readback.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_data::owner::pit_snapshot::{PitSnapshotOwnerReadback, UntrustedPitSnapshotLocator};

use crate::{
    complex_strategy_ir::ComplexStrategyIrV1,
    product_edge::{ResearchRequestDisposition, ResearchViewAvailability, ResearchViewPhase},
    rd_owner_postgres_custody::{
        ResearchCustodyLookupV1, VerifiedResearchCustodyV1, admit_research_custody_in_transaction,
    },
};

const EVENT_KIND: &str = "COMPLEX_STRATEGY_DEVELOP_EVALUATION_FROZEN_V1";

/// Untrusted request to freeze one pre-Artifact develop-evaluation meaning.
#[derive(Clone, Debug)]
pub struct UntrustedComplexStrategyDevelopEvaluationProposalV1 {
    research_request_identity: String,
    complex_strategy_ir_bytes: Box<[u8]>,
    pit_locator: UntrustedPitSnapshotLocator,
    predecessor_evaluation_identity: Option<String>,
}

impl UntrustedComplexStrategyDevelopEvaluationProposalV1 {
    pub fn from_untrusted(
        research_request_identity: impl Into<String>,
        complex_strategy_ir_bytes: impl Into<Box<[u8]>>,
        pit_locator: UntrustedPitSnapshotLocator,
        predecessor_evaluation_identity: Option<String>,
    ) -> Self {
        Self {
            research_request_identity: research_request_identity.into(),
            complex_strategy_ir_bytes: complex_strategy_ir_bytes.into(),
            pit_locator,
            predecessor_evaluation_identity,
        }
    }
}

/// Untrusted lookup coordinates. Possession grants no R&D read or write authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedComplexStrategyDevelopEvaluationLocatorV1 {
    pub evaluation_identity: String,
    pub evaluation_digest: String,
}

/// Owner-sealed positive readback. It is deliberately Serialize-only and has private fields.
///
/// ```compile_fail
/// use vibe_strategy_factory::complex_strategy_develop_evaluation::ComplexStrategyDevelopEvaluationReadbackV1;
/// let _: ComplexStrategyDevelopEvaluationReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComplexStrategyDevelopEvaluationReadbackV1 {
    schema_version: u32,
    locator: UntrustedComplexStrategyDevelopEvaluationLocatorV1,
    fact: DevelopEvaluationFactV1,
    receipt: DevelopEvaluationReceiptV1,
}

impl ComplexStrategyDevelopEvaluationReadbackV1 {
    pub const fn locator(&self) -> &UntrustedComplexStrategyDevelopEvaluationLocatorV1 {
        &self.locator
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ComplexStrategyDevelopEvaluationError {
    #[error("R&D research custody is unavailable or not current V2 custody")]
    ResearchCustodyUnavailable,
    #[error("Market Data PIT custody is unavailable")]
    PitCustodyUnavailable,
    #[error("Market Data PIT locator does not match the sealed readback")]
    PitLocatorMismatch,
    #[error("complex strategy IR is invalid: {0}")]
    InvalidIr(String),
    #[error("the proposed evaluation conflicts with frozen custody")]
    ConflictingReplay,
    #[error("the successor does not extend the exact current lineage head")]
    InvalidPredecessor,
    #[error("a successor must change the IR or PIT custody")]
    UnchangedSuccessor,
    #[error("R&D storage unavailable: {0}")]
    Storage(String),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopEvaluationMeaningV1 {
    schema_version: u32,
    research_request: serde_json::Value,
    research_receipt: serde_json::Value,
    research_intent: serde_json::Value,
    research_view: serde_json::Value,
    trial_family: FrozenTrialFamilyCustodyV1,
    complex_strategy_ir_schema: String,
    complex_strategy_ir_schema_version: u32,
    complex_strategy_ir_digest: String,
    complex_strategy_ir_bytes: Vec<u8>,
    pit_readback_digest: String,
    pit_readback: serde_json::Value,
    predecessor_evaluation_identity: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct FrozenTrialFamilyCustodyV1 {
    trial_family_identity: String,
    root_digest: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    census_member_count: usize,
    census_member_digests: Vec<String>,
    readback: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopEvaluationFactV1 {
    schema_version: u32,
    evaluation_identity: String,
    evaluation_digest: String,
    lineage_identity: String,
    meaning: DevelopEvaluationMeaningV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopEvaluationReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    evaluation_identity: String,
    evaluation_digest: String,
    outbox_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopEvaluationOutboxV1<'a> {
    schema_version: u32,
    evaluation_identity: &'a str,
    evaluation_digest: &'a str,
    receipt_identity: &'a str,
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ComplexStrategyDevelopEvaluationError> {
    for statement in [
        "CREATE TABLE IF NOT EXISTS rd_complex_strategy_develop_evaluations_v1 (evaluation_identity TEXT PRIMARY KEY, evaluation_digest TEXT NOT NULL, lineage_identity TEXT NOT NULL, predecessor_evaluation_identity TEXT, ir_digest TEXT NOT NULL, pit_readback_digest TEXT NOT NULL, fact_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_complex_strategy_develop_evaluation_heads_v1 (lineage_identity TEXT PRIMARY KEY, evaluation_identity TEXT NOT NULL REFERENCES rd_complex_strategy_develop_evaluations_v1(evaluation_identity), evaluation_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE UNIQUE INDEX IF NOT EXISTS rd_complex_strategy_develop_evaluation_successors_v1 ON rd_complex_strategy_develop_evaluations_v1 (predecessor_evaluation_identity) WHERE predecessor_evaluation_identity IS NOT NULL",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

pub(crate) async fn freeze(
    pool: &PgPool,
    proposal: UntrustedComplexStrategyDevelopEvaluationProposalV1,
    pit_readback: PitSnapshotOwnerReadback,
) -> Result<ComplexStrategyDevelopEvaluationReadbackV1, ComplexStrategyDevelopEvaluationError> {
    if !pit_readback.is_available() {
        return Err(ComplexStrategyDevelopEvaluationError::PitCustodyUnavailable);
    }

    if pit_readback.locator() != &proposal.pit_locator {
        return Err(ComplexStrategyDevelopEvaluationError::PitLocatorMismatch);
    }

    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&proposal.research_request_identity)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    let custody = admit_research_custody_in_transaction(
        &mut transaction,
        ResearchCustodyLookupV1::RequestV2(&proposal.research_request_identity),
    )
    .await
    .map_err(|e| ComplexStrategyDevelopEvaluationError::Storage(e.to_string()))?
    .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    let lineage_identity = stable_lineage_for_custody(&custody)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&lineage_identity)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    let provisional = prepare_fact(&proposal, &pit_readback, &custody, None)?;
    if provisional.lineage_identity != lineage_identity {
        return Err(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable);
    }

    if let Some(readback) = load_exact(&mut transaction, &provisional).await? {
        revalidate_at_commit_cut(&mut transaction, &proposal, &pit_readback, &provisional).await?;
        transaction.commit().await.map_err(storage)?;
        return Ok(readback);
    }
    verify_successor(&mut transaction, &provisional).await?;
    let (fact, committed_at_epoch_ms) =
        revalidate_at_commit_cut(&mut transaction, &proposal, &pit_readback, &provisional).await?;
    let evaluation_identity = fact.evaluation_identity.clone();
    persist(&mut transaction, fact, committed_at_epoch_ms).await?;
    let readback = load_by_identity(&mut transaction, &evaluation_identity)
        .await?
        .ok_or_else(|| {
            ComplexStrategyDevelopEvaluationError::Storage("committed evaluation missing".into())
        })?;
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

fn prepare_fact(
    proposal: &UntrustedComplexStrategyDevelopEvaluationProposalV1,
    pit_readback: &PitSnapshotOwnerReadback,
    custody: &VerifiedResearchCustodyV1,
    read_cut_epoch_ms: Option<u64>,
) -> Result<DevelopEvaluationFactV1, ComplexStrategyDevelopEvaluationError> {
    let meaning = prepare_meaning(proposal, pit_readback, custody, read_cut_epoch_ms)?;
    let evaluation_digest = digest("rd.develop-evaluation.meaning.v1", &meaning)?;
    let evaluation_identity = identity("rd-develop-evaluation-v1", &evaluation_digest);
    let lineage_identity = stable_lineage_for_custody(custody)?;
    Ok(DevelopEvaluationFactV1 {
        schema_version: 1,
        evaluation_identity,
        evaluation_digest,
        lineage_identity,
        meaning,
    })
}

fn prepare_meaning(
    proposal: &UntrustedComplexStrategyDevelopEvaluationProposalV1,
    pit_readback: &PitSnapshotOwnerReadback,
    custody: &VerifiedResearchCustodyV1,
    read_cut_epoch_ms: Option<u64>,
) -> Result<DevelopEvaluationMeaningV1, ComplexStrategyDevelopEvaluationError> {
    if custody.request_schema_version() != 2
        || custody.receipt().disposition != ResearchRequestDisposition::Accepted
        || custody.receipt().request_identity != proposal.research_request_identity
        || read_cut_epoch_ms.is_some_and(|cut| !custody.authority_available_at(cut))
    {
        return Err(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable);
    }
    let intent = custody
        .intent()
        .filter(|intent| {
            intent.is_v2() && intent.request_identity() == proposal.research_request_identity
        })
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    let view = custody
        .view()
        .filter(|view| {
            view.availability == ResearchViewAvailability::Available
                && view.phase == ResearchViewPhase::IntentFrozen
                && view.request_identity == proposal.research_request_identity
                && view.intent_identity == intent.intent_identity()
        })
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    if read_cut_epoch_ms.is_some_and(|cut| !cut_precedes_expiry(cut, view.valid_through_epoch_ms)) {
        return Err(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable);
    }
    let family = custody
        .family()
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    let request = custody
        .request_json()
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;

    if request
        .pointer("/request/request_identity")
        .or_else(|| request.get("request_identity"))
        .and_then(serde_json::Value::as_str)
        != Some(proposal.research_request_identity.as_str())
    {
        return Err(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable);
    }
    let ir = ComplexStrategyIrV1::try_from((custody, proposal.complex_strategy_ir_bytes.as_ref()))
        .map_err(|e| ComplexStrategyDevelopEvaluationError::InvalidIr(e.to_string()))?;
    let pit_readback_value = serde_json::to_value(pit_readback).map_err(json_storage)?;
    let pit_readback_digest = digest("market-data.pit-owner-readback.v1", &pit_readback_value)?;
    Ok(DevelopEvaluationMeaningV1 {
        schema_version: 1,
        research_request: request.clone(),
        research_receipt: serde_json::to_value(custody.receipt()).map_err(json_storage)?,
        research_intent: serde_json::to_value(intent).map_err(json_storage)?,
        research_view: serde_json::to_value(view).map_err(json_storage)?,
        trial_family: FrozenTrialFamilyCustodyV1 {
            trial_family_identity: family.root().trial_family_identity().to_string(),
            root_digest: family.root().root_digest().to_string(),
            census_frontier_identity: family.census_frontier().frontier_identity().to_string(),
            census_frontier_digest: family.census_frontier().frontier_digest().to_string(),
            census_member_count: family.census_frontier().member_digests().len(),
            census_member_digests: family.census_frontier().member_digests().to_vec(),
            readback: serde_json::to_value(family).map_err(json_storage)?,
        },
        complex_strategy_ir_schema: ir.schema().to_string(),
        complex_strategy_ir_schema_version: ir.schema_version(),
        complex_strategy_ir_digest: ir.semantic_digest().to_string(),
        complex_strategy_ir_bytes: ir.canonical_bytes().to_vec(),
        pit_readback_digest,
        pit_readback: pit_readback_value,
        predecessor_evaluation_identity: proposal.predecessor_evaluation_identity.clone(),
    })
}

async fn load_exact(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &DevelopEvaluationFactV1,
) -> Result<Option<ComplexStrategyDevelopEvaluationReadbackV1>, ComplexStrategyDevelopEvaluationError>
{
    let Some(readback) = load_by_identity(transaction, &expected.evaluation_identity).await? else {
        return Ok(None);
    };

    if &readback.fact != expected {
        return Err(ComplexStrategyDevelopEvaluationError::ConflictingReplay);
    }
    Ok(Some(readback))
}

async fn load_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    evaluation_identity: &str,
) -> Result<Option<ComplexStrategyDevelopEvaluationReadbackV1>, ComplexStrategyDevelopEvaluationError>
{
    let row = sqlx::query("SELECT evaluation_digest, fact_json, receipt_json, committed_at_epoch_ms FROM rd_complex_strategy_develop_evaluations_v1 WHERE evaluation_identity = $1 FOR SHARE")
        .bind(evaluation_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let Some(row) = row else { return Ok(None) };
    let fact_json: serde_json::Value = row.try_get("fact_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let fact: DevelopEvaluationFactV1 = decode(&fact_json)?;
    let receipt: DevelopEvaluationReceiptV1 = decode(&receipt_json)?;
    let row_digest: String = row.try_get("evaluation_digest").map_err(storage)?;
    let row_time: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    if fact.evaluation_identity != evaluation_identity
        || fact.evaluation_digest != row_digest
        || receipt.evaluation_identity != evaluation_identity
        || receipt.evaluation_digest != row_digest
        || i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)? != row_time
        || digest("rd.develop-evaluation.meaning.v1", &fact.meaning)? != row_digest
        || identity("rd-develop-evaluation-v1", &row_digest) != evaluation_identity
    {
        return Err(ComplexStrategyDevelopEvaluationError::Storage(
            "evaluation custody mismatch".into(),
        ));
    }
    let outbox = sqlx::query("SELECT event_identity, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = $2 FOR SHARE")
        .bind(evaluation_identity)
        .bind(EVENT_KIND)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if outbox.len() != 1 {
        return Err(ComplexStrategyDevelopEvaluationError::Storage(
            "evaluation outbox unavailable".into(),
        ));
    }
    let outbox = &outbox[0];
    let payload = DevelopEvaluationOutboxV1 {
        schema_version: 1,
        evaluation_identity,
        evaluation_digest: &row_digest,
        receipt_identity: &receipt.receipt_identity,
    };
    let payload_digest = digest("rd.owner-outbox.payload.v1", &payload)?;
    let payload_json = serde_json::to_value(&payload).map_err(json_storage)?;

    if outbox
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != identity("rd-develop-evaluation-event-v1", evaluation_identity)
        || outbox
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || outbox
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != payload_json
        || outbox
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != row_time
        || receipt.outbox_digest != payload_digest
    {
        return Err(ComplexStrategyDevelopEvaluationError::Storage(
            "evaluation outbox mismatch".into(),
        ));
    }
    Ok(Some(ComplexStrategyDevelopEvaluationReadbackV1 {
        schema_version: 1,
        locator: UntrustedComplexStrategyDevelopEvaluationLocatorV1 {
            evaluation_identity: evaluation_identity.to_string(),
            evaluation_digest: row_digest,
        },
        fact,
        receipt,
    }))
}

async fn verify_successor(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &DevelopEvaluationFactV1,
) -> Result<(), ComplexStrategyDevelopEvaluationError> {
    let head = sqlx::query("SELECT evaluation_identity FROM rd_complex_strategy_develop_evaluation_heads_v1 WHERE lineage_identity = $1 FOR UPDATE")
        .bind(&fact.lineage_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let head_identity = head
        .as_ref()
        .map(|row| row.try_get::<String, _>("evaluation_identity"))
        .transpose()
        .map_err(storage)?;

    if head_identity.as_deref() != fact.meaning.predecessor_evaluation_identity.as_deref() {
        return Err(ComplexStrategyDevelopEvaluationError::InvalidPredecessor);
    }

    if let Some(predecessor) = head_identity {
        let previous = load_by_identity(transaction, &predecessor)
            .await?
            .ok_or(ComplexStrategyDevelopEvaluationError::InvalidPredecessor)?;
        if previous.fact.lineage_identity != fact.lineage_identity {
            return Err(ComplexStrategyDevelopEvaluationError::InvalidPredecessor);
        }

        if !successor_changes_evidence(&previous.fact.meaning, &fact.meaning) {
            return Err(ComplexStrategyDevelopEvaluationError::UnchangedSuccessor);
        }
    }
    Ok(())
}

fn successor_changes_evidence(
    previous: &DevelopEvaluationMeaningV1,
    successor: &DevelopEvaluationMeaningV1,
) -> bool {
    previous.complex_strategy_ir_digest != successor.complex_strategy_ir_digest
        || previous.pit_readback_digest != successor.pit_readback_digest
        || previous.trial_family != successor.trial_family
}

async fn revalidate_at_commit_cut(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &UntrustedComplexStrategyDevelopEvaluationProposalV1,
    pit_readback: &PitSnapshotOwnerReadback,
    provisional: &DevelopEvaluationFactV1,
) -> Result<(DevelopEvaluationFactV1, u64), ComplexStrategyDevelopEvaluationError> {
    let cut = database_cut_epoch_ms(transaction).await?;
    let custody = admit_research_custody_in_transaction(
        transaction,
        ResearchCustodyLookupV1::RequestV2(&proposal.research_request_identity),
    )
    .await
    .map_err(|e| ComplexStrategyDevelopEvaluationError::Storage(e.to_string()))?
    .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    let current = prepare_fact(proposal, pit_readback, &custody, Some(cut))?;
    if &current != provisional {
        return Err(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable);
    }
    Ok((current, cut))
}

async fn database_cut_epoch_ms(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, ComplexStrategyDevelopEvaluationError> {
    let cut: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(pg_catalog.extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    u64::try_from(cut).map_err(json_storage)
}

const fn cut_precedes_expiry(cut_epoch_ms: u64, valid_through_epoch_ms: u64) -> bool {
    cut_epoch_ms < valid_through_epoch_ms
}

fn stable_lineage_for_custody(
    custody: &VerifiedResearchCustodyV1,
) -> Result<String, ComplexStrategyDevelopEvaluationError> {
    let intent = custody
        .intent()
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    let family = custody
        .family()
        .ok_or(ComplexStrategyDevelopEvaluationError::ResearchCustodyUnavailable)?;
    stable_lineage_identity(
        intent.intent_identity(),
        intent.semantic_digest(),
        family.root().trial_family_identity(),
        family.root().root_digest(),
    )
}

fn stable_lineage_identity(
    intent_identity: &str,
    intent_semantic_digest: &str,
    trial_family_identity: &str,
    trial_family_root_digest: &str,
) -> Result<String, ComplexStrategyDevelopEvaluationError> {
    let stable_projection = serde_json::json!({
        "intent_identity": intent_identity,
        "intent_semantic_digest": intent_semantic_digest,
        "trial_family_identity": trial_family_identity,
        "trial_family_root_digest": trial_family_root_digest,
    });
    Ok(identity(
        "rd-develop-evaluation-lineage-v1",
        &digest("rd.develop-evaluation.lineage.v1", &stable_projection)?,
    ))
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    fact: DevelopEvaluationFactV1,
    committed_at_epoch_ms: u64,
) -> Result<(), ComplexStrategyDevelopEvaluationError> {
    let receipt_identity = identity(
        "rd-develop-evaluation-receipt-v1",
        &fact.evaluation_identity,
    );
    let payload = DevelopEvaluationOutboxV1 {
        schema_version: 1,
        evaluation_identity: &fact.evaluation_identity,
        evaluation_digest: &fact.evaluation_digest,
        receipt_identity: &receipt_identity,
    };
    let outbox_digest = digest("rd.owner-outbox.payload.v1", &payload)?;
    let receipt = DevelopEvaluationReceiptV1 {
        schema_version: 1,
        receipt_identity: receipt_identity.clone(),
        evaluation_identity: fact.evaluation_identity.clone(),
        evaluation_digest: fact.evaluation_digest.clone(),
        outbox_digest: outbox_digest.clone(),
        committed_at_epoch_ms,
    };
    let committed_at = i64::try_from(committed_at_epoch_ms).map_err(json_storage)?;
    sqlx::query("INSERT INTO rd_complex_strategy_develop_evaluations_v1 (evaluation_identity,evaluation_digest,lineage_identity,predecessor_evaluation_identity,ir_digest,pit_readback_digest,fact_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&fact.evaluation_identity).bind(&fact.evaluation_digest).bind(&fact.lineage_identity)
        .bind(&fact.meaning.predecessor_evaluation_identity).bind(&fact.meaning.complex_strategy_ir_digest)
        .bind(&fact.meaning.pit_readback_digest).bind(serde_json::to_value(&fact).map_err(json_storage)?)
        .bind(serde_json::to_value(&receipt).map_err(json_storage)?).bind(committed_at)
        .execute(&mut **transaction).await.map_err(storage)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(identity("rd-develop-evaluation-event-v1", &fact.evaluation_identity))
        .bind(&fact.evaluation_identity).bind(EVENT_KIND).bind(outbox_digest)
        .bind(serde_json::to_value(&payload).map_err(json_storage)?).bind(committed_at)
        .execute(&mut **transaction).await.map_err(storage)?;
    sqlx::query("INSERT INTO rd_complex_strategy_develop_evaluation_heads_v1 (lineage_identity,evaluation_identity,evaluation_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4) ON CONFLICT (lineage_identity) DO UPDATE SET evaluation_identity = EXCLUDED.evaluation_identity, evaluation_digest = EXCLUDED.evaluation_digest, committed_at_epoch_ms = EXCLUDED.committed_at_epoch_ms")
        .bind(&fact.lineage_identity).bind(&fact.evaluation_identity).bind(&fact.evaluation_digest).bind(committed_at)
        .execute(&mut **transaction).await.map_err(storage)?;
    Ok(())
}

fn digest<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<String, ComplexStrategyDevelopEvaluationError> {
    let bytes = serde_json::to_vec(&(domain, value)).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn identity(domain: &str, digest: &str) -> String {
    format!(
        "{domain}-{:x}",
        Sha256::digest(format!("{domain}\0{digest}").as_bytes())
    )
}

fn decode<T: for<'de> Deserialize<'de> + Serialize>(
    value: &serde_json::Value,
) -> Result<T, ComplexStrategyDevelopEvaluationError> {
    let decoded = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(ComplexStrategyDevelopEvaluationError::Storage(
            "non-canonical stored JSON".into(),
        ));
    }
    Ok(decoded)
}

fn storage(error: impl Display) -> ComplexStrategyDevelopEvaluationError {
    ComplexStrategyDevelopEvaluationError::Storage(error.to_string())
}

fn json_storage(error: impl Display) -> ComplexStrategyDevelopEvaluationError {
    storage(error)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn meaning() -> DevelopEvaluationMeaningV1 {
        DevelopEvaluationMeaningV1 {
            schema_version: 1,
            research_request: serde_json::json!({"request_identity": "request"}),
            research_receipt: serde_json::json!({"receipt_identity": "receipt"}),
            research_intent: serde_json::json!({"intent_identity": "intent"}),
            research_view: serde_json::json!({"projection_identity": "view"}),
            trial_family: FrozenTrialFamilyCustodyV1 {
                trial_family_identity: "family".into(),
                root_digest: "sha256:root".into(),
                census_frontier_identity: "frontier".into(),
                census_frontier_digest: "sha256:frontier".into(),
                census_member_count: 1,
                census_member_digests: vec!["sha256:member".into()],
                readback: serde_json::json!({"census_frontier": "frontier"}),
            },
            complex_strategy_ir_schema: "complex-strategy-ir-v1".into(),
            complex_strategy_ir_schema_version: 1,
            complex_strategy_ir_digest: "sha256:ir".into(),
            complex_strategy_ir_bytes: b"canonical-ir\n".to_vec(),
            pit_readback_digest: "sha256:pit".into(),
            pit_readback: serde_json::json!({"available": true, "locator": {"fact": "pit"}}),
            predecessor_evaluation_identity: None,
        }
    }

    #[rstest]
    fn identity_binds_every_frozen_semantic_field() {
        let original = meaning();
        let original_digest = digest("rd.develop-evaluation.meaning.v1", &original).unwrap();
        let mut changed = original.clone();
        changed.trial_family.census_frontier_identity = "successor".into();
        assert_ne!(
            original_digest,
            digest("rd.develop-evaluation.meaning.v1", &changed).unwrap()
        );
        changed = original.clone();
        changed.pit_readback = serde_json::json!({"available": true, "locator": {"fact": "other"}});
        assert_ne!(
            original_digest,
            digest("rd.develop-evaluation.meaning.v1", &changed).unwrap()
        );
        changed = original;
        changed.complex_strategy_ir_bytes.push(b' ');
        assert_ne!(
            original_digest,
            digest("rd.develop-evaluation.meaning.v1", &changed).unwrap()
        );
    }

    #[rstest]
    fn successor_requires_changed_ir_or_pit() {
        let original = meaning();
        assert!(!successor_changes_evidence(&original, &original));
        let mut changed_ir = original.clone();
        changed_ir.complex_strategy_ir_digest = "sha256:changed-ir".into();
        assert!(successor_changes_evidence(&original, &changed_ir));
        let mut changed_pit = original.clone();
        changed_pit.pit_readback_digest = "sha256:changed-pit".into();
        assert!(successor_changes_evidence(&original, &changed_pit));
    }

    #[rstest]
    fn post_wait_expired_owner_cut_is_rejected() {
        assert!(cut_precedes_expiry(99, 100));
        assert!(!cut_precedes_expiry(100, 100));
        assert!(!cut_precedes_expiry(101, 100));
    }

    #[rstest]
    fn commit_time_is_receipt_only() {
        let frozen = serde_json::to_value(meaning()).unwrap();
        assert!(frozen.get("committed_at_epoch_ms").is_none());
    }

    #[rstest]
    fn census_advance_changes_evaluation_but_preserves_lineage() {
        let first = meaning();
        let mut advanced = first.clone();
        advanced.trial_family.census_frontier_identity = "frontier-2".into();
        advanced.trial_family.census_frontier_digest = "sha256:frontier-2".into();
        advanced.trial_family.census_member_count = 2;
        advanced
            .trial_family
            .census_member_digests
            .push("sha256:member-2".into());
        advanced.trial_family.readback = serde_json::json!({"census_frontier": "frontier-2"});
        assert!(successor_changes_evidence(&first, &advanced));
        assert_ne!(
            digest("rd.develop-evaluation.meaning.v1", &first).unwrap(),
            digest("rd.develop-evaluation.meaning.v1", &advanced).unwrap()
        );
        assert_eq!(
            stable_lineage_identity(
                "intent",
                "sha256:intent",
                &first.trial_family.trial_family_identity,
                &first.trial_family.root_digest,
            )
            .unwrap(),
            stable_lineage_identity(
                "intent",
                "sha256:intent",
                &advanced.trial_family.trial_family_identity,
                &advanced.trial_family.root_digest,
            )
            .unwrap()
        );
    }
}
