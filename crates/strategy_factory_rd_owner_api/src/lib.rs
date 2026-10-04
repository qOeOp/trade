//! Composition roots for the R&D Owner and Product Edge HTTP APIs.

#![expect(
    clippy::large_futures,
    reason = "the read-only HTTP handlers retain complete typed Owner readbacks across preflight and resolve awaits"
)]

pub mod dashboard_read_api;
// The chain entry needs `first_composer_v3_replay_acceptance`'s fixtures, so it stays gated on
// `sealed-source-intake-composer-acceptance`. `backtest_run_v1` now has a real production caller
// (`backtest_run_routes`, composed unconditionally below) and carries no such
// dependency itself, so it is no longer gated at all.
#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod backtest_run_chain_entry_acceptance;
mod backtest_run_routes;
mod backtest_run_v1;
mod binance_backfill_job;
mod bounded_feature_program;
#[cfg(all(test, feature = "sealed-source-intake-acceptance"))]
mod dashboard_run_routing_acceptance;
mod exploratory_replay;
#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod first_composer_v3_replay_acceptance;
#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod first_composer_v3_replay_body_acceptance;
#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod first_composer_v3_replay_oracle;
mod iteration_analysis;
mod iteration_decision;
mod iteration_result_admission;
#[cfg(test)]
mod log_capture;
mod market_data_pit;
#[cfg(feature = "native-replay-execution")]
mod market_data_repair;
#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
mod native_replay_scheduling_acceptance;
mod research_goal_submission;
mod research_initial_pit;
#[cfg(test)]
mod research_initial_pit_postgres_tests;
pub mod server;
pub mod signing_key_file;
mod source_intake;
mod source_intake_research;
mod strategies;

#[cfg(test)]
mod develop_composer_api_contract_tests;
#[cfg(test)]
mod tests;

/// Reads a required configuration variable, refusing one that is present but carries no value.
///
/// `std::env::var` returns `Ok("")` for a variable set to the empty string, so reading one
/// directly admits an empty value everywhere it admits a set one. For a database URL that fails
/// later at connect time. For a bearer token it does not fail at all: the process stores the
/// digest of the empty string as its secret, and a request whose header is exactly `Bearer `
/// then authenticates against it. No caller in this crate has a meaning for an empty value, so
/// this refuses one on behalf of all of them, and refuses a whitespace-only value for the same
/// reason.
///
/// The two failures carry different messages because they have different fixes: a variable that
/// is absent was never wired, and a variable that is blank was wired to nothing.
///
/// # Errors
///
/// Returns an error when the variable is absent, is not valid Unicode, or holds only whitespace.
pub fn required_env(name: &str) -> anyhow::Result<String> {
    let value = std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is missing"))?;
    if value.trim().is_empty() {
        anyhow::bail!("required environment variable {name} is set but carries no value");
    }
    Ok(value)
}
