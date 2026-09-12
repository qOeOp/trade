//! Backtest-owned coordination contract for request-bound native Replay V2 execution.
//!
//! A production preparation Owner does not exist yet. The sealed port below fixes the only admitted
//! handoff: one exact R&D request readback, one move-only target-set execution bundle, a complete
//! 28-component Owner-observation package, and the inputs needed to derive semantic-trace evidence
//! from the actual ProgramHost/Sim EVENT readback. Until an Owner implementation can produce that
//! handoff, no production caller can enter the runner.

use std::{collections::BTreeSet, future::Future, pin::Pin, sync::Arc};

use serde::Serialize;
use sqlx::PgPool;
use thiserror::Error;
use vibe_strategy_factory::{
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    native_replay_preparation_owner_v2::NativeReplayExecutionPreparationResolverV2,
    program_host_sim_event_consumer_v1::{
        ProgramHostSimEventReadbackV1, run_program_host_sim_event_consumer_v1,
    },
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
};

use crate::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ConsumedComponentObservationV2,
    DiagnosticCategoryV2, DiagnosticEvidenceV2, ObservationComponentV2, OpaqueIdentityV2,
    OwnerResultDraftV2, ReplayConsumptionObservationV2, ReplayOwnerErrorV2, ReplayTerminalV2,
    SealedReplayResultV2, commit_owner_result,
    native_replay_evidence_custody::{
        NativeReplayEvidenceBatchReadbackV2, NativeReplayEvidenceDraftV2,
        SealedNativeReplayEvidenceBatchV2,
    },
    outcome_evidence::{BacktestOutcomeEvidenceOwnerErrorV1, SealedBacktestOutcomeEvidenceV1},
    postgres::{
        BacktestOutcomeEvidenceReadbackV1, NativeReplayAggregateCommitRecoveryV2,
        PostgresReplayResultOwnerErrorV2, PostgresReplayResultOwnerV2, ReplayResultReadbackV2,
    },
    requested_component_meanings,
};

const OWNER_OBSERVATION_BYTES_DOMAIN_V2: &[u8] = b"vibe.backtest.owner-observation-bytes.v2\0";
const SEMANTIC_TRACE_BYTES_DOMAIN_V2: &[u8] = b"vibe.backtest.native-semantic-trace.v2\0";

pub(crate) mod admitted_preparation_owner {
    pub trait Sealed {}
}

/// One precise producer-owned observation for a requested Replay component.
///
/// Construction is crate-private and the type is move-only. The canonical bytes must be the exact
/// bytes retained at `locator`; the runner independently hashes them before accepting the package.
pub struct NativeReplayComponentEvidenceV2 {
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    component: ObservationComponentV2,
    producer_namespace: OpaqueIdentityV2,
    locator: ComponentObservationLocatorV2,
    canonical_observation_bytes: Vec<u8>,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
}

impl NativeReplayComponentEvidenceV2 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_owner_observation(
        request_identity: OpaqueIdentityV2,
        request_meaning_digest: CanonicalDigestV2,
        attempt_identity: OpaqueIdentityV2,
        component: ObservationComponentV2,
        producer_namespace: OpaqueIdentityV2,
        locator: ComponentObservationLocatorV2,
        canonical_observation_bytes: Vec<u8>,
        observed_meaning_identity: OpaqueIdentityV2,
        observed_meaning_digest: CanonicalDigestV2,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
            attempt_identity,
            component,
            producer_namespace,
            locator,
            canonical_observation_bytes,
            observed_meaning_identity,
            observed_meaning_digest,
        }
    }
}

/// Move-only evidence inputs which can be finalized only with the actual native execution readback.
pub struct NativeReplaySemanticTraceEvidenceV2 {
    observation_reference: OpaqueIdentityV2,
    execution_profile_binding_digest: [u8; 32],
    native_materialization_digest: [u8; 32],
    deterministic_fill_seed: u64,
    instance_identity: OpaqueIdentityV2,
}

/// Sealed canonical semantic-trace bytes derived from one actual native EVENT run.
///
/// This value is move-only and has no public constructor or deserializer. The final Owner must
/// persist these exact bytes under `locator` in the same re-lock boundary as the Result aggregate.
pub struct SealedNativeReplaySemanticTraceV2 {
    locator: ComponentObservationLocatorV2,
    canonical_bytes: Vec<u8>,
    canonical_bytes_digest: CanonicalDigestV2,
}

impl SealedNativeReplaySemanticTraceV2 {
    #[must_use]
    pub fn locator(&self) -> &ComponentObservationLocatorV2 {
        &self.locator
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub fn canonical_bytes_digest(&self) -> &CanonicalDigestV2 {
        &self.canonical_bytes_digest
    }
}

/// Owner readback of semantic-trace bytes persisted with an acknowledged Result commit.
///
/// Construction remains crate-private so only the sealed preparation Owner can attest persistence.
pub struct NativeReplaySemanticTraceReadbackV2 {
    locator: ComponentObservationLocatorV2,
    canonical_bytes: Vec<u8>,
    canonical_bytes_digest: CanonicalDigestV2,
}

impl NativeReplaySemanticTraceReadbackV2 {
    pub(crate) fn from_owner_readback(
        locator: ComponentObservationLocatorV2,
        canonical_bytes: Vec<u8>,
        canonical_bytes_digest: CanonicalDigestV2,
    ) -> Self {
        Self {
            locator,
            canonical_bytes,
            canonical_bytes_digest,
        }
    }
}

struct FinalizedNativeReplaySemanticTraceV2 {
    observation: ConsumedComponentObservationV2,
    sealed: SealedNativeReplaySemanticTraceV2,
}

impl NativeReplaySemanticTraceEvidenceV2 {
    pub(crate) fn from_owner_materialization(
        observation_reference: OpaqueIdentityV2,
        execution_profile_binding_digest: [u8; 32],
        native_materialization_digest: [u8; 32],
        deterministic_fill_seed: u64,
        instance_identity: OpaqueIdentityV2,
    ) -> Self {
        Self {
            observation_reference,
            execution_profile_binding_digest,
            native_materialization_digest,
            deterministic_fill_seed,
            instance_identity,
        }
    }

    fn finalize(
        self,
        request_identity: &OpaqueIdentityV2,
        request_meaning_digest: &CanonicalDigestV2,
        attempt_identity: &OpaqueIdentityV2,
        execution: &ProgramHostSimEventReadbackV1,
    ) -> Result<FinalizedNativeReplaySemanticTraceV2, NativeReplayRunErrorV2> {
        let census = execution.consumption_census();
        if census.execution_profile_binding_digest() != self.execution_profile_binding_digest
            || census.native_materialization_digest() != self.native_materialization_digest
            || execution.actual_fills().is_empty()
            || execution
                .actual_fills()
                .iter()
                .any(|fill| fill.checkpoint_before() == fill.checkpoint_after())
        {
            return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
        }
        let bytes = serde_json::to_vec(&SemanticTraceObservationV2 {
            schema_version: 2,
            request_identity,
            request_meaning_digest,
            attempt_identity,
            deterministic_fill_seed: self.deterministic_fill_seed,
            instance_identity: &self.instance_identity,
            execution,
        })
        .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
        let digest = digest_bytes(SEMANTIC_TRACE_BYTES_DOMAIN_V2, &bytes)?;
        let meaning_identity = OpaqueIdentityV2::try_from(format!(
            "backtest-semantic-trace-v2-{}",
            digest.as_str().trim_start_matches("blake3:")
        ))
        .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
        let locator = ComponentObservationLocatorV2 {
            component: ObservationComponentV2::SemanticTrace,
            reference: self.observation_reference,
            digest: digest.clone(),
        };
        let observation = ConsumedComponentObservationV2::from_owner_evidence(
            request_identity.clone(),
            request_meaning_digest.clone(),
            attempt_identity.clone(),
            ObservationComponentV2::SemanticTrace,
            locator.clone(),
            meaning_identity,
            digest.clone(),
        );
        Ok(FinalizedNativeReplaySemanticTraceV2 {
            observation,
            sealed: SealedNativeReplaySemanticTraceV2 {
                locator,
                canonical_bytes: bytes,
                canonical_bytes_digest: digest,
            },
        })
    }
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct SemanticTraceObservationV2<'a> {
    schema_version: u16,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    attempt_identity: &'a OpaqueIdentityV2,
    deterministic_fill_seed: u64,
    instance_identity: &'a OpaqueIdentityV2,
    execution: &'a ProgramHostSimEventReadbackV1,
}

/// Complete move-only input to one Backtest-owned execution attempt.
pub struct NativeReplayPreparationV2 {
    request: SealedExploratoryReplayReadbackV2,
    execution: ReplayTargetSetExecutionBundleV1,
    component_evidence: Vec<NativeReplayComponentEvidenceV2>,
    semantic_trace_evidence: NativeReplaySemanticTraceEvidenceV2,
}

impl NativeReplayPreparationV2 {
    pub(crate) fn from_owner_resolution(
        request: SealedExploratoryReplayReadbackV2,
        execution: ReplayTargetSetExecutionBundleV1,
        component_evidence: Vec<NativeReplayComponentEvidenceV2>,
        semantic_trace_evidence: NativeReplaySemanticTraceEvidenceV2,
    ) -> Self {
        Self {
            request,
            execution,
            component_evidence,
            semantic_trace_evidence,
        }
    }
}

/// Sealed preparation and final re-lock port admitted for native Replay V2.
///
/// The future production implementation must own the R&D database capability and resolve all
/// family, Instrument Owner, Plan, Artifact, universe, and scheduling facts itself. The final method
/// must re-lock the same request and relevant revocation/drift facts, atomically persist the supplied
/// semantic-trace bytes with the Backtest Result, and return both readbacks from that boundary. It
/// may not reconstruct or replace either artifact independently.
pub trait NativeReplayPreparationOwnerV2: admitted_preparation_owner::Sealed + Send + Sync {
    fn prepare_exploratory_replay_v2<'a>(
        &'a self,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        attempt_identity: &'a OpaqueIdentityV2,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<NativeReplayPreparationV2, NativeReplayRunErrorV2>>
                + Send
                + 'a,
        >,
    >;

    fn relock_and_commit_exploratory_replay_v2<'a>(
        &'a self,
        result_owner: &'a PostgresReplayResultOwnerV2,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        result: &'a SealedReplayResultV2,
        evidence_batch: &'a SealedNativeReplayEvidenceBatchV2,
        semantic_trace: &'a SealedNativeReplaySemanticTraceV2,
        outcome_evidence: &'a SealedBacktestOutcomeEvidenceV1,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        NativeReplayCommitDispositionV2,
                        PostgresReplayResultOwnerErrorV2,
                    >,
                > + Send
                + 'a,
        >,
    >;
}

/// Backtest preparation Owner backed by one sealed Strategy Factory resolver and R&D connection.
///
/// The resolver owns preparation of the request-bound execution and producer evidence. This Owner
/// converts that handoff into Backtest-private evidence types and retains the R&D connection for
/// the final request re-lock performed inside the Backtest Result transaction.
pub struct PostgresNativeReplayPreparationOwnerV2 {
    rd_pool: PgPool,
    resolver: Arc<dyn NativeReplayExecutionPreparationResolverV2>,
}

impl PostgresNativeReplayPreparationOwnerV2 {
    #[must_use]
    pub fn new(
        rd_pool: PgPool,
        resolver: Arc<dyn NativeReplayExecutionPreparationResolverV2>,
    ) -> Self {
        Self { rd_pool, resolver }
    }
}

impl admitted_preparation_owner::Sealed for PostgresNativeReplayPreparationOwnerV2 {}

impl NativeReplayPreparationOwnerV2 for PostgresNativeReplayPreparationOwnerV2 {
    fn prepare_exploratory_replay_v2<'a>(
        &'a self,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        attempt_identity: &'a OpaqueIdentityV2,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<NativeReplayPreparationV2, NativeReplayRunErrorV2>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            let prepared = self
                .resolver
                .resolve_native_replay_execution_preparation_v2(locator, attempt_identity)
                .await
                .map_err(|_| NativeReplayRunErrorV2::ExecutionBundleOwnerUnavailable)?;
            let (
                request,
                execution,
                observations,
                semantic_trace_reference,
                deterministic_fill_seed,
                instance_identity,
            ) = prepared.into_parts();
            validate_request_readback(&request, locator)?;
            validate_execution_request_locator(execution.request_locator(), locator)?;
            let request_meaning_digest = request
                .request()
                .meaning_digest()
                .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
            let execution_profile_binding_digest = execution.execution_profile_binding_digest();
            let native_materialization_digest = execution.native_materialization_digest();
            let component_evidence = observations
                .into_iter()
                .map(|observation| {
                    let (
                        component,
                        producer_namespace,
                        producer_reference,
                        canonical_bytes,
                        observed_meaning_identity,
                        observed_meaning_digest,
                    ) = observation.into_parts();
                    let observation_digest =
                        digest_bytes(OWNER_OBSERVATION_BYTES_DOMAIN_V2, &canonical_bytes)?;
                    Ok(NativeReplayComponentEvidenceV2::from_owner_observation(
                        request.request().request_identity().clone(),
                        request_meaning_digest.clone(),
                        attempt_identity.clone(),
                        component,
                        producer_namespace,
                        ComponentObservationLocatorV2 {
                            component,
                            reference: producer_reference,
                            digest: observation_digest,
                        },
                        canonical_bytes,
                        observed_meaning_identity,
                        observed_meaning_digest,
                    ))
                })
                .collect::<Result<Vec<_>, NativeReplayRunErrorV2>>()?;
            Ok(NativeReplayPreparationV2::from_owner_resolution(
                request,
                execution,
                component_evidence,
                NativeReplaySemanticTraceEvidenceV2::from_owner_materialization(
                    semantic_trace_reference,
                    execution_profile_binding_digest,
                    native_materialization_digest,
                    deterministic_fill_seed,
                    instance_identity,
                ),
            ))
        })
    }

    fn relock_and_commit_exploratory_replay_v2<'a>(
        &'a self,
        result_owner: &'a PostgresReplayResultOwnerV2,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        result: &'a SealedReplayResultV2,
        evidence_batch: &'a SealedNativeReplayEvidenceBatchV2,
        semantic_trace: &'a SealedNativeReplaySemanticTraceV2,
        outcome_evidence: &'a SealedBacktestOutcomeEvidenceV1,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        NativeReplayCommitDispositionV2,
                        PostgresReplayResultOwnerErrorV2,
                    >,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            result_owner
                .commit_request_bound_native_replay_evidence_v2(
                    &self.rd_pool,
                    locator,
                    result,
                    evidence_batch,
                    semantic_trace,
                    outcome_evidence,
                )
                .await
        })
    }
}

/// Acknowledged native Replay commit with exact semantic-trace persistence evidence.
#[must_use = "the caller must distinguish an acknowledged commit from SubmittedOrUnknown"]
pub enum NativeReplayCommitDispositionV2 {
    /// Both the Result aggregate and byte-identical semantic trace were committed and read back.
    Committed {
        result: Box<ReplayResultReadbackV2>,
        evidence_batch: NativeReplayEvidenceBatchReadbackV2,
        semantic_trace: NativeReplaySemanticTraceReadbackV2,
        outcome_evidence: BacktestOutcomeEvidenceReadbackV1,
    },
    /// The atomic submission was made, but its outcome was not acknowledged.
    SubmittedOrUnknown(NativeReplayAggregateCommitRecoveryV2),
}

/// Fail-closed outcomes from the Backtest-owned native Replay V2 coordinator.
#[derive(Debug, Error)]
pub enum NativeReplayRunErrorV2 {
    #[error(
        "R&D Owner has no admitted request-to-ReplayTargetSetExecutionBundleV1 preparation capability"
    )]
    ExecutionBundleOwnerUnavailable,
    #[error("native Replay V2 evidence is incomplete, duplicated, mismatched, or unresolvable")]
    IncompleteReconciliation,
    #[error("ProgramHostV2 to Sim EVENT native execution failed: {0}")]
    NativeExecution(String),
    #[error("Backtest Owner rejected the actual-consumption Result: {0}")]
    ResultConstruction(#[from] ReplayOwnerErrorV2),
    #[error("Backtest Owner rejected the actual outcome evidence: {0}")]
    OutcomeEvidenceConstruction(#[from] BacktestOutcomeEvidenceOwnerErrorV1),
    #[error("Backtest Result custody failed: {0}")]
    ResultCommit(#[from] PostgresReplayResultOwnerErrorV2),
}

/// Runs and commits one exact exploratory Replay V2 attempt.
///
/// The caller supplies only admitted Owner handles, the exact four-field request locator, and the
/// explicit attempt identity. The complete 28-component package is checked before the move-only
/// execution bundle is consumed. Native execution failure, missing fills or checkpoint evidence,
/// incomplete reconciliation, and final re-lock/commit drift produce no durable Result.
///
/// A successful runtime entry requires the production Strategy Factory resolver behind
/// `PostgresNativeReplayPreparationOwnerV2`; missing resolution remains fail closed.
pub async fn run_exploratory_replay_v2<P: NativeReplayPreparationOwnerV2 + ?Sized>(
    preparation_owner: &P,
    result_owner: &PostgresReplayResultOwnerV2,
    locator: &ExploratoryReplayRequestLocatorV2,
    attempt_identity: OpaqueIdentityV2,
) -> Result<NativeReplayCommitDispositionV2, NativeReplayRunErrorV2> {
    let prepared = preparation_owner
        .prepare_exploratory_replay_v2(locator, &attempt_identity)
        .await?;
    let prepared_commit = execute_native_replay_preparation(prepared, locator, &attempt_identity)?;
    let disposition = preparation_owner
        .relock_and_commit_exploratory_replay_v2(
            result_owner,
            locator,
            &prepared_commit.result,
            &prepared_commit.evidence_batch,
            &prepared_commit.semantic_trace,
            &prepared_commit.outcome_evidence,
        )
        .await
        .map_err(NativeReplayRunErrorV2::from)?;
    validate_committed_readbacks(
        disposition,
        &prepared_commit.result,
        &prepared_commit.evidence_batch,
        &prepared_commit.semantic_trace,
        &prepared_commit.outcome_evidence,
    )
}

struct PreparedNativeReplayCommitV2 {
    result: SealedReplayResultV2,
    evidence_batch: SealedNativeReplayEvidenceBatchV2,
    semantic_trace: SealedNativeReplaySemanticTraceV2,
    outcome_evidence: SealedBacktestOutcomeEvidenceV1,
}

fn execute_native_replay_preparation(
    prepared: NativeReplayPreparationV2,
    locator: &ExploratoryReplayRequestLocatorV2,
    attempt_identity: &OpaqueIdentityV2,
) -> Result<PreparedNativeReplayCommitV2, NativeReplayRunErrorV2> {
    let NativeReplayPreparationV2 {
        request,
        execution,
        component_evidence,
        semantic_trace_evidence,
    } = prepared;
    validate_request_readback(&request, locator)?;
    let request_meaning_digest = request
        .request()
        .meaning_digest()
        .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
    let component_evidence = validate_component_evidence_inputs(
        request.request(),
        &request_meaning_digest,
        attempt_identity,
        component_evidence,
    )?;
    validate_execution_request_locator(execution.request_locator(), locator)?;

    let execution_readback = run_program_host_sim_event_consumer_v1(execution)
        .map_err(|error| NativeReplayRunErrorV2::NativeExecution(error.to_string()))?;
    validate_execution_request_locator(
        execution_readback.consumption_census().request_locator(),
        locator,
    )?;
    let (mut observations, evidence_batch) = seal_component_evidence_after_event(
        &execution_readback,
        locator,
        request.request(),
        &request_meaning_digest,
        attempt_identity,
        component_evidence,
    )?;
    let semantic_trace = semantic_trace_evidence.finalize(
        request.request().request_identity(),
        &request_meaning_digest,
        attempt_identity,
        &execution_readback,
    )?;
    let FinalizedNativeReplaySemanticTraceV2 {
        observation,
        sealed: semantic_trace,
    } = semantic_trace;
    let decisive_evidence = observation.locator().clone();
    observations.push(observation);
    let result = commit_owner_result(
        request.request(),
        OwnerResultDraftV2 {
            attempt_identity: attempt_identity.clone(),
            terminal: ReplayTerminalV2::TerminalResult,
            observations,
            diagnostics: vec![DiagnosticEvidenceV2::from_native_execution(
                request.request().request_identity().clone(),
                request_meaning_digest,
                attempt_identity.clone(),
                DiagnosticCategoryV2::NoExecutionDefect,
                decisive_evidence,
            )],
        },
    )?;
    let outcome_evidence =
        SealedBacktestOutcomeEvidenceV1::seal(&result, &execution_readback, &semantic_trace)?;
    Ok(PreparedNativeReplayCommitV2 {
        result,
        evidence_batch,
        semantic_trace,
        outcome_evidence,
    })
}

fn validate_committed_readbacks(
    disposition: NativeReplayCommitDispositionV2,
    expected_result: &SealedReplayResultV2,
    expected_evidence_batch: &SealedNativeReplayEvidenceBatchV2,
    expected_semantic_trace: &SealedNativeReplaySemanticTraceV2,
    expected_outcome_evidence: &SealedBacktestOutcomeEvidenceV1,
) -> Result<NativeReplayCommitDispositionV2, NativeReplayRunErrorV2> {
    match &disposition {
        NativeReplayCommitDispositionV2::Committed {
            result,
            evidence_batch,
            semantic_trace,
            outcome_evidence,
        } => {
            validate_result_readback(result, expected_result)?;
            validate_evidence_batch_readback(evidence_batch, expected_evidence_batch)?;
            validate_semantic_trace_readback(semantic_trace, expected_semantic_trace)?;
            validate_outcome_evidence_readback(outcome_evidence, expected_outcome_evidence)?;
        }
        NativeReplayCommitDispositionV2::SubmittedOrUnknown(_) => {}
    }
    Ok(disposition)
}

fn validate_outcome_evidence_readback(
    actual: &BacktestOutcomeEvidenceReadbackV1,
    expected: &SealedBacktestOutcomeEvidenceV1,
) -> Result<(), NativeReplayRunErrorV2> {
    if actual.evidence() != expected.evidence()
        || actual.evidence_canonical_bytes() != expected.evidence_canonical_bytes()
        || actual.canonical_result_bytes() != expected.canonical_result_bytes()
    {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(())
}

fn validate_evidence_batch_readback(
    actual: &NativeReplayEvidenceBatchReadbackV2,
    expected: &SealedNativeReplayEvidenceBatchV2,
) -> Result<(), NativeReplayRunErrorV2> {
    if actual.envelopes().len() != expected.envelopes().len() {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    for (actual, expected) in actual.envelopes().iter().zip(expected.envelopes()) {
        if actual.component() != expected.component()
            || actual.envelope_locator() != expected.envelope_locator()
            || actual.canonical_bytes() != expected.canonical_bytes()
            || actual.producer_bytes() != expected.producer_bytes()
            || actual.producer_bytes_digest() != expected.producer_bytes_digest()
        {
            return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
        }
    }
    Ok(())
}

fn validate_result_readback(
    actual: &ReplayResultReadbackV2,
    expected: &SealedReplayResultV2,
) -> Result<(), NativeReplayRunErrorV2> {
    let expected_bytes = expected
        .to_canonical_bytes()
        .map_err(NativeReplayRunErrorV2::ResultConstruction)?;
    let actual_result = actual.result();
    if !result_canonical_bytes_match(actual.result_canonical_bytes(), &expected_bytes)
        || &actual_result.result_identity != expected.result_identity()
        || &actual_result.result_digest != expected.result_digest()
        || &actual_result.request_identity != expected.request_identity()
        || &actual_result.request_meaning_digest != expected.request_meaning_digest()
        || actual_result.namespace != expected.namespace()
        || &actual_result.attempt_identity != expected.attempt_identity()
        || actual_result.terminal != expected.terminal()
    {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(())
}

fn result_canonical_bytes_match(actual: &[u8], expected: &[u8]) -> bool {
    actual == expected
}

fn validate_semantic_trace_readback(
    actual: &NativeReplaySemanticTraceReadbackV2,
    expected: &SealedNativeReplaySemanticTraceV2,
) -> Result<(), NativeReplayRunErrorV2> {
    let recomputed = digest_bytes(SEMANTIC_TRACE_BYTES_DOMAIN_V2, &actual.canonical_bytes)?;
    if actual.locator != expected.locator
        || actual.canonical_bytes != expected.canonical_bytes
        || actual.canonical_bytes_digest != expected.canonical_bytes_digest
        || recomputed != expected.canonical_bytes_digest
        || actual.locator.digest != actual.canonical_bytes_digest
    {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(())
}

fn validate_request_readback(
    request: &SealedExploratoryReplayReadbackV2,
    locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<(), NativeReplayRunErrorV2> {
    let canonical = request
        .request()
        .to_canonical_bytes()
        .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
    if request.locator() != *locator
        || request.canonical_request_bytes() != canonical
        || request.request_identity() != locator.request_identity
        || request.meaning_digest() != locator.meaning_digest
        || request.receipt_identity() != locator.receipt_identity
        || request.seal_digest() != locator.seal_digest
    {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(())
}

fn validate_execution_request_locator(
    actual: &ExploratoryReplayRequestLocatorV2,
    expected: &ExploratoryReplayRequestLocatorV2,
) -> Result<(), NativeReplayRunErrorV2> {
    if actual != expected {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(())
}

fn validate_component_evidence_inputs(
    request: &crate::ReplayRequestV2,
    request_meaning_digest: &CanonicalDigestV2,
    attempt_identity: &OpaqueIdentityV2,
    evidence: Vec<NativeReplayComponentEvidenceV2>,
) -> Result<Vec<NativeReplayComponentEvidenceV2>, NativeReplayRunErrorV2> {
    if evidence.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    let requested = requested_component_meanings(request)?;
    let mut seen = BTreeSet::new();
    for item in &evidence {
        let Some(expected) = requested.get(&item.component) else {
            return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
        };
        let observation_digest = digest_bytes(
            OWNER_OBSERVATION_BYTES_DOMAIN_V2,
            &item.canonical_observation_bytes,
        )?;
        if item.canonical_observation_bytes.is_empty()
            || item.request_identity != *request.request_identity()
            || item.request_meaning_digest != *request_meaning_digest
            || item.attempt_identity != *attempt_identity
            || item.locator.component != item.component
            || item.locator.digest != observation_digest
            || item.observed_meaning_identity != expected.identity
            || item.observed_meaning_digest != expected.digest
            || !seen.insert(item.component)
        {
            return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
        }
    }
    if seen.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    Ok(evidence)
}

/// The only bridge which can turn prepared producer inputs into a custody batch.
/// It is crate-private and requires the successful EVENT readback from this invocation.
fn seal_component_evidence_after_event(
    execution: &ProgramHostSimEventReadbackV1,
    request_locator: &ExploratoryReplayRequestLocatorV2,
    request: &crate::ReplayRequestV2,
    request_meaning_digest: &CanonicalDigestV2,
    attempt_identity: &OpaqueIdentityV2,
    evidence: Vec<NativeReplayComponentEvidenceV2>,
) -> Result<
    (
        Vec<ConsumedComponentObservationV2>,
        SealedNativeReplayEvidenceBatchV2,
    ),
    NativeReplayRunErrorV2,
> {
    validate_execution_request_locator(
        execution.consumption_census().request_locator(),
        request_locator,
    )?;
    if execution.actual_fills().is_empty() {
        return Err(NativeReplayRunErrorV2::IncompleteReconciliation);
    }
    let drafts = evidence
        .into_iter()
        .map(|item| NativeReplayEvidenceDraftV2 {
            request_locator: request_locator.clone(),
            attempt_identity: item.attempt_identity,
            component: item.component,
            producer_namespace: item.producer_namespace,
            producer_reference: item.locator.reference,
            producer_bytes: item.canonical_observation_bytes,
            observed_meaning_identity: item.observed_meaning_identity,
            observed_meaning_digest: item.observed_meaning_digest,
        })
        .collect();
    let batch = SealedNativeReplayEvidenceBatchV2::seal(
        request_locator.clone(),
        attempt_identity.clone(),
        drafts,
    )
    .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)?;
    let observations = batch
        .envelopes()
        .iter()
        .map(|item| {
            ConsumedComponentObservationV2::from_owner_evidence(
                request.request_identity().clone(),
                request_meaning_digest.clone(),
                attempt_identity.clone(),
                item.component(),
                item.envelope_locator().clone(),
                item.observed_meaning_identity().clone(),
                item.observed_meaning_digest().clone(),
            )
        })
        .collect();
    Ok((observations, batch))
}

fn digest_bytes(domain: &[u8], bytes: &[u8]) -> Result<CanonicalDigestV2, NativeReplayRunErrorV2> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(|_| NativeReplayRunErrorV2::IncompleteReconciliation)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_byte_digest_is_domain_separated_and_exact() {
        let first = digest_bytes(OWNER_OBSERVATION_BYTES_DOMAIN_V2, b"owner observation").unwrap();
        let repeated =
            digest_bytes(OWNER_OBSERVATION_BYTES_DOMAIN_V2, b"owner observation").unwrap();
        let changed = digest_bytes(
            OWNER_OBSERVATION_BYTES_DOMAIN_V2,
            b"owner observation changed",
        )
        .unwrap();
        let semantic = digest_bytes(SEMANTIC_TRACE_BYTES_DOMAIN_V2, b"owner observation").unwrap();
        assert_eq!(first, repeated);
        assert_ne!(first, changed);
        assert_ne!(first, semantic);
    }

    #[test]
    fn cross_request_execution_locator_is_rejected() {
        let request_a = request_locator("request-a", "receipt-a", 'a');
        let mut request_b = request_a.clone();
        request_b.receipt_identity = "receipt-b".to_owned();

        assert!(validate_execution_request_locator(&request_a, &request_a).is_ok());
        assert!(matches!(
            validate_execution_request_locator(&request_b, &request_a),
            Err(NativeReplayRunErrorV2::IncompleteReconciliation)
        ));
    }

    #[test]
    fn committed_semantic_trace_requires_byte_identical_owner_readback() {
        let bytes = b"actual EVENT semantic trace".to_vec();
        let digest = digest_bytes(SEMANTIC_TRACE_BYTES_DOMAIN_V2, &bytes).unwrap();
        let locator = ComponentObservationLocatorV2 {
            component: ObservationComponentV2::SemanticTrace,
            reference: OpaqueIdentityV2::try_from("trace-reference".to_owned()).unwrap(),
            digest: digest.clone(),
        };
        let expected = SealedNativeReplaySemanticTraceV2 {
            locator: locator.clone(),
            canonical_bytes: bytes.clone(),
            canonical_bytes_digest: digest.clone(),
        };
        let exact = NativeReplaySemanticTraceReadbackV2::from_owner_readback(
            locator.clone(),
            bytes,
            digest.clone(),
        );
        assert!(validate_semantic_trace_readback(&exact, &expected).is_ok());

        let substituted = NativeReplaySemanticTraceReadbackV2::from_owner_readback(
            locator,
            b"substituted semantic trace".to_vec(),
            digest,
        );
        assert!(matches!(
            validate_semantic_trace_readback(&substituted, &expected),
            Err(NativeReplayRunErrorV2::IncompleteReconciliation)
        ));
    }

    #[test]
    fn committed_result_requires_this_invocations_canonical_result_bytes() {
        let current = br#"{"schema_version":2,"result_identity":"result-current"}"#;
        let stale = br#"{"schema_version":2,"result_identity":"result-stale"}"#;

        assert!(result_canonical_bytes_match(current, current));
        assert!(!result_canonical_bytes_match(stale, current));
    }

    fn request_locator(
        request: &str,
        receipt: &str,
        digest_byte: char,
    ) -> ExploratoryReplayRequestLocatorV2 {
        ExploratoryReplayRequestLocatorV2 {
            request_identity: request.to_owned(),
            meaning_digest: format!("blake3:{}", digest_byte.to_string().repeat(64)),
            receipt_identity: receipt.to_owned(),
            seal_digest: format!("blake3:{}", digest_byte.to_string().repeat(64)),
        }
    }
}
