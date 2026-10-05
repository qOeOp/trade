//! Slice B3 of "TARGET full chart timeframes and one stitched bar series"
//! (`docs/owners/market-data.md`): forward pagination over Binance's kline REST endpoint, for one
//! instrument and one served timeframe, committed through B1's [`VenueBarStoreV1`].
//!
//! Resolving an instrument's precision and caching it into a nautilus `BarType`, the way
//! [`crate::futures::http::client::BinanceFuturesHttpClient::request_binance_bars`] requires, is
//! not needed here and is not done: that wrapper also keeps only its bar's nautilus event
//! timestamp (Binance's `closeTime`), discarding `openTime` entirely, and `VenueBarV1` needs an
//! exact `open_ns` it does not get to compute independently. `request_raw_klines` is the one Lane
//! 8 decision this slice makes: call Binance's kline rows directly, keep their decimal strings
//! unrounded, and derive each bar's close from its open through [`served_timeframe_v1`]'s own
//! grid rather than trust Binance's inclusive `closeTime` to land exactly one millisecond before
//! the next open.

use rust_decimal::Decimal;
use vibe_data::owner::{
    bar_schedule::served_timeframe_v1,
    venue_bar_store_v1::{
        VENUE_BAR_SETTLE_DELAY_NS_V1, VenueBarAvailabilityV1, VenueBarCommitSummaryV1,
        VenueBarStoreV1, VenueBarV1, VenueBarWriteErrorV1,
    },
};

use crate::futures::http::{
    client::BinanceFuturesHttpClient, models::BinanceFuturesKline, query::BinanceKlinesParams,
};

/// How long after its close a REST-recorded bar is declared knowable for point-in-time reads.
/// Fixed by the kline Source Binding's own declared backfill lag (Lane 2, 2026-10-05): far
/// smaller than [`VENUE_BAR_SETTLE_DELAY_NS_V1`], which instead gates whether the store admits
/// the bar's content at all.
pub const VENUE_BAR_REST_AVAILABILITY_LAG_NS_V1: u64 = 1_000_000_000;

/// The most Binance klines one page returns.
const PAGE_LIMIT: u32 = 1_000;

/// Why a page could not be turned into venue bars. Distinct from [`VenueBarWriteErrorV1`], which
/// is the store's own refusal once a page is well-formed.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarRestRowErrorV1 {
    #[error("{venue_interval} is not a Market Data served timeframe")]
    UnservedTimeframe { venue_interval: String },
    /// Binance returned a row whose `openTime` does not land on the timeframe's own grid.
    #[error("a Binance row opening at {open_ms}ms is not on {venue_interval}'s grid")]
    OffGrid {
        venue_interval: String,
        open_ms: i64,
    },
    /// A row's `openTime` or a decimal field could not be parsed.
    #[error("a Binance row at {open_ms}ms is malformed: {reason}")]
    Malformed { open_ms: i64, reason: String },
}

fn parse_decimal(
    value: &str,
    open_ms: i64,
    field: &str,
) -> Result<Decimal, VenueBarRestRowErrorV1> {
    value
        .parse::<Decimal>()
        .map_err(|e| VenueBarRestRowErrorV1::Malformed {
            open_ms,
            reason: format!("{field}: {e}"),
        })
}

/// Turns one Binance kline row into a [`VenueBarV1`], deriving its close from
/// [`served_timeframe_v1`]'s grid rather than from the row's own `closeTime`.
///
/// # Errors
///
/// [`VenueBarRestRowErrorV1`] naming why the row cannot be turned into a venue bar.
pub fn venue_bar_from_kline_row_v1(
    row: &BinanceFuturesKline,
    venue_interval: &str,
) -> Result<VenueBarV1, VenueBarRestRowErrorV1> {
    let timeframe = served_timeframe_v1(venue_interval).ok_or_else(|| {
        VenueBarRestRowErrorV1::UnservedTimeframe {
            venue_interval: venue_interval.to_string(),
        }
    })?;
    let open_ms = row.open_time;
    let open_ns = u64::try_from(open_ms)
        .ok()
        .and_then(|ms| ms.checked_mul(1_000_000))
        .ok_or_else(|| VenueBarRestRowErrorV1::Malformed {
            open_ms,
            reason: "openTime is negative or overflows nanoseconds".to_string(),
        })?;
    let close_ns_exclusive =
        timeframe
            .close_of(open_ns)
            .ok_or_else(|| VenueBarRestRowErrorV1::OffGrid {
                venue_interval: venue_interval.to_string(),
                open_ms,
            })?;

    Ok(VenueBarV1 {
        open_ns,
        close_ns_exclusive,
        open: parse_decimal(&row.open, open_ms, "open")?,
        high: parse_decimal(&row.high, open_ms, "high")?,
        low: parse_decimal(&row.low, open_ms, "low")?,
        close: parse_decimal(&row.close, open_ms, "close")?,
        volume: parse_decimal(&row.volume, open_ms, "volume")?,
        quote_volume: parse_decimal(&row.quote_volume, open_ms, "quote_volume")?,
        trade_count: u64::try_from(row.num_trades).map_err(|_| {
            VenueBarRestRowErrorV1::Malformed {
                open_ms,
                reason: "num_trades is negative".to_string(),
            }
        })?,
        taker_buy_volume: parse_decimal(
            &row.taker_buy_base_volume,
            open_ms,
            "taker_buy_base_volume",
        )?,
        taker_buy_quote_volume: parse_decimal(
            &row.taker_buy_quote_volume,
            open_ms,
            "taker_buy_quote_volume",
        )?,
    })
}

/// Splits `bars` (ascending open order) at the first one not yet settled at `retrieval_ns`. The
/// settled bars are always a prefix: settlement is monotonic in open order.
#[must_use]
pub fn settled_prefix_v1(bars: &[VenueBarV1], retrieval_ns: u64) -> &[VenueBarV1] {
    let settled = bars
        .iter()
        .take_while(|bar| {
            bar.close_ns_exclusive
                .checked_add(VENUE_BAR_SETTLE_DELAY_NS_V1)
                .is_some_and(|settles_at| settles_at <= retrieval_ns)
        })
        .count();
    &bars[..settled]
}

/// The next page's `startTime`, in milliseconds, after committing `settled`'s last bar; `None`
/// when `settled` is empty (nothing advanced, so the caller's own resume point still applies).
#[must_use]
pub fn next_page_start_ms_v1(settled: &[VenueBarV1]) -> Option<i64> {
    let close_ns_exclusive = settled.last()?.close_ns_exclusive;
    i64::try_from(close_ns_exclusive / 1_000_000).ok()
}

/// Why one recording run stopped without completing.
#[derive(Debug, thiserror::Error)]
pub enum VenueBarRestRecordErrorV1 {
    #[error(transparent)]
    Row(#[from] VenueBarRestRowErrorV1),
    #[error(transparent)]
    Store(#[from] VenueBarWriteErrorV1),
    #[error("the Binance REST request failed: {0}")]
    Request(String),
}

/// What one recording run did, across every page it committed.
#[derive(Clone, Debug, Default)]
pub struct VenueBarRestRecordSummaryV1 {
    pub pages: u64,
    pub committed: VenueBarCommitSummaryV1,
    /// `true` once a page returned fewer rows than it asked for, or an unsettled row, meaning
    /// recording has caught up to Binance's present moment for this instrument and timeframe.
    pub caught_up: bool,
    /// Where the next call should resume from: the last committed page's own next page start, or
    /// `resume_from_ms` unchanged if nothing committed. A caller tracking this in memory across
    /// ticks never needs to read the store back just to find out where it left off.
    pub resume_from_ms: i64,
}

/// The account-wide Binance futures request-weight quota per minute
/// ([`vibe_binance::common::consts::BINANCE_FAPI_RATE_LIMITS`]'s `RequestWeight` entry).
const ACCOUNT_REQUEST_WEIGHT_PER_MINUTE: u32 = 2_400;

/// Stop paging once the client's own most recent `X-MBX-USED-WEIGHT-1M` observation reaches this
/// fraction of the account's per-minute budget, leaving headroom for every other job this
/// account's weight is shared with (other instrument/timeframe pairs, the funding recorder,
/// archive verification) rather than running this one page loop right up to the venue's own
/// refusal.
const USED_WEIGHT_1M_BACKOFF_THRESHOLD: u32 = ACCOUNT_REQUEST_WEIGHT_PER_MINUTE * 4 / 5;

/// Records `raw_symbol`'s bars at `venue_interval` into `store`, forward from `resume_from_ms` (a
/// `start_ns` already read back from `read_venue_bars_v1`, or the Unix epoch on the instrument's
/// first-ever run, letting Binance's own response begin at its actual first listed bar) up to
/// `retrieval_ns`'s present moment. Every page is committed in one call through the store's own
/// `commit_venue_bars_v1`, so no row this function already retrieved is ever double-counted into
/// the summary across a resumed run: a resumed run starts its own fresh summary and only the
/// store's rejoin counts tell the two runs apart.
///
/// Pages until caught up, or until `client`'s own most recent `X-MBX-USED-WEIGHT-1M` observation
/// crosses 80% of the account's per-minute request-weight quota - read after every page, not
/// assumed from a fixed page budget, since the account's weight is shared with whatever else this
/// client's caller also runs. A cold instrument's first `1m` backfill from its first listed bar is
/// thousands of pages; backing off on the real weight still returns `caught_up: false` with
/// whatever it already committed, and the next call resumes from the stored close exactly as a
/// restart would, converging over many calls instead of blocking one for hours.
///
/// # Errors
///
/// [`VenueBarRestRecordErrorV1`] naming why recording stopped; every page before that point was
/// already committed.
pub async fn record_venue_bars_v1(
    client: &BinanceFuturesHttpClient,
    store: &dyn VenueBarStoreV1,
    canonical_instrument: &str,
    raw_symbol: &str,
    venue_interval: &str,
    resume_from_ms: i64,
    retrieval_ns: u64,
) -> Result<VenueBarRestRecordSummaryV1, VenueBarRestRecordErrorV1> {
    let mut summary = VenueBarRestRecordSummaryV1 {
        resume_from_ms,
        ..VenueBarRestRecordSummaryV1::default()
    };
    let mut start_ms = resume_from_ms;

    while client.used_weight_1m() < USED_WEIGHT_1M_BACKOFF_THRESHOLD {
        let params = BinanceKlinesParams {
            symbol: raw_symbol.to_string(),
            interval: venue_interval.to_string(),
            start_time: Some(start_ms),
            end_time: None,
            limit: Some(PAGE_LIMIT),
        };
        let rows = client
            .request_raw_klines(&params)
            .await
            .map_err(|e| VenueBarRestRecordErrorV1::Request(e.to_string()))?;

        if rows.is_empty() {
            summary.caught_up = true;
            break;
        }

        let bars = rows
            .iter()
            .map(|row| venue_bar_from_kline_row_v1(row, venue_interval))
            .collect::<Result<Vec<_>, _>>()?;
        let settled = settled_prefix_v1(&bars, retrieval_ns);
        let page_was_full = rows.len() == PAGE_LIMIT as usize;
        let all_settled = settled.len() == bars.len();

        if !settled.is_empty() {
            let page_summary = store
                .commit_venue_bars_v1(
                    canonical_instrument,
                    venue_interval,
                    VenueBarAvailabilityV1::AfterClose {
                        lag_ns: VENUE_BAR_REST_AVAILABILITY_LAG_NS_V1,
                    },
                    retrieval_ns,
                    settled,
                )
                .await?;
            summary.pages += 1;
            summary.committed.written += page_summary.written;
            summary.committed.rejoined += page_summary.rejoined;
            summary.committed.conflicts.extend(page_summary.conflicts);
        }

        if !all_settled || !page_was_full {
            summary.caught_up = true;
            break;
        }

        let Some(next) = next_page_start_ms_v1(settled) else {
            summary.caught_up = true;
            break;
        };
        start_ms = next;
        summary.resume_from_ms = next;
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use rust_decimal_macros::dec;

    use super::*;

    fn bar(open_ns: u64, close_ns_exclusive: u64) -> VenueBarV1 {
        VenueBarV1 {
            open_ns,
            close_ns_exclusive,
            open: dec!(1),
            high: dec!(1),
            low: dec!(1),
            close: dec!(1),
            volume: dec!(1),
            quote_volume: dec!(1),
            trade_count: 1,
            taker_buy_volume: dec!(1),
            taker_buy_quote_volume: dec!(1),
        }
    }

    const MINUTE: u64 = 60_000_000_000;

    #[rstest]
    fn settled_prefix_keeps_only_bars_settled_before_retrieval() {
        let bars = [
            bar(0, MINUTE),
            bar(MINUTE, 2 * MINUTE),
            bar(2 * MINUTE, 3 * MINUTE),
        ];
        let retrieval_ns = 2 * MINUTE + VENUE_BAR_SETTLE_DELAY_NS_V1;

        let settled = settled_prefix_v1(&bars, retrieval_ns);

        assert_eq!(settled, &bars[..2]);
    }

    #[rstest]
    fn settled_prefix_is_empty_when_the_first_bar_has_not_settled() {
        let bars = [bar(0, MINUTE)];

        let settled = settled_prefix_v1(&bars, MINUTE);

        assert!(settled.is_empty());
    }

    #[rstest]
    fn settled_prefix_keeps_everything_well_past_settlement() {
        let bars = [bar(0, MINUTE), bar(MINUTE, 2 * MINUTE)];

        let settled = settled_prefix_v1(&bars, 2 * MINUTE + VENUE_BAR_SETTLE_DELAY_NS_V1 + MINUTE);

        assert_eq!(settled, &bars[..]);
    }

    #[rstest]
    fn next_page_start_is_the_last_settled_bars_close() {
        let settled = [bar(0, MINUTE), bar(MINUTE, 2 * MINUTE)];

        assert_eq!(next_page_start_ms_v1(&settled), Some(120_000));
    }

    #[rstest]
    fn next_page_start_is_none_when_nothing_settled() {
        assert_eq!(next_page_start_ms_v1(&[]), None);
    }

    fn row(open_time_ms: i64, close_time_ms: i64) -> BinanceFuturesKline {
        BinanceFuturesKline {
            open_time: open_time_ms,
            open: "100".to_string(),
            high: "101".to_string(),
            low: "99".to_string(),
            close: "100.5".to_string(),
            volume: "10".to_string(),
            close_time: close_time_ms,
            quote_volume: "1000".to_string(),
            num_trades: 5,
            taker_buy_base_volume: "4".to_string(),
            taker_buy_quote_volume: "400".to_string(),
        }
    }

    #[rstest]
    fn a_row_on_the_grid_becomes_a_venue_bar_with_the_grids_own_close() {
        let venue_bar = venue_bar_from_kline_row_v1(&row(0, 59_999), "1m").unwrap();

        assert_eq!(venue_bar.open_ns, 0);
        assert_eq!(venue_bar.close_ns_exclusive, MINUTE);
        assert_eq!(venue_bar.trade_count, 5);
    }

    #[rstest]
    fn a_row_off_the_grid_is_refused_by_name() {
        let err = venue_bar_from_kline_row_v1(&row(30_000, 89_999), "1m").unwrap_err();

        assert_eq!(
            err,
            VenueBarRestRowErrorV1::OffGrid {
                venue_interval: "1m".to_string(),
                open_ms: 30_000,
            }
        );
    }

    #[rstest]
    fn a_negative_trade_count_is_refused_by_name() {
        let mut malformed = row(0, 59_999);
        malformed.num_trades = -1;

        let err = venue_bar_from_kline_row_v1(&malformed, "1m").unwrap_err();

        assert_eq!(
            err,
            VenueBarRestRowErrorV1::Malformed {
                open_ms: 0,
                reason: "num_trades is negative".to_string(),
            }
        );
    }

    #[rstest]
    fn an_unserved_interval_is_refused_by_name() {
        let err = venue_bar_from_kline_row_v1(&row(0, 59_999), "7m").unwrap_err();

        assert_eq!(
            err,
            VenueBarRestRowErrorV1::UnservedTimeframe {
                venue_interval: "7m".to_string(),
            }
        );
    }
}

#[cfg(test)]
mod live_tests {
    use vibe_core::time::get_atomic_clock_realtime;
    use vibe_data::owner::venue_bar_store_v1::venue_bar_store_from_environment_v1;

    use super::*;
    use crate::common::enums::{BinanceEnvironment, BinanceProductType};

    /// Records one past UTC day of BTCUSDT `1m` and `1d` bars twice, against a real
    /// `MARKET_DATA_OWNER_DATABASE_URL` and the live public Binance endpoint (no credential, no
    /// cost). `#[ignore]` only because it reaches both. Verified live on 2026-10-05 against
    /// 2025-01-01 UTC: the first run wrote 1,440 `1m` bars (2 pages) and 1 `1d` bar; the second
    /// rejoined both counts exactly and wrote nothing. The `1m` count equals the venue's own
    /// daily archive row count for that day (`BTCUSDT-1m-2025-01-01.zip`: 1,441 CSV lines, one a
    /// header).
    // 2025-01-01 00:00:00 UTC: a day long since closed and settled.
    const DAY_START_MS: i64 = 1_735_689_600_000;
    const RETRIEVAL_NS: u64 = 1_735_776_000_000_000_000 + VENUE_BAR_SETTLE_DELAY_NS_V1;
    const CANONICAL_INSTRUMENT: &str = "BTCUSDT-PERP.BINANCE";

    #[tokio::test]
    #[ignore = "reaches the live public Binance endpoint and a real Market Data store"]
    async fn recording_the_same_day_twice_writes_once_and_then_rejoins() {
        let client = BinanceFuturesHttpClient::new(
            BinanceProductType::UsdM,
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            None,
            None,
            None,
            None,
            Some(30),
            None,
            false,
        )
        .expect("the keyless public client builds");
        let store = venue_bar_store_from_environment_v1()
            .await
            .expect("MARKET_DATA_OWNER_DATABASE_URL names a reachable store");

        for venue_interval in ["1m", "1d"] {
            let first = record_venue_bars_v1(
                &client,
                store.as_ref(),
                CANONICAL_INSTRUMENT,
                "BTCUSDT",
                venue_interval,
                DAY_START_MS,
                RETRIEVAL_NS,
            )
            .await
            .expect("the first run commits the day's settled bars");
            assert!(
                first.committed.written > 0,
                "{venue_interval}: nothing written"
            );
            assert!(first.committed.conflicts.is_empty());

            let second = record_venue_bars_v1(
                &client,
                store.as_ref(),
                CANONICAL_INSTRUMENT,
                "BTCUSDT",
                venue_interval,
                DAY_START_MS,
                RETRIEVAL_NS,
            )
            .await
            .expect("the second run rejoins the same bars");
            assert_eq!(
                second.committed.written, 0,
                "{venue_interval}: rejoin wrote something"
            );
            assert_eq!(second.committed.rejoined, first.committed.written);
            assert!(second.committed.conflicts.is_empty());
        }
    }

    /// The client's own `used_weight_1m` starts at 0 and is set from the venue's real
    /// `X-MBX-USED-WEIGHT-1M` response header once it has made a request - the mechanism
    /// `record_venue_bars_v1`'s own paging loop backs off on. Verified live on 2026-10-05: a
    /// single `klines` call set it to a small positive weight, confirming the header is actually
    /// captured end to end, not just plumbed through unused.
    #[tokio::test]
    #[ignore = "reaches the live public Binance endpoint"]
    async fn the_clients_own_used_weight_updates_from_a_real_response() {
        let client = BinanceFuturesHttpClient::new(
            BinanceProductType::UsdM,
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            None,
            None,
            None,
            None,
            Some(30),
            None,
            false,
        )
        .expect("the keyless public client builds");
        assert_eq!(client.used_weight_1m(), 0);

        let params = BinanceKlinesParams {
            symbol: "BTCUSDT".to_string(),
            interval: "1m".to_string(),
            start_time: Some(DAY_START_MS),
            end_time: None,
            limit: Some(1),
        };
        client
            .request_raw_klines(&params)
            .await
            .expect("the live endpoint answers");

        assert!(
            client.used_weight_1m() > 0,
            "a real response names the account's real used weight"
        );
    }
}
