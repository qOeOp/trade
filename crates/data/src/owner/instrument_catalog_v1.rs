//! What Market Data holds about each admitted instrument, for an operator or an agent.
//!
//! The governing text is `docs/owners/market-data.md`, "TARGET market-data MCP server": the
//! `list_instruments` and `describe_instrument` tools read through this port. Both are discovery
//! reads of the latest Instrument Master V2 fact and every admitted economic-terms version. Neither
//! is a Replay input: a Replay binds an exact Instrument Master cut and resolves its terms from it.
//!
//! Every value is rendered as the exact decimal the fact holds. A term the venue does not state is
//! named as such - `UNBOUNDED`, `NOT_APPLICABLE` or `UNAVAILABLE` - and never as a number.

use async_trait::async_trait;
use serde::Serialize;

use super::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_economic_terms_v1::{
        InstrumentEconomicDecimalV1, InstrumentEconomicTermsReadbackV1,
    },
    instrument_master_v2::{FactValue, InstrumentDecimalV2, InstrumentMasterFactV2},
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
};

/// One admitted instrument, as `list_instruments` states it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InstrumentListingV1 {
    /// The canonical instrument, the name every other Market Data tool takes.
    pub instrument: String,
    pub venue: String,
    /// The venue's own raw symbol, as `exchangeInfo` states it (e.g. `BTCUSDT`) - never derived
    /// by string munging from `instrument`.
    pub raw_symbol: String,
    pub quote_currency: String,
    pub contract_status: String,
}

/// One admitted instrument's latest public terms and every economic-terms version.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InstrumentDescriptionV1 {
    pub instrument: String,
    pub venue: String,
    /// The venue's own raw symbol, as `exchangeInfo` states it (e.g. `BTCUSDT`) - never derived
    /// by string munging from `instrument`.
    pub raw_symbol: String,
    /// The Instrument Master V2 fact these terms are read from, as lowercase hex.
    pub fact_identity: String,
    pub quote_currency: String,
    pub settlement_currency: String,
    pub contract_status: String,
    /// The tick size.
    pub price_increment: String,
    /// The lot step.
    pub quantity_increment: String,
    pub lot_size: String,
    pub minimum_quantity: String,
    pub minimum_notional: String,
    /// Every admitted version, in fact-identity order; empty when none is admitted.
    pub economic_terms: Vec<EconomicTermsVersionV1>,
}

/// One admitted economic-terms version of an instrument.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EconomicTermsVersionV1 {
    pub fact_identity: String,
    pub account_scope: String,
    pub revision: u64,
    /// Inclusive start of the version's validity, in nanoseconds, as a decimal string.
    pub valid_from_ns: String,
    /// Exclusive end of the version's validity, in nanoseconds, as a decimal string.
    pub valid_until_ns_exclusive: String,
    pub fee_currency: String,
    pub maker_fee: String,
    pub taker_fee: String,
    pub initial_margin: String,
    pub maintenance_margin: String,
    pub margin_notional_cap: Option<String>,
}

/// Why the catalog could not answer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum InstrumentCatalogErrorV1 {
    /// `INSTRUMENT_UNKNOWN`: Market Data holds no Instrument Master V2 fact under this name.
    #[error("the instrument is not admitted")]
    InstrumentUnknown,
    /// A store, its ACL or a stored chain did not verify.
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// The sealed catalog read. No consumer can implement it.
#[async_trait]
pub trait InstrumentCatalogReadV1: Send + Sync + sealed::Sealed {
    /// Every admitted instrument, in canonical order.
    ///
    /// # Errors
    ///
    /// Returns [`InstrumentCatalogErrorV1::StoreUnavailable`] when a store does not verify.
    async fn list_instruments_v1(
        &self,
    ) -> Result<Vec<InstrumentListingV1>, InstrumentCatalogErrorV1>;

    /// One admitted instrument's latest public terms and its economic-terms versions.
    ///
    /// # Errors
    ///
    /// Returns [`InstrumentCatalogErrorV1::InstrumentUnknown`] for an instrument with no fact, and
    /// [`InstrumentCatalogErrorV1::StoreUnavailable`] when a store does not verify.
    async fn describe_instrument_v1(
        &self,
        instrument: &str,
    ) -> Result<InstrumentDescriptionV1, InstrumentCatalogErrorV1>;
}

mod sealed {
    pub trait Sealed {}
}

/// The catalog over the two Owner stores it reads: Instrument Master V2 and economic terms.
#[derive(Clone, Debug)]
pub struct InstrumentCatalogPostgresV1 {
    instrument_master: InstrumentMasterV2PostgresOwner,
    economic_terms: InstrumentEconomicTermsPostgresOwnerV1,
}

impl InstrumentCatalogPostgresV1 {
    #[must_use]
    pub const fn new(
        instrument_master: InstrumentMasterV2PostgresOwner,
        economic_terms: InstrumentEconomicTermsPostgresOwnerV1,
    ) -> Self {
        Self {
            instrument_master,
            economic_terms,
        }
    }
}

impl sealed::Sealed for InstrumentCatalogPostgresV1 {}

#[async_trait]
impl InstrumentCatalogReadV1 for InstrumentCatalogPostgresV1 {
    async fn list_instruments_v1(
        &self,
    ) -> Result<Vec<InstrumentListingV1>, InstrumentCatalogErrorV1> {
        let facts = self
            .instrument_master
            .latest_facts_v2(None)
            .await
            .map_err(|_| InstrumentCatalogErrorV1::StoreUnavailable)?;
        Ok(facts.iter().map(listing).collect())
    }

    async fn describe_instrument_v1(
        &self,
        instrument: &str,
    ) -> Result<InstrumentDescriptionV1, InstrumentCatalogErrorV1> {
        let fact = self
            .instrument_master
            .latest_facts_v2(Some(instrument))
            .await
            .map_err(|_| InstrumentCatalogErrorV1::StoreUnavailable)?
            .pop()
            .ok_or(InstrumentCatalogErrorV1::InstrumentUnknown)?;
        let terms = self
            .economic_terms
            .terms_for_instrument_v1(fact.canonical_identity())
            .await
            .map_err(|_| InstrumentCatalogErrorV1::StoreUnavailable)?;
        Ok(description(&fact, &terms))
    }
}

fn listing(fact: &InstrumentMasterFactV2) -> InstrumentListingV1 {
    let terms = fact.terms();
    InstrumentListingV1 {
        instrument: fact.canonical_identity().to_string(),
        venue: fact.venue_identity().to_string(),
        raw_symbol: fact.raw_symbol().to_string(),
        quote_currency: text_value(&terms.quote_currency),
        contract_status: text_value(&terms.contract_status),
    }
}

fn description(
    fact: &InstrumentMasterFactV2,
    economic_terms: &[InstrumentEconomicTermsReadbackV1],
) -> InstrumentDescriptionV1 {
    let terms = fact.terms();
    InstrumentDescriptionV1 {
        instrument: fact.canonical_identity().to_string(),
        venue: fact.venue_identity().to_string(),
        raw_symbol: fact.raw_symbol().to_string(),
        fact_identity: lower_hex(fact.identity().as_bytes()),
        quote_currency: text_value(&terms.quote_currency),
        settlement_currency: text_value(&terms.settlement_currency),
        contract_status: text_value(&terms.contract_status),
        price_increment: decimal_value(&terms.price_increment_from_filter),
        quantity_increment: decimal_value(&terms.quantity_increment_from_filter),
        lot_size: decimal_value(&terms.lot_size),
        minimum_quantity: decimal_value(&terms.minimum_quantity),
        minimum_notional: decimal_value(&terms.minimum_notional),
        economic_terms: economic_terms.iter().map(terms_version).collect(),
    }
}

fn terms_version(readback: &InstrumentEconomicTermsReadbackV1) -> EconomicTermsVersionV1 {
    let fact = readback.fact();
    let input = fact.input();
    let economic = |value: InstrumentEconomicDecimalV1| decimal_text(value.mantissa, value.scale);
    EconomicTermsVersionV1 {
        fact_identity: lower_hex(&fact.identity()),
        account_scope: input.account_scope_identity.clone(),
        revision: input.revision,
        valid_from_ns: input.valid_from_ns.to_string(),
        valid_until_ns_exclusive: input.valid_until_ns_exclusive.to_string(),
        fee_currency: input.fee_currency.clone(),
        maker_fee: economic(input.maker_fee),
        taker_fee: economic(input.taker_fee),
        initial_margin: economic(input.initial_margin),
        maintenance_margin: economic(input.maintenance_margin),
        margin_notional_cap: input.margin_notional_cap.map(economic),
    }
}

fn text_value(value: &FactValue<String>) -> String {
    match value {
        FactValue::Value(text) => text.clone(),
        other => absent(other),
    }
}

fn decimal_value(value: &FactValue<InstrumentDecimalV2>) -> String {
    match value {
        FactValue::Value(decimal) => decimal_text(decimal.mantissa, decimal.scale),
        other => absent(other),
    }
}

fn absent<T>(value: &FactValue<T>) -> String {
    match value {
        FactValue::Value(_) => unreachable!("a stated value is rendered by its caller"),
        FactValue::Unbounded => "UNBOUNDED",
        FactValue::NotApplicable => "NOT_APPLICABLE",
        FactValue::Unavailable => "UNAVAILABLE",
    }
    .to_string()
}

/// The exact decimal `mantissa * 10^-scale`, with no exponent and no rounding.
fn decimal_text(mantissa: i128, scale: u8) -> String {
    let digits = mantissa.unsigned_abs().to_string();
    let scale = usize::from(scale);
    let sign = if mantissa < 0 { "-" } else { "" };

    if scale == 0 {
        return format!("{sign}{digits}");
    }
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = padded.split_at(padded.len() - scale);
    format!("{sign}{whole}.{fraction}")
}

fn lower_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    bytes.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case(1, 1, "0.1")]
    #[case(10, 0, "10")]
    #[case(5, 4, "0.0005")]
    #[case(3_724_436, 2, "37244.36")]
    #[case(-25, 3, "-0.025")]
    #[case(0, 0, "0")]
    fn a_decimal_is_rendered_exactly(
        #[case] mantissa: i128,
        #[case] scale: u8,
        #[case] text: &str,
    ) {
        assert_eq!(decimal_text(mantissa, scale), text);
    }

    #[rstest]
    fn a_term_the_venue_does_not_state_is_named_never_a_number() {
        assert_eq!(decimal_value(&FactValue::Unbounded), "UNBOUNDED");
        assert_eq!(decimal_value(&FactValue::NotApplicable), "NOT_APPLICABLE");
        assert_eq!(decimal_value(&FactValue::Unavailable), "UNAVAILABLE");
        assert_eq!(
            decimal_value(&FactValue::Value(InstrumentDecimalV2 {
                mantissa: 1,
                scale: 1
            })),
            "0.1"
        );
    }

    #[rstest]
    fn a_digest_is_lowercase_hex() {
        assert_eq!(lower_hex(&[0x0a, 0xff, 0x00]), "0aff00");
    }
}
