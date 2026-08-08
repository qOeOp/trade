//! Demonstrates text-based market search using [`SearchFilter`] with the
//! instrument provider.
//!
//! Uses `SearchFilter::from_query()` to search via the Gamma `GET /public-search`
//! endpoint, loading matching instruments through the provider lifecycle.
//!
//! # Usage
//!
//! ```sh
//! cargo run -p vibe-polymarket --bin polymarket-search-markets
//! cargo run -p vibe-polymarket --bin polymarket-search-markets -- "world cup"
//! ```

use std::sync::Arc;

use vibe_common::providers::InstrumentProvider;
use vibe_model::instruments::{Instrument, InstrumentAny};
use vibe_network::retry::RetryConfig;
use vibe_polymarket::{
    filters::SearchFilter, http::gamma::PolymarketGammaHttpClient,
    providers::PolymarketInstrumentProvider,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let query = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "bitcoin".to_string());

    let http_client = PolymarketGammaHttpClient::new(None, 60, RetryConfig::default())?;

    let filter = SearchFilter::from_query(&query);
    let mut provider =
        PolymarketInstrumentProvider::with_filter(http_client, None, Arc::new(filter));
    provider.load_all(None).await?;

    let instruments = provider.store().list_all();
    println!("Search \"{query}\" → {} instruments:\n", instruments.len());

    for (i, instrument) in instruments.into_iter().enumerate().take(20) {
        let id = Instrument::id(instrument);
        let expiration = Instrument::expiration_ns(instrument).map_or("N/A".to_string(), |ns| {
            ns.to_datetime_utc()
                .strftime("%Y-%m-%d %H:%M UTC")
                .to_string()
        });

        if let InstrumentAny::BinaryOption(opt) = instrument {
            println!(
                "  {:>2}. {id}\n      outcome:     {}\n      description: {}\n      expiration:  {expiration}\n",
                i + 1,
                opt.outcome.unwrap_or_default(),
                opt.description.unwrap_or_default(),
            );
        } else {
            println!("  {:>2}. {id}\n      expiration: {expiration}\n", i + 1);
        }
    }

    Ok(())
}
