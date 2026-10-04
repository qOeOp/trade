//! Market Data's own settled funding facts: one append-only row per member settlement, plus one
//! row per committed backfill range.
//!
//! Funding stays outside T0 window custody by design (`docs/owners/market-data.md`'s "Funding
//! stays outside this custody for now"), so this is a plain fact table, not a custody chain: a
//! settlement's identity is exactly `(instrument, settlement_ns)`, and writing the same real
//! settlement twice is `ON CONFLICT DO NOTHING`, never a second row. The coverage table records
//! which exact half-open ranges were committed, separately from the rows themselves, because an
//! empty result for a window is ambiguous on its own - it is either "the venue settled nothing in
//! this window" or "this window was never backfilled" - and only a recorded coverage range tells
//! those apart (`replay_funding_schedule_v1.rs`'s own doc: "An empty list ... is never an answer
//! for missing data").

use rust_decimal::Decimal;
use sqlx::Row;

use super::MarketDataOwnerPostgres;
use crate::owner::{
    native_replay_scheduling_v1::ReplayFundingScheduleResolutionErrorV1,
    replay_funding_schedule_v1::{
        FundingSettlementV1, MemberFundingScheduleV1, ReplayFundingScheduleV1,
    },
    source_binding::BindingDigest,
    store_admission::NativeReplaySchedulingReadPortV1,
};

use ReplayFundingScheduleResolutionErrorV1 as ResolutionRefused;

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
    /// The request is malformed: an empty instrument, an empty route, or an empty window.
    #[error("the funding settlement write request is malformed")]
    InvalidRequest,
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
    /// A settlement already committed under the same `(instrument, settlement_ns)` is left
    /// unchanged: real archive content never differs between two fetches of the same real
    /// settlement, so the first writer's row stands. The coverage range is recorded even when
    /// `rows` is empty - a window with no venue settlement is still a window this call proves was
    /// read, which is exactly what a later completeness read must be able to tell apart from a
    /// window nobody has backfilled yet.
    ///
    /// # Errors
    ///
    /// Returns [`FundingSettlementWriteErrorV1::InvalidRequest`] for an empty instrument, an empty
    /// retrieval route, or a window that does not advance, and
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
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;

        for row in rows {
            sqlx::query(
                "INSERT INTO market_data_private.funding_settlement_facts_v1 (instrument, settlement_ns, interval_hours, rate, retrieval_ns, retrieval_route) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (instrument, settlement_ns) DO NOTHING",
            )
            .bind(instrument)
            .bind(i64::try_from(row.settlement_ns).map_err(|_| Refused::InvalidRequest)?)
            .bind(i16::from(row.interval_hours))
            .bind(row.rate)
            .bind(i64::try_from(retrieval_ns).map_err(|_| Refused::InvalidRequest)?)
            .bind(retrieval_route)
            .execute(&mut *transaction)
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
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

/// One decoded settlement row, source-agnostic: the pool path reads it typed directly, the
/// admitted-port path decodes it from the admitted read's JSON (`rate` travels as text - see
/// `store_admission/postgres.rs::read_funding_settlement_snapshot_v1`'s own comment on why a bare
/// JSON number would round it through `f64`).
#[derive(Clone, Copy, Debug, PartialEq)]
struct DecodedSettlementRowV1 {
    settlement_ns: u64,
    interval_hours: u8,
    rate: Decimal,
}

/// The real jitter a venue's own `calc_time` can carry around a clean interval boundary,
/// empirically a single millisecond (`funding_archive_v1.rs`'s own doc), given a wide margin: a
/// true missing settlement shows as roughly twice the stated interval, orders of magnitude past
/// this.
const SETTLEMENT_GAP_TOLERANCE_NS: u64 = 60_000_000_000;

/// Builds one member's settlements from its sorted, decoded rows, refusing a gap between two
/// consecutive settlements that does not match the interval the earlier one itself states.
///
/// Does not check the window's own edges: a window with zero or one settlement for a member, or
/// one whose first or last settlement sits mid-interval from the edge, is accepted as this read's
/// current scope. `coverage` already proves the window was genuinely backfilled; a stronger edge
/// check is a later slice's to add.
fn member_schedule_v1(
    instrument: String,
    mut rows: Vec<DecodedSettlementRowV1>,
) -> Result<MemberFundingScheduleV1, ResolutionRefused> {
    rows.sort_by_key(|row| row.settlement_ns);

    for pair in rows.windows(2) {
        let expected_gap_ns = u64::from(pair[0].interval_hours) * 3_600_000_000_000;
        let actual_gap_ns = pair[1].settlement_ns.saturating_sub(pair[0].settlement_ns);
        let tolerance = expected_gap_ns.min(SETTLEMENT_GAP_TOLERANCE_NS);

        if actual_gap_ns.abs_diff(expected_gap_ns) > tolerance {
            return Err(ResolutionRefused::SettlementGap);
        }
    }
    let settlements = rows
        .into_iter()
        .map(|row| FundingSettlementV1::new(row.settlement_ns, row.rate))
        .collect();
    Ok(MemberFundingScheduleV1::new(instrument, settlements))
}

/// Whether `coverage` (already sorted, half-open, possibly overlapping) fully covers
/// `[window_start_ns, window_end_ns_exclusive)`.
fn fully_covered_v1(
    coverage: &[(u64, u64)],
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> bool {
    let mut covered_through = window_start_ns;

    for &(start, end) in coverage {
        if start > covered_through {
            break;
        }
        covered_through = covered_through.max(end);

        if covered_through >= window_end_ns_exclusive {
            return true;
        }
    }
    false
}

/// Resolves the window's settled funding for exactly `members` directly on the Owner's own pool,
/// bypassing the admitted-read port - the test-build path
/// [`super::MarketDataOwnerPostgres::commit_funding_settlements_v1`]'s own callers exercise.
pub(crate) async fn resolve_replay_funding_schedule_from_pool_v1(
    pool: &sqlx::PgPool,
    members: &[String],
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<Option<ReplayFundingScheduleV1>, ResolutionRefused> {
    let mut sorted_members = members.to_vec();
    sorted_members.sort();
    sorted_members.dedup();
    let mut schedules = Vec::with_capacity(sorted_members.len());

    for instrument in sorted_members {
        let coverage_rows = sqlx::query(
            "SELECT window_start_ns, window_end_ns_exclusive FROM market_data_private.resolve_funding_settlement_coverage_v1($1)",
        )
        .bind(&instrument)
        .fetch_all(pool)
        .await
        .map_err(|_| ResolutionRefused::ReadbackUnavailable)?
        .into_iter()
        .map(|row| -> Result<(u64, u64), ResolutionRefused> {
            let start: i64 = row
                .try_get("window_start_ns")
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
            let end: i64 = row
                .try_get("window_end_ns_exclusive")
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
            Ok((start.try_into().unwrap_or(0), end.try_into().unwrap_or(0)))
        })
        .collect::<Result<Vec<_>, _>>()?;

        if !fully_covered_v1(&coverage_rows, window_start_ns, window_end_ns_exclusive) {
            return Ok(None);
        }
        let rows = sqlx::query(
            "SELECT settlement_ns, interval_hours, rate FROM market_data_private.resolve_funding_settlements_v1($1,$2,$3)",
        )
        .bind(&instrument)
        .bind(i64::try_from(window_start_ns).map_err(|_| ResolutionRefused::ReadbackUnavailable)?)
        .bind(
            i64::try_from(window_end_ns_exclusive)
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?,
        )
        .fetch_all(pool)
        .await
        .map_err(|_| ResolutionRefused::ReadbackUnavailable)?
        .into_iter()
        .map(|row| -> Result<DecodedSettlementRowV1, ResolutionRefused> {
            let settlement_ns: i64 = row
                .try_get("settlement_ns")
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
            let interval_hours: i16 = row
                .try_get("interval_hours")
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
            let rate: Decimal = row
                .try_get("rate")
                .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
            Ok(DecodedSettlementRowV1 {
                settlement_ns: settlement_ns.try_into().unwrap_or(0),
                interval_hours: interval_hours.try_into().unwrap_or(0),
                rate,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
        schedules.push(member_schedule_v1(instrument, rows)?);
    }
    ReplayFundingScheduleV1::new(window_start_ns, window_end_ns_exclusive, schedules)
        .map(Some)
        .map_err(|_| ResolutionRefused::ReadbackUnavailable)
}

/// Resolves the window's settled funding for exactly `members` through an admitted read port -
/// production's own path, and the sealed acceptance port's.
pub(crate) async fn resolve_replay_funding_schedule_through_port_v1<P>(
    port: &P,
    members: &[String],
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<Option<ReplayFundingScheduleV1>, ResolutionRefused>
where
    P: NativeReplaySchedulingReadPortV1 + ?Sized,
{
    let mut sorted_members = members.to_vec();
    sorted_members.sort();
    sorted_members.dedup();
    let mut schedules = Vec::with_capacity(sorted_members.len());

    for instrument in sorted_members {
        let raw = port
            .resolve_funding_settlements_v1(&instrument, window_start_ns, window_end_ns_exclusive)
            .await
            .map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
        let coverage_rows = raw
            .coverage_rows
            .iter()
            .map(|bytes| decode_coverage_row_v1(bytes))
            .collect::<Result<Vec<_>, _>>()?;

        if !fully_covered_v1(&coverage_rows, window_start_ns, window_end_ns_exclusive) {
            return Ok(None);
        }
        let rows = raw
            .settlement_rows
            .iter()
            .map(|bytes| decode_settlement_row_v1(bytes))
            .collect::<Result<Vec<_>, _>>()?;
        schedules.push(member_schedule_v1(instrument, rows)?);
    }
    ReplayFundingScheduleV1::new(window_start_ns, window_end_ns_exclusive, schedules)
        .map(Some)
        .map_err(|_| ResolutionRefused::ReadbackUnavailable)
}

fn decode_coverage_row_v1(bytes: &[u8]) -> Result<(u64, u64), ResolutionRefused> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
    let start = value
        .get("window_start_ns")
        .and_then(serde_json::Value::as_u64)
        .ok_or(ResolutionRefused::ReadbackUnavailable)?;
    let end = value
        .get("window_end_ns_exclusive")
        .and_then(serde_json::Value::as_u64)
        .ok_or(ResolutionRefused::ReadbackUnavailable)?;
    Ok((start, end))
}

fn decode_settlement_row_v1(bytes: &[u8]) -> Result<DecodedSettlementRowV1, ResolutionRefused> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| ResolutionRefused::ReadbackUnavailable)?;
    let settlement_ns = value
        .get("settlement_ns")
        .and_then(serde_json::Value::as_u64)
        .ok_or(ResolutionRefused::ReadbackUnavailable)?;
    let interval_hours = value
        .get("interval_hours")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .ok_or(ResolutionRefused::ReadbackUnavailable)?;
    let rate = value
        .get("rate")
        .and_then(serde_json::Value::as_str)
        .and_then(|text| Decimal::from_str_exact(text).ok())
        .ok_or(ResolutionRefused::ReadbackUnavailable)?;
    Ok(DecodedSettlementRowV1 {
        settlement_ns,
        interval_hours,
        rate,
    })
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

    use super::{DecodedSettlementRowV1, fully_covered_v1, member_schedule_v1};

    const HOUR_NS: u64 = 3_600_000_000_000;
    const EIGHT_HOURS_NS: u64 = 8 * HOUR_NS;

    fn settlement(settlement_ns: u64, interval_hours: u8) -> DecodedSettlementRowV1 {
        DecodedSettlementRowV1 {
            settlement_ns,
            interval_hours,
            rate: Decimal::from_str_exact("0.0001").unwrap(),
        }
    }

    #[rstest]
    fn evenly_spaced_settlements_build_a_schedule() {
        let rows = vec![
            settlement(EIGHT_HOURS_NS, 8),
            settlement(2 * EIGHT_HOURS_NS, 8),
            settlement(3 * EIGHT_HOURS_NS, 8),
        ];
        let schedule = member_schedule_v1("BTCUSDT-PERP.BINANCE".to_owned(), rows)
            .expect("evenly spaced settlements build a schedule");
        assert_eq!(schedule.settlements().len(), 3);
    }

    #[rstest]
    fn a_1ms_jitter_around_the_stated_interval_is_tolerated() {
        // The real venue jitter `funding_archive_v1.rs` found: a settlement 1ms past the clean
        // 8-hour grid from its predecessor.
        let rows = vec![
            settlement(EIGHT_HOURS_NS, 8),
            settlement(2 * EIGHT_HOURS_NS + 1_000_000, 8),
        ];
        member_schedule_v1("BTCUSDT-PERP.BINANCE".to_owned(), rows)
            .expect("1ms of real venue jitter does not read as a missing settlement");
    }

    #[rstest]
    fn a_missing_settlement_is_refused_by_name() {
        // A genuine gap: the second settlement is two stated intervals after the first, not one.
        let rows = vec![
            settlement(EIGHT_HOURS_NS, 8),
            settlement(3 * EIGHT_HOURS_NS, 8),
        ];
        assert_eq!(
            member_schedule_v1("BTCUSDT-PERP.BINANCE".to_owned(), rows),
            Err(super::ResolutionRefused::SettlementGap)
        );
    }

    #[rstest]
    fn settlements_out_of_arrival_order_are_sorted_before_the_gap_check() {
        let rows = vec![
            settlement(2 * EIGHT_HOURS_NS, 8),
            settlement(EIGHT_HOURS_NS, 8),
            settlement(3 * EIGHT_HOURS_NS, 8),
        ];
        member_schedule_v1("BTCUSDT-PERP.BINANCE".to_owned(), rows)
            .expect("arrival order does not change whether the gaps are real");
    }

    #[rstest]
    fn a_single_range_exactly_covering_the_window_is_full_coverage() {
        assert!(fully_covered_v1(&[(0, 10)], 0, 10));
    }

    #[rstest]
    fn touching_ranges_that_together_span_the_window_are_full_coverage() {
        assert!(fully_covered_v1(&[(0, 5), (5, 10)], 0, 10));
    }

    #[rstest]
    fn a_true_gap_between_ranges_is_not_full_coverage() {
        assert!(!fully_covered_v1(&[(0, 4), (6, 10)], 0, 10));
    }

    #[rstest]
    fn no_recorded_range_is_not_full_coverage() {
        assert!(!fully_covered_v1(&[], 0, 10));
    }

    #[rstest]
    fn a_range_starting_after_the_window_is_not_full_coverage() {
        assert!(!fully_covered_v1(&[(1, 10)], 0, 10));
    }
}
