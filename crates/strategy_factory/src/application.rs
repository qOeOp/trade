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
use vibe_binance::common::offline::{
    authenticate_monthly_kline_dataset, monthly_kline_dataset_digest,
};
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
    experiment::PriceOnlyResearchIntent,
    family::FrozenStrategyFamily,
    family_adapters::{price_program_host_bindings, price_program_parameters},
    formation_adapters::{
        ComplexDecisionCoverage, ComplexQualificationRun, finish_price_run,
        issue_price_only_formation_receipt, pilot_receipt_issuance,
        price_only_qualification_issuance, price_only_qualification_preflight_binding,
        project_pilot_trial, project_price_trial, recover_price_only_formation_receipt,
    },
    intent::{MISSING_OPEN_NS, ZERO_VOLUME_OPEN_NS},
    pilot::{
        CLOSED_HOUR_OFFSET_NS, HOUR_NS, PILOT_BAR_TYPE, VALIDATION_END_NS, VALIDATION_START_NS,
        pilot_host_bindings, prepare_frozen_pilot,
    },
    producer::{NativeProducerEvidence, NativeProducerVerificationRequest, verify_native_producer},
    program_host::{ProgramHostStrategy, ProgramHostTrace},
    receipt::{
        FormationFamilyReceipt, OwnedFormationRun, OwnedFormationTrialEvidence,
        QualificationReceipt,
    },
    status::ResearchStatusSnapshot,
};

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
const QUALIFICATION_WARMUP_START_NS: u64 = 1_702_857_600_000_000_000;
const QUALIFICATION_WALL_SLOTS: usize = 9_120;
const QUALIFICATION_ACTUAL_EVENTS: usize = 9_120;
const QUALIFICATION_EXECUTABLE_BARS: usize = 9_120;
const MAX_FORMATION_RECEIPT_BYTES: u64 = 4 * 1_048_576;
const MAX_QUALIFICATION_RECEIPT_BYTES: u64 = 1_048_576;
const STRATEGY_ID: &str = "STRATEGY-FACTORY-PILOT-001";

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

const QUALIFICATION_SOURCE_WINDOW: SourceWindow = SourceWindow {
    archive_range: (11, 13),
    wall_slots: QUALIFICATION_WALL_SLOTS,
    expected_actual_events: QUALIFICATION_ACTUAL_EVENTS,
    expected_executable_bars: QUALIFICATION_EXECUTABLE_BARS,
    expected_missing_open_ns: None,
    expected_zero_volume_open_ns: None,
    start_open_ns: QUALIFICATION_WARMUP_START_NS,
    decision_start_open_ns: VALIDATION_START_NS,
    end_open_ns: VALIDATION_END_NS,
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

    if !producer_evidence.is_verified() {
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

    if !producer_evidence.is_verified() {
        let producer_error = producer_evidence.rejection_error();
        return Ok(software_rejected_formation_family(
            &family,
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
            let parameters = price_program_parameters(&intent, tuple_id, variant_id)?;
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
                    Ok(project_price_trial(
                        family_trial,
                        artifact_identity.clone(),
                        run.canonical_result,
                        run.source_manifest_digest,
                        run.source_event_count,
                        run.executable_bar_count,
                        coverage.as_counts(),
                        starting_balance,
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

/// Reruns and byte-verifies formation before consuming the frozen 2024 qualification partition.
///
/// A non-surviving formation family, producer mismatch, or stored formation-receipt mismatch stops
/// before any qualification archive is opened. The one parameterized complex strategy is reused;
/// December 2023 events initialize indicators but cannot submit orders.
///
/// ```compile_fail
/// use vibe_strategy_factory::application::ComplexQualificationRun;
/// ```
///
/// ```compile_fail
/// use std::path::Path;
/// use vibe_strategy_factory::{NativeProducerVerificationRequest, run_frozen_complex_qualification};
/// let receipt = run_frozen_complex_qualification(
///     Path::new("/cache"),
///     NativeProducerVerificationRequest::from_bundle("/bundle"),
///     Path::new("/formation-receipt"),
/// ).unwrap();
/// let _ = receipt.qualification_metrics();
/// ```
pub fn run_frozen_complex_qualification(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    formation_receipt_path: &Path,
) -> anyhow::Result<QualificationReceipt> {
    let run =
        execute_frozen_complex_qualification(cache_root, producer_request, formation_receipt_path)?;
    QualificationReceipt::issue(&price_only_qualification_issuance(&run)?)
}

/// Recovers terminal qualification status without trusting stored status fields.
///
/// Missing, unreadable, or implausibly bound qualification bytes return an explicit unavailable
/// status without reading qualification archives. Only a receipt that preflights against the
/// exact formation survivor and logical-run identity authorizes a deterministic physical reread.
pub fn recover_frozen_complex_qualification_status(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    formation_receipt_path: &Path,
    qualification_receipt_path: &Path,
) -> anyhow::Result<ResearchStatusSnapshot> {
    let replay_request = producer_request.clone();
    let formation_run = execute_frozen_complex_formation(cache_root, producer_request)?;
    anyhow::ensure!(
        formation_run.producer_is_verified(),
        "qualification status recovery requires a verified native producer"
    );
    let formation_bytes = read_bounded_receipt(
        formation_receipt_path,
        MAX_FORMATION_RECEIPT_BYTES,
        "formation",
    )?;
    let formation_receipt = recover_price_only_formation_receipt(&formation_bytes, &formation_run)?;
    formation_receipt.require_sealed_qualification_boundary()?;
    let formation_status = formation_receipt.status()?;
    let Some(candidate) = formation_status.selected_candidate() else {
        return Ok(formation_status);
    };
    anyhow::ensure!(
        candidate.variant_id() == "full",
        "price-only qualification requires the frozen full candidate variant"
    );
    let intent = PriceOnlyResearchIntent::frozen()?;
    let family = FrozenStrategyFamily::frozen_price_only()?;
    let trial = family.trial_by_coordinate(candidate.parameter_id(), "full")?;
    let artifact = family.materialize(trial)?;
    let parameters = price_program_parameters(&intent, candidate.parameter_id(), "full")?;
    family.verify_materialized(trial, &artifact)?;
    artifact.verify_parameters(&parameters)?;
    let parameters_digest = artifact
        .identity()
        .parameters_digest
        .as_deref()
        .context("selected qualification artifact has no parameters digest")?;
    anyhow::ensure!(
        parameters_digest == candidate.parameters_digest()
            && artifact.identity().artifact_digest == candidate.strategy_artifact_digest(),
        "stored formation candidate does not bind the frozen artifact"
    );
    let qualification_bytes = match read_bounded_receipt(
        qualification_receipt_path,
        MAX_QUALIFICATION_RECEIPT_BYTES,
        "qualification",
    ) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Ok(formation_status.qualification_state_unavailable(
                "MISSING_OR_UNREADABLE_TERMINAL_RECEIPT".to_string(),
            ));
        }
    };
    let expected_source_digest = pilot_dataset_digest(QUALIFICATION_SOURCE_WINDOW)?;

    let preflight = price_only_qualification_preflight_binding(
        &intent,
        &formation_receipt,
        artifact.identity(),
        formation_run.producer_evidence(),
        &expected_source_digest,
    )?;
    if QualificationReceipt::preflight(&qualification_bytes, &preflight).is_err() {
        return Ok(formation_status.qualification_state_unavailable(
            "NONCANONICAL_OR_UNBOUND_TERMINAL_RECEIPT".to_string(),
        ));
    }

    let replay = match execute_frozen_complex_qualification(
        cache_root,
        replay_request,
        formation_receipt_path,
    ) {
        Ok(run) => run,
        Err(_) => {
            return Ok(formation_status
                .qualification_state_unavailable("QUALIFICATION_REPLAY_UNAVAILABLE".to_string()));
        }
    };

    match QualificationReceipt::from_slice(
        &qualification_bytes,
        &price_only_qualification_issuance(&replay)?,
    ) {
        Ok(receipt) => receipt.status(),
        Err(_) => Ok(formation_status
            .qualification_state_unavailable("QUALIFICATION_REPLAY_MISMATCH".to_string())),
    }
}

fn execute_frozen_complex_qualification(
    cache_root: &Path,
    producer_request: NativeProducerVerificationRequest,
    formation_receipt_path: &Path,
) -> anyhow::Result<ComplexQualificationRun> {
    execute_frozen_complex_qualification_with_evidence(
        cache_root,
        verify_native_producer(producer_request),
        formation_receipt_path,
    )
}

fn execute_frozen_complex_qualification_with_evidence(
    cache_root: &Path,
    producer_evidence: NativeProducerEvidence,
    formation_receipt_path: &Path,
) -> anyhow::Result<ComplexQualificationRun> {
    let formation_run =
        execute_frozen_complex_formation_with_evidence(cache_root, producer_evidence)?;
    anyhow::ensure!(
        formation_run.producer_is_verified(),
        "qualification requires a verified native producer"
    );
    let formation_bytes = read_bounded_receipt(
        formation_receipt_path,
        MAX_FORMATION_RECEIPT_BYTES,
        "formation",
    )?;
    let formation_receipt = recover_price_only_formation_receipt(&formation_bytes, &formation_run)?;
    formation_receipt.require_sealed_qualification_boundary()?;
    anyhow::ensure!(
        formation_receipt.disposition()
            == crate::receipt::FormationFamilyDisposition::FormationSurvivorNotQualified,
        "formation family did not survive economic, deletion, and robustness gates"
    );
    let formation_status = formation_receipt.status()?;
    let candidate = formation_status
        .selected_candidate()
        .context("surviving formation receipt has no selected candidate")?;
    anyhow::ensure!(
        candidate.variant_id() == "full",
        "price-only qualification requires the frozen full candidate variant"
    );
    let selected_tuple_id = candidate.parameter_id().to_string();
    let intent = PriceOnlyResearchIntent::frozen()?;
    let family = FrozenStrategyFamily::frozen_price_only()?;
    let trial = family.trial_by_coordinate(&selected_tuple_id, "full")?;
    let artifact = family.materialize(trial)?;
    let parameters = price_program_parameters(&intent, &selected_tuple_id, "full")?;
    family.verify_materialized(trial, &artifact)?;
    artifact.verify_parameters(&parameters)?;
    anyhow::ensure!(
        artifact.identity().parameters_digest.as_deref() == Some(candidate.parameters_digest())
            && artifact.identity().artifact_digest == candidate.strategy_artifact_digest(),
        "selected formation candidate does not bind the frozen qualification artifact"
    );
    let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
    let bar_type = BarType::from_str(PILOT_BAR_TYPE)?;
    let starting_balance =
        Money::from_str(&intent.payload.costs.initial_balance).map_err(anyhow::Error::msg)?;
    let artifact_identity = artifact.identity().clone();
    let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
    let strategy_id = format!("STRATEGY-FACTORY-COMPLEX-{selected_tuple_id}-full");
    let strategy = ProgramHostStrategy::new(
        StrategyId::from(strategy_id.as_str()),
        &artifact,
        &parameters,
        QUALIFICATION_SOURCE_WINDOW.program_run_scope()?,
        price_program_host_bindings()?,
        Rc::clone(&trace),
    )?;
    let loaded = load_market_data(
        cache_root,
        &instrument,
        bar_type,
        QUALIFICATION_SOURCE_WINDOW,
    )?;
    let native = execute_loaded_with_strategy(
        &instrument,
        loaded,
        strategy,
        || trace.borrow().callback_failure.clone(),
        NativeExecutionSpec {
            starting_balance,
            trade_on_close: false,
            run_id: &format!("strategy-factory-complex-qualification-{selected_tuple_id}"),
            require_round_trip: false,
            require_terminal_flat: false,
        },
    )?;
    let coverage = ComplexDecisionCoverage::from_tags(&trace.borrow().decision_tags)?;
    Ok(ComplexQualificationRun {
        intent,
        formation_receipt,
        artifact_identity,
        canonical_result: native.canonical_result,
        source_manifest_digest: native.source_manifest_digest,
        source_event_count: native.source_event_count,
        executable_bar_count: native.executable_bar_count,
        coverage,
        producer_evidence: formation_run.producer_evidence().clone(),
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

fn software_rejected_formation_family(
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
    finish_price_run(producer_evidence, trials)
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

fn pilot_dataset_digest(window: SourceWindow) -> anyhow::Result<String> {
    let source_digest = monthly_kline_dataset_digest(
        &CanonicalDatasetManifest::parse(MANIFEST_BYTES)?,
        dataset_archive_range(window)?,
    )?;
    bind_dataset_consumer_digest(&source_digest, window)
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
    use std::{fs::File, io::Write};

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
    fn expected_clock_has_one_bound_absence() {
        let opens = expected_source_opens(PILOT_SOURCE_WINDOW).collect::<Vec<_>>();
        assert_eq!(opens.len(), EXPECTED_WALL_SLOTS);
        assert_eq!(opens.first(), Some(&WARMUP_START_NS));
        assert_eq!(opens.last(), Some(&VALIDATION_END_NS));
        assert!(opens.binary_search(&MISSING_OPEN_NS).is_ok());
        assert!(opens.binary_search(&ZERO_VOLUME_OPEN_NS).is_ok());
    }

    #[rstest]
    fn formation_source_projection_excludes_the_holdout_partition() {
        let digest = pilot_dataset_digest(FORMATION_SOURCE_WINDOW).unwrap();
        assert_eq!(
            digest,
            "blake3:071d1a874c8062d78cb3e2b85c58ccf56053acd40797c5fe521348f1b5116121"
        );

        let mut changed: serde_json::Value = serde_json::from_slice(MANIFEST_BYTES).unwrap();
        changed["objects"][23]["sha256"] = serde_json::Value::String("0".repeat(64));
        let mut bytes = serde_json::to_vec(&changed).unwrap();
        bytes.push(b'\n');
        let changed_source = monthly_kline_dataset_digest(
            &CanonicalDatasetManifest::parse(&bytes).unwrap(),
            dataset_archive_range(FORMATION_SOURCE_WINDOW).unwrap(),
        )
        .unwrap();
        let changed =
            bind_dataset_consumer_digest(&changed_source, FORMATION_SOURCE_WINDOW).unwrap();
        assert_eq!(digest, changed, "unused holdout object changed Formation");

        let opens = expected_source_opens(FORMATION_SOURCE_WINDOW).collect::<Vec<_>>();
        assert_eq!(opens.len(), FORMATION_WALL_SLOTS);
        assert_eq!(opens.last(), Some(&FORMATION_END_NS));
        assert!(opens.iter().all(|open| *open < VALIDATION_START_NS));
    }

    #[rstest]
    fn qualification_source_projection_is_exact_and_starts_with_warmup_archive() {
        let digest = pilot_dataset_digest(QUALIFICATION_SOURCE_WINDOW).unwrap();
        assert_ne!(
            digest,
            pilot_dataset_digest(FORMATION_SOURCE_WINDOW).unwrap()
        );

        let opens = expected_source_opens(QUALIFICATION_SOURCE_WINDOW).collect::<Vec<_>>();
        assert_eq!(opens.len(), QUALIFICATION_WALL_SLOTS);
        assert_eq!(opens.first(), Some(&QUALIFICATION_WARMUP_START_NS));
        assert_eq!(opens.last(), Some(&VALIDATION_END_NS));
        assert!(
            opens
                .iter()
                .filter(|open| **open < VALIDATION_START_NS)
                .count()
                > 0
        );
        assert_eq!(
            opens
                .iter()
                .filter(|open| **open >= VALIDATION_START_NS)
                .count(),
            8_784
        );
        assert!(
            QUALIFICATION_SOURCE_WINDOW
                .expected_missing_open_ns
                .is_none()
        );
        assert!(
            QUALIFICATION_SOURCE_WINDOW
                .expected_zero_volume_open_ns
                .is_none()
        );

        let changed_decision = SourceWindow {
            decision_start_open_ns: VALIDATION_START_NS + HOUR_NS,
            ..QUALIFICATION_SOURCE_WINDOW
        };
        assert_ne!(digest, pilot_dataset_digest(changed_decision).unwrap());
        assert!(
            SourceWindow {
                decision_start_open_ns: VALIDATION_END_NS,
                ..QUALIFICATION_SOURCE_WINDOW
            }
            .program_run_scope()
            .is_err()
        );
    }

    #[rstest]
    fn one_parameterized_strategy_forbids_qualification_warmup_decisions() {
        let formation = FORMATION_SOURCE_WINDOW.program_run_scope().unwrap();
        let qualification = QUALIFICATION_SOURCE_WINDOW.program_run_scope().unwrap();
        let available_at = |open_ns| open_ns + CLOSED_HOUR_OFFSET_NS;

        assert!(
            (formation.decision_start_ns..formation.end_ns)
                .contains(&available_at(WARMUP_START_NS))
        );
        assert!(
            !(qualification.decision_start_ns..qualification.end_ns)
                .contains(&available_at(QUALIFICATION_WARMUP_START_NS))
        );
        assert!(
            !(qualification.decision_start_ns..qualification.end_ns)
                .contains(&available_at(VALIDATION_START_NS - HOUR_NS))
        );
        assert!(
            (qualification.decision_start_ns..qualification.end_ns)
                .contains(&available_at(VALIDATION_START_NS))
        );
        assert!(
            (qualification.decision_start_ns..qualification.end_ns)
                .contains(&available_at(VALIDATION_END_NS - HOUR_NS))
        );
        assert!(
            !(qualification.decision_start_ns..qualification.end_ns)
                .contains(&available_at(VALIDATION_END_NS))
        );
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
        assert!(receipt.require_sealed_qualification_boundary().is_err());
    }

    #[rstest]
    #[ignore = "requires the separately downloaded exact 24-month Binance Vision cache"]
    fn exact_pilot_cache_executes_native_family_path() {
        let cache_root = std::env::var_os("STRATEGY_FACTORY_PILOT_TEST_CACHE")
            .map(PathBuf::from)
            .expect("STRATEGY_FACTORY_PILOT_TEST_CACHE");
        let run =
            execute_frozen_pilot(&cache_root, NativeProducerEvidence::verified_for_test()).unwrap();
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
        assert!(receipt.require_sealed_qualification_boundary().is_err());
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
                NativeProducerEvidence::verified_for_test(),
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
    #[ignore = "requires the separately downloaded exact 24-month Binance Vision cache"]
    fn exact_complex_cache_rejects_low_roi_before_one_way_qualification() {
        let cache_root = std::env::var_os("STRATEGY_FACTORY_PILOT_TEST_CACHE")
            .map(PathBuf::from)
            .expect("STRATEGY_FACTORY_PILOT_TEST_CACHE");
        reset_market_data_load_attempts();
        let formation_run = execute_frozen_complex_formation_with_evidence(
            &cache_root,
            NativeProducerEvidence::verified_for_test(),
        )
        .unwrap();
        let formation_receipt = issue_price_only_formation_receipt(&formation_run).unwrap();
        assert_eq!(
            formation_receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::EconomicRejected
        );
        let formation_loads = market_data_load_attempts();
        assert_eq!(formation_loads, 20);
        let directory = tempfile::tempdir().unwrap();
        let formation_path = directory.path().join("formation-receipt.jcs");
        File::create(&formation_path)
            .unwrap()
            .write_all(&formation_receipt.to_bytes().unwrap())
            .unwrap();
        let error = execute_frozen_complex_qualification_with_evidence(
            &cache_root,
            NativeProducerEvidence::verified_for_test(),
            &formation_path,
        )
        .unwrap_err();
        assert!(
            format!("{error:#}").contains(
                "formation family did not survive economic, deletion, and robustness gates"
            )
        );
        assert_eq!(market_data_load_attempts(), formation_loads + 20);
    }

    #[rstest]
    fn rejected_producer_precedes_qualification_receipt_and_holdout_access() {
        reset_market_data_load_attempts();
        let error = run_frozen_complex_qualification(
            Path::new("/definitely/not/a/strategy-factory-cache"),
            NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            ),
            Path::new("/definitely/not/a/formation-receipt"),
        )
        .unwrap_err();
        assert!(error.to_string().contains("verified native producer"));
        assert_eq!(market_data_load_attempts(), 0);
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
