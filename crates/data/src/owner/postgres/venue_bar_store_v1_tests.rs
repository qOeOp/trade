//! The venue bar store on real PostgreSQL (slice B1): a page is written once and rejoined, a
//! differing re-fetch is recorded as a conflict and overwrites nothing, every refusal writes
//! nothing, and a point-in-time read sees a version only from its availability.

use std::env;

use super::{MarketDataOwnerPostgres, venue_bar_store_v1::VenueBarStorePostgresV1};
use crate::owner::venue_bar_store_v1::{
    VENUE_BAR_SETTLE_DELAY_NS_V1, VenueBarAvailabilityV1, VenueBarReadErrorV1, VenueBarSourceV1,
    VenueBarStoreV1, VenueBarV1, VenueBarWriteErrorV1,
};

const DAY: u64 = 86_400_000_000_000;
const START: u64 = 19_700 * DAY;
const INSTRUMENT: &str = "BTCUSDT-PERP.BINANCE";

fn bar(open_ns: u64, volume: &str) -> VenueBarV1 {
    VenueBarV1 {
        open_ns,
        close_ns_exclusive: open_ns + DAY,
        open: "42000.10".parse().unwrap(),
        high: "42500".parse().unwrap(),
        low: "41800.5".parse().unwrap(),
        close: "42300".parse().unwrap(),
        volume: volume.parse().unwrap(),
        quote_volume: "1000000".parse().unwrap(),
        trade_count: 1_234,
        taker_buy_volume: "10".parse().unwrap(),
        taker_buy_quote_volume: "420000".parse().unwrap(),
    }
}

async fn rows(owner: &MarketDataOwnerPostgres) -> (i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.venue_bar_versions_v1),(SELECT COUNT(*) FROM market_data_private.venue_bar_conflicts_v1)")
        .fetch_one(owner.pool())
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_venue_bars_are_appended_rejoined_and_never_overwritten() {
    let url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let store = VenueBarStorePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&url).await.unwrap(),
    };
    let owner = &store.owner;
    let retrieved = START + 2 * DAY + VENUE_BAR_SETTLE_DELAY_NS_V1;
    let page = [bar(START, "100.5"), bar(START + DAY, "200")];
    let commit = |bars: Vec<VenueBarV1>, retrieval_ns: u64| {
        let store = &store;
        async move {
            store
                .commit_venue_bars_v1(
                    INSTRUMENT,
                    "1d",
                    VenueBarAvailabilityV1::AtRetrieval,
                    retrieval_ns,
                    &bars,
                )
                .await
        }
    };

    let first = commit(page.to_vec(), retrieved)
        .await
        .expect("the page commits");
    assert_eq!((first.written, first.rejoined), (2, 0));
    assert_eq!(rows(owner).await, (2, 0));

    let again = commit(page.to_vec(), retrieved + 1).await.unwrap();
    assert_eq!(
        (again.written, again.rejoined),
        (0, 2),
        "the same content rejoins"
    );
    assert_eq!(rows(owner).await, (2, 0));

    // The same value spelled another way is the same content.
    let respelled = commit(vec![bar(START, "100.500")], retrieved)
        .await
        .unwrap();
    assert_eq!(respelled.rejoined, 1);

    let differing = commit(vec![bar(START, "101")], retrieved + 2)
        .await
        .unwrap();
    assert_eq!((differing.written, differing.rejoined), (0, 0));
    assert_eq!(differing.conflicts.len(), 1);
    assert_eq!(differing.conflicts[0].fields, ["volume"]);
    assert_eq!(differing.conflicts[0].stored_version, 1);
    commit(vec![bar(START, "101")], retrieved + 3)
        .await
        .unwrap();
    assert_eq!(
        rows(owner).await,
        (2, 1),
        "one conflict per content pair, and nothing overwritten"
    );

    for (refused, expected) in [
        (
            commit(vec![bar(START + 1, "1")], retrieved).await,
            VenueBarWriteErrorV1::BarOffGrid { open_ns: START + 1 },
        ),
        (
            commit(vec![bar(START + 2 * DAY, "1")], retrieved).await,
            VenueBarWriteErrorV1::BarNotSettled {
                open_ns: START + 2 * DAY,
            },
        ),
    ] {
        assert_eq!(refused, Err(expected));
    }
    assert_eq!(rows(owner).await, (2, 1), "a refusal writes nothing");

    let read = |cut_ns: u64, verified_only: bool| {
        let store = &store;
        async move {
            store
                .read_venue_bars_v1(
                    INSTRUMENT,
                    "1d",
                    START,
                    START + 3 * DAY,
                    cut_ns,
                    verified_only,
                )
                .await
        }
    };
    let bars = read(retrieved, false).await.expect("the window reads");
    assert_eq!(bars.len(), 2);
    assert_eq!(
        bars[0].bar, page[0],
        "the stored bar is the first one written"
    );
    assert_eq!(
        (bars[0].version, bars[0].source, bars[0].verified),
        (1, VenueBarSourceV1::Rest, false)
    );
    assert_eq!(bars[0].availability_ns, retrieved);
    assert!(
        read(retrieved - 1, false).await.unwrap().is_empty(),
        "before its availability no version is seen"
    );
    assert_eq!(
        read(retrieved, true).await,
        Err(VenueBarReadErrorV1::NotVerified { open_ns: START })
    );

    // Backfilled history is knowable its declared lag after its close.
    let lag_ns = 1_000_000_000;
    store
        .commit_venue_bars_v1(
            INSTRUMENT,
            "1w",
            VenueBarAvailabilityV1::AfterClose { lag_ns },
            retrieved + 30 * DAY,
            &[VenueBarV1 {
                close_ns_exclusive: 1_704_067_200_000_000_000 + 7 * DAY,
                ..bar(1_704_067_200_000_000_000, "100")
            }],
        )
        .await
        .expect("a Monday week commits");
    let week = store
        .read_venue_bars_v1(
            INSTRUMENT,
            "1w",
            0,
            u64::MAX / 2,
            1_704_067_200_000_000_000 + 7 * DAY + lag_ns,
            false,
        )
        .await
        .unwrap();
    assert_eq!(week.len(), 1);
    assert_eq!(
        week[0].availability_ns,
        1_704_067_200_000_000_000 + 7 * DAY + lag_ns
    );
}

/// An archive verifies the stored bars it states identically, records a conflict for one it
/// states differently, and reports the bars only it or only the store holds, writing nothing for
/// them; a correction resolves the conflict as a later version, seen only from its availability.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_archive_verifies_bars_and_a_correction_appends_a_version() {
    use crate::owner::{
        source_binding::BindingDigest,
        venue_bar_store_v1::{VenueBarArchiveKindV1, VenueBarArchiveV1, VenueBarCorrectionErrorV1},
    };

    let url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let store = VenueBarStorePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&url).await.unwrap(),
    };
    let retrieved = START + 3 * DAY + VENUE_BAR_SETTLE_DELAY_NS_V1;
    store
        .commit_venue_bars_v1(
            INSTRUMENT,
            "1d",
            VenueBarAvailabilityV1::AtRetrieval,
            retrieved,
            &[
                bar(START, "100"),
                bar(START + DAY, "200"),
                bar(START + 2 * DAY, "300"),
            ],
        )
        .await
        .expect("the REST page commits");
    let archive = VenueBarArchiveV1 {
        kind: VenueBarArchiveKindV1::MonthlyArchive,
        identity: BindingDigest::from_untrusted_bytes([7; 32]),
        // The window must cover every archive bar's open, not only its close: the first bar
        // opens at START, so the window starts there too.
        window_start_ns: START,
        window_end_ns_exclusive: START + 5 * DAY,
        bars: vec![
            bar(START, "100"),
            bar(START + DAY, "201"),
            bar(START + 3 * DAY, "400"),
        ],
    };
    let verified_at = retrieved + DAY;

    let summary = store
        .verify_venue_bars_v1(INSTRUMENT, "1d", &archive, verified_at)
        .await
        .expect("the archive verifies");
    assert_eq!(summary.verified, 1);
    assert_eq!(summary.conflicts.len(), 1);
    assert_eq!(summary.conflicts[0].fields, ["volume"]);
    assert_eq!(
        summary.archive_only,
        [START + 3 * DAY],
        "nothing is written for it"
    );
    assert_eq!(summary.store_only, [START + 2 * DAY], "it stays unverified");
    let again = store
        .verify_venue_bars_v1(INSTRUMENT, "1d", &archive, verified_at + 1)
        .await
        .unwrap();
    assert_eq!(again.verified, 1);
    assert_eq!(
        rows(&store.owner).await,
        (3, 1),
        "a repeat writes nothing new"
    );

    let read = |cut_ns: u64, verified_only: bool| {
        let store = &store;
        async move {
            store
                .read_venue_bars_v1(
                    INSTRUMENT,
                    "1d",
                    START,
                    START + 4 * DAY,
                    cut_ns,
                    verified_only,
                )
                .await
        }
    };
    let bars = read(verified_at, false).await.unwrap();
    assert_eq!(
        bars.iter().map(|bar| bar.verified).collect::<Vec<_>>(),
        [true, false, false]
    );
    assert_eq!(
        read(verified_at, true).await,
        Err(VenueBarReadErrorV1::NotVerified {
            open_ns: START + DAY
        })
    );

    let open = store
        .open_venue_bar_conflicts_v1(INSTRUMENT, "1d")
        .await
        .unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].offered_side, "MONTHLY_ARCHIVE");
    let conflict = open[0].conflict_identity;
    assert_eq!(
        store
            .correct_venue_bar_v1(
                INSTRUMENT,
                "1d",
                BindingDigest::from_untrusted_bytes([9; 32]),
                bar(START + DAY, "201"),
                verified_at + DAY,
            )
            .await,
        Err(VenueBarCorrectionErrorV1::UnknownConflict)
    );
    let corrected_at = verified_at + DAY;
    assert_eq!(
        store
            .correct_venue_bar_v1(
                INSTRUMENT,
                "1d",
                conflict,
                bar(START + DAY, "201"),
                corrected_at
            )
            .await,
        Ok(2)
    );
    assert_eq!(
        store
            .correct_venue_bar_v1(
                INSTRUMENT,
                "1d",
                conflict,
                bar(START + DAY, "201"),
                corrected_at
            )
            .await,
        Err(VenueBarCorrectionErrorV1::ConflictSuperseded),
        "a conflict is resolved once"
    );
    assert!(
        store
            .open_venue_bar_conflicts_v1(INSTRUMENT, "1d")
            .await
            .unwrap()
            .is_empty()
    );

    let before = read(corrected_at - 1, false).await.unwrap();
    assert_eq!(
        (before[1].version, before[1].source),
        (1, VenueBarSourceV1::Rest)
    );
    let after = read(corrected_at, false).await.unwrap();
    assert_eq!(
        (after[1].version, after[1].source),
        (2, VenueBarSourceV1::Correction)
    );
    assert_eq!(after[1].bar, bar(START + DAY, "201"));

    let reverified = store
        .verify_venue_bars_v1(INSTRUMENT, "1d", &archive, corrected_at + 1)
        .await
        .unwrap();
    assert_eq!(
        reverified.verified, 2,
        "the corrected version now matches the archive"
    );
    assert!(reverified.conflicts.is_empty());
}

/// A bar must lie wholly inside `[window_start_ns, window_end_ns_exclusive)`: it may close
/// exactly AT the window's exclusive end (the normal case for a full calendar month or day, whose
/// last bar always closes there), but it may not open before the window starts.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_bar_closing_at_the_window_end_verifies_and_one_opening_before_it_refuses() {
    use crate::owner::{
        source_binding::BindingDigest,
        venue_bar_store_v1::{
            VenueBarArchiveKindV1, VenueBarArchiveV1, VenueBarVerificationErrorV1,
        },
    };

    let url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let store = VenueBarStorePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&url).await.unwrap(),
    };
    let window_start_ns = START;
    let window_end_ns_exclusive = START + 3 * DAY;
    let retrieved = START + 3 * DAY + VENUE_BAR_SETTLE_DELAY_NS_V1;
    store
        .commit_venue_bars_v1(
            INSTRUMENT,
            "1d",
            VenueBarAvailabilityV1::AtRetrieval,
            retrieved,
            &[
                bar(START, "100"),
                bar(START + DAY, "200"),
                // This bar's close lands exactly on window_end_ns_exclusive.
                bar(START + 2 * DAY, "300"),
            ],
        )
        .await
        .expect("the REST page commits");
    let rows_before = rows(&store.owner).await;

    // Every stored bar, including the one closing exactly at the window end, verifies clean.
    let whole_window = VenueBarArchiveV1 {
        kind: VenueBarArchiveKindV1::MonthlyArchive,
        identity: BindingDigest::from_untrusted_bytes([11; 32]),
        window_start_ns,
        window_end_ns_exclusive,
        bars: vec![
            bar(START, "100"),
            bar(START + DAY, "200"),
            bar(START + 2 * DAY, "300"),
        ],
    };
    let verified_at = retrieved + DAY;
    let summary = store
        .verify_venue_bars_v1(INSTRUMENT, "1d", &whole_window, verified_at)
        .await
        .expect("a bar closing at the window end verifies");
    assert_eq!(summary.verified, 3);
    assert!(summary.conflicts.is_empty());
    assert!(summary.archive_only.is_empty());
    assert!(summary.store_only.is_empty());

    // An archive omitting the bar that closes at the window end reports it as store_only, not as
    // silently out of range.
    let missing_the_last_bar = VenueBarArchiveV1 {
        bars: vec![bar(START, "100"), bar(START + DAY, "200")],
        ..whole_window.clone()
    };
    let summary = store
        .verify_venue_bars_v1(INSTRUMENT, "1d", &missing_the_last_bar, verified_at + 1)
        .await
        .expect("the narrower archive verifies the bars it does state");
    assert_eq!(
        summary.store_only,
        [START + 2 * DAY],
        "the bar closing at the window end is reported, not dropped"
    );

    // A bar that opens before the window starts is refused, even though its close lands inside
    // the window: an archive's window bounds its bars' opens, not only their closes.
    let opens_before_the_window = VenueBarArchiveV1 {
        window_start_ns: START + DAY,
        window_end_ns_exclusive: START + 2 * DAY,
        bars: vec![bar(START, "100")],
        ..whole_window
    };
    assert_eq!(
        store
            .verify_venue_bars_v1(INSTRUMENT, "1d", &opens_before_the_window, verified_at + 2)
            .await,
        Err(VenueBarVerificationErrorV1::InvalidRequest)
    );
    assert_eq!(rows_before, rows(&store.owner).await, "nothing was written");
}

/// A resumable recorder (B6b) seeds its own forward cursor from this instead of walking from the
/// epoch on every restart: `None` when nothing is stored, `Some` of the latest close once
/// something is, across versions.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_the_latest_close_is_none_then_the_last_committed_bars_own_close() {
    let url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let store = VenueBarStorePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&url).await.unwrap(),
    };
    let instrument = "BTCUSDT-PERP.BINANCE-PROOF-LATEST-CLOSE";

    assert_eq!(
        store
            .latest_venue_bar_close_ns_v1(instrument, "1d")
            .await
            .unwrap(),
        None,
        "nothing is stored yet"
    );

    let retrieved = START + 3 * DAY + VENUE_BAR_SETTLE_DELAY_NS_V1;
    store
        .commit_venue_bars_v1(
            instrument,
            "1d",
            VenueBarAvailabilityV1::AtRetrieval,
            retrieved,
            &[bar(START, "100"), bar(START + DAY, "200")],
        )
        .await
        .expect("the page commits");

    assert_eq!(
        store
            .latest_venue_bar_close_ns_v1(instrument, "1d")
            .await
            .unwrap(),
        Some(START + 2 * DAY),
        "the latest bar's own close, not its open"
    );
}
