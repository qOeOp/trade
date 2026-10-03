use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
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
    result::CanonicalBacktestResult,
};
#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_backtest_owner_contracts::ReplayWindowV2;
use vibe_data::owner::{
    sealed_acceptance::issue_strategy_input_universe_frame, source_binding::BindingDigest,
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
};
use vibe_model::{
    data::{Bar, BarSpecification, BarType, BookOrder, Data, OrderBookDelta, QuoteTick},
    enums::{
        AccountType, AggregationSource, BarAggregation, BookAction, BookType, OmsType, OrderSide,
        PriceType,
    },
    identifiers::{AccountId, InstrumentId, StrategyId, Symbol, Venue},
    instruments::{CryptoPerpetual, Instrument, InstrumentAny},
    types::{Currency, Money, Price, Quantity},
};
use vibe_risk::engine::config::RiskEngineConfig;

use super::{
    artifact_v2::{StrategyArtifactV2, StrategyArtifactV2Error},
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{
        PLUGIN_FRAME_ABI_V3, PluginFrameKindV2, PluginFrameV2, PluginOutputAvailabilityV3,
        TypedValueV2,
    },
    program_host_backtest_target_set_v2::{
        BacktestTargetSetProgramHostStrategyV2, TargetSetBacktestTraceV2,
        seal_reconciliation_capability_for_test,
    },
    program_host_v2::{
        OwnerUniverseFrameV1, ProgramHostV2, admit_owner_universe_program_event_v2,
        issue_backtest_universe_successor_for_test,
    },
    program_host_v2_tests::universe_design,
    strategy_design_v2::{PluginManifestV2, PortContractV2, ValueTypeV2},
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyPlanV2, TargetSetBarFieldV2,
        compile_strategy_design_v2_for_universe, issue_plugin_implementation_receipt_v2_for_test,
    },
};
#[cfg(feature = "sealed-strategy-input-acceptance")]
use super::{
    program_host_sim_event_consumer_v1::{
        ProgramHostSimEventRoundTripV1, program_host_sim_event_canonical_result_digest_for_test,
        program_host_sim_event_ordered_trace_census_for_test,
        program_host_sim_event_round_trip_for_test, run_program_host_sim_event_consumer_v1,
    },
    replay_execution_profile_binding_v1::{
        owner_replay_execution_profile_binding_fixture_v1,
        owner_replay_execution_profile_binding_with_record_fixture_v1,
    },
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
    target_set_members::BoundedMembers,
};

/// A production Replay request names its Universe Selection Record, not the strategy-input
/// selection its frames carry, and the two never share an identity. Market Data holds the Record
/// against each frame's verified batch when it issues the frames; the bundle takes such a request.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_bundle_takes_a_replay_that_names_its_universe_selection_record() {
    let mut instruments = instruments();
    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
        instrument.margin_init = rust_decimal::Decimal::new(1, 1);
        instrument.margin_maint = rust_decimal::Decimal::new(5, 2);
    }
    let (plan, artifact, frame) = fixture().unwrap();
    let record = [0xb8; 32];
    assert_ne!(&record, frame.selection().selection_identity().as_bytes());
    assert_ne!(&record, frame.selection().selection_digest().as_bytes());
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )
    .unwrap();
    let time = admitted.envelope().order_key.logical_time_ns;
    let authority = owner_replay_execution_profile_binding_with_record_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
        Some(record),
    );
    let (bar_types, data) = request_execution_schedule(&instruments, time);
    ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![OwnerUniverseFrameV1::uncoordinated(frame)],
        StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
        "target-set-profile-event".into(),
        instruments,
        bar_types,
        data,
        &[time],
    )
    .expect("a request naming its Universe Selection Record forms its execution bundle");
}

/// Market Data issues values at their canonical scale, so on a 0.001 tick a close of 187.250
/// arrives as 187.25. The bundle re-expresses every BAR and Quote at its instrument's precision
/// without changing a value; the engine would otherwise drop the data and reject an order priced
/// from it.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_bundle_expresses_canonical_scale_data_at_its_instruments_precision() {
    let mut instruments = instruments();
    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
        instrument.margin_init = rust_decimal::Decimal::new(1, 1);
        instrument.margin_maint = rust_decimal::Decimal::new(5, 2);
        instrument.price_precision = 3;
        instrument.price_increment = Price::from("0.001");
    }
    let (plan, artifact, frame) = fixture().unwrap();
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )
    .unwrap();
    let time = admitted.envelope().order_key.logical_time_ns;
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );
    let (bar_types, data) = request_execution_schedule(&instruments, time);
    assert!(data.iter().all(|datum| match datum {
        Data::Bar(bar) => bar.close.precision == 2,
        Data::Quote(quote) => quote.ask_price.precision == 2,
        _ => false,
    }));
    let capability = ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![OwnerUniverseFrameV1::uncoordinated(frame)],
        StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
        "target-set-profile-event".into(),
        instruments,
        bar_types,
        data.clone(),
        &[time],
    )
    .expect("canonical-scale data forms a bundle at its instruments' precision");
    let aligned = &capability.data;
    assert_eq!(aligned.len(), data.len());

    for (aligned, issued) in aligned.iter().zip(&data) {
        match (aligned, issued) {
            (Data::Bar(aligned), Data::Bar(issued)) => {
                assert_eq!(aligned.close.precision, 3);
                assert_eq!(aligned.close.as_decimal(), issued.close.as_decimal());
                assert_eq!(aligned.volume, issued.volume);
            }
            (Data::Quote(aligned), Data::Quote(issued)) => {
                assert_eq!(aligned.ask_price.precision, 3);
                assert_eq!(
                    aligned.ask_price.as_decimal(),
                    issued.ask_price.as_decimal()
                );
                assert_eq!(aligned.bid_size, issued.bid_size);
            }
            other => panic!("native data kind changed: {other:?}"),
        }
    }
}

/// A member whose window's data is finer than its tick runs end to end on the production consumer:
/// AAPL on a 0.1 tick, with two-place BARs and Quotes, as BTCUSDT's 2021 data is on today's 0.10
/// tick. The bundle widens AAPL's grid to its data, the census says so, and AAPL fills at its
/// fill quote's 187.25, a price its tick alone could not hold.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_member_whose_data_is_finer_than_its_tick_runs_on_the_datas_grid() {
    let mut instruments = instruments();
    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
        instrument.margin_init = rust_decimal::Decimal::new(1, 1);
        instrument.margin_maint = rust_decimal::Decimal::new(5, 2);
    }
    let aapl = crypto_perpetual_mut(&mut instruments[0]);
    aapl.price_precision = 1;
    aapl.price_increment = Price::from("0.1");
    let (plan, artifact, frame) = fixture().unwrap();
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )
    .unwrap();
    let time = admitted.envelope().order_key.logical_time_ns;
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );
    let (bar_types, data) = request_execution_schedule(&instruments, time);
    let capability = ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![OwnerUniverseFrameV1::uncoordinated(frame)],
        StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
        "target-set-profile-event".into(),
        instruments,
        bar_types,
        data,
        &[time],
    )
    .expect("a window finer than its tick forms a bundle on the data's grid");
    let grids = capability.census.price_grids().to_vec();
    assert_eq!(
        grids
            .iter()
            .map(|grid| (
                grid.instrument_price_precision(),
                grid.data_price_precision(),
                grid.replay_price_precision(),
                grid.widened_from_data()
            ))
            .collect::<Vec<_>>(),
        [(1, 2, 2, true), (2, 2, 2, false)]
    );
    let readback = run_program_host_sim_event_consumer_v1(capability).unwrap();
    let result: serde_json::Value = serde_json::from_slice(readback.canonical_result()).unwrap();
    assert_eq!(
        fill_rows(&result)
            .iter()
            .map(|row| (row[0].as_str(), row[2].as_str()))
            .collect::<Vec<_>>(),
        [("AAPL.XNAS", "187.25"), ("MSFT.XNAS", "421.15")]
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn owner_bound_profile_drives_bar_signal_then_real_event_fills() {
    let mut instruments = instruments();
    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
        instrument.margin_init = rust_decimal::Decimal::new(1, 1);
        instrument.margin_maint = rust_decimal::Decimal::new(5, 2);
    }
    let (plan, artifact, frame) = fixture().unwrap();
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )
    .unwrap();
    let time = admitted.envelope().order_key.logical_time_ns;
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );
    let (bar_types, data) = request_execution_schedule(&instruments, time);
    let capability = ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![OwnerUniverseFrameV1::uncoordinated(frame)],
        StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
        "target-set-profile-event".into(),
        instruments.clone(),
        bar_types,
        data,
        &[time],
    )
    .unwrap();
    let readback = run_program_host_sim_event_consumer_v1(capability).unwrap();
    assert_eq!(readback.execution_route(), "EVENT");
    CanonicalBacktestResult::from_slice(readback.canonical_result())
        .expect("EVENT readback must retain the exact canonical Backtest result");
    assert!(readback.canonical_result_is_exact());

    // Deterministic replay: the exact bytes the Backtest Owner seals as the semantic trace are
    // byte-identical across repeated runs of the same admitted execution bundle.
    let (repeat_plan, repeat_artifact, repeat_frame) = fixture().unwrap();
    let repeat_authority = owner_replay_execution_profile_binding_fixture_v1(
        &repeat_plan,
        &repeat_artifact,
        &repeat_frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );
    let (repeat_bar_types, repeat_data) = request_execution_schedule(&instruments, time);
    let repeated = run_program_host_sim_event_consumer_v1(
        ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
            repeat_authority,
            repeat_plan,
            repeat_artifact,
            vec![OwnerUniverseFrameV1::uncoordinated(repeat_frame)],
            StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
            "target-set-profile-event".into(),
            instruments,
            repeat_bar_types,
            repeat_data,
            &[time],
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_vec(&readback).unwrap(),
        serde_json::to_vec(&repeated).unwrap(),
        "repeated Sim EVENT runs must seal byte-identical semantic trace bytes"
    );
    assert_eq!(readback.canonical_result(), repeated.canonical_result());

    // The ordered trace binds the complete lifecycle, every committed target set, the kernel
    // primitives, and every native fill, and the census the Owner applies admits it.
    let census = readback.ordered_trace_census().unwrap();
    assert_eq!(
        census.target_set_count,
        readback.canonical_target_sets().len()
    );
    assert_eq!(census.reconciled_fill_count, readback.actual_fills().len());
    assert_eq!(census.fill_transition_count, readback.actual_fills().len());
    let transitions = readback.host_transitions();
    assert_eq!(transitions.first().map(|t| t.lifecycle()), Some("START"));
    assert_eq!(transitions.last().map(|t| t.lifecycle()), Some("STOP"));
    assert!(
        transitions
            .iter()
            .filter(|t| t.lifecycle() == "BAR")
            .all(
                |t| t.position_intent_semantic_id() == "kernel.position.enter.v1"
                    && t.target_semantic_id().is_some()
            ),
        "every BAR transition applied a versioned kernel primitive and target"
    );
    assert!(
        transitions
            .iter()
            .filter(|t| t.lifecycle() == "FILL")
            .all(|t| t.instrument().is_some() && t.residual_grid_units().is_some())
    );
    assert_eq!(
        readback.canonical_target_sets().len(),
        1,
        "one admitted frame commits exactly one canonical target set"
    );
    assert!(
        serde_json::to_value(&readback)
            .unwrap()
            .get("host_transitions")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|value| value.len() == transitions.len()),
        "the ordered trace is part of the sealed semantic trace bytes"
    );
    assert!(
        serde_json::to_value(&readback)
            .expect("EVENT readback must serialize")
            .get("canonical_result")
            .is_none(),
        "canonical result belongs to separate Backtest outcome evidence"
    );
    assert!(readback.protective_fills().is_empty());
    assert!(
        serde_json::to_value(&readback)
            .unwrap()
            .get("protective_fills")
            .is_none(),
        "a run no protective order filled keeps the semantic trace bytes it had before D1"
    );
    assert_eq!(readback.target_set_count(), 1);
    assert!(readback.position_submit_count() >= 2);
    assert!(
        readback
            .actual_fills()
            .iter()
            .any(|fill| fill.instrument() == "AAPL.XNAS")
    );
    assert!(
        readback
            .actual_fills()
            .iter()
            .any(|fill| fill.instrument() == "MSFT.XNAS")
    );
    assert_eq!(readback.instrument_fact_digests(), [[1; 32], [21; 32]]);
    assert_eq!(readback.instrument_receipt_digests(), [[2; 32], [22; 32]]);
    assert_eq!(
        readback
            .consumption_census()
            .request_locator()
            .request_identity,
        "rd-replay-request-aapl-msft-v2"
    );
}

/// The Host reads its member roles and its pricing role from the compiled Plan: they are the
/// Design's roles, each with the BAR field it is checked against, and the one role reading the
/// close. Nothing in the Host names a role.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn the_host_reads_its_roles_and_pricing_role_from_the_plan() {
    let (plan, _, _) = fixture().unwrap();

    assert_eq!(
        plan.target_set_member_roles_v2(),
        vec![
            ("research.input.close.v1", TargetSetBarFieldV2::Close),
            ("research.input.open.v1", TargetSetBarFieldV2::Open),
        ]
    );
    assert_eq!(
        plan.execution_role_v2(),
        Some(("research.input.close.v1", TargetSetBarFieldV2::Close))
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn self_consistent_plan_artifact_splice_fails_before_execution() {
    let (request_plan, request_artifact, request_frame) = fixture().unwrap();
    let request_time = admit_owner_universe_program_event_v2(
        &request_plan,
        &OwnerUniverseFrameV1::uncoordinated(request_frame.clone()),
    )
    .unwrap()
    .envelope()
    .order_key
    .logical_time_ns;
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &request_plan,
        &request_artifact,
        &request_frame,
        ReplayWindowV2 {
            start_event_ns: request_time,
            end_event_ns_exclusive: request_time + 3,
        },
    );
    let (foreign_plan, foreign_artifact, foreign_frame) =
        fixture_with_target_sets(target_set(), Some(second_target_set())).unwrap();
    let foreign_time = admit_owner_universe_program_event_v2(
        &foreign_plan,
        &OwnerUniverseFrameV1::uncoordinated(foreign_frame.clone()),
    )
    .unwrap()
    .envelope()
    .order_key
    .logical_time_ns;
    let instruments = instruments();
    let (bar_types, data) = request_execution_schedule(&instruments, foreign_time);

    assert!(
        ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
            authority,
            foreign_plan,
            foreign_artifact,
            vec![OwnerUniverseFrameV1::uncoordinated(foreign_frame)],
            StrategyId::from("TARGET-SET-PROFILE-EVENT-SPLICE"),
            "target-set-profile-event-splice".into(),
            instruments,
            bar_types,
            data,
            &[foreign_time],
        )
        .is_err()
    );
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
fn request_execution_schedule(
    instruments: &[InstrumentAny; 2],
    time: u64,
) -> ([BarType; 2], Vec<Data>) {
    let bar_types = instruments.each_ref().map(|instrument| {
        BarType::new(
            instrument.id(),
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let mut data = vec![
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
    data.extend([
        Data::Quote(QuoteTick::new(
            instruments[0].id(),
            Price::from("187.24"),
            Price::from("187.25"),
            Quantity::from("100"),
            Quantity::from("100"),
            (time + 1).into(),
            (time + 1).into(),
        )),
        Data::Quote(QuoteTick::new(
            instruments[1].id(),
            Price::from("421.14"),
            Price::from("421.15"),
            Quantity::from("100.0"),
            Quantity::from("100.0"),
            (time + 2).into(),
            (time + 2).into(),
        )),
    ]);
    (bar_types, data)
}

#[derive(Serialize)]
struct Corpus<'a> {
    trace: &'a TargetSetBacktestTraceV2,
    result: Vec<u8>,
    positions: Vec<(String, String)>,
}

struct RunEvidence {
    corpus: Vec<u8>,
    trace: TargetSetBacktestTraceV2,
    canonical_result: Vec<u8>,
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
    assert_eq!(uninterrupted.trace.actual_fill_consumptions.len(), 4);
    assert!(
        uninterrupted
            .trace
            .actual_fill_consumptions
            .iter()
            .all(|fill| {
                matches!(fill.disposition.as_str(), "PARTIALLY_FILLED" | "FILLED")
                    && fill.cumulative_filled_grid_units > 0
                    && fill.checkpoint_before != fill.checkpoint_after
            })
    );
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
                transition.instrument.as_deref(),
                transition.position_after_grid_units,
                transition.residual_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        member_fills,
        [
            (Some("AAPL.XNAS"), 2, Some(3)),
            (Some("MSFT.XNAS"), 1, Some(3)),
            (Some("AAPL.XNAS"), 5, Some(0)),
            (Some("MSFT.XNAS"), 4, Some(0)),
        ]
    );
    let lifecycle = uninterrupted
        .trace
        .host_transitions
        .iter()
        .map(|transition| {
            (
                transition.lifecycle.as_str(),
                transition.instrument.as_deref(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        lifecycle,
        [
            ("START", None),
            ("BAR", Some("AAPL.XNAS")),
            ("BAR", Some("MSFT.XNAS")),
            ("FILL", Some("AAPL.XNAS")),
            ("FILL", Some("MSFT.XNAS")),
            ("FILL", Some("AAPL.XNAS")),
            ("FILL", Some("MSFT.XNAS")),
            ("STOP", None),
        ],
        "the ordered trace is one host-wide START..STOP lifecycle around member transitions"
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
    // Each member submits on its own fill quote, so the first member's order meets the book and
    // fills before the second member's quote reaches the faulting submit: the native orders are
    // that first order and the protective stop its fill places.
    assert_eq!(evidence.native_order_count, 2);
    assert_eq!(trace.canonical_target_sets.len(), 1);
    assert_eq!(
        trace
            .actual_fill_consumptions
            .iter()
            .map(|fill| fill.instrument.as_str())
            .collect::<Vec<_>>(),
        ["AAPL.XNAS"]
    );
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
    assert_eq!(prepared.canonical_target_set().member_count(), 2);
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
        assert!(trace.actual_fill_consumptions.is_empty(), "{case:?}");
        assert!(trace.canonical_target_sets.is_empty(), "{case:?}");
        assert_eq!(
            trace.batch_checkpoint_before, trace.failure_checkpoint_after,
            "{case:?} changed the real Host checkpoint"
        );
    }
}

struct RoundTripEvidence {
    trace: TargetSetBacktestTraceV2,
    canonical_result: Vec<u8>,
    closure: Option<ProgramHostSimEventRoundTripV1>,
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat() {
    let evidence = run_round_trip_corpus().expect("target-set round-trip corpus");
    let trace = &evidence.trace;
    assert!(trace.callback_failure.is_none());
    assert_eq!(trace.canonical_target_sets.len(), 2);
    assert_eq!(trace.equity_snapshots.len(), 2);
    assert_eq!(trace.equity_snapshots[1].current_grid_units, [5, 4]);
    assert_eq!(trace.equity_snapshots[1].derived_grid_targets, [0, 0]);

    let legs = trace
        .actual_fill_consumptions
        .iter()
        .map(|fill| {
            (
                fill.instrument.as_str(),
                fill.position_intent.as_str(),
                fill.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        legs,
        [
            ("AAPL.XNAS", "ENTER", 2),
            ("MSFT.XNAS", "ENTER", 1),
            ("AAPL.XNAS", "ENTER", 5),
            ("MSFT.XNAS", "ENTER", 4),
            ("AAPL.XNAS", "EXIT", 0),
            ("MSFT.XNAS", "EXIT", 0),
        ],
        "the run must enter, fill, exit, and fill again on the real Sim EVENT route"
    );
    assert_eq!(
        trace.final_member_grid_units.as_deref(),
        Some(&[0, 0][..]),
        "both members must hold no native position when the real run stops"
    );

    let closure = evidence
        .closure
        .as_ref()
        .expect("a complete Sim EVENT round trip");
    assert_eq!(closure.target_set_count(), 2);
    assert_eq!(closure.members()[0].instrument(), "AAPL.XNAS");
    assert_eq!(closure.members()[1].instrument(), "MSFT.XNAS");
    assert_eq!(closure.members()[0].peak_grid_units(), 5);
    assert_eq!(closure.members()[1].peak_grid_units(), 4);
    assert!(closure.members().iter().all(|member| {
        member.entry_fill_count() == 2
            && member.exit_fill_count() == 1
            && member.final_grid_units() == 0
            && member.closed_position_count() == 1
    }));
    assert!(
        closure.is_bound_to(program_host_sim_event_canonical_result_digest_for_test(
            &evidence.canonical_result
        )),
        "closure evidence must be sealed against this run's canonical Backtest result"
    );

    let result = CanonicalBacktestResult::from_slice(&evidence.canonical_result)
        .expect("the run must produce an exact canonical Backtest result");
    let positions = result.as_value()["positions"]
        .as_array()
        .expect("canonical position records");
    assert_eq!(positions.len(), 2);
    assert!(
        positions.iter().all(|position| {
            !position["ts_closed"].is_null() && !position["closing_order_id"].is_null()
        }),
        "the canonical Backtest result must report every member position closed"
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn real_sim_event_run_which_only_entered_claims_no_round_trip() {
    let evidence = run_corpus(false).expect("uninterrupted target-set Backtest corpus");
    assert_eq!(
        evidence.trace.final_member_grid_units.as_deref(),
        Some(&[5, 4][..])
    );
    assert!(
        evidence
            .trace
            .actual_fill_consumptions
            .iter()
            .all(|fill| fill.position_intent == "ENTER")
    );
    let closure = program_host_sim_event_round_trip_for_test(
        &evidence.trace,
        &["AAPL.XNAS".to_owned(), "MSFT.XNAS".to_owned()],
        &evidence.canonical_result,
    )
    .expect("an entry-only run is not a fault");
    assert!(
        closure.is_none(),
        "a run still holding both members must not claim a closure"
    );
}

/// A protective stop that fills between two frames is reconciled by `kernel.fill.reconcile.v1`
/// (D1), so the run continues and the exit frame sees the stopped-out member flat.
///
/// Before D1 the Host recorded the fill only as a native observation and never fed it to the
/// kernel, so at the next frame the kernel's checkpoint still held the entered position while the
/// venue held none, and the batch snapshot refused the run as a member reconciliation mismatch.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_triggered_stop_reconciles_the_member_flat_and_the_run_continues() {
    let aapl_stop_ticks = 18_600;
    let stopped = InstrumentTargetSetV2::new(
        1,
        &target_set()
            .members()
            .iter()
            .map(|member| {
                let mut member = *member;
                if member.instrument.as_bytes() == b"AAPL.XNAS" {
                    member.protection = ProtectionProposalV1::Replace(ProtectionStateV1 {
                        stop_loss_ticks: Some(aapl_stop_ticks),
                        take_profit_ticks: None,
                        trailing_distance_ticks: None,
                        trailing_stop_ticks: None,
                    });
                }
                member
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();

    // After both entry legs fill, AAPL's book falls through its 186.00 stop and a resting bid
    // takes the protective sell.
    let fall_through_the_stop = |instruments: &[InstrumentAny; 2], entry_time: u64| {
        vec![
            Data::Delta(OrderBookDelta::clear(
                instruments[0].id(),
                3_001,
                (entry_time + 50).into(),
                (entry_time + 50).into(),
            )),
            book_level(
                &instruments[0],
                OrderSide::Buy,
                185.50,
                "100",
                3_002,
                entry_time + 50,
            ),
            book_level(
                &instruments[0],
                OrderSide::Sell,
                185.60,
                "100",
                3_003,
                entry_time + 50,
            ),
        ]
    };

    // Both controls run clean and fill no protective order: the same close stop with no fall, and
    // the same fall under the fixture's far 180.00 stop, which it never reaches.
    let (unfallen, _) = run_two_frame_corpus(stopped, |_, _| Vec::new())
        .expect("the close stop without a fall runs");
    assert!(
        unfallen.callback_failure.is_none(),
        "{:?}",
        unfallen.callback_failure
    );
    assert!(unfallen.protective_fill_consumptions.is_empty());
    let (far_stop, _) = run_two_frame_corpus(target_set(), fall_through_the_stop)
        .expect("the fall above the far stop runs");
    assert!(
        far_stop.callback_failure.is_none(),
        "{:?}",
        far_stop.callback_failure
    );
    assert!(far_stop.protective_fill_consumptions.is_empty());

    // A program that reads its position holds the member the stop closed and exits the other.
    let (trace, canonical_result) = run_two_frame_corpus_with_exit(
        stopped,
        hold_aapl_exit_msft_target_set(),
        fall_through_the_stop,
    )
    .expect("the stopped-out run completes");
    assert!(
        trace.callback_failure.is_none(),
        "a filled protective stop must no longer abort the run: {:?}",
        trace.callback_failure
    );
    let stops = trace
        .protective_fill_consumptions
        .iter()
        .map(|fill| {
            (
                fill.instrument.as_str(),
                fill.leg,
                fill.disposition.as_str(),
                fill.position_before_grid_units,
                fill.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        stops,
        [("AAPL.XNAS", "STOP_LOSS", "FILLED", 5, 0)],
        "the kernel consumes the stop's fill and reconciles AAPL flat"
    );
    assert_eq!(trace.equity_snapshots.len(), 2);
    assert_eq!(
        trace.equity_snapshots[1].current_grid_units,
        [0, 4],
        "the exit frame sees the stopped-out member flat and the other still held"
    );
    assert_eq!(trace.final_member_grid_units.as_deref(), Some(&[0, 0][..]));
    assert!(
        trace
            .actual_fill_consumptions
            .iter()
            .all(|fill| fill.instrument != "AAPL.XNAS" || fill.position_intent == "ENTER"),
        "no submitted order closed AAPL: the stop did"
    );

    // The consumer's production census binds the stop's FILL transition to the reported
    // protective fill, so the Backtest Owner can seal this trace; and the round trip counts the
    // stop as AAPL's exit.
    let members = instruments().map(|instrument| instrument.id().to_string());
    let census = program_host_sim_event_ordered_trace_census_for_test(&trace, &members)
        .expect("the ordered trace reconciles every consuming FILL, the stop's included");
    assert_eq!(
        census.reconciled_fill_count,
        trace.actual_fill_consumptions.len() + 1
    );
    let closure = program_host_sim_event_round_trip_for_test(&trace, &members, &canonical_result)
        .expect("a stopped-out member closes its round trip")
        .expect("both members entered and ended flat");
    assert_eq!(closure.members()[0].instrument(), "AAPL.XNAS");
    assert_eq!(
        (
            closure.members()[0].entry_fill_count(),
            closure.members()[0].exit_fill_count()
        ),
        (2, 1),
        "AAPL's one exit is its stop"
    );
    assert_eq!(closure.members()[1].exit_fill_count(), 1);
    assert!(closure.closure_is_exact());

    // A program that exits AAPL anyway asks the kernel to close a position it no longer holds,
    // and the kernel refuses that by name rather than the venue/kernel mismatch D1 removed.
    let (blind, _) = run_two_frame_corpus(stopped, fall_through_the_stop)
        .expect("the run itself completes and reports its callback failure");
    let failure = blind
        .callback_failure
        .as_deref()
        .expect("exiting a member the stop already closed is refused");
    assert!(
        failure.contains("InvalidPositionTransition"),
        "the refusal must be the kernel's, on a flat member: {failure}"
    );
    assert_eq!(blind.protective_fill_consumptions.len(), 1);
}

fn hold_aapl_exit_msft_target_set() -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        2,
        &[
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"AAPL.XNAS").unwrap(),
                position: PositionIntentV1::Hold,
                target: TargetProposalV1::Keep,
                reconciliation_target_units: None,
                protection: ProtectionProposalV1::Keep,
            },
            exit_target_set().members()[1],
        ],
    )
    .unwrap()
}

fn run_round_trip_corpus() -> anyhow::Result<RoundTripEvidence> {
    let (trace, canonical_result) = run_two_frame_corpus(target_set(), |_, _| Vec::new())?;
    anyhow::ensure!(
        trace.callback_failure.is_none(),
        "round-trip callback failed: {:?}",
        trace.callback_failure
    );
    let closure = program_host_sim_event_round_trip_for_test(
        &trace,
        &instruments().map(|instrument| instrument.id().to_string()),
        &canonical_result,
    )?;
    Ok(RoundTripEvidence {
        trace,
        canonical_result,
        closure,
    })
}

/// Runs the entry frame and then the exit frame over the real Sim EVENT route.
///
/// `between_frames` adds market data after both entry legs have filled and before the exit frame's
/// bars, given the instruments and the entry time. The run's trace comes back even when a callback
/// failed, so a caller can state what today's run does rather than only that it succeeded.
fn run_two_frame_corpus(
    entry: InstrumentTargetSetV2,
    between_frames: impl FnOnce(&[InstrumentAny; 2], u64) -> Vec<Data>,
) -> anyhow::Result<(TargetSetBacktestTraceV2, Vec<u8>)> {
    run_two_frame_corpus_with_exit(entry, exit_target_set(), between_frames)
}

/// [`run_two_frame_corpus`] with the exit frame's target set named by the caller.
fn run_two_frame_corpus_with_exit(
    entry: InstrumentTargetSetV2,
    exit: InstrumentTargetSetV2,
    between_frames: impl FnOnce(&[InstrumentAny; 2], u64) -> Vec<Data>,
) -> anyhow::Result<(TargetSetBacktestTraceV2, Vec<u8>)> {
    let instruments = instruments();
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) = fixture_with_target_sets(entry, Some(exit))?;
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )?;
    let entry_time = admitted.envelope().order_key.logical_time_ns;
    let exit_time = entry_time + 100;
    let successor = issue_backtest_universe_successor_for_test(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
        exit_time,
        &[[18_725, 18_700], [42_115, 42_100]],
    )?;
    let entry_bars = [
        Bar::new(
            bar_types[0],
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from("100"),
            entry_time.into(),
            entry_time.into(),
        ),
        Bar::new(
            bar_types[1],
            Price::from("419.81"),
            Price::from("425.00"),
            Price::from("418.00"),
            Price::from("421.15"),
            Quantity::from("100.0"),
            entry_time.into(),
            entry_time.into(),
        ),
    ];
    let exit_bars = [
        Bar::new(
            bar_types[0],
            Price::from("187.25"),
            Price::from("188.00"),
            Price::from("186.00"),
            Price::from("187.00"),
            Quantity::from("100"),
            exit_time.into(),
            exit_time.into(),
        ),
        Bar::new(
            bar_types[1],
            Price::from("421.15"),
            Price::from("422.00"),
            Price::from("420.00"),
            Price::from("421.00"),
            Quantity::from("100.0"),
            exit_time.into(),
            exit_time.into(),
        ),
    ];
    let mut data = Vec::new();

    // Entry leg: each member's ask ladder fills the ENTER intent in two real native fills.
    for (ordinal, (instrument, bar)) in instruments.iter().zip(entry_bars).enumerate() {
        data.push(Data::Delta(OrderBookDelta::clear(
            instrument.id(),
            ordinal as u64 * 100 + 1,
            entry_time.into(),
            entry_time.into(),
        )));
        data.push(book_level(
            instrument,
            OrderSide::Buy,
            bar.close.as_f64() - 0.01,
            "100",
            ordinal as u64 * 100 + 2,
            entry_time,
        ));
        data.push(book_level(
            instrument,
            OrderSide::Sell,
            bar.close.as_f64(),
            if ordinal == 0 { "2" } else { "0.5" },
            ordinal as u64 * 100 + 3,
            entry_time,
        ));
        data.push(Data::Bar(bar));
    }
    data.extend(fill_quotes(&instruments, &entry_bars, entry_time + 1));
    data.extend([
        book_level(
            &instruments[0],
            OrderSide::Sell,
            187.25,
            "3",
            1_001,
            entry_time + 1,
        ),
        book_level(
            &instruments[1],
            OrderSide::Sell,
            421.15,
            "1.5",
            1_002,
            entry_time + 2,
        ),
    ]);
    data.extend(between_frames(&instruments, entry_time));

    // Exit leg: resting bids absorb the whole reduce-only EXIT order of each member.
    data.extend([
        book_level(
            &instruments[0],
            OrderSide::Buy,
            187.00,
            "100",
            2_001,
            exit_time,
        ),
        book_level(
            &instruments[1],
            OrderSide::Buy,
            421.00,
            "100.0",
            2_002,
            exit_time,
        ),
        Data::Bar(exit_bars[0]),
        Data::Bar(exit_bars[1]),
    ]);
    data.extend(fill_quotes(&instruments, &exit_bars, exit_time + 1));
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-B3-ROUND-TRIP-001"),
        plan,
        artifact,
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        BTreeMap::from([
            (entry_time, vec![entry_time + 1; 2]),
            (exit_time, vec![exit_time + 1; 2]),
        ]),
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
        // Every fixture price is on a two-place grid.
        BoundedMembers::try_from([2, 2])?,
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
    engine.run(
        None,
        None,
        Some("target-set-backtest-b3-round-trip".to_owned()),
        false,
    )?;
    let trace = trace.borrow().clone();
    let canonical_result = engine.get_canonical_result()?.to_bytes()?;
    Ok((trace, canonical_result))
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
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )?;
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
    data.extend(fill_quotes(&instruments, &bars, time + 1));
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
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        BTreeMap::from([(time, vec![time + 1; 2])]),
        None,
        restore,
        Rc::clone(&restored),
        Rc::clone(&trace),
        // Every fixture price is on a two-place grid.
        BoundedMembers::try_from([2, 2])?,
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
        result: result.clone(),
        positions,
    })?;
    Ok(RunEvidence {
        corpus,
        trace,
        canonical_result: result,
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
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )?;
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
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        BTreeMap::from([(time, vec![time + 1; 2])]),
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
        // Every fixture price is on a two-place grid.
        BoundedMembers::try_from([2, 2])?,
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

/// A Sim EVENT run of the two-member target set on an L1 book only Quotes build, as the production
/// venue's is, with maker and taker fees that differ. Nothing is on the book when the BARs decide,
/// so an order submitted at the BAR would rest as MAKER whatever the Quotes after it say.
///
/// `schedule` states, from the frame's instant, the Quotes after the BARs and the fill-quote
/// instant per member the bundle would state.
fn run_fill_quote_corpus(
    schedule: impl FnOnce(u64, &[InstrumentAny]) -> (Vec<Data>, Vec<u64>),
) -> anyhow::Result<(TargetSetBacktestTraceV2, serde_json::Value)> {
    run_fill_quote_corpus_with(FillQuoteCorpusConfig::default(), schedule)
}

/// What a [`run_fill_quote_corpus`] run may state beyond its schedule.
struct FillQuoteCorpusConfig {
    /// The run's pre-trade risk engine.
    risk_engine: Option<RiskEngineConfig>,
    /// AAPL's price precision, with a one-unit increment at it.
    aapl_price_precision: u8,
    /// Each member's data price grid, as the bundle states it.
    data_price_precisions: [u8; 2],
}

impl Default for FillQuoteCorpusConfig {
    fn default() -> Self {
        Self {
            risk_engine: None,
            aapl_price_precision: 2,
            // Every fixture price is on a two-place grid.
            data_price_precisions: [2, 2],
        }
    }
}

/// [`run_fill_quote_corpus`] with what `config` states.
fn run_fill_quote_corpus_with(
    config: FillQuoteCorpusConfig,
    schedule: impl FnOnce(u64, &[InstrumentAny]) -> (Vec<Data>, Vec<u64>),
) -> anyhow::Result<(TargetSetBacktestTraceV2, serde_json::Value)> {
    let FillQuoteCorpusConfig {
        risk_engine,
        aapl_price_precision,
        data_price_precisions,
    } = config;
    let mut instruments = instruments();

    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
    }
    let aapl = crypto_perpetual_mut(&mut instruments[0]);
    aapl.price_precision = aapl_price_precision;
    aapl.price_increment = Price::from_decimal_dp(
        rust_decimal::Decimal::new(1, u32::from(aapl_price_precision)),
        aapl_price_precision,
    )?;
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) = fixture()?;
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )?;
    let time = admitted.envelope().order_key.logical_time_ns;
    let mut data = vec![
        Data::Bar(Bar::new(
            bar_types[0],
            instruments[0].make_price(186.41),
            instruments[0].make_price(188.00),
            instruments[0].make_price(185.00),
            instruments[0].make_price(187.25),
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
    let (quotes, instants) = schedule(time, &instruments);
    data.extend(quotes);
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-FILL-QUOTE-001"),
        plan,
        artifact,
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        BTreeMap::from([(time, instants)]),
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
        BoundedMembers::try_from(data_price_precisions)?,
    )?;
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        risk_engine,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("XNAS"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![Money::from("1_000_000 USD")])
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
        Some("target-set-backtest-fill-quote".to_owned()),
        false,
    )?;
    let result = serde_json::from_slice(&engine.get_canonical_result()?.to_bytes()?)?;
    let trace = trace.borrow().clone();
    Ok((trace, result))
}

/// A two-sided Quote for `instrument` at `instant`.
fn touch(instrument: &InstrumentAny, bid: &str, ask: &str, instant: u64) -> Data {
    let price = |value: &str| {
        Price::from_decimal_dp(value.parse().unwrap(), instrument.price_precision()).unwrap()
    };
    Data::Quote(QuoteTick::new(
        instrument.id(),
        price(bid),
        price(ask),
        instrument.make_qty(100.0, None),
        instrument.make_qty(100.0, None),
        instant.into(),
        instant.into(),
    ))
}

/// Each fill as `(instrument, ts_event, last_px, liquidity_side, commission)`, in the canonical
/// result's order: by order, not by time.
fn fill_rows(result: &serde_json::Value) -> Vec<[String; 5]> {
    result["fills"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|fill| {
            let filled = &fill["event"]["Filled"];
            [
                "instrument_id",
                "ts_event",
                "last_px",
                "liquidity_side",
                "commission",
            ]
            .map(|field| filled[field].as_str().unwrap_or_default().to_owned())
        })
        .collect()
}

/// The frame decides limits at its closes, 187.25 and 421.15. Each member's fill quote already
/// offers below that, so each order fills on arrival as TAKER at the touch, not at its limit, and
/// pays the taker rate: 5 x 187.20 x multiplier 2 x 0.0004 = 0.7488 and 2.0 x 421.10 x
/// multiplier 5 x 0.0004 = 1.6844, where the maker rate would charge 0.37 and 0.84.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_limit_its_fill_quote_already_crosses_fills_as_taker_at_the_touch() {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.10", "187.20", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(trace.callback_failure, None);
    assert_eq!(
        fill_rows(&result),
        [
            ["AAPL.XNAS", "26", "187.20", "TAKER", "0.75 USD"],
            ["MSFT.XNAS", "26", "421.10", "TAKER", "1.68 USD"],
        ]
    );
}

/// A fill quote that does not reach the limit leaves the order resting, and the later Quote that
/// crosses it fills it as MAKER at its limit, at the maker rate: 5 x 187.25 x 2 x 0.0002 = 0.3745.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_limit_its_fill_quote_does_not_cross_rests_and_fills_later_as_maker_at_its_limit() {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.20", "187.30", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
                touch(&instruments[0], "187.10", "187.20", time + 2),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(trace.callback_failure, None);
    assert_eq!(
        fill_rows(&result),
        [
            ["AAPL.XNAS", "27", "187.25", "MAKER", "0.37 USD"],
            ["MSFT.XNAS", "26", "421.10", "TAKER", "1.68 USD"],
        ]
    );
}

/// Each member's order waits for that member's own fill quote: MSFT's Quote comes a nanosecond
/// after AAPL's, and its order meets it as TAKER there rather than resting from AAPL's instant.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn each_member_submits_on_its_own_fill_quote() {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.10", "187.20", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 2),
            ],
            vec![time + 1, time + 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(trace.callback_failure, None);
    assert_eq!(
        fill_rows(&result),
        [
            ["AAPL.XNAS", "26", "187.20", "TAKER", "0.75 USD"],
            ["MSFT.XNAS", "27", "421.10", "TAKER", "1.68 USD"],
        ]
    );
}

/// A position order priced finer than its member's data grid is refused by name before it reaches
/// the venue: AAPL's limit at its close, 187.25, is finer than a one-place data grid.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_position_order_off_its_data_grid_is_refused_by_name() {
    let config = FillQuoteCorpusConfig {
        data_price_precisions: [1, 2],
        ..FillQuoteCorpusConfig::default()
    };
    let (trace, result) = run_fill_quote_corpus_with(config, |time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.10", "187.20", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(
        trace.callback_failure.as_deref(),
        Some(
            "ORDER_PRICE_OFF_THE_DATA_GRID: 187.25 for AAPL.XNAS is finer than its data's 1-place grid"
        )
    );
    assert_eq!(trace.position_submit_attempts, 0);
    assert!(fill_rows(&result).is_empty());
}

/// A fill finer than its member's data grid is refused by name: AAPL runs on a three-place tick,
/// its limit at the close (187.25) is on its two-place data grid, but a Quote at 187.245 fills it
/// at a price the data grid cannot hold.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_fill_off_its_data_grid_is_refused_by_name() {
    let config = FillQuoteCorpusConfig {
        aapl_price_precision: 3,
        ..FillQuoteCorpusConfig::default()
    };
    let (trace, result) = run_fill_quote_corpus_with(config, |time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.235", "187.245", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(
        trace.callback_failure.as_deref(),
        Some(
            "FILL_PRICE_OFF_THE_DATA_GRID: 187.245 for AAPL.XNAS is finer than its data's 2-place grid"
        )
    );
    assert_eq!(
        fill_rows(&result)[0],
        ["AAPL.XNAS", "26", "187.245", "TAKER", "0.75 USD"],
        "the venue filled it; the Host refuses to take it"
    );
}

/// A position order the pre-trade risk engine denies never reaches the venue. The Host hands the
/// kernel that denial as a rejection, so the member's pending intent is released with nothing
/// filled and the run goes on: MSFT still fills, and the run stops cleanly.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_denied_position_order_reaches_the_kernel_as_a_rejection() {
    let risk_engine = RiskEngineConfig {
        max_notional_per_order: [(
            InstrumentId::from("AAPL.XNAS"),
            rust_decimal::Decimal::from(100),
        )]
        .into_iter()
        .collect(),
        ..Default::default()
    };
    let config = FillQuoteCorpusConfig {
        risk_engine: Some(risk_engine),
        ..FillQuoteCorpusConfig::default()
    };
    let (trace, result) = run_fill_quote_corpus_with(config, |time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.10", "187.20", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(trace.callback_failure, None);
    assert_eq!(
        fill_rows(&result),
        [["MSFT.XNAS", "26", "421.10", "TAKER", "1.68 USD"]]
    );
    let aapl_fills = trace
        .host_transitions
        .iter()
        .filter(|transition| {
            transition.lifecycle == "FILL" && transition.instrument.as_deref() == Some("AAPL.XNAS")
        })
        .map(|transition| {
            (
                transition.position_before_grid_units,
                transition.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        aapl_fills,
        [(0, 0)],
        "the denial is one FILL transition that moves nothing"
    );
    assert!(
        trace
            .final_member_grid_units
            .as_ref()
            .is_some_and(|units| *units == [0, 4])
    );
}

/// Each order as `(instrument, order_type, status)` at the run's end, in the canonical result's
/// order.
fn order_statuses(result: &serde_json::Value) -> Vec<[String; 3]> {
    result["orders"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|order| order.as_object()?.values().next())
        .map(|order| {
            let core = &order["core"];
            ["instrument_id", "order_type", "status"]
                .map(|field| core[field].as_str().unwrap_or_default().to_owned())
        })
        .collect()
}

/// A position order still resting when the run ends is canceled at the venue, and the Host hands
/// the kernel that cancellation before the Stop, so the member's pending intent is released with
/// nothing filled. No fill follows the Stop: the run states MSFT's fill and nothing for AAPL.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_position_order_resting_at_the_runs_end_is_canceled_into_the_kernel_before_the_stop() {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.20", "187.30", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert_eq!(trace.callback_failure, None);
    let lifecycle = trace
        .host_transitions
        .iter()
        .map(|transition| {
            (
                transition.lifecycle.as_str(),
                transition.instrument.as_deref(),
                transition.position_before_grid_units,
                transition.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        lifecycle,
        [
            ("START", None, 0, 0),
            ("BAR", Some("AAPL.XNAS"), 0, 0),
            ("BAR", Some("MSFT.XNAS"), 0, 0),
            ("FILL", Some("MSFT.XNAS"), 0, 4),
            ("FILL", Some("AAPL.XNAS"), 0, 0),
            ("STOP", None, 0, 0),
        ],
        "AAPL's cancellation reaches the kernel as a FILL that moves nothing, before the STOP"
    );
    assert_eq!(
        fill_rows(&result),
        [["MSFT.XNAS", "26", "421.10", "TAKER", "1.68 USD"]]
    );
    assert_eq!(
        order_statuses(&result),
        [
            ["MSFT.XNAS", "LIMIT", "FILLED"],
            ["AAPL.XNAS", "LIMIT", "CANCELED"],
            // The protective stop guards the position MSFT still holds, so it stays.
            ["MSFT.XNAS", "STOP_MARKET", "ACCEPTED"],
        ]
    );
}

/// A Quote at another instant than the one the bundle states for a waiting member is refused by
/// name, before any order reaches the venue.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_quote_at_another_instant_than_the_frames_fill_quote_is_refused() {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        (
            vec![
                touch(&instruments[0], "187.10", "187.20", time + 1),
                touch(&instruments[1], "421.00", "421.10", time + 1),
            ],
            vec![time + 2; 2],
        )
    })
    .expect("fill-quote corpus");
    assert!(
        trace
            .callback_failure
            .as_deref()
            .is_some_and(|failure| failure.starts_with("FILL_QUOTE_NOT_THE_FRAMES_QUOTE_CUT")),
        "{:?}",
        trace.callback_failure
    );
    assert_eq!(trace.position_submit_attempts, 0);
    assert!(fill_rows(&result).is_empty());
}

/// An order still waiting when the next BAR or the run's end arrives is refused by name: the
/// decided order never reached the venue, so the run states no execution for it.
#[rstest]
#[case::next_bar(true, "a decided order still waits for its frame's fill quote")]
#[case::run_end(
    false,
    "a decided order still waits for its frame's fill quote at the run's end"
)]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_fill_quote_missing_before_the_next_bar_or_the_runs_end_is_refused(
    #[case] next_bar: bool,
    #[case] refusal: &str,
) {
    let (trace, result) = run_fill_quote_corpus(|time, instruments| {
        let later_bar = Data::Bar(Bar::new(
            BarType::new(
                instruments[0].id(),
                BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
                AggregationSource::External,
            ),
            Price::from("187.25"),
            Price::from("187.25"),
            Price::from("187.25"),
            Price::from("187.25"),
            Quantity::from("100"),
            (time + 2).into(),
            (time + 2).into(),
        ));
        (
            if next_bar {
                vec![later_bar]
            } else {
                Vec::new()
            },
            vec![time + 1; 2],
        )
    })
    .expect("fill-quote corpus");
    assert!(
        trace.callback_failure.as_deref().is_some_and(
            |failure| failure == format!("FILL_QUOTE_MISSING_BEFORE_NEXT_FRAME: {refusal}")
        ),
        "{:?}",
        trace.callback_failure
    );
    assert_eq!(trace.position_submit_attempts, 0);
    assert!(fill_rows(&result).is_empty());
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
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )?;
    let first_time = admitted.envelope().order_key.logical_time_ns;
    let second_time = first_time + 100;
    // THIS SECOND FRAME IS CONSTRUCTED BY THIS TEST, NOT ISSUED BY THE OWNER. It is the first
    // frame with a new logical time and new member opens and closes, so what follows proves the
    // strategy's arithmetic across two frames and proves nothing about whether Market Data can
    // supply a second frame. The Owner sequence landed for scheduling evidence, not for universe
    // receipts, so no Owner-issued successor exists to take its place yet.
    let successor = issue_backtest_universe_successor_for_test(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
        second_time,
        &[[18_725, 18_750], [42_115, 42_150]],
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
    data.extend(fill_quotes(&instruments, &first_bars, first_time + 1));
    // The portfolio marks a position at its latest Quote before any BAR, so without this Quote the
    // second frame's equity would be marked at the first frame's fill quote. It states the moved
    // marks the second frame sizes against; the Host ignores it, since no order waits.
    data.extend(
        instruments
            .iter()
            .zip(&second_bars)
            .map(|(instrument, bar)| fill_quote_at(instrument, bar.close, second_time - 1)),
    );
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
    data.extend(fill_quotes(&instruments, &second_bars, second_time + 1));
    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-BACKTEST-B3-EQUITY-001"),
        plan,
        artifact,
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        BTreeMap::from([
            (first_time, vec![first_time + 1; 2]),
            (second_time, vec![second_time + 1; 2]),
        ]),
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
        // Every fixture price is on a two-place grid.
        BoundedMembers::try_from([2, 2])?,
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

pub(crate) fn instruments() -> [InstrumentAny; 2] {
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

pub(crate) fn fixture() -> anyhow::Result<(
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
    let artifact = StrategyArtifactV2::issue_versioned(&plan, vec![build.into()])
        .map_err(|error: StrategyArtifactV2Error| anyhow::anyhow!(error))?;
    Ok((*plan, artifact, frame))
}

fn target_set() -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        1,
        &[
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
        &[
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

fn exit_target_set() -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        2,
        &[
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"AAPL.XNAS").unwrap(),
                position: PositionIntentV1::Exit,
                target: TargetProposalV1::Position(0),
                reconciliation_target_units: Some(0),
                protection: ProtectionProposalV1::Clear,
            },
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"MSFT.XNAS").unwrap(),
                position: PositionIntentV1::Exit,
                target: TargetProposalV1::Position(0),
                reconciliation_target_units: Some(0),
                protection: ProtectionProposalV1::Clear,
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
        output_availability: (manifest.abi_version == PLUGIN_FRAME_ABI_V3)
            .then_some(PluginOutputAvailabilityV3::Ready),
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

/// Each member's fill Quote at `instant`, at its frame BAR's close: the event the Host submits a
/// frame's decided orders on.
///
/// On an L2 book a Quote moves no liquidity, so the orders meet the book the fixture's deltas
/// build, at the Quote's instant rather than at the frame's; the Quote only marks the member at
/// the close it was decided on.
fn fill_quotes(instruments: &[InstrumentAny], bars: &[Bar], instant: u64) -> Vec<Data> {
    instruments
        .iter()
        .zip(bars)
        .map(|(instrument, bar)| fill_quote_at(instrument, bar.close, instant))
        .collect()
}

fn fill_quote(instrument: &InstrumentAny, close: &str, instant: u64) -> Data {
    fill_quote_at(instrument, Price::from(close), instant)
}

fn fill_quote_at(instrument: &InstrumentAny, close: Price, instant: u64) -> Data {
    Data::Quote(QuoteTick::new(
        instrument.id(),
        close,
        close,
        instrument.make_qty(1.0, None),
        instrument.make_qty(1.0, None),
        instant.into(),
        instant.into(),
    ))
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
        EnvelopePayloadV1, EventOrderKeyV1, FillEventV1, FillLegV1, LifecycleEnvelopeV1,
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
                leg: FillLegV1::Intent,
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

/// The Owner-issued authority and every execution-bundle digest over a two-member run, pinned from
/// the pre-widening tree: the profile binding, native materialization, frame sequence, scheduling
/// data, and census digests. The fixture's instrument terms now name each member by its canonical
/// identity, as the Instrument Owner issues them, so the four digests that bind those terms were
/// read again; the frame sequence and scheduling data digests did not move.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn two_member_execution_bundle_digests_are_unchanged_by_the_member_count_widening() {
    let mut instruments = instruments();
    for instrument in &mut instruments {
        let instrument = crypto_perpetual_mut(instrument);
        instrument.maker_fee = rust_decimal::Decimal::new(2, 4);
        instrument.taker_fee = rust_decimal::Decimal::new(4, 4);
        instrument.margin_init = rust_decimal::Decimal::new(1, 1);
        instrument.margin_maint = rust_decimal::Decimal::new(5, 2);
    }
    let (plan, artifact, frame) = fixture().unwrap();
    let admitted = admit_owner_universe_program_event_v2(
        &plan,
        &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
    )
    .unwrap();
    let time = admitted.envelope().order_key.logical_time_ns;
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );
    let authority_digest = authority.authority_digest();
    let (bar_types, data) = request_execution_schedule(&instruments, time);
    let capability = ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![OwnerUniverseFrameV1::uncoordinated(frame)],
        StrategyId::from("TARGET-SET-PROFILE-EVENT-001"),
        "target-set-profile-event".into(),
        instruments,
        bar_types,
        data,
        &[time],
    )
    .unwrap();
    let census = &capability.census;
    crate::target_set_members::assert_two_member_bytes_unchanged(
        &[
            ("owner_authority_digest", &authority_digest),
            (
                "execution_profile_binding_digest",
                &census.execution_profile_binding_digest(),
            ),
            (
                "native_materialization_digest",
                &census.native_materialization_digest(),
            ),
            ("frame_sequence_digest", &census.frame_sequence_digest()),
            ("scheduling_data_digest", &census.scheduling_data_digest()),
            ("census_digest", &census.census_digest()),
        ],
        &[
            (
                "owner_authority_digest",
                32,
                "65856497e7d476b0e5fcaaa492a4a8d86ab2e797ba9d8a27b08236700b0a3a80",
            ),
            (
                "execution_profile_binding_digest",
                32,
                "a08d72c7a0bfac6f46d3d551a9d41c31d0040540ac3ad7b866a55f7caad7064d",
            ),
            (
                "native_materialization_digest",
                32,
                "576622d49f03b6fd408989236d72f38c02ac20df48279b2bd1a459d083ed73b3",
            ),
            (
                "frame_sequence_digest",
                32,
                "73fd8ac3875ec58384a5b6db5b2d99d8cd5ef2ed52098328a084abc13c468f98",
            ),
            (
                "scheduling_data_digest",
                32,
                "9706efbc97d7954eb20ecdc449dff6979da37d6ef63bcbf587a72fd93f30ffa6",
            ),
            // The census also states each member's price grid since the Replay widens a grid to
            // its data; nothing else in it changed.
            (
                "census_digest",
                32,
                "0e8514a73cd118d55f815a5da14195e173fbb300dc7874bd0dc40911a05a7829",
            ),
        ],
    );
}

/// The authored single-threshold universe-member program over one member, lowered from its
/// frozen pair, built as a strict ABI 3 module, and compiled against its one-member Owner frame.
#[cfg(feature = "sealed-strategy-input-acceptance")]
struct AuthoredUniverseMemberProgram {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    /// The Owner frame with the coordinates the Plan reads.
    owner_frame: OwnerUniverseFrameV1,
    /// The frame's logical time.
    time: u64,
}

/// Authors, lowers, builds and compiles the single-threshold universe-member program whose sides
/// enter at 1 and exit to 0 under `target_variant`, with the entry side above a threshold of
/// 120.00.
///
/// `open_role` and `close_role` name the Design's two member roles. A weight side enters at
/// `entry_weight_micros` and exits at a weight of 0; every other variant takes 0 for both.
/// `exits` names the statement's exits, if any.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn authored_universe_member_program(
    open_role: &str,
    close_role: &str,
    target_variant: &str,
    entry_weight_micros: i32,
    exits: fn(&mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1),
) -> AuthoredUniverseMemberProgram {
    use crate::{
        bounded_feature_program_derivation_v1::derive_bounded_feature_program_proposal_v1,
        bounded_feature_program_v1::BoundedFeaturePredicateV1,
        cargo_artifact::{PluginCargoBuildEvidenceV3, VerifiedPluginCargoBuildV3},
        develop_composer_v2::CurrentResearchDevelopCustodyV2,
        lowered_guest_build_for_test::build_lowered_guest_for_test,
        rd_bounded_feature_program_v1::freeze_research_bounded_feature_program_v1,
        single_threshold_authoring_v1::{
            SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1, SingleThresholdOutcomeV1,
            author_single_threshold_program_v1,
        },
        strategy_design_v2::StrategyDesignV2,
        strategy_plan_v2::{
            StrategyDesignPreparationV2, prepare_strategy_design_v2,
            verified_strategy_input_bindings_for_test,
        },
    };
    use vibe_data::owner::sealed_acceptance::issue_single_member_universe_frame_for_owner_lineage;
    use vibe_indicators_kernel::PrimitiveCatalogV1;

    let outcome = |position_intent: &str, units, weight_micros| SingleThresholdOutcomeV1 {
        position_intent_semantic_id: position_intent.to_owned(),
        target_variant_semantic_id: target_variant.to_owned(),
        target_position_units: units,
        target_weight_micros: weight_micros,
    };
    let mut statement = SingleThresholdAuthoringRequestV1 {
        research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
        intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        channel: SingleThresholdChannelV1::UniverseMember {
            close_role_semantic_id: close_role.to_owned(),
            open_role_semantic_id: open_role.to_owned(),
        },
        threshold: "120".to_owned(),
        comparison: BoundedFeaturePredicateV1::Greater,
        when_true: outcome("kernel.position.enter.v1", 1, entry_weight_micros),
        otherwise: outcome("kernel.position.exit.v1", 0, 0),
        stop_loss_fraction: None,
        take_profit_fraction: None,
        max_holding_bars: None,
        falsifier: "the close never exceeds the threshold in the admitted window".to_owned(),
    };
    exits(&mut statement);
    let (design, meaning) = author_single_threshold_program_v1(&statement)
        .expect("the universe-member statement is authorable");
    let receipts = design
        .inputs
        .iter()
        .enumerate()
        .map(|(index, role)| {
            let mut bytes = [0x5a_u8; 32];
            bytes[0] = u8::try_from(index).expect("two roles");
            (role.clone(), BindingDigest::from_untrusted_bytes(bytes))
        })
        .collect();
    let bindings = verified_strategy_input_bindings_for_test(&design, receipts);
    let proposal = derive_bounded_feature_program_proposal_v1(
        &design,
        PrimitiveCatalogV1::verify().expect("a published catalog"),
        &meaning,
        &bindings,
    )
    .expect("the authored meaning assembles");
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");
    let root = tempfile::tempdir().expect("private build root");
    let guest = build_lowered_guest_for_test(
        &frozen,
        root.path(),
        &root.path().join("target-out"),
        "universe-member",
    );

    // The Plan is compiled from the frozen Design, against the one-member Owner frame issued for
    // it, with a V3 build receipt over the module just built.
    let candidate: StrategyDesignV2 =
        serde_json::from_slice(frozen.design_bytes()).expect("the frozen Design parses");
    let StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = prepare_strategy_design_v2(&candidate)
    else {
        panic!("the frozen Design canonicalizes")
    };
    let sealed_frame = issue_single_member_universe_frame_for_owner_lineage(
        candidate.research_request_identity,
        design_identity,
    )
    .expect("one-member Owner universe frame");
    let build = VerifiedPluginCargoBuildV3::verify(
        &guest.manifest,
        PluginCargoBuildEvidenceV3 {
            wasm_one: &guest.wasm,
            wasm_two: &guest.wasm,
            capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_set_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
            max_wasm_bytes: guest.max_wasm_bytes,
        },
    )
    .expect("repeat-equal ABI3 build");
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        &guest.manifest,
        build.capsule_digest(),
        build.source_set_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        guest.manifest.abi_version,
        guest
            .manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let StrategyCompilationV2::Compiled(plan) =
        compile_strategy_design_v2_for_universe(candidate, &sealed_frame, &[receipt])
    else {
        panic!("the frozen universe-member Design compiles against its one-member frame")
    };
    let artifact = StrategyArtifactV2::issue_versioned(&plan, vec![build.into()])
        .expect("ABI3 strategy artifact");
    let owner_frame =
        OwnerUniverseFrameV1::with_plan_coordinates_for_test(&plan, sealed_frame.frame().clone());
    let time = admit_owner_universe_program_event_v2(&plan, &owner_frame)
        .expect("the coordinated frame is admitted")
        .envelope()
        .order_key
        .logical_time_ns;
    AuthoredUniverseMemberProgram {
        plan: *plan,
        artifact,
        owner_frame,
        time,
    }
}

/// One member of `instruments()`, with the fees and margins the authored-program runs share.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn authored_program_member() -> InstrumentAny {
    let [mut aapl, _] = instruments();
    let perpetual = crypto_perpetual_mut(&mut aapl);
    perpetual.maker_fee = rust_decimal::Decimal::new(2, 4);
    perpetual.taker_fee = rust_decimal::Decimal::new(4, 4);
    perpetual.margin_init = rust_decimal::Decimal::new(1, 1);
    perpetual.margin_maint = rust_decimal::Decimal::new(5, 2);
    aapl
}

/// The authored position-target program run through the target-set Sim for one frame.
///
/// `open_role` and `close_role` name the Design's two member roles. Returns the run's readback and
/// the frame's time.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn run_authored_universe_member_program(
    open_role: &str,
    close_role: &str,
) -> (
    super::program_host_sim_event_consumer_v1::ProgramHostSimEventReadbackV1,
    u64,
) {
    let AuthoredUniverseMemberProgram {
        plan,
        artifact,
        owner_frame,
        time,
    } = authored_universe_member_program(
        open_role,
        close_role,
        "kernel.target.position.v1",
        0,
        |_| {},
    );
    let frame = owner_frame.frame().clone();
    let authority = owner_replay_execution_profile_binding_fixture_v1(
        &plan,
        &artifact,
        &frame,
        ReplayWindowV2 {
            start_event_ns: time,
            end_event_ns_exclusive: time + 3,
        },
    );

    // One member: the frame's BAR, then one quote after it for the entry to fill against.
    let aapl = authored_program_member();
    let bar_type = BarType::new(
        aapl.id(),
        BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
        AggregationSource::External,
    );
    let data = vec![
        Data::Bar(Bar::new(
            bar_type,
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from("100"),
            time.into(),
            time.into(),
        )),
        Data::Quote(QuoteTick::new(
            aapl.id(),
            Price::from("187.24"),
            Price::from("187.25"),
            Quantity::from("100"),
            Quantity::from("100"),
            (time + 1).into(),
            (time + 1).into(),
        )),
    ];
    let bundle = ReplayTargetSetExecutionBundleV1::new_with_native_instruments_for_test(
        authority,
        plan,
        artifact,
        vec![owner_frame],
        StrategyId::from("TARGET-SET-UNIVERSE-MEMBER-WASM-001"),
        "target-set-universe-member-wasm".into(),
        [aapl],
        [bar_type],
        data,
        &[time],
    )
    .expect("one-member execution bundle");
    (
        run_program_host_sim_event_consumer_v1(bundle).expect("the Sim EVENT run completes"),
        time,
    )
}

/// The earliest instant any account balance event or portfolio snapshot in a canonical result
/// carries.
///
/// A report's returns come from balances on two distinct UTC days or from closed positions, so an
/// initial state stamped before the run - at the epoch, say - would invent a second day and a
/// return from it to the first.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn earliest_balance_instant(document: &serde_json::Value) -> Option<u64> {
    let account_events = document["accounts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_object)
        .flat_map(|account| account.values())
        .flat_map(|account| account["base"]["events"].as_array().into_iter().flatten());
    let snapshots = document["portfolio_snapshots"]
        .as_array()
        .into_iter()
        .flatten();

    account_events
        .chain(snapshots)
        .map(|event| {
            event["ts_event"]
                .as_str()
                .and_then(|ts| ts.parse::<u64>().ok())
                .expect("every balance event carries its instant")
        })
        .min()
}

/// The authored single-threshold universe-member program, lowered and built as a strict ABI 3
/// module, runs one frame of the target-set Sim under the production engine configuration.
///
/// Nothing had run such a program: the target-set Sim tests drive hand-written modules that emit a
/// member target set, and the universe-member tests of the Host drive a hand-written module through
/// `apply_event`. This program emits a single-instrument proposal, which the Host lifts into a
/// one-member target set, and it reads the member coordinates the frame carries.
///
/// One frame whose close is above the threshold: the program enters, one native fill consumes it,
/// the report projects that fill, and the run's balances begin at the frame.
///
/// It does not assert the report's state. The Owner frame's time is fixed by the sealed corpus at
/// 25 ns after the epoch, and there the engine's day buckets collapse: the registration snapshot
/// it files under the previous day cannot go below day zero. A real run's state is pinned instead
/// by the report module's real-engine tests at a real date.
#[rstest]
#[ignore = "lowers and builds the authored universe-member program with the pinned local wasm compiler"]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn an_authored_universe_member_program_enters_once_through_the_target_set_sim() {
    use crate::backtest_run_report_read_v1::project_engine_result_v1;

    let (readback, time) =
        run_authored_universe_member_program("research.input.open.v1", "research.input.close.v1");

    assert_eq!(readback.target_set_count(), 1);
    // The entry side's target is reconciled to its own position. When the author shared one
    // reconciliation of 0 between both sides, this proposal never reached a target set at all.
    let entry = InstrumentTargetSetV2::decode_slot(&readback.canonical_target_sets()[0])
        .expect("the committed target set decodes");
    assert_eq!(entry.members()[0].target, TargetProposalV1::Position(1));
    assert_eq!(entry.members()[0].reconciliation_target_units, Some(1));
    assert_eq!(readback.actual_fills().len(), 1, "one entry, one fill");
    assert_eq!(readback.actual_fills()[0].instrument(), "AAPL.XNAS");
    assert!(
        readback
            .host_transitions()
            .iter()
            .filter(|transition| transition.lifecycle() == "BAR")
            .all(
                |transition| transition.position_intent_semantic_id() == "kernel.position.enter.v1"
            ),
        "the close above the threshold enters"
    );
    assert!(readback.canonical_result_is_exact());

    let report = project_engine_result_v1(readback.canonical_result())
        .expect("the canonical result projects");
    assert_eq!(report.fill_count, 1);
    assert_eq!(report.fills[0].side, "BUY");

    let mut document: serde_json::Value =
        serde_json::from_slice(readback.canonical_result()).expect("canonical JSON");
    assert_eq!(earliest_balance_instant(&document), Some(time));
    // The control: an initial state stamped at the epoch is what the check exists to see.
    document["portfolio_snapshots"][0]["ts_event"] = serde_json::json!("0");
    assert_eq!(earliest_balance_instant(&document), Some(0));
}

/// The authored rebalance program runs three consecutive frames of the target-set Sim: its close
/// above the threshold, below it, and above it again.
///
/// A rebalance target must carry the sequence of the target set it is lifted into, which advances
/// by one each frame. The program emits 0 and the Host assigns that sequence at decode, so every
/// frame lifts; when the author wrote one constant instead, only the frame whose set sequence
/// equalled it lifted, and the run stopped at the next.
///
/// THE SECOND AND THIRD FRAMES ARE CONSTRUCTED BY THIS TEST, NOT ISSUED BY THE OWNER: they are the
/// first frame, with its coordinates, at a new logical time and with new member values. What this
/// proves is the Host's sequence across frames, not that Market Data can supply them.
#[rstest]
#[ignore = "lowers and builds the authored universe-member program with the pinned local wasm compiler"]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn an_authored_rebalance_program_lifts_three_consecutive_frames() {
    let trace = run_authored_program_over_three_frames("kernel.target.rebalance.v1", 0)
        .expect("the three-frame Sim run completes");

    assert_eq!(trace.callback_failure, None);
    let targets = trace
        .canonical_target_sets
        .iter()
        .map(|bytes| {
            let set = InstrumentTargetSetV2::decode_slot(bytes).expect("a committed target set");
            (set.sequence, set.members()[0].target)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        targets,
        [
            (
                1,
                TargetProposalV1::RebalancePosition {
                    sequence: 1,
                    units: 1
                }
            ),
            (
                2,
                TargetProposalV1::RebalancePosition {
                    sequence: 2,
                    units: 0
                }
            ),
            (
                3,
                TargetProposalV1::RebalancePosition {
                    sequence: 3,
                    units: 1
                }
            ),
        ],
        "each frame lifts at its own set's sequence"
    );
    let legs = trace
        .actual_fill_consumptions
        .iter()
        .map(|fill| {
            (
                fill.position_intent.as_str(),
                fill.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(legs, [("ENTER", 1), ("EXIT", 0), ("ENTER", 1)]);
    assert_eq!(trace.final_member_grid_units.as_deref(), Some(&[1][..]));
}

/// The authored weight program runs the same three frames: it enters at a weight of 400 micros of
/// equity, exits at a weight of 0, and enters again.
///
/// The target-set Host turns a weight into a grid position from equity and price when it
/// reconciles, so a weight member reaches it without a reconciliation of its own; when the Host
/// decoded one anyway, the first frame failed as `InputCoverage`. And each side reads its own
/// weight: when the author shared one weight of 0 between both sides, the entry derived a grid
/// position of 0 and the first frame failed as `InvalidPositionTransition`.
///
/// The weight is sized to the AAPL fixture's multiplier of 2, which the grid derivation divides
/// by along with the price: 400 micros of the starting 1,000,000 USD is 400 USD, which over
/// 187.25 x 2 and 188.00 x 2 is 1.07 and 1.06 units, so one unit each time. 200 micros, measured
/// first, is 0.53 units and truncates to a grid position of 0.
///
/// THE SECOND AND THIRD FRAMES ARE CONSTRUCTED BY THIS TEST, NOT ISSUED BY THE OWNER, as in
/// [`an_authored_rebalance_program_lifts_three_consecutive_frames`].
#[rstest]
#[ignore = "lowers and builds the authored universe-member program with the pinned local wasm compiler"]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn an_authored_weight_program_enters_exits_and_enters_again() {
    let trace = run_authored_program_over_three_frames("kernel.target.weight.v1", 400)
        .expect("the three-frame Sim run completes");

    assert_eq!(trace.callback_failure, None);
    let targets = trace
        .canonical_target_sets
        .iter()
        .map(|bytes| {
            let set = InstrumentTargetSetV2::decode_slot(bytes).expect("a committed target set");
            (set.sequence, set.members()[0].target)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        targets,
        [
            (1, TargetProposalV1::WeightMicros(400)),
            (2, TargetProposalV1::WeightMicros(0)),
            (3, TargetProposalV1::WeightMicros(400)),
        ]
    );
    let legs = trace
        .actual_fill_consumptions
        .iter()
        .map(|fill| {
            (
                fill.position_intent.as_str(),
                fill.position_after_grid_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(legs, [("ENTER", 1), ("EXIT", 0), ("ENTER", 1)]);
    assert_eq!(trace.final_member_grid_units.as_deref(), Some(&[1][..]));
}

/// What an authored run did: each BAR's position intent, and each fill's intent and the position
/// it left.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn bar_intents_and_legs(trace: &TargetSetBacktestTraceV2) -> (Vec<&str>, Vec<(&str, i64)>) {
    assert_eq!(trace.callback_failure, None, "the run does not fault");
    let intents = trace
        .host_transitions
        .iter()
        .filter(|transition| transition.lifecycle == "BAR")
        .map(|transition| transition.position_intent.as_str())
        .collect();
    let legs = trace
        .actual_fill_consumptions
        .iter()
        .map(|fill| {
            (
                fill.position_intent.as_str(),
                fill.position_after_grid_units,
            )
        })
        .collect();
    (intents, legs)
}

/// A later frame whose close is `close` at scale two, opening at the frame before's close, with
/// the book side its order meets.
#[cfg(feature = "sealed-strategy-input-acceptance")]
const fn later(
    open_close: [i128; 2],
    bar: (&'static str, &'static str, &'static str, &'static str),
    liquidity: Option<OrderSide>,
) -> LaterFrame {
    LaterFrame {
        open_close,
        bar,
        liquidity,
    }
}

/// The authored program enters on its first frame, holds on a second frame above its threshold,
/// leaves by `exits` on the third, and enters again on a fourth, each exit judged at the close.
///
/// Before the program carried the position it believes it holds, the second frame alone ended
/// the run: it proposed its entry again from a held position, which the kernel refuses, and a
/// refused proposal aborts the run. The third frame's close stays above the threshold, so only
/// the exit can leave the position there, and the fourth shows the program flat again.
///
/// THE LATER FRAMES ARE CONSTRUCTED BY THIS TEST, NOT ISSUED BY THE OWNER, as in
/// [`an_authored_rebalance_program_lifts_three_consecutive_frames`].
#[rstest]
#[case::stop_loss(
    |r: &mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1| {
        r.stop_loss_fraction = Some("0.05".to_owned());
    },
    // 170.00 is at most 187.25 x 0.95 = 177.8875.
    [[18_725, 18_800], [18_800, 17_000], [17_000, 17_500]],
    [("187.25", "188.50", "187.00", "188.00"), ("188.00", "188.00", "169.50", "170.00"), ("170.00", "175.50", "169.80", "175.00")],
)]
#[case::take_profit(
    |r: &mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1| {
        r.take_profit_fraction = Some("0.05".to_owned());
    },
    // 200.00 is at least 187.25 x 1.05 = 196.6125.
    [[18_725, 19_000], [19_000, 20_000], [20_000, 20_100]],
    [("187.25", "190.50", "187.00", "190.00"), ("190.00", "200.50", "189.50", "200.00"), ("200.00", "201.50", "199.50", "201.00")],
)]
#[case::max_holding_bars(
    |r: &mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1| {
        r.max_holding_bars = Some(2);
    },
    [[18_725, 18_800], [18_800, 18_900], [18_900, 19_000]],
    [("187.25", "188.50", "187.00", "188.00"), ("188.00", "189.50", "187.50", "189.00"), ("189.00", "190.50", "188.50", "190.00")],
)]
#[ignore = "lowers and builds the authored universe-member program with the pinned local wasm compiler"]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn an_authored_exit_leaves_once_at_the_close_and_the_program_enters_again(
    #[case] exits: fn(&mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1),
    #[case] open_close: [[i128; 2]; 3],
    #[case] bars: [(&'static str, &'static str, &'static str, &'static str); 3],
) {
    let trace = run_authored_program_over_frames(
        "kernel.target.position.v1",
        0,
        exits,
        &[
            later(open_close[0], bars[0], None),
            later(open_close[1], bars[1], Some(OrderSide::Buy)),
            later(open_close[2], bars[2], Some(OrderSide::Sell)),
        ],
    )
    .expect("the four-frame Sim run completes");

    let (intents, legs) = bar_intents_and_legs(&trace);
    assert_eq!(intents, ["ENTER", "HOLD", "EXIT", "ENTER"]);
    assert_eq!(legs, [("ENTER", 1), ("EXIT", 0), ("ENTER", 1)]);
    assert_eq!(trace.final_member_grid_units.as_deref(), Some(&[1][..]));
}

/// The controls for [`an_authored_exit_leaves_once_at_the_close_and_the_program_enters_again`]:
/// the same frames under an exit they never reach hold the position throughout.
#[rstest]
#[case::stop_loss_not_reached(
    |r: &mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1| {
        r.stop_loss_fraction = Some("0.5".to_owned());
    },
    [[18_725, 18_800], [18_800, 17_000], [17_000, 17_500]],
    [("187.25", "188.50", "187.00", "188.00"), ("188.00", "188.00", "169.50", "170.00"), ("170.00", "175.50", "169.80", "175.00")],
)]
#[case::take_profit_not_reached(
    |r: &mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1| {
        r.take_profit_fraction = Some("0.5".to_owned());
    },
    [[18_725, 19_000], [19_000, 20_000], [20_000, 20_100]],
    [("187.25", "190.50", "187.00", "190.00"), ("190.00", "200.50", "189.50", "200.00"), ("200.00", "201.50", "199.50", "201.00")],
)]
#[ignore = "lowers and builds the authored universe-member program with the pinned local wasm compiler"]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn an_authored_exit_never_reached_holds_the_position(
    #[case] exits: fn(&mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1),
    #[case] open_close: [[i128; 2]; 3],
    #[case] bars: [(&'static str, &'static str, &'static str, &'static str); 3],
) {
    let trace = run_authored_program_over_frames(
        "kernel.target.position.v1",
        0,
        exits,
        &[
            later(open_close[0], bars[0], None),
            later(open_close[1], bars[1], None),
            later(open_close[2], bars[2], None),
        ],
    )
    .expect("the four-frame Sim run completes");

    let (intents, legs) = bar_intents_and_legs(&trace);
    assert_eq!(intents, ["ENTER", "HOLD", "HOLD", "HOLD"]);
    assert_eq!(legs, [("ENTER", 1)]);
    assert_eq!(trace.final_member_grid_units.as_deref(), Some(&[1][..]));
}

/// Runs the authored program of `target_variant` over three frames 100 ns apart - its close above
/// the threshold, below it, and above it again - each with a resting book level for its order to
/// fill against.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn run_authored_program_over_three_frames(
    target_variant: &str,
    entry_weight_micros: i32,
) -> anyhow::Result<TargetSetBacktestTraceV2> {
    // The second frame's close of 110.00 is below the threshold of 120.00, the third's 188.00
    // above; a bid meets the exit, an ask the entry.
    run_authored_program_over_frames(
        target_variant,
        entry_weight_micros,
        |_| {},
        &[
            LaterFrame {
                open_close: [18_725, 11_000],
                bar: ("187.25", "188.00", "109.00", "110.00"),
                liquidity: Some(OrderSide::Buy),
            },
            LaterFrame {
                open_close: [11_000, 18_800],
                bar: ("110.00", "189.00", "109.50", "188.00"),
                liquidity: Some(OrderSide::Sell),
            },
        ],
    )
}

/// One frame after the authored program's first, 100 ns after the frame before it.
#[cfg(feature = "sealed-strategy-input-acceptance")]
struct LaterFrame {
    /// The member's open and close at the channel's scale of two.
    open_close: [i128; 2],
    /// The frame's bar: open, high, low, close.
    bar: (&'static str, &'static str, &'static str, &'static str),
    /// The side of the book the frame's order meets, at its close, when it places one: a bid for
    /// an exit, an ask for an entry.
    liquidity: Option<OrderSide>,
}

/// Runs the authored program of `target_variant` with `exits`: its first frame, whose close of
/// 187.25 is above the threshold and enters against a resting ask, and then `later`.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn run_authored_program_over_frames(
    target_variant: &str,
    entry_weight_micros: i32,
    exits: fn(&mut crate::single_threshold_authoring_v1::SingleThresholdAuthoringRequestV1),
    later: &[LaterFrame],
) -> anyhow::Result<TargetSetBacktestTraceV2> {
    let AuthoredUniverseMemberProgram {
        plan,
        artifact,
        owner_frame,
        time,
    } = authored_universe_member_program(
        "research.input.open.v1",
        "research.input.close.v1",
        target_variant,
        entry_weight_micros,
        exits,
    );
    let member = authored_program_member();
    let bar_type = BarType::new(
        member.id(),
        BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
        AggregationSource::External,
    );
    let frames = later
        .iter()
        .zip(1_u64..)
        .map(|(frame, index)| (time + 100 * index, frame))
        .collect::<Vec<_>>();
    let successors = frames
        .iter()
        .map(|(at, frame)| {
            issue_backtest_universe_successor_for_test(
                &plan,
                &owner_frame,
                *at,
                &[frame.open_close],
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let bar = |at: u64, (open, high, low, close): (&str, &str, &str, &str)| {
        Data::Bar(Bar::new(
            bar_type,
            Price::from(open),
            Price::from(high),
            Price::from(low),
            Price::from(close),
            Quantity::from("100"),
            at.into(),
            at.into(),
        ))
    };
    let mut data = vec![
        Data::Delta(OrderBookDelta::clear(
            member.id(),
            1,
            time.into(),
            time.into(),
        )),
        book_level(&member, OrderSide::Sell, 187.25, "100", 2, time),
        bar(time, ("186.41", "188.00", "185.00", "187.25")),
    ];
    // Each frame's orders are submitted at its fill quote, which arrives just after the frame at
    // its close: the instant the Host waits for before it submits.
    data.push(fill_quote(&member, "187.25", time + 1));

    for ((at, frame), sequence) in frames.iter().zip(3_u64..) {
        if let Some(side) = frame.liquidity {
            let price = Price::from(frame.bar.3).as_f64();
            data.push(book_level(&member, side, price, "100", sequence, *at));
        }
        data.push(bar(*at, frame.bar));
        data.push(fill_quote(&member, frame.bar.3, *at + 1));
    }

    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-AUTHORED-REBALANCE-001"),
        plan,
        artifact,
        BoundedMembers::try_from([member.id()])?,
        BoundedMembers::try_from([bar_type])?,
        [owner_frame],
        std::iter::once(time)
            .chain(frames.iter().map(|(at, _)| *at))
            .map(|at| (at, vec![at + 1]))
            .collect(),
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
        // Every fixture price is on a two-place grid.
        BoundedMembers::try_from([2])?,
    )?;

    for successor in successors {
        strategy.add_admitted_frame_for_test(successor)?;
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
    engine.add_instrument(&member)?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(
        None,
        None,
        Some("target-set-authored-rebalance".to_owned()),
        false,
    )?;
    let trace = trace.borrow().clone();
    Ok(trace)
}
