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

    log::info!("Starting Hyperliquid HTTP private example");

    match environment {
        HyperliquidEnvironment::Testnet => {
            log::info!("Testnet mode - ensure HYPERLIQUID_TESTNET_PK environment variable is set");
        }
        HyperliquidEnvironment::Mainnet => {
            log::info!("Mainnet mode - ensure HYPERLIQUID_PK environment variable is set");
        }
    }

    let client = match HyperliquidHttpClient::from_env(environment) {
        Ok(client) => {
            log::info!("Environment: {environment:?}");
            client
        }
        Err(e) => {
            let (env_var, _) =
                vibe_hyperliquid::common::credential::credential_env_vars(environment);
            log::warn!(
                "No credentials found in environment ({env_var}): {e}, skipping authenticated examples"
            );
            return Ok(());
        }
    };

    // For demonstration, use a placeholder address
    let user_address = "0x0000000000000000000000000000000000000000";

    match client.info_user_fills(user_address).await {
        Ok(fills) => {
            log::info!("Fetched {} fills", fills.len());
            for (i, fill) in fills.iter().take(3).enumerate() {
                log::info!("Fill {}: {} {} @ {}", i, fill.side, fill.sz, fill.px);
            }
        }
        Err(e) => {
            log::info!("Failed to fetch fills: {e}");
        }
    }

    let example_order_id = 12345u64;
    match client
        .info_order_status(user_address, example_order_id)
        .await
    {
        Ok(status) => {
            log::info!("Order status: {status:?}");
        }
        Err(e) => {
            log::info!("Order status query failed (expected for demo ID): {e}");
        }
    }

    Ok(())
}
