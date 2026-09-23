//! The R&D Owner's clock.
//!
//! A research view is stamped from this clock, and every cut compared with a research view, in R&D
//! and in Product Edge, is taken from it too, so no such comparison spans two clocks. It is
//! `pg_catalog.clock_timestamp()` read inside the Owner transaction that uses the reading, as
//! Qualification takes its Owner cut. The call is schema-qualified so that nothing reachable
//! through `search_path` can stand in for it.

#[cfg(test)]
use std::sync::Arc;

use sqlx::{Postgres, Transaction};

/// Where an R&D Owner transaction takes its cut.
///
/// Reading it needs the transaction, so a cut cannot be taken outside one. Production has one
/// constructor, [`Self::owner_transaction`]; a fixed reading exists only in test builds.
#[derive(Clone)]
pub(crate) struct RdOwnerClockV1 {
    #[cfg(test)]
    fixed: Option<Arc<dyn Fn() -> u64 + Send + Sync>>,
}

impl RdOwnerClockV1 {
    /// `pg_catalog.clock_timestamp()`, read inside the Owner transaction.
    #[must_use]
    pub(crate) const fn owner_transaction() -> Self {
        Self {
            #[cfg(test)]
            fixed: None,
        }
    }

    /// A reading a test pins instead of the database clock.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn fixed(reading: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        Self {
            fixed: Some(Arc::new(reading)),
        }
    }

    /// Takes one cut inside `transaction`.
    ///
    /// # Errors
    ///
    /// Returns the database failure, or a decode error if the clock reads before the epoch.
    pub(crate) async fn read(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
    ) -> Result<u64, sqlx::Error> {
        #[cfg(test)]
        if let Some(reading) = &self.fixed {
            return Ok(reading());
        }
        owner_clock_epoch_ms_in_transaction(transaction).await
    }
}

impl Default for RdOwnerClockV1 {
    fn default() -> Self {
        Self::owner_transaction()
    }
}

/// `pg_catalog.clock_timestamp()` in epoch milliseconds, read inside `transaction`.
///
/// # Errors
///
/// Returns the database failure, or a decode error if the clock reads before the epoch.
pub(crate) async fn owner_clock_epoch_ms_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, sqlx::Error> {
    let value: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await?;
    u64::try_from(value).map_err(|e| sqlx::Error::Decode(Box::new(e)))
}
