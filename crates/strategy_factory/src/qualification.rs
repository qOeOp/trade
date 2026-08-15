use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use statrs::distribution::{ContinuousCDF, Normal};
use vibe_analysis::{
    Returns,
    statistic::PortfolioStatistic,
    statistics::{
        max_drawdown::MaxDrawdown, returns_kurtosis::ReturnsKurtosis,
        returns_skewness::ReturnsSkewness, risk_return_ratio::RiskReturnRatio,
    },
};
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_core::UnixNanos;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum QualificationMetricFailure {
    DomainRejected(&'static str),
    StateUnavailable(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QualificationMetricReport {
    pub(crate) observation_source: String,
    pub(crate) observations: usize,
    pub(crate) daily_risk_return_ratio_bits: String,
    pub(crate) daily_skewness_bits: String,
    pub(crate) daily_raw_kurtosis_bits: String,
    pub(crate) psr_denominator_squared_bits: String,
    pub(crate) psr_probability_bits: String,
    pub(crate) psr_ppm: u32,
    pub(crate) min_psr_ppm: u32,
    pub(crate) max_drawdown_bits: String,
    pub(crate) absolute_drawdown_ppm: u32,
    pub(crate) max_absolute_drawdown_ppm: u32,
    pub(crate) passed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QualificationMetricPolicy {
    pub(crate) observation_source: String,
    pub(crate) observations: usize,
    pub(crate) warmup_first_timestamp_ns: u64,
    pub(crate) first_timestamp_ns: u64,
    pub(crate) last_timestamp_ns: u64,
    pub(crate) timestamp_step_ns: u64,
    pub(crate) min_psr_ppm: u32,
    pub(crate) max_absolute_drawdown_ppm: u32,
}

impl QualificationMetricPolicy {
    pub(crate) fn validate(&self) -> Result<(), QualificationMetricFailure> {
        let projected_last = self
            .timestamp_step_ns
            .checked_mul(self.observations.saturating_sub(1) as u64)
            .and_then(|offset| self.first_timestamp_ns.checked_add(offset))
            .ok_or(QualificationMetricFailure::StateUnavailable(
                "qualification_timestamp_policy",
            ))?;

        if self.observation_source.is_empty()
            || self.observations < 2
            || self.timestamp_step_ns == 0
            || self.warmup_first_timestamp_ns > self.first_timestamp_ns
            || projected_last != self.last_timestamp_ns
            || self.min_psr_ppm > 1_000_000
            || self.max_absolute_drawdown_ppm > 1_000_000
        {
            return Err(QualificationMetricFailure::StateUnavailable(
                "qualification_metric_policy",
            ));
        }
        Ok(())
    }
}

pub(crate) fn analyze_qualification_metrics(
    result: &CanonicalBacktestResult,
    policy: &QualificationMetricPolicy,
) -> Result<QualificationMetricReport, QualificationMetricFailure> {
    policy.validate()?;
    let returns = qualification_returns_from_canonical(result, policy)?;
    analyze_returns(&returns, policy)
}

fn qualification_returns_from_canonical(
    result: &CanonicalBacktestResult,
    policy: &QualificationMetricPolicy,
) -> Result<Returns, QualificationMetricFailure> {
    let values = result
        .as_value()
        .pointer("/statistics/returns_series")
        .and_then(serde_json::Value::as_array)
        .ok_or(QualificationMetricFailure::StateUnavailable(
            "returns_series_shape",
        ))?;
    let mut returns = BTreeMap::new();
    let mut prior_timestamp = None;

    for value in values {
        let timestamp = value
            .get("timestamp_ns")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(QualificationMetricFailure::StateUnavailable(
                "return_timestamp_shape",
            ))?;

        if prior_timestamp.is_some_and(|prior| prior >= timestamp) {
            return Err(QualificationMetricFailure::StateUnavailable(
                "return_timestamp_order_or_duplicate",
            ));
        }
        prior_timestamp = Some(timestamp);
        let bits = value
            .get("value")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| u64::from_str_radix(value, 16).ok())
            .ok_or(QualificationMetricFailure::StateUnavailable(
                "return_value_shape",
            ))?;
        let decoded = f64::from_bits(bits);
        let in_qualification =
            (policy.first_timestamp_ns..=policy.last_timestamp_ns).contains(&timestamp);

        if !decoded.is_finite() || decoded <= -1.0 {
            if !in_qualification {
                return Err(QualificationMetricFailure::StateUnavailable(
                    "warmup_return_value_domain",
                ));
            }
            return Err(QualificationMetricFailure::DomainRejected(
                "return_value_domain",
            ));
        }

        if timestamp < policy.first_timestamp_ns {
            if timestamp < policy.warmup_first_timestamp_ns
                || !(policy.first_timestamp_ns - timestamp).is_multiple_of(policy.timestamp_step_ns)
            {
                return Err(QualificationMetricFailure::StateUnavailable(
                    "warmup_return_timestamp_projection",
                ));
            }
            continue;
        }

        if timestamp > policy.last_timestamp_ns
            || !(timestamp - policy.first_timestamp_ns).is_multiple_of(policy.timestamp_step_ns)
        {
            return Err(QualificationMetricFailure::StateUnavailable(
                "return_timestamp_projection",
            ));
        }

        if returns
            .insert(UnixNanos::from(timestamp), decoded)
            .is_some()
        {
            return Err(QualificationMetricFailure::StateUnavailable(
                "return_timestamp_duplicate",
            ));
        }
    }

    if returns.len() != policy.observations {
        return Err(QualificationMetricFailure::StateUnavailable(
            "returns_series_count",
        ));
    }
    Ok(returns)
}

fn analyze_returns(
    returns: &Returns,
    policy: &QualificationMetricPolicy,
) -> Result<QualificationMetricReport, QualificationMetricFailure> {
    let risk_return_owner = RiskReturnRatio::new();
    let owner_returns = risk_return_owner.downsample_to_daily_bins(returns);
    validate_risk_return_intermediates(&owner_returns)?;
    let ratio = risk_return_owner.calculate_from_returns(returns).ok_or(
        QualificationMetricFailure::StateUnavailable("risk_return_ratio_owner"),
    )?;

    if !ratio.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_risk_return_ratio_output",
        ));
    }
    let skewness = ReturnsSkewness::new()
        .calculate_from_returns(returns)
        .ok_or(QualificationMetricFailure::StateUnavailable(
            "skewness_owner",
        ))?;
    let excess_kurtosis = ReturnsKurtosis::new()
        .calculate_from_returns(returns)
        .ok_or(QualificationMetricFailure::StateUnavailable(
            "kurtosis_owner",
        ))?;

    if !skewness.is_finite() || !excess_kurtosis.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_moment_output",
        ));
    }
    let raw_kurtosis = excess_kurtosis + 3.0;
    let denominator_squared = 1.0 - skewness * ratio + ((raw_kurtosis - 1.0) / 4.0) * ratio.powi(2);
    if !denominator_squared.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_psr_denominator_output",
        ));
    }

    if denominator_squared <= 0.0 {
        return Err(QualificationMetricFailure::DomainRejected(
            "nonpositive_psr_denominator",
        ));
    }
    let z = ratio * ((policy.observations - 1) as f64).sqrt() / denominator_squared.sqrt();
    let probability = Normal::standard().cdf(z);
    if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_psr_probability_output",
        ));
    }
    let psr_ppm = (probability * 1_000_000.0).floor() as u32;

    validate_drawdown_intermediates(returns)?;
    let max_drawdown = MaxDrawdown::new().calculate_from_returns(returns).ok_or(
        QualificationMetricFailure::StateUnavailable("max_drawdown_owner"),
    )?;

    if !max_drawdown.is_finite() || !(-1.0..=0.0).contains(&max_drawdown) {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_drawdown_output",
        ));
    }
    let absolute_drawdown_ppm = (-max_drawdown * 1_000_000.0).ceil() as u32;

    Ok(QualificationMetricReport {
        observation_source: policy.observation_source.clone(),
        observations: policy.observations,
        daily_risk_return_ratio_bits: f64_bits(ratio),
        daily_skewness_bits: f64_bits(skewness),
        daily_raw_kurtosis_bits: f64_bits(raw_kurtosis),
        psr_denominator_squared_bits: f64_bits(denominator_squared),
        psr_probability_bits: f64_bits(probability),
        psr_ppm,
        min_psr_ppm: policy.min_psr_ppm,
        max_drawdown_bits: f64_bits(max_drawdown),
        absolute_drawdown_ppm,
        max_absolute_drawdown_ppm: policy.max_absolute_drawdown_ppm,
        passed: psr_ppm >= policy.min_psr_ppm
            && absolute_drawdown_ppm <= policy.max_absolute_drawdown_ppm,
    })
}

fn validate_risk_return_intermediates(returns: &Returns) -> Result<(), QualificationMetricFailure> {
    let count = returns.len() as f64;
    let sum = returns.values().sum::<f64>();
    if !sum.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_risk_return_sum_intermediate",
        ));
    }
    let mean = sum / count;
    if !mean.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_risk_return_mean_intermediate",
        ));
    }
    let variance_sum = returns
        .values()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>();

    if !variance_sum.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_risk_return_variance_intermediate",
        ));
    }
    let sample_std = (variance_sum / (count - 1.0)).sqrt();
    if !sample_std.is_finite() {
        return Err(QualificationMetricFailure::StateUnavailable(
            "nonfinite_risk_return_standard_deviation_output",
        ));
    }

    if sample_std == 0.0 {
        return Err(QualificationMetricFailure::DomainRejected(
            "zero_sample_standard_deviation",
        ));
    }
    Ok(())
}

fn validate_drawdown_intermediates(returns: &Returns) -> Result<(), QualificationMetricFailure> {
    let mut cumulative = 1.0_f64;
    let mut running_max = 1.0_f64;

    for value in returns.values() {
        cumulative *= 1.0 + value;
        if !cumulative.is_finite() {
            return Err(QualificationMetricFailure::StateUnavailable(
                "nonfinite_drawdown_equity_intermediate",
            ));
        }
        running_max = running_max.max(cumulative);
        let drawdown = (running_max - cumulative) / running_max;
        if !running_max.is_finite() || !drawdown.is_finite() {
            return Err(QualificationMetricFailure::StateUnavailable(
                "nonfinite_drawdown_intermediate",
            ));
        }
    }
    Ok(())
}

fn f64_bits(value: f64) -> String {
    format!("{:016x}", value.to_bits())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn policy() -> QualificationMetricPolicy {
        QualificationMetricPolicy {
            observation_source: "synthetic-daily-qualification".to_string(),
            observations: 366,
            warmup_first_timestamp_ns: 1_702_857_600_000_000_000,
            first_timestamp_ns: 1_704_067_200_000_000_000,
            last_timestamp_ns: 1_735_603_200_000_000_000,
            timestamp_step_ns: 86_400_000_000_000,
            min_psr_ppm: 950_000,
            max_absolute_drawdown_ppm: 250_000,
        }
    }

    fn synthetic_returns(value: impl Fn(usize) -> f64) -> Returns {
        let policy = policy();
        (0..policy.observations)
            .map(|index| {
                (
                    UnixNanos::from(
                        policy.first_timestamp_ns + index as u64 * policy.timestamp_step_ns,
                    ),
                    value(index),
                )
            })
            .collect()
    }

    #[rstest]
    fn qualification_metrics_are_deterministic_and_owner_derived() {
        let policy = policy();
        let result = canonical_result(
            (0..policy.observations)
                .map(|index| {
                    (
                        policy.first_timestamp_ns + index as u64 * policy.timestamp_step_ns,
                        if index % 7 < 5 { 0.002 } else { -0.001 },
                    )
                })
                .collect(),
        );
        let first = analyze_qualification_metrics(&result, &policy).unwrap();
        let second = analyze_qualification_metrics(&result, &policy).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.observations, 366);
        assert!(first.psr_ppm <= 1_000_000);
        assert!(first.absolute_drawdown_ppm <= 1_000_000);
        assert_eq!(
            first.passed,
            first.psr_ppm >= 950_000 && first.absolute_drawdown_ppm <= 250_000
        );
    }

    #[rstest]
    fn zero_dispersion_is_a_terminal_metric_domain_rejection() {
        let returns = synthetic_returns(|_| 0.0);
        assert_eq!(
            analyze_returns(&returns, &policy()),
            Err(QualificationMetricFailure::DomainRejected(
                "zero_sample_standard_deviation"
            ))
        );
    }

    #[rstest]
    fn wrong_timestamp_projection_is_state_unavailable() {
        let policy = policy();
        let result = canonical_result(
            (0..policy.observations)
                .map(|index| {
                    let timestamp = policy.first_timestamp_ns
                        + index as u64 * policy.timestamp_step_ns
                        + u64::from(index == 7);
                    (timestamp, 0.001)
                })
                .collect(),
        );
        assert_eq!(
            qualification_returns_from_canonical(&result, &policy),
            Err(QualificationMetricFailure::StateUnavailable(
                "return_timestamp_projection"
            ))
        );
    }

    #[rstest]
    fn nonfinite_input_is_a_terminal_metric_domain_rejection() {
        let policy = policy();
        let mut values = (0..policy.observations)
            .map(|index| {
                (
                    policy.first_timestamp_ns + index as u64 * policy.timestamp_step_ns,
                    0.001,
                )
            })
            .collect::<Vec<_>>();
        values[17].1 = f64::NAN;
        let result = canonical_result(values);
        assert_eq!(
            qualification_returns_from_canonical(&result, &policy),
            Err(QualificationMetricFailure::DomainRejected(
                "return_value_domain"
            ))
        );
    }

    #[rstest]
    fn finite_returns_that_overflow_compounded_equity_are_state_unavailable() {
        let returns = synthetic_returns(|index| if index == 365 { -0.5 } else { 1_000.0 });
        assert_eq!(
            analyze_returns(&returns, &policy()),
            Err(QualificationMetricFailure::StateUnavailable(
                "nonfinite_drawdown_equity_intermediate"
            ))
        );
    }

    #[rstest]
    fn finite_returns_that_overflow_risk_ratio_sum_are_state_unavailable() {
        let returns = synthetic_returns(|_| f64::MAX);
        assert_eq!(
            analyze_returns(&returns, &policy()),
            Err(QualificationMetricFailure::StateUnavailable(
                "nonfinite_risk_return_sum_intermediate"
            ))
        );
    }

    #[rstest]
    fn native_daily_projection_zero_dispersion_is_domain_rejected() {
        let returns = synthetic_returns(|index| {
            if index.is_multiple_of(2) {
                1e-160
            } else {
                2e-160
            }
        });
        assert_eq!(
            analyze_returns(&returns, &policy()),
            Err(QualificationMetricFailure::DomainRejected(
                "zero_sample_standard_deviation"
            ))
        );
    }

    fn canonical_result(values: Vec<(u64, f64)>) -> CanonicalBacktestResult {
        let returns_series = values
            .into_iter()
            .map(|(timestamp, value)| {
                serde_json::json!({
                    "timestamp_ns": timestamp.to_string(),
                    "value": f64_bits(value),
                })
            })
            .collect::<Vec<_>>();
        let document = serde_json::json!({
            "accounts": [],
            "components": {"actor_ids": [], "exec_algorithm_ids": [], "strategy_ids": [], "trader_state": "STOPPED"},
            "diagnostics": [],
            "fills": [],
            "orders": [],
            "portfolio_snapshots": [],
            "position_snapshots": [],
            "positions": [],
            "run": {"backtest_end_ns": "2", "backtest_start_ns": "1", "iterations": "1", "outcome": "completed", "run_config_id": null, "total_events": "0", "total_orders": "0", "total_positions": "0", "trader_id": "TRADER-001"},
            "schema": "vibe-backtest-result/v1",
            "statistics": {"general": {}, "pnls": {}, "returns": {}, "returns_series": returns_series},
            "summary": {}
        });
        CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap()).unwrap()
    }
}
