//! Manual verification script for Ax HTTP public endpoints.
//!
//! Tests the instruments endpoint to verify connectivity and response parsing.
//! Defaults to sandbox environment.
//!
//! Usage:
//! ```bash
//! cargo run --bin ax-http-public -p vibe-architect-ax
//! ```

use ustr::Ustr;
use vibe_architect_ax::{common::enums::AxEnvironment, http::client::AxRawHttpClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let environment = if std::env::var("AX_IS_SANDBOX")
        .ok()
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or(true)
    {
        AxEnvironment::Sandbox
    } else {
        AxEnvironment::Production
    };

    let base_url = environment.http_url();
    let orders_base_url = environment.orders_url();

    log::info!("Connecting to Ax HTTP API: {base_url}");
    log::info!("Environment: {environment}");

    let client = AxRawHttpClient::new(
        Some(base_url.to_string()),
        Some(orders_base_url.to_string()),
        30,
        3,
        1000,
        10_000,
        None,
    )?;

    log::info!("Fetching all instruments...");
    let start = std::time::Instant::now();
    let instruments_response = client.get_instruments().await?;
    let elapsed = start.elapsed();

    log::info!(
        "Fetched {} instruments in {:.2}s",
        instruments_response.instruments.len(),
        elapsed.as_secs_f64()
    );

    for inst in instruments_response.instruments.iter().take(5) {
        log::info!(
            "  {} ({:?}) tick={} min_size={}",
            inst.symbol,
            inst.state,
            inst.tick_size,
            inst.minimum_order_size
        );
    }

    if instruments_response.instruments.len() > 5 {
        log::info!(
            "  ... and {} more",
            instruments_response.instruments.len() - 5
        );
    }

    let test_symbol = instruments_response
        .instruments
        .first()
        .map_or(Ustr::from("EURUSD-PERP"), |i| i.symbol);

    log::info!("Fetching single instrument: {test_symbol}");
    let start = std::time::Instant::now();
    let instrument = client.get_instrument(test_symbol).await?;
    let elapsed = start.elapsed();

    log::info!(
        "Fetched {} in {:.2}s",
        instrument.symbol,
        elapsed.as_secs_f64()
    );
    log::info!("  State: {:?}", instrument.state);
    log::info!("  Tick size: {}", instrument.tick_size);
    log::info!("  Min order size: {}", instrument.minimum_order_size);
    log::info!("  Quote currency: {}", instrument.quote_currency);
    log::info!("  Multiplier: {}", instrument.multiplier);

    log::info!("Done");

    Ok(())
}
