use std::fmt::Display;

use vibe_model::position::Position;

use crate::{Returns, statistic::PortfolioStatistic};

/// Calculates the average losing trade from realized PnLs.
///
/// Only negative PnLs count as losers. Returns `NaN` for an empty series or
/// when there are no losing trades.
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
pub struct AvgLoser {}

impl Display for AvgLoser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Avg Loser")
    }
}

impl PortfolioStatistic for AvgLoser {
    type Item = f64;

    fn name(&self) -> String {
        self.to_string()
    }

    fn calculate_from_realized_pnls(&self, realized_pnls: &[f64]) -> Option<Self::Item> {
        if realized_pnls.is_empty() {
            return Some(f64::NAN);
        }

        let losers: Vec<f64> = realized_pnls
            .iter()
            .filter(|&&pnl| pnl < 0.0)
            .copied()
            .collect();

        if losers.is_empty() {
            return Some(f64::NAN);
        }

        let sum: f64 = losers.iter().sum();
        Some(sum / losers.len() as f64)
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
        let avg_loser = AvgLoser {};
        let result = avg_loser.calculate_from_realized_pnls(&[]);
        assert!(result.is_some());
        assert!(result.unwrap().is_nan());
    }

    #[rstest]
    fn test_no_losers() {
        let avg_loser = AvgLoser {};
        let pnls = vec![10.0, 20.0, 30.0];
        let result = avg_loser.calculate_from_realized_pnls(&pnls);
        assert!(result.is_some());
        assert!(result.unwrap().is_nan());
    }

    #[rstest]
    fn test_only_losers() {
        let avg_loser = AvgLoser {};
        let pnls = vec![-10.0, -20.0, -30.0];
        let result = avg_loser.calculate_from_realized_pnls(&pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), -20.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_mixed_pnls() {
        let avg_loser = AvgLoser {};
        let pnls = vec![10.0, -20.0, 30.0, -40.0];
        let result = avg_loser.calculate_from_realized_pnls(&pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), -30.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_zero_excluded() {
        let avg_loser = AvgLoser {};
        let pnls = vec![10.0, 0.0, -20.0, -30.0];
        let result = avg_loser.calculate_from_realized_pnls(&pnls);
        assert!(result.is_some());
        // Zero excluded, average of [-20.0, -30.0]
        assert!(approx_eq!(f64, result.unwrap(), -25.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_single_loser() {
        let avg_loser = AvgLoser {};
        let pnls = vec![-10.0];
        let result = avg_loser.calculate_from_realized_pnls(&pnls);
        assert!(result.is_some());
        assert!(approx_eq!(f64, result.unwrap(), -10.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_name() {
        let avg_loser = AvgLoser {};
        assert_eq!(avg_loser.name(), "Avg Loser");
    }
}
