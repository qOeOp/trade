//! Command-line interface and tools for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-cli` crate provides a command-line interface for managing and
//! operating VibeTrader installations. It includes tools for database management,
//! system configuration, and operational utilities:
//!
//! - Database initialization and management commands.
//! - PostgreSQL schema setup and maintenance.
//! - Configuration validation and setup utilities.
//! - System administration and operational tools.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
//! engine for multi-asset, multi-venue trading systems.
//!
//! The system spans research, deterministic simulation, and live execution within a single
//! event-driven architecture, providing research-to-live semantic parity.
//!
//! # Feature Flags
//!
//! This crate provides feature flags to control source code inclusion during compilation,
//! depending on the intended use case:
//!
//! - `defi`: Enables DeFi functionality including blockchain data access and pool analysis.

#![warn(rustc::all)]
#![warn(clippy::pedantic)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

#[cfg(feature = "defi")]
mod blockchain;
mod database;
pub mod opt;

#[cfg(feature = "defi")]
use crate::blockchain::run_blockchain_command;
use crate::{
    database::postgres::run_database_command,
    opt::{Commands, VibeCli},
};

/// Builds the top-level CLI command, augmented with capability-aware blockchain help.
///
/// The blockchain subcommands gain `after_long_help` sections derived from the adapter's DEX
/// registration maps when the `defi` feature is enabled.
#[must_use]
pub fn cli_command() -> clap::Command {
    let command = <VibeCli as clap::CommandFactory>::command();
    #[cfg(feature = "defi")]
    let command = crate::blockchain::augment_blockchain_help(command);
    command
}

/// Runs the Vibe CLI based on the provided options.
///
/// # Errors
///
/// Returns an error if execution of the specified command fails.
pub async fn run(opt: VibeCli) -> anyhow::Result<()> {
    match opt.command {
        Commands::Database(database_opt) => run_database_command(database_opt).await?,
        #[cfg(feature = "defi")]
        Commands::Blockchain(blockchain_opt) => {
            Box::pin(run_blockchain_command(blockchain_opt)).await?;
        }
    }
    Ok(())
}
