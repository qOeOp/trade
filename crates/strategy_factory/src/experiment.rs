use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const COMPLEX_INTENT_BYTES: &[u8] = include_bytes!("../assets/complex_intent_v4.jcs");
const REFINED_PREDECESSOR_INTENT_BYTES: &[u8] = include_bytes!("../assets/complex_intent_v3.jcs");
pub(crate) const COMPLEX_INTENT_ID: &str = "researchintent-strategy-factory-complex-v4";
pub(crate) const COMPLEX_EXPERIMENT_ID: &str = "btc-usdt-1h-composed-regime-v4";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PriceOnlyResearchIntent {
    pub(crate) identity: String,
    pub(crate) kind: String,
    pub(crate) payload: ComplexIntentPayload,
    pub(crate) revision: String,
    pub(crate) schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComplexIntentPayload {
    pub(crate) components: ComponentSpec,
    pub(crate) costs: ComplexCostSpec,
    pub(crate) data: ComplexDataSpec,
    pub(crate) disposition: DispositionSpec,
    pub(crate) evidence: Vec<EvidenceSpec>,
    pub(crate) experiment_id: String,
    pub(crate) family: TrialFamily,
    pub(crate) non_claims: Vec<String>,
    pub(crate) predecessor: PredecessorSpec,
    pub(crate) qualification_policy: QualificationPolicy,
    pub(crate) robustness_policy: RobustnessPolicySpec,
    pub(crate) trial_policy: TrialPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvidenceSpec {
    pub(crate) id: String,
    pub(crate) locator: String,
    pub(crate) role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComponentSpec {
    pub(crate) conditional_reversal: String,
    pub(crate) dynamic_exit: String,
    pub(crate) regime_gate: String,
    pub(crate) trend_continuation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComplexCostSpec {
    pub(crate) execution: String,
    pub(crate) fee_authority: String,
    pub(crate) initial_balance: String,
    pub(crate) position_sizing: String,
    pub(crate) slippage: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComplexDataSpec {
    pub(crate) bar_type: String,
    pub(crate) formation_open_time: TimeRange,
    pub(crate) qualification_open_time: TimeRange,
    pub(crate) qualification_warmup_open_time: TimeRange,
    pub(crate) snapshot_semantics: String,
    pub(crate) source: String,
    pub(crate) universe: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TimeRange {
    pub(crate) end_ns: String,
    pub(crate) start_ns: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DispositionSpec {
    pub(crate) combination: String,
    pub(crate) mechanism: String,
    pub(crate) profitability: String,
    pub(crate) qualification: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialFamily {
    pub(crate) holdout_access: String,
    pub(crate) selection: String,
    pub(crate) tuples: Vec<TrialTuple>,
    pub(crate) variants: Vec<TrialVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialVariant {
    pub(crate) dynamic_exit: bool,
    pub(crate) fixed_notional_bps: Option<u32>,
    pub(crate) id: String,
    pub(crate) regime_gate: bool,
    pub(crate) reversal: bool,
    pub(crate) volatility_sizing: bool,
}

impl TrialVariant {
    pub(crate) fn code(&self) -> Result<i32, ExperimentError> {
        match self.id.as_str() {
            "full" => Ok(0),
            "without-reversal" => Ok(1),
            "without-regime-gate" => Ok(2),
            "without-volatility-sizing" => Ok(3),
            "without-dynamic-exit" => Ok(4),
            _ => Err(ExperimentError::Binding("trial variant")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PredecessorSpec {
    pub(crate) disposition: String,
    pub(crate) intent_digest: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialTuple {
    pub(crate) atr_period: u32,
    pub(crate) band_period: u32,
    pub(crate) band_sigma_milli: u32,
    pub(crate) breakout_lookback: u32,
    pub(crate) exit_lookback: u32,
    pub(crate) fast_ema: u32,
    pub(crate) id: String,
    pub(crate) max_volatility_ratio_milli: u32,
    pub(crate) rsi_entry_max_milli: u32,
    pub(crate) rsi_period: u32,
    pub(crate) slow_ema: u32,
    pub(crate) target_risk_bps: u32,
    pub(crate) trailing_atr_milli: u32,
    pub(crate) volatility_fast: u32,
    pub(crate) volatility_slow: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TrialPolicy {
    pub(crate) all_attempts_retained: bool,
    pub(crate) intent_rewrite_after_results: String,
    pub(crate) qualification_runs: u32,
    pub(crate) tuple_count: u32,
    pub(crate) variant_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RobustnessPolicySpec {
    pub(crate) candidate_scope: String,
    pub(crate) cscv_role: String,
    pub(crate) cscv_slices: u32,
    pub(crate) deflated_sharpe_formula: String,
    pub(crate) kurtosis_estimator: String,
    pub(crate) max_pbo_ppm: u32,
    pub(crate) min_dsr_ppm: u32,
    pub(crate) numerical_failure: String,
    pub(crate) observations: u32,
    pub(crate) pbo_definition: String,
    pub(crate) performance_metric: String,
    pub(crate) return_source: String,
    pub(crate) selectable_trial_count: u32,
    pub(crate) sharpe_trial_count: String,
    pub(crate) skewness_estimator: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QualificationPolicy {
    pub(crate) absolute_drawdown_ppm_quantization: String,
    pub(crate) completed_round_trip_source: String,
    pub(crate) daily_return_count: u32,
    pub(crate) daily_return_first_timestamp_ns: String,
    pub(crate) daily_return_last_timestamp_ns: String,
    pub(crate) daily_return_timestamp_step_ns: String,
    pub(crate) drawdown_formula: String,
    pub(crate) drawdown_owner: String,
    pub(crate) kurtosis_estimator: String,
    pub(crate) logical_run_identity: String,
    pub(crate) max_absolute_drawdown_ppm: u32,
    pub(crate) metric_domain_rejection: String,
    pub(crate) metric_software_unavailable: String,
    pub(crate) min_completed_round_trips: u32,
    pub(crate) min_net_pnl: String,
    pub(crate) min_probabilistic_sharpe_ppm: u32,
    pub(crate) missing_or_noncanonical_terminal_receipt: String,
    pub(crate) orders_and_metrics_partition: String,
    pub(crate) probabilistic_sharpe_formula: String,
    pub(crate) probabilistic_sharpe_ppm_quantization: String,
    pub(crate) public_output: String,
    pub(crate) returns_projection: String,
    pub(crate) returns_source: String,
    pub(crate) risk_free_rate: String,
    pub(crate) risk_return_ratio: String,
    pub(crate) run_count: u32,
    pub(crate) skewness_estimator: String,
    pub(crate) software_failure: String,
    pub(crate) source_projection: String,
    pub(crate) standard_normal_cdf: String,
    pub(crate) terminal_signal: String,
    pub(crate) terminal_state: String,
    pub(crate) warmup_orders: String,
    pub(crate) warmup_role: String,
    pub(crate) year_2024_orders_and_metrics_only: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ExperimentError {
    #[error("complex ResearchIntent is malformed: {0}")]
    Malformed(String),
    #[error("complex ResearchIntent binding mismatch: {0}")]
    Binding(&'static str),
    #[error("unknown trial tuple: {0}")]
    UnknownTuple(String),
    #[error("unknown trial variant: {0}")]
    UnknownVariant(String),
}

impl PriceOnlyResearchIntent {
    pub(crate) fn frozen() -> Result<Self, ExperimentError> {
        let intent = parse_intent(COMPLEX_INTENT_BYTES)?;
        intent.validate_canonical_encoding()?;
        intent.validate_invariants()?;
        Ok(intent)
    }

    pub(crate) fn canonical_bytes(&self) -> &'static [u8] {
        COMPLEX_INTENT_BYTES
    }

    pub(crate) fn tuple(&self, id: &str) -> Result<&TrialTuple, ExperimentError> {
        self.payload
            .family
            .tuples
            .iter()
            .find(|tuple| tuple.id == id)
            .ok_or_else(|| ExperimentError::UnknownTuple(id.to_string()))
    }

    pub(crate) fn variant(&self, id: &str) -> Result<&TrialVariant, ExperimentError> {
        self.payload
            .family
            .variants
            .iter()
            .find(|variant| variant.id == id)
            .ok_or_else(|| ExperimentError::UnknownVariant(id.to_string()))
    }

    pub(crate) fn validate_frozen_binding(&self) -> Result<(), ExperimentError> {
        let frozen = parse_intent(COMPLEX_INTENT_BYTES)?;
        if self != &frozen {
            return Err(ExperimentError::Binding("canonical frozen bytes"));
        }
        self.validate_canonical_encoding()?;
        self.validate_invariants()
    }

    fn validate_canonical_encoding(&self) -> Result<(), ExperimentError> {
        let mut expected =
            serde_json::to_vec(self).map_err(|e| ExperimentError::Malformed(e.to_string()))?;
        expected.push(b'\n');
        if expected != COMPLEX_INTENT_BYTES {
            return Err(ExperimentError::Binding("canonical JCS encoding"));
        }
        Ok(())
    }

    fn validate_invariants(&self) -> Result<(), ExperimentError> {
        if self.identity != COMPLEX_INTENT_ID
            || self.kind != "ResearchIntent"
            || self.revision != "4"
            || self.schema_version != 3
            || self.payload.experiment_id != COMPLEX_EXPERIMENT_ID
        {
            return Err(ExperimentError::Binding("identity/revision/schema"));
        }

        let costs = &self.payload.costs;
        if costs.execution != "market_at_next_executable_external_bar_open"
            || costs.fee_authority != "native_instrument_fee_model"
            || costs.initial_balance != "1000000 USDT"
            || costs.position_sizing
                != "tuple_target_risk_bps_over_closed_bar_atr_capped_by_available_cash"
            || costs.slippage != "not_modeled"
        {
            return Err(ExperimentError::Binding("costs"));
        }

        let data = &self.payload.data;
        let formation_end = parse_ns(&data.formation_open_time.end_ns)?;
        let qualification_start = parse_ns(&data.qualification_open_time.start_ns)?;
        let qualification_warmup_start = parse_ns(&data.qualification_warmup_open_time.start_ns)?;
        let qualification_warmup_end = parse_ns(&data.qualification_warmup_open_time.end_ns)?;
        if data.bar_type != "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL"
            || data.snapshot_semantics != "retrospective_current"
            || data.source != "Binance Spot public historical market data"
            || data.universe != ["BTCUSDT.BINANCE"]
            || parse_ns(&data.formation_open_time.start_ns)? >= formation_end
            || qualification_start >= parse_ns(&data.qualification_open_time.end_ns)?
            || formation_end >= qualification_start
            || qualification_warmup_start != 1_702_857_600_000_000_000
            || qualification_warmup_end != formation_end
            || qualification_warmup_start >= qualification_warmup_end
        {
            return Err(ExperimentError::Binding("data source/windows"));
        }

        let policy = &self.payload.trial_policy;
        if !policy.all_attempts_retained
            || policy.intent_rewrite_after_results != "forbidden"
            || policy.qualification_runs != 1
            || policy.tuple_count as usize != self.payload.family.tuples.len()
            || policy.tuple_count != 4
            || policy.variant_count as usize != self.payload.family.variants.len()
            || policy.variant_count != 5
            || self.payload.family.holdout_access
                != "one_content_addressed_logical_run_after_selection_deterministic_recovery_may_reread"
            || self.payload.family.selection
                != "full_variant_requires_positive_net_pnl_gt_native_commissions_and_strictly_beats_all_deletions_then_net_pnl_per_target_risk_bps_then_tuple_id"
        {
            return Err(ExperimentError::Binding("bounded trial family"));
        }

        let robustness = &self.payload.robustness_policy;
        if robustness.candidate_scope != "four_selectable_full_tuples_only"
            || robustness.cscv_role
                != "auxiliary_gate_not_complete_full_vs_deletion_selector_replay"
            || robustness.cscv_slices != 12
            || robustness.deflated_sharpe_formula
                != "bailey_lopez_de_prado_equation_2_on_daily_nonannualized_ratio"
            || robustness.kurtosis_estimator
                != "bias_corrected_sample_excess_plus_three_raw_kurtosis"
            || robustness.max_pbo_ppm != 50_000
            || robustness.min_dsr_ppm != 950_000
            || robustness.numerical_failure != "FORMATION_ROBUSTNESS_REJECTED"
            || robustness.observations != 360
            || robustness.pbo_definition != "cscv_selected_full_oos_rank_at_or_below_median"
            || robustness.performance_metric
                != "daily_nonannualized_mean_over_sample_std_zero_risk_free"
            || robustness.return_source
                != "vibe-backtest-result/v1.statistics.returns_series_first_360_synchronous_daily"
            || robustness.selectable_trial_count != 4
            || robustness.sharpe_trial_count
                != "four_attempted_selectable_full_tuples_without_correlation_discount"
            || robustness.skewness_estimator
                != "bias_corrected_adjusted_fisher_pearson_sample_skewness"
        {
            return Err(ExperimentError::Binding("formation robustness policy"));
        }

        let qualification = &self.payload.qualification_policy;
        if qualification.absolute_drawdown_ppm_quantization
            != "ceil_absolute_fraction_times_1000000"
            || qualification.completed_round_trip_source
                != "vibe_backtest_result_run_total_positions"
            || qualification.daily_return_count != 366
            || qualification.daily_return_first_timestamp_ns != "1704067200000000000"
            || qualification.daily_return_last_timestamp_ns != "1735603200000000000"
            || qualification.daily_return_timestamp_step_ns != "86400000000000"
            || qualification.drawdown_formula
                != "negative_max_peak_to_trough_on_compounded_one_plus_daily_returns_from_initial_one"
            || qualification.drawdown_owner != "vibe_analysis_max_drawdown"
            || qualification.kurtosis_estimator
                != "bias_corrected_sample_excess_plus_three_raw_kurtosis"
            || qualification.logical_run_identity
                != "blake3_of_intent_formation_receipt_selected_artifact_parameters_policy_and_source_projection"
            || qualification.max_absolute_drawdown_ppm != 250_000
            || qualification.metric_domain_rejection
                != "nonfinite_or_simple_return_lte_minus_one_or_zero_sample_std_or_nonpositive_psr_denominator"
            || qualification.metric_software_unavailable
                != "missing_wrong_typed_duplicate_or_wrong_timestamp_returns_or_nonfinite_arithmetic_output"
            || qualification.min_completed_round_trips != 1
            || qualification.min_net_pnl != "greater_than_native_commissions"
            || qualification.min_probabilistic_sharpe_ppm != 950_000
            || qualification.missing_or_noncanonical_terminal_receipt
                != "QUALIFICATION_STATE_UNAVAILABLE"
            || qualification.orders_and_metrics_partition
                != "order_signals_and_daily_returns_within_2024_utc_only"
            || qualification.probabilistic_sharpe_formula
                != "standard_normal_cdf_of_daily_nonannualized_ratio_times_sqrt_n_minus_one_over_sqrt_one_minus_skew_times_ratio_plus_raw_kurtosis_minus_one_over_four_times_ratio_squared"
            || qualification.probabilistic_sharpe_ppm_quantization
                != "floor_probability_times_1000000"
            || qualification.public_output
                != "qualification_receipt_only_no_raw_result_returns_orders_or_fills"
            || qualification.returns_projection
                != "select_exact_366_expected_utc_daily_2024_timestamps_ignore_only_pre_2024_warmup_returns"
            || qualification.returns_source
                != "vibe-backtest-result/v1.statistics.returns_series_exact_366_utc_daily_2024_portfolio_equity_returns"
            || qualification.risk_free_rate != "zero"
            || qualification.risk_return_ratio
                != "daily_nonannualized_mean_over_sample_std_zero_risk_free"
            || qualification.run_count != 1
            || qualification.skewness_estimator
                != "bias_corrected_adjusted_fisher_pearson_sample_skewness"
            || qualification.software_failure
                != "QUALIFICATION_STATE_UNAVAILABLE_NO_TERMINAL_RECEIPT"
            || qualification.source_projection
                != "manifest_archives_2023_12_through_2024_12_events_2023_12_18_00_through_2024_12_31_23_utc_only"
            || qualification.standard_normal_cdf != "statrs_normal_standard_cdf"
            || qualification.terminal_signal
                != "penultimate_qualification_bar_execute_at_final_bar_open"
            || qualification.terminal_state
                != "terminal_flat_required_otherwise_qualification_rejected"
            || qualification.warmup_orders != "forbidden"
            || qualification.warmup_role != "indicator_initialization_only"
            || !qualification.year_2024_orders_and_metrics_only
        {
            return Err(ExperimentError::Binding("qualification policy"));
        }

        let expected_variants = [
            ("full", true, None, true, true, true),
            ("without-reversal", true, None, true, false, true),
            ("without-regime-gate", true, None, false, true, true),
            (
                "without-volatility-sizing",
                true,
                Some(2_500),
                true,
                true,
                false,
            ),
            ("without-dynamic-exit", false, None, true, true, true),
        ];

        if self.payload.family.variants.len() != expected_variants.len()
            || self
                .payload
                .family
                .variants
                .iter()
                .zip(expected_variants)
                .any(|(actual, expected)| {
                    (
                        actual.id.as_str(),
                        actual.dynamic_exit,
                        actual.fixed_notional_bps,
                        actual.regime_gate,
                        actual.reversal,
                        actual.volatility_sizing,
                    ) != expected
                        || actual.code().is_err()
                })
        {
            return Err(ExperimentError::Binding("trial variants"));
        }

        let predecessor_digest = format!(
            "blake3:{}",
            blake3::hash(REFINED_PREDECESSOR_INTENT_BYTES).to_hex()
        );

        if self.payload.predecessor.disposition
            != "RESEARCH_DESIGN_REFINED_BEFORE_QUALIFICATION_WITHOUT_RESULT_ACCESS"
            || self.payload.predecessor.intent_digest != predecessor_digest
            || self.payload.predecessor.reason
                != "qualification_formula_returns_projection_quantization_and_failure_semantics_frozen_before_any_result_access"
        {
            return Err(ExperimentError::Binding("refined predecessor"));
        }

        let expected_ids = ["tuple-001", "tuple-002", "tuple-003", "tuple-004"];
        let mut ids = BTreeSet::new();

        for (index, tuple) in self.payload.family.tuples.iter().enumerate() {
            if tuple.id != expected_ids[index]
                || !ids.insert(tuple.id.as_str())
                || tuple.fast_ema == 0
                || tuple.slow_ema <= tuple.fast_ema
                || tuple.breakout_lookback < tuple.exit_lookback
                || tuple.rsi_period == 0
                || tuple.atr_period == 0
                || tuple.band_period == 0
                || tuple.volatility_fast == 0
                || tuple.volatility_slow <= tuple.volatility_fast
                || !(1_000..=3_000).contains(&tuple.max_volatility_ratio_milli)
                || !(1..50_000).contains(&tuple.rsi_entry_max_milli)
                || !(1_000..=5_000).contains(&tuple.trailing_atr_milli)
                || !(1_000..=4_000).contains(&tuple.band_sigma_milli)
                || tuple.target_risk_bps == 0
                || tuple.target_risk_bps > 100
            {
                return Err(ExperimentError::Binding("trial tuple"));
            }
        }

        if self.payload.components.trend_continuation != "close_above_prior_tuple_breakout_high"
            || self.payload.components.conditional_reversal
                != "bullish_regime_and_close_below_lower_band_and_rsi_lte_tuple_threshold"
            || self.payload.components.regime_gate
                != "fast_ema_above_slow_ema_and_atr_ratio_lte_tuple_ceiling"
            || self.payload.components.dynamic_exit
                != "closed_bar_atr_trailing_floor_or_channel_or_regime_break"
        {
            return Err(ExperimentError::Binding("component shape"));
        }

        let expected_evidence = [
            (
                "freqtrade-lookahead-analysis",
                "https://www.freqtrade.io/en/stable/lookahead-analysis/",
                "closed-bar-lookahead-falsifier-practice",
            ),
            (
                "optuna-study-trial",
                "https://optuna.readthedocs.io/en/stable/reference/generated/optuna.study.Study.html",
                "bounded-study-retains-every-trial-practice",
            ),
            (
                "time-series-momentum",
                "https://doi.org/10.1016/j.jfineco.2011.11.003",
                "trend-mechanism-primary-research",
            ),
            (
                "momentum-volatility-scaling",
                "https://doi.org/10.1016/j.finmar.2016.05.003",
                "volatility-scaling-confound-primary-research",
            ),
            (
                "volatility-managed-portfolios",
                "https://doi.org/10.3386/w22208",
                "volatility-risk-control-primary-research",
            ),
            (
                "probability-backtest-overfitting",
                "https://doi.org/10.21314/JCF.2016.322",
                "auxiliary-full-candidate-cscv-primary-research",
            ),
            (
                "deflated-sharpe-ratio",
                "https://doi.org/10.2139/ssrn.2460551",
                "selectable-trial-multiplicity-primary-research",
            ),
        ];

        if self.payload.evidence.len() != expected_evidence.len()
            || self
                .payload
                .evidence
                .iter()
                .zip(expected_evidence)
                .any(|(actual, expected)| {
                    (
                        actual.id.as_str(),
                        actual.locator.as_str(),
                        actual.role.as_str(),
                    ) != expected
                })
        {
            return Err(ExperimentError::Binding("research and prior-art evidence"));
        }

        if self.payload.non_claims
            != [
                "alpha",
                "bar_internal_path",
                "live_eligibility",
                "order_book_execution",
            ]
        {
            return Err(ExperimentError::Binding("non-claims"));
        }
        Ok(())
    }
}

fn parse_intent(bytes: &[u8]) -> Result<PriceOnlyResearchIntent, ExperimentError> {
    serde_json::from_slice(bytes).map_err(|e| ExperimentError::Malformed(e.to_string()))
}

fn parse_ns(value: &str) -> Result<u64, ExperimentError> {
    value
        .parse::<u64>()
        .map_err(|_| ExperimentError::Binding("nanosecond timestamp"))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::Value;

    use super::*;

    #[rstest]
    fn frozen_complex_intent_is_deterministic_and_bounded() {
        let first = PriceOnlyResearchIntent::frozen().unwrap();
        let second = PriceOnlyResearchIntent::frozen().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.payload.family.tuples.len(), 4);
        assert_eq!(first.payload.family.variants.len(), 5);
        assert!(first.payload.trial_policy.all_attempts_retained);
        assert_eq!(first.payload.trial_policy.qualification_runs, 1);
        assert_eq!(
            first.payload.robustness_policy.candidate_scope,
            "four_selectable_full_tuples_only"
        );
        assert_eq!(first.payload.robustness_policy.observations, 360);
        assert_eq!(first.payload.robustness_policy.cscv_slices, 12);
        assert_eq!(first.payload.robustness_policy.max_pbo_ppm, 50_000);
        assert_eq!(first.payload.robustness_policy.min_dsr_ppm, 950_000);
        assert_eq!(
            first
                .payload
                .qualification_policy
                .missing_or_noncanonical_terminal_receipt,
            "QUALIFICATION_STATE_UNAVAILABLE"
        );
        assert_eq!(
            first.payload.predecessor.intent_digest,
            format!(
                "blake3:{}",
                blake3::hash(REFINED_PREDECESSOR_INTENT_BYTES).to_hex()
            )
        );
    }

    #[rstest]
    fn v4_refines_only_predeclared_qualification_semantics() {
        let mut predecessor: Value =
            serde_json::from_slice(REFINED_PREDECESSOR_INTENT_BYTES).unwrap();
        let mut current: Value = serde_json::from_slice(COMPLEX_INTENT_BYTES).unwrap();

        let predecessor_qualification = predecessor["payload"]["qualification_policy"]
            .as_object_mut()
            .unwrap();
        let current_qualification = current["payload"]["qualification_policy"]
            .as_object_mut()
            .unwrap();

        for added in [
            "absolute_drawdown_ppm_quantization",
            "completed_round_trip_source",
            "daily_return_count",
            "daily_return_first_timestamp_ns",
            "daily_return_last_timestamp_ns",
            "daily_return_timestamp_step_ns",
            "drawdown_formula",
            "drawdown_owner",
            "kurtosis_estimator",
            "metric_domain_rejection",
            "metric_software_unavailable",
            "orders_and_metrics_partition",
            "probabilistic_sharpe_formula",
            "probabilistic_sharpe_ppm_quantization",
            "returns_projection",
            "returns_source",
            "risk_return_ratio",
            "skewness_estimator",
            "software_failure",
            "source_projection",
            "standard_normal_cdf",
            "terminal_signal",
            "terminal_state",
        ] {
            assert!(current_qualification.remove(added).is_some(), "{added}");
        }
        assert_eq!(current_qualification, predecessor_qualification);

        current["identity"] = predecessor["identity"].clone();
        current["revision"] = predecessor["revision"].clone();
        current["payload"]["experiment_id"] = predecessor["payload"]["experiment_id"].clone();
        current["payload"]["predecessor"] = predecessor["payload"]["predecessor"].clone();
        assert_eq!(current, predecessor);
    }

    #[rstest]
    fn public_mutation_cannot_rebind_the_frozen_intent() {
        let mut intent = PriceOnlyResearchIntent::frozen().unwrap();
        intent.payload.family.tuples[0].fast_ema += 1;
        assert_eq!(
            intent.validate_frozen_binding(),
            Err(ExperimentError::Binding("canonical frozen bytes"))
        );
    }

    #[rstest]
    fn tuple_parameters_project_exact_decimal_values() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let tuple = intent.tuple("tuple-001").unwrap();
        assert_eq!(tuple.rsi_entry_max_milli, 30_000);
        assert_eq!(tuple.max_volatility_ratio_milli, 1_600);
        assert_eq!(tuple.trailing_atr_milli, 2_500);
        assert_eq!(tuple.band_sigma_milli, 1_800);
        assert!(matches!(
            intent.tuple("missing"),
            Err(ExperimentError::UnknownTuple(id)) if id == "missing"
        ));
    }
}
