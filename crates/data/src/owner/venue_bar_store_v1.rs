//! Market Data's own store of venue-native bars at every served timeframe (slice B1 of "TARGET
//! full chart timeframes and one stitched bar series", `docs/owners/market-data.md`).
//!
//! Public REST is the primary source for every timeframe and month; the official archives only
//! verify it later (slice B2). Each bar is a chain of versions, keyed by instrument, timeframe
//! label and open instant, and is only ever appended to: a re-fetch with the same content rejoins,
//! a re-fetch with different content is recorded as a named conflict and never overwrites the
//! stored bar, and a correction is a later version an operator appends (slice B2).

use std::fmt::Debug;

use async_trait::async_trait;
use rust_decimal::Decimal;

use super::source_binding::BindingDigest;

/// How long after its close a bar can still change as late trades land. Measured: up to 9.5 s on
/// Binance USD-M REST (`docs/owners/market-data.md`); a bar is admitted only once its close plus
/// this delay is before its retrieval.
pub const VENUE_BAR_SETTLE_DELAY_NS_V1: u64 = 30_000_000_000;

/// One native bar as the venue published it: its interval, prices and volumes, all exact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VenueBarV1 {
    pub open_ns: u64,
    /// The interval-close instant, exclusive: the next bar's open.
    pub close_ns_exclusive: u64,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: Decimal,
    pub quote_volume: Decimal,
    pub trade_count: u64,
    pub taker_buy_volume: Decimal,
    pub taker_buy_quote_volume: Decimal,
}

/// When a page's bars became knowable.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VenueBarAvailabilityV1 {
    /// Read live: knowable at its retrieval instant.
    AtRetrieval,
    /// Backfilled history: knowable `lag_ns` after its close, as its Source Binding declares.
    AfterClose { lag_ns: u64 },
}

/// Where a stored version came from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VenueBarSourceV1 {
    /// The venue's public REST endpoint.
    Rest,
    /// An operator's correction resolving a recorded conflict (slice B2).
    Correction,
}

/// A re-fetched bar whose content differs from the stored version; nothing was overwritten.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VenueBarConflictV1 {
    /// `BAR_CONTENT_CONFLICT`'s identity: one per stored and offered content pair.
    pub conflict_identity: BindingDigest,
    pub open_ns: u64,
    /// The stored version the offered content differs from.
    pub stored_version: u32,
    /// The fields that differ, in column order.
    pub fields: Vec<&'static str>,
}

/// What one page's commit did.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VenueBarCommitSummaryV1 {
    pub written: u64,
    pub rejoined: u64,
    pub conflicts: Vec<VenueBarConflictV1>,
}

/// Why a page was not committed. Every refusal writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarWriteErrorV1 {
    /// An empty instrument or page, an interval Market Data does not serve, or bars not in strictly
    /// ascending open order.
    #[error("the venue bar page is malformed")]
    InvalidRequest,
    /// `BAR_OFF_GRID`: a bar whose open is not on its timeframe's grid, or whose close is not that
    /// open's close.
    #[error("a bar opening at {open_ns} is not on its timeframe's grid")]
    BarOffGrid { open_ns: u64 },
    /// `BAR_NOT_SETTLED`: a bar whose close plus the settle delay is not before its retrieval.
    #[error("a bar opening at {open_ns} had not settled when it was retrieved")]
    BarNotSettled { open_ns: u64 },
    /// `BAR_INCONSISTENT`: a bar whose prices or volumes cannot be a bar.
    #[error("a bar opening at {open_ns} is inconsistent")]
    BarInconsistent { open_ns: u64 },
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// One bar as a point-in-time read selects it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VenueBarReadV1 {
    pub bar: VenueBarV1,
    pub version: u32,
    pub source: VenueBarSourceV1,
    pub retrieval_ns: u64,
    pub availability_ns: u64,
    /// Whether an official archive confirmed this version (slice B2).
    pub verified: bool,
}

/// Why a read answered nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarReadErrorV1 {
    /// An empty instrument or window, or an interval Market Data does not serve.
    #[error("the venue bar read is malformed")]
    InvalidRequest,
    /// `BAR_NOT_VERIFIED`: a `verified_only` read over a window holding an unverified bar.
    #[error("the bar opening at {open_ns} is not verified")]
    NotVerified { open_ns: u64 },
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// Which official source confirms stored bars (slice B2).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VenueBarArchiveKindV1 {
    /// The venue's monthly archive file.
    MonthlyArchive,
    /// The venue's daily archive file, published the next day.
    DailyArchive,
    /// A derivation from already verified finer bars, for `1w` and `1M`, whose monthly archive
    /// files hold a snapshot of a bar still forming.
    DerivedFromVerified,
}

impl VenueBarArchiveKindV1 {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::MonthlyArchive => "MONTHLY_ARCHIVE",
            Self::DailyArchive => "DAILY_ARCHIVE",
            Self::DerivedFromVerified => "DERIVED_FROM_VERIFIED",
        }
    }
}

/// One archive's bars for an instrument and timeframe, as its reader authenticated them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VenueBarArchiveV1 {
    pub kind: VenueBarArchiveKindV1,
    /// The archive's own identity: its file's digest, or the derivation's.
    pub identity: BindingDigest,
    /// The window the archive covers, `[start, end)` over bar closes.
    pub window_start_ns: u64,
    pub window_end_ns_exclusive: u64,
    /// Its bars, in strictly ascending open order, each inside the window.
    pub bars: Vec<VenueBarV1>,
}

/// What one verification did.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VenueBarVerificationSummaryV1 {
    /// Stored bars the archive confirmed, each now verified.
    pub verified: u64,
    /// Stored bars the archive states differently: recorded as conflicts, left unverified.
    pub conflicts: Vec<VenueBarConflictV1>,
    /// Archive bars the store does not hold yet; nothing is written for them.
    pub archive_only: Vec<u64>,
    /// Stored bars inside the window the archive does not hold; they stay unverified.
    pub store_only: Vec<u64>,
}

/// Why a verification was not made. Every refusal writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarVerificationErrorV1 {
    /// An empty instrument or window, an unserved interval, bars out of order or outside the
    /// window.
    #[error("the venue bar verification is malformed")]
    InvalidRequest,
    /// `BAR_OFF_GRID`: an archive bar whose open is not on its timeframe's grid.
    #[error("an archive bar opening at {open_ns} is not on its timeframe's grid")]
    BarOffGrid { open_ns: u64 },
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// A recorded conflict no correction has resolved yet.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VenueBarOpenConflictV1 {
    pub conflict_identity: BindingDigest,
    pub open_ns: u64,
    pub stored_version: u32,
    /// `REST`, or the archive kind that offered the differing content.
    pub offered_side: String,
    /// The offered content in canonical column order.
    pub offered_values: String,
}

/// Why a correction was not appended. Every refusal writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarCorrectionErrorV1 {
    #[error("the venue bar correction is malformed")]
    InvalidRequest,
    /// `BAR_CONFLICT_UNKNOWN`: no conflict of this identity is recorded for this bar.
    #[error("no such conflict is recorded")]
    UnknownConflict,
    /// `BAR_CONFLICT_SUPERSEDED`: the bar has a later version than the one the conflict names.
    #[error("the conflict names a version that is no longer the bar's latest")]
    ConflictSuperseded,
    /// `BAR_OFF_GRID` or `BAR_INCONSISTENT` for the corrected bar.
    #[error("the corrected bar cannot be stored")]
    BarRefused,
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// The sealed venue bar store. A recorder writes through it; no consumer can implement it.
#[async_trait]
pub trait VenueBarStoreV1: Send + Sync + sealed::Sealed {
    /// Commits one page of `instrument`'s bars at `venue_interval`, all retrieved at
    /// `retrieval_ns`, in one transaction: each bar is written as version 1, rejoined when stored
    /// with the same content, or recorded as a conflict when stored with different content.
    ///
    /// # Errors
    ///
    /// The refusal that names why nothing was written.
    async fn commit_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        availability: VenueBarAvailabilityV1,
        retrieval_ns: u64,
        bars: &[VenueBarV1],
    ) -> Result<VenueBarCommitSummaryV1, VenueBarWriteErrorV1>;

    /// The bars of `instrument` at `venue_interval` whose close lies in `[window_start_ns,
    /// window_end_ns_exclusive)`, in open order, each the latest version available at `cut_ns`.
    /// A bar with no version available at the cut is absent.
    ///
    /// # Errors
    ///
    /// `NotVerified` when `verified_only` and a selected version is unverified.
    async fn read_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
        cut_ns: u64,
        verified_only: bool,
    ) -> Result<Vec<VenueBarReadV1>, VenueBarReadErrorV1>;

    /// Verifies the stored bars of `instrument` at `venue_interval` against one archive, at
    /// `verified_ns`: each stored bar the archive states identically gains a verification record,
    /// each it states differently is recorded as a conflict and stays unverified, and nothing is
    /// ever deleted or overwritten. Archive bars the store lacks, and stored bars the archive
    /// lacks, are reported and left alone.
    ///
    /// # Errors
    ///
    /// The refusal that names why nothing was written.
    async fn verify_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        archive: &VenueBarArchiveV1,
        verified_ns: u64,
    ) -> Result<VenueBarVerificationSummaryV1, VenueBarVerificationErrorV1>;

    /// The conflicts recorded for `instrument` at `venue_interval` that no correction resolves,
    /// in open order.
    ///
    /// # Errors
    ///
    /// `InvalidRequest` for an unserved interval, `StoreUnavailable` otherwise.
    async fn open_venue_bar_conflicts_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
    ) -> Result<Vec<VenueBarOpenConflictV1>, VenueBarReadErrorV1>;

    /// Appends an operator's correction resolving `conflict_identity`: the bar's next version,
    /// sourced `CORRECTION`, available from `available_ns`. The read selects it only from then on.
    ///
    /// # Errors
    ///
    /// The refusal that names why nothing was written.
    async fn correct_venue_bar_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        conflict_identity: BindingDigest,
        corrected: VenueBarV1,
        available_ns: u64,
    ) -> Result<u32, VenueBarCorrectionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured venue bar store on the Market Data Owner's store, named by
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// [`VenueBarWriteErrorV1::StoreUnavailable`] when the URL is missing or the store cannot be
/// opened.
pub async fn venue_bar_store_from_environment_v1()
-> Result<std::sync::Arc<dyn VenueBarStoreV1>, VenueBarWriteErrorV1> {
    super::postgres::venue_bar_store_from_environment_v1().await
}
