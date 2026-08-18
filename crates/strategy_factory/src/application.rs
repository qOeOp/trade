use std::{
    cell::RefCell, collections::BTreeMap, fmt::Debug, fs, io::Read, path::Path, rc::Rc,
    str::FromStr,
};

use anyhow::Context;
use serde::Serialize;
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
    result::CanonicalBacktestResult,
};
use vibe_binance::common::offline::authenticate_monthly_kline_dataset;
use vibe_common::{actor::DataActorNative, component::Component, logging::logger::LoggerConfig};
use vibe_data::dataset::CanonicalDatasetManifest;
use vibe_model::{
    data::{BarType, Data, HasTsInit},
    enums::{AccountType, BookType, OmsType},
    identifiers::{StrategyId, Venue},
    instruments::{InstrumentAny, stubs::currency_pair_btcusdt},
    types::Money,
};
use vibe_trading::strategy::{Strategy, StrategyNative};

use crate::{
    artifact::StrategyArtifact,
    binance_program_application::{BoundBinanceProgramApplication, run_binance_catalog_program},
    dual_tsmom::{
        dual_tsmom_coverage, dual_tsmom_program_inputs, dual_tsmom_starting_balance,
        issue_dual_tsmom_receipt, recover_dual_tsmom_receipt,
        validate_dual_tsmom_source_projection, validate_dual_tsmom_terminal,
    },
    experiment::PriceOnlyResearchIntent,
    family::{FrozenStrategyFamily, StrategyTrial},
    family_adapters::{price_program_host_bindings, price_program_parameters},
    formation_adapters::{
        ComplexDecisionCoverage, FormationAccountLedger, finish_bounded_formation_run,
        finish_price_run, issue_price_only_formation_receipt,
        issue_representative_formation_receipt, pilot_receipt_issuance, project_cash_trial,
        project_pilot_trial, recover_price_only_formation_receipt,
        recover_representative_formation_receipt,
    },
    holdout::{RepresentativeHoldoutPhase, recover_representative_2024_holdout_status},
    intent::{MISSING_OPEN_NS, ZERO_VOLUME_OPEN_NS},
    pairs_relative_value::{
        issue_pairs_relative_value_receipt, pairs_coverage, pairs_program_inputs,
        pairs_starting_balance, recover_pairs_relative_value_receipt,
        validate_pairs_program_terminal,
    },
    pilot::{
        CLOSED_HOUR_OFFSET_NS, HOUR_NS, PILOT_BAR_TYPE, VALIDATION_END_NS, VALIDATION_START_NS,
        pilot_host_bindings, prepare_frozen_pilot,
    },
    producer::{NativeProducerEvidence, NativeProducerVerificationRequest, verify_native_producer},
    program_host::{ProgramHostBindings, ProgramHostStrategy, ProgramHostTrace},
    receipt::{
        FormationFamilyReceipt, OwnedFormationRun, OwnedFormationTrialEvidence,
        RepresentativeProgramControlReceipt, RepresentativeProgramControlReceiptIssuance,
    },
    representative::{
        PreparedRepresentativeProgramData, RepresentativeProgramControl,
        prepare_representative_program_data, representative_program_inputs,
        run_representative_program_control as execute_representative_program_control,
    },
    software_control::validate_program_terminal,
    status::ResearchStatusSnapshot,
    successor::{
        SECAC_RESERVATION_SHA256, recover_secac_formation_receipt, secac_coverage,
        secac_program_inputs, secac_starting_balance, verify_secac_formation_source_projection,
        verify_secac_predecessor_receipt,
    },
};

#[cfg(test)]
use crate::successor::issue_secac_formation_receipt;

const MANIFEST_BYTES: &[u8] = include_bytes!("../assets/pilot_binance_manifest_v1.jcs");
const ARCHIVE_COUNT: usize = 24;
const WARMUP_START_NS: u64 = 1_672_531_200_000_000_000;
const FORMATION_END_NS: u64 = VALIDATION_START_NS - HOUR_NS;
const EXPECTED_WALL_SLOTS: usize = 17_544;
const EXPECTED_ACTUAL_EVENTS: usize = 17_543;
const EXPECTED_EXECUTABLE_BARS: usize = 17_542;
const FORMATION_ARCHIVE_COUNT: usize = 12;
const FORMATION_WALL_SLOTS: usize = 8_760;
const FORMATION_ACTUAL_EVENTS: usize = 8_759;
const FORMATION_EXECUTABLE_BARS: usize = 8_758;
const MAX_FORMATION_RECEIPT_BYTES: u64 = 4 * 1_048_576;
const STRATEGY_ID: &str = "STRATEGY-FACTORY-PILOT-001";

/// Exact source roots consumed by the representative multi-source formation runner.
#[derive(Debug, Clone, Copy)]
pub struct RepresentativeSourceRoots<'a> {
    raw_root: &'a Path,
    alfred_root: &'a Path,
    schedule_root: &'a Path,
    derived_catalog_root: &'a Path,
}

impl<'a> RepresentativeSourceRoots<'a> {
    /// Binds all source and derived-catalog roots before a formation recovery begins.
    #[must_use]
    pub const fn new(
        raw_root: &'a Path,
        alfred_root: &'a Path,
        schedule_root: &'a Path,
        derived_catalog_root: &'a Path,
    ) -> Self {
        Self {
            raw_root,
            alfred_root,
            schedule_root,
            derived_catalog_root,
        }
    }
}

#[cfg(test)]
std::thread_local! {
    static MARKET_DATA_LOAD_ATTEMPTS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn reset_market_data_load_attempts() {
    MARKET_DATA_LOAD_ATTEMPTS.set(0);
}

#[cfg(test)]
pub(crate) fn market_data_load_attempts() -> usize {
    MARKET_DATA_LOAD_ATTEMPTS.get()
}

#[derive(Debug)]
struct LoadedMarketData {
    data: Vec<Data>,
    execution_clock: Vec<ExecutionBar>,
    source_manifest_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
}

#[derive(Clone, Copy)]
struct SourceWindow {
    archive_range: (usize, usize),
    wall_slots: usize,
    expected_actual_events: usize,
    expected_executable_bars: usize,
    expected_missing_open_ns: Option<u64>,
    expected_zero_volume_open_ns: Option<u64>,
    start_open_ns: u64,
    decision_start_open_ns: u64,
    end_open_ns: u64,
}

impl SourceWindow {
    fn validate(self) -> anyhow::Result<Self> {
        anyhow::ensure!(
            self.start_open_ns <= self.decision_start_open_ns
                && self.decision_start_open_ns < self.end_open_ns,
            "source window event range is invalid"
        );
        Ok(self)
    }

    fn program_run_scope(self) -> anyhow::Result<ProgramRunScope> {
        let this = self.validate()?;
        let available_at = |open_ns: u64| {
            open_ns
                .checked_add(CLOSED_HOUR_OFFSET_NS)
                .context("source open time overflows availability clock")
        };
        ProgramRunScope::new(
            available_at(this.start_open_ns)?,
            available_at(this.decision_start_open_ns)?,
            available_at(this.end_open_ns)?,
        )
        .map_err(|_| anyhow::anyhow!("source window cannot form a program run scope"))
    }
}

const PILOT_SOURCE_WINDOW: SourceWindow = SourceWindow {
    archive_range: (0, ARCHIVE_COUNT),
    wall_slots: EXPECTED_WALL_SLOTS,
    expected_actual_events: EXPECTED_ACTUAL_EVENTS,
    expected_executable_bars: EXPECTED_EXECUTABLE_BARS,
    expected_missing_open_ns: Some(MISSING_OPEN_NS),
    expected_zero_volume_open_ns: Some(ZERO_VOLUME_OPEN_NS),
    start_open_ns: WARMUP_START_NS,
    decision_start_open_ns: VALIDATION_START_NS,
    end_open_ns: VALIDATION_END_NS,
};

const FORMATION_SOURCE_WINDOW: SourceWindow = SourceWindow {
    archive_range: (0, FORMATION_ARCHIVE_COUNT),
    wall_slots: FORMATION_WALL_SLOTS,
    expected_actual_events: FORMATION_ACTUAL_EVENTS,
    expected_executable_bars: FORMATION_EXECUTABLE_BARS,
    expected_missing_open_ns: Some(MISSING_OPEN_NS),
    expected_zero_volume_open_ns: Some(ZERO_VOLUME_OPEN_NS),
    start_open_ns: WARMUP_START_NS,
    decision_start_open_ns: WARMUP_START_NS,
    end_open_ns: FORMATION_END_NS,
};

#[derive(Debug)]
struct NativeRun {
    canonical_result: CanonicalBacktestResult,
    source_manifest_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
}

#[derive(Clone, Copy)]
struct NativeExecutionSpec<'a> {
    starting_balance: Money,
    trade_on_close: bool,
    run_id: &'a str,
    require_round_trip: bool,
    require_terminal_flat: bool,
}

#[derive(Debug)]
struct ExecutionBar {
    ts_event: u64,
    open: String,
}

/// Runs the one frozen pilot through the repository's existing native Backtest stack and returns
/// only its authoritative receipt.
///
/// The cache root must contain the 24 exact Binance Vision archive/sidecar pairs named by the
/// embedded manifest. This function performs no network or production write. The underlying run
/// and canonical result stay inside the crate's receipt boundary.
///
pub fn run_frozen_pilot(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<FormationFamilyReceipt> {
    let run = execute_frozen_pilot(cache_root, verify_native_producer(producer_request))?;
    FormationFamilyReceipt::issue(&pilot_receipt_issuance(&run)?)
}

fn execute_frozen_pilot(
    cache_root: &Path,
    producer_evidence: NativeProducerEvidence,
) -> anyhow::Result<OwnedFormationRun> {
    let family = FrozenStrategyFamily::frozen_pilot()?;
    let trial = &family.trials()[0];
    let artifact = family.materialize(trial)?;
    let artifact_identity = artifact.identity().clone();

    if !producer_evidence.allows_test_or_attested_execution() {
        let error = producer_evidence.rejection_error();
        return Ok(OwnedFormationRun::finish(
            producer_evidence,
            vec![OwnedFormationTrialEvidence::bound(trial, artifact_identity).failed(error)],
            BTreeMap::new(),
            None,
        ));
    }
    let prepared = match prepare_frozen_pilot(&family, trial, &artifact) {
        Ok(value) => value,
        Err(e) => {
            return Ok(OwnedFormationRun::finish(
                producer_evidence,
                vec![
                    OwnedFormationTrialEvidence::bound(trial, artifact_identity)
                        .failed(format!("{e:#}")),
                ],
                BTreeMap::new(),
                None,
            ));
        }
    };
    let starting_balance = prepared.1.starting_balance();
    let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
    let bar_type = BarType::from_str(PILOT_BAR_TYPE)?;
    let attempt = (|| -> anyhow::Result<_> {
        let loaded = load_market_data(cache_root, &instrument, bar_type, PILOT_SOURCE_WINDOW)?;
        let run = execute_loaded_pilot(&artifact, &prepared, &instrument, loaded)?;
        Ok(project_pilot_trial(
            trial,
            artifact_identity.clone(),
            run.canonical_result,
            run.source_manifest_digest,
            run.source_event_count,
            run.executable_bar_count,
            starting_balance,
        ))
    })();
    let evidence = attempt.unwrap_or_else(|e| {
        OwnedFormationTrialEvidence::bound(trial, artifact_identity).failed(format!("{e:#}"))
    });
    Ok(OwnedFormationRun::finish(
        producer_evidence,
        vec![evidence],
        BTreeMap::new(),
        None,
    ))
}

pub fn recover_frozen_pilot_status(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_pilot(cache_root, verify_native_producer(producer_request))?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "pilot status recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(receipt_path)?;
    FormationFamilyReceipt::from_slice(&bytes, &pilot_receipt_issuance(&run)?)?.status()
}

/// Runs every frozen formation tuple without opening qualification archive bytes.
///
/// The cache root only needs the 12 exact 2023 archive/sidecar pairs. This function performs no
/// network or production write and returns only the authoritative family receipt, never the
/// pre-receipt native run or canonical results.
///
/// ```compile_fail
/// use std::path::Path;
/// use vibe_strategy_factory::{NativeProducerVerificationRequest, run_frozen_complex_formation};
///
/// let receipt = run_frozen_complex_formation(
///     Path::new("/formation-cache"),
///     NativeProducerVerificationRequest::from_bundle("/attestation-bundle"),
/// ).unwrap();
/// let _ = receipt.trials();
/// ```
///
/// ```compile_fail
/// use std::path::Path;
/// use vibe_strategy_factory::{NativeProducerVerificationRequest, run_frozen_complex_formation};
///
/// let receipt = run_frozen_complex_formation(
///     Path::new("/formation-cache"),
///     NativeProducerVerificationRequest::from_bundle("/attestation-bundle"),
/// ).unwrap();
/// let _ = receipt.status();
/// ```
pub fn run_frozen_complex_formation(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<FormationFamilyReceipt> {
    let run = execute_frozen_complex_formation(cache_root, producer_request)?;
    issue_price_only_formation_receipt(&run)
}

/// Runs one frozen complex, multi-asset and multi-source Program through native owners.
///
/// The receipt proves deterministic software behavior only. It cannot select a Formation survivor,
/// access a holdout, qualify a strategy, claim economic value, or authorize live execution.
pub fn run_representative_program_control(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<RepresentativeProgramControlReceipt> {
    let control = execute_representative_program_control(
        raw_root,
        alfred_root,
        schedule_root,
        derived_catalog_root,
    )?;
    representative_program_control_receipt(control)
}

pub(crate) fn execute_frozen_complex_formation(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<OwnedFormationRun> {
    execute_frozen_complex_formation_with_evidence(
        cache_root,
        verify_native_producer(producer_request),
    )
}

fn execute_frozen_complex_formation_with_evidence(
    cache_root: &Path,
    producer_evidence: NativeProducerEvidence,
) -> anyhow::Result<OwnedFormationRun> {
    let intent = PriceOnlyResearchIntent::frozen()?;
    let family = FrozenStrategyFamily::frozen_price_only()?;
    let artifacts = family.materialize_all()?;

    execute_materialized_complex_formation(
        cache_root,
        producer_evidence,
        &intent,
        &family,
        artifacts,
    )
}

fn execute_materialized_complex_formation(
    cache_root: &Path,
    producer_evidence: NativeProducerEvidence,
    intent: &PriceOnlyResearchIntent,
    family: &FrozenStrategyFamily,
    artifacts: Vec<StrategyArtifact>,
) -> anyhow::Result<OwnedFormationRun> {
    if !producer_evidence.allows_test_or_attested_execution() {
        let producer_error = producer_evidence.rejection_error();
        return Ok(software_rejected_family(
            family,
            artifacts,
            producer_evidence,
            &producer_error,
        ));
    }
    let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
    let bar_type = BarType::from_str(PILOT_BAR_TYPE)?;
    let starting_balance =
        Money::from_str(&intent.payload.costs.initial_balance).map_err(anyhow::Error::msg)?;
    let mut trials = Vec::with_capacity(family.trials().len());

    for (family_trial, artifact) in family.trials().iter().zip(artifacts) {
        let tuple_id = family_trial.parameter_id();
        let variant_id = family_trial.variant_id();
        let artifact_identity = artifact.identity().clone();
        let prepared = (|| -> anyhow::Result<Vec<u8>> {
            family.verify_materialized(family_trial, &artifact)?;
            let parameters = price_program_parameters(intent, tuple_id, variant_id)?;
            artifact.verify_parameters(&parameters)?;
            Ok(parameters)
        })();
        let trial = match prepared {
            Err(e) => OwnedFormationTrialEvidence::bound(family_trial, artifact_identity)
                .failed(format!("{e:#}")),
            Ok(parameters) => {
                let attempt = (|| -> anyhow::Result<_> {
                    let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
                    let strategy_id = format!("STRATEGY-FACTORY-COMPLEX-{tuple_id}-{variant_id}");
                    let strategy = ProgramHostStrategy::new(
                        StrategyId::from(strategy_id.as_str()),
                        &artifact,
                        &parameters,
                        FORMATION_SOURCE_WINDOW.program_run_scope()?,
                        price_program_host_bindings()?,
                        Rc::clone(&trace),
                    )?;
                    let loaded = load_market_data(
                        cache_root,
                        &instrument,
                        bar_type,
                        FORMATION_SOURCE_WINDOW,
                    )?;
                    let run = execute_loaded_with_strategy(
                        &instrument,
                        loaded,
                        strategy,
                        || trace.borrow().callback_failure.clone(),
                        NativeExecutionSpec {
                            starting_balance,
                            trade_on_close: false,
                            run_id: &format!(
                                "strategy-factory-complex-formation-{tuple_id}-{variant_id}"
                            ),
                            require_round_trip: false,
                            require_terminal_flat: true,
                        },
                    )?;
                    let coverage =
                        ComplexDecisionCoverage::from_tags(&trace.borrow().decision_tags)?;
                    Ok(project_cash_trial(
                        family_trial,
                        artifact_identity.clone(),
                        run.canonical_result,
                        run.source_manifest_digest,
                        BTreeMap::from([
                            ("source_events".to_string(), run.source_event_count),
                            ("executable_bars".to_string(), run.executable_bar_count),
                        ]),
                        coverage.as_counts(),
                        starting_balance,
                        FormationAccountLedger::Cash,
                    ))
                })();
                attempt.unwrap_or_else(|e| {
                    OwnedFormationTrialEvidence::bound(family_trial, artifact_identity)
                        .failed(format!("{e:#}"))
                })
            }
        };
        trials.push(trial);
    }
    Ok(finish_price_run(producer_evidence, trials))
}

/// Runs the frozen 4x10 family as retrospective Formation with no Qualification authority.
pub fn run_frozen_representative_formation(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    derived_catalog_root: &Path,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<FormationFamilyReceipt> {
    let run = execute_frozen_representative_formation_with_evidence(
        (raw_root, alfred_root, schedule_root, derived_catalog_root),
        verify_native_producer(producer_request),
    )?;
    issue_representative_formation_receipt(&run)
}

fn execute_frozen_representative_formation_with_evidence(
    sources: (&Path, &Path, &Path, &Path),
    producer_evidence: NativeProducerEvidence,
) -> anyhow::Result<OwnedFormationRun> {
    let (raw_root, alfred_root, schedule_root, derived_catalog_root) = sources;
    let intent = PriceOnlyResearchIntent::frozen()?;
    let family = FrozenStrategyFamily::frozen_representative_formation()?;
    let artifacts = family.materialize_all()?;

    if !producer_evidence.allows_test_or_attested_execution() {
        let error = producer_evidence.rejection_error();
        return Ok(software_rejected_family(
            &family,
            artifacts,
            producer_evidence,
            &error,
        ));
    }

    let prepared = prepare_representative_program_data(
        raw_root,
        alfred_root,
        schedule_root,
        derived_catalog_root,
    )?;
    let starting_balance =
        Money::from_str(&intent.payload.costs.initial_balance).map_err(anyhow::Error::msg)?;
    let mut trials = Vec::with_capacity(family.trials().len());

    for (family_trial, artifact) in family.trials().iter().zip(artifacts) {
        trials.push(execute_representative_trial(
            &intent,
            &family,
            family_trial,
            artifact,
            &prepared,
            starting_balance,
        ));
    }
    Ok(finish_bounded_formation_run(producer_evidence, trials, &[]))
}

fn execute_representative_trial(
    intent: &PriceOnlyResearchIntent,
    family: &FrozenStrategyFamily,
    family_trial: &StrategyTrial,
    artifact: StrategyArtifact,
    prepared: &PreparedRepresentativeProgramData,
    starting_balance: Money,
) -> OwnedFormationTrialEvidence {
    MultisourceTrialContext {
        family,
        prepared,
        starting_balance,
        strategy_prefix: "REPRESENTATIVE-FORMATION",
        run_prefix: "representative-formation",
    }
    .execute(
        family_trial,
        artifact,
        || {
            representative_program_inputs(
                intent,
                family_trial.parameter_id(),
                family_trial.variant_id(),
            )
            .map_err(anyhow::Error::from)
        },
        validate_program_terminal,
        |tags| Ok(ComplexDecisionCoverage::from_tags(tags)?.as_counts()),
    )
}

#[derive(Clone, Copy)]
struct MultisourceTrialContext<'a> {
    family: &'a FrozenStrategyFamily,
    prepared: &'a PreparedRepresentativeProgramData,
    starting_balance: Money,
    strategy_prefix: &'static str,
    run_prefix: &'static str,
}

impl MultisourceTrialContext<'_> {
    fn execute(
        self,
        family_trial: &StrategyTrial,
        artifact: StrategyArtifact,
        inputs: impl FnOnce() -> anyhow::Result<(Vec<u8>, ProgramHostBindings)>,
        validate: impl FnOnce(&CanonicalBacktestResult) -> anyhow::Result<()>,
        coverage: impl FnOnce(&[u32]) -> anyhow::Result<BTreeMap<String, usize>>,
    ) -> OwnedFormationTrialEvidence {
        let artifact_identity = artifact.identity().clone();
        let attempt = (|| -> anyhow::Result<_> {
            self.family.verify_materialized(family_trial, &artifact)?;
            let (parameters, bindings) = inputs()?;
            artifact.verify_parameters(&parameters)?;
            let coordinate = format!(
                "{}-{}",
                family_trial.parameter_id(),
                family_trial.variant_id()
            );
            let strategy_id = format!("{}-{coordinate}", self.strategy_prefix);
            let run_id = format!("{}-{coordinate}", self.run_prefix);
            let (canonical_result, decision_tags) = run_binance_catalog_program(
                &self.prepared.dataset.catalog_root,
                &self.prepared.dataset.bar_types,
                &self.prepared.dataset.instruments,
                &self.prepared.dataset.custom_data,
                &BoundBinanceProgramApplication {
                    artifact,
                    parameters,
                    bindings,
                },
                self.prepared.run_scope,
                StrategyId::from(strategy_id.as_str()),
                &run_id,
            )?;
            validate(&canonical_result)?;
            let coverage = coverage(&decision_tags)?;
            Ok(project_cash_trial(
                family_trial,
                artifact_identity.clone(),
                canonical_result,
                self.prepared.dataset.source_manifest_digest.clone(),
                self.prepared.source_counts.clone(),
                coverage,
                self.starting_balance,
                FormationAccountLedger::Margin,
            ))
        })();
        attempt.unwrap_or_else(|error| {
            OwnedFormationTrialEvidence::bound(family_trial, artifact_identity)
                .failed(format!("{error:#}"))
        })
    }
}

/// Reruns all 40 trials into a fresh catalog and recovers exact authoritative status.
pub fn recover_frozen_representative_formation_status(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    fresh_derived_catalog_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_representative_formation_with_evidence(
        (
            raw_root,
            alfred_root,
            schedule_root,
            fresh_derived_catalog_root,
        ),
        verify_native_producer(producer_request),
    )?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "representative Formation recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(receipt_path)?;
    recover_representative_formation_receipt(&bytes, &run)?.status()
}

/// Runs the exact reviewed BTC+ETH relative-value family on the frozen 2023 sources.
///
/// The two legs are deliberately non-atomic. The Program may issue one bounded reduce-only repair,
/// while native Risk, Matching, and Portfolio owners retain authority over every individual order.
pub fn run_frozen_pairs_relative_value_formation(
    sources: RepresentativeSourceRoots<'_>,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<FormationFamilyReceipt> {
    let run = execute_frozen_pairs_relative_value_formation_with_evidence(
        sources,
        verify_native_producer(producer_request),
    )?;
    issue_pairs_relative_value_receipt(&run)
}

fn execute_frozen_pairs_relative_value_formation_with_evidence(
    sources: RepresentativeSourceRoots<'_>,
    producer_evidence: NativeProducerEvidence,
) -> anyhow::Result<OwnedFormationRun> {
    let family = FrozenStrategyFamily::frozen_pairs_relative_value()?;
    let artifacts = family.materialize_all()?;
    if !producer_evidence.allows_test_or_attested_execution() {
        let error = producer_evidence.rejection_error();
        return Ok(software_rejected_family(
            &family,
            artifacts,
            producer_evidence,
            &error,
        ));
    }

    let prepared = prepare_representative_program_data(
        sources.raw_root,
        sources.alfred_root,
        sources.schedule_root,
        sources.derived_catalog_root,
    )?;
    let starting_balance = pairs_starting_balance()?;
    let context = MultisourceTrialContext {
        family: &family,
        prepared: &prepared,
        starting_balance,
        strategy_prefix: "PAIRS-RELATIVE-VALUE-FORMATION",
        run_prefix: "pairs-relative-value-formation",
    };
    let mut trials = Vec::with_capacity(family.trials().len());
    for (trial, artifact) in family.trials().iter().zip(artifacts) {
        trials.push(context.execute(
            trial,
            artifact,
            || pairs_program_inputs(trial.parameter_id(), trial.variant_id()).map_err(Into::into),
            |result| {
                validate_pairs_program_terminal(result, trial.variant_id() != "without-eth-leg")
            },
            pairs_coverage,
        ));
    }
    Ok(finish_bounded_formation_run(producer_evidence, trials, &[]))
}

/// Reruns all 20 pair trials into a fresh catalog and verifies the stored receipt exactly.
pub fn recover_frozen_pairs_relative_value_formation_status(
    sources: RepresentativeSourceRoots<'_>,
    producer_request: NativeProducerVerificationRequest,
    receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_pairs_relative_value_formation_with_evidence(
        sources,
        verify_native_producer(producer_request),
    )?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "pair Formation recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(receipt_path)?;
    recover_pairs_relative_value_receipt(&bytes, &run)?.status()
}

/// Runs the exact reviewed BTC+ETH long-flat absolute-momentum family on frozen 2023 sources.
///
/// Its 365-slot effect envelope is fixed before source access. The 2024 holdout, Qualification,
/// Alpha, and live authority remain unavailable regardless of the Formation disposition.
pub fn run_frozen_dual_tsmom_formation(
    sources: RepresentativeSourceRoots<'_>,
    producer_request: NativeProducerVerificationRequest,
) -> anyhow::Result<FormationFamilyReceipt> {
    let run = execute_frozen_dual_tsmom_formation_with_evidence(
        sources,
        verify_native_producer(producer_request),
    )?;
    issue_dual_tsmom_receipt(&run)
}

fn execute_frozen_dual_tsmom_formation_with_evidence(
    sources: RepresentativeSourceRoots<'_>,
    producer_evidence: NativeProducerEvidence,
) -> anyhow::Result<OwnedFormationRun> {
    let family = FrozenStrategyFamily::frozen_dual_tsmom()?;
    let artifacts = family.materialize_all()?;
    if !producer_evidence.allows_test_or_attested_execution() {
        let error = producer_evidence.rejection_error();
        return Ok(software_rejected_family(
            &family,
            artifacts,
            producer_evidence,
            &error,
        ));
    }

    let prepared = prepare_representative_program_data(
        sources.raw_root,
        sources.alfred_root,
        sources.schedule_root,
        sources.derived_catalog_root,
    )?;
    validate_dual_tsmom_source_projection(prepared.run_scope, &prepared.dataset.bar_types)?;
    let starting_balance = dual_tsmom_starting_balance()?;
    let context = MultisourceTrialContext {
        family: &family,
        prepared: &prepared,
        starting_balance,
        strategy_prefix: "DUAL-TSMOM-FORMATION",
        run_prefix: "dual-tsmom-formation",
    };
    let mut trials = Vec::with_capacity(family.trials().len());
    for (trial, artifact) in family.trials().iter().zip(artifacts) {
        trials.push(context.execute(
            trial,
            artifact,
            || {
                dual_tsmom_program_inputs(trial.parameter_id(), trial.variant_id())
                    .map_err(Into::into)
            },
            |result| validate_dual_tsmom_terminal(result, trial.variant_id() != "without-eth"),
            dual_tsmom_coverage,
        ));
    }
    Ok(finish_bounded_formation_run(producer_evidence, trials, &[]))
}

/// Reruns all five trials into a fresh catalog and verifies the stored receipt exactly.
pub fn recover_frozen_dual_tsmom_formation_status(
    sources: RepresentativeSourceRoots<'_>,
    producer_request: NativeProducerVerificationRequest,
    receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_dual_tsmom_formation_with_evidence(
        sources,
        verify_native_producer(producer_request),
    )?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "dual TSMOM Formation recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(receipt_path)?;
    recover_dual_tsmom_receipt(&bytes, &run)?.status()
}

fn execute_frozen_secac_formation_with_evidence(
    sources: (&Path, &Path, &Path, &Path),
    producer_evidence: NativeProducerEvidence,
    predecessor_receipt_path: &Path,
    holdout_source_root: &Path,
    custody_root: &Path,
) -> anyhow::Result<OwnedFormationRun> {
    let family = FrozenStrategyFamily::frozen_secac_successor()?;
    let artifacts = family.materialize_all()?;
    if !producer_evidence.allows_test_or_attested_execution() {
        let error = producer_evidence.rejection_error();
        return Ok(software_rejected_family(
            &family,
            artifacts,
            producer_evidence,
            &error,
        ));
    }

    require_secac_formation_admission(predecessor_receipt_path, holdout_source_root, custody_root)?;
    let prepared = prepare_representative_program_data(sources.0, sources.1, sources.2, sources.3)?;
    verify_secac_formation_source_projection(&prepared.dataset.source_manifest_digest)?;
    let starting_balance = secac_starting_balance()?;
    let mut trials = Vec::with_capacity(family.trials().len());
    let context = MultisourceTrialContext {
        family: &family,
        prepared: &prepared,
        starting_balance,
        strategy_prefix: "SECAC-FORMATION",
        run_prefix: "secac-formation",
    };
    for (trial, artifact) in family.trials().iter().zip(artifacts) {
        trials.push(context.execute(
            trial,
            artifact,
            || secac_program_inputs(trial.parameter_id(), trial.variant_id()).map_err(Into::into),
            validate_program_terminal,
            secac_coverage,
        ));
    }
    Ok(finish_bounded_formation_run(producer_evidence, trials, &[]))
}

fn require_secac_formation_admission(
    predecessor_receipt_path: &Path,
    holdout_source_root: &Path,
    custody_root: &Path,
) -> anyhow::Result<()> {
    let predecessor = read_bounded_status_receipt(predecessor_receipt_path)?;
    verify_secac_predecessor_receipt(&predecessor)?;
    let holdout = recover_representative_2024_holdout_status(holdout_source_root, custody_root)?;
    anyhow::ensure!(
        holdout.phase() == RepresentativeHoldoutPhase::ReservedNotAttempted
            && holdout.reservation_sha256() == SECAC_RESERVATION_SHA256,
        "SECAC Formation requires the exact unclaimed 2024 reservation"
    );
    Ok(())
}

/// Reruns SECAC Formation into a fresh catalog and byte-verifies its authoritative receipt.
pub fn recover_frozen_secac_formation_status(
    sources: RepresentativeSourceRoots<'_>,
    producer_request: NativeProducerVerificationRequest,
    predecessor_receipt_path: &Path,
    holdout_source_root: &Path,
    custody_root: &Path,
    formation_receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_secac_formation_with_evidence(
        (
            sources.raw_root,
            sources.alfred_root,
            sources.schedule_root,
            sources.derived_catalog_root,
        ),
        verify_native_producer(producer_request),
        predecessor_receipt_path,
        holdout_source_root,
        custody_root,
    )?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "SECAC Formation recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(formation_receipt_path)?;
    recover_secac_formation_receipt(&bytes, &run)?.status()
}

/// Recovers the formation-receipt research status without trusting stored status fields.
///
/// The frozen formation is rerun first. Only a verified native producer may reach the receipt
/// path, and the stored receipt must then match the newly derived receipt byte-for-byte. The
/// formation runner is constrained to the 2023 partition, so this API cannot consume holdout data.
/// Its holdout state is historical as of receipt issuance, never proof that a later qualification
/// attempt has not consumed the holdout.
pub fn recover_frozen_complex_formation_status(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let run = execute_frozen_complex_formation(cache_root, producer_request)?;
    anyhow::ensure!(
        run.producer_is_verified(),
        "research status recovery requires a verified native producer"
    );
    let bytes = read_bounded_status_receipt(receipt_path)?;
    recover_price_only_formation_receipt(&bytes, &run)?.status()
}

/// Reruns the complete Program control into a fresh catalog and byte-verifies its receipt.
pub fn recover_representative_program_control(
    receipt_bytes: &[u8],
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    fresh_derived_catalog_root: &Path,
) -> anyhow::Result<RepresentativeProgramControlReceipt> {
    let recovered = execute_representative_program_control(
        raw_root,
        alfred_root,
        schedule_root,
        fresh_derived_catalog_root,
    )?;
    let recovered = representative_program_control_receipt(recovered)?;
    anyhow::ensure!(
        receipt_bytes == recovered.to_bytes()?,
        "stored representative Program control receipt does not match the complete rerun"
    );
    Ok(recovered)
}

fn representative_program_control_receipt(
    control: RepresentativeProgramControl,
) -> anyhow::Result<RepresentativeProgramControlReceipt> {
    let RepresentativeProgramControl {
        input_manifest_digests,
        source_counts,
        artifact_identity,
        canonical_result,
        decision_tags,
    } = control;
    RepresentativeProgramControlReceipt::issue(RepresentativeProgramControlReceiptIssuance {
        input_manifest_digests,
        source_counts,
        artifact_identity: &artifact_identity,
        canonical_result: &canonical_result,
        decision_tags: &decision_tags,
    })
}

fn read_bounded_status_receipt(path: &Path) -> anyhow::Result<Vec<u8>> {
    read_bounded_receipt(path, MAX_FORMATION_RECEIPT_BYTES, "formation")
}

fn read_bounded_receipt(path: &Path, limit: u64, label: &str) -> anyhow::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("missing {label} receipt {}", path.display()))?;
    anyhow::ensure!(
        metadata.file_type().is_file(),
        "{label} receipt is not a regular file: {}",
        path.display()
    );
    anyhow::ensure!(
        metadata.len() <= limit,
        "{label} receipt exceeds {limit} bytes: {}",
        path.display()
    );

    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open {label} receipt {}", path.display()))?;
    let opened = file
        .metadata()
        .with_context(|| format!("failed to inspect {label} receipt {}", path.display()))?;
    anyhow::ensure!(
        opened.file_type().is_file(),
        "opened {label} receipt is not a regular file: {}",
        path.display()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        anyhow::ensure!(
            metadata.dev() == opened.dev() && metadata.ino() == opened.ino(),
            "{label} receipt changed while opening: {}",
            path.display()
        );
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .with_context(|| format!("failed to read {label} receipt {}", path.display()))?;
    anyhow::ensure!(
        !bytes.is_empty(),
        "{label} receipt is empty: {}",
        path.display()
    );
    anyhow::ensure!(
        bytes.len() as u64 <= limit,
        "{label} receipt exceeds {limit} bytes: {}",
        path.display()
    );
    Ok(bytes)
}

fn software_rejected_family(
    family: &FrozenStrategyFamily,
    artifacts: Vec<StrategyArtifact>,
    producer_evidence: NativeProducerEvidence,
    software_error: &str,
) -> OwnedFormationRun {
    let mut trials = Vec::with_capacity(family.trials().len());

    for (trial, artifact) in family.trials().iter().zip(artifacts) {
        trials.push(
            OwnedFormationTrialEvidence::bound(trial, artifact.identity().clone())
                .failed(software_error),
        );
    }
    finish_bounded_formation_run(producer_evidence, trials, &[])
}

fn execute_loaded_pilot(
    artifact: &StrategyArtifact,
    prepared: &(
        crate::intent::PilotResearchIntent,
        crate::decision::DecisionContract,
        Vec<u8>,
    ),
    instrument: &InstrumentAny,
    loaded: LoadedMarketData,
) -> anyhow::Result<NativeRun> {
    let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
    let starting_balance = prepared.1.starting_balance();
    let trade_on_close = prepared.1.execution().trade_on_close();
    let bindings = pilot_host_bindings()?;
    let strategy = ProgramHostStrategy::new(
        StrategyId::from(STRATEGY_ID),
        artifact,
        &prepared.2,
        PILOT_SOURCE_WINDOW.program_run_scope()?,
        bindings,
        Rc::clone(&trace),
    )?;
    let run = execute_loaded_with_strategy(
        instrument,
        loaded,
        strategy,
        || trace.borrow().callback_failure.clone(),
        NativeExecutionSpec {
            starting_balance,
            trade_on_close,
            run_id: "strategy-factory-pilot-v1",
            require_round_trip: true,
            require_terminal_flat: true,
        },
    )?;
    Ok(run)
}

fn execute_loaded_with_strategy<S, F>(
    instrument: &InstrumentAny,
    loaded: LoadedMarketData,
    strategy: S,
    callback_failure: F,
    spec: NativeExecutionSpec<'_>,
) -> anyhow::Result<NativeRun>
where
    S: Strategy + StrategyNative + DataActorNative + Component + Debug + 'static,
    F: Fn() -> Option<String>,
{
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        logging: LoggerConfig {
            bypass_logging: true,
            ..Default::default()
        },
        run_analysis: true,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("BINANCE"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Cash)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![spec.starting_balance])
            .trade_on_close(spec.trade_on_close)
            .build()?,
    )?;
    engine.add_instrument(instrument)?;
    engine.add_strategy(strategy)?;
    engine.add_data(loaded.data, None, true, true)?;
    engine.run(None, None, Some(spec.run_id.to_string()), false)?;

    if let Some(failure) = callback_failure() {
        anyhow::bail!("strategy callback failed: {failure}");
    }
    let canonical_result = engine.get_canonical_result()?;
    validate_terminal_result(
        &canonical_result,
        &loaded.execution_clock,
        spec.require_round_trip,
        spec.require_terminal_flat,
    )?;

    Ok(NativeRun {
        canonical_result,
        source_manifest_digest: loaded.source_manifest_digest,
        source_event_count: loaded.source_event_count,
        executable_bar_count: loaded.executable_bar_count,
    })
}

fn validate_terminal_result(
    result: &CanonicalBacktestResult,
    execution_clock: &[ExecutionBar],
    require_round_trip: bool,
    require_terminal_flat: bool,
) -> anyhow::Result<()> {
    let document = result.as_value();
    anyhow::ensure!(
        document
            .pointer("/run/outcome")
            .and_then(serde_json::Value::as_str)
            == Some("completed"),
        "frozen pilot Backtest did not complete"
    );
    let summary = document
        .get("summary")
        .and_then(serde_json::Value::as_object)
        .context("canonical result summary is missing")?;

    if require_terminal_flat {
        for key in ["orders.open", "orders.inflight", "positions.open"] {
            anyhow::ensure!(
                summary.get(key).and_then(serde_json::Value::as_str) == Some("0"),
                "native strategy terminal invariant failed: {key}"
            );
        }
    }
    let orders = document
        .get("orders")
        .and_then(serde_json::Value::as_array)
        .context("canonical result orders are missing")?;
    anyhow::ensure!(
        !require_round_trip || (!orders.is_empty() && orders.len().is_multiple_of(2)),
        "native strategy must complete at least one paired round trip"
    );
    anyhow::ensure!(
        document
            .get("fills")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|fills| fills.len() == orders.len()),
        "frozen pilot canonical fill count does not match orders"
    );
    let mut validated = orders
        .iter()
        .map(|order| validate_filled_order(order, execution_clock))
        .collect::<anyhow::Result<Vec<_>>>()?;
    validated.sort_by_key(|order| order.signal_ts);
    anyhow::ensure!(
        validated
            .windows(2)
            .all(|pair| pair[0].signal_ts < pair[1].signal_ts),
        "frozen pilot order signals are duplicated or unordered"
    );

    for (index, order) in validated.iter().enumerate() {
        anyhow::ensure!(
            order.side
                == if index.is_multiple_of(2) {
                    "BUY"
                } else {
                    "SELL"
                },
            "native strategy order {index} does not alternate BUY/SELL"
        );
    }
    Ok(())
}

struct ValidatedOrder {
    side: String,
    signal_ts: u64,
}

fn validate_filled_order(
    order: &serde_json::Value,
    execution_clock: &[ExecutionBar],
) -> anyhow::Result<ValidatedOrder> {
    let core = order
        .get("Market")
        .and_then(|market| market.get("core"))
        .context("frozen pilot order is not a canonical Market order")?;
    anyhow::ensure!(
        core.get("status").and_then(serde_json::Value::as_str) == Some("FILLED"),
        "frozen pilot order is not FILLED"
    );
    let side = core
        .get("side")
        .and_then(serde_json::Value::as_str)
        .context("frozen pilot order side is missing")?;
    let events = core
        .get("events")
        .and_then(serde_json::Value::as_array)
        .context("frozen pilot order events are missing")?;
    let initialized = exactly_one_variant(events, "Initialized")?;
    let filled = exactly_one_variant(events, "Filled")?;
    let signal_ts = parse_canonical_u64(initialized, "ts_event")?;
    let fill_ts = parse_canonical_u64(filled, "ts_event")?;
    let signal_index = execution_clock
        .binary_search_by_key(&signal_ts, |bar| bar.ts_event)
        .map_err(|_| anyhow::anyhow!("order signal is not bound to an executable source Bar"))?;
    let next = execution_clock
        .get(signal_index + 1)
        .context("filled order has no next executable source Bar")?;
    anyhow::ensure!(
        fill_ts == next.ts_event,
        "order did not fill at the next executable source Bar"
    );
    anyhow::ensure!(
        filled.get("last_px").and_then(serde_json::Value::as_str) == Some(next.open.as_str()),
        "order did not fill at the next executable source Bar open"
    );
    let commission = filled
        .get("commission")
        .and_then(serde_json::Value::as_str)
        .context("filled order has no native commission")?;
    anyhow::ensure!(
        Money::from_str(commission).map_err(anyhow::Error::msg)?.raw > 0,
        "filled order native commission is not positive"
    );
    Ok(ValidatedOrder {
        side: side.to_string(),
        signal_ts,
    })
}

fn exactly_one_variant<'a>(
    events: &'a [serde_json::Value],
    variant: &str,
) -> anyhow::Result<&'a serde_json::Value> {
    let matching = events
        .iter()
        .filter_map(|event| event.get(variant))
        .collect::<Vec<_>>();
    anyhow::ensure!(
        matching.len() == 1,
        "order must contain exactly one {variant} event"
    );
    Ok(matching[0])
}

fn parse_canonical_u64(value: &serde_json::Value, field: &str) -> anyhow::Result<u64> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("canonical order event is missing {field}"))?
        .parse()
        .with_context(|| format!("canonical order event has invalid {field}"))
}

fn load_market_data(
    cache_root: &Path,
    instrument: &InstrumentAny,
    bar_type: BarType,
    window: SourceWindow,
) -> anyhow::Result<LoadedMarketData> {
    #[cfg(test)]
    MARKET_DATA_LOAD_ATTEMPTS.set(MARKET_DATA_LOAD_ATTEMPTS.get() + 1);

    let window = window.validate()?;
    let manifest = CanonicalDatasetManifest::parse(MANIFEST_BYTES)?;
    let authenticated =
        authenticate_monthly_kline_dataset(&manifest, cache_root, dataset_archive_range(window)?)?;
    let source_manifest_digest = bind_dataset_consumer_digest(authenticated.digest(), window)?;

    let mut data = Vec::with_capacity(window.expected_actual_events);
    let mut execution_clock = Vec::with_capacity(window.expected_executable_bars);
    let mut source_open_times = Vec::with_capacity(window.expected_actual_events);
    let mut zero_observations = 0usize;
    let mut zero_volume_clock = None;

    for archive in authenticated.archives() {
        let observations = archive.zero_volume_observations();
        let projected = archive.non_executable_kline_custom_data()?;
        anyhow::ensure!(
            observations.len() == projected.len(),
            "zero-volume source projection count mismatch"
        );
        for (observation, event) in observations.iter().zip(projected) {
            let open_ns = source_micros_to_nanos(observation.open_time_micros())?;
            if !(window.start_open_ns..=window.end_open_ns).contains(&open_ns) {
                continue;
            }
            let close_ns = source_micros_to_nanos(observation.close_time_micros())?;
            anyhow::ensure!(
                open_ns == ZERO_VOLUME_OPEN_NS
                    && close_ns == crate::intent::ZERO_VOLUME_CLOSE_NS
                    && observation.ohlc()
                        == (
                            "28080.00000000",
                            "28080.00000000",
                            "28080.00000000",
                            "28080.00000000",
                        ),
                "zero-volume observation does not match the frozen source event"
            );
            source_open_times.push(open_ns);
            zero_observations += 1;
            anyhow::ensure!(
                zero_volume_clock.is_none(),
                "multiple zero-volume source observations"
            );
            zero_volume_clock = Some(Data::Custom(event));
        }

        for mut bar in archive.parse_bars(bar_type, instrument, 0u64.into())? {
            let open_ns = bar
                .ts_event
                .as_u64()
                .checked_sub(CLOSED_HOUR_OFFSET_NS)
                .context("bar close timestamp precedes one-hour open")?;

            if !(window.start_open_ns..=window.end_open_ns).contains(&open_ns) {
                continue;
            }
            source_open_times.push(open_ns);
            bar.ts_init = bar.ts_event;
            execution_clock.push(ExecutionBar {
                ts_event: bar.ts_event.as_u64(),
                open: bar.open.to_string(),
            });
            data.push(Data::Bar(bar));
        }
    }

    anyhow::ensure!(
        zero_observations == usize::from(window.expected_zero_volume_open_ns.is_some()),
        "zero-volume observation contract mismatch"
    );
    anyhow::ensure!(
        data.len() == window.expected_executable_bars,
        "unexpected executable Bar count"
    );
    source_open_times.sort_unstable();
    source_open_times.dedup();
    anyhow::ensure!(
        source_open_times.len() == window.expected_actual_events,
        "source timestamps are duplicated or incomplete"
    );
    anyhow::ensure!(
        source_open_times.first() == Some(&window.start_open_ns),
        "unexpected first source open"
    );
    anyhow::ensure!(
        source_open_times.last() == Some(&window.end_open_ns),
        "unexpected final source open"
    );

    let absent = expected_source_opens(window)
        .filter(|open| source_open_times.binary_search(open).is_err())
        .collect::<Vec<_>>();
    let expected_absent = window
        .expected_missing_open_ns
        .into_iter()
        .collect::<Vec<_>>();
    anyhow::ensure!(
        absent == expected_absent,
        "source gap contract mismatch: {absent:?}"
    );

    if let Some(expected_zero_open) = window.expected_zero_volume_open_ns {
        anyhow::ensure!(
            source_open_times.binary_search(&expected_zero_open).is_ok(),
            "zero-volume source clock missing"
        );
        data.push(zero_volume_clock.context("authenticated zero-volume source clock is missing")?);
    } else {
        anyhow::ensure!(
            zero_volume_clock.is_none(),
            "unexpected zero-volume source clock"
        );
    }
    anyhow::ensure!(
        data.len() == window.expected_actual_events,
        "projected replay count mismatch"
    );
    data.sort_by_key(HasTsInit::ts_init);
    execution_clock.sort_by_key(|bar| bar.ts_event);

    Ok(LoadedMarketData {
        data,
        execution_clock,
        source_manifest_digest,
        source_event_count: source_open_times.len(),
        executable_bar_count: window.expected_executable_bars,
    })
}

fn source_micros_to_nanos(value: i64) -> anyhow::Result<u64> {
    u64::try_from(value)
        .ok()
        .and_then(|value| value.checked_mul(1_000))
        .context("source timestamp is negative or overflows nanoseconds")
}

fn expected_source_opens(window: SourceWindow) -> impl Iterator<Item = u64> {
    (0..window.wall_slots).map(move |index| window.start_open_ns + index as u64 * HOUR_NS)
}

fn dataset_archive_range(window: SourceWindow) -> anyhow::Result<std::ops::Range<usize>> {
    let start = window.archive_range.0;
    let end = start
        .checked_add(window.archive_range.1)
        .context("source window archive range overflow")?;
    Ok(start..end)
}

fn dataset_consumer_binding(window: SourceWindow) -> impl Serialize {
    (
        window.start_open_ns,
        window.decision_start_open_ns,
        window.end_open_ns,
    )
}

fn bind_dataset_consumer_digest(
    source_digest: &str,
    window: SourceWindow,
) -> anyhow::Result<String> {
    Ok(format!(
        "blake3:{}",
        blake3::hash(&serde_json::to_vec(&(
            source_digest,
            dataset_consumer_binding(window)
        ))?)
        .to_hex()
    ))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use std::path::PathBuf;
    use std::{
        fs::{self, File},
        io::Write,
    };

    #[rstest]
    #[ignore = "requires the separately downloaded frozen 2023 USD-M dataset"]
    fn authenticates_frozen_representative_dataset_2023() {
        const BYTES: &[u8] = include_bytes!("../assets/representative_binance_usdm_2023_v1.jcs");
        let root = std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap();
        let manifest = CanonicalDatasetManifest::parse(BYTES).unwrap();
        let first = authenticate_monthly_kline_dataset(&manifest, Path::new(&root), 0..96).unwrap();
        let second =
            authenticate_monthly_kline_dataset(&manifest, Path::new(&root), 0..96).unwrap();
        let channels = first
            .archives()
            .iter()
            .map(|archive| {
                let binding = archive.metadata().binding();
                format!(
                    "{}/{}/{}",
                    binding.product().as_str(),
                    binding.symbol(),
                    binding.interval().as_str()
                )
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(first.archives().len(), 96);
        assert_eq!(second.archives(), first.archives());
        assert_eq!(channels.len(), 8);
        assert_eq!(
            first
                .archives()
                .iter()
                .map(|archive| archive.metadata().total_rows())
                .sum::<usize>(),
            92_710
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let linked_root = tempfile::tempdir().unwrap();
            symlink(&root, linked_root.path().join("root")).unwrap();
            assert!(
                authenticate_monthly_kline_dataset(
                    &manifest,
                    &linked_root.path().join("root"),
                    0..96,
                )
                .is_err()
            );

            let linked_component = tempfile::tempdir().unwrap();
            symlink(
                Path::new(&root).join("BTCUSDT"),
                linked_component.path().join("BTCUSDT"),
            )
            .unwrap();
            assert!(
                authenticate_monthly_kline_dataset(&manifest, linked_component.path(), 0..96,)
                    .is_err()
            );

            let linked_object = tempfile::tempdir().unwrap();
            let leaf = linked_object.path().join("BTCUSDT/15m");
            fs::create_dir_all(&leaf).unwrap();
            symlink(
                Path::new(&root).join("BTCUSDT/15m/BTCUSDT-15m-2023-01.zip"),
                leaf.join("BTCUSDT-15m-2023-01.zip"),
            )
            .unwrap();
            assert!(
                authenticate_monthly_kline_dataset(&manifest, linked_object.path(), 0..96,)
                    .is_err()
            );
        }
    }

    #[rstest]
    #[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
    fn representative_coordinates_share_read_only_catalog_and_reproduce_fresh() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let family = FrozenStrategyFamily::frozen_representative_formation().unwrap();
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let starting = Money::from_str(&intent.payload.costs.initial_balance).unwrap();
        let coordinates = [("tuple-001", "full"), ("tuple-004", "price-only")];
        let run = |parent: &Path| {
            let prepared = prepare_representative_program_data(
                &raw,
                &alfred,
                &schedule,
                &parent.join("catalog"),
            )
            .unwrap();
            coordinates
                .iter()
                .map(|(parameter_id, variant_id)| {
                    let trial = family
                        .trial_by_coordinate(parameter_id, variant_id)
                        .unwrap();
                    let evidence = execute_representative_trial(
                        &intent,
                        &family,
                        trial,
                        family.materialize(trial).unwrap(),
                        &prepared,
                        starting,
                    );
                    assert!(evidence.software_error.is_none());
                    evidence.canonical_result.unwrap().to_bytes().unwrap()
                })
                .collect::<Vec<_>>()
        };
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        assert_eq!(run(first.path()), run(second.path()));
    }

    #[rstest]
    #[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
    fn actual_representative_family_recovers_exact_terminal_receipt() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let execute = |parent: &Path| {
            execute_frozen_representative_formation_with_evidence(
                (&raw, &alfred, &schedule, &parent.join("catalog")),
                NativeProducerEvidence::test_only_for_execution(),
            )
            .unwrap()
        };

        let first = tempfile::tempdir().unwrap();
        let first_run = execute(first.path());
        assert_eq!(first_run.trials.len(), 40);
        assert!(first_run.software_error.is_none());
        assert!(first_run.trials.iter().all(|trial| {
            trial.software_error.is_none()
                && trial.canonical_result.is_some()
                && trial.projection.is_some()
        }));
        assert_eq!(
            first_run
                .trials
                .iter()
                .filter_map(|trial| trial.source_manifest_digest.as_deref())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            1
        );
        let receipt = issue_representative_formation_receipt(&first_run).unwrap();
        let bytes = receipt.to_bytes().unwrap();
        assert_eq!(receipt.trial_count(), 40);

        let second = tempfile::tempdir().unwrap();
        let second_run = execute(second.path());
        let recovered = recover_representative_formation_receipt(&bytes, &second_run).unwrap();
        assert_eq!(recovered.to_bytes().unwrap(), bytes);
        assert_eq!(
            recovered.status().unwrap().source_receipt_digest(),
            receipt.receipt_digest()
        );
        let mut tampered = bytes;
        let index = tampered.len() / 2;
        tampered[index] ^= 1;
        assert!(recover_representative_formation_receipt(&tampered, &second_run).is_err());
        eprintln!(
            "representative Formation disposition: {:?}",
            receipt.disposition()
        );
    }

    #[rstest]
    fn rejected_secac_producer_never_opens_predecessor_or_source_custody() {
        let run = execute_frozen_secac_formation_with_evidence(
            (
                Path::new("/missing/2023-market"),
                Path::new("/missing/2023-alfred"),
                Path::new("/missing/2023-schedule"),
                Path::new("/missing/derived-catalog"),
            ),
            verify_native_producer(NativeProducerVerificationRequest::from_bundle(
                "/missing/attestation-bundle",
            )),
            Path::new("/missing/v37-receipt"),
            Path::new("/missing/2024-sources"),
            Path::new("/missing/qualification-custody"),
        )
        .unwrap();
        assert_eq!(run.trials.len(), 10);
        assert!(
            run.trials
                .iter()
                .all(|trial| trial.software_error.is_some())
        );
        assert_eq!(
            issue_secac_formation_receipt(&run).unwrap().disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected
        );
    }

    #[rstest]
    fn rejected_pairs_producer_binds_twenty_trials_before_data_access() {
        let directory = tempfile::tempdir().unwrap();
        let derived = directory.path().join("derived");
        let run = execute_frozen_pairs_relative_value_formation_with_evidence(
            RepresentativeSourceRoots::new(
                &directory.path().join("missing-market"),
                &directory.path().join("missing-alfred"),
                &directory.path().join("missing-schedule"),
                &derived,
            ),
            verify_native_producer(NativeProducerVerificationRequest::from_bundle(
                directory.path().join("missing-attestation"),
            )),
        )
        .unwrap();
        assert_eq!(run.trials.len(), 20);
        assert!(
            run.trials
                .iter()
                .all(|trial| trial.software_error.is_some())
        );
        assert!(!derived.exists());
        assert_eq!(
            issue_pairs_relative_value_receipt(&run)
                .unwrap()
                .disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected
        );
    }

    #[rstest]
    fn rejected_dual_tsmom_producer_binds_five_trials_before_data_access() {
        let directory = tempfile::tempdir().unwrap();
        let derived = directory.path().join("derived");
        let run = execute_frozen_dual_tsmom_formation_with_evidence(
            RepresentativeSourceRoots::new(
                &directory.path().join("missing-market"),
                &directory.path().join("missing-alfred"),
                &directory.path().join("missing-schedule"),
                &derived,
            ),
            verify_native_producer(NativeProducerVerificationRequest::from_bundle(
                directory.path().join("missing-attestation"),
            )),
        )
        .unwrap();
        assert_eq!(run.trials.len(), 5);
        assert!(
            run.trials
                .iter()
                .all(|trial| trial.software_error.is_some())
        );
        assert!(!derived.exists());
        assert_eq!(
            issue_dual_tsmom_receipt(&run).unwrap().disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected
        );
    }

    #[rstest]
    #[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
    fn actual_pairs_family_recovers_exact_terminal_receipt() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let execute = |parent: &Path| {
            execute_frozen_pairs_relative_value_formation_with_evidence(
                RepresentativeSourceRoots::new(&raw, &alfred, &schedule, &parent.join("catalog")),
                NativeProducerEvidence::test_only_for_execution(),
            )
            .unwrap()
        };

        let first = tempfile::tempdir().unwrap();
        let first_run = execute(first.path());
        assert_eq!(first_run.trials.len(), 20);
        for trial in &first_run.trials {
            if let Some(error) = &trial.software_error {
                eprintln!(
                    "pairs {}/{} software error: {error}",
                    trial.parameter_id, trial.variant_id
                );
            }
        }
        assert!(first_run.trials.iter().all(|trial| {
            trial.software_error.is_none()
                && trial.canonical_result.is_some()
                && trial.projection.is_some()
        }));
        assert_eq!(
            first_run
                .trials
                .iter()
                .filter_map(|trial| trial.source_manifest_digest.as_deref())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            1
        );
        let receipt = issue_pairs_relative_value_receipt(&first_run).unwrap();
        let bytes = receipt.to_bytes().unwrap();
        assert_eq!(receipt.trial_count(), 20);

        let second = tempfile::tempdir().unwrap();
        let second_run = execute(second.path());
        let recovered = recover_pairs_relative_value_receipt(&bytes, &second_run).unwrap();
        assert_eq!(recovered.to_bytes().unwrap(), bytes);
        assert_eq!(
            recovered.status().unwrap().source_receipt_digest(),
            receipt.receipt_digest()
        );
        let mut tampered = bytes;
        let index = tampered.len() / 2;
        tampered[index] ^= 1;
        assert!(recover_pairs_relative_value_receipt(&tampered, &second_run).is_err());
        eprintln!("pairs Formation disposition: {:?}", receipt.disposition());
    }

    #[rstest]
    #[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
    fn actual_dual_tsmom_family_recovers_exact_terminal_receipt() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let execute = |parent: &Path| {
            execute_frozen_dual_tsmom_formation_with_evidence(
                RepresentativeSourceRoots::new(&raw, &alfred, &schedule, &parent.join("catalog")),
                NativeProducerEvidence::test_only_for_execution(),
            )
            .unwrap()
        };

        let first = tempfile::tempdir().unwrap();
        let first_run = execute(first.path());
        assert_eq!(first_run.trials.len(), 5);
        for trial in &first_run.trials {
            if let Some(error) = &trial.software_error {
                eprintln!(
                    "dual TSMOM {}/{} software error: {error}",
                    trial.parameter_id, trial.variant_id
                );
            }
        }
        assert!(first_run.trials.iter().all(|trial| {
            trial.software_error.is_none()
                && trial.canonical_result.is_some()
                && trial.projection.is_some()
        }));
        let receipt = issue_dual_tsmom_receipt(&first_run).unwrap();
        let bytes = receipt.to_bytes().unwrap();
        assert_eq!(receipt.trial_count(), 5);

        let second = tempfile::tempdir().unwrap();
        let second_run = execute(second.path());
        let recovered = recover_dual_tsmom_receipt(&bytes, &second_run).unwrap();
        assert_eq!(recovered.to_bytes().unwrap(), bytes);
        assert_eq!(
            recovered.status().unwrap().source_receipt_digest(),
            receipt.receipt_digest()
        );
        let mut tampered = bytes;
        let index = tampered.len() / 2;
        tampered[index] ^= 1;
        assert!(recover_dual_tsmom_receipt(&tampered, &second_run).is_err());
        eprintln!(
            "dual TSMOM Formation disposition: {:?}",
            receipt.disposition()
        );
    }

    #[rstest]
    fn secac_admission_rejects_foreign_predecessor_before_source_custody() {
        let directory = tempfile::tempdir().unwrap();
        let predecessor = directory.path().join("foreign-receipt.jcs");
        fs::write(&predecessor, b"foreign\n").unwrap();
        let error = execute_frozen_secac_formation_with_evidence(
            (
                Path::new("/missing/2023-market"),
                Path::new("/missing/2023-alfred"),
                Path::new("/missing/2023-schedule"),
                Path::new("/missing/derived-catalog"),
            ),
            NativeProducerEvidence::test_only_for_execution(),
            &predecessor,
            Path::new("/missing/2024-sources"),
            Path::new("/missing/qualification-custody"),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("archived v37 predecessor receipt")
        );
    }

    #[rstest]
    #[ignore = "requires exact 2023 Formation inputs plus intact unclaimed 2024 custody"]
    fn actual_secac_formation_recovers_exact_without_claiming_holdout() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let holdout =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_HOLDOUT_ROOT").unwrap());
        let custody =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_QUALIFICATION_CUSTODY_ROOT").unwrap());
        let predecessor = PathBuf::from(std::env::var("VIBE_REPRESENTATIVE_V37_RECEIPT").unwrap());
        let execute = |parent: &Path| {
            execute_frozen_secac_formation_with_evidence(
                (&raw, &alfred, &schedule, &parent.join("catalog")),
                NativeProducerEvidence::test_only_for_execution(),
                &predecessor,
                &holdout,
                &custody,
            )
            .unwrap()
        };

        let before = recover_representative_2024_holdout_status(&holdout, &custody).unwrap();
        assert_eq!(
            before.phase(),
            RepresentativeHoldoutPhase::ReservedNotAttempted
        );
        let first = tempfile::tempdir().unwrap();
        let first_run = execute(first.path());
        assert_eq!(first_run.trials.len(), 10);
        for trial in &first_run.trials {
            if let Some(error) = &trial.software_error {
                eprintln!(
                    "SECAC {}/{} software error: {error}",
                    trial.parameter_id, trial.variant_id
                );
            }
        }
        assert!(first_run.trials.iter().all(|trial| {
            trial.software_error.is_none()
                && trial.canonical_result.is_some()
                && trial.projection.is_some()
        }));
        let receipt = issue_secac_formation_receipt(&first_run).unwrap();
        let bytes = receipt.to_bytes().unwrap();
        if let Some(output) = std::env::var_os("VIBE_SECAC_FORMATION_RECEIPT_OUTPUT") {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)
                .unwrap();
            file.write_all(&bytes).unwrap();
            file.sync_all().unwrap();
        }
        let stored = fs::read(
            std::env::var_os("VIBE_SECAC_FORMATION_RECEIPT")
                .expect("VIBE_SECAC_FORMATION_RECEIPT must name the frozen terminal receipt"),
        )
        .unwrap();
        assert_eq!(stored, bytes);

        let second = tempfile::tempdir().unwrap();
        let recovered = recover_secac_formation_receipt(&stored, &execute(second.path())).unwrap();
        assert_eq!(recovered.to_bytes().unwrap(), bytes);
        let after = recover_representative_2024_holdout_status(&holdout, &custody).unwrap();
        assert_eq!(
            after.phase(),
            RepresentativeHoldoutPhase::ReservedNotAttempted
        );
        assert_eq!(after.reservation_sha256(), before.reservation_sha256());
        eprintln!("SECAC Formation disposition: {:?}", receipt.disposition());
    }

    #[rstest]
    fn expected_clock_has_one_bound_absence() {
        let opens = expected_source_opens(PILOT_SOURCE_WINDOW).collect::<Vec<_>>();
        assert_eq!(opens.len(), EXPECTED_WALL_SLOTS);
        assert_eq!(opens.first(), Some(&WARMUP_START_NS));
        assert_eq!(opens.last(), Some(&VALIDATION_END_NS));
        assert!(opens.binary_search(&MISSING_OPEN_NS).is_ok());
        assert!(opens.binary_search(&ZERO_VOLUME_OPEN_NS).is_ok());
    }

    #[rstest]
    fn loader_rejects_missing_cache_root_without_network() {
        let missing = PathBuf::from("/definitely/not/a/strategy-factory-cache");
        let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let bar_type = BarType::from_str(PILOT_BAR_TYPE).unwrap();
        assert!(load_market_data(&missing, &instrument, bar_type, PILOT_SOURCE_WINDOW).is_err());
    }

    #[rstest]
    fn rejected_producer_precedes_status_receipt_and_market_data_access() {
        reset_market_data_load_attempts();
        let error = recover_frozen_complex_formation_status(
            Path::new("/definitely/not/a/strategy-factory-formation-cache"),
            NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            ),
            Path::new("/definitely/not/a/strategy-factory-formation-receipt"),
        )
        .unwrap_err();
        assert_eq!(market_data_load_attempts(), 0);
        assert_eq!(
            error.to_string(),
            "research status recovery requires a verified native producer"
        );
    }

    #[rstest]
    fn rejected_pilot_producer_retains_bound_trial_before_market_data_access() {
        reset_market_data_load_attempts();
        let run = execute_frozen_pilot(
            Path::new("/definitely/not/a/strategy-factory-pilot-cache"),
            verify_native_producer(NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            )),
        )
        .unwrap();
        assert_eq!(market_data_load_attempts(), 0);
        assert_eq!(run.trials().len(), 1);
        assert!(run.trials()[0].artifact_identity().trial_id.is_some());
        assert!(
            run.trials()[0]
                .artifact_identity()
                .parameters_digest
                .is_some()
        );
        let receipt =
            FormationFamilyReceipt::issue(&pilot_receipt_issuance(&run).unwrap()).unwrap();
        assert_eq!(
            receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected
        );
        assert_eq!(receipt.trial_count(), 1);
    }

    #[rstest]
    #[ignore = "requires the separately downloaded exact 24-month Binance Vision cache"]
    fn exact_pilot_cache_executes_native_family_path() {
        let cache_root = std::env::var_os("STRATEGY_FACTORY_PILOT_TEST_CACHE")
            .map(PathBuf::from)
            .expect("STRATEGY_FACTORY_PILOT_TEST_CACHE");
        let run = execute_frozen_pilot(
            &cache_root,
            NativeProducerEvidence::test_only_for_execution(),
        )
        .unwrap();
        let receipt =
            FormationFamilyReceipt::issue(&pilot_receipt_issuance(&run).unwrap()).unwrap();
        assert_eq!(run.trials().len(), 1);
        assert_ne!(
            receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected,
            "{}",
            run.trials()[0]
                .software_error()
                .unwrap_or("family software rejection")
        );
        assert_eq!(
            FormationFamilyReceipt::from_slice(
                &receipt.to_bytes().unwrap(),
                &pilot_receipt_issuance(&run).unwrap(),
            )
            .unwrap(),
            receipt
        );
    }

    #[rstest]
    #[ignore = "requires the separately downloaded exact 24-month Binance Vision cache"]
    fn exact_complex_cache_executes_program_family_path_reproducibly() {
        let cache_root = std::env::var_os("STRATEGY_FACTORY_PILOT_TEST_CACHE")
            .map(PathBuf::from)
            .expect("STRATEGY_FACTORY_PILOT_TEST_CACHE");
        let execute = || {
            execute_frozen_complex_formation_with_evidence(
                &cache_root,
                NativeProducerEvidence::test_only_for_execution(),
            )
            .unwrap()
        };
        let first = execute();
        let second = execute();
        assert_eq!(first.trials().len(), 20);
        assert!(first.trials().iter().all(|trial| {
            trial.software_error().is_none()
                && trial.artifact_identity().program_profile.schema_version == 1
        }));
        let first_receipt = issue_price_only_formation_receipt(&first).unwrap();
        let second_receipt = issue_price_only_formation_receipt(&second).unwrap();
        assert_eq!(
            first_receipt.to_bytes().unwrap(),
            second_receipt.to_bytes().unwrap()
        );
        assert_ne!(
            first_receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::SoftwareRejected
        );
        assert_eq!(
            recover_price_only_formation_receipt(&first_receipt.to_bytes().unwrap(), &first)
                .unwrap(),
            first_receipt
        );
    }

    #[rstest]
    fn status_receipt_reader_is_bounded_and_rejects_nonregular_inputs() {
        let directory = tempfile::tempdir().unwrap();
        let regular = directory.path().join("receipt.json");
        fs::write(&regular, b"{}\n").unwrap();
        assert_eq!(read_bounded_status_receipt(&regular).unwrap(), b"{}\n");

        let empty = directory.path().join("empty.json");
        File::create(&empty).unwrap();
        assert!(
            read_bounded_status_receipt(&empty)
                .unwrap_err()
                .to_string()
                .contains("is empty")
        );

        let oversized = directory.path().join("oversized.json");
        let mut file = File::create(&oversized).unwrap();
        file.write_all(&vec![b'x'; MAX_FORMATION_RECEIPT_BYTES as usize + 1])
            .unwrap();
        assert!(
            read_bounded_status_receipt(&oversized)
                .unwrap_err()
                .to_string()
                .contains("exceeds")
        );

        assert!(
            read_bounded_status_receipt(directory.path())
                .unwrap_err()
                .to_string()
                .contains("not a regular file")
        );
    }

    #[cfg(unix)]
    #[rstest]
    fn status_receipt_reader_rejects_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.json");
        let link = directory.path().join("link.json");
        fs::write(&target, b"{}\n").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(
            read_bounded_status_receipt(&link)
                .unwrap_err()
                .to_string()
                .contains("not a regular file")
        );
    }
}
