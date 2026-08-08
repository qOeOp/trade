//! Sanity-check binary that exercises the Coinbase public REST API.
//!
//! Run with:
//!
//! ```bash
//! cargo run -p vibe-coinbase --bin coinbase-http-public
//! ```
//!
//! Requires no credentials. Hits the live Coinbase Advanced Trade endpoints
//! and logs a short summary for each call.

use vibe_coinbase::{common::enums::CoinbaseProductType, http::client::CoinbaseHttpClient};
use vibe_model::instruments::Instrument;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let client = CoinbaseHttpClient::default();

    log::info!("Requesting all spot instruments");
    let instruments = client
        .request_instruments(Some(CoinbaseProductType::Spot))
        .await?;
    log::info!("Received {} spot instruments", instruments.len());
    if let Some(btc_usd) = instruments
        .iter()
        .find(|i| i.id().symbol.as_str() == "BTC-USD")
    {
        log::info!(
            "BTC-USD precision: price={}, size={}",
            btc_usd.price_precision(),
            btc_usd.size_precision(),
        );
    }

    log::info!("Requesting BTC-USD product book");
    match client.get_product_book("BTC-USD", Some(5)).await {
        Ok(book) => log::debug!("{book:?}"),
        Err(e) => log::error!("{e:?}"),
    }

    log::info!("Requesting recent BTC-USD market trades");
    match client.get_market_trades("BTC-USD", 3).await {
        Ok(trades) => log::debug!("{trades:?}"),
        Err(e) => log::error!("{e:?}"),
    }

    Ok(())
}
