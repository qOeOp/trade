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
        program_host_sim_event_round_trip_for_test, run_program_host_sim_event_consumer_v1,
    },
    replay_execution_profile_binding_v1::owner_replay_execution_profile_binding_fixture_v1,
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
    target_set_members::BoundedMembers,
};

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
    assert_eq!(evidence.native_order_count, 1);
    assert_eq!(trace.canonical_target_sets.len(), 1);
    assert!(trace.actual_fill_consumptions.is_empty());
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

/// A protective stop that fills between two frames aborts today's run: the Host records the fill
/// only as a native observation and never feeds it to the kernel, so at the next frame the
/// kernel's checkpoint still holds the entered position while the venue holds none, and the batch
/// snapshot refuses the mismatch.
///
/// This pins the defect the strategy shape envelope names D1, as it behaves today. When D1 lands -
/// a `kernel.fill.reconcile.v1` case for a protective fill, with T1 - this test flips to asserting
/// that the run continues and the exit frame sees the stopped-out member flat.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_triggered_stop_aborts_the_run_today_until_d1() {
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

    // Both controls run clean, so the abort below is the filled stop and nothing else: the same
    // close stop with no fall, and the same fall under the fixture's far 180.00 stop, which it
    // never reaches.
    let (unfallen, _) = run_two_frame_corpus(stopped, |_, _| Vec::new())
        .expect("the close stop without a fall runs");
    assert!(
        unfallen.callback_failure.is_none(),
        "{:?}",
        unfallen.callback_failure
    );
    let (far_stop, _) = run_two_frame_corpus(target_set(), fall_through_the_stop)
        .expect("the fall above the far stop runs");
    assert!(
        far_stop.callback_failure.is_none(),
        "{:?}",
        far_stop.callback_failure
    );
    assert!(
        !far_stop
            .native_order_observations
            .iter()
            .any(|event| { event.protection_order && event.event == "FILLED" })
    );

    let (trace, _) = run_two_frame_corpus(stopped, fall_through_the_stop)
        .expect("the run itself completes and reports its callback failure");

    let stop_filled = trace.native_order_observations.iter().any(|event| {
        event.protection_order && event.instrument == "AAPL.XNAS" && event.event == "FILLED"
    });
    assert!(
        stop_filled,
        "the protective stop must fill before the exit frame"
    );
    let failure = trace
        .callback_failure
        .as_deref()
        .expect("today a filled protective stop aborts the run at the next frame");
    assert!(
        failure.contains("member reconciliation mismatch"),
        "the abort must be the reconciliation refusal D1 removes: {failure}"
    );
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
    let instruments = instruments();
    let instrument_ids = [instruments[0].id(), instruments[1].id()];
    let bar_types = instrument_ids.map(|instrument_id| {
        BarType::new(
            instrument_id,
            BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
            AggregationSource::External,
        )
    });
    let (plan, artifact, frame) = fixture_with_target_sets(entry, Some(exit_target_set()))?;
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
        None,
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
        None,
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
        None,
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
        BoundedMembers::try_from(instrument_ids)?,
        BoundedMembers::try_from(bar_types)?,
        [crate::program_host_v2::OwnerUniverseFrameV1::uncoordinated(
            frame,
        )],
        None,
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

/// The Owner-issued authority and every execution-bundle digest over a two-member run, pinned from
/// the pre-widening tree: the profile binding, native materialization, frame sequence, scheduling
/// data, and census digests.
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
                "0e3c192a8de3e492a9f4600fc958485185c84cc3586e6914b005533158d877ca",
            ),
            (
                "execution_profile_binding_digest",
                32,
                "fa773a0b4c5372d89b4164e8b1e865537645045035de83772d615c0f6e0e6d04",
            ),
            (
                "native_materialization_digest",
                32,
                "92cb6b55801e451ac8881fd38150bb5f02b22148ec3769f7fe0a504febd724a1",
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
            (
                "census_digest",
                32,
                "59398f8b58ec2729f922df25185e6ea9571f7ac2460227644e99f4f374949ea5",
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
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn authored_universe_member_program(
    open_role: &str,
    close_role: &str,
    target_variant: &str,
    entry_weight_micros: i32,
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
    let (design, meaning) =
        author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
            research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
            intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
            intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
            channel: SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: close_role.to_owned(),
                open_role_semantic_id: open_role.to_owned(),
            },
            threshold_coefficient: 12_000,
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: outcome("kernel.position.enter.v1", 1, entry_weight_micros),
            otherwise: outcome("kernel.position.exit.v1", 0, 0),
            falsifier: "the close never exceeds the threshold in the admitted window".to_owned(),
        })
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
    } = authored_universe_member_program(open_role, close_role, "kernel.target.position.v1", 0);
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

/// Runs the authored program of `target_variant` over three frames 100 ns apart - its close above
/// the threshold, below it, and above it again - each with a resting book level for its order to
/// fill against.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn run_authored_program_over_three_frames(
    target_variant: &str,
    entry_weight_micros: i32,
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
    );
    let member = authored_program_member();
    let bar_type = BarType::new(
        member.id(),
        BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
        AggregationSource::External,
    );
    // Each later frame's member open and close, at the channel's scale of two, and its bar: the
    // second frame's close of 110.00 is below the threshold of 120.00, the third's 188.00 above.
    let frames = [
        (
            time + 100,
            [18_725, 11_000],
            ("187.25", "188.00", "109.00", "110.00"),
        ),
        (
            time + 200,
            [11_000, 18_800],
            ("110.00", "189.00", "109.50", "188.00"),
        ),
    ];
    let successors = frames
        .iter()
        .map(|(at, open_close, _)| {
            issue_backtest_universe_successor_for_test(&plan, &owner_frame, *at, &[*open_close])
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
    // Each later frame's order meets the side it needs: a bid for the exit, an ask for the entry.
    for (index, ((at, _, prices), side)) in frames
        .iter()
        .zip([OrderSide::Buy, OrderSide::Sell])
        .enumerate()
    {
        let price = Price::from(prices.3).as_f64();
        data.push(book_level(
            &member,
            side,
            price,
            "100",
            3 + index as u64,
            *at,
        ));
        data.push(bar(*at, *prices));
    }

    let trace = Rc::new(RefCell::new(TargetSetBacktestTraceV2::default()));
    let mut strategy = BacktestTargetSetProgramHostStrategyV2::new(
        StrategyId::from("TARGET-SET-AUTHORED-REBALANCE-001"),
        plan,
        artifact,
        BoundedMembers::try_from([member.id()])?,
        BoundedMembers::try_from([bar_type])?,
        [owner_frame],
        None,
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
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
