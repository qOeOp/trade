//! The sealed acceptance BAR schedule proposer, over snapshots the production intake minted.

use std::{collections::BTreeSet, env};

use vibe_model::identifiers::InstrumentId;

use super::{
    MarketDataOwnerPostgres, OwnerSourceBindingDecision,
    acceptance_fixture_v1::{declaring_bars_v1, session_bar_v1},
    bar_schedule_acceptance_v1::{BarScheduleAcceptanceErrorV1, commit_bar_schedule_on_v1},
    declared_bar_timeframe_of_batch_v1, load_bar_schedule_candidates,
    strategy_input_binding_registry::{
        load_owner_verified_pit_batch_v1, register_strategy_input_binding_declaration_v1,
    },
    tests::{
        QuoteAfterBarObservationSourceV1, admit_market_semantics_v1, clock, d,
        declare_close_role_v1, one_member_universe_v1, oracle_instrument_submission_v1, pit_time,
        research_request_pit_v1, source_proposal,
    },
};
use crate::owner::{
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1,
        BarScheduleUnitV1,
    },
    declared_bar_timeframe_v1::{DeclaredBarAnchorV1, anchor_identity_v1},
    native_replay_scheduling_v1::{
        native_bar_type_for_schedule_v1, schedule_bar_specification_at_frame_v1,
        select_native_replay_schedule_for_member_v1,
    },
    pit_snapshot::PitSnapshotCommitAggregate,
    source_binding::{
        BindingDigest, UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1,
        UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1,
        UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1, UntrustedSourceBindingProposal,
        authority::{SourceBindingCommit, derive_market_semantics_compatibility_identity_v1},
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
    },
};

/// The fixture rows' `1M` bar as an exchange-listed source states it: a minute on the trading
/// schedule from the session open.
fn session_minute() -> UntrustedSourceBarTimeframeV1 {
    session_bar_v1(
        "1M",
        UntrustedSourceBarCadenceV1::FixedInterval {
            step: 1,
            unit: UntrustedSourceBarUnitV1::Minute,
        },
    )
}

async fn owner_with_binding() -> (MarketDataOwnerPostgres, SourceBindingCommit) {
    owner_with(
        declaring_bars_v1(source_proposal(10, 40), vec![session_minute()]),
        "AAPL",
    )
    .await
}

async fn owner_with(
    proposal: UntrustedSourceBindingProposal,
    instrument: &str,
) -> (MarketDataOwnerPostgres, SourceBindingCommit) {
    let owner =
        MarketDataOwnerPostgres::connect(&env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
    let binding = owner
        .commit_source_initial(
            proposal,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock(40, 1),
        )
        .await
        .unwrap();
    owner
        .admit_instrument_master_fact_v1(oracle_instrument_submission_v1(
            instrument,
            binding.receipt().locator(),
        ))
        .await
        .unwrap();
    (owner, binding)
}

async fn schedule_rows(owner: &MarketDataOwnerPostgres) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM market_data_private.bar_schedule_facts_v1")
        .fetch_one(owner.pool())
        .await
        .unwrap()
}

/// The intake's snapshot for `AAPL`, with a close role declared on it by two Designs (seeds 30 and
/// 60) over the same row and timeframe.
async fn declared_snapshot(
    owner: &MarketDataOwnerPostgres,
    binding: &SourceBindingCommit,
) -> PitSnapshotCommitAggregate {
    declared_snapshot_of(owner, binding, "AAPL", 20).await
}

/// [`declared_snapshot`] for `instrument`, its fixture values seeded from `seed`.
async fn declared_snapshot_of(
    owner: &MarketDataOwnerPostgres,
    binding: &SourceBindingCommit,
    instrument: &str,
    seed: u8,
) -> PitSnapshotCommitAggregate {
    let universe = Box::pin(one_member_universe_v1(owner, binding, instrument, seed)).await;
    let pit = Box::pin(research_request_pit_v1(
        owner, binding, instrument, &universe, seed,
    ))
    .await;
    assert_eq!(
        Box::pin(admit_market_semantics_v1(owner, binding, &pit, "RAW")).await,
        Ok(())
    );
    assert_eq!(
        Box::pin(declare_close_role_v1(owner, &pit, instrument, seed + 10)).await,
        Ok(())
    );
    assert_eq!(
        Box::pin(declare_close_role_v1(owner, &pit, instrument, seed + 40)).await,
        Ok(())
    );
    pit
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_declared_bar_role_gets_the_schedule_its_frame_reads_once() {
    let (owner, binding) = owner_with_binding().await;
    let pit = Box::pin(declared_snapshot(&owner, &binding)).await;
    let locator = pit.receipt().locator().clone();
    let before = schedule_rows(&owner).await;

    let committed = Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(31), d(32)))
        .await
        .unwrap();
    assert!(!committed.rejoined());
    assert_eq!(
        committed.schedule().fact().digest(),
        committed.fact_digest(),
        "the answer carries the schedule it minted"
    );
    assert_eq!(schedule_rows(&owner).await, before + 1);

    // The committed schedule is the one the native scheduling read selects for the frame.
    let mut transaction = owner.pool().begin().await.unwrap();
    let batch = load_owner_verified_pit_batch_v1(&mut transaction, locator.snapshot_identity)
        .await
        .unwrap();
    let candidates = load_bar_schedule_candidates(&mut transaction, "AAPL")
        .await
        .unwrap();
    transaction.rollback().await.unwrap();
    let frame = batch.time_evidence().event_effective.value;
    let selected: Vec<_> = candidates
        .iter()
        .filter(|candidate| {
            schedule_bar_specification_at_frame_v1(candidate, &batch, "AAPL", frame).is_ok()
        })
        .collect();
    assert_eq!(selected.len(), 1, "exactly one schedule answers the frame");
    assert_eq!(
        *selected[0].fact().digest().as_bytes(),
        *committed.fact_digest().as_bytes()
    );
    // It states the bar the binding declares for the role's `1M` rows, field by field.
    let fact = selected[0].fact();
    assert_eq!(fact.kind(), BarScheduleKindV1::FixedInterval);
    assert_eq!(fact.unit(), BarScheduleUnitV1::Minute);
    assert_eq!(fact.step(), 1);
    assert_eq!(
        fact.anchor_identity(),
        anchor_identity_v1(DeclaredBarAnchorV1::SessionOpen)
    );
    assert_eq!(fact.clock(), BarScheduleClockV1::ScheduleBounded);
    assert_eq!(fact.label(), BarScheduleLabelV1::IntervalClose);
    assert_eq!(fact.completion(), BarScheduleCompletionV1::CompleteOnly);

    // A second call rejoins it and writes nothing.
    let again = Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(31), d(32)))
        .await
        .unwrap();
    assert!(again.rejoined());
    assert_eq!(again.fact_digest(), committed.fact_digest());
    assert_eq!(
        again.schedule(),
        committed.schedule(),
        "a rejoin answers the stored schedule"
    );
    // The schedule is the instrument's and timeframe's, not the role's: the other Design's role
    // over the same row rejoins it too.
    let other_role = Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(61), d(62)))
        .await
        .unwrap();
    assert!(other_role.rejoined());
    assert_eq!(other_role.fact_digest(), committed.fact_digest());
    assert_eq!(schedule_rows(&owner).await, before + 1);
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_the_schedule_refuses_each_input_it_cannot_derive_from() {
    let (owner, binding) = owner_with_binding().await;
    let pit = Box::pin(declared_snapshot(&owner, &binding)).await;
    let locator = pit.receipt().locator().clone();
    let before = schedule_rows(&owner).await;

    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(31), d(99))).await,
        Err(BarScheduleAcceptanceErrorV1::RoleNotDeclared)
    );
    let mut foreign = locator.clone();
    // The snapshot exists; the locator names it under a request it was not minted for.
    foreign.request_digest = d(98);
    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(&owner, &foreign, d(31), d(32))).await,
        Err(BarScheduleAcceptanceErrorV1::SnapshotUnavailable)
    );

    // A snapshot that also carries a quote, and a quote role declared on it.
    let universe = Box::pin(one_member_universe_v1(&owner, &binding, "AAPL", 20)).await;
    let submission = crate::owner::pit_snapshot::PitSnapshotSubmissionV1 {
        correlation_identity: d(70),
        requester_identity: d(71),
        scope_digest: d(205),
        source_binding: binding.receipt().locator().clone(),
        universe_selection_digest: universe.1,
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &binding.fact().proposal().semantics,
        ),
        time_evidence: pit_time(40, 1),
    };
    let quote_source = QuoteAfterBarObservationSourceV1 { quote_offset: 0 };
    let quote_clock = clock(40, 1);
    let quoted = Box::pin(owner.commit_pit_initial_from_submission_v1(
        submission,
        &quote_source,
        &universe.0,
        &quote_clock,
    ))
    .await
    .unwrap();
    assert_eq!(
        Box::pin(admit_market_semantics_v1(&owner, &binding, &quoted, "RAW")).await,
        Ok(())
    );
    let mut transaction = owner.pool().begin().await.unwrap();
    let batch =
        load_owner_verified_pit_batch_v1(&mut transaction, quoted.fact().snapshot_identity())
            .await
            .unwrap();
    register_strategy_input_binding_declaration_v1(
        &mut transaction,
        &UntrustedStrategyInputBindingRequest {
            research_request_identity: d(72),
            strategy_design_identity: d(73),
            input_role_identity: d(74),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: "AAPL".into(),
            },
            field_semantic: MarketDataFieldSemantic::QuoteBidPrice,
            channel: StrategyInputChannel::Market,
            timeframe: "TICK".into(),
            unit: StrategyInputUnit::Price,
            scale: 2,
            pit_request_identity: batch.request_identity(),
            pit_request_digest: batch.request_digest(),
            snapshot_identity: batch.snapshot_identity(),
            snapshot_fact_digest: batch.fact_digest(),
            observation_batch_digest: batch.digest(),
            source_binding_identity: batch.source_binding_identity(),
            source_frontier_digest: batch.source_frontier_digest(),
            correction_frontier_digest: batch.correction_frontier_digest(),
            instrument_master_digest: batch.instrument_master_digest(),
            universe_selection_digest: batch.universe_selection_digest(),
            market_semantics_identity: batch.market_semantics_identity(),
            decision_cut: batch.time_evidence().decision_cut.value,
        },
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(
            &owner,
            quoted.receipt().locator(),
            d(73),
            d(74)
        ))
        .await,
        Err(BarScheduleAcceptanceErrorV1::RoleNotBar)
    );

    // A snapshot whose stored batch no longer verifies.
    sqlx::query(
        "UPDATE market_data_private.pit_observation_batches_v1 SET batch_digest=decode(repeat('ab',32),'hex') WHERE snapshot_identity=$1",
    )
    .bind(locator.snapshot_identity.as_bytes().as_slice())
    .execute(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(31), d(32))).await,
        Err(BarScheduleAcceptanceErrorV1::BatchUnverified)
    );
    assert_eq!(
        schedule_rows(&owner).await,
        before,
        "no refusal writes a schedule"
    );
}

/// A declared continuous bar is minted with no calendar and no session, whatever the Instrument
/// Master names, is stored and read back as such, and is the schedule the declaration selects.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_continuous_declaration_mints_a_schedule_without_calendar_or_session() {
    let instrument = "LINKUSDT-PERP.BINANCE";
    let continuous_minute = UntrustedSourceBarTimeframeV1 {
        row_timeframe: "1M".to_owned(),
        cadence: UntrustedSourceBarCadenceV1::FixedInterval {
            step: 1,
            unit: UntrustedSourceBarUnitV1::Minute,
        },
        anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
        clock: UntrustedSourceBarClockV1::Continuous,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    };
    let (owner, binding) = owner_with(
        declaring_bars_v1(source_proposal(10, 40), vec![continuous_minute]),
        instrument,
    )
    .await;
    let pit = Box::pin(declared_snapshot_of(&owner, &binding, instrument, 120)).await;
    let locator = pit.receipt().locator().clone();

    let committed = Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(131), d(132)))
        .await
        .unwrap();

    let mut transaction = owner.pool().begin().await.unwrap();
    let batch = load_owner_verified_pit_batch_v1(&mut transaction, locator.snapshot_identity)
        .await
        .unwrap();
    let declared = declared_bar_timeframe_of_batch_v1(&mut transaction, &batch, "1M")
        .await
        .unwrap();
    let candidates = load_bar_schedule_candidates(&mut transaction, instrument)
        .await
        .unwrap();
    transaction.rollback().await.unwrap();
    let selected = select_native_replay_schedule_for_member_v1(
        candidates,
        &batch,
        instrument,
        &declared,
        batch.time_evidence().event_effective.value,
    )
    .expect("the declaration selects the schedule it minted");
    let fact = selected.fact();
    let zero = BindingDigest::from_untrusted_bytes([0; 32]);

    assert_eq!(fact.digest(), committed.fact_digest());
    assert_eq!(
        committed.schedule(),
        &selected,
        "the answer is the schedule the read selects"
    );
    assert_eq!(
        native_bar_type_for_schedule_v1(
            committed.schedule().fact(),
            InstrumentId::from(instrument)
        )
        .map(|bar| bar.to_string()),
        Ok(format!("{instrument}-1-MINUTE-LAST-EXTERNAL"))
    );
    assert_eq!(fact.kind(), BarScheduleKindV1::FixedInterval);
    assert_eq!(fact.unit(), BarScheduleUnitV1::Minute);
    assert_eq!(fact.step(), 1);
    assert_eq!(
        fact.anchor_identity(),
        anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch)
    );
    assert_eq!(fact.clock(), BarScheduleClockV1::Continuous);
    assert_eq!(fact.calendar_identity(), zero);
    assert_eq!(fact.session_identity(), zero);
    assert_ne!(fact.time_zone_identity(), zero);
    assert_eq!(fact.label(), BarScheduleLabelV1::IntervalClose);
    assert_eq!(fact.completion(), BarScheduleCompletionV1::CompleteOnly);
}

/// Without a declaration for the role's rows there is no bar to schedule, and the proposer says
/// which declaration is missing rather than deriving a shape from the label.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_no_schedule_is_proposed_for_rows_their_binding_does_not_declare() {
    // A schema-1 binding declares no bar at all.
    let (owner, undeclared) = owner_with(source_proposal(10, 40), "MSFT").await;
    let pit = Box::pin(declared_snapshot_of(&owner, &undeclared, "MSFT", 140)).await;
    let before = schedule_rows(&owner).await;
    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(
            &owner,
            pit.receipt().locator(),
            d(151),
            d(152)
        ))
        .await,
        Err(BarScheduleAcceptanceErrorV1::SourceBindingDeclaresNoBarTimeframe)
    );

    // A binding that declares its hour bars, not the minute rows the role reads.
    let hour_only = declaring_bars_v1(
        source_proposal(10, 40),
        vec![session_bar_v1(
            "1H",
            UntrustedSourceBarCadenceV1::FixedInterval {
                step: 1,
                unit: UntrustedSourceBarUnitV1::Hour,
            },
        )],
    );
    let (owner, hours) = owner_with(hour_only, "NVDA").await;
    let pit = Box::pin(declared_snapshot_of(&owner, &hours, "NVDA", 160)).await;
    assert_eq!(
        Box::pin(commit_bar_schedule_on_v1(
            &owner,
            pit.receipt().locator(),
            d(171),
            d(172)
        ))
        .await,
        Err(BarScheduleAcceptanceErrorV1::TimeframeNotDeclared)
    );
    assert_eq!(
        schedule_rows(&owner).await,
        before,
        "no refusal writes a schedule"
    );
}
