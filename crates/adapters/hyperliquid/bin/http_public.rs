use std::env;

use vibe_hyperliquid::{
    common::enums::HyperliquidEnvironment, http::client::HyperliquidHttpClient,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let args: Vec<String> = env::args().collect();
    let environment = if args.get(1).is_some_and(|s| s == "testnet") {
        HyperliquidEnvironment::Testnet
    } else {
        HyperliquidEnvironment::Mainnet
    };

    log::info!("Starting Hyperliquid HTTP public example");
    log::info!("Environment: {environment:?}");

    let client = HyperliquidHttpClient::new(environment, 60, None)?;

    // Fetch metadata
    let meta = client.info_meta().await?;
    log::info!("Fetched {} markets", meta.universe.len());

    // Fetch BTC order book
    if let Ok(book) = client.info_l2_book("BTC").await {
        let best_bid = book
            .levels
            .first()
            .and_then(|bids| bids.first())
            .map(|l| l.px)
            .unwrap_or_default();
        let best_ask = book
            .levels
            .get(1)
            .and_then(|asks| asks.first())
            .map(|l| l.px)
            .unwrap_or_default();

        log::info!("BTC best bid: {best_bid}, best ask: {best_ask}");
    }

    Ok(())
}
