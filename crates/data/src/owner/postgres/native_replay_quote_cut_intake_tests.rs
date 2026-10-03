//! A frame and its quote cut, each minted through the production PIT intake, proved on real
//! PostgreSQL.
//!
//! Every other quote cut proof commits its snapshots directly, under one Instrument Master digest
//! the test writes into both proposals. The intake writes none of its own choosing: it resolves an
//! Instrument Master readback per request, sealed over the request's correlation, event instant and
//! decision cut, so a frame and a quote cut taken by two requests carry two digests even on the same
//! facts. This is the first proof that takes both through the intake.

use std::sync::{Arc, atomic::Ordering};

use rstest::rstest;

use super::{
    NATIVE_REPLAY_REQUEST_DIGEST_KEYS_FOR_TEST,
    pit_intake_member_count_tests::{
        CLOCK_EPOCH, CLOCK_IDENTITY, DECISION_CUT, Fixture, instrument_submission,
    },
    *,
};
use crate::owner::{
    native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2,
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::{
        PitSnapshotSubmissionV1, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::authority::derive_market_semantics_compatibility_identity_v1,
    universe_selection::UniverseSelectionReadbackV1,
};

/// A Data Client that answers one complete Quote for every member Market Data scoped.
pub(super) struct EveryMemberQuoteSourceV1;

#[async_trait::async_trait]
impl PitObservationSourceV1 for EveryMemberQuoteSourceV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let mut rows = scope
            .members()
            .iter()
            .flat_map(|member| {
                [
                    ("BID_PRICE", 12_344, 2),
                    ("ASK_PRICE", 12_346, 2),
                    ("BID_SIZE", 5, 0),
                    ("ASK_SIZE", 7, 0),
                ]
                .map(|(field, value_mantissa, value_scale)| VendorObservationV1 {
                    symbolic_key: format!("{member}.{field}.TICK"),
                    member_key: member.clone(),
                    instrument: member.clone(),
                    channel: "MARKET".into(),
                    data_kind: "QUOTE".into(),
                    timeframe: "TICK".into(),
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

/// Time evidence at `event`, frozen at the Owner's cut `cut` and its clock `sequence`.
fn time_at(event: u64, cut: u64, sequence: u64) -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            event,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            20,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(30, CLOCK_IDENTITY, CLOCK_EPOCH),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            25,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            cut,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        monotonic_sequence: sequence,
        restart_continuity_digest: pit_intake_member_count_tests::d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: cut,
        valid_through: cut + 60,
    }
}

/// One frozen request in `scope` over `universe`, at `time`.
fn request(
    fixture: &Fixture,
    correlation: u8,
    scope: u8,
    universe: &UniverseSelectionReadbackV1,
    time: UntrustedPitSnapshotTimeEvidence,
) -> PitSnapshotSubmissionV1 {
    PitSnapshotSubmissionV1 {
        correlation_identity: pit_intake_member_count_tests::d(correlation),
        requester_identity: pit_intake_member_count_tests::d(204),
        scope_digest: pit_intake_member_count_tests::d(scope),
        source_binding: fixture.source.receipt().locator().clone(),
        universe_selection_digest: universe.record().identity(),
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &fixture.source.fact().proposal().semantics,
        ),
        time_evidence: time,
    }
}

/// The census key a frame or a quote cut row holds.
async fn census_key(
    owner: &MarketDataOwnerPostgres,
    table: &str,
    snapshot: BindingDigest,
) -> Vec<u8> {
    let query = match table {
        "frame" => {
            "SELECT instrument_master_key FROM market_data_private.native_replay_frame_census_v2 WHERE snapshot_identity=$1"
        }
        "quote cut" => {
            "SELECT instrument_master_key FROM market_data_private.native_replay_quote_cut_census_v2 WHERE snapshot_identity=$1"
        }
        other => panic!("no census {other}"),
    };
    sqlx::query_scalar(query)
        .bind(snapshot.as_bytes().as_slice())
        .fetch_one(owner.pool())
        .await
        .expect("the census holds the snapshot with a key")
}

async fn scenario() {
    let fixture = Fixture::install().await;
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let quotes = MarketDataPitIntakePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("the quote cut's intake connects"),
        observations: Arc::new(EveryMemberQuoteSourceV1),
    };
    let lifecycle = pit_intake_member_count_tests::d(81);
    fixture.admit_instrument("AAPL", lifecycle).await;
    let msft = fixture
        .owner()
        .admit_instrument_master_fact_v1(instrument_submission("MSFT", &fixture.source, lifecycle))
        .await
        .expect("MSFT's first fact is admitted");
    let every_member = [0, 1, 1];
    let (aapl_universe, aapl_locator) = fixture
        .universe(140, &every_member, &[("AAPL", "AAPL")])
        .await;
    let (msft_universe, msft_locator) = fixture
        .universe(150, &every_member, &[("MSFT", "MSFT")])
        .await;
    let request_digest_keys = NATIVE_REPLAY_REQUEST_DIGEST_KEYS_FOR_TEST.load(Ordering::Relaxed);

    // Each frame is taken at the first cut, under the facts admitted so far.
    let frame_at_the_first_cut = async |correlation, scope, universe, locator| {
        let terminal = fixture
            .intake
            .submit(
                request(
                    &fixture,
                    correlation,
                    scope,
                    universe,
                    time_at(10, DECISION_CUT, 1),
                ),
                locator,
            )
            .await
            .expect("the frame's intake answers");
        assert_eq!(
            terminal.disposition(),
            PitMarketSnapshotDispositionV1::Available
        );
        (terminal.snapshot_identity(), terminal.fact_digest())
    };
    let aapl_frame = frame_at_the_first_cut(230, 206, &aapl_universe, aapl_locator).await;
    let msft_frame = frame_at_the_first_cut(231, 207, &msft_universe, msft_locator).await;

    // MSFT's terms change from instant 11, between its frame at 10 and its quote cut at 12.
    let mut successor = instrument_submission("MSFT", &fixture.source, lifecycle);
    successor.predecessor_fact_digest = Some(msft.fact_digest());
    successor.effective_from = 11;
    successor.price_increment.scale = 3;
    fixture
        .owner()
        .admit_instrument_master_fact_v1(successor)
        .await
        .expect("MSFT's successor fact is admitted");

    // Each quote cut is taken through the intake after the clock moved past both frames.
    fixture.advance_clock().await;
    let quote_cut_at_the_second_cut = async |correlation, scope, universe, locator| {
        let terminal = quotes
            .submit(
                request(
                    &fixture,
                    correlation,
                    scope,
                    universe,
                    time_at(12, DECISION_CUT + 5, 2),
                ),
                locator,
            )
            .await
            .expect("the quote cut's intake answers");
        assert_eq!(
            terminal.disposition(),
            PitMarketSnapshotDispositionV1::Available
        );
        terminal.snapshot_identity()
    };
    let aapl_quote_cut = quote_cut_at_the_second_cut(232, 206, &aapl_universe, aapl_locator).await;
    let msft_quote_cut = quote_cut_at_the_second_cut(233, 207, &msft_universe, msft_locator).await;

    assert_eq!(
        NATIVE_REPLAY_REQUEST_DIGEST_KEYS_FOR_TEST.load(Ordering::Relaxed),
        request_digest_keys,
        "no intake commit keys its census row by its request's digest"
    );
    let verified = async |(snapshot, fact): (BindingDigest, BindingDigest)| {
        super::load_verified_observation_batch_from_pool(fixture.owner().pool(), snapshot, fact)
            .await
            .expect("the Owner reads back what it admitted")
    };
    let aapl_frame_batch = verified(aapl_frame).await;
    let msft_frame_batch = verified(msft_frame).await;
    let owner = fixture.owner();

    // Same facts, two requests: two readback digests, one key, and the frame takes its quote cut.
    let aapl_quote_cut_batch = owner
        .resolve_native_replay_quote_cut_v2(&aapl_frame_batch, 1_000)
        .await
        .expect("the frame takes the quote cut its intake minted on the same facts");
    assert_eq!(aapl_quote_cut_batch.snapshot_identity(), aapl_quote_cut);
    assert_ne!(
        aapl_quote_cut_batch.instrument_master_digest(),
        aapl_frame_batch.instrument_master_digest(),
        "two intake requests resolve two Instrument Master readbacks"
    );
    assert_eq!(
        census_key(owner, "quote cut", aapl_quote_cut).await,
        census_key(owner, "frame", aapl_frame.0).await
    );

    // Another fact for the member: another key, and the frame has no quote cut.
    assert_ne!(
        census_key(owner, "quote cut", msft_quote_cut).await,
        census_key(owner, "frame", msft_frame.0).await
    );
    assert_eq!(
        owner
            .resolve_native_replay_quote_cut_v2(&msft_frame_batch, 1_000)
            .await
            .map(|batch| batch.snapshot_identity()),
        Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing),
        "a quote cut on other Instrument Master facts is not the frame's"
    );
}

#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn an_intake_minted_frame_takes_the_quote_cut_its_intake_minted_on_the_same_facts() {
    std::thread::Builder::new()
        .name("market-data-quote-cut-intake".into())
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
