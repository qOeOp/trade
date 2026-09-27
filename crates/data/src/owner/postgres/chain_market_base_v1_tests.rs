//! The chain's Market Data acceptance basis, proven on a fresh store: written once, rejoined
//! without a write or a moved pointer, refused by name when the store diverges from it or its
//! clock has moved past it, and rejoined over the base the replay composition entry writes.

use std::{collections::BTreeSet, env};

use sqlx::PgPool;

use super::{
    MarketDataOwnerPostgres, OwnerSourceBindingDecision,
    acceptance_fixture_v1::{d, instrument_fact, instrument_request, source_proposal},
    chain_market_base_v1::{
        CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1, MarketDataAcceptanceBasisErrorV1,
        MarketDataAcceptanceBasisPointerV1, chain_market_base_clock_v1,
        chain_market_base_historical_clock_v1, chain_market_base_records_on_v1,
        chain_market_base_source_proposal_v1, commit_market_base_corpus_v1,
        ensure_chain_market_base_on_v1, ensure_market_data_acceptance_basis_v1, owner_clock_at_v1,
    },
    tests::{clock, replay_composition_market_base_fixture_v1},
    universe_selection::persist_historical_membership_frontier_v1,
};
use crate::owner::{
    chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1,
    instrument_master::{InstrumentMasterResolver, InstrumentMasterScopeV1},
    source_binding::authority::{derive_binding_id, derive_time_evidence_identity},
    universe_selection::authority::HistoricalMembershipFactProposalV1,
};

fn owner_url() -> String {
    env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap()
}

/// Every Owner record the basis writes, and the two pointers it moves.
#[derive(Debug, Eq, PartialEq)]
struct StoreStateV1 {
    rows: Vec<i64>,
    clock_head_cut: Option<i64>,
    eligible_frontier: Option<Vec<u8>>,
}

async fn store_state_v1(pool: &PgPool) -> StoreStateV1 {
    let row = sqlx::query(
        "SELECT ARRAY[(SELECT count(*) FROM market_data_private.source_binding_facts_v1),(SELECT count(*) FROM market_data_private.clock_handoffs_v1),(SELECT count(*) FROM market_data_private.instrument_master_facts_v1),(SELECT count(*) FROM market_data_private.instrument_master_cuts_v1),(SELECT count(*) FROM market_data_private.historical_membership_frontiers_v1),(SELECT count(*) FROM market_data_private.universe_selection_records_v1),(SELECT count(*) FROM market_data_private.pit_snapshot_facts_v1),(SELECT count(*) FROM market_data_private.reference_fact_r0_records_v1),(SELECT count(*) FROM market_data_private.market_semantics_registry_v1),(SELECT count(*) FROM market_data_private.market_semantics_facts_v1)]",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let rows: Vec<i64> = sqlx::Row::get(&row, 0);
    StoreStateV1 {
        rows,
        clock_head_cut: sqlx::query_scalar(
            "SELECT decision_cut FROM market_data_private.clock_head_v1 WHERE singleton",
        )
        .fetch_optional(pool)
        .await
        .unwrap(),
        eligible_frontier: sqlx::query_scalar(
            "SELECT market_data_private.current_eligible_frontier_v1()",
        )
        .fetch_one(pool)
        .await
        .unwrap(),
    }
}

/// Admits a second eligible frontier holding the chain's instrument, as another writer would.
async fn admit_another_frontier_v1(pool: &PgPool, frontier: u8) {
    let source = derive_binding_id(&chain_market_base_source_proposal_v1(
        &chain_market_base_historical_clock_v1(),
    ));
    let mut transaction = pool.begin().await.unwrap();
    persist_historical_membership_frontier_v1(
        &mut transaction,
        d(frontier),
        vec![HistoricalMembershipFactProposalV1 {
            member_key: CHAIN_FIXTURE_INSTRUMENT_V1.as_bytes().to_vec(),
            instrument: CHAIN_FIXTURE_INSTRUMENT_V1.as_bytes().to_vec(),
            predecessor_identity: None,
            // A fact of its own: the base's membership fact, stated for a second frontier, is a
            // caller conflict.
            effective_from_ns: 2,
            effective_until_ns: None,
            provider_available_ns: 90,
            retrieval_ns: 92,
            correction_publication_ns: 91,
            owner_observation_ns: 99,
            decision_cut: 100,
            source_binding_lineage_root: source,
            correction_frontier_digest: d(86),
        }],
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn the_acceptance_basis_is_written_once_and_rejoined_without_moving_a_pointer() {
    let owner_url = owner_url();
    let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let empty = store_state_v1(owner.pool()).await;
    assert_eq!(empty.clock_head_cut, None, "the store starts with no clock");

    let basis =
        ensure_market_data_acceptance_basis_v1(&owner_url, CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1)
            .await
            .unwrap();
    let written = store_state_v1(owner.pool()).await;
    assert_ne!(written, empty, "a fresh store is written");
    assert_eq!(written.clock_head_cut, Some(100));
    assert_eq!(written.eligible_frontier, Some(d(170).as_bytes().to_vec()));
    assert_eq!(basis.decision_cut().decision_cut, 100);
    assert_eq!(basis.instrument(), CHAIN_FIXTURE_INSTRUMENT_V1);

    for pointer in [
        MarketDataAcceptanceBasisPointerV1::ClockHead,
        MarketDataAcceptanceBasisPointerV1::EligibleFrontier,
    ] {
        assert_eq!(
            basis.require_current_on_v1(owner.pool(), pointer).await,
            Ok(())
        );
    }

    // A second ensure rejoins: the same basis, and no row or pointer changes.
    assert_eq!(
        ensure_market_data_acceptance_basis_v1(&owner_url, CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1)
            .await,
        Ok(basis.clone())
    );
    assert_eq!(store_state_v1(owner.pool()).await, written);

    // Another writer moves the eligible frontier. The basis says so by name, and a later ensure
    // still rejoins without pulling the pointer back.
    admit_another_frontier_v1(owner.pool(), 99).await;
    let moved = store_state_v1(owner.pool()).await;
    assert_eq!(moved.eligible_frontier, Some(d(99).as_bytes().to_vec()));
    assert_eq!(
        basis
            .require_current_on_v1(
                owner.pool(),
                MarketDataAcceptanceBasisPointerV1::EligibleFrontier
            )
            .await,
        Err(MarketDataAcceptanceBasisErrorV1::NotCurrent(
            MarketDataAcceptanceBasisPointerV1::EligibleFrontier
        ))
    );
    assert_eq!(
        basis
            .require_current_on_v1(owner.pool(), MarketDataAcceptanceBasisPointerV1::ClockHead)
            .await,
        Ok(())
    );
    assert_eq!(
        ensure_chain_market_base_on_v1(&owner).await,
        Ok(basis.clone())
    );
    assert_eq!(store_state_v1(owner.pool()).await, moved);

    // The Owner's own clock reaches the basis's valid-through, as a cut minted from the wall clock
    // after the base does: the basis has expired, and is not written again.
    let head = {
        let mut transaction = owner.pool().begin().await.unwrap();
        let head = super::load_current_clock_fact_for_update(&mut transaction)
            .await
            .unwrap()
            .unwrap();
        transaction.rollback().await.unwrap();
        head
    };
    owner
        .commit_clock_successor(
            &head.handoff,
            &owner_clock_at_v1(3, chain_market_base_clock_v1().valid_through),
        )
        .await
        .unwrap();
    let expired = store_state_v1(owner.pool()).await;
    assert_eq!(
        ensure_chain_market_base_on_v1(&owner).await,
        Err(MarketDataAcceptanceBasisErrorV1::Expired {
            valid_through: chain_market_base_clock_v1().valid_through
        })
    );
    assert_eq!(store_state_v1(owner.pool()).await, expired);
    assert_eq!(
        basis
            .require_current_on_v1(owner.pool(), MarketDataAcceptanceBasisPointerV1::ClockHead)
            .await,
        Err(MarketDataAcceptanceBasisErrorV1::NotCurrent(
            MarketDataAcceptanceBasisPointerV1::ClockHead
        ))
    );
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn a_store_on_another_clock_refuses_the_basis_at_its_source_binding() {
    let owner = MarketDataOwnerPostgres::connect(&owner_url())
        .await
        .unwrap();
    let other_clock = clock(99, 1);
    owner
        .commit_source_initial(
            source_proposal(10, 99),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &other_clock,
        )
        .await
        .unwrap();
    let before = store_state_v1(owner.pool()).await;
    assert_eq!(
        ensure_chain_market_base_on_v1(&owner).await,
        Err(MarketDataAcceptanceBasisErrorV1::Diverged {
            step: "source_binding"
        })
    );
    assert_eq!(
        store_state_v1(owner.pool()).await,
        before,
        "nothing is written"
    );
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn a_base_snapshot_over_another_source_binding_is_refused_on_rejoin() {
    let owner = MarketDataOwnerPostgres::connect(&owner_url())
        .await
        .unwrap();
    let historical = chain_market_base_historical_clock_v1();
    let base_clock = chain_market_base_clock_v1();
    // The base's clocks and correlation, over a Source Binding the basis does not name.
    let mut foreign = chain_market_base_source_proposal_v1(&historical);
    foreign.adapter.dataset_mapping = "dataset/foreign".into();
    foreign.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&foreign.time_evidence);
    foreign.claimed_binding_id = derive_binding_id(&foreign);
    let source = owner
        .commit_source_initial(
            foreign,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &historical,
        )
        .await
        .unwrap();
    let head = {
        let mut transaction = owner.pool().begin().await.unwrap();
        let head = super::load_current_clock_fact_for_update(&mut transaction)
            .await
            .unwrap()
            .unwrap();
        transaction.rollback().await.unwrap();
        head
    };
    let successor = owner
        .commit_clock_successor(&head.handoff, &base_clock)
        .await
        .unwrap();
    owner
        .append_instrument_master_fact(
            instrument_fact(CHAIN_FIXTURE_INSTRUMENT_V1, None, 86),
            successor.handoff().locator(),
        )
        .await
        .unwrap();
    let instrument = owner
        .resolve_instrument_master(
            &instrument_request(
                110,
                InstrumentMasterScopeV1::ExactInstrument(CHAIN_FIXTURE_INSTRUMENT_V1.into()),
                successor.handoff().locator().clone(),
            ),
            None,
        )
        .await
        .unwrap();
    commit_market_base_corpus_v1(&owner, &source, &instrument, &base_clock)
        .await
        .unwrap();
    let before = store_state_v1(owner.pool()).await;
    assert_eq!(
        ensure_chain_market_base_on_v1(&owner).await,
        Err(MarketDataAcceptanceBasisErrorV1::Diverged {
            step: "pit_snapshot"
        })
    );
    assert_eq!(
        store_state_v1(owner.pool()).await,
        before,
        "nothing is written"
    );
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn the_basis_rejoins_the_base_the_replay_composition_entry_writes() {
    let owner_url = owner_url();
    let base = Box::pin(replay_composition_market_base_fixture_v1(&owner_url)).await;
    let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let before = store_state_v1(owner.pool()).await;
    let basis = ensure_chain_market_base_on_v1(&owner).await.unwrap();
    assert_eq!(
        store_state_v1(owner.pool()).await,
        before,
        "the entry's base is rejoined"
    );
    assert_eq!(basis.pit(), base.pit.receipt().locator());
    assert_eq!(basis.source_binding(), base.source.receipt().locator());
    assert_eq!(
        basis.market_semantics().request_identity(),
        base.semantics.receipt().request_identity
    );
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn the_base_records_are_the_same_written_or_rejoined() {
    let owner = MarketDataOwnerPostgres::connect(&owner_url())
        .await
        .unwrap();
    let written = chain_market_base_records_on_v1(&owner).await.unwrap();
    let state = store_state_v1(owner.pool()).await;
    let rejoined = chain_market_base_records_on_v1(&owner).await.unwrap();
    assert_eq!(
        store_state_v1(owner.pool()).await,
        state,
        "a rejoin writes nothing"
    );
    assert_eq!(rejoined.pit, written.pit);
    assert_eq!(rejoined.batch, written.batch);
    assert_eq!(
        rejoined.instrument.canonical_bytes(),
        written.instrument.canonical_bytes()
    );
}
