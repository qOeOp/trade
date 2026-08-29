//! Durable PostgreSQL custody for R&D iteration decisions and selected-only dispositions.

use std::fmt::Display;

use serde::Deserialize;
use sqlx::{PgPool, Postgres, Row, Transaction};

use super::{
    BacktestResultLocatorV1, BacktestResultReadV1, BacktestTerminalResultReadPortV1,
    DECISION_EVENT_V1, DecisionAvailabilityV1, DecisionCommitRequestV1, DecisionCommitResultV1,
    DecisionLocatorV1, DecisionOwnerResponseV1, DecisionProjectionV1, DiagnosisV1,
    DiagnosticEvidenceV1, IdentityDigestV1, IterationOutcomeV1, OwnerOutboxV1,
    ReplayEvidenceBindingsV1, ResearchDecisionError, ResearchIterationDecisionV1,
    ResearchSelectionDispositionV1, SELECTION_EVENT_V1, SelectionCommitRequestV1,
    SelectionCommitResultV1, SelectionLocatorV1, SelectionRationaleV1, VersionedIdentityV1,
    derive_decision, derive_selection,
};

#[derive(Debug, Clone)]
pub(crate) struct PostgresResearchIterationDecisionOwnerV1 {
    pool: PgPool,
}

impl PostgresResearchIterationDecisionOwnerV1 {
    pub(crate) async fn connect(pool: PgPool) -> Result<Self, ResearchDecisionError> {
        migrate(&pool).await?;
        let owner: String = sqlx::query_scalar("SELECT current_user")
            .fetch_one(&pool)
            .await
            .map_err(storage)?;

        if owner != "rd_owner" {
            return Err(ResearchDecisionError::Unavailable(
                "canonical rd_owner session required".to_string(),
            ));
        }
        Ok(Self { pool })
    }

    pub(crate) async fn submit_or_resolve_decision<P: BacktestTerminalResultReadPortV1>(
        &self,
        request: &DecisionCommitRequestV1,
        backtest: &P,
    ) -> Result<DecisionOwnerResponseV1, ResearchDecisionError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock_request(
            &mut transaction,
            "decision",
            &request.decision_request_identity,
        )
        .await?;

        if let Some(existing) =
            load_decision_by_request(&mut transaction, &request.decision_request_identity).await?
        {
            verify_existing_decision_request(request, &existing)?;
            transaction.commit().await.map_err(storage)?;
            return Ok(DecisionOwnerResponseV1::Committed {
                result: Box::new(existing),
            });
        }
        transaction.commit().await.map_err(storage)?;

        let read = backtest
            .read_terminal_result(&request.expected_result)
            .await?;
        let BacktestResultReadV1::Terminal(result) = read else {
            return Ok(unknown_projection(&request.decision_request_identity));
        };

        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock_request(
            &mut transaction,
            "decision",
            &request.decision_request_identity,
        )
        .await?;

        if let Some(existing) =
            load_decision_by_request(&mut transaction, &request.decision_request_identity).await?
        {
            verify_existing_decision_request(request, &existing)?;
            transaction.commit().await.map_err(storage)?;
            return Ok(DecisionOwnerResponseV1::Committed {
                result: Box::new(existing),
            });
        }

        let committed_at_epoch_ms = database_time(&mut transaction).await?;
        let Some(committed) = derive_decision(request, &result, committed_at_epoch_ms)? else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(unknown_projection(&request.decision_request_identity));
        };
        insert_decision(&mut transaction, &committed).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(DecisionOwnerResponseV1::Committed {
            result: Box::new(committed),
        })
    }

    pub(crate) async fn resolve_decision(
        &self,
        locator: &DecisionLocatorV1,
    ) -> Result<Option<DecisionCommitResultV1>, ResearchDecisionError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let result =
            load_decision_by_request(&mut transaction, &locator.decision_request_identity).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result.filter(|value| value.locator == *locator))
    }

    pub(crate) async fn submit_or_resolve_selection(
        &self,
        request: &SelectionCommitRequestV1,
    ) -> Result<SelectionCommitResultV1, ResearchDecisionError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock_request(
            &mut transaction,
            "selection",
            &request.selection_request_identity,
        )
        .await?;

        if let Some(existing) =
            load_selection_by_request(&mut transaction, &request.selection_request_identity).await?
        {
            let decision =
                load_decision_by_identity(&mut transaction, &existing.selection.decision_identity)
                    .await?;
            let expected =
                derive_selection(request, &decision, existing.selection.committed_at_epoch_ms)
                    .map_err(|_| ResearchDecisionError::SelectionConflict)?;
            if expected != existing {
                return Err(ResearchDecisionError::SelectionConflict);
            }
            transaction.commit().await.map_err(storage)?;
            return Ok(existing);
        }

        let decision = load_decision_by_request(
            &mut transaction,
            &request.decision.decision_request_identity,
        )
        .await?
        .ok_or_else(|| {
            ResearchDecisionError::Unavailable(
                "READY_FOR_SELECTION decision custody unavailable".to_string(),
            )
        })?;
        let committed_at_epoch_ms = database_time(&mut transaction).await?;
        let selection = derive_selection(request, &decision, committed_at_epoch_ms)?;
        insert_selection(&mut transaction, &selection).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(selection)
    }

    pub(crate) async fn resolve_selection(
        &self,
        locator: &SelectionLocatorV1,
    ) -> Result<Option<SelectionCommitResultV1>, ResearchDecisionError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let result =
            load_selection_by_request(&mut transaction, &locator.selection_request_identity)
                .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result.filter(|value| value.locator == *locator))
    }
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ResearchDecisionError> {
    let owner: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(pool)
        .await
        .map_err(storage)?;

    if owner != "rd_owner" {
        return Err(ResearchDecisionError::Unavailable(
            "canonical rd_owner session required for migration".to_string(),
        ));
    }
    let mut transaction = pool.begin().await.map_err(storage)?;

    for statement in [
        "CREATE TABLE IF NOT EXISTS public.rd_research_iteration_decisions_v1 (decision_request_identity TEXT PRIMARY KEY, meaning_digest TEXT NOT NULL, decision_identity TEXT NOT NULL UNIQUE, fact_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS public.rd_research_selections_v1 (selection_request_identity TEXT PRIMARY KEY, meaning_digest TEXT NOT NULL, selection_identity TEXT NOT NULL UNIQUE, decision_identity TEXT NOT NULL REFERENCES public.rd_research_iteration_decisions_v1(decision_identity), fact_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS public.rd_research_decision_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        "ALTER TABLE public.rd_research_iteration_decisions_v1 OWNER TO rd_owner",
        "ALTER TABLE public.rd_research_selections_v1 OWNER TO rd_owner",
        "ALTER TABLE public.rd_research_decision_outbox_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_research_iteration_decisions_v1 FROM PUBLIC",
        "REVOKE ALL ON TABLE public.rd_research_selections_v1 FROM PUBLIC",
        "REVOKE ALL ON TABLE public.rd_research_decision_outbox_v1 FROM PUBLIC",
    ] {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
    }
    transaction.commit().await.map_err(storage)
}

fn unknown_projection(request_identity: &str) -> DecisionOwnerResponseV1 {
    DecisionOwnerResponseV1::SubmittedOrUnknown {
        projection: DecisionProjectionV1 {
            decision_request_identity: request_identity.to_string(),
            availability: DecisionAvailabilityV1::SubmittedOrUnknown,
        },
    }
}

async fn lock_request(
    transaction: &mut Transaction<'_, Postgres>,
    domain: &str,
    request_identity: &str,
) -> Result<(), ResearchDecisionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))")
        .bind("rd.research-decision.v1")
        .bind(format!("{domain}:{request_identity}"))
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn database_time(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, ResearchDecisionError> {
    let value: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint")
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    u64::try_from(value).map_err(storage)
}

async fn insert_decision(
    transaction: &mut Transaction<'_, Postgres>,
    result: &DecisionCommitResultV1,
) -> Result<(), ResearchDecisionError> {
    let fact = serde_json::to_value(&result.decision).map_err(encoding)?;
    let receipt = serde_json::to_value(&result.receipt).map_err(encoding)?;
    let outbox_payload = fact.clone();
    sqlx::query("INSERT INTO public.rd_research_iteration_decisions_v1 (decision_request_identity, meaning_digest, decision_identity, fact_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&result.decision.decision_request_identity)
        .bind(&result.decision.meaning_digest)
        .bind(&result.decision.decision_identity)
        .bind(fact)
        .bind(receipt)
        .bind(i64::try_from(result.decision.committed_at_epoch_ms).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    insert_outbox(transaction, &result.outbox, outbox_payload).await
}

async fn insert_selection(
    transaction: &mut Transaction<'_, Postgres>,
    result: &SelectionCommitResultV1,
) -> Result<(), ResearchDecisionError> {
    let fact = serde_json::to_value(&result.selection).map_err(encoding)?;
    let receipt = serde_json::to_value(&result.receipt).map_err(encoding)?;
    let outbox_payload = fact.clone();
    sqlx::query("INSERT INTO public.rd_research_selections_v1 (selection_request_identity, meaning_digest, selection_identity, decision_identity, fact_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&result.selection.selection_request_identity)
        .bind(&result.selection.meaning_digest)
        .bind(&result.selection.selection_identity)
        .bind(&result.selection.decision_identity)
        .bind(fact)
        .bind(receipt)
        .bind(i64::try_from(result.selection.committed_at_epoch_ms).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    insert_outbox(transaction, &result.outbox, outbox_payload).await
}

async fn insert_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    outbox: &OwnerOutboxV1,
    payload: serde_json::Value,
) -> Result<(), ResearchDecisionError> {
    sqlx::query("INSERT INTO public.rd_research_decision_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&outbox.event_identity)
        .bind(&outbox.aggregate_identity)
        .bind(&outbox.event_kind)
        .bind(&outbox.payload_digest)
        .bind(payload)
        .bind(i64::try_from(outbox.committed_at_epoch_ms).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_decision_by_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<DecisionCommitResultV1>, ResearchDecisionError> {
    let row = sqlx::query("SELECT meaning_digest, decision_identity, fact_json, receipt_json, committed_at_epoch_ms FROM public.rd_research_iteration_decisions_v1 WHERE decision_request_identity=$1 FOR SHARE")
        .bind(request_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let Some(row) = row else { return Ok(None) };
    let stored_fact: serde_json::Value = row.try_get("fact_json").map_err(storage)?;
    let stored_receipt: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let fact = decode_decision(&stored_fact)?;
    let regenerated = regenerate_decision(&fact)?;
    let expected_fact = serde_json::to_value(&regenerated.decision).map_err(encoding)?;
    let outbox = load_outbox(
        transaction,
        &regenerated.decision.decision_identity,
        DECISION_EVENT_V1,
        &expected_fact,
    )
    .await?;
    let row_digest: String = row.try_get("meaning_digest").map_err(storage)?;
    let row_identity: String = row.try_get("decision_identity").map_err(storage)?;
    let row_time: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    verify_row(
        request_identity,
        (&row_digest, &row_identity, row_time),
        (
            &regenerated.decision.decision_request_identity,
            &regenerated.decision.meaning_digest,
            &regenerated.decision.decision_identity,
            regenerated.decision.committed_at_epoch_ms,
        ),
    )?;

    if stored_fact != expected_fact
        || stored_receipt != serde_json::to_value(&regenerated.receipt).map_err(encoding)?
        || outbox != regenerated.outbox
    {
        return Err(malformed("decision row or receipt/outbox mismatch"));
    }
    Ok(Some(regenerated))
}

async fn load_selection_by_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<SelectionCommitResultV1>, ResearchDecisionError> {
    let row = sqlx::query("SELECT meaning_digest, selection_identity, decision_identity, fact_json, receipt_json, committed_at_epoch_ms FROM public.rd_research_selections_v1 WHERE selection_request_identity=$1 FOR SHARE")
        .bind(request_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let Some(row) = row else { return Ok(None) };
    let stored_fact: serde_json::Value = row.try_get("fact_json").map_err(storage)?;
    let stored_receipt: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let selection = decode_selection(&stored_fact)?;
    let decision = load_decision_by_identity(
        transaction,
        &row.try_get::<String, _>("decision_identity")
            .map_err(storage)?,
    )
    .await?;
    let request = SelectionCommitRequestV1 {
        selection_request_identity: selection.selection_request_identity.clone(),
        decision: decision.locator.clone(),
        result: selection.result.clone(),
        trial_family: selection.trial_family.clone(),
        census_frontier: selection.census_frontier.clone(),
        artifact: selection.artifact.clone(),
        cost_model: selection.cost_model.clone(),
        slippage_model: selection.slippage_model.clone(),
        capacity_model: selection.capacity_model.clone(),
        falsifier: selection.falsifier.clone(),
        stop_rule: selection.stop_rule.clone(),
        evidence_cut: selection.evidence_cut.clone(),
        policy: selection.policy.clone(),
        rationale: selection.rationale.clone(),
    };
    let regenerated = derive_selection(&request, &decision, selection.committed_at_epoch_ms)?;
    let expected_fact = serde_json::to_value(&regenerated.selection).map_err(encoding)?;
    let outbox = load_outbox(
        transaction,
        &selection.selection_identity,
        SELECTION_EVENT_V1,
        &expected_fact,
    )
    .await?;
    let row_digest: String = row.try_get("meaning_digest").map_err(storage)?;
    let row_identity: String = row.try_get("selection_identity").map_err(storage)?;
    let row_time: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    verify_row(
        request_identity,
        (&row_digest, &row_identity, row_time),
        (
            &regenerated.selection.selection_request_identity,
            &regenerated.selection.meaning_digest,
            &regenerated.selection.selection_identity,
            regenerated.selection.committed_at_epoch_ms,
        ),
    )?;

    if stored_fact != expected_fact
        || stored_receipt != serde_json::to_value(&regenerated.receipt).map_err(encoding)?
        || outbox != regenerated.outbox
    {
        return Err(malformed("selection row or receipt/outbox mismatch"));
    }
    Ok(Some(regenerated))
}

async fn load_decision_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
) -> Result<DecisionCommitResultV1, ResearchDecisionError> {
    let request_identity: Option<String> = sqlx::query_scalar("SELECT decision_request_identity FROM public.rd_research_iteration_decisions_v1 WHERE decision_identity=$1 FOR SHARE")
        .bind(decision_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let request_identity = request_identity.ok_or_else(|| malformed("decision fact missing"))?;
    load_decision_by_request(transaction, &request_identity)
        .await?
        .ok_or_else(|| malformed("decision fact disappeared"))
}

async fn load_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate_identity: &str,
    event_kind: &str,
    expected_payload: &serde_json::Value,
) -> Result<OwnerOutboxV1, ResearchDecisionError> {
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM public.rd_research_decision_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(aggregate_identity)
        .bind(event_kind)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(malformed("outbox cardinality mismatch"));
    }
    let payload: serde_json::Value = rows[0].try_get("payload_json").map_err(storage)?;
    if payload != *expected_payload {
        return Err(malformed("outbox payload mismatch"));
    }
    Ok(OwnerOutboxV1 {
        schema_version: 1,
        event_identity: rows[0].try_get("event_identity").map_err(storage)?,
        aggregate_identity: rows[0].try_get("aggregate_identity").map_err(storage)?,
        event_kind: rows[0].try_get("event_kind").map_err(storage)?,
        payload_digest: rows[0].try_get("payload_digest").map_err(storage)?,
        committed_at_epoch_ms: u64::try_from(
            rows[0]
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(storage)?,
    })
}

fn regenerate_decision(
    decision: &ResearchIterationDecisionV1,
) -> Result<DecisionCommitResultV1, ResearchDecisionError> {
    let request = DecisionCommitRequestV1 {
        decision_request_identity: decision.decision_request_identity.clone(),
        expected_result: decision.result.clone(),
        expected_bindings: decision.bindings.clone(),
        diagnosis: decision.diagnosis.clone(),
        policy: decision.policy.clone(),
    };
    let terminal = super::SealedBacktestTerminalResultV1 {
        schema_version: 1,
        locator: decision.result.clone(),
        attempt_identity: decision.attempt_identity.clone(),
        namespace: vibe_backtest_owner_contracts::ReplayNamespaceV2::Exploratory,
        terminal: vibe_backtest_owner_contracts::ReplayTerminalV2::TerminalResult,
        bindings: decision.bindings.clone(),
        diagnostics: decision.diagnostics.clone(),
    };
    let regenerated = derive_decision(&request, &terminal, decision.committed_at_epoch_ms)?
        .ok_or_else(|| malformed("stored decision no longer derives"))?;
    if regenerated.decision != *decision {
        return Err(malformed("stored decision meaning mismatch"));
    }
    Ok(regenerated)
}

fn verify_existing_decision_request(
    request: &DecisionCommitRequestV1,
    existing: &DecisionCommitResultV1,
) -> Result<(), ResearchDecisionError> {
    let terminal = super::SealedBacktestTerminalResultV1 {
        schema_version: 1,
        locator: existing.decision.result.clone(),
        attempt_identity: existing.decision.attempt_identity.clone(),
        namespace: vibe_backtest_owner_contracts::ReplayNamespaceV2::Exploratory,
        terminal: vibe_backtest_owner_contracts::ReplayTerminalV2::TerminalResult,
        bindings: existing.decision.bindings.clone(),
        diagnostics: existing.decision.diagnostics.clone(),
    };
    let expected = derive_decision(request, &terminal, existing.decision.committed_at_epoch_ms)?
        .ok_or(ResearchDecisionError::DecisionConflict)?;

    if expected != *existing {
        return Err(ResearchDecisionError::DecisionConflict);
    }
    Ok(())
}

fn verify_row(
    requested_identity: &str,
    row: (&str, &str, i64),
    fact: (&str, &str, &str, u64),
) -> Result<(), ResearchDecisionError> {
    let (row_digest, row_fact_identity, row_time) = row;
    let (fact_request_identity, fact_digest, fact_identity, fact_time) = fact;
    if requested_identity != fact_request_identity
        || row_digest != fact_digest
        || row_fact_identity != fact_identity
        || u64::try_from(row_time).ok() != Some(fact_time)
    {
        return Err(malformed("relational scalar mismatch"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_request_identity: String,
    meaning_digest: String,
    result: BacktestResultLocatorV1,
    attempt_identity: String,
    bindings: ReplayEvidenceBindingsV1,
    diagnostics: Vec<DiagnosticEvidenceV1>,
    diagnosis: DiagnosisV1,
    policy: super::DecisionPolicyV1,
    outcome: IterationOutcomeV1,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSelectionV1 {
    schema_version: u16,
    selection_identity: String,
    selection_request_identity: String,
    meaning_digest: String,
    decision_identity: String,
    result: BacktestResultLocatorV1,
    trial_family: IdentityDigestV1,
    census_frontier: IdentityDigestV1,
    artifact: IdentityDigestV1,
    cost_model: IdentityDigestV1,
    slippage_model: IdentityDigestV1,
    capacity_model: IdentityDigestV1,
    falsifier: IdentityDigestV1,
    stop_rule: IdentityDigestV1,
    evidence_cut: IdentityDigestV1,
    policy: VersionedIdentityV1,
    rationale: SelectionRationaleV1,
    disposition: String,
    committed_at_epoch_ms: u64,
}

fn decode_decision(
    value: &serde_json::Value,
) -> Result<ResearchIterationDecisionV1, ResearchDecisionError> {
    let stored: StoredDecisionV1 = decode_exact(value)?;
    Ok(ResearchIterationDecisionV1 {
        schema_version: stored.schema_version,
        decision_identity: stored.decision_identity,
        decision_request_identity: stored.decision_request_identity,
        meaning_digest: stored.meaning_digest,
        result: stored.result,
        attempt_identity: stored.attempt_identity,
        bindings: stored.bindings,
        diagnostics: stored.diagnostics,
        diagnosis: stored.diagnosis,
        policy: stored.policy,
        outcome: stored.outcome,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    })
}

fn decode_selection(
    value: &serde_json::Value,
) -> Result<ResearchSelectionDispositionV1, ResearchDecisionError> {
    let stored: StoredSelectionV1 = decode_exact(value)?;
    if stored.schema_version != 1 || stored.disposition != "SELECTED_FOR_QUALIFICATION" {
        return Err(malformed("selection schema or disposition mismatch"));
    }
    Ok(ResearchSelectionDispositionV1 {
        schema_version: stored.schema_version,
        selection_identity: stored.selection_identity,
        selection_request_identity: stored.selection_request_identity,
        meaning_digest: stored.meaning_digest,
        decision_identity: stored.decision_identity,
        result: stored.result,
        trial_family: stored.trial_family,
        census_frontier: stored.census_frontier,
        artifact: stored.artifact,
        cost_model: stored.cost_model,
        slippage_model: stored.slippage_model,
        capacity_model: stored.capacity_model,
        falsifier: stored.falsifier,
        stop_rule: stored.stop_rule,
        evidence_cut: stored.evidence_cut,
        policy: stored.policy,
        rationale: stored.rationale,
        disposition: stored.disposition,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    })
}

fn decode_exact<T>(value: &serde_json::Value) -> Result<T, ResearchDecisionError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(value.clone()).map_err(|e| malformed(&e.to_string()))
}

fn storage(error: impl Display) -> ResearchDecisionError {
    ResearchDecisionError::Unavailable(error.to_string())
}

fn encoding(error: impl Display) -> ResearchDecisionError {
    ResearchDecisionError::Unavailable(format!("canonical encoding unavailable: {error}"))
}

fn malformed(reason: &str) -> ResearchDecisionError {
    ResearchDecisionError::Unavailable(format!("malformed durable R&D custody: {reason}"))
}
