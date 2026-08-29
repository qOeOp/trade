use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use rstest::rstest;
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind,
};
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_data::owner::{
    pit_snapshot::joined_input_sealed_acceptance::{
        SealedAcceptanceStrategyInputJoinCorpus, issue_strategy_input_join_corpus,
    },
    source_binding::BindingDigest,
};
use vibe_model::{
    data::{Bar, BarSpecification, BarType, BookOrder, Data, OrderBookDelta, TradeTick},
    enums::{
        AccountType, AggregationSource, AggressorSide, BarAggregation, BookAction, BookType,
        OmsType, OrderSide, PriceType,
    },
    identifiers::{InstrumentId, StrategyId, TradeId, Venue},
    instruments::{Instrument, InstrumentAny, stubs::crypto_perpetual_ethusdt},
    types::{Money, Price, Quantity},
};

use super::{ProgramHostV2, admit_backtest_lifecycle_event_v2};
use crate::{
    artifact_v2::{StrategyArtifactV2, StrategyArtifactV2Error},
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    program_host_backtest_v2::{BacktestProgramHostStrategyV2, BacktestProgramHostTraceV2},
    program_host_v2_backtest_tests::stateful_plugin_module,
    strategy_design_v2::{
        INPUT_JOIN_LATEST_NOT_AFTER_TRIGGER_V1, InputJoinV2, LifecycleKindV2, PortBindingV2,
        PortContractV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyDesignPreparationV2, StrategyPlanV2,
        compile_strategy_design_v2, issue_plugin_implementation_receipt_v2_for_test,
        prepare_strategy_design_v2, strategy_input_role_identity_v2,
    },
};

const AAPL_OPEN: &str = "research.input.open.v1";
const AAPL_CLOSE: &str = "research.input.close.v1";
const MSFT_HOUR_CLOSE: &str = "research.input.msft-hour-close.v1";
const QQQ_DAY_CLOSE: &str = "research.input.qqq-day-close.v1";

#[rstest]
fn owner_join_corpus_is_bound_to_the_exact_canonical_design_and_roles() {
    let design = joined_design();
    let StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = prepare_strategy_design_v2(&design)
    else {
        panic!("joined design prepares")
    };
    let corpus = issue_strategy_input_join_corpus().expect("Owner-sealed joined corpus");

    assert_eq!(
        corpus.bindings()[0].locator().strategy_design_identity(),
        design_identity,
        "the zero-argument corpus must stay bound to its canonical Design identity"
    );

    for input in &design.inputs {
        let binding = corpus
            .bindings()
            .iter()
            .find(|binding| {
                binding.locator().instrument() == input.instrument
                    && binding.locator().timeframe() == input.timeframe
                    && binding.locator().field_semantic_identity() == input.field_semantic_id
            })
            .expect("one exact Owner binding per declared role");
        assert_eq!(
            binding.locator().input_role_identity(),
            strategy_input_role_identity_v2(input),
            "the zero-argument corpus must stay bound to every canonical role identity"
        );
    }
}

#[rstest]
fn joined_host_orders_owner_frames_and_failures_are_pre_guest_atomic() {
    let (plan, artifact, corpus) = fixture();
    let mut ordered = started_host(&plan, &artifact);
    let mut reversed = started_host(&plan, &artifact);

    for event in corpus.events() {
        let forward = event.frames().iter().collect::<Vec<_>>();
        let backward = event.frames().iter().rev().collect::<Vec<_>>();
        let forward_trace = ordered
            .apply_market_data_joined_event(&forward)
            .expect("complete Owner join executes");
        let backward_trace = reversed
            .apply_market_data_joined_event(&backward)
            .expect("caller frame order is not authority");
        assert_eq!(forward_trace, backward_trace);
        assert_eq!(ordered.checkpoint(), reversed.checkpoint());
    }
    assert_eq!(ordered.plugin_calls(), 3);

    let checkpoint = ordered.checkpoint().clone();
    let kernel = ordered.kernel_checkpoint();
    let calls = ordered.plugin_calls();
    let event = &corpus.events()[0];
    let missing = event.frames()[..3].iter().collect::<Vec<_>>();
    assert!(ordered.apply_market_data_joined_event(&missing).is_err());
    assert_unchanged(&ordered, &checkpoint, kernel, calls);

    let stale = corpus.stale().frames().iter().collect::<Vec<_>>();
    assert!(ordered.apply_market_data_joined_event(&stale).is_err());
    assert_unchanged(&ordered, &checkpoint, kernel, calls);

    let future = vec![
        &event.frames()[0],
        &event.frames()[1],
        &event.frames()[2],
        &corpus.events()[1].frames()[3],
    ];
    assert!(ordered.apply_market_data_joined_event(&future).is_err());
    assert_unchanged(&ordered, &checkpoint, kernel, calls);

    let cross_splice = corpus.cross_splice().frames().iter().collect::<Vec<_>>();
    assert!(
        ordered
            .apply_market_data_joined_event(&cross_splice)
            .is_err()
    );
    assert_unchanged(&ordered, &checkpoint, kernel, calls);

    let conflicting = vec![
        &event.frames()[0],
        &event.frames()[1],
        &event.frames()[2],
        &event.frames()[2],
    ];
    assert!(
        ordered
            .apply_market_data_joined_event(&conflicting)
            .is_err()
    );
    assert_unchanged(&ordered, &checkpoint, kernel, calls);
}

#[rstest]
fn joined_host_checkpoint_restore_has_an_equal_execution_suffix() {
    let (plan, artifact, corpus) = fixture();
    let mut uninterrupted = started_host(&plan, &artifact);
    let mut restored = started_host(&plan, &artifact);
    let first = corpus.events()[0].frames().iter().collect::<Vec<_>>();
    assert_eq!(
        uninterrupted.apply_market_data_joined_event(&first),
        restored.apply_market_data_joined_event(&first)
    );
    let checkpoint = restored.checkpoint().clone();
    restored = ProgramHostV2::restore(plan, artifact, &checkpoint)
        .expect("Host-issued joined checkpoint restores");

    let mut uninterrupted_suffix = Vec::new();
    let mut restored_suffix = Vec::new();
    for event in &corpus.events()[1..] {
        let frames = event.frames().iter().collect::<Vec<_>>();
        uninterrupted_suffix.push(
            uninterrupted
                .apply_market_data_joined_event(&frames)
                .expect("uninterrupted joined suffix"),
        );
        restored_suffix.push(
            restored
                .apply_market_data_joined_event(&frames)
                .expect("restored joined suffix"),
        );
    }
    assert_eq!(uninterrupted_suffix, restored_suffix);
    assert_eq!(uninterrupted.checkpoint(), restored.checkpoint());
}

#[rstest]
fn owner_join_drives_the_real_isolated_backtest_sim_exchange_repeatably() {
    let first = run_backtest_join_corpus().expect("first joined Backtest/Sim run");
    let repeated = run_backtest_join_corpus().expect("repeated joined Backtest/Sim run");
    assert_eq!(first, repeated);
}

fn run_backtest_join_corpus() -> anyhow::Result<Vec<u8>> {
    let (plan, artifact, corpus) = fixture();
    let instrument = InstrumentAny::CryptoPerpetual(crypto_perpetual_ethusdt());
    let instrument_id = instrument.id();
    let bar_type = BarType::new(
        instrument_id,
        BarSpecification::new(1, BarAggregation::Minute, PriceType::Last),
        AggregationSource::External,
    );
    let mut events = Vec::with_capacity(corpus.events().len());
    let mut data = Vec::with_capacity(corpus.events().len() * 6);
    for (offset, joined) in corpus.events().iter().enumerate() {
        let frames = joined.frames().iter().collect::<Vec<_>>();
        let event = super::admit_market_data_joined_program_event_v2(&plan, &frames)?;
        let open = event
            .fixed_i128_input(AAPL_OPEN)
            .ok_or_else(|| anyhow::anyhow!("joined event omitted AAPL open"))?;
        let close_mantissa = event
            .fixed_i128_input(AAPL_CLOSE)
            .ok_or_else(|| anyhow::anyhow!("joined event omitted AAPL close"))?;
        let time = event.envelope().order_key.logical_time_ns;
        let open = price_from_scaled(open)?;
        let close = price_from_scaled(close_mantissa)?;
        let cents = i64::try_from(close_mantissa)?;
        let sequence = (offset as u64 + 1) * 10;
        data.extend([
            Data::Delta(OrderBookDelta::clear(
                instrument_id,
                sequence,
                time.into(),
                time.into(),
            )),
            book_level(
                instrument_id,
                OrderSide::Buy,
                cents,
                100,
                sequence * 10 + 1,
                sequence + 1,
                time,
            ),
            book_level(
                instrument_id,
                OrderSide::Sell,
                cents,
                100,
                sequence * 10 + 2,
                sequence + 2,
                time,
            ),
            Data::Bar(Bar::new(
                bar_type,
                open,
                open.max(close),
                open.min(close),
                close,
                Quantity::from("100.000"),
                time.into(),
                time.into(),
            )),
            trade_fill(
                instrument_id,
                cents,
                5,
                &format!("INPUT-JOIN-{offset}-1"),
                time + 1,
            ),
            trade_fill(
                instrument_id,
                cents,
                3,
                &format!("INPUT-JOIN-{offset}-2"),
                time + 2,
            ),
        ]);
        events.push(event);
    }

    let trace = Rc::new(RefCell::new(BacktestProgramHostTraceV2::default()));
    let restored = Rc::new(Cell::new(false));
    let strategy = BacktestProgramHostStrategyV2::new(
        StrategyId::from("STRATEGY-DESIGN-V2-INPUT-JOIN-001"),
        plan,
        artifact,
        instrument_id,
        bar_type,
        events,
        false,
        restored,
        Rc::clone(&trace),
    )?;
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("BINANCE"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L2_MBP)
            .starting_balances(vec![Money::from("1_000_000 USDT")])
            .bar_execution(false)
            .liquidity_consumption(true)
            .use_random_ids(false)
            .build()?,
    )?;
    engine.add_instrument(&instrument)?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, Some("input-join-v2-corpus".into()), false)?;
    let trace = trace.borrow().clone();
    anyhow::ensure!(
        trace.callback_failure.is_none(),
        "joined Backtest callback failed: {:?}",
        trace.callback_failure
    );
    let bar_intents = trace
        .host_transitions
        .iter()
        .filter(|transition| transition.lifecycle == "BAR")
        .map(|transition| transition.position_intent.as_str())
        .collect::<Vec<_>>();
    anyhow::ensure!(
        bar_intents == ["ENTER", "ADD", "REDUCE"],
        "joined regime state did not drive the expected atomic target sequence: {bar_intents:?}"
    );
    anyhow::ensure!(
        trace
            .native_order_observations
            .iter()
            .any(|observation| !observation.protection_order && observation.event == "SUBMITTED"),
        "Sim Exchange did not observe the Host-sealed target intent"
    );
    Ok(serde_json::to_vec(&(
        trace,
        engine.get_canonical_result()?.to_bytes()?,
    ))?)
}

fn trade_fill(
    instrument_id: InstrumentId,
    cents: i64,
    units: u64,
    trade_id: &str,
    time_ns: u64,
) -> Data {
    let text = format!("{}.{:02}", cents / 100, cents.unsigned_abs() % 100);
    Data::Trade(TradeTick::new(
        instrument_id,
        Price::from(text.as_str()),
        Quantity::new(units as f64, 3),
        AggressorSide::NoAggressor,
        TradeId::from(trade_id),
        time_ns.into(),
        time_ns.into(),
    ))
}

fn price_from_scaled(value: i128) -> anyhow::Result<Price> {
    let cents = i64::try_from(value)?;
    let text = format!("{}.{:02}", cents / 100, cents.unsigned_abs() % 100);
    Ok(Price::from(text.as_str()))
}

#[allow(clippy::too_many_arguments)]
fn book_level(
    instrument_id: InstrumentId,
    side: OrderSide,
    cents: i64,
    units: u64,
    order_id: u64,
    sequence: u64,
    time_ns: u64,
) -> Data {
    let text = format!("{}.{:02}", cents / 100, cents.unsigned_abs() % 100);
    Data::Delta(OrderBookDelta::new(
        instrument_id,
        BookAction::Add,
        BookOrder::new(
            side,
            Price::from(text.as_str()),
            Quantity::new(units as f64, 3),
            order_id,
        ),
        0,
        sequence,
        time_ns.into(),
        time_ns.into(),
    ))
}

fn assert_unchanged(
    host: &ProgramHostV2,
    checkpoint: &super::ProgramCheckpointBundleV2,
    kernel: strategy_factory_program_sdk::lifecycle_v1::CheckpointV1,
    calls: u64,
) {
    assert_eq!(host.checkpoint(), checkpoint);
    assert_eq!(host.kernel_checkpoint(), kernel);
    assert_eq!(host.plugin_calls(), calls);
}

fn fixture() -> (
    StrategyPlanV2,
    StrategyArtifactV2,
    SealedAcceptanceStrategyInputJoinCorpus,
) {
    let design = joined_design();
    let corpus = issue_strategy_input_join_corpus().expect("Owner-sealed joined corpus");
    let manifest = &design.plugins[0];
    let wasm = stateful_plugin_module(manifest).expect("bounded stateful plugin module");
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )
    .expect("repeat-equal plugin build");
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        manifest,
        build.implementation_capsule_digest(),
        build.source_entry_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        manifest.abi_version,
        manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let plan = match compile_strategy_design_v2(design, corpus.bindings(), &[receipt]) {
        StrategyCompilationV2::Compiled(plan) => plan,
        other => panic!("exact Owner-bound joined design compiles: {other:?}"),
    };
    let artifact = StrategyArtifactV2::issue(&plan, vec![build])
        .map_err(|error: StrategyArtifactV2Error| error.to_string())
        .expect("joined strategy artifact");
    (*plan, artifact, corpus)
}

fn started_host(plan: &StrategyPlanV2, artifact: &StrategyArtifactV2) -> ProgramHostV2 {
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).expect("joined Host");
    let order_key =
        EventOrderKeyV1::new(1, 1, LifecycleKind::Start, 1, [1; 16]).expect("START key");
    let envelope = LifecycleEnvelopeV1::new_bound(order_key, EnvelopePayloadV1::Start)
        .expect("START envelope");
    let start = admit_backtest_lifecycle_event_v2(plan, envelope).expect("START admission");
    host.apply_event(&start).expect("START applies");
    host
}

fn joined_design() -> crate::strategy_design_v2::StrategyDesignV2 {
    let mut design = crate::program_host_v2_tests::executable_design();
    design
        .inputs
        .retain(|input| matches!(input.semantic_id.as_str(), AAPL_OPEN | AAPL_CLOSE));
    let open = design
        .inputs
        .iter_mut()
        .find(|input| input.semantic_id == AAPL_OPEN)
        .expect("AAPL open role");
    open.instrument = "AAPL.XNAS".into();
    open.timeframe = "1M".into();
    let close = design
        .inputs
        .iter_mut()
        .find(|input| input.semantic_id == AAPL_CLOSE)
        .expect("AAPL close role");
    close.instrument = "AAPL.XNAS".into();
    close.timeframe = "1M".into();
    let mut msft = close.clone();
    msft.semantic_id = MSFT_HOUR_CLOSE.into();
    msft.instrument = "MSFT.XNAS".into();
    msft.timeframe = "1H".into();
    let mut qqq = close.clone();
    qqq.semantic_id = QQQ_DAY_CLOSE.into();
    qqq.instrument = "QQQ.XNAS".into();
    qqq.timeframe = "1D".into();
    design.inputs.extend([msft, qqq]);
    design.joins = vec![InputJoinV2 {
        semantic_id: "research.input-join.cross-leg-regime.v1".into(),
        inputs: vec![
            AAPL_OPEN.into(),
            AAPL_CLOSE.into(),
            MSFT_HOUR_CLOSE.into(),
            QQQ_DAY_CLOSE.into(),
        ],
        alignment_semantic_id: INPUT_JOIN_LATEST_NOT_AFTER_TRIGGER_V1.into(),
        trigger_input_id: AAPL_CLOSE.into(),
        max_staleness_ns: 500,
    }];
    design.state[0].initial = TypedConstantV2::Bytes { value: vec![0] };
    design.resources.max_inputs = 4;
    design.plugins[0].max_fuel = 10_000_000;
    design.plugins[0].input_ports.extend([
        PortContractV2 {
            semantic_id: "input.aapl-open.v1".into(),
            value_type: ValueTypeV2::I128,
            max_bytes: 16,
        },
        PortContractV2 {
            semantic_id: "input.aapl-close.v1".into(),
            value_type: ValueTypeV2::I128,
            max_bytes: 16,
        },
    ]);

    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            if reaction.kind == LifecycleKindV2::Bar {
                replace_input_binding(node, "input.open.v1", MSFT_HOUR_CLOSE);
                replace_input_binding(node, "input.close.v1", QQQ_DAY_CLOSE);
                node.input_bindings.extend([
                    PortBindingV2 {
                        port_id: "input.aapl-open.v1".into(),
                        source: ValueRefV2::Input {
                            input_id: AAPL_OPEN.into(),
                        },
                    },
                    PortBindingV2 {
                        port_id: "input.aapl-close.v1".into(),
                        source: ValueRefV2::Input {
                            input_id: AAPL_CLOSE.into(),
                        },
                    },
                ]);
            } else {
                for binding in &mut node.input_bindings {
                    if matches!(binding.source, ValueRefV2::Input { .. }) {
                        binding.source = timer_price();
                    }
                }

                for port_id in ["input.aapl-open.v1", "input.aapl-close.v1"] {
                    node.input_bindings.push(PortBindingV2 {
                        port_id: port_id.into(),
                        source: timer_price(),
                    });
                }
            }
            node.input_bindings.sort();
        }
    }
    design.inputs.sort();
    design.plugins[0].input_ports.sort();
    design
}

fn replace_input_binding(
    node: &mut crate::strategy_design_v2::ComputeNodeV2,
    port_id: &str,
    input_id: &str,
) {
    node.input_bindings
        .iter_mut()
        .find(|binding| binding.port_id == port_id)
        .expect("existing stateful port")
        .source = ValueRefV2::Input {
        input_id: input_id.into(),
    };
}

fn timer_price() -> ValueRefV2 {
    ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-close.v1".into(),
    }
}
