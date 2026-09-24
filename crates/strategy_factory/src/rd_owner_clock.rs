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

#[cfg(test)]
mod tests {
    use rstest::rstest;

    /// The research-custody sources: everything that stamps a research view or compares a cut
    /// with one, and the Dashboard projections whose observation time is compared with the commit
    /// times they carry.
    const RESEARCH_CUSTODY_SOURCES: [(&str, &str); 9] = [
        ("rd_owner_clock.rs", include_str!("rd_owner_clock.rs")),
        (
            "product_edge_postgres.rs",
            include_str!("product_edge_postgres.rs"),
        ),
        (
            "successor_intent_postgres.rs",
            include_str!("successor_intent_postgres.rs"),
        ),
        (
            "artifact_build_postgres.rs",
            include_str!("artifact_build_postgres.rs"),
        ),
        (
            "source_research_composer_postgres_v2.rs",
            include_str!("source_research_composer_postgres_v2.rs"),
        ),
        (
            "rd_bounded_feature_program_postgres_v1.rs",
            include_str!("rd_bounded_feature_program_postgres_v1.rs"),
        ),
        (
            "rd_owner_postgres_custody.rs",
            include_str!("rd_owner_postgres_custody.rs"),
        ),
        ("dashboard_read.rs", include_str!("dashboard_read.rs")),
        (
            "rd_historical_custody_postgres.rs",
            include_str!("rd_historical_custody_postgres.rs"),
        ),
    ];

    /// The source a production build compiles: without the test module and without any
    /// top-level function gated on `cfg(test)`.
    fn production_source(source: &str) -> String {
        let production = source
            .split("\n#[cfg(test)]\nmod ")
            .next()
            .expect("production source");
        let mut kept = String::with_capacity(production.len());
        let mut rest = production;
        while let Some(at) = rest.find("#[cfg(test)]\n") {
            kept.push_str(&rest[..at]);
            let gated = &rest[at..];
            let end = gated.find("\n}\n").map_or(gated.len(), |end| end + 3);
            rest = &gated[end..];
        }
        kept.push_str(rest);
        kept
    }

    fn process_clock_reads(source: &str) -> Vec<&'static str> {
        [
            "SystemTime",
            "LiveClock",
            "current_epoch_ms(",
            "now_ms(",
            "RdOwnerClockV1::fixed(",
        ]
        .into_iter()
        .filter(|read| source.contains(read))
        .collect()
    }

    /// A research view is stamped from the R&D Owner's clock and compared with cuts from it, so no
    /// production path in these sources reads another clock or pins one.
    #[rstest]
    fn research_custody_reads_only_the_owner_transaction_clock() {
        for (name, source) in RESEARCH_CUSTODY_SOURCES {
            assert_eq!(
                process_clock_reads(&production_source(source)),
                Vec::<&str>::new(),
                "{name}"
            );
        }

        // The same reading finds a process-clock read in production code, and ignores one in a
        // function only test builds compile.
        let synthetic = "fn cut() -> u64 {\n    std::time::SystemTime::now();\n}\n\
                         #[cfg(test)]\nfn test_cut() -> u64 {\n    current_epoch_ms()\n}\n\
                         #[cfg(test)]\nmod tests {\n    fn now_ms() {}\n}\n";
        assert_eq!(
            process_clock_reads(&production_source(synthetic)),
            ["SystemTime"]
        );
    }
}
