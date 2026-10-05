//! Market Data's resident process (B6): the first one. Runs B3's REST recorder, B5's archive
//! verification and B6a's funding recorder, one scheduler, one process, never an MCP.

use std::sync::Arc;

use market_data_resident::tick::{TickMemoryV1, resolve_tracked_instruments_v1, run_tick_v1};
use vibe_binance::{
    common::enums::{BinanceEnvironment, BinanceProductType},
    futures::http::client::BinanceFuturesHttpClient,
    vision_backfill_v1::VisionBackfillFetcherV1,
};
use vibe_core::time::get_atomic_clock_realtime;
use vibe_data::owner::{
    funding_settlement_commit_v1::funding_settlement_commit_from_environment_v1,
    instrument_catalog_read_from_environment_v1,
    venue_bar_store_v1::venue_bar_store_from_environment_v1,
};

/// `MARKET_DATA_RESIDENT_INSTRUMENTS`: comma-separated canonical instruments to track. Defaults to
/// U1's own three perpetuals - not hardcoded unconditionally, so this is not a second place an
/// admitted membership set lives if one is ever built; it is just this process's own config.
const DEFAULT_INSTRUMENTS: &str = "BTCUSDT-PERP.BINANCE,ETHUSDT-PERP.BINANCE,SOLUSDT-PERP.BINANCE";

/// `MARKET_DATA_RESIDENT_TICK_SECONDS`: the tick interval. Default 60s.
const DEFAULT_TICK_SECONDS: u64 = 60;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let canonical_instruments: Vec<String> = std::env::var("MARKET_DATA_RESIDENT_INSTRUMENTS")
        .unwrap_or_else(|_| DEFAULT_INSTRUMENTS.to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let tick_seconds: u64 = std::env::var("MARKET_DATA_RESIDENT_TICK_SECONDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_TICK_SECONDS);

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
    .map_err(|e| anyhow::anyhow!("the keyless public client did not build: {e}"))?;
    let bar_store = venue_bar_store_from_environment_v1().await.map_err(|e| {
        anyhow::anyhow!(
            "MARKET_DATA_OWNER_DATABASE_URL does not name a reachable venue bar store: {e}"
        )
    })?;
    let funding_store = funding_settlement_commit_from_environment_v1()
        .await
        .map_err(|e| anyhow::anyhow!("MARKET_DATA_OWNER_DATABASE_URL does not name a reachable funding settlement store: {e}"))?;
    let catalog = Arc::new(
        instrument_catalog_read_from_environment_v1()
            .await
            .map_err(|e| anyhow::anyhow!("MARKET_DATA_OWNER_DATABASE_URL does not name a reachable instrument catalog: {e}"))?,
    );
    let fetcher = VisionBackfillFetcherV1::new(
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
        .map_err(|e| anyhow::anyhow!("the archive fetcher's client did not build: {e}"))?,
        std::env::var("MARKET_DATA_RESIDENT_SHARD_DIR")
            .unwrap_or_else(|_| "/tmp/market-data-resident-shards".to_string()),
    )
    .map_err(|e| anyhow::anyhow!("the archive fetcher did not build: {e}"))?;

    let mut memory = TickMemoryV1::default();
    let mut tick_interval = tokio::time::interval(std::time::Duration::from_secs(tick_seconds));
    tracing::info!(
        instruments = ?canonical_instruments,
        tick_seconds,
        "market-data-resident starting"
    );

    loop {
        tokio::select! {
            _ = tick_interval.tick() => {
                let instruments = resolve_tracked_instruments_v1(catalog.as_ref(), &canonical_instruments).await;
                let now_ns = u64::from(get_atomic_clock_realtime().get_time_ns());
                run_tick_v1(
                    &client,
                    bar_store.as_ref(),
                    funding_store.as_ref(),
                    &fetcher,
                    &instruments,
                    now_ns,
                    &mut memory,
                )
                .await;
            }
            _ = tokio::signal::ctrl_c() => {
                // Every write this tick makes is already per-page/per-call transactional, so
                // stopping between ticks (never mid-tick, since select! only polls here) never
                // leaves a partial commit - it just means the next process picks up exactly where
                // this one's own idempotent jobs would have anyway.
                tracing::info!("market-data-resident received a shutdown signal, exiting");
                break;
            }
        }
    }
    Ok(())
}
