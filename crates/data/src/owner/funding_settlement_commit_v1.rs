//! The sealed intake for Market Data's own settled funding facts
//! (`postgres/funding_settlement_v1.rs`'s own doc: funding stays outside T0 window custody, so
//! this is a plain idempotent fact write, not a custody commit).
//!
//! A backfill writer calls [`FundingSettlementCommitV1::commit_funding_settlements_v1`] once per
//! window it has already authenticated (`crates/adapters/binance/src/funding_archive_v1.rs`'s own
//! reader); no consumer outside Market Data can implement the trait.

use async_trait::async_trait;
use rust_decimal::Decimal;

use super::source_binding::BindingDigest;

/// One settlement to commit, already authenticated by its own reader
/// (`crates/adapters/binance/src/funding_archive_v1.rs::FundingArchiveRowV1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FundingSettlementWriteRowV1 {
    pub settlement_ns: u64,
    pub interval_hours: u8,
    pub rate: Decimal,
}

/// Why a funding settlement write was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum FundingSettlementWriteErrorV1 {
    /// The request is malformed: an empty instrument, an empty route, a window that does not
    /// advance, or a settlement whose `settlement_ns` falls outside the stated window.
    #[error("the funding settlement write request is malformed")]
    InvalidRequest,
    /// A row already committed under the same `(instrument, settlement_ns)` states different
    /// content than this call does. Real archive content never differs between two fetches of
    /// the same real settlement, so this names a defect in the caller or the source, not a race
    /// to resolve quietly; nothing is written.
    #[error("a committed settlement's content does not match this call's")]
    Conflict,
    /// The store could not be reached.
    #[error("the funding settlement store is unavailable")]
    StoreUnavailable,
}

/// The sealed funding settlement intake. A backfill writer calls it; no consumer can implement it.
#[async_trait]
pub trait FundingSettlementCommitV1: Send + Sync + sealed::Sealed {
    /// Commits every row of `rows` for `instrument`, idempotently, then records
    /// `[window_start_ns, window_end_ns_exclusive)` as covered, in one transaction.
    ///
    /// # Errors
    ///
    /// Returns the refusal that names why nothing was written.
    async fn commit_funding_settlements_v1(
        &self,
        instrument: &str,
        rows: &[FundingSettlementWriteRowV1],
        retrieval_ns: u64,
        retrieval_route: &str,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<BindingDigest, FundingSettlementWriteErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured funding settlement intake on the Market Data Owner's store, named by
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns [`FundingSettlementWriteErrorV1::StoreUnavailable`] when the URL is missing or the
/// store cannot be opened.
pub async fn funding_settlement_commit_from_environment_v1()
-> Result<std::sync::Arc<dyn FundingSettlementCommitV1>, FundingSettlementWriteErrorV1> {
    super::postgres::funding_settlement_commit_from_environment_v1().await
}
