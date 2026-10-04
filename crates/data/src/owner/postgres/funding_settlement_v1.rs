//! Market Data's own settled funding facts: one append-only row per member settlement, plus one
//! row per committed backfill range.
//!
//! Funding stays outside T0 window custody by design (`docs/owners/market-data.md`'s "Funding
//! stays outside this custody for now"), so this is a plain fact table, not a custody chain: a
//! settlement's identity is exactly `(instrument, settlement_ns)`. Writing the same real
//! settlement twice rejoins the existing row rather than writing a second one, but only when the
//! content matches exactly; a row already held under that identity with *different* content is
//! `FundingSettlementWriteErrorV1::Conflict`, with nothing written, never a quiet overwrite or a
//! quiet keep. The coverage table records which exact half-open ranges were committed, separately
//! from the rows themselves, because an empty result for a window is ambiguous on its own - it is
//! either "the venue settled nothing in this window" or "this window was never backfilled" - and
//! only a recorded coverage range tells those apart (`replay_funding_schedule_v1.rs`'s own doc:
//! "An empty list ... is never an answer for missing data").
//!
//! **These facts carry no availability semantic and are not a strategy input.** The archive and
//! the live endpoint both state a settlement only after it has already applied; measured against
//! the live endpoint, a settlement's real publication lag behind its own `calc_time` is on the
//! order of twelve seconds. A fact here is knowable only once its own settlement instant has
//! passed, which is exactly late enough to price the realized P&L of a position that already paid
//! or received it, and too late for a Plan to read it as an input to a decision at or before that
//! instant.

use sqlx::Row;

use super::MarketDataOwnerPostgres;
use crate::owner::source_binding::BindingDigest;

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.funding_settlement_facts_v1 (instrument TEXT NOT NULL CHECK (instrument<>''), settlement_ns BIGINT NOT NULL CHECK (settlement_ns>0), interval_hours SMALLINT NOT NULL CHECK (interval_hours>0), rate NUMERIC NOT NULL, retrieval_ns BIGINT NOT NULL CHECK (retrieval_ns>0), retrieval_route TEXT NOT NULL CHECK (retrieval_route<>''), PRIMARY KEY (instrument, settlement_ns))",
    "REVOKE ALL ON TABLE market_data_private.funding_settlement_facts_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.funding_settlement_coverage_v1 (instrument TEXT NOT NULL CHECK (instrument<>''), window_start_ns BIGINT NOT NULL CHECK (window_start_ns>=0), window_end_ns_exclusive BIGINT NOT NULL CHECK (window_end_ns_exclusive>window_start_ns), committed_at_ns BIGINT NOT NULL CHECK (committed_at_ns>0), PRIMARY KEY (instrument, window_start_ns, window_end_ns_exclusive))",
    "REVOKE ALL ON TABLE market_data_private.funding_settlement_coverage_v1 FROM PUBLIC",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_funding_settlements_v1(p_instrument TEXT, p_window_start_ns BIGINT, p_window_end_ns_exclusive BIGINT) RETURNS TABLE(settlement_ns BIGINT, interval_hours SMALLINT, rate NUMERIC) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$ SELECT f.settlement_ns, f.interval_hours, f.rate FROM market_data_private.funding_settlement_facts_v1 AS f WHERE f.instrument = p_instrument AND f.settlement_ns >= p_window_start_ns AND f.settlement_ns < p_window_end_ns_exclusive ORDER BY f.settlement_ns $function$",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_funding_settlements_v1(TEXT,BIGINT,BIGINT) FROM PUBLIC",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_funding_settlement_coverage_v1(p_instrument TEXT) RETURNS TABLE(window_start_ns BIGINT, window_end_ns_exclusive BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$ SELECT c.window_start_ns, c.window_end_ns_exclusive FROM market_data_private.funding_settlement_coverage_v1 AS c WHERE c.instrument = p_instrument ORDER BY c.window_start_ns $function$",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_funding_settlement_coverage_v1(TEXT) FROM PUBLIC",
];

/// Why a funding backfill write was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(crate) enum FundingSettlementWriteErrorV1 {
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

/// One settlement to commit, already authenticated by its own reader
/// (`crates/adapters/binance/src/funding_archive_v1.rs::FundingArchiveRowV1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FundingSettlementWriteRowV1 {
    pub settlement_ns: u64,
    pub interval_hours: u8,
    pub rate: rust_decimal::Decimal,
}

impl MarketDataOwnerPostgres {
    /// Commits every row of `rows` for `instrument`, idempotently, then records
    /// `[window_start_ns, window_end_ns_exclusive)` as covered, in one transaction.
    ///
    /// A settlement already committed under the same `(instrument, settlement_ns)` rejoins
    /// without a second write only when its content matches exactly; different content under the
    /// same identity is refused and nothing is written (see
    /// [`FundingSettlementWriteErrorV1::Conflict`]). The coverage range is recorded even when
    /// `rows` is empty - a window with no venue settlement is still a window this call proves was
    /// read, which is exactly what a later completeness read must be able to tell apart from a
    /// window nobody has backfilled yet.
    ///
    /// # Errors
    ///
    /// Returns [`FundingSettlementWriteErrorV1::InvalidRequest`] for an empty instrument, an empty
    /// retrieval route, a window that does not advance, or a row whose `settlement_ns` falls
    /// outside the stated window, before any write;
    /// [`FundingSettlementWriteErrorV1::Conflict`] for a row whose identity is already committed
    /// under different content, with nothing written; and
    /// [`FundingSettlementWriteErrorV1::StoreUnavailable`] when the store cannot be reached.
    pub(crate) async fn commit_funding_settlements_v1(
        &self,
        instrument: &str,
        rows: &[FundingSettlementWriteRowV1],
        retrieval_ns: u64,
        retrieval_route: &str,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<BindingDigest, FundingSettlementWriteErrorV1> {
        use FundingSettlementWriteErrorV1 as Refused;

        if instrument.is_empty()
            || retrieval_route.is_empty()
            || window_end_ns_exclusive <= window_start_ns
        {
            return Err(Refused::InvalidRequest);
        }

        if rows.iter().any(|row| {
            row.settlement_ns < window_start_ns || row.settlement_ns >= window_end_ns_exclusive
        }) {
            return Err(Refused::InvalidRequest);
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;

        for row in rows {
            let retrieval_ns_bound =
                i64::try_from(retrieval_ns).map_err(|_| Refused::InvalidRequest)?;
            let settlement_ns_bound =
                i64::try_from(row.settlement_ns).map_err(|_| Refused::InvalidRequest)?;
            let inserted = sqlx::query(
                "INSERT INTO market_data_private.funding_settlement_facts_v1 (instrument, settlement_ns, interval_hours, rate, retrieval_ns, retrieval_route) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (instrument, settlement_ns) DO NOTHING",
            )
            .bind(instrument)
            .bind(settlement_ns_bound)
            .bind(i16::from(row.interval_hours))
            .bind(row.rate)
            .bind(retrieval_ns_bound)
            .bind(retrieval_route)
            .execute(&mut *transaction)
            .await
            .map_err(|_| Refused::StoreUnavailable)?;

            if inserted.rows_affected() == 0 {
                // A row already exists under this identity: this call rejoins it only if the
                // content is exactly the same real settlement, never if it differs - a quiet
                // `DO NOTHING` would otherwise let a caller believe its content was committed
                // when an earlier, different value stands instead.
                let existing = sqlx::query(
                    "SELECT interval_hours, rate FROM market_data_private.funding_settlement_facts_v1 WHERE instrument=$1 AND settlement_ns=$2",
                )
                .bind(instrument)
                .bind(settlement_ns_bound)
                .fetch_one(&mut *transaction)
                .await
                .map_err(|_| Refused::StoreUnavailable)?;
                let existing_interval_hours: i16 = existing
                    .try_get("interval_hours")
                    .map_err(|_| Refused::StoreUnavailable)?;
                let existing_rate: rust_decimal::Decimal = existing
                    .try_get("rate")
                    .map_err(|_| Refused::StoreUnavailable)?;

                if existing_interval_hours != i16::from(row.interval_hours)
                    || existing_rate != row.rate
                {
                    return Err(Refused::Conflict);
                }
            }
        }
        sqlx::query(
            "INSERT INTO market_data_private.funding_settlement_coverage_v1 (instrument, window_start_ns, window_end_ns_exclusive, committed_at_ns) VALUES ($1,$2,$3,$4) ON CONFLICT (instrument, window_start_ns, window_end_ns_exclusive) DO NOTHING",
        )
        .bind(instrument)
        .bind(i64::try_from(window_start_ns).map_err(|_| Refused::InvalidRequest)?)
        .bind(i64::try_from(window_end_ns_exclusive).map_err(|_| Refused::InvalidRequest)?)
        .bind(i64::try_from(retrieval_ns).map_err(|_| Refused::InvalidRequest)?)
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;

        let digest = coverage_digest_v1(instrument, rows, window_start_ns, window_end_ns_exclusive);
        transaction
            .commit()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        Ok(digest)
    }

    #[cfg(test)]
    pub(super) async fn funding_settlement_rows_for_test(
        &self,
        instrument: &str,
    ) -> Vec<(u64, u8, rust_decimal::Decimal)> {
        sqlx::query(
            "SELECT settlement_ns, interval_hours, rate FROM market_data_private.funding_settlement_facts_v1 WHERE instrument=$1 ORDER BY settlement_ns",
        )
        .bind(instrument)
        .fetch_all(&self.pool)
        .await
        .expect("test pool reachable")
        .into_iter()
        .map(|row| {
            let settlement_ns: i64 = row.try_get("settlement_ns").expect("settlement_ns");
            let interval_hours: i16 = row.try_get("interval_hours").expect("interval_hours");
            let rate: rust_decimal::Decimal = row.try_get("rate").expect("rate");
            (
                settlement_ns.try_into().unwrap_or(0),
                interval_hours.try_into().unwrap_or(0),
                rate,
            )
        })
        .collect()
    }

    #[cfg(test)]
    pub(super) async fn funding_settlement_coverage_for_test(
        &self,
        instrument: &str,
    ) -> Vec<(u64, u64)> {
        sqlx::query(
            "SELECT window_start_ns, window_end_ns_exclusive FROM market_data_private.funding_settlement_coverage_v1 WHERE instrument=$1 ORDER BY window_start_ns",
        )
        .bind(instrument)
        .fetch_all(&self.pool)
        .await
        .expect("test pool reachable")
        .into_iter()
        .map(|row| {
            let start: i64 = row.try_get("window_start_ns").expect("window_start_ns");
            let end: i64 = row
                .try_get("window_end_ns_exclusive")
                .expect("window_end_ns_exclusive");
            (start.try_into().unwrap_or(0), end.try_into().unwrap_or(0))
        })
        .collect()
    }
}

/// A content digest of exactly what one backfill call committed: the window, and every settlement
/// it carried. Two calls that commit the same real content, at different wall-clock retrieval
/// instants, derive the same digest - the digest states what was learned, not when.
fn coverage_digest_v1(
    instrument: &str,
    rows: &[FundingSettlementWriteRowV1],
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> BindingDigest {
    use sha2::{Digest as _, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"market-data.funding-settlement-coverage.v1\0");
    hasher.update((instrument.len() as u64).to_be_bytes());
    hasher.update(instrument.as_bytes());
    hasher.update(window_start_ns.to_be_bytes());
    hasher.update(window_end_ns_exclusive.to_be_bytes());
    hasher.update((rows.len() as u64).to_be_bytes());

    for row in rows {
        hasher.update(row.settlement_ns.to_be_bytes());
        hasher.update(row.interval_hours.to_be_bytes());
        hasher.update(row.rate.normalize().to_string().as_bytes());
        hasher.update(0u8.to_be_bytes());
    }
    let bytes: [u8; 32] = hasher.finalize().into();
    BindingDigest::from_untrusted_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use rust_decimal::Decimal;

    use super::{FundingSettlementWriteRowV1, coverage_digest_v1};

    fn row(settlement_ns: u64, rate: &str) -> FundingSettlementWriteRowV1 {
        FundingSettlementWriteRowV1 {
            settlement_ns,
            interval_hours: 8,
            rate: Decimal::from_str_exact(rate).unwrap(),
        }
    }

    #[rstest]
    fn the_same_committed_content_derives_the_same_digest_at_a_different_wall_clock() {
        let rows = [row(1, "0.0001"), row(2, "0.0002")];
        let first = coverage_digest_v1("BTCUSDT-PERP.BINANCE", &rows, 0, 10);
        let second = coverage_digest_v1("BTCUSDT-PERP.BINANCE", &rows, 0, 10);
        assert_eq!(first, second);
    }

    #[rstest]
    fn a_different_window_derives_a_different_digest() {
        let rows = [row(1, "0.0001")];
        let narrow = coverage_digest_v1("BTCUSDT-PERP.BINANCE", &rows, 0, 10);
        let wide = coverage_digest_v1("BTCUSDT-PERP.BINANCE", &rows, 0, 20);
        assert_ne!(narrow, wide);
    }
}

/// Real PostgreSQL proof: the write path's idempotent rejoin, its conflict refusal, an empty
/// window's coverage, an out-of-window row's refusal, and that no role but the owner can read the
/// tables or call the private functions directly.
#[cfg(test)]
mod postgres_proof_v1 {
    use std::env;

    use rust_decimal::Decimal;
    use sqlx::Row;

    use super::{FundingSettlementWriteErrorV1, FundingSettlementWriteRowV1};
    use crate::owner::postgres::MarketDataOwnerPostgres;

    async fn connect() -> MarketDataOwnerPostgres {
        MarketDataOwnerPostgres::connect(&env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap())
            .await
            .expect("the disposable Owner connects and migrates")
    }

    fn row(settlement_ns: u64, interval_hours: u8, rate: &str) -> FundingSettlementWriteRowV1 {
        FundingSettlementWriteRowV1 {
            settlement_ns,
            interval_hours,
            rate: Decimal::from_str_exact(rate).unwrap(),
        }
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn committing_the_same_real_content_twice_rejoins_without_a_second_row() {
        let owner = connect().await;
        let instrument = "BTCUSDT-PERP.BINANCE-PROOF-REJOIN";
        let rows = [row(1_704_067_200_000_000_000, 8, "0.00037409")];

        owner
            .commit_funding_settlements_v1(
                instrument,
                &rows,
                1,
                "proof",
                0,
                2_000_000_000_000_000_000,
            )
            .await
            .expect("first commit succeeds");
        owner
            .commit_funding_settlements_v1(
                instrument,
                &rows,
                2,
                "proof",
                0,
                2_000_000_000_000_000_000,
            )
            .await
            .expect("rejoining the exact same content succeeds");

        let stored = owner.funding_settlement_rows_for_test(instrument).await;
        assert_eq!(stored.len(), 1, "the real settlement is one row, not two");
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn a_different_rate_under_the_same_identity_is_refused_with_zero_writes() {
        let owner = connect().await;
        let instrument = "BTCUSDT-PERP.BINANCE-PROOF-CONFLICT";
        let first = [row(1_704_067_200_000_000_000, 8, "0.00037409")];
        let conflicting = [row(1_704_067_200_000_000_000, 8, "0.00099999")];

        owner
            .commit_funding_settlements_v1(
                instrument,
                &first,
                1,
                "proof",
                0,
                2_000_000_000_000_000_000,
            )
            .await
            .expect("first commit succeeds");
        let result = owner
            .commit_funding_settlements_v1(
                instrument,
                &conflicting,
                2,
                "proof",
                0,
                2_000_000_000_000_000_000,
            )
            .await;
        assert_eq!(result, Err(FundingSettlementWriteErrorV1::Conflict));

        let stored = owner.funding_settlement_rows_for_test(instrument).await;
        assert_eq!(stored.len(), 1, "the conflicting call wrote nothing");
        assert_eq!(
            stored[0].2,
            Decimal::from_str_exact("0.00037409").unwrap(),
            "the original rate stands"
        );
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn an_empty_window_still_records_its_coverage() {
        let owner = connect().await;
        let instrument = "BTCUSDT-PERP.BINANCE-PROOF-EMPTY";

        owner
            .commit_funding_settlements_v1(instrument, &[], 1, "proof", 100, 200)
            .await
            .expect("an empty-rows window still commits coverage");

        let coverage = owner.funding_settlement_coverage_for_test(instrument).await;
        assert_eq!(coverage, vec![(100, 200)]);
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn a_settlement_outside_the_stated_window_is_refused_before_any_write() {
        let owner = connect().await;
        let instrument = "BTCUSDT-PERP.BINANCE-PROOF-OUT-OF-WINDOW";
        let rows = [row(50, 8, "0.0001")];

        let result = owner
            .commit_funding_settlements_v1(instrument, &rows, 1, "proof", 100, 200)
            .await;
        assert_eq!(result, Err(FundingSettlementWriteErrorV1::InvalidRequest));

        let stored = owner.funding_settlement_rows_for_test(instrument).await;
        assert!(stored.is_empty(), "the out-of-window call wrote nothing");
        let coverage = owner.funding_settlement_coverage_for_test(instrument).await;
        assert!(
            coverage.is_empty(),
            "the out-of-window call recorded no coverage either"
        );
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn no_role_but_the_owner_can_reach_the_tables_or_the_private_functions() {
        let owner = connect().await;
        let rows: Vec<(String, bool)> = sqlx::query(
            "SELECT relname, relacl IS NULL FROM pg_catalog.pg_class WHERE relnamespace = 'market_data_private'::regnamespace AND relname IN ('funding_settlement_facts_v1','funding_settlement_coverage_v1')",
        )
        .fetch_all(owner.pool())
        .await
        .expect("the catalog lists both tables")
        .into_iter()
        .map(|row| {
            let name: String = row.try_get("relname").expect("relname");
            let default_acl: bool = row.try_get(1).expect("relacl is null");
            (name, default_acl)
        })
        .collect();
        assert_eq!(rows.len(), 2, "both tables exist");
        assert!(
            rows.iter().all(|(_, default_acl)| !*default_acl),
            "a NULL relacl would mean PUBLIC still holds the default grant: {rows:?}"
        );

        let functions: Vec<String> = sqlx::query(
            "SELECT proname FROM pg_catalog.pg_proc WHERE pronamespace = 'market_data_private'::regnamespace AND proname IN ('resolve_funding_settlements_v1','resolve_funding_settlement_coverage_v1') AND proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(proacl) AS granted_acl WHERE granted_acl::text LIKE '=%')",
        )
        .fetch_all(owner.pool())
        .await
        .expect("the catalog lists both functions")
        .into_iter()
        .map(|row| row.try_get("proname").expect("proname"))
        .collect();
        assert_eq!(
            functions.len(),
            2,
            "both private functions have a non-default ACL with no PUBLIC grant"
        );
    }
}
