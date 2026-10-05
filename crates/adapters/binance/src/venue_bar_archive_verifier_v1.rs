//! The remaining piece of B5 ("TARGET full chart timeframes and one stitched bar series",
//! `docs/owners/market-data.md`): turns one fetched archive (monthly or daily) into a
//! [`VenueBarArchiveV1`] and hands it to B1/B2's own `verify_venue_bars_v1`. The fold for `1w`/
//! `1M` lives in [`crate::venue_bar_derived_archive_v1`]; this module is the fixed-interval path
//! that actually reads an official file.

use vibe_data::owner::{
    source_binding::BindingDigest,
    venue_bar_store_v1::{
        VenueBarArchiveKindV1, VenueBarArchiveV1, VenueBarReadErrorV1, VenueBarStoreV1,
        VenueBarVerificationErrorV1, VenueBarVerificationSummaryV1,
    },
};

use crate::{
    common::offline::Sha256Digest,
    venue_bar_rest_recorder_v1::{VenueBarRestRowErrorV1, venue_bar_from_kline_row_v1},
    vision_backfill_v1::{
        FetchedBarV1, VisionBackfillErrorV1, VisionBackfillFetcherV1, day_bounds_ns,
        month_bounds_ns,
    },
};

/// Turns the archive's own verified [`Sha256Digest`] into the opaque [`BindingDigest`]
/// [`VenueBarArchiveV1::identity`] carries - a plain byte copy, no hex round-trip and no fallback,
/// so an identity is always exactly the digest that was actually verified.
#[must_use]
pub fn archive_identity(digest: Sha256Digest) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(digest.to_bytes())
}

/// Why a fetched archive could not be turned into a [`VenueBarArchiveV1`].
#[derive(Debug, thiserror::Error)]
pub enum VenueBarArchiveBuildErrorV1 {
    #[error(transparent)]
    Row(#[from] VenueBarRestRowErrorV1),
}

/// Builds the [`VenueBarArchiveV1`] one fetched archive's bars state, for `verify_venue_bars_v1`
/// to compare against the store.
///
/// # Errors
///
/// [`VenueBarArchiveBuildErrorV1`] naming why a row could not become a bar.
pub fn venue_bar_archive_from_fetched_v1(
    kind: VenueBarArchiveKindV1,
    identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    venue_interval: &str,
    fetched: &[FetchedBarV1],
) -> Result<VenueBarArchiveV1, VenueBarArchiveBuildErrorV1> {
    let bars = fetched
        .iter()
        .map(|bar| venue_bar_from_kline_row_v1(&bar.kline, venue_interval))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(VenueBarArchiveV1 {
        kind,
        identity,
        window_start_ns,
        window_end_ns_exclusive,
        bars,
    })
}

/// Why one archive could not be verified. Distinct from [`VenueBarVerificationErrorV1`], which is
/// the store's own refusal once an archive is well-formed.
#[derive(Debug, thiserror::Error)]
pub enum VerifyExecutionArchiveErrorV1 {
    #[error(transparent)]
    Fetch(#[from] VisionBackfillErrorV1),
    #[error(transparent)]
    Build(#[from] VenueBarArchiveBuildErrorV1),
    #[error(transparent)]
    Store(#[from] VenueBarVerificationErrorV1),
}

/// The identity an archive verification call shares, regardless of which period it reads.
#[derive(Clone, Copy, Debug)]
pub struct VerifyArchiveRequestV1<'a> {
    pub canonical_instrument: &'a str,
    pub raw_symbol: &'a str,
    pub venue_interval: &'a str,
    pub interval: crate::common::enums::BinanceKlineInterval,
    pub verified_ns: u64,
}

/// Fetches one archived UTC month, builds its [`VenueBarArchiveV1`], and verifies it against the
/// store's already-committed bars.
///
/// # Errors
///
/// [`VerifyExecutionArchiveErrorV1`] naming why fetching, building, or verifying failed.
pub async fn verify_execution_month_v1(
    fetcher: &VisionBackfillFetcherV1,
    store: &dyn VenueBarStoreV1,
    request: &VerifyArchiveRequestV1<'_>,
    year: i32,
    month: u8,
) -> Result<VenueBarVerificationSummaryV1, VerifyExecutionArchiveErrorV1> {
    let (digest, fetched) = fetcher
        .execution_month_with_digest(request.raw_symbol, request.interval, year, month)
        .await?;
    let (window_start_ns, window_end_ns_exclusive) = month_bounds_ns(year, month)?;
    let archive = venue_bar_archive_from_fetched_v1(
        VenueBarArchiveKindV1::MonthlyArchive,
        archive_identity(digest),
        window_start_ns,
        window_end_ns_exclusive,
        request.venue_interval,
        &fetched,
    )?;
    Ok(store
        .verify_venue_bars_v1(
            request.canonical_instrument,
            request.venue_interval,
            &archive,
            request.verified_ns,
        )
        .await?)
}

/// Fetches one archived UTC day, builds its [`VenueBarArchiveV1`], and verifies it against the
/// store's already-committed bars. Used for a day earlier than its month's own file is
/// published, and for a day a monthly file omits.
///
/// # Errors
///
/// [`VerifyExecutionArchiveErrorV1`] naming why fetching, building, or verifying failed.
pub async fn verify_execution_day_v1(
    fetcher: &VisionBackfillFetcherV1,
    store: &dyn VenueBarStoreV1,
    request: &VerifyArchiveRequestV1<'_>,
    year: i32,
    month: u8,
    day: u8,
) -> Result<VenueBarVerificationSummaryV1, VerifyExecutionArchiveErrorV1> {
    let (digest, fetched) = fetcher
        .execution_day(request.raw_symbol, request.interval, year, month, day)
        .await?;
    let (window_start_ns, window_end_ns_exclusive) = day_bounds_ns(year, month, day)?;
    let archive = venue_bar_archive_from_fetched_v1(
        VenueBarArchiveKindV1::DailyArchive,
        archive_identity(digest),
        window_start_ns,
        window_end_ns_exclusive,
        request.venue_interval,
        &fetched,
    )?;
    Ok(store
        .verify_venue_bars_v1(
            request.canonical_instrument,
            request.venue_interval,
            &archive,
            request.verified_ns,
        )
        .await?)
}

/// Folds `store`'s already-verified `1d` bars over `[window_start_ns, window_end_ns_exclusive)`
/// into a `1w` or `1M` bar and verifies it the same way a real archive is verified -
/// [`crate::venue_bar_derived_archive_v1::derived_archive_v1`] builds the
/// `DerivedFromVerified`-tagged archive this calls `verify_venue_bars_v1` with.
///
/// # Errors
///
/// [`VenueBarReadErrorV1`] if the store's own `1d` read refuses, or the fold/verify refusal
/// otherwise.
pub async fn verify_derived_from_daily_v1(
    store: &dyn VenueBarStoreV1,
    canonical_instrument: &str,
    venue_interval: &str,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    cut_ns: u64,
    verified_ns: u64,
) -> Result<VenueBarVerificationSummaryV1, VerifyDerivedErrorV1> {
    let daily_bars = store
        .read_venue_bars_v1(
            canonical_instrument,
            "1d",
            window_start_ns,
            window_end_ns_exclusive,
            cut_ns,
            true,
        )
        .await?
        .into_iter()
        .map(|read| read.bar)
        .collect::<Vec<_>>();
    // window_start_ns/window_end_ns_exclusive are not checked against the read daily_bars here:
    // derived_archive_v1's own fold already refuses by name (NotContiguous, OffGrid) whenever the
    // given bars do not land on exactly one 1w/1M grid window, so a mismatched window can only
    // ever end in one of those two refusals, never a silently wrong archive.
    let archive = crate::venue_bar_derived_archive_v1::derived_archive_v1(
        venue_interval,
        window_start_ns,
        window_end_ns_exclusive,
        &daily_bars,
    )?;
    Ok(store
        .verify_venue_bars_v1(canonical_instrument, venue_interval, &archive, verified_ns)
        .await?)
}

#[derive(Debug, thiserror::Error)]
pub enum VerifyDerivedErrorV1 {
    #[error(transparent)]
    Read(#[from] VenueBarReadErrorV1),
    #[error(transparent)]
    Fold(#[from] crate::venue_bar_derived_archive_v1::VenueBarFoldErrorV1),
    #[error(transparent)]
    Verify(#[from] VenueBarVerificationErrorV1),
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use crate::{futures::http::models::BinanceFuturesKline, vision_backfill_v1::ARCHIVE_ROUTE};

    use super::*;

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

    const MINUTE: u64 = 60_000_000_000;

    fn digest(hex_str: &str) -> Sha256Digest {
        Sha256Digest::parse(hex_str).unwrap()
    }

    #[rstest]
    fn archive_identity_is_a_plain_copy_of_the_verified_digests_bytes() {
        let a_digest = digest("2c27849bc6b152578ec54ad8cbc4c418f7653cd3e0f712de0107b289bbe0c355");

        assert_eq!(archive_identity(a_digest), archive_identity(a_digest));
    }

    #[rstest]
    fn two_different_digests_derive_two_different_identities() {
        let a = archive_identity(digest(
            "2c27849bc6b152578ec54ad8cbc4c418f7653cd3e0f712de0107b289bbe0c355",
        ));
        let b = archive_identity(digest(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ));

        assert_ne!(a, b);
    }

    #[rstest]
    fn builds_a_venue_bar_archive_with_the_given_window_and_converted_bars() {
        let fetched = vec![
            FetchedBarV1 {
                kline: row(0, 59_999),
                retrieval_ns: 1,
                route: ARCHIVE_ROUTE,
            },
            FetchedBarV1 {
                kline: row(60_000, 119_999),
                retrieval_ns: 1,
                route: ARCHIVE_ROUTE,
            },
        ];

        let archive = venue_bar_archive_from_fetched_v1(
            VenueBarArchiveKindV1::MonthlyArchive,
            archive_identity(digest(
                "2c27849bc6b152578ec54ad8cbc4c418f7653cd3e0f712de0107b289bbe0c355",
            )),
            0,
            2 * MINUTE,
            "1m",
            &fetched,
        )
        .unwrap();

        assert_eq!(archive.kind, VenueBarArchiveKindV1::MonthlyArchive);
        assert_eq!(archive.window_start_ns, 0);
        assert_eq!(archive.window_end_ns_exclusive, 2 * MINUTE);
        assert_eq!(archive.bars.len(), 2);
        assert_eq!(archive.bars[0].open_ns, 0);
        assert_eq!(archive.bars[1].open_ns, MINUTE);
    }

    #[rstest]
    fn an_off_grid_row_refuses_the_whole_archive_by_name() {
        let fetched = vec![FetchedBarV1 {
            kline: row(30_000, 89_999),
            retrieval_ns: 1,
            route: ARCHIVE_ROUTE,
        }];

        let err = venue_bar_archive_from_fetched_v1(
            VenueBarArchiveKindV1::DailyArchive,
            archive_identity(digest(
                "2c27849bc6b152578ec54ad8cbc4c418f7653cd3e0f712de0107b289bbe0c355",
            )),
            0,
            MINUTE,
            "1m",
            &fetched,
        )
        .unwrap_err();

        assert!(matches!(
            err,
            VenueBarArchiveBuildErrorV1::Row(VenueBarRestRowErrorV1::OffGrid { .. })
        ));
    }
}
