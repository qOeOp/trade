//! The sealed acceptance custody chain (slice T0-5d), proved on real PostgreSQL: committed through
//! the production intakes, then read through the frames port, which returns the chain's basis, and
//! through the custody frame resolver with T0-6's derived quote cut.

use super::{
    native_replay_custody_frame_v1::{
        resolve_custody_quote_cut_v1, resolve_native_replay_custody_frame_from_pool_v1,
    },
    native_replay_custody_frame_v1_tests::custody_request,
    pit_window_custody_v1_tests::owner,
    pit_window_view_v1_tests::run,
};
use crate::owner::pit_window_custody_v1::{
    PitObservationBatchSourceV1, PitWindowCustodyRefusalV1, QuoteDerivationV1,
    UntrustedPitWindowCustodyClaimV1, UntrustedPitWindowCustodyFrameV1,
    sealed_acceptance_chain::{
        SealedAcceptanceBarV1, SealedAcceptanceCustodyChainErrorV1,
        SealedAcceptanceCustodyChainSpecV1, SealedAcceptanceDecimalV1, SealedAcceptanceOhlcvV1,
        SealedAcceptanceTimeframeV1, commit_sealed_acceptance_custody_chain_v1,
    },
};

const SECOND: u64 = 1_000_000_000;
const MINUTE: u64 = 60 * SECOND;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;
/// The first execution bar opens on a UTC midnight in 2023.
const START: u64 = 19_700 * DAY;
const LAG: u64 = 2 * MINUTE;
const MEMBER: &str = "BTCUSDT-PERP.BINANCE";
const FRAMES: u64 = 5;

fn decimal(text: &str) -> SealedAcceptanceDecimalV1 {
    SealedAcceptanceDecimalV1::parse(text).expect("a decimal")
}

/// A bar on BTCUSDT's 0.10 tick whose four prices state one precision.
fn bar(open_ns: u64) -> SealedAcceptanceBarV1 {
    SealedAcceptanceBarV1 {
        open_ns,
        members: vec![SealedAcceptanceOhlcvV1 {
            open: decimal("65000.12"),
            high: decimal("65400.37"),
            low: decimal("64800.51"),
            close: decimal("65210.33"),
            volume: decimal("1234"),
        }],
    }
}

/// One member, five daily execution bars from `START`, and after each one's close the hourly fill
/// bar that opens at it.
fn spec() -> SealedAcceptanceCustodyChainSpecV1 {
    SealedAcceptanceCustodyChainSpecV1 {
        members: vec![MEMBER.to_owned()],
        execution_timeframe: SealedAcceptanceTimeframeV1 {
            label: "1D".to_owned(),
            interval_seconds: 86_400,
            bars: (0..FRAMES).map(|day| bar(START + day * DAY)).collect(),
        },
        fill_timeframe: SealedAcceptanceTimeframeV1 {
            label: "1H".to_owned(),
            interval_seconds: 3_600,
            bars: (1..=FRAMES).map(|day| bar(START + day * DAY)).collect(),
        },
        lag_ns: LAG,
        instrument_increments: None,
        market_semantics_value: None,
    }
}

fn owner_url() -> String {
    std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").expect("explicit disposable Owner URL")
}

/// The fixture's chain reads as five frames, each with its coordinates, from the frames port, whose
/// basis is the one the fixture's intakes answered; and each frame resolves through the custody
/// frame resolver with the quote cut T0-6 derives from the fill bar after its decision cut.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_the_sealed_acceptance_chain_reads_every_frame_with_its_derived_quote_cut() {
    let owner = owner().await;
    let chain = commit_sealed_acceptance_custody_chain_v1(&owner_url(), &spec())
        .await
        .expect("the production intakes commit the chain");
    let instants = (1..=FRAMES)
        .map(|day| START + day * DAY)
        .collect::<Vec<_>>();
    assert_eq!(chain.frame_instants_ns(), instants);
    assert_eq!(chain.window(), (START, START + (FRAMES + 1) * DAY));
    assert_eq!(
        chain.head_identity(),
        chain.chain_root(),
        "a root, no successor"
    );
    assert_eq!(chain.instrument_fact_digests().len(), 1);

    let run_end = chain.window().1;
    let read = owner
        .pit_window_custody_frames_v1()
        .resolve_pit_window_frames_v1(run(chain.chain_root(), START + DAY, run_end))
        .await
        .expect("every frame is covered");
    assert_eq!(read.head_identity(), chain.head_identity());
    assert_eq!(
        read.frames()
            .iter()
            .map(|frame| (frame.ordinal(), frame.event_ns(), frame.decision_cut_ns()))
            .collect::<Vec<_>>(),
        (1..=FRAMES)
            .zip(&instants)
            .map(|(ordinal, event)| (ordinal, *event, event + LAG))
            .collect::<Vec<_>>()
    );
    let basis = read.basis();
    assert_eq!(basis.chain_root(), chain.chain_root());
    assert_eq!(basis.universe_selection(), chain.universe_selection());
    assert_eq!(
        basis.market_semantics_identity(),
        chain.market_semantics_identity()
    );
    assert_eq!(
        basis.instrument_master_cut().digest(),
        chain.instrument_master_cut_digest()
    );
    assert_eq!(basis.members(), [MEMBER]);
    assert_eq!(basis.window(), chain.window());

    for coordinate in read.frames() {
        let frame = UntrustedPitWindowCustodyFrameV1 {
            custody: UntrustedPitWindowCustodyClaimV1 {
                chain_root: chain.chain_root(),
            },
            head_identity: read.head_identity(),
            event_ns: coordinate.event_ns(),
        };
        let view = owner
            .resolve_pit_window_view_v1(&frame)
            .await
            .expect("the frame's view resolves");
        let root = &view.chain.root;
        assert_eq!(root.instrument_master_key, chain.instrument_master_key());
        assert_eq!(root.lineage_root, chain.source_binding_lineage_root());
        assert_eq!(
            root.universe,
            (
                chain.universe_selection().request_identity(),
                chain.universe_selection().request_meaning_digest()
            )
        );
        let request = custody_request(&view, frame, run_end);
        let readback = resolve_native_replay_custody_frame_from_pool_v1(
            owner.pool(),
            &request,
            resolve_custody_quote_cut_v1,
        )
        .await
        .unwrap_or_else(|e| panic!("frame {} resolves: {e:?}", coordinate.ordinal()));
        let PitObservationBatchSourceV1::CustodyView {
            event_ns,
            decision_cut_ns,
            ..
        } = readback.source()
        else {
            panic!("a custody frame reads a custody view");
        };
        assert_eq!(
            (event_ns, decision_cut_ns),
            (coordinate.event_ns(), coordinate.decision_cut_ns())
        );
        let PitObservationBatchSourceV1::CustodyQuoteCut {
            instant_ns,
            derivation,
            ..
        } = readback.quote_cut_for_test().source()
        else {
            panic!("a custody frame's quote cut is a custody quote cut");
        };
        assert!(matches!(derivation, QuoteDerivationV1::FillBarOpen { .. }));
        assert!(
            coordinate.decision_cut_ns() < instant_ns && instant_ns < coordinate.event_ns() + DAY,
            "frame {}'s quote lies in its gap",
            coordinate.ordinal()
        );
        assert_eq!(
            readback
                .universe_frame()
                .selection()
                .members()
                .iter()
                .map(|member| member.instrument().to_owned())
                .collect::<Vec<_>>(),
            [MEMBER]
        );
        readback
            .into_execution_parts()
            .expect("the frame seals its native schedule");
    }
}

/// A bar the custody intake cannot hold - a value finer than the custody series scale - is refused
/// by that intake, under its own name: the fixture states the bar and passes it on unchecked.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_bar_the_custody_intake_refuses_is_refused_under_its_name() {
    let mut spec = spec();
    spec.execution_timeframe.bars[2].members[0].close = decimal("65210.3300000001");
    assert_eq!(
        commit_sealed_acceptance_custody_chain_v1(&owner_url(), &spec)
            .await
            .map(|_| ()),
        Err(SealedAcceptanceCustodyChainErrorV1::CustodyCommit(
            PitWindowCustodyRefusalV1::ValueFinerThanSeriesScale
        ))
    );
}
