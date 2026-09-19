use super::*;

use vibe_backtest_owner_contracts::{
    BacktestOutcomeEvidenceBindingsV1, BacktestOutcomeEvidenceDtoV1, CanonicalResultBindingDtoV1,
};

use crate::{
    iteration_analysis::{
        ITERATION_ANALYSIS_COMPLETION_MUTATION_EFFECT_V1,
        ITERATION_ANALYSIS_COMPLETION_OPERATION_V1, ITERATION_ANALYSIS_COMPLETION_SCHEMA_V1,
        IterationAnalysisCandidateEvaluationProposalV1,
        IterationAnalysisCandidateEvaluationSetProposalV1,
        IterationAnalysisCompletionOperationRequestV1, IterationAnalysisCompletionProposalV1,
        IterationAnalysisCompletionResolutionLocatorV1, IterationAnalysisConclusionV1,
        IterationAnalysisEvidenceLocatorV1, IterationAnalysisFindingProposalV1,
        IterationAnalysisRequestErrorV1, IterationAnalysisRequestLocatorV1,
        IterationAnalysisResolutionLocatorV1,
    },
    iteration_analysis_postgres::{
        compose_iteration_analysis_completion_v1, compose_iteration_analysis_request_v1,
        resolve_iteration_analysis_completion_v1, resolve_iteration_analysis_request_v1,
    },
    product_edge::ResearchIterationActionV1,
};

const SEMANTIC_TRACE_STORAGE_DOMAIN: &str = "vibe.backtest.native-semantic-trace.v2";
const OUTCOME_EVIDENCE_STORAGE_DOMAIN: &str = "vibe.backtest.outcome-evidence-storage.v1";
const ENGINE_RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.engine-canonical-result-storage.v1";
const ENGINE_RESULT_BINDING_DOMAIN: &str = "vibe.backtest.canonical-result-bytes.v1";
const OUTCOME_RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.outcome-evidence-receipt-storage.v1";
const OUTCOME_OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.outcome-evidence-outbox-storage.v1";
const OUTCOME_RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.outcome-evidence-receipt.v1";
const OUTCOME_OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str =
    "vibe.backtest.outcome-evidence-outbox-payload.v1";
const OUTCOME_OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.outcome-evidence-outbox-event.v1";
const OUTCOME_EVENT_KIND: &str = "BACKTEST_OUTCOME_EVIDENCE_COMMITTED_V1";

#[derive(Serialize)]
struct OutcomeEvidenceReceiptV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    evidence_identity: OpaqueIdentityV2,
    evidence_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    outbox_event_identity: OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct OutcomeEvidenceReceiptPreimageV1<'a> {
    schema_version: u16,
    receipt_identity: &'a OpaqueIdentityV2,
    evidence_identity: &'a OpaqueIdentityV2,
    evidence_digest: &'a CanonicalDigestV2,
    result_identity: &'a OpaqueIdentityV2,
    result_digest: &'a CanonicalDigestV2,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    attempt_identity: &'a OpaqueIdentityV2,
    outbox_event_identity: &'a OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct OutcomeEvidenceOutboxPayloadV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    evidence_identity: OpaqueIdentityV2,
    evidence_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct OutcomeEvidenceOutboxV1 {
    schema_version: u16,
    event_identity: OpaqueIdentityV2,
    event_digest: CanonicalDigestV2,
    aggregate_identity: OpaqueIdentityV2,
    event_kind: OpaqueIdentityV2,
    payload_digest: CanonicalDigestV2,
    payload: OutcomeEvidenceOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct OutcomeEvidenceOutboxPreimageV1<'a> {
    schema_version: u16,
    event_identity: &'a OpaqueIdentityV2,
    aggregate_identity: &'a OpaqueIdentityV2,
    event_kind: &'a OpaqueIdentityV2,
    payload_digest: &'a CanonicalDigestV2,
    payload: &'a OutcomeEvidenceOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

fn canonical_engine_result() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "accounts": [],
        "components": {
            "actor_ids": [],
            "exec_algorithm_ids": [],
            "strategy_ids": ["strategy-1"],
            "trader_state": "stopped"
        },
        "diagnostics": [],
        "fills": ["fill-1", "fill-2", "fill-3"],
        "orders": ["order-1", "order-2"],
        "portfolio_snapshots": [],
        "position_snapshots": [],
        "positions": ["position-1"],
        "run": {
            "backtest_end_ns": "19",
            "backtest_start_ns": "11",
            "iterations": "9",
            "outcome": "completed",
            "run_config_id": "run-config-1",
            "total_events": "9",
            "total_orders": "2",
            "total_positions": "1",
            "trader_id": "trader-1"
        },
        "schema": "vibe-backtest-result/v1",
        "statistics": {
            "general": {
                "Max Drawdown": "bfc0000000000000",
                "PnL (total)": "4024000000000000"
            },
            "pnls": {
                "USDT": {
                    "PnL (total)": "4024000000000000",
                    "PnL% (total)": "3fb999999999999a"
                }
            },
            "returns": {
                "Average Return": "3f847ae147ae147b",
                "Sharpe Ratio (252 days)": "3ff8000000000000"
            },
            "returns_series": []
        },
        "summary": {}
    }))
    .expect("canonical engine result fixture")
}

fn bind_positive_result_to_owner_outcome(
    result: &mut ReplayResultDtoV2,
    replay: &ReplayRequestDtoV2,
    semantic_trace_bytes: &[u8],
) {
    let semantic_digest = CanonicalDigestV2::try_from(storage_digest(
        SEMANTIC_TRACE_STORAGE_DOMAIN,
        semantic_trace_bytes,
    ))
    .expect("semantic trace digest");
    let semantic = result
        .semantic_trace
        .as_mut()
        .expect("positive semantic trace");
    semantic.locator.digest = semantic_digest;
    let census = result
        .reconciliation
        .iter_mut()
        .find(|atom| atom.component == ObservationComponentV2::TrialFamilyCensusFrontier)
        .expect("TrialFamily Census reconciliation");
    census.requested_meaning_identity = replay.trial_family_census_frontier.identity.clone();
    census.requested_meaning_digest = replay.trial_family_census_frontier.digest.clone();
    census.observed_meaning_identity = Some(replay.trial_family_census_frontier.identity.clone());
    census.observed_meaning_digest = Some(replay.trial_family_census_frontier.digest.clone());
    let preimage = ResultDigestPreimageV2 {
        schema_version: result.schema_version,
        request_identity: &result.request_identity,
        request_meaning_digest: &result.request_meaning_digest,
        namespace: result.namespace,
        replay_authority: &result.replay_authority,
        attempt_identity: &result.attempt_identity,
        terminal: result.terminal,
        reconciliation: &result.reconciliation,
        semantic_trace: result.semantic_trace.as_ref(),
        diagnostic_census: &result.diagnostic_census,
    };
    result.result_digest = digest_value("vibe.backtest.replay-result.v2", &preimage);
    result.result_identity = identity(format!(
        "backtest-replay-result-v2-{}",
        result.result_digest.as_str().trim_start_matches("blake3:")
    ));
}

fn exact_result_content_binding(
    result: &ReplayResultDtoV2,
    component: ObservationComponentV2,
) -> ContentIdentityV2 {
    let atom = result
        .reconciliation
        .iter()
        .find(|atom| atom.component == component)
        .expect("exact result component");
    ContentIdentityV2 {
        identity: atom.requested_meaning_identity.clone(),
        digest: atom.requested_meaning_digest.clone(),
    }
}

async fn persist_backtest_outcome_custody(
    pool: &PgPool,
    result: &ReplayResultDtoV2,
    semantic_trace_bytes: &[u8],
    engine_result_bytes: &[u8],
    committed_at_epoch_ms: u64,
) {
    let semantic = result.semantic_trace.as_ref().expect("semantic trace");
    let canonical_result_digest = CanonicalDigestV2::try_from(storage_digest(
        ENGINE_RESULT_BINDING_DOMAIN,
        engine_result_bytes,
    ))
    .expect("engine binding digest");
    let evidence = BacktestOutcomeEvidenceDtoV1::from_bindings(BacktestOutcomeEvidenceBindingsV1 {
        result_identity: result.result_identity.clone(),
        result_digest: result.result_digest.clone(),
        request_identity: result.request_identity.clone(),
        request_meaning_digest: result.request_meaning_digest.clone(),
        attempt_identity: result.attempt_identity.clone(),
        frozen_research_intent: exact_result_content_binding(
            result,
            ObservationComponentV2::FrozenResearchIntent,
        ),
        trial_family_census_frontier: exact_result_content_binding(
            result,
            ObservationComponentV2::TrialFamilyCensusFrontier,
        ),
        semantic_trace: semantic.locator.clone(),
        canonical_result: CanonicalResultBindingDtoV1 {
            schema_identity: identity("vibe-backtest-result/v1"),
            canonical_bytes_digest: canonical_result_digest,
            canonical_bytes_length: u64::try_from(engine_result_bytes.len())
                .expect("bounded engine result"),
        },
    })
    .expect("canonical outcome evidence");
    let evidence_bytes = evidence
        .to_canonical_bytes()
        .expect("canonical outcome evidence bytes");
    let digest_suffix = evidence
        .evidence_digest
        .as_str()
        .trim_start_matches("blake3:");
    let receipt_identity = identity(format!(
        "backtest-outcome-evidence-receipt-v1-{digest_suffix}"
    ));
    let event_identity = identity(format!(
        "backtest-outcome-evidence-outbox-v1-{digest_suffix}"
    ));
    let placeholder = canonical_digest_value('0');
    let mut receipt = OutcomeEvidenceReceiptV1 {
        schema_version: 1,
        receipt_identity: receipt_identity.clone(),
        receipt_digest: placeholder.clone(),
        evidence_identity: evidence.evidence_identity.clone(),
        evidence_digest: evidence.evidence_digest.clone(),
        result_identity: evidence.result_identity.clone(),
        result_digest: evidence.result_digest.clone(),
        request_identity: evidence.request_identity.clone(),
        request_meaning_digest: evidence.request_meaning_digest.clone(),
        attempt_identity: evidence.attempt_identity.clone(),
        outbox_event_identity: event_identity.clone(),
        committed_at_epoch_ms,
    };
    receipt.receipt_digest = digest_value(
        OUTCOME_RECEIPT_DIGEST_DOMAIN,
        &OutcomeEvidenceReceiptPreimageV1 {
            schema_version: receipt.schema_version,
            receipt_identity: &receipt.receipt_identity,
            evidence_identity: &receipt.evidence_identity,
            evidence_digest: &receipt.evidence_digest,
            result_identity: &receipt.result_identity,
            result_digest: &receipt.result_digest,
            request_identity: &receipt.request_identity,
            request_meaning_digest: &receipt.request_meaning_digest,
            attempt_identity: &receipt.attempt_identity,
            outbox_event_identity: &receipt.outbox_event_identity,
            committed_at_epoch_ms,
        },
    );
    let payload = OutcomeEvidenceOutboxPayloadV1 {
        schema_version: 1,
        receipt_identity,
        receipt_digest: receipt.receipt_digest.clone(),
        evidence_identity: evidence.evidence_identity.clone(),
        evidence_digest: evidence.evidence_digest.clone(),
        result_identity: evidence.result_identity.clone(),
        result_digest: evidence.result_digest.clone(),
        request_identity: evidence.request_identity.clone(),
        request_meaning_digest: evidence.request_meaning_digest.clone(),
        attempt_identity: evidence.attempt_identity.clone(),
        committed_at_epoch_ms,
    };
    let mut outbox = OutcomeEvidenceOutboxV1 {
        schema_version: 1,
        event_identity,
        event_digest: placeholder.clone(),
        aggregate_identity: evidence.evidence_identity.clone(),
        event_kind: identity(OUTCOME_EVENT_KIND),
        payload_digest: placeholder,
        payload,
        committed_at_epoch_ms,
    };
    outbox.payload_digest = digest_value(OUTCOME_OUTBOX_PAYLOAD_DIGEST_DOMAIN, &outbox.payload);
    outbox.event_digest = digest_value(
        OUTCOME_OUTBOX_EVENT_DIGEST_DOMAIN,
        &OutcomeEvidenceOutboxPreimageV1 {
            schema_version: outbox.schema_version,
            event_identity: &outbox.event_identity,
            aggregate_identity: &outbox.aggregate_identity,
            event_kind: &outbox.event_kind,
            payload_digest: &outbox.payload_digest,
            payload: &outbox.payload,
            committed_at_epoch_ms,
        },
    );
    let receipt_bytes = serde_json::to_vec(&receipt).expect("outcome receipt bytes");
    let outbox_bytes = serde_json::to_vec(&outbox).expect("outcome outbox bytes");
    let mut transaction = pool.begin().await.expect("Backtest outcome transaction");
    sqlx::query("INSERT INTO backtest_native_replay_semantic_traces_v2 (result_identity,locator_reference,locator_digest,canonical_bytes) VALUES ($1,$2,$3,$4)")
        .bind(result.result_identity.as_str())
        .bind(semantic.locator.reference.as_str())
        .bind(semantic.locator.digest.as_str())
        .bind(semantic_trace_bytes)
        .execute(&mut *transaction)
        .await
        .expect("semantic trace custody");
    sqlx::query("INSERT INTO backtest_native_replay_outcome_evidence_v1 (result_identity,evidence_identity,evidence_digest,result_digest,request_identity,request_meaning_digest,attempt_identity,canonical_bytes,canonical_bytes_blake3,engine_canonical_result_bytes,engine_canonical_result_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(evidence.result_identity.as_str())
        .bind(evidence.evidence_identity.as_str())
        .bind(evidence.evidence_digest.as_str())
        .bind(evidence.result_digest.as_str())
        .bind(evidence.request_identity.as_str())
        .bind(evidence.request_meaning_digest.as_str())
        .bind(evidence.attempt_identity.as_str())
        .bind(&evidence_bytes)
        .bind(storage_digest(OUTCOME_EVIDENCE_STORAGE_DOMAIN, &evidence_bytes))
        .bind(engine_result_bytes)
        .bind(storage_digest(ENGINE_RESULT_STORAGE_DOMAIN, engine_result_bytes))
        .execute(&mut *transaction)
        .await
        .expect("outcome evidence custody");
    sqlx::query("INSERT INTO backtest_native_replay_outcome_evidence_receipts_v1 (result_identity,receipt_identity,receipt_digest,evidence_identity,evidence_digest,result_digest,request_identity,request_meaning_digest,attempt_identity,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(evidence.result_identity.as_str())
        .bind(receipt.receipt_identity.as_str())
        .bind(receipt.receipt_digest.as_str())
        .bind(evidence.evidence_identity.as_str())
        .bind(evidence.evidence_digest.as_str())
        .bind(evidence.result_digest.as_str())
        .bind(evidence.request_identity.as_str())
        .bind(evidence.request_meaning_digest.as_str())
        .bind(evidence.attempt_identity.as_str())
        .bind(receipt.outbox_event_identity.as_str())
        .bind(i64::try_from(committed_at_epoch_ms).expect("bounded epoch"))
        .bind(&receipt_bytes)
        .bind(storage_digest(OUTCOME_RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .expect("outcome evidence receipt custody");
    sqlx::query("INSERT INTO backtest_native_replay_outcome_evidence_outbox_v1 (result_identity,event_identity,event_digest,receipt_identity,evidence_identity,evidence_digest,result_digest,request_identity,request_meaning_digest,attempt_identity,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
        .bind(evidence.result_identity.as_str())
        .bind(outbox.event_identity.as_str())
        .bind(outbox.event_digest.as_str())
        .bind(receipt.receipt_identity.as_str())
        .bind(evidence.evidence_identity.as_str())
        .bind(evidence.evidence_digest.as_str())
        .bind(evidence.result_digest.as_str())
        .bind(evidence.request_identity.as_str())
        .bind(evidence.request_meaning_digest.as_str())
        .bind(evidence.attempt_identity.as_str())
        .bind(outbox.payload_digest.as_str())
        .bind(i64::try_from(committed_at_epoch_ms).expect("bounded epoch"))
        .bind(&outbox_bytes)
        .bind(storage_digest(OUTCOME_OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
        .execute(&mut *transaction)
        .await
        .expect("outcome evidence outbox custody");
    transaction
        .commit()
        .await
        .expect("Backtest outcome custody commit");
}

fn completion_operation(
    request: &crate::iteration_analysis::IterationAnalysisRequestReadbackV1,
    evaluations: IterationCandidateEvaluationSetV1,
    suffix: &str,
) -> IterationAnalysisCompletionOperationRequestV1 {
    let finding = |name: &str, byte: char| IterationAnalysisFindingProposalV1 {
        conclusion: IterationAnalysisConclusionV1::Established,
        evidence: vec![IterationAnalysisEvidenceLocatorV1 {
            identity: format!("analysis-{name}-{suffix}"),
            digest: digest(byte),
        }],
    };
    IterationAnalysisCompletionOperationRequestV1 {
        analysis_request_identity: request.request().analysis_request_identity().to_string(),
        analysis_request_digest: request.request().analysis_request_digest().to_string(),
        result_identity: request.request().locator().result_identity.clone(),
        mechanism_validity: finding("mechanism", '1'),
        economic_viability: finding("economic", '2'),
        robustness: finding("robustness", '3'),
        information_value: finding("information", '4'),
        candidate_evaluations: IterationAnalysisCandidateEvaluationSetProposalV1 {
            frontier_identity: evaluations.frontier_identity,
            frontier_digest: evaluations.frontier_digest,
            generation_rule_identity: evaluations.generation_rule_identity,
            generation_rule_digest: evaluations.generation_rule_digest,
            expected_cardinality: evaluations.expected_cardinality,
            threshold: evaluations.threshold,
            candidates: evaluations
                .candidates
                .into_iter()
                .map(|candidate| IterationAnalysisCandidateEvaluationProposalV1 {
                    candidate_identity: candidate.candidate_identity,
                    candidate_digest: candidate.candidate_digest,
                    admissibility: candidate.admissibility,
                    information_value: candidate.information_value,
                    uncertainty_reduction_rank: candidate.uncertainty_reduction_rank,
                    tie_break_key: candidate.tie_break_key,
                })
                .collect(),
        },
    }
}

async fn admit_completion(
    database: &CanonicalOwnerPostgresTestDatabaseV1,
    operation: &IterationAnalysisCompletionOperationRequestV1,
    suffix: &str,
) -> ProductEdgeAdmissionLocatorV1 {
    let now = current_epoch_ms().expect("test clock");
    let valid_through = now + 3_600_000;
    let manifest = repair_replay_manifest(
        ITERATION_ANALYSIS_COMPLETION_OPERATION_V1,
        ITERATION_ANALYSIS_COMPLETION_SCHEMA_V1,
        vec![ITERATION_ANALYSIS_COMPLETION_MUTATION_EFFECT_V1.to_string()],
        now,
        valid_through,
    );
    let request_proof_digest = digest('a');
    let issuer_identity = format!("analysis-completion-issuer-{suffix}");
    let issuer_key_version = "test-key-v1".to_string();
    let audience = format!("R_AND_D_ANALYSIS:{suffix}");
    let principal = format!("analysis-completion-principal-{suffix}");
    let issuer = OperatorAuthorizationIssuerPostgresV1::connect_existing(
        database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
    )
    .await
    .expect("Analysis Operator Authorization issuer");
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("analysis-completion-authorization-{suffix}"),
            issuer_identity: issuer_identity.clone(),
            issuer_key_version: issuer_key_version.clone(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: audience.clone(),
                permissions: vec!["research:submit".to_string(), "research:view".to_string()],
            },
            request_proof_digest: request_proof_digest.clone(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().expect("manifest identity"),
                manifest_digest: manifest.manifest_digest().expect("manifest digest"),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: valid_through,
            expected_revocation_head: "EMPTY".to_string(),
        })
        .await
        .expect("Analysis Operator Authorization genesis");
    let deployment_identity = format!("analysis-completion-product-edge-{suffix}");
    let edge = ProductEdgePostgresOwnerV1::connect_existing(
        database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
        &deployment_identity,
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity,
            issuer_key_version,
            audience,
        },
    )
    .await
    .expect("Analysis Product Edge Owner");
    edge.bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
        deployment_identity,
        binding_identity: format!("analysis-completion-product-edge-binding-{suffix}"),
        expected_history_head: "EMPTY".to_string(),
        generation: 1,
        effective_principal: principal,
        scope_policy_version: "scope-v1".to_string(),
        capability_policy_version: "capability-v1".to_string(),
        audit_policy_version: "audit-v1".to_string(),
        valid_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: valid_through,
        authorization: authorization.locator(),
        manifests: vibe_product_edge::AgentOperationManifestSetV1::new(vec![manifest]).unwrap(),
    })
    .await
    .expect("Analysis Product Edge genesis");
    edge.admit_request(ProductEdgeAdmissionRequestV1 {
        request_identity: operation.analysis_request_identity.clone(),
        typed_payload: serde_json::to_value(operation).expect("Analysis completion payload"),
        operation: ITERATION_ANALYSIS_COMPLETION_OPERATION_V1.to_string(),
        operation_schema: ITERATION_ANALYSIS_COMPLETION_SCHEMA_V1.to_string(),
        target_owner: RESEARCH_OWNER_V1.to_string(),
        requested_effects: vec![ITERATION_ANALYSIS_COMPLETION_MUTATION_EFFECT_V1.to_string()],
        request_proof_digest,
        audit_correlation: format!("test:{}", operation.analysis_request_identity),
    })
    .await
    .expect("Analysis Product Edge admission")
    .locator()
    .clone()
}

async fn analysis_write_counts(pool: &PgPool, result_identity: &str) -> (i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT
          (SELECT COUNT(*) FROM rd_iteration_analysis_results_v1 WHERE result_identity=$1),
          (SELECT COUNT(*) FROM rd_iteration_decisions_v1 WHERE result_identity=$1),
          (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='RD_ITERATION_ANALYSIS_COMPLETED_V1' AND payload_json->>'result_identity'=$1),
          (SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE event_kind='ITERATION_DECISION_COMMITTED_V1' AND payload_json->>'result_identity'=$1)",
    )
    .bind(result_identity)
    .fetch_one(pool)
    .await
    .expect("analysis write counts")
}

#[tokio::test]
#[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
async fn analysis_request_completion_resolve_restart_and_tamper_are_atomic() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
    let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let suffix = unique_suffix();
    let committed_at = current_epoch_ms().expect("test clock");
    let market_data_evidence =
        issue_market_data_repair_evidence_v1().expect("sealed Market Data evidence");
    let harness = Box::pin(persist_repair_replay_predecessor(
        &database,
        &market_data_evidence,
        &suffix,
    ))
    .await;
    let replay = harness.predecessor.request().as_dto();
    let request_identity = harness.predecessor.request_identity().to_string();
    let request_digest = harness.predecessor.meaning_digest().to_string();
    let attempt_identity = format!("backtest-attempt-analysis-{suffix}");
    let semantic_trace_bytes = format!("canonical-analysis-semantic-trace-{suffix}").into_bytes();
    let mut result = positive_result(
        &request_identity,
        &request_digest,
        &attempt_identity,
        &harness.intent_identity,
        &harness.intent_digest,
        &suffix,
    );
    bind_positive_result_to_owner_outcome(&mut result, replay, &semantic_trace_bytes);
    let result_bytes = result
        .to_canonical_bytes()
        .expect("canonical Replay Result");
    let result_identity = result.result_identity.as_str().to_string();
    let result_digest = result.result_digest.as_str().to_string();
    let candidate_identity = format!("analysis-candidate-{suffix}");
    let candidate_set: TrialFamilyCandidateSetProposalV2 =
        serde_json::from_value(serde_json::json!({
            "generation_rule_identity": format!("analysis-generation-rule-{suffix}"),
            "generation_rule_digest": digest('c'),
            "expected_cardinality": 1,
            "candidates": [{
                "candidate_identity": candidate_identity,
                "experiment": IterationExperimentModeV1::SingleDimension {
                    changed_dimension: IterationHypothesisDimensionV1::ReturnMechanism,
                },
            }],
        }))
        .expect("analysis candidate set");
    let mut family_transaction = rd_pool.begin().await.expect("family transaction");
    append_trial_family_attempt_in_transaction(
        &mut family_transaction,
        &harness.intent_identity,
        &harness.research_receipt_identity,
        TrialFamilyAttemptAppendV2 {
            intent_identity: harness.intent_identity.clone(),
            intent_digest: harness.intent_digest.clone(),
            request_identity: request_identity.clone(),
            request_digest: request_digest.clone(),
            result_identity: result_identity.clone(),
            result_digest: result_digest.clone(),
            terminal_disposition: TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
            consumed_trial_budget: 1,
            candidate_set,
        },
        committed_at + 1,
    )
    .await
    .expect("terminal analysis attempt Census");
    family_transaction.commit().await.expect("family commit");
    persist_backtest_result(backtest_pool, &result, &result_bytes, committed_at + 2).await;
    persist_backtest_outcome_custody(
        backtest_pool,
        &result,
        &semantic_trace_bytes,
        &canonical_engine_result(),
        committed_at + 2,
    )
    .await;

    let locator = IterationAnalysisRequestLocatorV1 {
        trial_family_identity: harness.family_identity.clone(),
        result_identity: result_identity.clone(),
        request_identity: request_identity.clone(),
        attempt_identity: attempt_identity.clone(),
    };
    let request = compose_iteration_analysis_request_v1(&harness.owner, locator.clone())
        .await
        .expect("Owner-composed Analysis request");
    let request_retry = compose_iteration_analysis_request_v1(&harness.owner, locator.clone())
        .await
        .expect("exact Analysis request retry");
    assert_eq!(request_retry, request);
    let request_resolved = resolve_iteration_analysis_request_v1(
        &harness.owner,
        IterationAnalysisResolutionLocatorV1 {
            trial_family_identity: harness.family_identity.clone(),
            result_identity: result_identity.clone(),
            request_identity: request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
        },
    )
    .await
    .expect("Analysis request resolve")
    .expect("stored Analysis request");
    assert_eq!(request_resolved, request);
    let backtest_projection = serde_json::to_value(&request.request().input().backtest_projection)
        .expect("serialized Backtest projection");
    assert_eq!(
        backtest_projection["general_statistics"]["Max Drawdown"],
        serde_json::json!("bfc0000000000000")
    );
    assert_eq!(
        backtest_projection["pnl_statistics"]["USDT"]["PnL% (total)"],
        serde_json::json!("3fb999999999999a")
    );
    assert_eq!(
        backtest_projection["return_statistics"]["Sharpe Ratio (252 days)"],
        serde_json::json!("3ff8000000000000")
    );

    let mut census_transaction = rd_pool.begin().await.expect("Census transaction");
    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut census_transaction,
        &harness.family_identity,
    )
    .await
    .expect("analysis Candidate frontier Census");
    census_transaction.commit().await.expect("Census commit");
    let operation = completion_operation(
        &request,
        successor_candidate_evaluations(&census, &candidate_identity),
        &suffix,
    );
    let admission = admit_completion(&database, &operation, &suffix).await;
    let proposal: IterationAnalysisCompletionProposalV1 = operation
        .with_admission(admission)
        .expect("Product Edge admitted Analysis completion");
    let counts_before = analysis_write_counts(rd_pool, &result_identity).await;
    assert_eq!(counts_before, (0, 0, 0, 0));
    let mut tampered = proposal.clone();
    tampered.candidate_evaluations.candidates[0].candidate_digest = digest('f');
    assert!(matches!(
        compose_iteration_analysis_completion_v1(&harness.owner, tampered).await,
        Err(IterationAnalysisRequestErrorV1::Unavailable(_))
    ));
    assert_eq!(
        analysis_write_counts(rd_pool, &result_identity).await,
        counts_before,
        "rejected completion must write neither Analysis nor Decision custody"
    );

    let completion = compose_iteration_analysis_completion_v1(&harness.owner, proposal.clone())
        .await
        .expect("atomic Analysis and Decision completion");
    assert_eq!(
        completion.analysis().result().decision_identity(),
        completion.decision().decision().decision_identity()
    );
    assert_eq!(
        completion.next_action().decision_identity(),
        completion.decision().decision().decision_identity()
    );
    assert!(matches!(
        completion.next_action().action(),
        ResearchIterationActionV1::CreateSuccessorIntent { .. }
    ));
    assert_eq!(
        analysis_write_counts(rd_pool, &result_identity).await,
        (1, 1, 1, 1)
    );
    let completion_retry =
        compose_iteration_analysis_completion_v1(&harness.owner, proposal.clone())
            .await
            .expect("exact completion retry");
    assert_eq!(completion_retry, completion);
    assert_eq!(
        analysis_write_counts(rd_pool, &result_identity).await,
        (1, 1, 1, 1)
    );

    let completion_locator = IterationAnalysisCompletionResolutionLocatorV1 {
        analysis_result_identity: completion
            .analysis()
            .result()
            .analysis_result_identity()
            .to_string(),
        analysis_request_identity: request.request().analysis_request_identity().to_string(),
        result_identity: result_identity.clone(),
    };
    let resolved =
        resolve_iteration_analysis_completion_v1(&harness.owner, completion_locator.clone())
            .await
            .expect("completion resolve")
            .expect("stored completion");
    assert_eq!(resolved, completion);

    let restarted = crate::product_edge_postgres::PostgresResearchGoalOwnerV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
    )
    .await
    .expect("restarted R&D Owner");
    assert_eq!(
        resolve_iteration_analysis_request_v1(
            &restarted,
            IterationAnalysisResolutionLocatorV1 {
                trial_family_identity: harness.family_identity,
                result_identity: result_identity.clone(),
                request_identity,
                attempt_identity,
            },
        )
        .await
        .expect("restarted request resolve")
        .expect("restarted request readback"),
        request
    );
    let original_admission_digest = proposal.admission.admission_digest.clone();
    sqlx::query(
        "UPDATE product_edge_request_admissions_v1 SET admission_digest=$1 WHERE request_identity=$2",
    )
    .bind(digest('0'))
    .bind(&proposal.analysis_request_identity)
    .execute(product_edge_pool)
    .await
    .expect("tamper Analysis Product Edge admission digest");
    assert!(matches!(
        resolve_iteration_analysis_completion_v1(&restarted, completion_locator.clone()).await,
        Err(IterationAnalysisRequestErrorV1::Unavailable(_))
    ));
    sqlx::query(
        "UPDATE product_edge_request_admissions_v1 SET admission_digest=$1 WHERE request_identity=$2",
    )
    .bind(original_admission_digest)
    .bind(&proposal.analysis_request_identity)
    .execute(product_edge_pool)
    .await
    .expect("restore Analysis Product Edge admission digest");
    assert_eq!(
        resolve_iteration_analysis_completion_v1(&restarted, completion_locator)
            .await
            .expect("restarted completion resolve")
            .expect("restarted completion readback"),
        completion
    );
}
