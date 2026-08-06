//! Example demonstrating Deribit private API usage.
//!
//! # Prerequisites
//!
//! Set environment variables with your Deribit API credentials:
//! - For mainnet: `DERIBIT_API_KEY` and `DERIBIT_API_SECRET`
//! - For testnet: `DERIBIT_TESTNET_API_KEY` and `DERIBIT_TESTNET_API_SECRET`

use vibe_deribit::{common::enums::DeribitEnvironment, http::client::DeribitHttpClient};
use vibe_model::identifiers::AccountId;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let environment = if std::env::args().any(|x| x == "--mainnet") {
        DeribitEnvironment::Mainnet
    } else {
        DeribitEnvironment::Testnet
    };
    let client =
        DeribitHttpClient::new_with_env(None, None, None, environment, 30, 3, 1000, 10_000, None)?;

    let account_id = AccountId::from("DERIBIT-001");

    // Fetch account state for all currencies
    println!("Fetching account state...");
    match client.request_account_state(account_id).await {
        Ok(account_state) => println!("{account_state:?}"),
        Err(e) => {
            eprintln!("✗ Failed to fetch account state: {e}");
            return Err(e.into());
        }
    }

    Ok(())
}
