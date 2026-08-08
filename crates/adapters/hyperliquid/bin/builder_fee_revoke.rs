//! Revoke the Vibe builder fee approval for Hyperliquid trading.
//!
//! Signs an `ApproveBuilderFee` action at a 0% max fee rate, capping any
//! previously approved builder fee at zero so no fee can be charged.
//!
//! Prerequisites:
//! - Set environment variable: HYPERLIQUID_PK (mainnet) or HYPERLIQUID_TESTNET_PK (testnet)
//!
//! Usage:
//!     # Mainnet (interactive)
//!     cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-revoke
//!
//!     # Mainnet (non-interactive)
//!     cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-revoke -- --yes
//!
//!     # Testnet
//!     HYPERLIQUID_TESTNET=true cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-revoke

use vibe_hyperliquid::common::builder_fee;

#[tokio::main]
async fn main() {
    let non_interactive = std::env::args().any(|arg| arg == "--yes" || arg == "-y");
    let success = builder_fee::revoke_from_env(non_interactive).await;
    if !success {
        std::process::exit(1);
    }
}
