//! Approve the Vibe builder fee for Hyperliquid trading.
//!
//! This is a ONE-TIME setup step for wallets that have never approved a builder
//! fee. Hyperliquid rejects orders carrying an unapproved builder address, even
//! at a zero fee.
//!
//! What you are approving:
//! - 0% max fee rate: attribution only, no builder fees are ever charged
//!
//! The script displays full details and prompts for confirmation before
//! proceeding. Use --yes to skip the confirmation prompt.
//!
//! The action must be signed by the master wallet's private key; agent (API)
//! wallets cannot sign `ApproveBuilderFee`.
//!
//! Prerequisites:
//! - Set environment variable: HYPERLIQUID_PK (mainnet) or HYPERLIQUID_TESTNET_PK (testnet)
//!
//! Usage:
//!     # Mainnet (interactive)
//!     cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-approve
//!
//!     # Mainnet (non-interactive)
//!     cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-approve -- --yes
//!
//!     # Testnet
//!     HYPERLIQUID_TESTNET=true cargo run -p vibe-hyperliquid --bin hyperliquid-builder-fee-approve

use vibe_hyperliquid::common::builder_fee;

#[tokio::main]
async fn main() {
    let non_interactive = std::env::args().any(|arg| arg == "--yes" || arg == "-y");
    let success = builder_fee::approve_from_env(non_interactive).await;
    if !success {
        std::process::exit(1);
    }
}
