use std::{cell::RefCell, fmt::Debug, rc::Rc};

use vibe_backtest::{config::BacktestEngineConfig, engine::BacktestEngine};
use vibe_common::{
    actor::{DataActor, DataActorCore, data_actor::DataActorConfig},
    vibe_actor,
};
use vibe_model::{
    data::{CustomData, Data, DataType},
    identifiers::ActorId,
};
use vibe_strategy_factory::{
    NEXT_OPEN_NOT_ADMITTED_CODE, PilotNotAdmitted,
    artifact::{BUILD_RECIPE_LOCATOR, GUEST_SOURCE_LOCATOR},
    data::{
        BinanceArchiveProvenance, BinanceKlineRecord, DataAdmissionError, MISSING_OPEN_NS,
        NonExecutableKlineEvent, ZERO_VOLUME_DATA_TYPE, project_backtest_inputs,
    },
    decision::{
        ChannelProjection, CoreWasmValueType, DECISION_ABI_VERSION, DECISION_EXPORT,
        DECISION_SIGNATURE, DecisionAction, DecisionDirection, DecisionInput, EntryRule,
        ExecutionTiming, ExitRule, FinalBarInvocation, TerminalRule, ValidationInvocation,
        WarmupInvocation, ZeroVolumeInvocation,
    },
    intent::FROZEN_INTENT_ID,
    prepare_frozen_pilot,
    runtime::{RuntimeError, validate_restricted_module},
};

struct SourceEventRecorder {
    core: DataActorCore,
    data_type: DataType,
    seen: Rc<RefCell<Vec<NonExecutableKlineEvent>>>,
}

impl SourceEventRecorder {
    fn new(data_type: DataType, seen: Rc<RefCell<Vec<NonExecutableKlineEvent>>>) -> Self {
        let config = DataActorConfig {
            actor_id: Some(ActorId::from("STRATEGY-FACTORY-SOURCE-EVENT-RECORDER")),
            ..Default::default()
        };
        Self {
            core: DataActorCore::new(config),
            data_type,
            seen,
        }
    }
}

vibe_actor!(SourceEventRecorder);

impl Debug for SourceEventRecorder {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SourceEventRecorder")
            .finish_non_exhaustive()
    }
}

impl DataActor for SourceEventRecorder {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.subscribe_data(self.data_type.clone(), None, None);
        Ok(())
    }

    fn on_data(&mut self, data: &CustomData) -> anyhow::Result<()> {
        let event = data
            .data
            .as_any()
            .downcast_ref::<NonExecutableKlineEvent>()
            .ok_or_else(|| anyhow::anyhow!("unexpected custom data type"))?;
        self.seen.borrow_mut().push(event.clone());
        Ok(())
    }
}

#[test]
fn zero_volume_source_event_reaches_real_backtest_actor_in_venue_free_engine() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    let input = prepared.inputs().data()[0].clone();
    let Data::Custom(custom) = &input else {
        panic!("zero-volume observation must be CustomData");
    };
    assert_eq!(custom.data_type.type_name(), ZERO_VOLUME_DATA_TYPE);

    let seen = Rc::new(RefCell::new(Vec::new()));
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })
    .expect("engine");
    engine
        .add_actor(SourceEventRecorder::new(
            custom.data_type.clone(),
            Rc::clone(&seen),
        ))
        .expect("actor");
    let orders_before = engine
        .kernel()
        .cache
        .borrow()
        .orders_total_count(None, None, None, None, None);
    let positions_before = engine
        .kernel()
        .cache
        .borrow()
        .positions_total_count(None, None, None, None, None);
    let events_before = engine.get_result().total_events;
    engine
        .add_data(vec![input], None, true, true)
        .expect("custom projection admitted by real engine");
    engine.run(None, None, None, false).expect("replay");

    let result = engine.get_result();
    assert_eq!(result.iterations, 1);
    assert_eq!(result.total_events, events_before);
    assert_eq!(result.total_orders, orders_before);
    assert_eq!(result.total_positions, positions_before);
    assert_eq!(seen.borrow().len(), 1);
    let event = &seen.borrow()[0];
    assert!(!event.synthetic);
    assert!(event.source_gap);
    assert!(!event.tradable);
    assert!(!event.execution_allowed);
    assert!(
        engine
            .kernel()
            .cache
            .borrow()
            .order_book(&"BTCUSDT.BINANCE".into())
            .is_none()
    );
}

#[test]
fn restricted_wasm_accepts_only_the_exact_inert_compiler_memory_envelope() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    validate_restricted_module(prepared.artifact().wasm()).expect("exact compiler envelope");
    let module_with_memory = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01,
    ];
    assert_eq!(
        validate_restricted_module(&module_with_memory).unwrap_err(),
        RuntimeError::Envelope("fixed compiler memory")
    );
}

#[test]
fn projection_rejects_unbound_or_malformed_source_records() {
    let mut provenance = BinanceArchiveProvenance::frozen_observation();
    provenance.archive_sha256 = "00".repeat(32);
    assert_eq!(
        project_backtest_inputs(
            &provenance,
            &[BinanceKlineRecord::frozen_zero_volume_observation()]
        )
        .unwrap_err(),
        DataAdmissionError::UnboundProvenance
    );

    let provenance = BinanceArchiveProvenance::frozen_observation();
    let mut record = BinanceKlineRecord::frozen_zero_volume_observation();
    record.instrument_id = "ETHUSDT.BINANCE".to_string();
    assert!(matches!(
        project_backtest_inputs(&provenance, &[record]),
        Err(DataAdmissionError::Malformed(_))
    ));
}

#[test]
fn projection_rejects_an_empty_source_record_set() {
    assert_eq!(
        project_backtest_inputs(&BinanceArchiveProvenance::frozen_observation(), &[]).unwrap_err(),
        DataAdmissionError::EmptyRecordSet
    );
}

#[test]
fn zero_volume_cannot_be_promoted_to_executable_bar_authority() {
    let provenance = BinanceArchiveProvenance::frozen_observation();
    let mut record = BinanceKlineRecord::frozen_zero_volume_observation();
    record.tradable = true;
    record.execution_allowed = true;
    assert_eq!(
        project_backtest_inputs(&provenance, &[record]).unwrap_err(),
        DataAdmissionError::ZeroVolumeExecutableAuthority
    );
}

#[test]
fn copied_archive_digest_cannot_authorize_a_caller_forged_executable_bar() {
    let provenance = BinanceArchiveProvenance::frozen_observation();
    let mut record = BinanceKlineRecord::frozen_zero_volume_observation();
    record.base_volume = "1.00000000".to_string();
    record.source_gap = false;
    record.tradable = true;
    record.execution_allowed = true;

    assert_eq!(
        project_backtest_inputs(&provenance, &[record]).unwrap_err(),
        DataAdmissionError::ExecutableRecordAuthorityUnavailable
    );
}

#[test]
fn missing_interval_remains_absent_at_not_admitted_frontier() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    assert!(!prepared.inputs().contains_source_open_time(MISSING_OPEN_NS));
    let error = prepared.stop_before_backtest().unwrap_err();
    assert_eq!(
        error,
        PilotNotAdmitted::NextActualSourceEventOpenUnavailable
    );
    assert_eq!(
        error.to_string(),
        format!(
            "NOT_ADMITTED[{NEXT_OPEN_NOT_ADMITTED_CODE}]: frozen ResearchIntent requires market_at_next_actual_source_event_open, but current mature Backtest has no admitted execution seam"
        )
    );
}

#[test]
fn intent_artifact_and_runtime_projection_are_deterministic() {
    let first = prepare_frozen_pilot().expect("first preparation");
    let second = prepare_frozen_pilot().expect("second preparation");
    assert_eq!(first.intent(), second.intent());
    assert_eq!(first.artifact(), second.artifact());
    assert_eq!(first.runtime(), second.runtime());
    let identity = first.artifact().identity();
    assert_eq!(identity.schema_version, 3);
    assert_eq!(identity.guest_source_locator, GUEST_SOURCE_LOCATOR);
    assert_eq!(identity.build_recipe_locator, BUILD_RECIPE_LOCATOR);
    assert_eq!(
        identity.guest_source_digest,
        format!(
            "blake3:{}",
            blake3::hash(include_bytes!("../guest/pilot.rs")).to_hex()
        )
    );
    assert_eq!(
        identity.build_recipe_digest,
        format!(
            "blake3:{}",
            blake3::hash(include_bytes!("../build.rs")).to_hex()
        )
    );
    assert_eq!(
        first.artifact().identity().artifact_digest,
        first.runtime().artifact_digest
    );
}

#[test]
fn application_preparation_carries_the_exact_dormant_decision_contract() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    let contract = prepared.decision_contract();

    assert_eq!(contract.version(), DECISION_ABI_VERSION);
    assert_eq!(contract.export(), DECISION_EXPORT);
    assert_eq!(
        contract.signature().parameters(),
        &[
            CoreWasmValueType::I32,
            CoreWasmValueType::I32,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
        ]
    );
    assert_eq!(contract.signature().result(), CoreWasmValueType::I32);
    contract
        .validate_abi(DECISION_ABI_VERSION, DECISION_EXPORT, &DECISION_SIGNATURE)
        .expect("exact ABI identity");
    assert_eq!(contract.intent_identity(), FROZEN_INTENT_ID);
    assert_eq!(
        contract.pilot_id(),
        "btc-usdt-1h-dual-timescale-breakout-v1"
    );

    let mechanism = contract.mechanism();
    assert_eq!(mechanism.direction(), DecisionDirection::LongOnly);
    assert_eq!(
        mechanism.entry(),
        EntryRule::CurrentFastEmaAboveSlowAndCloseAbovePrior72High
    );
    assert_eq!(
        mechanism.exit(),
        ExitRule::CloseBelowPrior24LowOrCurrentFastEmaNotAboveSlow
    );
    assert_eq!(
        mechanism.execution(),
        ExecutionTiming::NextActualSourceEventOpen
    );
    assert_eq!(
        mechanism.terminal(),
        TerminalRule::PenultimateSignalFinalOpenExecution
    );
    assert_eq!(mechanism.entry_lookback(), 72);
    assert_eq!(mechanism.exit_lookback(), 24);
    assert_eq!(mechanism.fast_ema(), 24);
    assert_eq!(mechanism.slow_ema(), 120);

    let invocation = contract.invocation();
    assert_eq!(
        invocation.warmup(),
        WarmupInvocation::UpdateNativeIndicatorsWithoutGuest
    );
    assert_eq!(
        invocation.zero_volume(),
        ZeroVolumeInvocation::NoIndicatorGuestOrOrder
    );
    assert_eq!(
        invocation.validation(),
        ValidationInvocation::CurrentEmaAndPreviousCallbackChannels
    );
    assert_eq!(
        invocation.channels(),
        ChannelProjection::PreviousCallbackPrior72HighAndPrior24Low
    );
    assert_eq!(
        invocation.final_bar(),
        FinalBarInvocation::ReleasePenultimateExitAtOpenWithoutCloseDecision
    );
}

#[test]
fn application_preparation_executes_the_frozen_guest_truth_table() {
    let mut prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    let cases = [
        (
            (0, 0, 110.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::EnterLong,
        ),
        ((0, 0, 100.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
        (
            (0, 1, 79.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        (
            (0, 1, 90.0, 1.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        ((0, 1, 90.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
        (
            (1, 1, 90.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        ((1, 0, 110.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
    ];

    for ((phase, position, close, fast, slow, prior_high, prior_low), expected) in cases {
        let input =
            DecisionInput::from_abi(phase, position, close, fast, slow, prior_high, prior_low)
                .expect("closed finite decision input");
        assert_eq!(prepared.decide(input).expect("guest decision"), expected);
    }
}
