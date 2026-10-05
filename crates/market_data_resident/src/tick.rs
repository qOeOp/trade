//! What one tick does: run every due job for every tracked instrument, sequentially, isolating
//! each job's own failure from the rest (a `tracing::warn!`, never a panic or an escaped `?`).
//! The only quiet outcome is "the archive isn't published yet" - everything else is a warning.

use vibe_binance::{
    common::enums::BinanceKlineInterval,
    funding_archive_v1::FundingArchiveRowV1,
    funding_settlement_recorder_v1::record_funding_settlements_v1,
    futures::http::client::BinanceFuturesHttpClient,
    venue_bar_archive_verifier_v1::{
        VerifyArchiveRequestV1, verify_derived_from_daily_v1, verify_execution_day_v1,
        verify_execution_month_v1,
    },
    venue_bar_rest_recorder_v1::record_venue_bars_v1,
    vision_backfill_v1::{VisionBackfillErrorV1, VisionBackfillFetcherV1},
};
use vibe_data::owner::{
    funding_settlement_commit_v1::FundingSettlementCommitV1,
    instrument_catalog_v1::{InstrumentCatalogErrorV1, InstrumentCatalogReadV1},
    venue_bar_store_v1::VenueBarStoreV1,
};

use crate::scheduling::{
    daily_gate_due, funding_poll_due, last_month_bounds_ns, last_week_bounds_ns,
    monthly_derivation_gate_due, monthly_gate_due, weekly_gate_due, yesterday_utc,
};

/// A served venue interval B3 records for every tracked instrument. Every timeframe
/// `served_timeframe_v1` admits (`docs/owners/market-data.md`'s charting set).
pub const SERVED_VENUE_INTERVALS: &[&str] = &[
    "1m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M",
];

/// A tracked instrument, resolved from Market Data's own admitted Instrument Master fact - never
/// derived by string munging from the canonical name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrackedInstrumentV1 {
    pub canonical_instrument: String,
    pub raw_symbol: String,
}

/// Resolves every `canonical_instruments` entry to its admitted raw venue symbol through the
/// catalog, warning and skipping (never failing the whole tick) an instrument with no admitted
/// fact, no mapping, or a venue other than `BINANCE`.
pub async fn resolve_tracked_instruments_v1(
    catalog: &dyn InstrumentCatalogReadV1,
    canonical_instruments: &[String],
) -> Vec<TrackedInstrumentV1> {
    let mut tracked = Vec::new();

    for instrument in canonical_instruments {
        match catalog.describe_instrument_v1(instrument).await {
            Ok(description) if description.venue == "BINANCE" => {
                tracked.push(TrackedInstrumentV1 {
                    canonical_instrument: description.instrument,
                    raw_symbol: description.raw_symbol,
                });
            }
            Ok(description) => {
                tracing::warn!(
                    instrument,
                    venue = description.venue,
                    "skipping an instrument whose admitted venue is not Binance"
                );
            }
            Err(InstrumentCatalogErrorV1::InstrumentUnknown) => {
                tracing::warn!(instrument, "skipping an instrument with no admitted fact");
            }
            Err(InstrumentCatalogErrorV1::StoreUnavailable) => {
                tracing::warn!(
                    instrument,
                    "skipping an instrument: the catalog is unavailable this tick"
                );
            }
        }
    }
    tracked
}

/// Per-instrument, per-job memory this process keeps across ticks. Never durable - see this
/// crate's own top-level doc for why that is correct, not a gap.
#[derive(Default)]
pub struct TickMemoryV1 {
    pub resume_from_ms: std::collections::HashMap<(String, &'static str), i64>,
    pub next_funding_poll_ns: std::collections::HashMap<String, u64>,
    pub last_daily_verification_ns: std::collections::HashMap<String, u64>,
    pub last_monthly_verification_ns: std::collections::HashMap<String, u64>,
    pub last_weekly_derivation_week_start_ns: std::collections::HashMap<String, u64>,
    pub last_monthly_derivation_month_start_ns: std::collections::HashMap<String, u64>,
}

/// Runs every due job, for every tracked instrument, once. `max_pages_per_pair` bounds B3's
/// recorder per (instrument, timeframe) pair so a cold instrument's backfill never blocks this
/// call for more than that many pages.
#[allow(clippy::too_many_arguments)]
pub async fn run_tick_v1(
    client: &BinanceFuturesHttpClient,
    bar_store: &dyn VenueBarStoreV1,
    funding_store: &dyn FundingSettlementCommitV1,
    fetcher: &VisionBackfillFetcherV1,
    instruments: &[TrackedInstrumentV1],
    max_pages_per_pair: u64,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    for instrument in instruments {
        for venue_interval in SERVED_VENUE_INTERVALS {
            run_recorder_pair(
                client,
                bar_store,
                instrument,
                venue_interval,
                max_pages_per_pair,
                now_ns,
                memory,
            )
            .await;
        }

        run_funding_recorder(client, funding_store, instrument, now_ns, memory).await;
        run_daily_verification(fetcher, bar_store, instrument, now_ns, memory).await;
        run_monthly_verification(fetcher, bar_store, instrument, now_ns, memory).await;
        run_weekly_derivation(bar_store, instrument, now_ns, memory).await;
        run_monthly_derivation(bar_store, instrument, now_ns, memory).await;
    }
}

async fn run_recorder_pair(
    client: &BinanceFuturesHttpClient,
    bar_store: &dyn VenueBarStoreV1,
    instrument: &TrackedInstrumentV1,
    venue_interval: &'static str,
    max_pages: u64,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    let key = (instrument.canonical_instrument.clone(), venue_interval);
    let resume_from_ms = memory.resume_from_ms.get(&key).copied().unwrap_or(0);

    match record_venue_bars_v1(
        client,
        bar_store,
        &instrument.canonical_instrument,
        &instrument.raw_symbol,
        venue_interval,
        resume_from_ms,
        now_ns,
        max_pages,
    )
    .await
    {
        Ok(summary) => {
            memory.resume_from_ms.insert(key, summary.resume_from_ms);
            if !summary.committed.conflicts.is_empty() {
                tracing::warn!(
                    instrument = instrument.canonical_instrument,
                    venue_interval,
                    conflicts = summary.committed.conflicts.len(),
                    "the REST recorder found a content conflict against an already-stored bar"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                instrument = instrument.canonical_instrument,
                venue_interval,
                error = %e,
                "the REST recorder's poll failed this tick"
            );
        }
    }
}

async fn run_funding_recorder(
    client: &BinanceFuturesHttpClient,
    funding_store: &dyn FundingSettlementCommitV1,
    instrument: &TrackedInstrumentV1,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    const FETCH_LIMIT: u32 = 10;
    const DEFAULT_PUBLICATION_LAG_NS: u64 = 60_000_000_000; // 60s: generous over the one 11.6s sample.

    let next_poll_ns = memory
        .next_funding_poll_ns
        .get(&instrument.canonical_instrument)
        .copied();

    if !funding_poll_due(now_ns, next_poll_ns) {
        return;
    }

    match record_funding_settlements_v1(
        client,
        funding_store,
        &instrument.canonical_instrument,
        &instrument.raw_symbol,
        FETCH_LIMIT,
        now_ns,
    )
    .await
    {
        Ok(summary) => {
            // Re-derived after every poll from this poll's own last row, so an interval change at
            // the very next boundary is picked up rather than carried forward stale - this
            // process keeps no cached interval of its own between polls.
            if let Some(last) = summary.rows.last() {
                memory.next_funding_poll_ns.insert(
                    instrument.canonical_instrument.clone(),
                    vibe_binance::funding_settlement_recorder_v1::next_funding_poll_ns_v1(
                        last.settlement_ns,
                        last.interval_hours,
                        DEFAULT_PUBLICATION_LAG_NS,
                    ),
                );
            }

            for error in &summary.errors {
                tracing::warn!(
                    instrument = instrument.canonical_instrument,
                    error = %error,
                    "a funding settlement in this poll's batch did not derive"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                instrument = instrument.canonical_instrument,
                error = %e,
                "the funding recorder's poll failed this tick"
            );
        }
    }
}

async fn run_daily_verification(
    fetcher: &VisionBackfillFetcherV1,
    bar_store: &dyn VenueBarStoreV1,
    instrument: &TrackedInstrumentV1,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    let last_done = memory
        .last_daily_verification_ns
        .get(&instrument.canonical_instrument)
        .copied();

    if !daily_gate_due(now_ns, last_done) {
        return;
    }
    memory
        .last_daily_verification_ns
        .insert(instrument.canonical_instrument.clone(), now_ns);

    let Some((year, month, day)) = yesterday_utc(now_ns) else {
        return;
    };
    let (Ok(month), Ok(day)) = (u8::try_from(month), u8::try_from(day)) else {
        return;
    };
    let request = daily_archive_request(instrument, now_ns);
    match verify_execution_day_v1(fetcher, bar_store, &request, i32::from(year), month, day).await {
        Ok(summary) => warn_on_conflicts(instrument, "daily archive verification", &summary),
        Err(e) if is_archive_unavailable(&e) => {}
        Err(e) => tracing::warn!(
            instrument = instrument.canonical_instrument,
            error = %e,
            "daily archive verification failed this tick"
        ),
    }
}

async fn run_monthly_verification(
    fetcher: &VisionBackfillFetcherV1,
    bar_store: &dyn VenueBarStoreV1,
    instrument: &TrackedInstrumentV1,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    let last_done = memory
        .last_monthly_verification_ns
        .get(&instrument.canonical_instrument)
        .copied();

    if !monthly_gate_due(now_ns, last_done) {
        return;
    }
    memory
        .last_monthly_verification_ns
        .insert(instrument.canonical_instrument.clone(), now_ns);

    let Some((year, month)) = crate::scheduling::last_month_utc(now_ns) else {
        return;
    };
    let Ok(month) = u8::try_from(month) else {
        return;
    };
    let request = daily_archive_request(instrument, now_ns);
    match verify_execution_month_v1(fetcher, bar_store, &request, i32::from(year), month).await {
        Ok(summary) => warn_on_conflicts(instrument, "monthly archive verification", &summary),
        Err(e) if is_archive_unavailable(&e) => {}
        Err(e) => tracing::warn!(
            instrument = instrument.canonical_instrument,
            error = %e,
            "monthly archive verification failed this tick"
        ),
    }
}

async fn run_weekly_derivation(
    bar_store: &dyn VenueBarStoreV1,
    instrument: &TrackedInstrumentV1,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    let last_done = memory
        .last_weekly_derivation_week_start_ns
        .get(&instrument.canonical_instrument)
        .copied();

    if !weekly_gate_due(now_ns, last_done) {
        return;
    }
    let Some((window_start_ns, window_end_ns_exclusive)) = last_week_bounds_ns(now_ns) else {
        return;
    };
    memory
        .last_weekly_derivation_week_start_ns
        .insert(instrument.canonical_instrument.clone(), window_start_ns);

    match verify_derived_from_daily_v1(
        bar_store,
        &instrument.canonical_instrument,
        "1w",
        window_start_ns,
        window_end_ns_exclusive,
        now_ns,
        now_ns,
    )
    .await
    {
        Ok(summary) => warn_on_conflicts(instrument, "1w derivation", &summary),
        Err(vibe_binance::venue_bar_archive_verifier_v1::VerifyDerivedErrorV1::Read(
            vibe_data::owner::venue_bar_store_v1::VenueBarReadErrorV1::NotVerified { .. },
        )) => {
            // The week's own 1d bars are not all verified yet - come back next tick.
        }
        Err(e) => tracing::warn!(
            instrument = instrument.canonical_instrument,
            error = %e,
            "1w derivation failed this tick"
        ),
    }
}

async fn run_monthly_derivation(
    bar_store: &dyn VenueBarStoreV1,
    instrument: &TrackedInstrumentV1,
    now_ns: u64,
    memory: &mut TickMemoryV1,
) {
    let last_done = memory
        .last_monthly_derivation_month_start_ns
        .get(&instrument.canonical_instrument)
        .copied();

    if !monthly_derivation_gate_due(now_ns, last_done) {
        return;
    }
    let Some((window_start_ns, window_end_ns_exclusive)) = last_month_bounds_ns(now_ns) else {
        return;
    };
    memory
        .last_monthly_derivation_month_start_ns
        .insert(instrument.canonical_instrument.clone(), window_start_ns);

    match verify_derived_from_daily_v1(
        bar_store,
        &instrument.canonical_instrument,
        "1M",
        window_start_ns,
        window_end_ns_exclusive,
        now_ns,
        now_ns,
    )
    .await
    {
        Ok(summary) => warn_on_conflicts(instrument, "1M derivation", &summary),
        Err(vibe_binance::venue_bar_archive_verifier_v1::VerifyDerivedErrorV1::Read(
            vibe_data::owner::venue_bar_store_v1::VenueBarReadErrorV1::NotVerified { .. },
        )) => {
            // The month's own 1d bars are not all verified yet - come back next tick.
        }
        Err(e) => tracing::warn!(
            instrument = instrument.canonical_instrument,
            error = %e,
            "1M derivation failed this tick"
        ),
    }
}

fn daily_archive_request(
    instrument: &TrackedInstrumentV1,
    verified_ns: u64,
) -> VerifyArchiveRequestV1<'_> {
    VerifyArchiveRequestV1 {
        canonical_instrument: &instrument.canonical_instrument,
        raw_symbol: &instrument.raw_symbol,
        venue_interval: "1d",
        interval: BinanceKlineInterval::Day1,
        verified_ns,
    }
}

fn is_archive_unavailable(
    e: &vibe_binance::venue_bar_archive_verifier_v1::VerifyExecutionArchiveErrorV1,
) -> bool {
    matches!(
        e,
        vibe_binance::venue_bar_archive_verifier_v1::VerifyExecutionArchiveErrorV1::Fetch(
            VisionBackfillErrorV1::ArchiveUnavailable
        )
    )
}

fn warn_on_conflicts(
    instrument: &TrackedInstrumentV1,
    job: &str,
    summary: &vibe_data::owner::venue_bar_store_v1::VenueBarVerificationSummaryV1,
) {
    if !summary.conflicts.is_empty() {
        tracing::warn!(
            instrument = instrument.canonical_instrument,
            job,
            conflicts = summary.conflicts.len(),
            "{job} found a conflict against the archive"
        );
    }
}

// Silences an unused-import warning until B6a's funding archive row type is wired into
// reconciliation here - a documented follow-up (see B6b's own PR body), not part of this slice.
#[allow(dead_code)]
fn _unused_funding_archive_row_type(_: FundingArchiveRowV1) {}

#[cfg(test)]
mod live_tests {
    use vibe_binance::common::enums::{BinanceEnvironment, BinanceProductType};
    use vibe_core::time::get_atomic_clock_realtime;
    use vibe_data::owner::{
        funding_settlement_commit_v1::funding_settlement_commit_from_environment_v1,
        venue_bar_store_v1::venue_bar_store_from_environment_v1,
    };

    use super::*;

    fn client() -> BinanceFuturesHttpClient {
        BinanceFuturesHttpClient::new(
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
        .expect("the keyless public client builds")
    }

    /// A tick, run twice, against a real store and the live endpoint - the doc's own B6
    /// acceptance (`docs/owners/market-data.md`: "restarts without double writes, proved by
    /// rejoin counts"). This builds the tracked instrument directly rather than through
    /// `resolve_tracked_instruments_v1`/the catalog, since seeding a real admitted Instrument
    /// Master fact needs the full admission ceremony this test does not exercise; the catalog
    /// resolution itself is a thin, separately-reasoned-about wrapper over `describe_instrument_v1`.
    #[tokio::test]
    #[ignore = "reaches the live public Binance endpoint and a real Market Data store"]
    async fn a_tick_run_twice_only_rejoins_the_second_time() {
        let bar_store = venue_bar_store_from_environment_v1()
            .await
            .expect("MARKET_DATA_OWNER_DATABASE_URL names a reachable venue bar store");
        let funding_store = funding_settlement_commit_from_environment_v1()
            .await
            .expect("MARKET_DATA_OWNER_DATABASE_URL names a reachable funding settlement store");
        let fetcher = VisionBackfillFetcherV1::new(
            client(),
            std::env::temp_dir().join("lane8-b6b-tick-acceptance"),
        )
        .expect("the fetcher builds");
        let instruments = [TrackedInstrumentV1 {
            canonical_instrument: "BTCUSDT-PERP.BINANCE-B6B-TICK-PROOF".to_string(),
            raw_symbol: "BTCUSDT".to_string(),
        }];
        let now_ns: u64 = get_atomic_clock_realtime().get_time_ns().into();
        let mut memory = TickMemoryV1::default();

        run_tick_v1(
            &client(),
            bar_store.as_ref(),
            funding_store.as_ref(),
            &fetcher,
            &instruments,
            1,
            now_ns,
            &mut memory,
        )
        .await;

        let first_written = bar_rows_written(
            bar_store.as_ref(),
            &instruments[0].canonical_instrument,
            now_ns,
        )
        .await;
        assert!(
            first_written > 0,
            "the first tick's own page budget still commits something"
        );

        // A fresh, empty memory - simulating a restart, not a continuation - resumes from
        // scratch (resume_from_ms defaults to 0 again) and re-fetches the same first page, which
        // the store now already holds in full.
        let mut restarted_memory = TickMemoryV1::default();
        run_tick_v1(
            &client(),
            bar_store.as_ref(),
            funding_store.as_ref(),
            &fetcher,
            &instruments,
            1,
            now_ns + 1,
            &mut restarted_memory,
        )
        .await;

        let after_second_tick = bar_rows_written(
            bar_store.as_ref(),
            &instruments[0].canonical_instrument,
            now_ns + 1,
        )
        .await;
        assert_eq!(
            after_second_tick, first_written,
            "the second tick, same resume point tracked in memory, only rejoins - no new rows"
        );
    }

    /// Counts every `1m` bar stored for `instrument` up to `cut_ns`, as a stand-in for "how many
    /// rows exist now" - this test's own fixture instrument has no other writer, so a growing
    /// count between the two ticks would mean the second tick wrote something new.
    async fn bar_rows_written(
        bar_store: &dyn vibe_data::owner::venue_bar_store_v1::VenueBarStoreV1,
        instrument: &str,
        cut_ns: u64,
    ) -> usize {
        bar_store
            .read_venue_bars_v1(instrument, "1m", 0, cut_ns, cut_ns, false)
            .await
            .map_or(0, |rows| rows.len())
    }
}
