//! The sealed acceptance BAR schedule proposer, over snapshots the production intake minted.

use std::{collections::BTreeSet, env};

use super::{
    MarketDataOwnerPostgres, OwnerSourceBindingDecision,
    bar_schedule_acceptance_v1::{BarScheduleAcceptanceErrorV1, commit_bar_schedule_on_v1},
    load_bar_schedule_candidates,
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
    native_replay_scheduling_v1::schedule_bar_specification_at_frame_v1,
    pit_snapshot::PitSnapshotCommitAggregate,
    source_binding::authority::{
        SourceBindingCommit, derive_market_semantics_compatibility_identity_v1,
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
    },
};

async fn owner_with_binding() -> (MarketDataOwnerPostgres, SourceBindingCommit) {
    let owner =
        MarketDataOwnerPostgres::connect(&env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
    let binding = owner
        .commit_source_initial(
            source_proposal(10, 40),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock(40, 1),
        )
        .await
        .unwrap();
    owner
        .admit_instrument_master_fact_v1(oracle_instrument_submission_v1(
            "AAPL",
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
    let universe = Box::pin(one_member_universe_v1(owner, binding, "AAPL", 20)).await;
    let pit = Box::pin(research_request_pit_v1(
        owner, binding, "AAPL", &universe, 20,
    ))
    .await;
    assert_eq!(
        Box::pin(admit_market_semantics_v1(owner, binding, &pit, "RAW")).await,
        Ok(())
    );
    assert_eq!(
        Box::pin(declare_close_role_v1(owner, &pit, "AAPL", 30)).await,
        Ok(())
    );
    assert_eq!(
        Box::pin(declare_close_role_v1(owner, &pit, "AAPL", 60)).await,
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

    // A second call rejoins it and writes nothing.
    let again = Box::pin(commit_bar_schedule_on_v1(&owner, &locator, d(31), d(32)))
        .await
        .unwrap();
    assert!(again.rejoined());
    assert_eq!(again.fact_digest(), committed.fact_digest());
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
