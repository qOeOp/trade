use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use rstest::rstest;
use serde::Serialize;
use strategy_factory_program_sdk::{
    lifecycle_v1::{PositionIntentV1, ProtectionProposalV1, ProtectionStateV1, TargetProposalV1},
    lifecycle_v2::{InstrumentKeyV2, InstrumentTargetSetV2, MemberTargetV2},
};
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_data::owner::{
    sealed_acceptance::issue_strategy_input_universe_frame, source_binding::BindingDigest,
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
};
use vibe_model::{
    data::{Bar, BarSpecification, BarType, BookOrder, Data, OrderBookDelta},
    enums::{
        AccountType, AggregationSource, BarAggregation, BookAction, BookType, OmsType, OrderSide,
        PriceType,
    },
    identifiers::{AccountId, InstrumentId, StrategyId, Symbol, Venue},
    instruments::{CryptoPerpetual, Instrument, InstrumentAny},
    types::{Currency, Money, Price, Quantity},
};

use super::{
    artifact_v2::{StrategyArtifactV2, StrategyArtifactV2Error},
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{PluginFrameKindV2, PluginFrameV2, TypedValueV2},
    program_host_backtest_target_set_v2::{
        BacktestTargetSetProgramHostStrategyV2, TargetSetBacktestTraceV2,
        seal_reconciliation_capability_for_test,
    },
    program_host_v2::{
        ProgramHostV2, admit_market_data_universe_program_event_v2,
        issue_backtest_universe_successor_for_test,
    },
    program_host_v2_tests::universe_design,
    strategy_design_v2::{PluginManifestV2, PortContractV2, ValueTypeV2},
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyPlanV2, compile_strategy_design_v2_for_universe,
        issue_plugin_implementation_receipt_v2_for_test,
    },
};

#[derive(Serialize)]
struct Corpus<'a> {
    trace: &'a TargetSetBacktestTraceV2,
    result: Vec<u8>,
    positions: Vec<(String, String)>,
}

struct RunEvidence {
    corpus: Vec<u8>,
    trace: TargetSetBacktestTraceV2,
    restored: bool,
    native_order_count: usize,
}

#[derive(Clone, Copy, Debug)]
enum InvalidBatchCase {
    Equity,
    Currency,
    Price,
    Multiplier,
    Grid,
    SecondOrder,
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn exact_two_member_target_set_drives_real_sim_with_bound_fills_and_restore_equality() {
    let uninterrupted = run_corpus(false).expect("uninterrupted target-set Backtest corpus");
    let restored = run_corpus(true).expect("in-process Host-restored target-set Backtest corpus");
    let repeated = run_corpus(false).expect("repeated target-set Backtest corpus");

    assert!(!uninterrupted.restored);
    assert!(restored.restored);
    assert_eq!(uninterrupted.corpus, restored.corpus);
    assert_eq!(uninterrupted.corpus, repeated.corpus);
    assert_eq!(uninterrupted.trace.canonical_target_sets.len(), 1);
    assert!(!uninterrupted.trace.venue_atomicity_claimed);
    assert!(!uninterrupted.trace.cold_restart_claimed);

    let position_fills = uninterrupted
        .trace
        .native_order_observations
        .iter()
        .filter(|event| !event.protection_order && event.event == "FILLED")
        .collect::<Vec<_>>();
    assert_eq!(position_fills.len(), 4);
    assert_eq!(position_fills[0].instrument, "AAPL.XNAS");
    assert_eq!(position_fills[1].instrument, "MSFT.XNAS");
    assert_eq!(position_fills[2].instrument, "AAPL.XNAS");
    assert_eq!(position_fills[3].instrument, "MSFT.XNAS");
    assert_ne!(
        position_fills[0].intent_identity,
        position_fills[1].intent_identity
    );
    let protection_events = uninterrupted
        .trace
        .native_order_observations
        .iter()
        .filter(|event| event.protection_order)
        .collect::<Vec<_>>();
    assert!(
        protection_events
            .iter()
            .any(|event| event.instrument == "AAPL.XNAS" && event.event == "UPDATED")
    );
    assert!(
        protection_events
            .iter()
            .any(|event| event.instrument == "MSFT.XNAS" && event.event == "UPDATED")
    );

    let member_fills = uninterrupted
        .trace
        .host_transitions
        .iter()
        .filter(|transition| transition.lifecycle == "FILL")
        .map(|transition| {
            (
                transition.instrument.as_str(),
                transition.position_after_grid_units,
                transition.residual_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        member_fills,
        [
            ("AAPL.XNAS", 2, 3),
            ("MSFT.XNAS", 1, 3),
            ("AAPL.XNAS", 5, 0),
            ("MSFT.XNAS", 4, 0),
        ]
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn second_submit_boundary_fault_preserves_first_real_submission_and_committed_host() {
    let evidence = run_corpus_with_fault(false, true).expect("second-submit fault corpus");
    let trace = &evidence.trace;
    assert!(
        trace
            .callback_failure
            .as_deref()
            .is_some_and(|failure| failure.contains("second native submit boundary"))
    );
    assert_eq!(trace.position_submit_attempts, 1);
    assert_eq!(trace.successful_position_submits.len(), 1);
    assert_eq!(evidence.native_order_count, 1);
    assert_eq!(trace.canonical_target_sets.len(), 1);
    assert_ne!(
        trace.batch_checkpoint_before, trace.failure_checkpoint_after,
        "the committed Host must not be rolled back after the first native submit"
    );
    assert!(!trace.venue_atomicity_claimed);
    assert!(!trace.cold_restart_claimed);
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn later_frame_weight_uses_account_scoped_equity_including_unrealized_pnl() {
    let trace = run_multi_frame_equity_corpus().expect("multi-frame equity corpus");
    assert_eq!(trace.canonical_target_sets.len(), 2);
    assert_eq!(trace.equity_snapshots.len(), 2);
    assert_eq!(trace.equity_snapshots[0].equity, "999999.00 USD");
    assert_eq!(trace.equity_snapshots[0].derived_grid_targets, [5, 4]);
    assert_eq!(trace.equity_snapshots[1].current_grid_units, [5, 4]);
    assert_eq!(trace.equity_snapshots[1].equity, "1000005.00 USD");
    assert_eq!(trace.equity_snapshots[1].derived_grid_targets, [6, 5]);
    // Balance-only conversion is 5.999994 and truncates to five. The account-scoped
    // mark-to-market equity crosses the exact six-grid-unit boundary.
    assert_eq!(
        (999_999_i128 * 2_250_i128 * 100_i128) / (1_000_000_i128 * 18_750_i128 * 2_i128),
        5
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn member_fill_routing_rejects_cross_and_unknown_without_checkpoint_mutation() {
    let (plan, artifact, frame) = fixture().expect("target-set fixture");
    let mut host = ProgramHostV2::new(plan.clone(), artifact).unwrap();
    let start = lifecycle_event(
        &plan,
        1,
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Start,
        None,
    );
    host.apply_event(&start).unwrap();
    let prepared = host.prepare_backtest_universe_event(&frame).unwrap();
    let checkpoint = host.checkpoint().clone();
    assert_eq!(prepared.canonical_target_set().members.len(), 2);
    let capability = seal_reconciliation_capability_for_test(
        &prepared,
        AccountId::from("XNAS-001"),
        Money::from("1_000_000 USD"),
        instruments(),
        [Price::from("187.25"), Price::from("421.15")],
        [0, 0],
    )
    .unwrap();
    let prepared = prepared.reconcile_backtest_capability(capability).unwrap();
    let intents = [
        prepared
            .member_checkpoint(0)
            .unwrap()
            .1
            .pending_intent
            .unwrap(),
        prepared
            .member_checkpoint(1)
            .unwrap()
            .1
            .pending_intent
            .unwrap(),
    ];
    host.commit_prepared_backtest_target_set(prepared).unwrap();
    assert_ne!(host.checkpoint(), &checkpoint);

    let before_cross = host.checkpoint().clone();
    let cross = lifecycle_event(
        &plan,
        100,
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Fill,
        Some((
            intents[0],
            2,
            strategy_factory_program_sdk::lifecycle_v1::FillDispositionV1::PartiallyFilled,
        )),
    );
    assert!(
        host.apply_backtest_member_fill_event("MSFT.XNAS", &cross)
            .is_err()
    );
    assert_eq!(host.checkpoint(), &before_cross);
    assert!(
        host.apply_backtest_member_fill_event("UNKNOWN.XNAS", &cross)
            .is_err()
    );
    assert_eq!(host.checkpoint(), &before_cross);

    host.apply_backtest_member_fill_event("AAPL.XNAS", &cross)
        .unwrap();
    let canceled = lifecycle_event(
        &plan,
        101,
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Fill,
        Some((
            intents[0],
            2,
            strategy_factory_program_sdk::lifecycle_v1::FillDispositionV1::Canceled,
        )),
    );
    host.apply_backtest_member_fill_event("AAPL.XNAS", &canceled)
        .unwrap();
    let rejected = lifecycle_event(
        &plan,
        102,
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Fill,
        Some((
            intents[1],
            0,
            strategy_factory_program_sdk::lifecycle_v1::FillDispositionV1::Rejected,
        )),
    );
    host.apply_backtest_member_fill_event("MSFT.XNAS", &rejected)
        .unwrap();
    let checkpoints = host.member_checkpoints_for_backtest();
    assert_eq!(checkpoints[0].1.reconciled_position_units, 2);
    assert!(checkpoints[0].1.pending_intent.is_none());
    assert_eq!(checkpoints[1].1.reconciled_position_units, 0);
    assert!(checkpoints[1].1.pending_intent.is_none());
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn prepared_capability_and_commit_reject_equivalent_or_restored_host_instances() {
    let (plan, artifact, frame) = fixture().expect("target-set fixture");
    let mut first = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    let mut equivalent = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    let start = lifecycle_event(
        &plan,
        1,
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Start,
        None,
    );
    first.apply_event(&start).unwrap();
    equivalent.apply_event(&start).unwrap();
    assert_eq!(first.checkpoint(), equivalent.checkpoint());

    let capability_owner = first.prepare_backtest_universe_event(&frame).unwrap();
    let foreign_prepared = equivalent.prepare_backtest_universe_event(&frame).unwrap();
    let capability = reconciliation_capability(&capability_owner);
    let foreign_checkpoint = equivalent.checkpoint().clone();
    assert!(
        foreign_prepared
            .reconcile_backtest_capability(capability)
            .is_err()
    );
    assert_eq!(equivalent.checkpoint(), &foreign_checkpoint);

    let prepared = first.prepare_backtest_universe_event(&frame).unwrap();
    let capability = reconciliation_capability(&prepared);
    let prepared = prepared.reconcile_backtest_capability(capability).unwrap();
    assert!(
        equivalent
            .commit_prepared_backtest_target_set(prepared)
            .is_err()
    );
    assert_eq!(equivalent.checkpoint(), &foreign_checkpoint);

    let prepared = first.prepare_backtest_universe_event(&frame).unwrap();
    let capability = reconciliation_capability(&prepared);
    let prepared = prepared.reconcile_backtest_capability(capability).unwrap();
    let mut restored = ProgramHostV2::restore(plan, artifact, first.checkpoint()).unwrap();
    assert!(
        restored
            .commit_prepared_backtest_target_set(prepared)
            .is_err()
    );
    assert_eq!(restored.checkpoint(), first.checkpoint());
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn every_invalid_batch_fact_prevents_both_submits_and_preserves_the_host_checkpoint() {
    for case in [
        InvalidBatchCase::Equity,
        InvalidBatchCase::Currency,
        InvalidBatchCase::Price,
        InvalidBatchCase::Multiplier,
        InvalidBatchCase::Grid,
        InvalidBatchCase::SecondOrder,
    ] {
        let trace = run_invalid_batch(case)
            .unwrap_or_else(|e| panic!("{case:?} invalid-batch corpus setup failed: {e:#}"));
        assert!(
            trace.callback_failure.is_some(),
            "{case:?} did not fault the batch"
        );
        assert_eq!(trace.position_submit_attempts, 0, "{case:?}");
        assert!(trace.native_order_observations.is_empty(), "{case:?}");
        assert!(trace.canonical_target_sets.is_empty(), "{case:?}");
        assert_eq!(
            trace.batch_checkpoint_before, trace.failure_checkpoint_after,
            "{case:?} changed the real Host checkpoint"
        );
    }
}

fn run_corpus(restore: bool) -> anyhow::Result<RunEvidence> {
    run_corpus_with_fault(restore, false)
}

fn run_corpus_with_fault(restore: bool, second_submit_fault: bool) -> anyhow::Result<RunEvidence> {
    let instruments = instruments();
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) = fixture()?;
    let admitted = admit_market_data_universe_program_event_v2(&plan, &frame)?;
    let time = admitted.envelope().order_key.logical_time_ns;
    let bars = [
        Bar::new(
            bar_types[0],
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from("100"),
            time.into(),
            time.into(),
        ),
        Bar::new(
            bar_types[1],
            Price::from("419.81"),
            Price::from("425.00"),
            Price::from("418.00"),
            Price::from("421.15"),
            Quantity::from("100.0"),
            time.into(),
            time.into(),
        ),
    ];
    let mut data = Vec::new();

    for (ordinal, (instrument, bar)) in instruments.iter().zip(bars).enumerate() {
        let instrument_id = instrument.id();
        data.push(Data::Delta(OrderBookDelta::clear(
            instrument_id,
            ordinal as u64 * 100 + 1,
            time.into(),
            time.into(),
        )));
        data.push(book_level(
            instrument,
            OrderSide::Buy,
            bar.close.as_f64() - 0.01,
            "100",
            ordinal as u64 * 100 + 2,
            time,
        ));
        data.push(book_level(
            instrument,
            OrderSide::Sell,
            bar.close.as_f64(),
            if ordinal == 0 { "2" } else { "0.5" },
            ordinal as u64 * 100 + 3,
            time,
        ));
        data.push(Data::Bar(bar));
    }
    data.extend([
        book_level(
            &instruments[0],
            OrderSide::Sell,
            187.25,
            "3",
            1_001,
            time + 1,
        ),
        book_level(
            &instruments[1],
            OrderSide::Sell,
            421.15,
            "1.5",
            1_002,
            time + 2,
        ),
    ]);
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let restored = Rc::new(Cell::new(false));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-B3-001"),
        plan,
        artifact,
        instrument_ids,
        bar_types,
        [frame],
        restore,
        Rc::clone(&restored),
        Rc::clone(&trace),
    )?;

    if second_submit_fault {
        strategy.fail_before_second_submit_for_test();
    }
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("XNAS"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L2_MBP)
            .starting_balances(vec![Money::from("1_000_000 USD")])
            .bar_execution(false)
            .liquidity_consumption(true)
            .use_random_ids(false)
            .build()?,
    )?;

    for instrument in &instruments {
        engine.add_instrument(instrument)?;
    }
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, Some("target-set-backtest-b3".to_owned()), false)?;
    let trace = trace.borrow().clone();

    if !second_submit_fault {
        anyhow::ensure!(
            trace.callback_failure.is_none(),
            "target-set callback failed: {:?}",
            trace.callback_failure
        );
    }
    let result = engine.get_canonical_result()?.to_bytes()?;
    let cache = engine.kernel().cache();
    let cache = cache.borrow();
    let native_order_count = cache.orders(None, None, None, None, None).len();
    let positions = cache
        .positions(None, None, None, None, None)
        .iter()
        .map(|position| {
            (
                position.instrument_id.to_string(),
                position.quantity.to_string(),
            )
        })
        .collect::<Vec<_>>();
    let corpus = serde_json::to_vec(&Corpus {
        trace: &trace,
        result,
        positions,
    })?;
    Ok(RunEvidence {
        corpus,
        trace,
        restored: restored.get(),
        native_order_count,
    })
}

fn run_invalid_batch(case: InvalidBatchCase) -> anyhow::Result<TargetSetBacktestTraceV2> {
    let mut instruments = instruments();

    match case {
        InvalidBatchCase::Equity | InvalidBatchCase::SecondOrder => {}
        InvalidBatchCase::Currency => {
            crypto_perpetual_mut(&mut instruments[1]).quote_currency = Currency::EUR();
        }
        InvalidBatchCase::Price => {
            crypto_perpetual_mut(&mut instruments[0]).price_increment = Price::from("0.03");
        }
        InvalidBatchCase::Multiplier => {
            crypto_perpetual_mut(&mut instruments[0]).multiplier = Quantity::from("0");
        }
        InvalidBatchCase::Grid => {
            crypto_perpetual_mut(&mut instruments[1]).size_increment = Quantity::from("0.0");
        }
    }

    if matches!(case, InvalidBatchCase::SecondOrder) {
        crypto_perpetual_mut(&mut instruments[1]).min_quantity = Some(Quantity::from("3.0"));
    }
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) = fixture()?;
    let admitted = admit_market_data_universe_program_event_v2(&plan, &frame)?;
    let time = admitted.envelope().order_key.logical_time_ns;
    let data = vec![
        Data::Bar(Bar::new(
            bar_types[0],
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from("100"),
            time.into(),
            time.into(),
        )),
        Data::Bar(Bar::new(
            bar_types[1],
            Price::from("419.81"),
            Price::from("425.00"),
            Price::from("418.00"),
            Price::from("421.15"),
            Quantity::from("100.0"),
            time.into(),
            time.into(),
        )),
    ];
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-B3-INVALID-001"),
        plan,
        artifact,
        instrument_ids,
        bar_types,
        [frame],
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
    )?;
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    let starting_balances = if matches!(case, InvalidBatchCase::Equity) {
        vec![Money::from("1_000_000 EUR"), Money::from("0 USD")]
    } else {
        vec![Money::from("1_000_000 USD")]
    };
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("XNAS"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L1_MBP)
            .starting_balances(starting_balances)
            .bar_execution(false)
            .use_random_ids(false)
            .build()?,
    )?;

    for instrument in &instruments {
        engine.add_instrument(instrument)?;
    }
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(
        None,
        None,
        Some(format!("target-set-backtest-b3-invalid-{case:?}")),
        false,
    )?;
    let evidence = trace.borrow().clone();
    Ok(evidence)
}

fn run_multi_frame_equity_corpus() -> anyhow::Result<TargetSetBacktestTraceV2> {
    let instruments = instruments();
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) =
        fixture_with_target_sets(target_set(), Some(second_target_set()))?;
    let admitted = admit_market_data_universe_program_event_v2(&plan, &frame)?;
    let first_time = admitted.envelope().order_key.logical_time_ns;
    let second_time = first_time + 100;
    let successor = issue_backtest_universe_successor_for_test(
        &plan,
        &frame,
        second_time,
        [[18_725, 18_750], [42_115, 42_150]],
    )?;
    let first_bars = [
        Bar::new(
            bar_types[0],
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from("100"),
            first_time.into(),
            first_time.into(),
        ),
        Bar::new(
            bar_types[1],
            Price::from("419.81"),
            Price::from("425.00"),
            Price::from("418.00"),
            Price::from("421.15"),
            Quantity::from("100.0"),
            first_time.into(),
            first_time.into(),
        ),
    ];
    let second_bars = [
        Bar::new(
            bar_types[0],
            Price::from("187.25"),
            Price::from("188.00"),
            Price::from("187.00"),
            Price::from("187.50"),
            Quantity::from("100"),
            second_time.into(),
            second_time.into(),
        ),
        Bar::new(
            bar_types[1],
            Price::from("421.15"),
            Price::from("422.00"),
            Price::from("421.00"),
            Price::from("421.50"),
            Quantity::from("100.0"),
            second_time.into(),
            second_time.into(),
        ),
    ];
    let mut data = Vec::new();
    for (ordinal, (instrument, bar)) in instruments.iter().zip(first_bars).enumerate() {
        data.push(Data::Delta(OrderBookDelta::clear(
            instrument.id(),
            ordinal as u64 * 100 + 1,
            first_time.into(),
            first_time.into(),
        )));
        data.push(book_level(
            instrument,
            OrderSide::Sell,
            bar.close.as_f64(),
            if ordinal == 0 { "5" } else { "2.0" },
            ordinal as u64 * 100 + 2,
            first_time,
        ));
        data.push(Data::Bar(bar));
    }
    data.extend([
        book_level(
            &instruments[0],
            OrderSide::Sell,
            187.50,
            "1",
            1_001,
            second_time,
        ),
        book_level(
            &instruments[1],
            OrderSide::Sell,
            421.50,
            "0.5",
            1_002,
            second_time,
        ),
        Data::Bar(second_bars[0]),
        Data::Bar(second_bars[1]),
    ]);
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-B3-EQUITY-001"),
        plan,
        artifact,
        instrument_ids,
        bar_types,
        [frame],
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
    )?;
    strategy.add_admitted_frame_for_test(successor)?;
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("XNAS"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L2_MBP)
            .starting_balances(vec![Money::from("999_999 USD")])
            .bar_execution(false)
            .liquidity_consumption(true)
            .use_random_ids(false)
            .build()?,
    )?;

    for instrument in &instruments {
        engine.add_instrument(instrument)?;
    }
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(
        None,
        None,
        Some("target-set-backtest-b3-equity".to_owned()),
        false,
    )?;
    let evidence = trace.borrow().clone();
    anyhow::ensure!(
        evidence.callback_failure.is_none(),
        "multi-frame equity callback failed: {:?}",
        evidence.callback_failure
    );
    Ok(evidence)
}

fn instruments() -> [InstrumentAny; 2] {
    [
        InstrumentAny::CryptoPerpetual(CryptoPerpetual::new(
            InstrumentId::from("AAPL.XNAS"),
            Symbol::from("AAPL"),
            Currency::BTC(),
            Currency::USD(),
            Currency::USD(),
            false,
            2,
            0,
            Price::from("0.01"),
            Quantity::from("1"),
            Some(Quantity::from("2")),
            None,
            Some(Quantity::from("100")),
            Some(Quantity::from("1")),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0.into(),
            0.into(),
        )),
        InstrumentAny::CryptoPerpetual(CryptoPerpetual::new(
            InstrumentId::from("MSFT.XNAS"),
            Symbol::from("MSFT"),
            Currency::ETH(),
            Currency::USD(),
            Currency::USD(),
            false,
            2,
            1,
            Price::from("0.01"),
            Quantity::from("0.5"),
            Some(Quantity::from("5")),
            None,
            Some(Quantity::from("100.0")),
            Some(Quantity::from("0.5")),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0.into(),
            0.into(),
        )),
    ]
}

fn crypto_perpetual_mut(instrument: &mut InstrumentAny) -> &mut CryptoPerpetual {
    let InstrumentAny::CryptoPerpetual(instrument) = instrument else {
        unreachable!("target-set fixture instrument kind changed")
    };
    instrument
}

fn reconciliation_capability(
    prepared: &super::program_host_v2::PreparedBacktestTargetSetV2,
) -> super::program_host_backtest_target_set_v2::BacktestReconciliationCapabilityV2 {
    seal_reconciliation_capability_for_test(
        prepared,
        AccountId::from("XNAS-001"),
        Money::from("1_000_000 USD"),
        instruments(),
        [Price::from("187.25"), Price::from("421.15")],
        [0, 0],
    )
    .unwrap()
}

fn fixture() -> anyhow::Result<(
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
)> {
    fixture_with_target_sets(target_set(), None)
}

fn fixture_with_target_sets(
    first_target_set: InstrumentTargetSetV2,
    second_target_set: Option<InstrumentTargetSetV2>,
) -> anyhow::Result<(
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
)> {
    let authority = issue_strategy_input_universe_frame()?;
    let frame = authority.frame().clone();
    let candidate = universe_design();
    let manifest = &candidate.plugins[0];
    let first_body = output_frame(manifest, first_target_set)?.encode(manifest)?[96..].to_vec();
    let wasm = if let Some(second_target_set) = second_target_set {
        let second_body =
            output_frame(manifest, second_target_set)?.encode(manifest)?[96..].to_vec();
        plugin_module_two_outputs(manifest, &first_body, &second_body)
    } else {
        plugin_module(manifest, &first_body)
    };
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )?;
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
    let StrategyCompilationV2::Compiled(plan) =
        compile_strategy_design_v2_for_universe(candidate, &authority, &[receipt])
    else {
        anyhow::bail!("target-set fixture did not compile")
    };
    let artifact = StrategyArtifactV2::issue(&plan, vec![build])
        .map_err(|error: StrategyArtifactV2Error| anyhow::anyhow!(error))?;
    Ok((*plan, artifact, frame))
}

fn target_set() -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        1,
        [
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"AAPL.XNAS").unwrap(),
                position: PositionIntentV1::Enter,
                target: TargetProposalV1::WeightMicros(1_875),
                reconciliation_target_units: None,
                protection: ProtectionProposalV1::Replace(ProtectionStateV1 {
                    stop_loss_ticks: Some(18_000),
                    take_profit_ticks: None,
                    trailing_distance_ticks: None,
                    trailing_stop_ticks: None,
                }),
            },
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"MSFT.XNAS").unwrap(),
                position: PositionIntentV1::Enter,
                target: TargetProposalV1::Position(4),
                reconciliation_target_units: Some(4),
                protection: ProtectionProposalV1::Replace(ProtectionStateV1 {
                    stop_loss_ticks: Some(40_000),
                    take_profit_ticks: None,
                    trailing_distance_ticks: None,
                    trailing_stop_ticks: None,
                }),
            },
        ],
    )
    .unwrap()
}

fn second_target_set() -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        2,
        [
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"AAPL.XNAS").unwrap(),
                position: PositionIntentV1::Add,
                target: TargetProposalV1::WeightMicros(2_250),
                reconciliation_target_units: None,
                protection: ProtectionProposalV1::Keep,
            },
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"MSFT.XNAS").unwrap(),
                position: PositionIntentV1::Add,
                target: TargetProposalV1::Position(5),
                reconciliation_target_units: Some(5),
                protection: ProtectionProposalV1::Keep,
            },
        ],
    )
    .unwrap()
}

fn output_frame(
    manifest: &PluginManifestV2,
    target_set: InstrumentTargetSetV2,
) -> anyhow::Result<PluginFrameV2> {
    let values = manifest
        .output_ports
        .iter()
        .map(|port| -> anyhow::Result<TypedValueV2> {
            Ok(match port.semantic_id.as_str() {
                "proposal.position-intent.v1" => TypedValueV2::new(
                    ValueTypeV2::PositionIntentV1,
                    b"kernel.position.hold.v1".as_slice(),
                )?,
                "proposal.target-variant.v1" => TypedValueV2::new(
                    ValueTypeV2::TargetVariantV1,
                    b"kernel.target.keep.v1".as_slice(),
                )?,
                "proposal.target-position.v1"
                | "proposal.reconciliation-target.v1"
                | "proposal.stop-loss.v1"
                | "proposal.take-profit.v1"
                | "proposal.trailing-stop.v1" => TypedValueV2::i64(0),
                "proposal.target-weight.v1" => TypedValueV2::i32(0),
                "proposal.rebalance-sequence.v1" | "proposal.trailing-distance.v1" => {
                    TypedValueV2::u64(0)
                }
                "proposal.protection-variant.v1" => TypedValueV2::new(
                    ValueTypeV2::ProtectionVariantV1,
                    b"kernel.protection.keep.v1".as_slice(),
                )?,
                "proposal.member-target-set.v2" => TypedValueV2::new(
                    ValueTypeV2::Bytes,
                    target_set
                        .encode()
                        .map_err(|e| anyhow::anyhow!("target-set encode failed: {e:?}"))?,
                )?,
                value => anyhow::bail!("unexpected output port {value}"),
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(PluginFrameV2 {
        kind: PluginFrameKindV2::Output,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, [1].as_slice())?,
    })
}

fn plugin_module(manifest: &PluginManifestV2, body: &[u8]) -> Vec<u8> {
    let input_capacity = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, 1, 16]);
    let mut exports = vec![6];
    export(&mut exports, "memory", 2, 0);

    for (name, index) in [
        ("strategy_factory_plugin_input_ptr_v2", 0),
        ("strategy_factory_plugin_input_capacity_v2", 1),
        ("strategy_factory_plugin_output_ptr_v2", 2),
        ("strategy_factory_plugin_output_capacity_v2", 3),
        ("strategy_factory_plugin_invoke_v2", 4),
    ] {
        export(&mut exports, name, 0, index);
    }
    section(&mut wasm, 7, &exports);
    let mut code = vec![5];
    for value in [1024, input_capacity as i32, 8192, output_capacity as i32] {
        function_body(&mut code, &i32_const(value));
    }
    let mut invoke = Vec::new();
    for offset in (0..96).step_by(8) {
        invoke.extend(i32_const(8192));
        invoke.extend(i32_const(1024));
        invoke.extend([0x29, 3]);
        u32_leb(&mut invoke, offset);
        invoke.extend([0x37, 3]);
        u32_leb(&mut invoke, offset);
    }
    store_i32(&mut invoke, 8192, i32::from_le_bytes(*b"SFPO"), 0);
    store_i32_16(
        &mut invoke,
        8192,
        (manifest.output_ports.len() + 1) as i32,
        88,
    );
    store_i32(&mut invoke, 8192, body.len() as i32, 92);
    invoke.extend(i32_const((96 + body.len()) as i32));
    function_body(&mut code, &invoke);
    section(&mut wasm, 10, &code);
    let mut data = vec![1, 0];
    data.extend(i32_const(8192 + 96));
    data.push(0x0b);
    u32_leb(&mut data, body.len() as u32);
    data.extend(body);
    section(&mut wasm, 11, &data);
    wasm
}

fn plugin_module_two_outputs(
    manifest: &PluginManifestV2,
    first_body: &[u8],
    second_body: &[u8],
) -> Vec<u8> {
    assert_eq!(first_body.len(), second_body.len());
    let input_capacity = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, 1, 16]);
    let mut exports = vec![6];
    export(&mut exports, "memory", 2, 0);

    for (name, index) in [
        ("strategy_factory_plugin_input_ptr_v2", 0),
        ("strategy_factory_plugin_input_capacity_v2", 1),
        ("strategy_factory_plugin_output_ptr_v2", 2),
        ("strategy_factory_plugin_output_capacity_v2", 3),
        ("strategy_factory_plugin_invoke_v2", 4),
    ] {
        export(&mut exports, name, 0, index);
    }
    section(&mut wasm, 7, &exports);
    let mut code = vec![5];
    for value in [1024, input_capacity as i32, 8192, output_capacity as i32] {
        function_body(&mut code, &i32_const(value));
    }
    let mut invoke = Vec::new();
    for offset in (0..96).step_by(8) {
        invoke.extend(i32_const(8192));
        invoke.extend(i32_const(1024));
        invoke.extend([0x29, 3]);
        u32_leb(&mut invoke, offset);
        invoke.extend([0x37, 3]);
        u32_leb(&mut invoke, offset);
    }
    store_i32(&mut invoke, 8192, i32::from_le_bytes(*b"SFPO"), 0);
    store_i32_16(
        &mut invoke,
        8192,
        (manifest.output_ports.len() + 1) as i32,
        88,
    );
    store_i32(&mut invoke, 8192, first_body.len() as i32, 92);
    invoke.extend(i32_const(
        (1024 + input_state_header_offset(manifest) + 4) as i32,
    ));
    invoke.extend([0x28, 2, 0]);
    invoke.extend([0x04, 0x40]);
    copy_static_bytes(&mut invoke, 8192 + 96, 32_768, second_body.len());
    invoke.push(0x05);
    copy_static_bytes(&mut invoke, 8192 + 96, 16_384, first_body.len());
    invoke.push(0x0b);
    invoke.extend(i32_const((96 + first_body.len()) as i32));
    function_body(&mut code, &invoke);
    section(&mut wasm, 10, &code);
    let mut data = vec![2, 0];
    data.extend(i32_const(16_384));
    data.push(0x0b);
    u32_leb(&mut data, first_body.len() as u32);
    data.extend(first_body);
    data.push(0);
    data.extend(i32_const(32_768));
    data.push(0x0b);
    u32_leb(&mut data, second_body.len() as u32);
    data.extend(second_body);
    section(&mut wasm, 11, &data);
    wasm
}

fn input_state_header_offset(manifest: &PluginManifestV2) -> usize {
    96 + manifest
        .input_ports
        .iter()
        .map(|port| {
            8 + match port.value_type {
                ValueTypeV2::I32 => 4,
                ValueTypeV2::I64 | ValueTypeV2::U64 => 8,
                ValueTypeV2::I128 | ValueTypeV2::StableIdentity16 => 16,
                ValueTypeV2::Digest32 => 32,
                value => panic!("unsupported test input type {value:?}"),
            }
        })
        .sum::<usize>()
}

fn copy_static_bytes(bytes: &mut Vec<u8>, destination: i32, source: i32, len: usize) {
    let aligned = len / 8 * 8;
    for offset in (0..aligned).step_by(8) {
        bytes.extend(i32_const(destination + offset as i32));
        bytes.extend(i32_const(source + offset as i32));
        bytes.extend([0x29, 3, 0]);
        bytes.extend([0x37, 3, 0]);
    }

    for offset in aligned..len {
        bytes.extend(i32_const(destination + offset as i32));
        bytes.extend(i32_const(source + offset as i32));
        bytes.extend([0x2d, 0, 0]);
        bytes.extend([0x3a, 0, 0]);
    }
}

fn book_level(
    instrument: &InstrumentAny,
    side: OrderSide,
    price: f64,
    quantity: &str,
    sequence: u64,
    time: u64,
) -> Data {
    Data::Delta(OrderBookDelta::new(
        instrument.id(),
        BookAction::Add,
        BookOrder::new(
            side,
            instrument.make_price(price),
            instrument.make_qty(quantity.parse::<f64>().expect("fixture quantity"), None),
            sequence,
        ),
        0,
        sequence,
        time.into(),
        time.into(),
    ))
}

fn lifecycle_event(
    plan: &StrategyPlanV2,
    sequence: u64,
    kind: strategy_factory_program_sdk::lifecycle_v1::LifecycleKind,
    fill: Option<(
        strategy_factory_program_sdk::lifecycle_v1::PendingIntentV1,
        u64,
        strategy_factory_program_sdk::lifecycle_v1::FillDispositionV1,
    )>,
) -> super::program_host_v2::AdmittedProgramEventV2 {
    use strategy_factory_program_sdk::lifecycle_v1::{
        EnvelopePayloadV1, EventOrderKeyV1, FillEventV1, LifecycleEnvelopeV1,
    };
    let payload = match kind {
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Start => {
            EnvelopePayloadV1::Start
        }
        strategy_factory_program_sdk::lifecycle_v1::LifecycleKind::Fill => {
            let (pending, cumulative, disposition) = fill.unwrap();
            EnvelopePayloadV1::Fill(FillEventV1 {
                intent_identity: pending.intent_identity,
                side: pending.side,
                disposition,
                cumulative_filled_units: cumulative,
            })
        }
        _ => unreachable!(),
    };
    let envelope = LifecycleEnvelopeV1::new_bound(
        EventOrderKeyV1::new(sequence, sequence, kind, sequence, [sequence as u8; 16]).unwrap(),
        payload,
    )
    .unwrap();
    super::program_host_v2::admit_backtest_lifecycle_event_v2(plan, envelope).unwrap()
}

fn frame_capacity(ports: &[PortContractV2], state: u32) -> usize {
    96 + (ports.len() + 1) * 8
        + state as usize
        + ports
            .iter()
            .map(|port| port.max_bytes as usize)
            .sum::<usize>()
}

fn store_i32(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.extend([0x36, 2]);
    u32_leb(bytes, offset);
}

fn store_i32_16(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.extend([0x3b, 1]);
    u32_leb(bytes, offset);
}

fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
    wasm.push(id);
    u32_leb(wasm, payload.len() as u32);
    wasm.extend(payload);
}

fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
    u32_leb(bytes, export_name.len() as u32);
    bytes.extend(export_name.as_bytes());
    bytes.push(kind);
    u32_leb(bytes, index);
}

fn function_body(code: &mut Vec<u8>, operators: &[u8]) {
    let mut bytes = vec![0];
    bytes.extend(operators);
    bytes.push(0x0b);
    u32_leb(code, bytes.len() as u32);
    code.extend(bytes);
}

fn i32_const(value: i32) -> Vec<u8> {
    let mut bytes = vec![0x41];
    let mut value = value;
    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        bytes.push(if done { byte } else { byte | 0x80 });
        if done {
            return bytes;
        }
    }
}

fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        bytes.push(if value == 0 { byte } else { byte | 0x80 });
        if value == 0 {
            return;
        }
    }
}
