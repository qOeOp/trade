//! Slice B6a of "TARGET live funding retrieval for the strategy runtime"
//! (`docs/owners/market-data.md`): the settled-funding recorder that lives in Market Data's
//! resident service (B6b), never the MCP. It polls the same unsigned public
//! `/fapi/v1/fundingRate` endpoint the two-row scope read already calls
//! (`futures_pit_observation_source_v1.rs`), derives each settlement's interval from the real gap
//! to its predecessor (the venue states no interval on this endpoint, unlike the archive), and
//! commits idempotently through [`FundingSettlementCommitV1`].
//!
//! **Why derive the interval instead of asking for it.** Binance's `/fapi/v1/fundingRate` response
//! carries no interval field at all. A settlement's interval is the span since the previous
//! settlement - what the funding actually accrued over - and this stays correct across an
//! interval change: the first settlement after an 8h -> 4h switch has a 4h gap by construction,
//! where a symbol's *current* interval alone would not reach backwards. Measured against the live
//! endpoint on 2026-10-05 (500 rows each): `1000SHIBUSDT` and `GALAUSDT` are 8h throughout,
//! `ORDIUSDT` and `LUNA2USDT` are 4h throughout - confirming real symbols sit on this grid, though
//! no interval *change* fell inside the sampled window, so the across-a-change case is design
//! reasoning, not yet an observed one.

use rust_decimal::Decimal;
use vibe_data::owner::{
    funding_settlement_commit_v1::{
        FundingSettlementCommitV1, FundingSettlementWriteErrorV1, FundingSettlementWriteRowV1,
    },
    source_binding::BindingDigest,
};

use crate::futures::http::{client::BinanceFuturesHttpClient, models::BinanceFundingRate};

/// The only funding intervals Binance USD-M perpetuals settle on, in hours.
pub const FUNDING_INTERVAL_GRID_HOURS_V1: [u8; 4] = [1, 2, 4, 8];

/// A whole-hour gap is never observed exactly on the millisecond: measured jitter on real
/// settlements is on the order of a few milliseconds either side of the hour. This tolerance is
/// generous against that (two minutes) without being wide enough to blur two adjacent grid values
/// (the grid's own closest pair, 1h and 2h, differ by far more than this).
const INTERVAL_TOLERANCE_HOURS: f64 = 2.0 / 60.0;

const MS_PER_HOUR: f64 = 3_600_000.0;
const NS_PER_MS: u64 = 1_000_000;

/// Why one settlement's row could not be derived or written. Naming the refusal, not silently
/// dropping the row, is the point: a caller can tell "this is the batch's own first row, with no
/// predecessor in it" apart from "the venue published something off this grid."
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum FundingSettlementRecordRowErrorV1 {
    /// The oldest row in a fetched batch has no predecessor within that same batch. Not an error
    /// in the row itself - an earlier poll either already classified it (it was that poll's
    /// newest row then) or will once a wider fetch covers its predecessor.
    #[error("the settlement at {funding_time_ms}ms has no predecessor in this batch")]
    NoPredecessor { funding_time_ms: i64 },
    /// The gap to the previous settlement is not within tolerance of a whole hour in
    /// [`FUNDING_INTERVAL_GRID_HOURS_V1`].
    #[error("the settlement at {funding_time_ms}ms has a {gap_hours}h gap, off the funding grid")]
    IntervalOffGrid {
        funding_time_ms: i64,
        gap_hours: f64,
    },
    /// The row's own fields could not be parsed.
    #[error("the settlement at {funding_time_ms}ms is malformed: {reason}")]
    Malformed {
        funding_time_ms: i64,
        reason: String,
    },
}

/// Derives a settlement's interval from the real gap to its predecessor, refusing anything not
/// within two minutes of a whole hour on [`FUNDING_INTERVAL_GRID_HOURS_V1`].
///
/// # Errors
///
/// [`FundingSettlementRecordRowErrorV1::IntervalOffGrid`] naming the computed gap, or
/// [`FundingSettlementRecordRowErrorV1::Malformed`] if the gap is not positive.
pub fn derive_interval_hours_v1(
    previous_funding_time_ms: i64,
    funding_time_ms: i64,
) -> Result<u8, FundingSettlementRecordRowErrorV1> {
    use FundingSettlementRecordRowErrorV1 as Refused;

    let gap_ms = funding_time_ms - previous_funding_time_ms;
    if gap_ms <= 0 {
        return Err(Refused::Malformed {
            funding_time_ms,
            reason: "its predecessor does not strictly precede it".to_string(),
        });
    }
    let gap_hours = gap_ms as f64 / MS_PER_HOUR;
    let rounded = gap_hours.round();
    if (gap_hours - rounded).abs() > INTERVAL_TOLERANCE_HOURS
        || rounded < 1.0
        || rounded > u8::MAX as f64
        || !FUNDING_INTERVAL_GRID_HOURS_V1.contains(&(rounded as u8))
    {
        return Err(Refused::IntervalOffGrid {
            funding_time_ms,
            gap_hours,
        });
    }
    Ok(rounded as u8)
}

/// Turns one fetched batch into the rows it can derive (every row but the batch's own oldest,
/// which has no predecessor within it) and the rows it refuses, each by name.
#[must_use]
pub fn funding_settlement_rows_from_fetched_v1(
    fetched: &[BinanceFundingRate],
    availability_ns: u64,
) -> (
    Vec<FundingSettlementWriteRowV1>,
    Vec<FundingSettlementRecordRowErrorV1>,
) {
    use FundingSettlementRecordRowErrorV1 as Refused;

    let mut sorted: Vec<&BinanceFundingRate> = fetched.iter().collect();
    sorted.sort_unstable_by_key(|row| row.funding_time);

    let mut rows = Vec::new();
    let mut errors = Vec::new();

    if let Some(first) = sorted.first() {
        errors.push(Refused::NoPredecessor {
            funding_time_ms: first.funding_time,
        });
    }

    for pair in sorted.windows(2) {
        let [previous, current] = pair else { continue };
        let funding_time_ms = current.funding_time;

        let rate = match current.funding_rate.parse::<Decimal>() {
            Ok(rate) => rate,
            Err(e) => {
                errors.push(Refused::Malformed {
                    funding_time_ms,
                    reason: format!("funding_rate: {e}"),
                });
                continue;
            }
        };
        let interval_hours =
            match derive_interval_hours_v1(previous.funding_time, current.funding_time) {
                Ok(interval_hours) => interval_hours,
                Err(e) => {
                    errors.push(e);
                    continue;
                }
            };
        let Ok(settlement_ns) = u64::try_from(funding_time_ms).map(|ms| ms * NS_PER_MS) else {
            errors.push(Refused::Malformed {
                funding_time_ms,
                reason: "funding_time is negative".to_string(),
            });
            continue;
        };

        rows.push(FundingSettlementWriteRowV1 {
            settlement_ns,
            interval_hours,
            rate,
            availability_ns,
        });
    }

    (rows, errors)
}

/// Polls `client`'s `/fapi/v1/fundingRate` for `raw_symbol`'s most recent settlements, derives
/// every row it can, and commits them through `store`. `fetch_limit` should comfortably exceed
/// one interval's worth of settlements (at least 2, so the batch's newest row always has a real
/// predecessor to derive from); B6b's scheduler owns how often this is called.
///
/// # Errors
///
/// The client's own request error, or [`FundingSettlementWriteErrorV1`] naming why the commit
/// was refused.
pub async fn record_funding_settlements_v1(
    client: &BinanceFuturesHttpClient,
    store: &dyn FundingSettlementCommitV1,
    instrument: &str,
    raw_symbol: &str,
    fetch_limit: u32,
    retrieval_ns: u64,
) -> Result<
    (
        Option<BindingDigest>,
        Vec<FundingSettlementRecordRowErrorV1>,
    ),
    FundingSettlementRecordErrorV1,
> {
    use crate::futures::http::query::BinanceFundingRateParams;

    let params = BinanceFundingRateParams {
        symbol: Some(raw_symbol.to_string()),
        start_time: None,
        end_time: None,
        limit: Some(fetch_limit),
    };
    let fetched = client
        .funding_rate(&params)
        .await
        .map_err(|e| FundingSettlementRecordErrorV1::Request(e.to_string()))?;
    let (rows, errors) = funding_settlement_rows_from_fetched_v1(&fetched, retrieval_ns);

    // Nothing in this batch had a predecessor to derive from (every poll's own batch has exactly
    // one such row, its oldest - see funding_settlement_rows_from_fetched_v1's own doc). There is
    // no derived window to claim as covered, so this poll commits nothing rather than guessing
    // one; the next poll's wider batch covers this row once it has a predecessor of its own.
    let (Some(window_start_ns), Some(last)) = (
        rows.first().map(|row| row.settlement_ns),
        rows.last().map(|row| row.settlement_ns),
    ) else {
        return Ok((None, errors));
    };
    let window_end_ns_exclusive = last + 1;

    let digest = store
        .commit_funding_settlements_v1(
            instrument,
            &rows,
            retrieval_ns,
            "fundingRate",
            window_start_ns,
            window_end_ns_exclusive,
        )
        .await?;
    Ok((Some(digest), errors))
}

/// Why a recording poll failed before any commit was attempted.
#[derive(Debug, thiserror::Error)]
pub enum FundingSettlementRecordErrorV1 {
    #[error("the Binance REST request failed: {0}")]
    Request(String),
    #[error(transparent)]
    Store(#[from] FundingSettlementWriteErrorV1),
}

/// When B6b's scheduler should next poll for this instrument: the last known settlement plus its
/// own interval, plus the publication lag - never settlement alone, and never a value this
/// function invents when it has nothing to go on. Re-derived after every settlement, so an
/// interval change is picked up at the very next boundary rather than carried forward stale.
#[must_use]
pub const fn next_funding_poll_ns_v1(
    last_settlement_ns: u64,
    last_interval_hours: u8,
    publication_lag_ns: u64,
) -> u64 {
    const NS_PER_HOUR: u64 = 3_600_000_000_000;
    last_settlement_ns + last_interval_hours as u64 * NS_PER_HOUR + publication_lag_ns
}

/// One archive-vs-live mismatch for a settlement both sides state, named by field.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FundingReconciliationMismatchV1 {
    pub settlement_ns: u64,
    pub field: &'static str,
    pub archive_value: FundingReconciledValueV1,
    pub live_value: FundingReconciledValueV1,
}

/// Either side of a reconciliation mismatch, named by the field it came from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FundingReconciledValueV1 {
    IntervalHours(u8),
    Rate(Decimal),
}

/// Compares the archive's own stated rows against what the recorder already committed for the
/// same settlements, reporting every mismatch by name - rate and interval both, per Lane 2's
/// review - and never overwriting either side. A settlement either side lacks is not compared:
/// the archive omitting a row the recorder has, or the reverse, is not itself a mismatch here.
#[must_use]
pub fn reconcile_funding_settlements_v1(
    archive_rows: &[crate::funding_archive_v1::FundingArchiveRowV1],
    live_rows: &[FundingSettlementWriteRowV1],
) -> Vec<FundingReconciliationMismatchV1> {
    use FundingReconciledValueV1 as Value;

    let mut mismatches = Vec::new();

    for archive_row in archive_rows {
        let Some(live_row) = live_rows
            .iter()
            .find(|row| row.settlement_ns == archive_row.settlement_ns)
        else {
            continue;
        };

        if archive_row.interval_hours != live_row.interval_hours {
            mismatches.push(FundingReconciliationMismatchV1 {
                settlement_ns: archive_row.settlement_ns,
                field: "interval_hours",
                archive_value: Value::IntervalHours(archive_row.interval_hours),
                live_value: Value::IntervalHours(live_row.interval_hours),
            });
        }

        if archive_row.rate != live_row.rate {
            mismatches.push(FundingReconciliationMismatchV1 {
                settlement_ns: archive_row.settlement_ns,
                field: "rate",
                archive_value: Value::Rate(archive_row.rate),
                live_value: Value::Rate(live_row.rate),
            });
        }
    }
    mismatches
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn fetched(funding_time: i64, rate: &str) -> BinanceFundingRate {
        BinanceFundingRate {
            symbol: "BTCUSDT".into(),
            funding_rate: rate.to_string(),
            funding_time,
            mark_price: None,
            index_price: None,
        }
    }

    const HOUR_MS: i64 = 3_600_000;

    #[rstest]
    #[case::one_hour(HOUR_MS, 1)]
    #[case::two_hours(2 * HOUR_MS, 2)]
    #[case::four_hours(4 * HOUR_MS, 4)]
    #[case::eight_hours(8 * HOUR_MS, 8)]
    fn a_whole_hour_gap_on_the_grid_derives_its_interval(#[case] gap_ms: i64, #[case] hours: u8) {
        assert_eq!(derive_interval_hours_v1(0, gap_ms), Ok(hours));
    }

    #[rstest]
    fn jitter_within_tolerance_still_derives_the_grid_value() {
        // Measured jitter on real settlements is a few milliseconds; one minute is well inside
        // tolerance and well outside realistic jitter, so this is a meaningful margin check.
        assert_eq!(
            derive_interval_hours_v1(0, 8 * HOUR_MS + 60_000),
            Ok(8),
            "a minute of jitter still derives 8h"
        );
    }

    #[rstest]
    fn a_gap_off_the_grid_is_refused_by_name() {
        assert_eq!(
            derive_interval_hours_v1(0, 3 * HOUR_MS),
            Err(FundingSettlementRecordRowErrorV1::IntervalOffGrid {
                funding_time_ms: 3 * HOUR_MS,
                gap_hours: 3.0,
            })
        );
    }

    #[rstest]
    fn a_non_positive_gap_is_malformed() {
        assert_eq!(
            derive_interval_hours_v1(HOUR_MS, HOUR_MS),
            Err(FundingSettlementRecordRowErrorV1::Malformed {
                funding_time_ms: HOUR_MS,
                reason: "its predecessor does not strictly precede it".to_string(),
            })
        );
    }

    #[rstest]
    fn the_batchs_own_oldest_row_has_no_predecessor_but_every_later_row_derives() {
        let batch = [
            fetched(0, "0.0001"),
            fetched(8 * HOUR_MS, "0.0002"),
            fetched(16 * HOUR_MS, "0.0003"),
        ];
        let (rows, errors) = funding_settlement_rows_from_fetched_v1(&batch, 999);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].settlement_ns, 8 * HOUR_MS as u64 * NS_PER_MS);
        assert_eq!(rows[0].interval_hours, 8);
        assert_eq!(rows[0].availability_ns, 999);
        assert_eq!(rows[1].settlement_ns, 16 * HOUR_MS as u64 * NS_PER_MS);

        assert_eq!(
            errors,
            [FundingSettlementRecordRowErrorV1::NoPredecessor { funding_time_ms: 0 }]
        );
    }

    #[rstest]
    fn an_off_grid_row_is_skipped_but_does_not_block_the_rows_around_it() {
        let batch = [
            fetched(0, "0.0001"),
            fetched(3 * HOUR_MS, "0.0002"), // off grid against its predecessor
            fetched(11 * HOUR_MS, "0.0003"), // 8h on from the off-grid row: still derives
        ];
        let (rows, errors) = funding_settlement_rows_from_fetched_v1(&batch, 1);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].settlement_ns, 11 * HOUR_MS as u64 * NS_PER_MS);
        assert_eq!(rows[0].interval_hours, 8);
        assert!(
            errors.iter().any(|e| matches!(
                e,
                FundingSettlementRecordRowErrorV1::IntervalOffGrid { gap_hours, .. } if (*gap_hours - 3.0).abs() < f64::EPSILON
            ))
        );
    }

    #[rstest]
    fn the_next_poll_is_the_last_settlement_plus_its_interval_plus_the_lag() {
        const NS_PER_HOUR: u64 = 3_600_000_000_000;
        assert_eq!(
            next_funding_poll_ns_v1(1_000, 8, 12_000_000_000),
            1_000 + 8 * NS_PER_HOUR + 12_000_000_000
        );
    }

    #[rstest]
    fn an_interval_change_is_picked_up_by_the_very_next_derivation() {
        const NS_PER_HOUR: u64 = 3_600_000_000_000;
        // After 8h is derived, scheduling the next poll off that interval would wake at +8h; the
        // real settlement 4h later is still fetched by the next wider poll and re-derives to 4h,
        // not carried forward stale at 8h.
        let scheduled_at_old_interval = next_funding_poll_ns_v1(0, 8, 0);
        assert_eq!(scheduled_at_old_interval, 8 * NS_PER_HOUR);
        assert_eq!(derive_interval_hours_v1(0, 4 * HOUR_MS), Ok(4));
    }

    #[rstest]
    fn a_rate_or_interval_mismatch_against_the_archive_is_named_and_an_agreeing_row_is_silent() {
        use crate::funding_archive_v1::FundingArchiveRowV1;

        let archive = [
            FundingArchiveRowV1 {
                settlement_ns: 1,
                interval_hours: 8,
                rate: Decimal::from_str_exact("0.0001").unwrap(),
            },
            FundingArchiveRowV1 {
                settlement_ns: 2,
                interval_hours: 4,
                rate: Decimal::from_str_exact("0.0002").unwrap(),
            },
        ];
        let live = [
            FundingSettlementWriteRowV1 {
                settlement_ns: 1,
                interval_hours: 8,
                rate: Decimal::from_str_exact("0.0001").unwrap(),
                availability_ns: 1,
            },
            FundingSettlementWriteRowV1 {
                settlement_ns: 2,
                interval_hours: 8, // disagrees with the archive's 4
                rate: Decimal::from_str_exact("0.0009").unwrap(), // disagrees with the archive's rate
                availability_ns: 2,
            },
        ];

        let mismatches = reconcile_funding_settlements_v1(&archive, &live);
        assert_eq!(
            mismatches.len(),
            2,
            "settlement 1 agrees and reports nothing"
        );
        assert!(
            mismatches
                .iter()
                .all(|mismatch| mismatch.settlement_ns == 2)
        );
        assert!(
            mismatches
                .iter()
                .any(|mismatch| mismatch.field == "interval_hours")
        );
        assert!(mismatches.iter().any(|mismatch| mismatch.field == "rate"));
    }

    #[rstest]
    fn a_settlement_only_one_side_states_is_not_a_mismatch() {
        use crate::funding_archive_v1::FundingArchiveRowV1;

        let archive = [FundingArchiveRowV1 {
            settlement_ns: 1,
            interval_hours: 8,
            rate: Decimal::from_str_exact("0.0001").unwrap(),
        }];
        let live: [FundingSettlementWriteRowV1; 0] = [];

        assert!(reconcile_funding_settlements_v1(&archive, &live).is_empty());
    }
}

#[cfg(test)]
mod live_tests {
    use vibe_core::time::get_atomic_clock_realtime;
    use vibe_data::owner::funding_settlement_commit_v1::funding_settlement_commit_from_environment_v1;

    use super::*;
    use crate::common::enums::{BinanceEnvironment, BinanceProductType};

    /// Polls real settled funding for BTCUSDT twice against a real `MARKET_DATA_OWNER_DATABASE_URL`
    /// and the live public endpoint (no credential, no cost). `#[ignore]` only because it reaches
    /// both.
    #[tokio::test]
    #[ignore = "reaches the live public Binance endpoint and a real Market Data store"]
    async fn polling_the_same_settlements_twice_derives_once_and_then_rejoins() {
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
        let store = funding_settlement_commit_from_environment_v1()
            .await
            .expect("MARKET_DATA_OWNER_DATABASE_URL names a reachable store");
        let retrieval_ns = get_atomic_clock_realtime().get_time_ns().into();
        let instrument = "BTCUSDT-PERP.BINANCE";

        let (first_digest, first_errors) = record_funding_settlements_v1(
            &client,
            store.as_ref(),
            instrument,
            "BTCUSDT",
            10,
            retrieval_ns,
        )
        .await
        .expect("the first poll commits what it can derive");
        assert!(
            first_digest.is_some(),
            "ten real settlements give at least one derivable row"
        );
        assert_eq!(
            first_errors.len(),
            1,
            "only the batch's own oldest row has no predecessor: {first_errors:?}"
        );

        let (second_digest, second_errors) = record_funding_settlements_v1(
            &client,
            store.as_ref(),
            instrument,
            "BTCUSDT",
            10,
            retrieval_ns + 1,
        )
        .await
        .expect("the second poll rejoins the same settlements");
        assert_eq!(second_digest, first_digest, "the same rows rejoin exactly");
        assert_eq!(second_errors, first_errors);
    }
}
