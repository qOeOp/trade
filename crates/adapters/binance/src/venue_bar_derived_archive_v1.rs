//! Folds already-verified `1d` bars into one `1w` or `1M` bar: the "Built here" item
//! `docs/owners/market-data.md`'s B5 names for those two timeframes, since a monthly archive
//! file's own `1w`/`1M` row holds a snapshot of a bar still forming (its own measurement: the
//! 2021-07 `1w` file closes the week of 2021-07-26 at a price neither the 2021-07-31 nor the
//! 2021-08-01 close agrees with) and can never verify them directly.
//!
//! The fold is treated as any other archive once built, tagged
//! [`VenueBarArchiveKindV1::DerivedFromVerified`], and handed to the store's own
//! `verify_venue_bars_v1` exactly like a real downloaded file: B1 and B2 already know how to
//! compare an archive's bars against the stored ones and report a mismatch by name, and this
//! derivation does not need a second comparison path.
//!
//! Deliberately not `TimeBarAggregator`: its historical-mode month path produces zero bars (a
//! known, separately tracked bug - a time alert historical replay never fires), and this fold
//! needs none of its live-aggregation machinery, only arithmetic over bars already in hand.

use rust_decimal::Decimal;
use vibe_data::owner::{
    bar_schedule::served_timeframe_v1,
    source_binding::BindingDigest,
    venue_bar_store_v1::{VenueBarArchiveKindV1, VenueBarArchiveV1, VenueBarV1},
};

/// Why a fold could not be built. Every refusal returns nothing.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarFoldErrorV1 {
    /// Only `1w` and `1M` fold from daily bars; every other timeframe is served directly.
    #[error("{venue_interval} does not fold from daily bars")]
    UnsupportedTimeframe { venue_interval: String },
    #[error("no daily bars were given to fold")]
    Empty,
    /// A daily bar's open does not equal the previous one's close: the window has a gap, or the
    /// bars were not given in ascending order.
    #[error(
        "daily bars are not contiguous: a bar opening at {open_ns} does not open at the previous bar's close"
    )]
    NotContiguous { open_ns: u64 },
    /// The folded window's own open and close do not land on `venue_interval`'s grid - the given
    /// bars do not span exactly one week or one calendar month.
    #[error("the folded window does not match {venue_interval}'s own grid")]
    OffGrid { venue_interval: String },
}

/// Folds `daily_bars` (ascending, contiguous, covering exactly one `venue_interval` window) into
/// the one bar they would be read as at that timeframe: first open, last close, the extreme high
/// and low, and the sum of every volume, trade-count and taker-buy column.
///
/// # Errors
///
/// [`VenueBarFoldErrorV1`] naming why the bars cannot be folded.
pub fn fold_daily_bars_v1(
    venue_interval: &str,
    daily_bars: &[VenueBarV1],
) -> Result<VenueBarV1, VenueBarFoldErrorV1> {
    if venue_interval != "1w" && venue_interval != "1M" {
        return Err(VenueBarFoldErrorV1::UnsupportedTimeframe {
            venue_interval: venue_interval.to_string(),
        });
    }
    let Some(timeframe) = served_timeframe_v1(venue_interval) else {
        return Err(VenueBarFoldErrorV1::UnsupportedTimeframe {
            venue_interval: venue_interval.to_string(),
        });
    };

    let (Some(&first), Some(&last)) = (daily_bars.first(), daily_bars.last()) else {
        return Err(VenueBarFoldErrorV1::Empty);
    };

    let mut previous_close = first.open_ns;
    let mut high = first.high;
    let mut low = first.low;
    let mut volume = Decimal::ZERO;
    let mut quote_volume = Decimal::ZERO;
    let mut trade_count = 0u64;
    let mut taker_buy_volume = Decimal::ZERO;
    let mut taker_buy_quote_volume = Decimal::ZERO;

    for bar in daily_bars {
        if bar.open_ns != previous_close {
            return Err(VenueBarFoldErrorV1::NotContiguous {
                open_ns: bar.open_ns,
            });
        }
        previous_close = bar.close_ns_exclusive;
        high = high.max(bar.high);
        low = low.min(bar.low);
        volume += bar.volume;
        quote_volume += bar.quote_volume;
        trade_count += bar.trade_count;
        taker_buy_volume += bar.taker_buy_volume;
        taker_buy_quote_volume += bar.taker_buy_quote_volume;
    }
    let open_ns = first.open_ns;
    let close_ns_exclusive = previous_close;

    if timeframe.close_of(open_ns) != Some(close_ns_exclusive) {
        return Err(VenueBarFoldErrorV1::OffGrid {
            venue_interval: venue_interval.to_string(),
        });
    }

    Ok(VenueBarV1 {
        open_ns,
        close_ns_exclusive,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
        quote_volume,
        trade_count,
        taker_buy_volume,
        taker_buy_quote_volume,
    })
}

fn derived_identity_v1(daily_bars: &[VenueBarV1]) -> BindingDigest {
    let mut canonical = String::new();
    for bar in daily_bars {
        canonical.push_str(&format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
            bar.open_ns,
            bar.close_ns_exclusive,
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume,
            bar.quote_volume,
            bar.trade_count,
            bar.taker_buy_volume,
            bar.taker_buy_quote_volume,
        ));
    }
    let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, canonical.as_bytes());
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(digest.as_ref());
    BindingDigest::from_untrusted_bytes(bytes)
}

/// Builds the `1w`/`1M` derivation as a [`VenueBarArchiveV1`], ready for `verify_venue_bars_v1`
/// exactly like a real downloaded archive. `identity` is a digest of the folded daily bars'
/// own content, not of any file - there is no file - so the same daily bars always derive the
/// same identity, and a differing set (a correction landing on one of them) derives a new one.
///
/// # Errors
///
/// [`VenueBarFoldErrorV1`] naming why the fold could not be built.
pub fn derived_archive_v1(
    venue_interval: &str,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    daily_bars: &[VenueBarV1],
) -> Result<VenueBarArchiveV1, VenueBarFoldErrorV1> {
    let folded = fold_daily_bars_v1(venue_interval, daily_bars)?;
    Ok(VenueBarArchiveV1 {
        kind: VenueBarArchiveKindV1::DerivedFromVerified,
        identity: derived_identity_v1(daily_bars),
        window_start_ns,
        window_end_ns_exclusive,
        bars: vec![folded],
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use rust_decimal_macros::dec;

    use super::*;

    const DAY: u64 = 86_400_000_000_000;
    // 1970-01-01 was a Thursday; the first Monday 00:00 UTC is four days later.
    const MONDAY_NS: u64 = 4 * DAY;

    fn day(open_ns: u64, open: Decimal, high: Decimal, low: Decimal, close: Decimal) -> VenueBarV1 {
        VenueBarV1 {
            open_ns,
            close_ns_exclusive: open_ns + DAY,
            open,
            high,
            low,
            close,
            volume: dec!(10),
            quote_volume: dec!(1000),
            trade_count: 5,
            taker_buy_volume: dec!(4),
            taker_buy_quote_volume: dec!(400),
        }
    }

    #[rstest]
    fn folds_a_week_of_daily_bars_into_their_first_open_last_close_and_extremes() {
        let week: Vec<VenueBarV1> = (0..7)
            .map(|i| {
                day(
                    MONDAY_NS + i * DAY,
                    dec!(100),
                    dec!(100) + Decimal::from(i),
                    dec!(90) - Decimal::from(i),
                    dec!(105),
                )
            })
            .collect();

        let folded = fold_daily_bars_v1("1w", &week).unwrap();

        assert_eq!(folded.open_ns, MONDAY_NS);
        assert_eq!(folded.close_ns_exclusive, MONDAY_NS + 7 * DAY);
        assert_eq!(folded.open, dec!(100));
        assert_eq!(folded.close, dec!(105));
        assert_eq!(folded.high, dec!(106));
        assert_eq!(folded.low, dec!(84));
        assert_eq!(folded.volume, dec!(70));
        assert_eq!(folded.trade_count, 35);
    }

    #[rstest]
    fn folds_a_calendar_month_of_daily_bars() {
        // 2021-01-01T00:00:00Z, a 31-day January.
        const JAN_2021_NS: u64 = 1_609_459_200_000_000_000;
        let month: Vec<VenueBarV1> = (0..31)
            .map(|i| {
                day(
                    JAN_2021_NS + i * DAY,
                    dec!(100),
                    dec!(101),
                    dec!(99),
                    dec!(100),
                )
            })
            .collect();

        let folded = fold_daily_bars_v1("1M", &month).unwrap();

        assert_eq!(folded.open_ns, JAN_2021_NS);
        assert_eq!(folded.close_ns_exclusive, JAN_2021_NS + 31 * DAY);
    }

    #[rstest]
    fn refuses_a_gap_between_daily_bars_by_name() {
        let bars = vec![
            day(MONDAY_NS, dec!(1), dec!(1), dec!(1), dec!(1)),
            day(MONDAY_NS + 2 * DAY, dec!(1), dec!(1), dec!(1), dec!(1)),
        ];

        let err = fold_daily_bars_v1("1w", &bars).unwrap_err();

        assert_eq!(
            err,
            VenueBarFoldErrorV1::NotContiguous {
                open_ns: MONDAY_NS + 2 * DAY
            }
        );
    }

    #[rstest]
    fn refuses_a_window_that_is_not_exactly_one_week() {
        let bars: Vec<VenueBarV1> = (0..6)
            .map(|i| day(MONDAY_NS + i * DAY, dec!(1), dec!(1), dec!(1), dec!(1)))
            .collect();

        let err = fold_daily_bars_v1("1w", &bars).unwrap_err();

        assert_eq!(
            err,
            VenueBarFoldErrorV1::OffGrid {
                venue_interval: "1w".to_string()
            }
        );
    }

    #[rstest]
    fn refuses_an_unsupported_timeframe_by_name() {
        let bars = vec![day(0, dec!(1), dec!(1), dec!(1), dec!(1))];

        let err = fold_daily_bars_v1("1h", &bars).unwrap_err();

        assert_eq!(
            err,
            VenueBarFoldErrorV1::UnsupportedTimeframe {
                venue_interval: "1h".to_string()
            }
        );
    }

    #[rstest]
    fn the_same_daily_bars_always_derive_the_same_identity() {
        let week: Vec<VenueBarV1> = (0..7)
            .map(|i| {
                day(
                    MONDAY_NS + i * DAY,
                    dec!(100),
                    dec!(101),
                    dec!(99),
                    dec!(100),
                )
            })
            .collect();

        let first = derived_archive_v1("1w", MONDAY_NS, MONDAY_NS + 7 * DAY, &week).unwrap();
        let second = derived_archive_v1("1w", MONDAY_NS, MONDAY_NS + 7 * DAY, &week).unwrap();

        assert_eq!(first.identity, second.identity);
    }

    #[rstest]
    fn a_differing_correction_derives_a_different_identity() {
        let week: Vec<VenueBarV1> = (0..7)
            .map(|i| {
                day(
                    MONDAY_NS + i * DAY,
                    dec!(100),
                    dec!(101),
                    dec!(99),
                    dec!(100),
                )
            })
            .collect();
        let mut corrected = week.clone();
        corrected[3].close = dec!(100.5);

        let first = derived_archive_v1("1w", MONDAY_NS, MONDAY_NS + 7 * DAY, &week).unwrap();
        let second = derived_archive_v1("1w", MONDAY_NS, MONDAY_NS + 7 * DAY, &corrected).unwrap();

        assert_ne!(first.identity, second.identity);
    }
}
