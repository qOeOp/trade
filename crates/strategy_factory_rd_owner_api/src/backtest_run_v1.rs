//! `backtest.run`'s own production orchestration: given an already-catalogued strategy and a
//! dataset_ref, open and freeze the one-off Design a run needs, then resolve the dataset_ref
//! against Market Data's T0 window custody and hand the result to the replay step.
//!
//! Per the phase-3 integration plan, `backtest.run` goes straight through the T0 custody path
//! (`vibe_data::owner::pit_window_custody_v1`) and does not build a production path on the
//! single-frame snapshot pipeline F exercises: that pipeline's BAR-schedule proposer (H4b in
//! `first_composer_v3_replay_acceptance.rs`) is a production stub, and backtest.run must not add
//! a second one.
//!
//! The replay step is injected the same way the native Replay scheduling resolver already is
//! elsewhere in this crate: nothing implements Market Data's T0-5 derived view
//! (`PitWindowCustodyFramesV1`) yet, so a caller that does not supply one is answered
//! `CustodyFramesNotAvailable` by name, not a panic or a silent gap. This keeps the orchestration
//! driven today, up to the exact point the dependency is missing, rather than structurally
//! complete and never exercised.

use std::sync::Arc;

use vibe_data::owner::{
    pit_window_custody_v1::{
        PitWindowCustodyFramesV1, PitWindowRunFramesV1, PitWindowRunRefusalV1,
        UntrustedPitWindowCustodyClaimV1, UntrustedPitWindowRunV1,
    },
    research_instrument_scope_v1::ResearchInstrumentScopeWireV1,
    source_binding::BindingDigest,
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
        StrategyInputBindingAdmissionV1,
    },
};
use vibe_product_edge::{ProductEdgeError, ProductEdgePostgresOwnerV1};
use vibe_strategy_factory::{
    backtest_run_dataset_ref_v1::BacktestRunDatasetRefV1,
    product_edge::{
        ProductEdgeChannel, ProductEdgeResolution, ResearchGoalOwnerError,
        ResearchGoalOwnerResultV2, ResearchSourceV1, SourcedResearchGoalV2, TrialFamilyProposalV1,
    },
    product_edge_postgres::{
        PostgresResearchGoalOwnerV1,
        research_initial_pit::{MarketDataInitialPitPortsV1, ResearchInitialPitErrorV1},
    },
    rd_bounded_feature_program_postgres_v1::{
        PostgresResearchBoundedFeatureProgramOwnerV1, ResearchBoundedFeatureProgramDeclarationV1,
        ResearchBoundedFeatureProgramFreezeReceiptV1, ResearchBoundedFeatureProgramOwnerErrorV1,
    },
    research_initial_pit_v1::ResearchInitialPitV1,
    single_threshold_authoring_v1::{
        SingleThresholdAuthoringErrorV1, author_single_threshold_program_v1,
    },
    strategy_catalog_postgres_v1::{PostgresStrategyCatalogV1, StrategyCatalogErrorV1},
    strategy_catalog_v1::{SingleThresholdStrategySpecV1, StrategyIdentityV1},
};

use crate::research_goal_submission::{
    ResearchGoalSubmissionErrorV1, ResearchGoalSubmissionOutcomeV1,
    submit_research_goal_v2_in_process,
};

/// Everything `backtest.run` needs already open: one connection per Owner it calls in process,
/// bundled once by whoever starts the server (or the chain entry that drives this orchestration).
pub(crate) struct BacktestRunOwnersV1 {
    pub(crate) catalog: Arc<PostgresStrategyCatalogV1>,
    pub(crate) product_edge: Arc<ProductEdgePostgresOwnerV1>,
    pub(crate) research: Arc<PostgresResearchGoalOwnerV1>,
    pub(crate) bounded_feature_program: Arc<PostgresResearchBoundedFeatureProgramOwnerV1>,
    pub(crate) strategy_input_bindings: Arc<dyn StrategyInputBindingAdmissionV1>,
    /// Market Data's two admission ports, needed to issue the run's initial PIT request (H2):
    /// bound to an already-admitted instrument and Source Binding, the same ones every run's
    /// instrument scope must already be eligible under.
    pub(crate) market_data_initial_pit: MarketDataInitialPitPortsV1,
    /// `None` until Market Data's T0-5 derived view lands on main; see
    /// [`BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable`].
    pub(crate) custody_frames: Option<Arc<dyn PitWindowCustodyFramesV1>>,
}

/// One `backtest.run` request.
pub(crate) struct BacktestRunRequestV1 {
    /// Unique per run: becomes the Research request's own identity (namespaced below), so a
    /// caller that reuses a strategy across many runs never reuses a Research goal - the freeze
    /// table's locator freezes exactly once, and a run's Design is this run's own.
    pub(crate) run_id: String,
    pub(crate) strategy_id: StrategyIdentityV1,
    pub(crate) dataset_ref: BacktestRunDatasetRefV1,
    /// The custody chain this run's window is read from. Market Data has no production lookup
    /// from a `dataset_ref` to a chain yet (that is T0-5's own job); until it does, the caller
    /// supplies the chain it already knows serves this dataset_ref.
    pub(crate) custody: UntrustedPitWindowCustodyClaimV1,
    /// The caller's own signed proof that it holds authority for `run_id`, passed through to
    /// Product Edge unchanged.
    pub(crate) request_proof_digest: String,
}

/// What the orchestration reached once the Design is authored, bound and frozen, immediately
/// before the replay step - the one call `backtest.run` cannot complete today.
pub(crate) struct BacktestRunReachedReplayV1 {
    pub(crate) research_request_identity: String,
    pub(crate) design_identity: BindingDigest,
    pub(crate) freeze: ResearchBoundedFeatureProgramFreezeReceiptV1,
    pub(crate) reason: BacktestRunReplayUnavailableV1,
}

/// Why the replay step did not run. Each variant names exactly one missing or refusing
/// dependency, never a bare "unavailable": a caller reading this by name learns what to wait for.
pub(crate) enum BacktestRunReplayUnavailableV1 {
    /// Nothing implements `PitWindowCustodyFramesV1` yet (Market Data's T0-5 derived view).
    CustodyFramesNotAvailable,
    /// T0-5 answered but refused this run's frames by name.
    CustodyFramesRefused(PitWindowRunRefusalV1),
    /// T0-5 answered with this run's frames, but nothing implements Lane 6's T1 consumer yet, so
    /// there is still nothing to run them through.
    FramesResolvedNoConsumerYet(Box<PitWindowRunFramesV1>),
}

/// Why `run_backtest_v1` did not reach the replay step.
pub(crate) enum BacktestRunErrorV1 {
    /// The catalog has no strategy under this identity.
    StrategyUnknown,
    /// The strategy is archived.
    StrategyArchived,
    /// The catalog could not be read.
    CatalogUnavailable(StrategyCatalogErrorV1),
    /// The stored statement is not the JSON this orchestration can decode - the catalog's own
    /// write path admits only canonical bytes, so this names a storage-level corruption, not a
    /// caller mistake.
    StrategySpecUndecodable(serde_json::Error),
    /// Product Edge admission preflight could not be read.
    AdmissionPreflightUnavailable(ResearchGoalOwnerError),
    /// Product Edge did not admit the run's Research request.
    AdmissionFailed(ProductEdgeError),
    /// The Research request's identity names a request this Owner's custody quarantined under
    /// the legacy shape; no admission was attempted.
    AdmissionLegacyQuarantined,
    /// The R&D Owner refused the Research request itself.
    GoalSubmissionFailed(ResearchGoalOwnerError),
    /// The Research request was not accepted (rejected, submitted-or-unknown, an identity
    /// conflict, or a legacy-quarantined terminal) - carries the Owner's own resolution.
    GoalNotAccepted(ProductEdgeResolution),
    /// The run's initial PIT request could not be issued or resolved.
    InitialPitFailed(ResearchInitialPitErrorV1),
    /// The initial PIT request was issued but is not yet an available terminal (still submitted
    /// or unknown, or a terminal naming a different disposition).
    InitialPitNotAvailable(ResearchInitialPitV1),
    /// The accepted goal's authoring facts could not be read back.
    AuthoringFactsUnavailable(ResearchBoundedFeatureProgramOwnerErrorV1),
    /// The catalog statement does not author into a program (an indistinguishable-outcomes
    /// threshold, an empty identifier, …).
    AuthoringFailed(SingleThresholdAuthoringErrorV1),
    /// Publishing the Design's role intent failed.
    RoleIntentPublicationFailed(ResearchBoundedFeatureProgramOwnerErrorV1),
    /// Binding the Design's roles to Market Data's input series failed.
    StrategyInputBindingFailed(StrategyInputBindingAdmissionErrorV1),
    /// Freezing the program failed.
    FreezeFailed(ResearchBoundedFeatureProgramOwnerErrorV1),
}

/// Runs `backtest.run`'s orchestration up to, but not through, the replay step: fetch the
/// catalogued strategy, open one new Research goal for this run, author and freeze its Design,
/// bind its roles to Market Data's input series, then resolve the run's dataset_ref against T0
/// window custody.
///
/// # Errors
///
/// See [`BacktestRunErrorV1`]; each variant names the one step that did not complete.
pub(crate) async fn run_backtest_v1(
    owners: &BacktestRunOwnersV1,
    request: BacktestRunRequestV1,
) -> Result<BacktestRunReachedReplayV1, BacktestRunErrorV1> {
    let spec = fetch_strategy_spec_v1(&owners.catalog, request.strategy_id).await?;
    let research_request_identity = format!("backtest-run:{}", request.run_id);
    let accepted = submit_backtest_research_goal_v1(
        owners,
        &research_request_identity,
        &spec,
        &request.dataset_ref,
        &request.request_proof_digest,
    )
    .await?;

    if accepted.resolution() != ProductEdgeResolution::Accepted {
        return Err(BacktestRunErrorV1::GoalNotAccepted(accepted.resolution()));
    }

    let initial_pit = owners
        .research
        .issue_research_initial_pit_v1(&research_request_identity, &owners.market_data_initial_pit)
        .await
        .map_err(BacktestRunErrorV1::InitialPitFailed)?;

    if !matches!(
        initial_pit,
        ResearchInitialPitV1::Terminal {
            disposition: vibe_data::owner::pit_market_snapshot_intake_v1::PitMarketSnapshotDispositionV1::Available,
            ..
        }
    ) {
        return Err(BacktestRunErrorV1::InitialPitNotAvailable(initial_pit));
    }

    let facts = owners
        .bounded_feature_program
        .read_research_authoring_facts_v1(&research_request_identity)
        .await
        .map_err(BacktestRunErrorV1::AuthoringFactsUnavailable)?;
    let (design, meaning) = author_single_threshold_program_v1(&spec.authoring_request(
        facts.research_request_identity,
        facts.intent_identity,
        facts.intent_digest,
    ))
    .map_err(BacktestRunErrorV1::AuthoringFailed)?;

    let role_intent = owners
        .bounded_feature_program
        .publish_design_role_intent(&research_request_identity, &design)
        .await
        .map_err(BacktestRunErrorV1::RoleIntentPublicationFailed)?;
    let design_identity = role_intent.design_identity();

    let _bindings: StrategyInputBindingAdmissionTerminalV1 = owners
        .strategy_input_bindings
        .admit_published_design(design_identity)
        .await
        .map_err(BacktestRunErrorV1::StrategyInputBindingFailed)?;

    let freeze = owners
        .bounded_feature_program
        .declare(ResearchBoundedFeatureProgramDeclarationV1 {
            research_request_locator: research_request_identity.clone(),
            design,
            meaning,
        })
        .await
        .map_err(BacktestRunErrorV1::FreezeFailed)?;

    let reason = resolve_replay_v1(owners, &request.dataset_ref, request.custody).await;
    Ok(BacktestRunReachedReplayV1 {
        research_request_identity,
        design_identity,
        freeze,
        reason,
    })
}

async fn fetch_strategy_spec_v1(
    catalog: &PostgresStrategyCatalogV1,
    strategy_id: StrategyIdentityV1,
) -> Result<SingleThresholdStrategySpecV1, BacktestRunErrorV1> {
    let record = catalog
        .get(strategy_id)
        .await
        .map_err(BacktestRunErrorV1::CatalogUnavailable)?
        .ok_or(BacktestRunErrorV1::StrategyUnknown)?;
    if record.archived_at_epoch_ms.is_some() {
        return Err(BacktestRunErrorV1::StrategyArchived);
    }
    serde_json::from_slice(&record.spec_bytes).map_err(BacktestRunErrorV1::StrategySpecUndecodable)
}

/// Opens the one Research goal this run freezes its Design under.
///
/// The goal's narrative fields (hypothesis, mechanism, …) carry no catalog equivalent and are a
/// fixed convention for every backtest.run-originated goal, distinct from a human-authored one -
/// except `falsification_question`, set to the catalog statement's own `falsifier` verbatim, so
/// the Design this run authors (which carries the catalog's `falsifier` unchanged,
/// `SingleThresholdStrategySpecV1::authoring_request`) restates exactly what this goal's Research
/// Intent froze. A mismatch there is what `publish_design_role_intent` would refuse by name.
async fn submit_backtest_research_goal_v1(
    owners: &BacktestRunOwnersV1,
    research_request_identity: &str,
    spec: &SingleThresholdStrategySpecV1,
    dataset_ref: &BacktestRunDatasetRefV1,
    request_proof_digest: &str,
) -> Result<ResearchGoalOwnerResultV2, BacktestRunErrorV1> {
    let goal = SourcedResearchGoalV2 {
        hypothesis: format!(
            "The catalogued strategy decides a position over {} at {}.",
            dataset_ref.instrument(),
            dataset_ref.execution_timeframe(),
        ),
        mechanism: "A single-threshold program compares one channel against a fixed threshold."
            .to_owned(),
        falsification_question: spec.falsifier.clone(),
        expected_observation: "The program's decisions are exactly the fixed statement's."
            .to_owned(),
        required_data: vec![format!(
            "PIT {} bars of {}",
            dataset_ref.execution_timeframe(),
            dataset_ref.instrument()
        )],
        cost_assumption: "backtest.run's own cost model.".to_owned(),
        capacity_assumption: "backtest.run's own capacity model.".to_owned(),
        sources: vec![ResearchSourceV1 {
            // Research sources must be either an https:// URL or a urn: - validate_goal_fields
            // (crates/strategy_factory/src/product_edge.rs) refuses any other scheme by name.
            locator: "urn:backtest-run:v1".to_owned(),
            content_digest: format!("sha256:{}", "0".repeat(64)),
            observed_at: "2026-10-04T00:00:00Z".to_owned(),
            source_cut: "backtest-run-v1".to_owned(),
            license_basis: "internal".to_owned(),
            interpretation: "A mechanically opened goal, not a human research narrative."
                .to_owned(),
        }],
    };
    let trial_family_proposal = TrialFamilyProposalV1 {
        trial_budget: 1,
        stop_rule: "The one attempt backtest.run makes.".to_owned(),
        // The Replay Policy Catalog V3 head pins its own policy model profile to these exact
        // identities (crates/strategy_factory/src/replay_policy_catalog_postgres_v2.rs); a
        // TrialFamily whose proposal names anything else is refused as "Catalog policy model
        // profile does not match TrialFamily policy" (measured on a CI chain probe, 10-04).
        pit_rule_identity: "pit-rule-v1".to_owned(),
        cost_model_identity: "cost-model-v1".to_owned(),
        slippage_model_identity: "slippage-model-v1".to_owned(),
        capacity_model_identity: "capacity-model-v1".to_owned(),
        independence_rationale: "Each run opens its own goal; none shares a trial family."
            .to_owned(),
    };
    let instrument_scope = ResearchInstrumentScopeWireV1 {
        schema_version: 1,
        identities: vec![dataset_ref.instrument().to_owned()],
    };
    let outcome = submit_research_goal_v2_in_process(
        &owners.product_edge,
        &owners.research,
        request_proof_digest,
        research_request_identity.to_owned(),
        ProductEdgeChannel::TradeProductEdge,
        goal,
        trial_family_proposal,
        Some(instrument_scope),
    )
    .await;

    match outcome {
        Ok(ResearchGoalSubmissionOutcomeV1::Submitted(result)) => Ok(*result),
        Ok(ResearchGoalSubmissionOutcomeV1::LegacyQuarantined) => {
            Err(BacktestRunErrorV1::AdmissionLegacyQuarantined)
        }
        Err(ResearchGoalSubmissionErrorV1::PreflightUnavailable(e)) => {
            Err(BacktestRunErrorV1::AdmissionPreflightUnavailable(e))
        }
        Err(ResearchGoalSubmissionErrorV1::Admission(e)) => {
            Err(BacktestRunErrorV1::AdmissionFailed(e))
        }
        Err(ResearchGoalSubmissionErrorV1::Submission(e)) => {
            Err(BacktestRunErrorV1::GoalSubmissionFailed(e))
        }
    }
}

async fn resolve_replay_v1(
    owners: &BacktestRunOwnersV1,
    dataset_ref: &BacktestRunDatasetRefV1,
    custody: UntrustedPitWindowCustodyClaimV1,
) -> BacktestRunReplayUnavailableV1 {
    let Some(resolver) = owners.custody_frames.as_ref() else {
        return BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable;
    };
    let run = UntrustedPitWindowRunV1 {
        custody,
        run_start_ns: dataset_ref.window_start_ns(),
        run_end_ns_exclusive: dataset_ref.window_end_ns_exclusive(),
    };

    match resolver.resolve_pit_window_frames_v1(run).await {
        Ok(frames) => BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(Box::new(frames)),
        Err(refusal) => BacktestRunReplayUnavailableV1::CustodyFramesRefused(refusal),
    }
}
