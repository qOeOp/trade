use anyhow::Context;
use serde::Serialize;
use statrs::distribution::{ContinuousCDF, Normal};
use vibe_analysis::{
    Returns,
    statistic::PortfolioStatistic,
    statistics::{
        returns_kurtosis::ReturnsKurtosis, returns_skewness::ReturnsSkewness,
        risk_return_ratio::RiskReturnRatio,
    },
};
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_core::UnixNanos;

const EULER_MASCHERONI: f64 = 0.577_215_664_901_532_9;

#[derive(Debug, Clone)]
pub(crate) struct TrialReturns {
    pub(crate) trial_id: String,
    pub(crate) returns: Returns,
}

pub(crate) fn trial_returns_from_canonical(
    trial_id: String,
    result: &CanonicalBacktestResult,
) -> anyhow::Result<TrialReturns> {
    let values = result
        .as_value()
        .pointer("/statistics/returns_series")
        .and_then(serde_json::Value::as_array)
        .context("canonical daily returns series is missing")?;
    let mut returns = Returns::new();

    for value in values {
        let timestamp = value
            .get("timestamp_ns")
            .and_then(serde_json::Value::as_str)
            .context("canonical return timestamp is missing")?
            .parse::<u64>()?;
        let bits = value
            .get("value")
            .and_then(serde_json::Value::as_str)
            .context("canonical return value is missing")?;
        let decoded = f64::from_bits(u64::from_str_radix(bits, 16)?);
        anyhow::ensure!(
            decoded.is_finite() && decoded > -1.0,
            "canonical return value is outside the finite simple-return domain"
        );
        anyhow::ensure!(
            returns
                .insert(UnixNanos::from(timestamp), decoded)
                .is_none(),
            "canonical daily return timestamp is duplicated"
        );
    }
    anyhow::ensure!(
        returns.len() == values.len(),
        "canonical daily returns series is not unique"
    );
    Ok(TrialReturns { trial_id, returns })
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RobustnessPolicy {
    pub(crate) observations: usize,
    pub(crate) slices: usize,
    pub(crate) selectable_trials: usize,
    pub(crate) max_pbo_ppm: u32,
    pub(crate) min_dsr_ppm: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FormationRobustnessReport {
    pub(crate) observation_source: String,
    pub(crate) observations: usize,
    pub(crate) cscv_slices: usize,
    pub(crate) cscv_combinations: usize,
    pub(crate) pbo_overfit_combinations: usize,
    pub(crate) pbo_ppm: u32,
    pub(crate) max_pbo_ppm: u32,
    pub(crate) selected_daily_risk_return_ratio_bits: String,
    pub(crate) expected_max_daily_risk_return_ratio_bits: String,
    pub(crate) selected_daily_skewness_bits: String,
    pub(crate) selected_daily_raw_kurtosis_bits: String,
    pub(crate) dsr_probability_bits: String,
    pub(crate) dsr_ppm: u32,
    pub(crate) min_dsr_ppm: u32,
    pub(crate) passed: bool,
}

pub(crate) fn analyze_formation_robustness(
    trials: &[TrialReturns],
    selected_trial_id: &str,
    policy: RobustnessPolicy,
) -> anyhow::Result<FormationRobustnessReport> {
    anyhow::ensure!(
        trials.len() == policy.selectable_trials,
        "robustness selectable-trial count does not match the frozen policy"
    );
    anyhow::ensure!(
        policy.observations > 3
            && policy.slices >= 4
            && policy.slices.is_multiple_of(2)
            && policy.observations.is_multiple_of(policy.slices),
        "robustness observation and CSCV slice policy is invalid"
    );
    anyhow::ensure!(
        (1..=1_000_000).contains(&policy.min_dsr_ppm) && policy.max_pbo_ppm <= 1_000_000,
        "robustness probability thresholds are invalid"
    );

    let synchronized = synchronized_prefix(trials, policy.observations)?;
    let selected_index = trials
        .iter()
        .position(|trial| trial.trial_id == selected_trial_id)
        .context("selected trial is absent from the robustness family")?;
    let (overfit, combinations) = cscv_pbo(&synchronized, trials, policy.slices)?;
    let pbo_ppm = probability_ppm(overfit, combinations)?;

    let ratios = synchronized
        .iter()
        .map(daily_risk_return_ratio)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let selected_returns = &synchronized[selected_index];
    let selected_ratio = ratios[selected_index];
    let ratio_std = sample_std(&ratios)?;
    let normal = Normal::standard();
    let trial_count = policy.selectable_trials as f64;
    let expected_max = ratio_std
        * ((1.0 - EULER_MASCHERONI) * normal.inverse_cdf(1.0 - 1.0 / trial_count)
            + EULER_MASCHERONI
                * normal.inverse_cdf(1.0 - 1.0 / (trial_count * std::f64::consts::E)));
    let skewness = ReturnsSkewness::new()
        .calculate_from_returns(selected_returns)
        .context("selected trial skewness is unavailable")?;
    let excess_kurtosis = ReturnsKurtosis::new()
        .calculate_from_returns(selected_returns)
        .context("selected trial kurtosis is unavailable")?;
    let raw_kurtosis = excess_kurtosis + 3.0;
    anyhow::ensure!(
        [selected_ratio, expected_max, skewness, raw_kurtosis]
            .into_iter()
            .all(f64::is_finite),
        "selected trial moments are not finite"
    );
    let denominator_squared =
        1.0 - skewness * selected_ratio + ((raw_kurtosis - 1.0) / 4.0) * selected_ratio.powi(2);
    anyhow::ensure!(
        denominator_squared.is_finite() && denominator_squared > 0.0,
        "deflated Sharpe denominator is invalid"
    );
    let z = (selected_ratio - expected_max) * ((policy.observations - 1) as f64).sqrt()
        / denominator_squared.sqrt();
    let dsr_probability = normal.cdf(z);
    anyhow::ensure!(
        dsr_probability.is_finite() && (0.0..=1.0).contains(&dsr_probability),
        "deflated Sharpe probability is invalid"
    );
    let dsr_ppm = (dsr_probability * 1_000_000.0).floor() as u32;

    Ok(FormationRobustnessReport {
        observation_source:
            "vibe-backtest-result/v1.statistics.returns_series:first-360-synchronous-daily"
                .to_string(),
        observations: policy.observations,
        cscv_slices: policy.slices,
        cscv_combinations: combinations,
        pbo_overfit_combinations: overfit,
        pbo_ppm,
        max_pbo_ppm: policy.max_pbo_ppm,
        selected_daily_risk_return_ratio_bits: f64_bits(selected_ratio),
        expected_max_daily_risk_return_ratio_bits: f64_bits(expected_max),
        selected_daily_skewness_bits: f64_bits(skewness),
        selected_daily_raw_kurtosis_bits: f64_bits(raw_kurtosis),
        dsr_probability_bits: f64_bits(dsr_probability),
        dsr_ppm,
        min_dsr_ppm: policy.min_dsr_ppm,
        passed: pbo_ppm <= policy.max_pbo_ppm && dsr_ppm >= policy.min_dsr_ppm,
    })
}

fn synchronized_prefix(
    trials: &[TrialReturns],
    observations: usize,
) -> anyhow::Result<Vec<Returns>> {
    let first = trials.first().context("robustness family is empty")?;
    let expected_timestamps = first
        .returns
        .keys()
        .take(observations)
        .copied()
        .collect::<Vec<_>>();
    anyhow::ensure!(
        expected_timestamps.len() == observations,
        "robustness family has too few daily observations"
    );

    trials
        .iter()
        .map(|trial| {
            let actual = trial
                .returns
                .iter()
                .take(observations)
                .map(|(timestamp, value)| (*timestamp, *value))
                .collect::<Vec<_>>();
            anyhow::ensure!(
                actual.len() == observations
                    && actual.iter().zip(&expected_timestamps).all(
                        |((actual, value), expected)| actual == expected
                            && value.is_finite()
                            && *value > -1.0
                    ),
                "robustness return matrix is not finite and synchronous"
            );
            Ok(actual.into_iter().collect())
        })
        .collect()
}

fn cscv_pbo(
    trials: &[Returns],
    identities: &[TrialReturns],
    slices: usize,
) -> anyhow::Result<(usize, usize)> {
    let slice_len = trials[0].len() / slices;
    let mut masks = Vec::new();
    choose_masks(slices, slices / 2, 0, 0, &mut masks);
    let mut overfit = 0usize;

    for mask in &masks {
        let in_sample = trials
            .iter()
            .map(|returns| select_slices(returns, *mask, slices, slice_len, true))
            .collect::<Vec<_>>();
        let out_of_sample = trials
            .iter()
            .map(|returns| select_slices(returns, *mask, slices, slice_len, false))
            .collect::<Vec<_>>();
        let in_scores = in_sample
            .iter()
            .map(daily_risk_return_ratio)
            .collect::<anyhow::Result<Vec<_>>>()?;
        let selected = best_index(&in_scores, identities);
        let out_scores = out_of_sample
            .iter()
            .map(daily_risk_return_ratio)
            .collect::<anyhow::Result<Vec<_>>>()?;
        let mut ranks = (0..out_scores.len()).collect::<Vec<_>>();
        ranks.sort_by(|left, right| {
            out_scores[*left]
                .total_cmp(&out_scores[*right])
                .then_with(|| identities[*left].trial_id.cmp(&identities[*right].trial_id))
        });
        let rank = ranks
            .iter()
            .position(|index| *index == selected)
            .expect("selected trial remains in the OOS family")
            + 1;

        if rank * 2 <= out_scores.len() {
            overfit += 1;
        }
    }
    Ok((overfit, masks.len()))
}

fn best_index(scores: &[f64], identities: &[TrialReturns]) -> usize {
    (0..scores.len())
        .max_by(|left, right| {
            scores[*left]
                .total_cmp(&scores[*right])
                .then_with(|| identities[*right].trial_id.cmp(&identities[*left].trial_id))
        })
        .expect("nonempty robustness family")
}

fn select_slices(
    returns: &Returns,
    mask: u64,
    slices: usize,
    slice_len: usize,
    selected: bool,
) -> Returns {
    returns
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            let slice = index / slice_len;
            slice < slices && (((mask >> slice) & 1) == 1) == selected
        })
        .map(|(_, (timestamp, value))| (*timestamp, *value))
        .collect()
}

fn choose_masks(total: usize, remaining: usize, next: usize, mask: u64, output: &mut Vec<u64>) {
    if remaining == 0 {
        output.push(mask);
        return;
    }

    for index in next..=total - remaining {
        choose_masks(
            total,
            remaining - 1,
            index + 1,
            mask | (1_u64 << index),
            output,
        );
    }
}

fn daily_risk_return_ratio(returns: &Returns) -> anyhow::Result<f64> {
    let value = RiskReturnRatio::new()
        .calculate_from_returns(returns)
        .context("daily risk-return ratio is unavailable")?;

    if value.is_finite() {
        return Ok(value);
    }

    if returns.values().all(|value| *value == 0.0) {
        return Ok(0.0);
    }
    anyhow::bail!("daily risk-return ratio is not finite")
}

fn sample_std(values: &[f64]) -> anyhow::Result<f64> {
    anyhow::ensure!(values.len() > 1, "trial ratio sample is too small");
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (values.len() - 1) as f64;
    let std = variance.sqrt();
    anyhow::ensure!(std.is_finite(), "trial ratio variance is not finite");
    Ok(std)
}

fn probability_ppm(numerator: usize, denominator: usize) -> anyhow::Result<u32> {
    anyhow::ensure!(
        denominator > 0 && numerator <= denominator,
        "invalid probability count"
    );
    let scaled = (numerator as u128) * 1_000_000_u128 / (denominator as u128);
    u32::try_from(scaled).context("probability ppm exceeds u32")
}

fn f64_bits(value: f64) -> String {
    format!("{:016x}", value.to_bits())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use rstest::rstest;

    use super::*;

    const DAY_NS: u64 = 86_400_000_000_000;

    fn trial(id: usize, inverted: bool) -> TrialReturns {
        let returns = (0..360)
            .map(|day| {
                let base = if day % 7 < 4 { 0.002 } else { -0.001 };
                let tilt = id as f64 * 0.000_01;
                let value = if inverted && day >= 180 {
                    -(base + tilt)
                } else {
                    base + tilt
                };
                (UnixNanos::from(day as u64 * DAY_NS), value)
            })
            .collect::<BTreeMap<_, _>>();
        TrialReturns {
            trial_id: format!("trial-{id:02}"),
            returns,
        }
    }

    #[rstest]
    fn robustness_is_deterministic_and_retains_exact_probability_counts() {
        let trials = (0..4).map(|id| trial(id, false)).collect::<Vec<_>>();
        let first = analyze_formation_robustness(
            &trials,
            "trial-03",
            RobustnessPolicy {
                observations: 360,
                slices: 12,
                selectable_trials: 4,
                max_pbo_ppm: 1_000_000,
                min_dsr_ppm: 1,
            },
        )
        .unwrap();
        let second = analyze_formation_robustness(
            &trials,
            "trial-03",
            RobustnessPolicy {
                observations: 360,
                slices: 12,
                selectable_trials: 4,
                max_pbo_ppm: 1_000_000,
                min_dsr_ppm: 1,
            },
        )
        .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.cscv_combinations, 924);
        assert_eq!(first.pbo_overfit_combinations, 0);
        assert_eq!(first.pbo_ppm, 0);
        assert_eq!(
            first.selected_daily_risk_return_ratio_bits,
            "3fe044b1fb97eaee"
        );
        assert_eq!(
            first.expected_max_daily_risk_return_ratio_bits,
            "3f82bb3429ba4fe8"
        );
        assert_eq!(first.selected_daily_skewness_bits, "bfd38045b07b4f6b");
        assert_eq!(first.selected_daily_raw_kurtosis_bits, "3ff15085c15dbfd9");
        assert_eq!(first.dsr_probability_bits, "3ff0000000000000");
        assert_eq!(first.dsr_ppm, 1_000_000);
    }

    #[rstest]
    fn cscv_detects_a_family_whose_winner_reverses_out_of_sample() {
        let mut trials = (0..4).map(|id| trial(id, false)).collect::<Vec<_>>();
        trials[3] = trial(3, true);
        let report = analyze_formation_robustness(
            &trials,
            "trial-03",
            RobustnessPolicy {
                observations: 360,
                slices: 12,
                selectable_trials: 4,
                max_pbo_ppm: 0,
                min_dsr_ppm: 1_000_000,
            },
        )
        .unwrap();
        assert!(!report.passed);
        assert!(report.pbo_overfit_combinations > 0);
    }

    #[rstest]
    fn synchronization_drift_is_rejected() {
        let mut trials = (0..4).map(|id| trial(id, false)).collect::<Vec<_>>();
        trials[3].returns.remove(&UnixNanos::from(7 * DAY_NS));
        assert!(
            analyze_formation_robustness(
                &trials,
                "trial-03",
                RobustnessPolicy {
                    observations: 360,
                    slices: 12,
                    selectable_trials: 4,
                    max_pbo_ppm: 50_000,
                    min_dsr_ppm: 950_000,
                },
            )
            .is_err()
        );
    }

    #[rstest]
    fn zero_variance_family_is_rejected_instead_of_becoming_a_pass() {
        let trials = (0..4)
            .map(|id| TrialReturns {
                trial_id: format!("trial-{id:02}"),
                returns: (0..360)
                    .map(|day| (UnixNanos::from(day as u64 * DAY_NS), 0.0))
                    .collect(),
            })
            .collect::<Vec<_>>();
        assert!(
            analyze_formation_robustness(
                &trials,
                "trial-03",
                RobustnessPolicy {
                    observations: 360,
                    slices: 12,
                    selectable_trials: 4,
                    max_pbo_ppm: 50_000,
                    min_dsr_ppm: 950_000,
                },
            )
            .is_err()
        );
    }
}
