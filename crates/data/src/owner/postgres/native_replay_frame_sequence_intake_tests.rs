//! Frames after the first, each minted through the production PIT intake, resolved one by one
//! through the single-frame read the first frame takes, on real PostgreSQL.
//!
//! This is T1's first probe, and its prediction was written before it ran: a request built for a
//! census row passes the read's own checks, because nothing in it says "the first frame"; the
//! second frame first stops at `NoBarScheduleAtFrame`, because a schedule is cut at one frame's
//! instant and serves no other (`schedule_is_at_frame_v1`); and once its own schedule is in custody,
//! it resolves at its own instant.
//!
//! The member is one crypto perpetual, as U1's is. Each frame is a BAR snapshot at its own instant,
//! and each has a QUOTE-only quote cut one instant later and before the next frame, both taken
//! through the intake under the Source Binding that declares the bar. Schedules are put in custody
//! by the stand-in for the production proposer that does not exist yet (E1).

use std::sync::Arc;

use rstest::rstest;

use super::{
    acceptance_fixture_v1::{declaring_bars_v1, session_bar_v1},
    native_replay_quote_cut_intake_tests::EveryMemberQuoteSourceV1,
    pit_intake_member_count_tests::{
        CLOCK_EPOCH, CLOCK_IDENTITY, DECISION_CUT, Fixture, clock, d, source_proposal,
    },
    *,
};
use crate::owner::{
    native_replay_scheduling_v1::{
        NativeReplayInitialMarketRequestV1, NativeReplayInitialUniverseRoleV1,
        NativeReplaySchedulingErrorV1,
    },
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::{
        PitSnapshotSubmissionV1, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::{
        UntrustedSourceBarCadenceV1, UntrustedSourceBarUnitV1,
        authority::derive_market_semantics_compatibility_identity_v1,
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
        derive_universe_selection,
    },
    universe_selection::UniverseSelectionReadbackV1,
};

const INSTRUMENT: &str = "BTCUSDT-PERP.BINANCE";

/// A Data Client that answers one complete minute bar for every member, priced by its instant, so
/// every frame holds the bar a native schedule seals and no two frames hold the same one.
struct EveryMemberBarSourceV1;

#[async_trait::async_trait]
impl PitObservationSourceV1 for EveryMemberBarSourceV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        // A mantissa never ends in 0 at a nonzero scale: the Owner admits only normalized decimals.
        let base = 10_001 + i128::from(scope.event_effective());
        let mut rows = scope
            .members()
            .iter()
            .flat_map(|member| {
                [
                    ("OPEN", base, 2),
                    ("HIGH", base + 5, 2),
                    ("LOW", base - 5, 2),
                    ("CLOSE", base + 1, 2),
                    ("VOLUME", 1_000, 0),
                ]
                .map(|(field, value_mantissa, value_scale)| VendorObservationV1 {
                    symbolic_key: format!("{member}.{field}.1M"),
                    member_key: member.clone(),
                    instrument: member.clone(),
                    channel: "MARKET".into(),
                    data_kind: "BAR".into(),
                    timeframe: "1M".into(),
                    field: field.into(),
                    value_mantissa,
                    value_scale,
                    event_effective: scope.event_effective(),
                    provider_available: scope.provider_available(),
                    retrieval: scope.retrieval(),
                    correction_publication: scope.correction_publication(),
                })
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
        });
        Ok(rows)
    }
}

/// Time evidence at `event`, every later coordinate one step after the one before, frozen at the
/// Owner's cut.
fn time_at(event: u64) -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            event,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            event + 1,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            event + 2,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        )),
        retrieval: UntrustedRetrievalTime::from_untrusted(event + 3, CLOCK_IDENTITY, CLOCK_EPOCH),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            DECISION_CUT,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        monotonic_sequence: 1,
        restart_continuity_digest: d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: DECISION_CUT,
        valid_through: DECISION_CUT + 60,
    }
}

fn request(
    fixture: &Fixture,
    correlation: u8,
    universe: &UniverseSelectionReadbackV1,
    event: u64,
) -> PitSnapshotSubmissionV1 {
    PitSnapshotSubmissionV1 {
        correlation_identity: d(correlation),
        requester_identity: d(204),
        scope_digest: d(241),
        source_binding: fixture.source.receipt().locator().clone(),
        universe_selection_digest: universe.record().identity(),
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &fixture.source.fact().proposal().semantics,
        ),
        time_evidence: time_at(event),
    }
}

async fn scenario() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    // The source declares the minute bar its rows carry, so a schedule can be derived for a frame.
    let source = owner
        .commit_source_initial(
            declaring_bars_v1(
                source_proposal(),
                vec![session_bar_v1(
                    "1M",
                    UntrustedSourceBarCadenceV1::FixedInterval {
                        step: 1,
                        unit: UntrustedSourceBarUnitV1::Minute,
                    },
                )],
            ),
            OwnerSourceBindingDecision {
                blockers: std::collections::BTreeSet::new(),
            },
            &clock(),
        )
        .await
        .expect("the bar-declaring Source Binding is admitted");
    let fixture = Fixture {
        intake: MarketDataPitIntakePostgresV1 {
            owner,
            observations: Arc::new(EveryMemberBarSourceV1),
        },
        source,
    };
    let quotes = MarketDataPitIntakePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("the quote cuts' intake connects"),
        observations: Arc::new(EveryMemberQuoteSourceV1),
    };
    fixture
        .admit_crypto_perpetual(INSTRUMENT, "BTCUSDT", (1, 2))
        .await;
    let (universe, locator) = fixture
        .universe(160, &[0, 1, 1], &[(INSTRUMENT, INSTRUMENT)])
        .await;

    let frame = async |correlation: u8, event: u64| {
        let terminal = fixture
            .intake
            .submit(request(&fixture, correlation, &universe, event), locator)
            .await
            .expect("the frame's intake answers");
        assert_eq!(
            terminal.disposition(),
            PitMarketSnapshotDispositionV1::Available
        );
        (terminal.snapshot_identity(), terminal.fact_digest())
    };
    let quote_cut = async |correlation: u8, event: u64| {
        let terminal = quotes
            .submit(request(&fixture, correlation, &universe, event), locator)
            .await
            .expect("the quote cut's intake answers");
        assert_eq!(
            terminal.disposition(),
            PitMarketSnapshotDispositionV1::Available
        );
    };
    // Every row coordinate sits at or before the decision cut of 40: the last is `event + 3`.
    let first = frame(242, 10).await;
    quote_cut(243, 11).await;
    let second = frame(244, 20).await;
    quote_cut(245, 21).await;
    let third = frame(246, 30).await;
    quote_cut(247, 31).await;

    let owner = fixture.owner();
    let batch_of = async |(snapshot, fact): (BindingDigest, BindingDigest)| {
        super::load_verified_observation_batch_from_pool(owner.pool(), snapshot, fact)
            .await
            .expect("the Owner reads back the frame it admitted")
    };
    let role = NativeReplayInitialUniverseRoleV1::new(
        d(248),
        MarketDataFieldSemantic::BarClosePrice,
        StrategyInputChannel::Market,
        "1M".to_owned(),
        StrategyInputUnit::Price,
        2,
    );
    let resolve = async |batch: &VerifiedPitObservationBatch| {
        let selection = derive_universe_selection(batch).expect("a one-member universe binds");
        let frame_time_ns = batch.time_evidence().event_effective.value;
        super::resolve_native_replay_initial_market_from_pool_v1(
            owner.pool(),
            &NativeReplayInitialMarketRequestV1::new(
                batch.snapshot_identity(),
                batch.fact_digest(),
                d(249),
                d(250),
                selection.selection_identity(),
                selection.selection_digest(),
                batch.universe_selection_digest(),
                batch.universe_selection_digest(),
                batch.instrument_master_digest(),
                batch.source_binding_lineage_root(),
                batch.market_semantics_identity(),
                vec![role.clone()],
                vec![INSTRUMENT.into()],
                frame_time_ns,
                DECISION_CUT,
            ),
        )
        .await
        .map(|readback| {
            readback
                .into_execution_parts()
                .expect("a resolved frame splits into its universe frame and its scheduling")
                .1
                .frame_time_ns()
        })
    };
    let seed_schedule = async |frame: (BindingDigest, BindingDigest)| {
        let batch = batch_of(frame).await;
        let pit = {
            let mut transaction = owner.pool().begin().await.unwrap();
            let pit = super::load_pit(&mut transaction, frame.0, false, false)
                .await
                .unwrap()
                .expect("the frame's snapshot is in custody");
            transaction.rollback().await.unwrap();
            pit
        };
        let request = UntrustedStrategyInputBindingRequest {
            research_request_identity: d(249),
            strategy_design_identity: d(250),
            input_role_identity: d(248),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: INSTRUMENT.into(),
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
        super::bar_schedule_acceptance_v1::seed_bar_schedule_standing_in_for_e1(
            owner,
            pit.receipt().locator(),
            &request,
        )
        .await
        .expect("the stand-in puts the frame's schedule in custody")
    };
    let second_batch = batch_of(second).await;

    // Nothing in custody yet: the second frame has no schedule at its instant.
    assert_eq!(
        resolve(&second_batch).await,
        Err(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame)
    );
    // The first frame's schedule is cut at the first frame's instant and serves no other.
    seed_schedule(first).await;
    assert_eq!(
        resolve(&batch_of(first).await).await,
        Ok(10),
        "the first frame resolves once its schedule is in custody"
    );
    assert_eq!(
        resolve(&second_batch).await,
        Err(NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame),
        "the first frame's schedule does not serve the second"
    );
    // Its own schedule in custody, each later frame resolves at its own instant.
    seed_schedule(second).await;
    assert_eq!(resolve(&second_batch).await, Ok(20));
    seed_schedule(third).await;
    assert_eq!(resolve(&batch_of(third).await).await, Ok(30));
}

#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn a_frame_after_the_first_resolves_from_its_own_intake_minted_snapshot() {
    std::thread::Builder::new()
        .name("market-data-frame-sequence-intake".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(scenario());
        })
        .unwrap()
        .join()
        .unwrap();
}
