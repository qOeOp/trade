use std::fmt::Display;

use vibe_model::position::Position;

use crate::{Returns, statistic::PortfolioStatistic};

/// Calculates the arithmetic mean of the positive portfolio returns.
///
/// Zero returns are excluded (neither wins nor losses). Returns `NaN` for an
/// empty series or when there are no positive returns.
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
pub struct ReturnsAverageWin {}

impl Display for ReturnsAverageWin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Average Win (Return)")
    }
}

impl PortfolioStatistic for ReturnsAverageWin {
    type Item = f64;

    fn name(&self) -> String {
        self.to_string()
    }

    fn calculate_from_returns(&self, returns: &Returns) -> Option<Self::Item> {
        if !self.check_valid_returns(returns) {
            return Some(f64::NAN);
        }

        let positive_returns: Vec<f64> = returns.values().copied().filter(|&x| x > 0.0).collect();

        if positive_returns.is_empty() {
            return Some(f64::NAN);
        }

        let sum: f64 = positive_returns.iter().sum();
        let count = positive_returns.len() as f64;

        Some(sum / count)
    }
    fn calculate_from_realized_pnls(&self, _realized_pnls: &[f64]) -> Option<Self::Item> {
        None
    }

    fn calculate_from_positions(&self, _positions: &[Position]) -> Option<Self::Item> {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use rstest::rstest;
    use vibe_core::{UnixNanos, approx_eq};

    use super::*;

    fn create_returns(values: &[f64]) -> Returns {
        let mut new_return = BTreeMap::new();
        for (i, value) in values.iter().enumerate() {
            new_return.insert(UnixNanos::from(i as u64), *value);
        }
        new_return
    }

    #[rstest]
    fn test_empty_returns() {
        let avg_win = ReturnsAverageWin {};
        let returns = create_returns(&[]);
        let result = avg_win.calculate_from_returns(&returns);
        assert!(result.is_some());
        assert!(result.unwrap().is_nan());
    }

    #[rstest]
    fn test_all_negative() {
        let avg_win = ReturnsAverageWin {};
        let returns = create_returns(&[-10.0, -20.0, -30.0]);
        let result = avg_win.calculate_from_returns(&returns);
        assert!(result.is_some());
        assert!(result.unwrap().is_nan());
    }

    #[rstest]
    fn test_all_positive() {
        let avg_win = ReturnsAverageWin {};
        let returns = create_returns(&[10.0, 20.0, 30.0]);
        let result = avg_win.calculate_from_returns(&returns);
        assert!(result.is_some());
        // Average of [10.0, 20.0, 30.0] = (10 + 20 + 30) / 3 = 20.0
        assert!(approx_eq!(f64, result.unwrap(), 20.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_mixed_returns() {
        let avg_win = ReturnsAverageWin {};
        let returns = create_returns(&[10.0, -20.0, 30.0, -40.0]);
        let result = avg_win.calculate_from_returns(&returns);
        assert!(result.is_some());
        // Average of [10.0, 30.0] = (10 + 30) / 2 = 20.0
        assert!(approx_eq!(f64, result.unwrap(), 20.0, epsilon = 1e-9));
    }

    #[rstest]
    fn test_name() {
        let avg_win = ReturnsAverageWin {};
        assert_eq!(avg_win.name(), "Average Win (Return)");
    }
}
