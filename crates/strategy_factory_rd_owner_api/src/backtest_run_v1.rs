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
//! This is about the DATA path only. The production Composer (H5, "build this frozen Design into
//! a runnable Artifact") is not off-limits the same way: there is no other production build path,
//! and an authored-and-frozen Design (never run through Composer intake) composes through it the
//! same as any other frozen Design does (`tests.rs`'s
//! `the_authored_frozen_program_runs_the_production_composer`). `backtest.run` calls the Composer
//! once per run (`commit_custody_replay_v1`, gated behind the `composer-v3-replay` feature), then
//! commits a Composer-backed Replay request (H7) whose market-data locator is a `CustodyRun`,
//! never a `Snapshot` - H6 (the snapshot-only universe-member composition binding) has no custody
//! equivalent and is skipped entirely for this path.
//!
//! The replay step is injected the same way the native Replay scheduling resolver already is
//! elsewhere in this crate: the custody frames port
//! (`vibe_data::owner::pit_window_custody_v1::PitWindowCustodyFramesV1`) is opened once at
//! startup from `pit_window_custody_frames_from_store_admission_environment_v1` and threaded into
//! this route's state. A caller that still receives `None` (store admission unavailable in that
//! deployment) is answered `CustodyFramesNotAvailable` by name, not a panic or a silent gap.

use std::sync::Arc;

use sqlx::PgPool;
use vibe_data::owner::{
    bar_schedule::execution_timeframe_bar_label_v1,
    market_semantics_admission_v1::{
        MarketSemanticsAdmissionErrorV1, MarketSemanticsAdmissionV1,
        MarketSemanticsFactSubmissionV1, MarketSemanticsValueSubmissionV1,
    },
    pit_snapshot::PitSnapshotSubmissionV1,
    pit_window_custody_v1::{
        PitWindowCoverageRefusalV1, PitWindowCustodyFramesV1, PitWindowRunFramesV1,
        PitWindowRunRefusalV1, UntrustedPitWindowRunV1,
    },
    research_instrument_scope_v1::ResearchInstrumentScopeWireV1,
    resolve_research_pit_terminal_by_correlation_v1,
    source_binding::BindingDigest,
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
        StrategyInputBindingAdmissionV1,
    },
};
#[cfg(feature = "composer-v3-replay")]
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
};
#[cfg(feature = "composer-v3-replay")]
use vibe_product_edge::ProductEdgeAdmissionRequestV1;
use vibe_product_edge::{ProductEdgeError, ProductEdgePostgresOwnerV1};
use vibe_strategy_factory::{
    backtest_run_dataset_ref_v1::BacktestRunDatasetRefV1,
    native_replay_execution_input_binding_v1::ReplayCustodyRunBindingV1,
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
    strategy_catalog_postgres_v1::{PostgresStrategyCatalogV1, StrategyCatalogErrorV1},
    strategy_catalog_v1::{StrategyIdentityV1, StrategyStatementErrorV1, StrategyStatementV1},
};
#[cfg(feature = "composer-v3-replay")]
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::{
        ComposerBackedExploratoryReplayProposalV3, ComposerReplayMarketDataLocatorV3,
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V3, EXPLORATORY_REPLAY_OPERATION_V3,
        EXPLORATORY_REPLAY_SCHEMA_V3, ExploratoryReplayCommitResultV2, ExploratoryReplayOwnerError,
        ExploratoryReplayRequestLocatorV2,
    },
    native_replay_execution_input_binding_v1::NativeReplayExecutionInputBindingErrorV1,
    product_edge::RESEARCH_OWNER_V1,
    source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2,
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
    /// Admits the Market Semantics fact the run's own new PIT snapshot needs before role binding
    /// can resolve it (H2b): a fact is per-snapshot, not per-binding, so each run's snapshot needs
    /// its own, even over a Source Binding another run already has one for.
    pub(crate) market_semantics: Arc<dyn MarketSemanticsAdmissionV1>,
    /// Read directly (not through an Owner method) to resolve the run's own initial PIT
    /// terminal's submission and snapshot locator, the same way F's chain entry does.
    pub(crate) rd_pool: PgPool,
    /// `None` until Market Data's T0-5 derived view lands on main; see
    /// [`BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable`].
    pub(crate) custody_frames: Option<Arc<dyn PitWindowCustodyFramesV1>>,
    /// The production Composer (H5): builds this run's frozen Design into a runnable Artifact.
    /// `None` in a deployment that does not configure one; see
    /// [`BacktestRunReplayUnavailableV1::ComposerNotAvailable`].
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) develop_composer: Option<Arc<PostgresSourceResearchComposerProductionV2>>,
    /// H8 custody issuance's two remaining Owner dependencies (preparation, the custody frames
    /// port, and Product Edge admission are already covered by other fields above). `None` in a
    /// deployment that does not configure them; see
    /// [`BacktestRunReplayUnavailableV1::ReplayCommitted`]'s doc for what that means for
    /// `custody_binding`.
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) instrument_master_v2: Option<Arc<InstrumentMasterV2PostgresOwner>>,
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) instrument_economic_terms: Option<Arc<InstrumentEconomicTermsPostgresOwnerV1>>,
}

/// One `backtest.run` request.
pub(crate) struct BacktestRunRequestV1 {
    /// Unique per run: becomes the Research request's own identity (namespaced below), so a
    /// caller that reuses a strategy across many runs never reuses a Research goal - the freeze
    /// table's locator freezes exactly once, and a run's Design is this run's own.
    pub(crate) run_id: String,
    pub(crate) strategy_id: StrategyIdentityV1,
    pub(crate) dataset_ref: BacktestRunDatasetRefV1,
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
    /// `Some` once H8 custody issuance succeeds for this run - the signal report assembly waits
    /// for to re-read this run's bars at the pinned head.
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) custody_binding: Option<ReplayCustodyRunBindingV1>,
}

/// Why the replay step did not run. Each variant names exactly one missing or refusing
/// dependency, never a bare "unavailable": a caller reading this by name learns what to wait for.
#[derive(Debug)]
pub(crate) enum BacktestRunReplayUnavailableV1 {
    /// Nothing implements `PitWindowCustodyFramesV1` yet (Market Data's T0-5 derived view).
    CustodyFramesNotAvailable,
    /// T0-5 answered but refused this run's frames by name.
    CustodyFramesRefused(PitWindowRunRefusalV1),
    /// T0-5 answered with this run's frames, but this deployment does not build the
    /// `composer-v3-replay` feature, so nothing commits them further.
    #[cfg(not(feature = "composer-v3-replay"))]
    FramesResolvedNoConsumerYet(Box<PitWindowRunFramesV1>),
    /// Nothing implements the production Composer in this deployment.
    #[cfg(feature = "composer-v3-replay")]
    ComposerNotAvailable,
    /// The production Composer could not be reached to build this run's executable Artifact.
    #[cfg(feature = "composer-v3-replay")]
    ComposerBuildUnavailable(String),
    /// The production Composer refused to compose this run's frozen Design.
    #[cfg(feature = "composer-v3-replay")]
    ComposerBuildRefused(DevelopComposerOperationDispositionV2),
    /// The Composer answered `Success`, but its sealed read locator could not be formed from the
    /// response - a storage-level inconsistency, not a caller mistake.
    #[cfg(feature = "composer-v3-replay")]
    ComposerArtifactLocatorUnavailable(String),
    /// The accepted Research request carries no TrialFamily to commit this run's Replay under.
    #[cfg(feature = "composer-v3-replay")]
    TrialFamilyUnavailable,
    /// Product Edge did not admit this run's custody-backed Replay commit.
    #[cfg(feature = "composer-v3-replay")]
    ReplayAdmissionFailed(ProductEdgeError),
    /// The custody-backed Replay request (H7) could not be committed.
    #[cfg(feature = "composer-v3-replay")]
    ReplayCommitFailed(ExploratoryReplayOwnerError),
    /// The custody-backed Replay request committed; nothing refused after it. Check
    /// [`BacktestRunReachedReplayV1::custody_binding`] for whether H8 custody issuance also
    /// succeeded - `None` there means either this deployment does not configure the Owners H8
    /// needs, or issuance was never attempted for some other reason this variant does not
    /// distinguish from a clean stop.
    #[cfg(feature = "composer-v3-replay")]
    ReplayCommitted(Box<ExploratoryReplayCommitResultV2>),
    /// The custody-backed Replay request committed, but H8 custody issuance was attempted and
    /// refused.
    #[cfg(feature = "composer-v3-replay")]
    CustodyIssuanceFailed(NativeReplayExecutionInputBindingErrorV1),
}

/// Why `run_backtest_v1` did not reach the replay step.
#[derive(Debug)]
pub(crate) enum BacktestRunErrorV1 {
    /// The dataset_ref's execution timeframe has no bar label Market Data declares, so no input
    /// role can be stated over it.
    ExecutionTimeframeUndeclared,
    /// Market Data names no one custody chain covering the dataset_ref's window, by its own
    /// refusal. Checked before anything is written, so the run id can be submitted again once the
    /// window is backfilled.
    CustodyCoverageRefused(PitWindowCoverageRefusalV1),
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
    /// The run's own initial PIT terminal could not be read back (the raw query F's own chain
    /// entry uses, or the frozen submission bytes it names failed to decode).
    PitTerminalUnreadable(String),
    /// Market Data holds no committed intake for the correlation this run's terminal names.
    PitTerminalNotCommitted,
    /// The run's own PIT snapshot has no `AVAILABLE` locator to admit a Market Semantics fact
    /// against.
    PitSnapshotNotLocatable,
    /// Reading the Source Binding's current compatibility scope value failed.
    MarketSemanticsScopeUnavailable(String),
    /// Admitting the run's own Market Semantics fact failed.
    MarketSemanticsAdmissionFailed(MarketSemanticsAdmissionErrorV1),
    /// The accepted goal's authoring facts could not be read back.
    AuthoringFactsUnavailable(ResearchBoundedFeatureProgramOwnerErrorV1),
    /// The catalog statement does not author into a program, under its family's own refusal.
    AuthoringFailed(StrategyStatementErrorV1),
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
    let timeframe = execution_timeframe_bar_label_v1(request.dataset_ref.execution_timeframe())
        .ok_or(BacktestRunErrorV1::ExecutionTimeframeUndeclared)?;
    let custody_run = resolve_custody_run_v1(owners, &request.dataset_ref).await?;
    let statement = fetch_strategy_statement_v1(&owners.catalog, request.strategy_id).await?;
    let research_request_identity = format!("backtest-run:{}", request.run_id);
    let accepted = submit_backtest_research_goal_v1(
        owners,
        &research_request_identity,
        &statement,
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

    admit_market_semantics_for_run_v1(owners, &research_request_identity).await?;

    let facts = owners
        .bounded_feature_program
        .read_research_authoring_facts_v1(&research_request_identity)
        .await
        .map_err(BacktestRunErrorV1::AuthoringFactsUnavailable)?;
    let (design, meaning) = statement
        .author(
            facts.research_request_identity,
            facts.intent_identity,
            facts.intent_digest,
            timeframe,
        )
        .map_err(BacktestRunErrorV1::AuthoringFailed)?;

    let role_intent = owners
        .bounded_feature_program
        .publish_design_role_intent(&research_request_identity, &design)
        .await
        .map_err(BacktestRunErrorV1::RoleIntentPublicationFailed)?;
    let design_identity = role_intent.design_identity();

    let _bindings: StrategyInputBindingAdmissionTerminalV1 = match custody_run {
        Some(run) => owners
            .strategy_input_bindings
            .admit_published_design_over_custody_run(design_identity, run)
            .await
            .map_err(BacktestRunErrorV1::StrategyInputBindingFailed)?,
        None => owners
            .strategy_input_bindings
            .admit_published_design(design_identity)
            .await
            .map_err(BacktestRunErrorV1::StrategyInputBindingFailed)?,
    };

    let freeze = owners
        .bounded_feature_program
        .declare(ResearchBoundedFeatureProgramDeclarationV1 {
            research_request_locator: research_request_identity.clone(),
            design,
            meaning,
        })
        .await
        .map_err(BacktestRunErrorV1::FreezeFailed)?;

    #[cfg_attr(not(feature = "composer-v3-replay"), allow(unused_variables))]
    let (reason, custody_binding) = resolve_replay_v1(
        owners,
        &request.run_id,
        &research_request_identity,
        &accepted,
        custody_run,
        &request.request_proof_digest,
    )
    .await;
    Ok(BacktestRunReachedReplayV1 {
        research_request_identity,
        design_identity,
        freeze,
        reason,
        #[cfg(feature = "composer-v3-replay")]
        custody_binding,
    })
}

async fn fetch_strategy_statement_v1(
    catalog: &PostgresStrategyCatalogV1,
    strategy_id: StrategyIdentityV1,
) -> Result<StrategyStatementV1, BacktestRunErrorV1> {
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
/// the Design this run authors (which carries the catalog's `falsifier` unchanged, in either
/// statement family) restates exactly what this goal's Research
/// Intent froze. A mismatch there is what `publish_design_role_intent` would refuse by name.
async fn submit_backtest_research_goal_v1(
    owners: &BacktestRunOwnersV1,
    research_request_identity: &str,
    statement: &StrategyStatementV1,
    dataset_ref: &BacktestRunDatasetRefV1,
    request_proof_digest: &str,
) -> Result<ResearchGoalOwnerResultV2, BacktestRunErrorV1> {
    let goal = SourcedResearchGoalV2 {
        hypothesis: format!(
            "The catalogued strategy decides a position over {} at {}.",
            dataset_ref.instrument(),
            dataset_ref.execution_timeframe(),
        ),
        mechanism: match statement {
            StrategyStatementV1::SingleThreshold(_) => {
                "A single-threshold program compares one channel against a fixed threshold."
            }
            StrategyStatementV1::Authored(_) => {
                "An authoring-language document compiled into one bounded feature program."
            }
        }
        .to_owned(),
        falsification_question: statement.falsifier().to_owned(),
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

/// Admits the Market Semantics fact this run's own new PIT snapshot needs before role binding
/// can resolve it (H2b). A fact is per-snapshot, not per-Source-Binding: each run opens its own
/// initial PIT request (a fresh snapshot), so each run admits its own fact, even over a binding
/// another run already has one for.
///
/// Reads the run's own initial PIT terminal directly - the same raw query F's own chain entry
/// uses - because no Owner method wraps it; the read is otherwise identical to F's H2/H2b.
async fn admit_market_semantics_for_run_v1(
    owners: &BacktestRunOwnersV1,
    research_request_identity: &str,
) -> Result<(), BacktestRunErrorV1> {
    let (correlation, submission_bytes): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT attempt.correlation_identity, attempt.submission_bytes
           FROM rd_research_initial_pit_terminals_v1 terminal
           JOIN rd_research_initial_pit_attempts_v1 attempt
             ON attempt.request_identity = terminal.request_identity
            AND attempt.attempt_ordinal = terminal.attempt_ordinal
          WHERE terminal.request_identity = $1",
    )
    .bind(research_request_identity)
    .fetch_one(&owners.rd_pool)
    .await
    .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(e.to_string()))?;
    let submission = PitSnapshotSubmissionV1::from_json_value_v1(
        serde_json::from_slice(&submission_bytes)
            .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(e.to_string()))?,
    )
    .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(format!("{e:?}")))?;
    let correlation =
        BindingDigest::from_untrusted_bytes(correlation.as_slice().try_into().map_err(|_| {
            BacktestRunErrorV1::PitTerminalUnreadable("correlation is not 32 bytes".to_owned())
        })?);

    let mut read = owners
        .rd_pool
        .begin()
        .await
        .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(e.to_string()))?;
    let held = resolve_research_pit_terminal_by_correlation_v1(&mut read, correlation)
        .await
        .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(e.to_string()))?
        .ok_or(BacktestRunErrorV1::PitTerminalNotCommitted)?;
    read.rollback()
        .await
        .map_err(|e| BacktestRunErrorV1::PitTerminalUnreadable(e.to_string()))?;
    let pit_snapshot = held
        .terminal()
        .locator()
        .ok_or(BacktestRunErrorV1::PitSnapshotNotLocatable)?
        .clone();

    let scope_value = owners
        .research
        .read_market_semantics_scope_value_v1(&submission.source_binding)
        .await
        .map_err(|e| BacktestRunErrorV1::MarketSemanticsScopeUnavailable(e.to_string()))?;
    let value = scope_value
        .value()
        .cloned()
        .unwrap_or_else(default_market_semantics_value_v1);

    owners
        .market_semantics
        .admit_fact(MarketSemanticsFactSubmissionV1 {
            source_binding: submission.source_binding,
            pit_snapshot,
            value,
        })
        .await
        .map_err(BacktestRunErrorV1::MarketSemanticsAdmissionFailed)?;
    Ok(())
}

/// The statement a scope with no head yet takes, matching F's own H2b fallback: raw price and
/// size, event-effective timestamps.
fn default_market_semantics_value_v1() -> MarketSemanticsValueSubmissionV1 {
    MarketSemanticsValueSubmissionV1 {
        normalization_identity: BindingDigest::from_untrusted_bytes([0x6e; 32]),
        price_adjustment: "RAW".to_owned(),
        timestamp_basis: "EVENT_EFFECTIVE".to_owned(),
        price_unit_identity: BindingDigest::from_untrusted_bytes([0x70; 32]),
        size_unit_identity: BindingDigest::from_untrusted_bytes([0x73; 32]),
    }
}

/// Names the custody run that serves this dataset_ref: Market Data's one chain holding the
/// instrument alone at the execution timeframe and covering the whole window, its current head
/// pinned. The caller names a plain dataset and never a chain. `None` when this deployment has no
/// custody frames port, which the replay step answers by name.
async fn resolve_custody_run_v1(
    owners: &BacktestRunOwnersV1,
    dataset_ref: &BacktestRunDatasetRefV1,
) -> Result<Option<UntrustedPitWindowRunV1>, BacktestRunErrorV1> {
    let Some(resolver) = owners.custody_frames.as_ref() else {
        return Ok(None);
    };
    resolver
        .resolve_pit_window_run_for_window_v1(
            dataset_ref.instrument(),
            dataset_ref.execution_timeframe(),
            dataset_ref.window_start_ns(),
            dataset_ref.window_end_ns_exclusive(),
        )
        .await
        .map(Some)
        .map_err(BacktestRunErrorV1::CustodyCoverageRefused)
}

/// Resolves this run's custody run into its frames, then hands them to
/// [`commit_custody_replay_v1`] (gated behind the `composer-v3-replay` feature; see that
/// function's doc for what it does and its no-op fallback otherwise). The second element is
/// `Some` only once H8 custody issuance succeeds.
async fn resolve_replay_v1(
    owners: &BacktestRunOwnersV1,
    run_id: &str,
    research_request_identity: &str,
    accepted: &ResearchGoalOwnerResultV2,
    custody_run: Option<UntrustedPitWindowRunV1>,
    request_proof_digest: &str,
) -> (
    BacktestRunReplayUnavailableV1,
    Option<ReplayCustodyRunBindingV1>,
) {
    let (Some(resolver), Some(run)) = (owners.custody_frames.as_ref(), custody_run) else {
        return (
            BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable,
            None,
        );
    };
    let run_start_ns = run.run_start_ns;
    let run_end_ns_exclusive = run.run_end_ns_exclusive;
    let frames = match resolver.resolve_pit_window_frames_v1(run).await {
        Ok(frames) => frames,
        Err(refusal) => {
            return (
                BacktestRunReplayUnavailableV1::CustodyFramesRefused(refusal),
                None,
            );
        }
    };
    commit_custody_replay_v1(
        owners,
        run_id,
        research_request_identity,
        accepted,
        frames,
        run_start_ns,
        run_end_ns_exclusive,
        request_proof_digest,
    )
    .await
}

/// Builds this run's executable Artifact through the production Composer (H5), commits a
/// Composer-backed Replay request (H7) whose market-data locator is a `CustodyRun` - never a
/// `Snapshot`, since H6 (the snapshot-only universe-member composition binding) has no custody
/// equivalent and is skipped entirely for this path - then issues the custody-run
/// execution-input binding (H8). The second element of the return is `Some` only once H8
/// succeeds.
///
/// The frozen-Design-to-executable-Artifact step is the one call (`run_bounded_feature_program`,
/// below) the user authorized retiring later (plan (ii): the host interprets the Bounded Feature
/// Program directly once T0 is reproduced - see `docs/architecture/strategy-factory.md`'s "Host
/// interpretation of the Bounded Feature Program"); when that lands, only this one call changes.
#[cfg(feature = "composer-v3-replay")]
#[allow(clippy::too_many_arguments)]
async fn commit_custody_replay_v1(
    owners: &BacktestRunOwnersV1,
    run_id: &str,
    research_request_identity: &str,
    accepted: &ResearchGoalOwnerResultV2,
    frames: PitWindowRunFramesV1,
    run_start_ns: u64,
    run_end_ns_exclusive: u64,
    request_proof_digest: &str,
) -> (
    BacktestRunReplayUnavailableV1,
    Option<ReplayCustodyRunBindingV1>,
) {
    let Some(composer) = owners.develop_composer.as_ref() else {
        return (BacktestRunReplayUnavailableV1::ComposerNotAvailable, None);
    };
    let response =
        match Box::pin(composer.run_bounded_feature_program(research_request_identity)).await {
            Ok(response) => response,
            Err(e) => {
                return (
                    BacktestRunReplayUnavailableV1::ComposerBuildUnavailable(e.to_string()),
                    None,
                );
            }
        };

    if response.disposition != DevelopComposerOperationDispositionV2::Success {
        return (
            BacktestRunReplayUnavailableV1::ComposerBuildRefused(response.disposition),
            None,
        );
    }
    let composer_locator =
        match DevelopComposerSealedReadLocatorV2::from_accepted_response(&response) {
            Ok(locator) => locator,
            Err(e) => {
                return (
                    BacktestRunReplayUnavailableV1::ComposerArtifactLocatorUnavailable(format!(
                        "{e:?}"
                    )),
                    None,
                );
            }
        };

    let Some(family) = accepted.trial_family() else {
        return (BacktestRunReplayUnavailableV1::TrialFamilyUnavailable, None);
    };

    let replay_request_identity = format!("{run_id}-replay");
    let market_data_locator = ComposerReplayMarketDataLocatorV3::CustodyRun {
        chain_root: frames.chain_root(),
        head_identity: frames.head_identity(),
        run_start_ns,
        run_end_ns_exclusive,
    };
    // The custody chain's own compatibility-scope identity stands in for the snapshot path's
    // Source Binding scope digest - `compose_composer_backed_custody_replay_request_v3` checks
    // this proposal field against exactly `frames.basis().market_semantics_identity()`.
    let market_data_scope_digest = frames.basis().market_semantics_identity();
    let typed_payload = serde_json::json!({
        "request_identity": replay_request_identity,
        "trial_family_identity": family.root().trial_family_identity(),
        "artifact_identity": composer_locator.artifact_locator,
        "composer_locator": composer_locator,
        "market_data_locator": market_data_locator,
        "market_data_scope_digest": market_data_scope_digest,
    });
    let admission = match owners
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: replay_request_identity.clone(),
            typed_payload,
            operation: EXPLORATORY_REPLAY_OPERATION_V3.to_owned(),
            operation_schema: EXPLORATORY_REPLAY_SCHEMA_V3.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            requested_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V3.to_owned()],
            request_proof_digest: request_proof_digest.to_owned(),
            audit_correlation: format!("rd-workbench:{replay_request_identity}"),
        })
        .await
    {
        Ok(admission) => admission,
        Err(e) => {
            return (
                BacktestRunReplayUnavailableV1::ReplayAdmissionFailed(e),
                None,
            );
        }
    };

    let proposal = ComposerBackedExploratoryReplayProposalV3 {
        admission: admission.locator().clone(),
        request_identity: replay_request_identity,
        trial_family_identity: family.root().trial_family_identity().to_owned(),
        artifact_identity: composer_locator.artifact_locator.clone(),
        composer_locator,
        market_data_locator,
        market_data_scope_digest,
    };

    let result = match owners
        .research
        .commit_composer_backed_exploratory_replay_request_v3(
            proposal,
            owners.custody_frames.as_deref(),
        )
        .await
    {
        Ok(result) => result,
        Err(e) => return (BacktestRunReplayUnavailableV1::ReplayCommitFailed(e), None),
    };

    let custody_binding = issue_custody_run_binding_v1(
        owners,
        result.locator(),
        composer.as_ref(),
        ReplayCustodyRunBindingV1 {
            chain_root: *frames.chain_root().as_bytes(),
            head_identity: *frames.head_identity().as_bytes(),
            run_start_ns,
            run_end_ns_exclusive,
        },
    )
    .await;

    match custody_binding {
        Ok(binding) => (
            BacktestRunReplayUnavailableV1::ReplayCommitted(Box::new(result)),
            Some(binding),
        ),
        Err(None) => (
            BacktestRunReplayUnavailableV1::ReplayCommitted(Box::new(result)),
            None,
        ),
        Err(Some(e)) => (
            BacktestRunReplayUnavailableV1::CustodyIssuanceFailed(e),
            None,
        ),
    }
}

/// Issues H8's custody-run execution-input binding, or `Err(None)` when this deployment does not
/// configure the Owners it needs (not itself a refusal, same as [`ComposerNotAvailable`] for H5).
///
/// [`ComposerNotAvailable`]: BacktestRunReplayUnavailableV1::ComposerNotAvailable
#[cfg(feature = "composer-v3-replay")]
async fn issue_custody_run_binding_v1<P>(
    owners: &BacktestRunOwnersV1,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    run: ReplayCustodyRunBindingV1,
) -> Result<ReplayCustodyRunBindingV1, Option<NativeReplayExecutionInputBindingErrorV1>>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
{
    let (Some(instrument_master_v2), Some(instrument_economic_terms), Some(custody_frames)) = (
        owners.instrument_master_v2.as_ref(),
        owners.instrument_economic_terms.as_ref(),
        owners.custody_frames.as_ref(),
    ) else {
        return Err(None);
    };
    owners
        .research
        .issue_native_replay_execution_input_binding_from_custody_run_v1(
            locator,
            composer,
            instrument_master_v2,
            instrument_economic_terms,
            custody_frames.as_ref(),
            run,
        )
        .await
        .map(|_readback| run)
        .map_err(Some)
}

/// Without `composer-v3-replay`, nothing can commit a Replay request from resolved frames; this
/// is the same stopping point `resolve_replay_v1` always answered before this slice.
#[cfg(not(feature = "composer-v3-replay"))]
#[allow(clippy::too_many_arguments)]
async fn commit_custody_replay_v1(
    _owners: &BacktestRunOwnersV1,
    _run_id: &str,
    _research_request_identity: &str,
    _accepted: &ResearchGoalOwnerResultV2,
    frames: PitWindowRunFramesV1,
    _run_start_ns: u64,
    _run_end_ns_exclusive: u64,
    _request_proof_digest: &str,
) -> (
    BacktestRunReplayUnavailableV1,
    Option<ReplayCustodyRunBindingV1>,
) {
    (
        BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(Box::new(frames)),
        None,
    )
}
