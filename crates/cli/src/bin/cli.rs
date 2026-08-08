#![warn(clippy::pedantic)]

use std::process::ExitCode;

use clap::FromArgMatches;
use mimalloc::MiMalloc;
use vibe_cli::opt::VibeCli;
use vibe_common::logging::ensure_logging_initialized;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    ensure_logging_initialized();

    let matches = vibe_cli::cli_command().get_matches();
    let cli = VibeCli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());

    if let Err(e) = Box::pin(vibe_cli::run(cli)).await {
        log::error!("Error executing Vibe CLI: {e}");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}
