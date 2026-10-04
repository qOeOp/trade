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
