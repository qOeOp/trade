//! The two reads a caller makes before it acts on a new snapshot, proven over custody the production
//! paths wrote: a snapshot minted from a frozen request, and a Market Semantics fact the admission
//! appended for it.

use std::collections::BTreeSet;

use sqlx::PgPool;

use super::{
    MarketDataOwnerPostgres, OwnerSourceBindingDecision,
    replay_market_facts_v2::universe_issuance::postgres_tests::{issue_under, role_set},
    strategy_input_binding_registry::{
        load_owner_verified_pit_batch_v1, register_strategy_input_binding_declaration_v1,
    },
    tests::{
        admit_market_semantics_v1, clock, d, market_semantics_value_v1, one_member_universe_v1,
        oracle_instrument_submission_v1, research_request_pit_v1, source_proposal,
    },
    universe_member_composition_basis_v1::{
        resolve_market_semantics_scope_value_v1, resolve_universe_member_composition_basis_v1,
    },
};
use crate::owner::{
    market_semantics_admission_v1::{
        MarketSemanticsScopeValueErrorV1, MarketSemanticsScopeValueV1,
    },
    pit_snapshot::{PitSnapshotCommitAggregate, UntrustedPitSnapshotLocator},
    replay_market_facts_v2::{
        ReplayCompositionLocatorOnlyIssuanceRequestV1, ReplayCompositionOwnerV1,
        ReplayCompositionUniverseBindingIssuanceRequestV1,
    },
    source_binding::{
        UntrustedSourceBindingLocator,
        authority::{
            derive_binding_id, derive_market_semantics_compatibility_identity_v1,
            derive_time_evidence_identity,
        },
    },
    strategy_design_role_set::StrategyDesignRoleSetLocatorV1,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
        derive_universe_selection,
    },
    universe_member_composition_basis_v1::{
        UniverseMemberCompositionBasisErrorV1, UniverseMemberCompositionBasisV1,
    },
};

/// Row, table and advisory locks this backend holds beyond the plain read locks every `SELECT`
/// takes: what a `FOR SHARE`, a writer or an advisory lock would leave in the transaction.
const HELD_LOCKS: &str = "SELECT COUNT(*) FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid() AND (locktype IN ('advisory','tuple') OR (locktype='relation' AND mode<>'AccessShareLock'))";

/// A transaction that can neither write nor take a row lock: `FOR SHARE` in it is refused.
async fn read_only(pool: &PgPool) -> sqlx::Transaction<'static, sqlx::Postgres> {
    pool.begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .unwrap()
}

/// The basis, read in a read-only transaction that is then shown to hold no lock.
async fn basis(
    pool: &PgPool,
    pit: &UntrustedPitSnapshotLocator,
    source: &UntrustedSourceBindingLocator,
) -> Result<UniverseMemberCompositionBasisV1, UniverseMemberCompositionBasisErrorV1> {
    let mut transaction = read_only(pool).await;
    let basis = resolve_universe_member_composition_basis_v1(&mut transaction, pit, source).await;
    let held: i64 = sqlx::query_scalar(HELD_LOCKS)
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(
        held, 0,
        "the basis read holds no row, table or advisory lock"
    );
    transaction.rollback().await.unwrap();
    basis
}

/// The scope value, read the same way.
async fn scope_value(
    pool: &PgPool,
    source: &UntrustedSourceBindingLocator,
) -> Result<MarketSemanticsScopeValueV1, MarketSemanticsScopeValueErrorV1> {
    let mut transaction = read_only(pool).await;
    let value = resolve_market_semantics_scope_value_v1(&mut transaction, source).await;
    let held: i64 = sqlx::query_scalar(HELD_LOCKS)
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(
        held, 0,
        "the scope value read holds no row, table or advisory lock"
    );
    transaction.rollback().await.unwrap();
    value
}

/// Declares one universe-member close role against `pit`'s own verified batch, as a published
/// Design's role would be declared.
async fn declare_universe_role(
    pool: &PgPool,
    pit: &PitSnapshotCommitAggregate,
) -> UntrustedStrategyInputBindingRequest {
    let mut transaction = pool.begin().await.unwrap();
    let batch = load_owner_verified_pit_batch_v1(&mut transaction, pit.fact().snapshot_identity())
        .await
        .unwrap();
    let request = UntrustedStrategyInputBindingRequest {
        research_request_identity: d(150),
        strategy_design_identity: d(151),
        input_role_identity: d(152),
        scope: UntrustedStrategyInputScope::UniverseSelection {
            selection_identity: derive_universe_selection(&batch)
                .expect("the snapshot answers a one-member universe")
                .selection_identity(),
        },
        field_semantic: MarketDataFieldSemantic::BarClosePrice,
        channel: StrategyInputChannel::Market,
        timeframe: "1M".into(),
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
    };
    register_strategy_input_binding_declaration_v1(&mut transaction, &request)
        .await
        .expect("the universe-member role declares against the admitted fact");
    transaction.commit().await.unwrap();
    request
}

/// What a universe-member composition over a snapshot is composed from is read back, not rebuilt,
/// and the issuance accepts exactly what was read; the scope's value is read the same way.
///
/// Every record comes from a production path: the Source Binding and the Instrument Master fact are
/// admitted, the snapshot is minted from a frozen request (its commit appends the Owner's R0
/// record), and its Market Semantics fact is the admission's. Each read runs in a read-only
/// transaction, so it can write nothing and take no row lock, and each is then shown to hold no lock
/// at all.
///
/// - Before any fact is admitted for the snapshot, the basis is refused as
///   `MarketSemanticsNotAdmitted`, and the scope states no value.
/// - Once the admission has appended it, the scope states that value, word for word as it was
///   submitted, and the basis resolves.
/// - A second snapshot under the same binding reads as unadmitted while only the first has a fact,
///   and once admitted names its own fact and R0 record; the first's basis does not move.
/// - The issuance, given the snapshot, its binding and the four locators read here, issues.
/// - A snapshot Market Data does not hold is `PitUnavailable`; the same snapshot named with another
///   binding is `SourceBindingMismatch`; a binding Market Data does not hold has no scope value.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[allow(clippy::too_many_lines)]
async fn postgres_a_new_snapshot_reads_the_basis_its_universe_composition_issues_from() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let pool = owner.pool().clone();

    // The positive control of the lock probe: a read that takes `FOR SHARE` leaves locks behind.
    let decision = OwnerSourceBindingDecision {
        blockers: BTreeSet::new(),
    };
    let source = owner
        .commit_source_initial(source_proposal(10, 40), decision.clone(), &clock(40, 1))
        .await
        .unwrap();
    {
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("SELECT * FROM market_data_rd_api.lock_source_for_strategy_input_v1($1)")
            .bind(source.receipt().locator().binding_id.as_bytes().as_slice())
            .fetch_all(&mut *transaction)
            .await
            .unwrap();
        let held: i64 = sqlx::query_scalar(HELD_LOCKS)
            .fetch_one(&mut *transaction)
            .await
            .unwrap();
        assert!(held > 0, "the lock probe sees a FOR SHARE read's locks");
        transaction.rollback().await.unwrap();
    }

    let mut other_value = source_proposal(10, 40);
    other_value.semantics.normalization = "normalization-v2".into();
    other_value.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&other_value.time_evidence);
    other_value.claimed_binding_id = derive_binding_id(&other_value);
    let other = owner
        .commit_source_initial(other_value, decision, &clock(40, 1))
        .await
        .unwrap();
    let scope =
        derive_market_semantics_compatibility_identity_v1(&source.fact().proposal().semantics);
    owner
        .admit_instrument_master_fact_v1(oracle_instrument_submission_v1(
            "AAPL",
            source.receipt().locator(),
        ))
        .await
        .expect("the instrument's fact is admitted under the binding's scope");
    let universe = one_member_universe_v1(&owner, &source, "AAPL", 20).await;
    let pit = research_request_pit_v1(&owner, &source, "AAPL", &universe, 20).await;
    let pit_locator = pit.receipt().locator().clone();
    let source_locator = source.receipt().locator().clone();

    // Before the admission: no fact for the snapshot, no value in the scope.
    assert_eq!(
        basis(&pool, &pit_locator, &source_locator).await,
        Err(UniverseMemberCompositionBasisErrorV1::MarketSemanticsNotAdmitted)
    );
    let unstated = scope_value(&pool, &source_locator).await.unwrap();
    assert_eq!(unstated.compatibility_scope_identity(), scope);
    assert_eq!(unstated.value(), None);

    // After it: the scope states the submitted value, and the basis resolves.
    admit_market_semantics_v1(&owner, &source, &pit, "RAW")
        .await
        .expect("the admission appends the snapshot's fact");
    let stated = scope_value(&pool, &source_locator).await.unwrap();
    assert_eq!(stated.compatibility_scope_identity(), scope);
    assert_eq!(stated.value(), Some(&market_semantics_value_v1("RAW")));
    let resolved = basis(&pool, &pit_locator, &source_locator)
        .await
        .expect("the basis resolves once the fact is admitted");
    assert_eq!(
        (
            resolved.universe_selection_locator().request_identity(),
            resolved
                .universe_selection_locator()
                .request_meaning_digest(),
        ),
        (
            universe.0.request_identity(),
            universe.0.request_meaning_digest()
        ),
        "the Universe Selection is the one the snapshot was minted over"
    );

    // A second snapshot under the same binding: the scope now has a head, but not this snapshot's,
    // so its basis is still unadmitted; once admitted, it names its own fact and not the first's.
    let second = research_request_pit_v1(&owner, &source, "AAPL", &universe, 40).await;
    assert_eq!(
        basis(&pool, second.receipt().locator(), &source_locator).await,
        Err(UniverseMemberCompositionBasisErrorV1::MarketSemanticsNotAdmitted),
        "another snapshot's head in the scope is not this snapshot's fact"
    );
    admit_market_semantics_v1(&owner, &source, &second, "RAW")
        .await
        .expect("the admission appends the second snapshot's fact");
    let second_basis = basis(&pool, second.receipt().locator(), &source_locator)
        .await
        .expect("the second snapshot's basis resolves");
    assert_ne!(
        second_basis.market_semantics_locator(),
        resolved.market_semantics_locator(),
        "each snapshot's basis names its own Market Semantics fact"
    );
    assert_ne!(
        second_basis.reference_fact_r0_locator(),
        resolved.reference_fact_r0_locator(),
        "each snapshot's basis names its own R0 record"
    );
    assert_eq!(
        basis(&pool, &pit_locator, &source_locator).await,
        Ok(resolved),
        "the first snapshot's basis is unchanged by the second's fact"
    );

    // The issuance accepts exactly the four locators read. Its store is materialized by the same
    // production entry a deployment runs before custody cutover.
    ReplayCompositionOwnerV1::materialize_schema(&owner_url)
        .await
        .expect("the replay composition store materializes");
    let request = declare_universe_role(&pool, &pit).await;
    let locator = StrategyDesignRoleSetLocatorV1 {
        schema_version: 2,
        request_identity: "universe-member-composition-basis-v1".into(),
        operation_receipt_identity: d(0x61),
        artifact_locator: "artifact:universe-member-composition-basis-v1".into(),
        artifact_identity: d(0x62),
        canonical_plan_digest: d(0x63),
        design_digest: d(0x64),
    };
    let event = i128::from(pit.fact().request().time_evidence.event_effective.value);
    let command = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(
        d(0x65),
        ReplayCompositionUniverseBindingIssuanceRequestV1::from_test_fixture(
            locator.clone(),
            pit_locator.clone(),
            source_locator.clone(),
            event,
            event + 1,
            resolved.universe_selection_locator(),
            resolved.reference_fact_r0_locator(),
            resolved.market_semantics_locator(),
            resolved.correction_policy_locator(),
        ),
    )
    .unwrap();
    issue_under(
        &pool,
        &role_set(&locator, std::slice::from_ref(&request)),
        &command,
    )
    .await
    .expect("the universe-member composition issues from the basis read back");

    // Refusals, by name.
    let mut unknown = pit_locator.clone();
    unknown.snapshot_identity = d(0x66);
    assert_eq!(
        basis(&pool, &unknown, &source_locator).await,
        Err(UniverseMemberCompositionBasisErrorV1::PitUnavailable)
    );
    assert_eq!(
        basis(&pool, &pit_locator, other.receipt().locator()).await,
        Err(UniverseMemberCompositionBasisErrorV1::SourceBindingMismatch)
    );
    let mut absent = source_locator.clone();
    absent.binding_id = d(0x67);
    assert_eq!(
        scope_value(&pool, &absent).await,
        Err(MarketSemanticsScopeValueErrorV1::SourceBindingUnavailable)
    );
    assert_eq!(
        scope_value(&pool, other.receipt().locator())
            .await
            .unwrap()
            .value(),
        None,
        "the other binding's scope has no head, whatever the first scope states"
    );
}
