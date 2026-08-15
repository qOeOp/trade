use serde::{Deserialize, Serialize};
use thiserror::Error;

const FROZEN_INTENT_FILE_BYTES: &[u8] = include_bytes!("../assets/pilot_intent_v2.jcs");
pub const FROZEN_INTENT_ID: &str = "researchintent-strategy-factory-pilot-v2";
pub const REQUIRED_EXECUTION: &str = "market_at_next_executable_external_bar_open";
pub const MISSING_OPEN_NS: u64 = 1_679_662_800_000_000_000;
pub const ZERO_VOLUME_OPEN_NS: u64 = 1_679_659_200_000_000_000;
pub const ZERO_VOLUME_CLOSE_NS: u64 = 1_679_661_581_646_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PilotResearchIntent {
    pub identity: String,
    pub kind: String,
    pub revision: String,
    pub schema_version: u32,
    pub payload: IntentPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentPayload {
    pub costs: IntentCosts,
    pub data: IntentData,
    pub disposition: IntentDisposition,
    pub family: IntentFamily,
    pub mechanism: IntentMechanism,
    pub non_claims: Vec<String>,
    pub pilot_id: String,
    pub predecessor: IntentPredecessor,
    pub software_acceptance: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentCosts {
    pub execution: String,
    pub fee_authority: String,
    pub initial_balance: String,
    pub quantity: String,
    pub slippage: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentData {
    pub bar_type: String,
    pub event_semantics: EventSemantics,
    pub snapshot_semantics: String,
    pub source: String,
    pub universe: Vec<String>,
    pub validation_open_time: OpenTimeRange,
    pub warmup_open_time: OpenTimeRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventSemantics {
    pub clock: String,
    pub expected_actual_events: u64,
    pub missing_open_time_ns: Vec<String>,
    pub synthetic_bars: String,
    pub wall_clock_slots: u64,
    pub zero_volume_truncated_event: ZeroVolumeSemantics,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZeroVolumeSemantics {
    pub close_time_ns: String,
    pub execution_allowed: bool,
    pub open_time_ns: String,
    pub source_gap: bool,
    pub strategy_observation: String,
    pub tradable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenTimeRange {
    pub end_ns: String,
    pub start_ns: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentDisposition {
    pub economic_falsifier: String,
    pub rejected: String,
    pub survived: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentFamily {
    pub artifact_attempts: u32,
    pub parameter_tuples: u32,
    pub successors: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentMechanism {
    pub direction: String,
    pub entry: String,
    pub entry_execution: String,
    pub exit: String,
    pub exit_execution: String,
    pub parameters: IntentParameters,
    pub terminal_liquidation: String,
    pub zero_volume_source_event: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IntentParameters {
    pub entry_lookback: u32,
    pub exit_lookback: u32,
    pub fast_ema: u32,
    pub slow_ema: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentPredecessor {
    pub disposition_sha256: String,
    pub economic_disposition: String,
    pub software_acceptance: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum IntentError {
    #[error("frozen ResearchIntent is malformed: {0}")]
    Malformed(String),
    #[error("frozen ResearchIntent binding mismatch: {0}")]
    Binding(&'static str),
}

impl PilotResearchIntent {
    pub fn frozen() -> Result<Self, IntentError> {
        Self::parse_and_validate(frozen_intent_bytes())
    }

    fn parse_and_validate(bytes: &[u8]) -> Result<Self, IntentError> {
        let intent: Self =
            serde_json::from_slice(bytes).map_err(|e| IntentError::Malformed(e.to_string()))?;
        intent.validate_frozen_binding()?;
        Ok(intent)
    }

    pub fn canonical_bytes(&self) -> &'static [u8] {
        frozen_intent_bytes()
    }

    pub(crate) fn validate_frozen_binding(&self) -> Result<(), IntentError> {
        let event = &self.payload.data.event_semantics;
        let zero = &event.zero_volume_truncated_event;

        if self.identity != FROZEN_INTENT_ID
            || self.kind != "ResearchIntent"
            || self.revision != "2"
            || self.schema_version != 1
        {
            return Err(IntentError::Binding("identity/revision/schema"));
        }

        if self.payload.costs.execution != REQUIRED_EXECUTION
            || self.payload.costs.fee_authority != "native_instrument_fee_model"
            || self.payload.costs.initial_balance != "1000000 USDT"
            || self.payload.costs.quantity != "0.000010 BTC"
            || self.payload.costs.slippage != "not_modeled"
        {
            return Err(IntentError::Binding("costs"));
        }

        if self.payload.mechanism.entry_execution != "next_executable_external_bar_open"
            || self.payload.mechanism.exit_execution != "next_executable_external_bar_open"
        {
            return Err(IntentError::Binding(
                "next executable external Bar execution",
            ));
        }

        if self.payload.data.snapshot_semantics != "retrospective_current"
            || self.payload.data.source != "Binance Spot public historical market data"
            || self.payload.data.warmup_open_time.start_ns != "1672531200000000000"
            || self.payload.data.warmup_open_time.end_ns != "1704063600000000000"
            || self.payload.data.validation_open_time.start_ns != "1704067200000000000"
            || self.payload.data.validation_open_time.end_ns != "1735686000000000000"
        {
            return Err(IntentError::Binding("data source/windows"));
        }

        if self.payload.disposition.economic_falsifier
            != "validation_net_pnl_after_native_commissions_lte_zero"
            || self.payload.disposition.rejected != "REJECTED"
            || self.payload.disposition.survived != "SURVIVED_NOT_ADMITTED"
        {
            return Err(IntentError::Binding("disposition"));
        }

        if self.payload.mechanism.direction != "long_only"
            || self.payload.mechanism.entry
                != "fast_ema_above_slow_ema_and_close_above_prior_72_bar_high"
            || self.payload.mechanism.exit
                != "close_below_prior_24_bar_low_or_fast_ema_not_above_slow_ema"
            || self.payload.mechanism.terminal_liquidation
                != "signal_on_penultimate_validation_bar_execute_at_final_bar_open"
        {
            return Err(IntentError::Binding("mechanism"));
        }
        let parameters = &self.payload.mechanism.parameters;
        if parameters.entry_lookback != 72
            || parameters.exit_lookback != 24
            || parameters.fast_ema != 24
            || parameters.slow_ema != 120
        {
            return Err(IntentError::Binding("mechanism parameters"));
        }

        if self.payload.pilot_id != "btc-usdt-1h-dual-timescale-breakout-v1" {
            return Err(IntentError::Binding("pilot id"));
        }

        if self.payload.predecessor.disposition_sha256
            != "sha256:a00e4123d16072914a7abe8f702fc62a33b81827bc0ee88dd521535a373a8612"
            || self.payload.predecessor.economic_disposition != "NOT_EVALUATED"
            || self.payload.predecessor.software_acceptance != "REJECTED"
        {
            return Err(IntentError::Binding("predecessor"));
        }

        if !matches_exact(
            &self.payload.non_claims,
            &[
                "alpha",
                "bar_internal_path",
                "live_eligibility",
                "order_book_execution",
                "profitability",
                "qualification",
            ],
        ) {
            return Err(IntentError::Binding("non-claims"));
        }

        if !matches_exact(
            &self.payload.software_acceptance,
            &[
                "actual_source_event_count_equals_17543",
                "exact_source_gap_and_truncation_contract",
                "no_synthetic_bar",
                "canonical_result_completed",
                "deterministic_trial_receipt",
                "nonzero_native_commission",
                "one_or_more_completed_round_trips",
                "terminal_flat",
            ],
        ) {
            return Err(IntentError::Binding("software acceptance"));
        }

        if self.payload.family.artifact_attempts != 1
            || self.payload.family.parameter_tuples != 1
            || self.payload.family.successors != 0
        {
            return Err(IntentError::Binding("bounded family"));
        }

        if self.payload.data.bar_type != "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL"
            || self.payload.data.universe != ["BTCUSDT.BINANCE"]
            || event.clock != "source_native_event_time"
            || event.expected_actual_events != 17_543
            || event.wall_clock_slots != 17_544
            || event.synthetic_bars != "forbidden"
            || event.missing_open_time_ns != [MISSING_OPEN_NS.to_string()]
        {
            return Err(IntentError::Binding("source event contract"));
        }

        if zero.open_time_ns != ZERO_VOLUME_OPEN_NS.to_string()
            || zero.close_time_ns != ZERO_VOLUME_CLOSE_NS.to_string()
            || !zero.source_gap
            || zero.tradable
            || zero.execution_allowed
            || zero.strategy_observation != "clock_only_no_signal"
            || self.payload.mechanism.zero_volume_source_event
                != "clock_only_no_indicator_no_signal_no_execution"
        {
            return Err(IntentError::Binding("zero-volume source event"));
        }
        Ok(())
    }
}

fn matches_exact(actual: &[String], expected: &[&str]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual == expected)
}

fn frozen_intent_bytes() -> &'static [u8] {
    FROZEN_INTENT_FILE_BYTES
        .strip_suffix(b"\n")
        .unwrap_or(FROZEN_INTENT_FILE_BYTES)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn tampered(from: &str, to: &str) -> IntentError {
        let frozen = std::str::from_utf8(frozen_intent_bytes()).expect("frozen JCS is UTF-8");
        assert!(frozen.contains(from), "tamper source must exist: {from}");
        PilotResearchIntent::parse_and_validate(frozen.replacen(from, to, 1).as_bytes())
            .expect_err("tampered intent must fail closed")
    }

    #[rstest]
    fn formerly_unbound_sections_are_semantically_bound() {
        let cases = [
            (
                "\"fee_authority\":\"native_instrument_fee_model\"",
                "\"fee_authority\":\"prose_fee_model\"",
                "costs",
            ),
            (
                "\"snapshot_semantics\":\"retrospective_current\"",
                "\"snapshot_semantics\":\"point_in_time\"",
                "data source/windows",
            ),
            (
                "\"economic_falsifier\":\"validation_net_pnl_after_native_commissions_lte_zero\"",
                "\"economic_falsifier\":\"gross_pnl_lte_zero\"",
                "disposition",
            ),
            (
                "\"direction\":\"long_only\"",
                "\"direction\":\"long_short\"",
                "mechanism",
            ),
            (
                "\"entry_lookback\":72",
                "\"entry_lookback\":71",
                "mechanism parameters",
            ),
            (
                "\"pilot_id\":\"btc-usdt-1h-dual-timescale-breakout-v1\"",
                "\"pilot_id\":\"successor\"",
                "pilot id",
            ),
            (
                "\"economic_disposition\":\"NOT_EVALUATED\"",
                "\"economic_disposition\":\"SURVIVED\"",
                "predecessor",
            ),
            (
                "\"non_claims\":[\"alpha\"",
                "\"non_claims\":[\"profitability\"",
                "non-claims",
            ),
            (
                "\"software_acceptance\":[\"actual_source_event_count_equals_17543\"",
                "\"software_acceptance\":[\"terminal_flat\"",
                "software acceptance",
            ),
        ];

        for (from, to, category) in cases {
            assert_eq!(tampered(from, to), IntentError::Binding(category));
        }
    }

    #[rstest]
    fn unknown_fields_fail_at_every_object_boundary_sampled() {
        let cases = [
            ("{\"identity\"", "{\"extra\":true,\"identity\""),
            (
                "\"payload\":{\"costs\"",
                "\"payload\":{\"extra\":true,\"costs\"",
            ),
            (
                "\"costs\":{\"execution\"",
                "\"costs\":{\"extra\":true,\"execution\"",
            ),
            (
                "\"parameters\":{\"entry_lookback\"",
                "\"parameters\":{\"extra\":true,\"entry_lookback\"",
            ),
        ];

        for (from, to) in cases {
            let IntentError::Malformed(error) = tampered(from, to) else {
                panic!("unknown field must fail during deserialization");
            };
            assert!(error.contains("unknown field"), "{error}");
        }
    }

    #[rstest]
    fn missing_and_wrong_typed_fields_fail_deserialization() {
        let IntentError::Malformed(missing) = tampered(
            "\"pilot_id\":\"btc-usdt-1h-dual-timescale-breakout-v1\",",
            "",
        ) else {
            panic!("missing field must be malformed");
        };
        assert!(missing.contains("missing field"), "{missing}");

        let IntentError::Malformed(wrong_type) =
            tampered("\"artifact_attempts\":1", "\"artifact_attempts\":\"1\"")
        else {
            panic!("wrong type must be malformed");
        };
        assert!(wrong_type.contains("invalid type"), "{wrong_type}");
    }
}
