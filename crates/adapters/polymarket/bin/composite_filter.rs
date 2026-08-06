//! Demonstrates combined instrument loading with multiple filters.
//!
//! This example combines:
//!
//! - [`EventQueryFilter`] - two-phase fetch: resolves an event slug to
//!   condition IDs, then queries `/markets` with sorting and limiting.
//!   Here we fetch the top 20 markets by liquidity from the 2028
//!   presidential election event.
//! - [`PredicateFilter`] - post-fetch refinement (keeps only outcome "Yes")
//!
//! # Usage
//!
//! ```sh
//! cargo run -p vibe-polymarket --bin polymarket-composite-filter
//! ```

use std::sync::Arc;

use vibe_common::providers::InstrumentProvider;
use vibe_model::instruments::{Instrument, InstrumentAny};
use vibe_network::retry::RetryConfig;
use vibe_polymarket::{
    filters::{EventQueryFilter, PredicateFilter},
    http::{gamma::PolymarketGammaHttpClient, query::GetGammaMarketsParams},
    providers::PolymarketInstrumentProvider,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let event_query = EventQueryFilter::new(
        "presidential-election-winner-2028",
        GetGammaMarketsParams {
            order: Some("liquidity".into()),
            ascending: Some(false),
            max_markets: Some(20),
            ..Default::default()
        },
    );
    let predicate = PredicateFilter::outcome("Yes");

    let http_client = PolymarketGammaHttpClient::new(None, 60, RetryConfig::default())?;
    let mut provider = PolymarketInstrumentProvider::with_filters(
        http_client,
        None,
        vec![Arc::new(event_query), Arc::new(predicate)],
    );

    log::info!("Loading top-20 presidential election markets by liquidity (outcome='Yes')...");
    provider.load_all(None).await?;

    let instruments = provider.store().list_all();
    println!(
        "Loaded {} instruments (top 20 markets by liquidity, outcome='Yes'):\n",
        instruments.len()
    );

    for (i, instrument) in instruments.into_iter().enumerate() {
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
