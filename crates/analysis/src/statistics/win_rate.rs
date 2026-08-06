use std::fmt::Display;

use vibe_model::position::Position;

use crate::{Returns, statistic::PortfolioStatistic};

/// Calculates the win rate of a trading strategy based on realized PnLs.
///
/// Win rate is the percentage of profitable trades out of total trades:
/// `Count(Trades with PnL > 0) / Total Trades`
///
/// Returns a value between 0.0 and 1.0, where 1.0 represents 100% winning trades.
///
/// Note: While a high win rate is desirable, it should be considered alongside
/// average win/loss sizes and profit factor for complete system evaluation.
///
/// # References
///
/// - Standard trading performance metric across the industry
/// - Tharp, V. K. (1998). *Trade Your Way to Financial Freedom*. McGraw-Hill.
/// - Kaufman, P. J. (2013). *Trading Systems and Methods* (5th ed.). Wiley.
#[repr(C)]
#[derive(Debug, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.analysis", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.analysis")
)]
pub struct WinRate {}

impl Display for WinRate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Win Rate")
    }
}

impl PortfolioStatistic for WinRate {
    type Item = f64;

    fn name(&self) -> String {
        self.to_string()
    }

    fn calculate_from_realized_pnls(&self, realized_pnls: &[f64]) -> Option<Self::Item> {
        if realized_pnls.is_empty() {
            return Some(f64::NAN);
        }

        let (winners, losers): (Vec<f64>, Vec<f64>) =
            realized_pnls.iter().partition(|&&pnl| pnl > 0.0);

        let total_trades = winners.len() + losers.len();
        Some(winners.len() as f64 / total_trades.max(1) as f64)
    }
    fn calculate_from_returns(&self, _returns: &Returns) -> Option<Self::Item> {
        None
    }

    fn calculate_from_positions(&self, _positions: &[Position]) -> Option<Self::Item> {
        None
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_core::approx_eq;

    use super::*;

    #[rstest]
    fn test_empty_pnls() {
        let win_rate = WinRate {};
        let result = win_rate.calculate_from_realized_pnls(&[]);
        assert!(result.is_some());
        assert!(result.unwrap().is_nan());
    }

    #[rstest]
    fn test_all_winning_trades() {
        let win_rate = WinRate {};
        let realized_pnls = vec![100.0, 50.0, 200.0];
        let result = win_rate.calculate_from_realized_pnls(&realized_pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), 1.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_all_losing_trades() {
        let win_rate = WinRate {};
        let realized_pnls = vec![-100.0, -50.0, -200.0];
        let result = win_rate.calculate_from_realized_pnls(&realized_pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), 0.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_mixed_trades() {
        let win_rate = WinRate {};
        let realized_pnls = vec![100.0, -50.0, 200.0, -100.0];
        let result = win_rate.calculate_from_realized_pnls(&realized_pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), 0.5, epsilon = 1e-9));
    }

    #[rstest]
    fn test_breakeven_trades_count_in_denominator() {
        // Per the documented formula Count(PnL > 0) / Total Trades, a breakeven
        // trade is not a win but still counts in the denominator: 1 / 3.
        let win_rate = WinRate {};
        let realized_pnls = vec![100.0, 0.0, -50.0];
        let result = win_rate.calculate_from_realized_pnls(&realized_pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), 1.0 / 3.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_name() {
        let win_rate = WinRate {};
        assert_eq!(win_rate.name(), "Win Rate");
    }
}
