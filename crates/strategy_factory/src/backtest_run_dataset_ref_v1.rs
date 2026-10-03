//! `backtest.run`'s own request coordinate: one member, one execution timeframe, one half-open
//! window. Frozen by the phase-3 integration plan as `(instrument, execution_timeframe, [start,
//! end))`, with the timeframe validated against the one whitelist every other caller (the
//! backfill job, `coverage`, the MCP tool, the command line) already validates against, so a
//! `backtest.run` request and a backfill request can never silently disagree about what counts as
//! a supported timeframe.
//!
//! This type carries no custody: it is the untrusted coordinate `backtest.run` resolves against
//! the T0 window-custody frame resolver (`vibe_data::owner::pit_window_custody_v1`), not a fact
//! about what Market Data holds.

use serde::{Deserialize, Serialize};
use vibe_data::owner::bar_schedule::SUPPORTED_EXECUTION_TIMEFRAMES_V1;

/// Why a proposed `BacktestRunDatasetRefV1` is refused, before it is ever resolved against
/// custody.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum BacktestRunDatasetRefErrorV1 {
    /// `execution_timeframe` is not one of [`SUPPORTED_EXECUTION_TIMEFRAMES_V1`].
    #[error(
        "execution timeframe {0:?} is not one of the supported timeframes {SUPPORTED_EXECUTION_TIMEFRAMES_V1:?}"
    )]
    UnsupportedExecutionTimeframe(String),
    /// The window is empty or inverted: `window_end_ns_exclusive` must be strictly greater than
    /// `window_start_ns`.
    #[error("the window [{window_start_ns}, {window_end_ns_exclusive}) is empty or inverted")]
    EmptyOrInvertedWindow {
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    },
}

/// `backtest.run`'s request coordinate, validated at construction: the instrument, the execution
/// timeframe (one of [`SUPPORTED_EXECUTION_TIMEFRAMES_V1`]), and a non-empty half-open window.
///
/// Validating here, once, at the one place every `backtest.run` caller (the route, the MCP tool,
/// a future CLI) constructs this type, is what keeps a second hand-rolled copy of the timeframe
/// whitelist from drifting from this one.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestRunDatasetRefV1 {
    instrument: String,
    execution_timeframe: String,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
}

impl BacktestRunDatasetRefV1 {
    /// # Errors
    ///
    /// [`BacktestRunDatasetRefErrorV1::UnsupportedExecutionTimeframe`] if `execution_timeframe`
    /// is not one of [`SUPPORTED_EXECUTION_TIMEFRAMES_V1`];
    /// [`BacktestRunDatasetRefErrorV1::EmptyOrInvertedWindow`] if the window is empty or inverted.
    pub fn new(
        instrument: String,
        execution_timeframe: String,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<Self, BacktestRunDatasetRefErrorV1> {
        if !SUPPORTED_EXECUTION_TIMEFRAMES_V1.contains(&execution_timeframe.as_str()) {
            return Err(BacktestRunDatasetRefErrorV1::UnsupportedExecutionTimeframe(
                execution_timeframe,
            ));
        }

        if window_end_ns_exclusive <= window_start_ns {
            return Err(BacktestRunDatasetRefErrorV1::EmptyOrInvertedWindow {
                window_start_ns,
                window_end_ns_exclusive,
            });
        }
        Ok(Self {
            instrument,
            execution_timeframe,
            window_start_ns,
            window_end_ns_exclusive,
        })
    }

    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    #[must_use]
    pub fn execution_timeframe(&self) -> &str {
        &self.execution_timeframe
    }

    #[must_use]
    pub const fn window_start_ns(&self) -> u64 {
        self.window_start_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[rstest::rstest]
    #[case::week("1w")]
    #[case::day("1d")]
    #[case::four_hour("4h")]
    #[case::hour("1h")]
    fn every_whitelisted_timeframe_is_accepted(#[case] timeframe: &str) {
        assert!(
            BacktestRunDatasetRefV1::new(
                "LINKUSDT-PERP.BINANCE".to_owned(),
                timeframe.to_owned(),
                0,
                1
            )
            .is_ok()
        );
    }

    #[rstest::rstest]
    #[case::fifteen_minute("15m")]
    #[case::one_minute("1m")]
    #[case::unknown("1y")]
    #[case::empty("")]
    fn an_unwhitelisted_timeframe_is_refused_by_name(#[case] timeframe: &str) {
        assert_eq!(
            BacktestRunDatasetRefV1::new(
                "LINKUSDT-PERP.BINANCE".to_owned(),
                timeframe.to_owned(),
                0,
                1
            ),
            Err(BacktestRunDatasetRefErrorV1::UnsupportedExecutionTimeframe(
                timeframe.to_owned()
            ))
        );
    }

    #[rstest::rstest]
    #[case::empty_window(10, 10)]
    #[case::inverted_window(10, 5)]
    fn an_empty_or_inverted_window_is_refused(
        #[case] window_start_ns: u64,
        #[case] window_end_ns_exclusive: u64,
    ) {
        assert_eq!(
            BacktestRunDatasetRefV1::new(
                "LINKUSDT-PERP.BINANCE".to_owned(),
                "1d".to_owned(),
                window_start_ns,
                window_end_ns_exclusive,
            ),
            Err(BacktestRunDatasetRefErrorV1::EmptyOrInvertedWindow {
                window_start_ns,
                window_end_ns_exclusive,
            })
        );
    }
}
