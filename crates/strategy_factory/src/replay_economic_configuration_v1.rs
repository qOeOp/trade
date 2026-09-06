//! Canonical economic configuration for the isolated EVENT Replay profile.
//!
//! This is content, not execution authority. It deliberately has no `Default`, contains no
//! floating-point field, and names every native `SimulatedVenueConfig` choice explicitly. The
//! distinct sealed Instrument Owner provenance required for fees and margins is checked by the
//! execution-profile preflight, not reconstructed from these caller-visible bytes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Replay economic configuration schema version.
pub const REPLAY_ECONOMIC_CONFIGURATION_SCHEMA_VERSION_V1: u16 = 1;
const ECONOMIC_CONFIGURATION_DIGEST_DOMAIN_V1: &[u8] =
    b"strategy-factory.replay-economic-configuration.v1\0";
const MAX_CANONICAL_BYTES_V1: usize = 32 * 1024;
const MAX_IDENTITY_BYTES_V1: usize = 256;

/// Exact base-10 value. Redundant trailing fractional zeroes are non-canonical.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayFixedDecimalV1 {
    pub mantissa: i128,
    pub scale: u8,
}

impl ReplayFixedDecimalV1 {
    fn validate(self, positive: bool) -> Result<(), ReplayEconomicConfigurationErrorV1> {
        if self.scale > 38
            || (self.scale != 0 && self.mantissa % 10 == 0)
            || (positive && self.mantissa <= 0)
        {
            return Err(ReplayEconomicConfigurationErrorV1::InvalidDecimal);
        }
        Ok(())
    }
}

/// Exact replay input kind admitted by this isolated profile.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayInputKindV1 {
    EventOnly,
}

/// Exact venue census supported by V1.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayVenueCensusV1 {
    SingleVenue,
}

/// Closed OMS choice supported by the isolated profile.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayOmsTypeV1 {
    Netting,
}

/// Closed account choice supported by the isolated profile.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayAccountTypeV1 {
    Margin,
}

/// Closed order-book choice supported by the isolated profile.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayBookTypeV1 {
    L1Mbp,
}

/// Closed fill-model choice supported by V1.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayFillModelV1 {
    DeterministicFullFill,
}

/// Closed fee-model choice. Values must come from the bound Instrument Owner fact.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayFeeModelV1 {
    SealedInstrumentTerms,
}

/// Closed margin-model choice. Values must come from the bound Instrument Owner fact.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayMarginModelV1 {
    SealedInstrumentTerms,
}

/// Model surfaces intentionally disabled by this first profile.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DisabledEconomicModelV1 {
    Disabled,
}

/// Simulation-module census supported by V1.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplaySimulationModulesV1 {
    None,
}

/// Settlement-price surface supported by the non-expiring EVENT vertical.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplaySettlementPricesV1 {
    None,
}

/// Liquidation policy supported by V1.
///
/// The native `liquidation_trigger_ratio: f64` is intentionally absent. The materialization
/// preflight must prove the native engine does not read that field while liquidation is disabled
/// before an engine adapter can exist.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayLiquidationPolicyV1 {
    Disabled,
}

/// Caller-visible binding to the distinct sealed Instrument Owner terms provenance.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentEconomicTermsBindingV1 {
    pub instrument_identity: String,
    pub quote_currency: String,
    pub instrument_fact_digest: [u8; 32],
    pub instrument_receipt_digest: [u8; 32],
    pub maker_fee: ReplayFixedDecimalV1,
    pub taker_fee: ReplayFixedDecimalV1,
    pub initial_margin: ReplayFixedDecimalV1,
    pub maintenance_margin: ReplayFixedDecimalV1,
}

/// Every economic and `SimulatedVenueConfig` choice for the V1 profile.
///
/// No field has an implicit default. Model enums are closed to the one implemented contract
/// variant. Behavioral booleans remain explicit even where the selected EVENT-only mode makes a
/// native field inactive.
#[expect(
    clippy::struct_excessive_bools,
    reason = "fields mirror the complete native simulated-venue behavior surface"
)]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEconomicConfigurationInputV1 {
    pub schema_version: u16,
    pub input_kind: ReplayInputKindV1,
    pub venue_census: ReplayVenueCensusV1,
    pub venue_identity: String,
    pub oms_type: ReplayOmsTypeV1,
    pub account_type: ReplayAccountTypeV1,
    pub book_type: ReplayBookTypeV1,
    pub starting_balance: ReplayFixedDecimalV1,
    pub starting_balance_currency: String,
    pub common_quote_currency: String,
    pub default_leverage: ReplayFixedDecimalV1,
    pub instrument_leverage: ReplayFixedDecimalV1,
    pub instrument_terms: InstrumentEconomicTermsBindingV1,
    pub margin_model: ReplayMarginModelV1,
    pub modules: ReplaySimulationModulesV1,
    pub fill_model: ReplayFillModelV1,
    pub fee_model: ReplayFeeModelV1,
    pub latency_model: DisabledEconomicModelV1,
    pub slippage_model: DisabledEconomicModelV1,
    pub capacity_model: DisabledEconomicModelV1,
    pub routing: bool,
    pub reject_stop_orders: bool,
    pub support_gtd_orders: bool,
    pub support_contingent_orders: bool,
    pub use_position_ids: bool,
    pub use_random_ids: bool,
    pub use_reduce_only: bool,
    pub use_message_queue: bool,
    pub use_market_order_acks: bool,
    pub bar_execution: bool,
    pub trade_on_close: bool,
    pub bar_adaptive_high_low_ordering: bool,
    pub trade_execution: bool,
    pub liquidity_consumption: bool,
    pub allow_cash_borrowing: bool,
    pub frozen_account: bool,
    pub queue_position: bool,
    pub oto_full_trigger: bool,
    pub price_protection_points: u32,
    pub settlement_prices: ReplaySettlementPricesV1,
    pub liquidation_policy: ReplayLiquidationPolicyV1,
    pub liquidation_cancel_open_orders: bool,
}

/// Strict, content-addressed economic configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayEconomicConfigurationV1 {
    input: ReplayEconomicConfigurationInputV1,
    canonical_bytes: Vec<u8>,
    digest: [u8; 32],
}

impl ReplayEconomicConfigurationV1 {
    /// Validates and seals one explicit economic configuration.
    pub fn seal(
        input: ReplayEconomicConfigurationInputV1,
    ) -> Result<Self, ReplayEconomicConfigurationErrorV1> {
        validate(&input)?;
        let canonical_bytes = serde_json::to_vec(&input)
            .map_err(|_| ReplayEconomicConfigurationErrorV1::CodecMismatch)?;
        if canonical_bytes.len() > MAX_CANONICAL_BYTES_V1 {
            return Err(ReplayEconomicConfigurationErrorV1::LengthOverflow);
        }
        Ok(Self {
            digest: digest(&canonical_bytes),
            input,
            canonical_bytes,
        })
    }

    /// Parses only the unique compact JSON encoding emitted by [`Self::seal`].
    pub fn parse_canonical(bytes: &[u8]) -> Result<Self, ReplayEconomicConfigurationErrorV1> {
        if bytes.len() > MAX_CANONICAL_BYTES_V1 {
            return Err(ReplayEconomicConfigurationErrorV1::LengthOverflow);
        }
        let input: ReplayEconomicConfigurationInputV1 = serde_json::from_slice(bytes)
            .map_err(|_| ReplayEconomicConfigurationErrorV1::CodecMismatch)?;
        let sealed = Self::seal(input)?;
        if sealed.canonical_bytes != bytes {
            return Err(ReplayEconomicConfigurationErrorV1::NonCanonical);
        }
        Ok(sealed)
    }

    #[must_use]
    pub fn input(&self) -> &ReplayEconomicConfigurationInputV1 {
        &self.input
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn digest(&self) -> [u8; 32] {
        self.digest
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ReplayEconomicConfigurationErrorV1 {
    #[error("Replay economic configuration schema is unsupported")]
    UnsupportedSchema,
    #[error("Replay economic configuration identity is invalid")]
    InvalidIdentity,
    #[error("Replay economic configuration decimal is invalid")]
    InvalidDecimal,
    #[error("Replay economic configuration currency binding mismatches")]
    CurrencyMismatch,
    #[error("Replay economic configuration Instrument Owner provenance is incomplete")]
    InvalidInstrumentProvenance,
    #[error("EVENT Replay economic configuration enables host-random identifiers")]
    RandomIdentifiersUnavailable,
    #[error("EVENT-only Replay economic configuration enables a BAR-only behavior")]
    EventModeMismatch,
    #[error("Replay economic configuration canonical bytes are too large")]
    LengthOverflow,
    #[error("Replay economic configuration codec mismatch")]
    CodecMismatch,
    #[error("Replay economic configuration bytes are not canonical")]
    NonCanonical,
}

fn validate(
    input: &ReplayEconomicConfigurationInputV1,
) -> Result<(), ReplayEconomicConfigurationErrorV1> {
    if input.schema_version != REPLAY_ECONOMIC_CONFIGURATION_SCHEMA_VERSION_V1 {
        return Err(ReplayEconomicConfigurationErrorV1::UnsupportedSchema);
    }

    for identity in [
        input.venue_identity.as_str(),
        input.starting_balance_currency.as_str(),
        input.common_quote_currency.as_str(),
        input.instrument_terms.instrument_identity.as_str(),
        input.instrument_terms.quote_currency.as_str(),
    ] {
        validate_identity(identity)?;
    }

    if input.starting_balance_currency != input.common_quote_currency
        || input.common_quote_currency != input.instrument_terms.quote_currency
    {
        return Err(ReplayEconomicConfigurationErrorV1::CurrencyMismatch);
    }

    if input.instrument_terms.instrument_fact_digest == [0; 32]
        || input.instrument_terms.instrument_receipt_digest == [0; 32]
    {
        return Err(ReplayEconomicConfigurationErrorV1::InvalidInstrumentProvenance);
    }
    input.starting_balance.validate(true)?;
    input.default_leverage.validate(true)?;
    input.instrument_leverage.validate(true)?;
    input.instrument_terms.maker_fee.validate(false)?;
    input.instrument_terms.taker_fee.validate(false)?;
    input.instrument_terms.initial_margin.validate(true)?;
    input.instrument_terms.maintenance_margin.validate(true)?;
    if input.use_random_ids {
        return Err(ReplayEconomicConfigurationErrorV1::RandomIdentifiersUnavailable);
    }

    if input.bar_execution
        || input.trade_on_close
        || input.bar_adaptive_high_low_ordering
        || input.trade_execution
    {
        return Err(ReplayEconomicConfigurationErrorV1::EventModeMismatch);
    }
    Ok(())
}

fn validate_identity(value: &str) -> Result<(), ReplayEconomicConfigurationErrorV1> {
    if value.is_empty()
        || value.len() > MAX_IDENTITY_BYTES_V1
        || !value.is_ascii()
        || value.trim() != value
    {
        return Err(ReplayEconomicConfigurationErrorV1::InvalidIdentity);
    }
    Ok(())
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ECONOMIC_CONFIGURATION_DIGEST_DOMAIN_V1);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
pub(crate) fn economic_fixture() -> ReplayEconomicConfigurationInputV1 {
    ReplayEconomicConfigurationInputV1 {
        schema_version: 1,
        input_kind: ReplayInputKindV1::EventOnly,
        venue_census: ReplayVenueCensusV1::SingleVenue,
        venue_identity: "SIM".into(),
        oms_type: ReplayOmsTypeV1::Netting,
        account_type: ReplayAccountTypeV1::Margin,
        book_type: ReplayBookTypeV1::L1Mbp,
        starting_balance: ReplayFixedDecimalV1 {
            mantissa: 100_000,
            scale: 0,
        },
        starting_balance_currency: "USDT".into(),
        common_quote_currency: "USDT".into(),
        default_leverage: ReplayFixedDecimalV1 {
            mantissa: 10,
            scale: 0,
        },
        instrument_leverage: ReplayFixedDecimalV1 {
            mantissa: 10,
            scale: 0,
        },
        instrument_terms: InstrumentEconomicTermsBindingV1 {
            instrument_identity: "ETHUSDT-PERP".into(),
            quote_currency: "USDT".into(),
            instrument_fact_digest: [1; 32],
            instrument_receipt_digest: [2; 32],
            maker_fee: ReplayFixedDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            taker_fee: ReplayFixedDecimalV1 {
                mantissa: 4,
                scale: 4,
            },
            initial_margin: ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: ReplayFixedDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
        },
        margin_model: ReplayMarginModelV1::SealedInstrumentTerms,
        modules: ReplaySimulationModulesV1::None,
        fill_model: ReplayFillModelV1::DeterministicFullFill,
        fee_model: ReplayFeeModelV1::SealedInstrumentTerms,
        latency_model: DisabledEconomicModelV1::Disabled,
        slippage_model: DisabledEconomicModelV1::Disabled,
        capacity_model: DisabledEconomicModelV1::Disabled,
        routing: false,
        reject_stop_orders: true,
        support_gtd_orders: true,
        support_contingent_orders: true,
        use_position_ids: true,
        use_random_ids: false,
        use_reduce_only: true,
        use_message_queue: true,
        use_market_order_acks: false,
        bar_execution: false,
        trade_on_close: false,
        bar_adaptive_high_low_ordering: false,
        trade_execution: false,
        liquidity_consumption: false,
        allow_cash_borrowing: false,
        frozen_account: false,
        queue_position: false,
        oto_full_trigger: false,
        price_protection_points: 0,
        settlement_prices: ReplaySettlementPricesV1::None,
        liquidation_policy: ReplayLiquidationPolicyV1::Disabled,
        liquidation_cancel_open_orders: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn canonical_round_trip_is_byte_exact_and_digest_stable() {
        let sealed = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        let reparsed =
            ReplayEconomicConfigurationV1::parse_canonical(sealed.canonical_bytes()).unwrap();
        assert_eq!(reparsed, sealed);
        assert_eq!(reparsed.digest(), sealed.digest());
    }

    #[rstest]
    fn deterministic_identifiers_round_trip_and_random_identifiers_are_unavailable() {
        let deterministic = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        assert!(!deterministic.input().use_random_ids);
        assert_eq!(
            ReplayEconomicConfigurationV1::parse_canonical(deterministic.canonical_bytes()),
            Ok(deterministic)
        );

        let mut random = economic_fixture();
        random.use_random_ids = true;
        assert_eq!(
            ReplayEconomicConfigurationV1::seal(random),
            Err(ReplayEconomicConfigurationErrorV1::RandomIdentifiersUnavailable)
        );
    }

    #[rstest]
    fn reordered_unknown_and_float_json_are_rejected() {
        let sealed = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        let reordered = String::from_utf8(sealed.canonical_bytes().to_vec())
            .unwrap()
            .replacen(
                "{\"schema_version\":1,\"input_kind\":\"EVENT_ONLY\"",
                "{\"input_kind\":\"EVENT_ONLY\",\"schema_version\":1",
                1,
            );
        assert_eq!(
            ReplayEconomicConfigurationV1::parse_canonical(reordered.as_bytes()),
            Err(ReplayEconomicConfigurationErrorV1::NonCanonical)
        );

        let mut reordered = serde_json::to_value(sealed.input()).unwrap();
        reordered["unexpected"] = serde_json::Value::Bool(false);
        assert_eq!(
            ReplayEconomicConfigurationV1::parse_canonical(
                serde_json::to_string_pretty(&reordered).unwrap().as_bytes()
            ),
            Err(ReplayEconomicConfigurationErrorV1::CodecMismatch)
        );

        let mut missing = serde_json::to_value(sealed.input()).unwrap();
        missing.as_object_mut().unwrap().remove("fee_model");
        assert_eq!(
            ReplayEconomicConfigurationV1::parse_canonical(
                serde_json::to_vec(&missing).unwrap().as_slice()
            ),
            Err(ReplayEconomicConfigurationErrorV1::CodecMismatch)
        );

        let floating = String::from_utf8(sealed.canonical_bytes().to_vec())
            .unwrap()
            .replace("\"mantissa\":100000", "\"mantissa\":100000.0");
        assert_eq!(
            ReplayEconomicConfigurationV1::parse_canonical(floating.as_bytes()),
            Err(ReplayEconomicConfigurationErrorV1::CodecMismatch)
        );
    }

    #[rstest]
    fn event_profile_rejects_every_bar_or_trade_input_switch() {
        for mutate in [
            |value: &mut ReplayEconomicConfigurationInputV1| value.bar_execution = true,
            |value: &mut ReplayEconomicConfigurationInputV1| value.trade_on_close = true,
            |value: &mut ReplayEconomicConfigurationInputV1| {
                value.bar_adaptive_high_low_ordering = true;
            },
            |value: &mut ReplayEconomicConfigurationInputV1| value.trade_execution = true,
        ] {
            let mut input = economic_fixture();
            mutate(&mut input);
            assert_eq!(
                ReplayEconomicConfigurationV1::seal(input),
                Err(ReplayEconomicConfigurationErrorV1::EventModeMismatch)
            );
        }
    }

    #[rstest]
    fn missing_currency_or_noncanonical_decimal_has_no_fallback() {
        let mut currency = economic_fixture();
        currency.starting_balance_currency = "USD".into();
        assert_eq!(
            ReplayEconomicConfigurationV1::seal(currency),
            Err(ReplayEconomicConfigurationErrorV1::CurrencyMismatch)
        );

        let mut decimal = economic_fixture();
        decimal.instrument_terms.initial_margin = ReplayFixedDecimalV1 {
            mantissa: 10,
            scale: 2,
        };
        assert_eq!(
            ReplayEconomicConfigurationV1::seal(decimal),
            Err(ReplayEconomicConfigurationErrorV1::InvalidDecimal)
        );

        let mut provenance = economic_fixture();
        provenance.instrument_terms.instrument_receipt_digest = [0; 32];
        assert_eq!(
            ReplayEconomicConfigurationV1::seal(provenance),
            Err(ReplayEconomicConfigurationErrorV1::InvalidInstrumentProvenance)
        );
    }
}
