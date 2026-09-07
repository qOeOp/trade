//! Instrument Owner-private economic terms and exact-locator readback.
//!
//! These terms are not public Instrument Master truth.  Only the Instrument Owner PostgreSQL
//! authority can construct a readback; callers can carry its locator but cannot manufacture the
//! receipt used by Strategy Factory.
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_economic_terms_v1::InstrumentEconomicTermsReadbackV1;
//! let forged = InstrumentEconomicTermsReadbackV1 {};
//! ```

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1: u16 = 1;
const FACT_DOMAIN: &[u8] = b"instrument-owner.private-economic-terms.fact.v1\0";
const MEANING_DOMAIN: &[u8] = b"instrument-owner.private-economic-terms.meaning.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"instrument-owner.private-economic-terms.receipt.v1\0";
const MAX_BYTES: usize = 32 * 1024;
const MAX_TEXT: usize = 256;

/// Exact base-10 value. Zero and redundant fractional zeroes are not admitted.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentEconomicDecimalV1 {
    pub mantissa: i128,
    pub scale: u8,
}

/// The only margin meaning admitted by this version.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstrumentMarginMeaningV1 {
    /// Initial and maintenance values are fixed rates multiplied by notional, without leverage.
    StandardNotionalRate,
}

/// The account/margin applicability admitted by this version.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstrumentEconomicAccountApplicabilityV1 {
    MarginAccount,
}

/// Complete private Owner input. Every field participates in canonical identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentEconomicTermsInputV1 {
    pub schema_version: u16,
    pub instrument_identity: String,
    pub instrument_public_fact_digest: [u8; 32],
    pub venue_identity: String,
    pub account_scope_identity: String,
    pub account_applicability: InstrumentEconomicAccountApplicabilityV1,
    pub valid_from_ns: i128,
    pub valid_until_ns_exclusive: i128,
    pub source_identity: String,
    pub source_digest: [u8; 32],
    pub provenance_digest: [u8; 32],
    pub revision: u64,
    pub quote_currency: String,
    pub fee_currency: String,
    pub maker_fee: InstrumentEconomicDecimalV1,
    pub taker_fee: InstrumentEconomicDecimalV1,
    pub initial_margin: InstrumentEconomicDecimalV1,
    pub maintenance_margin: InstrumentEconomicDecimalV1,
    pub margin_meaning: InstrumentMarginMeaningV1,
}

/// Canonical private fact. This type has no public field mutation surface.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentEconomicTermsFactV1 {
    input: InstrumentEconomicTermsInputV1,
    canonical_bytes: Vec<u8>,
    identity: [u8; 32],
    meaning_identity: [u8; 32],
}

impl InstrumentEconomicTermsFactV1 {
    /// Validates and seals the complete private fact.
    ///
    /// # Errors
    ///
    /// Returns a field, canonicalization, or size failure for incomplete or ambiguous meaning.
    pub fn seal(
        input: InstrumentEconomicTermsInputV1,
    ) -> Result<Self, InstrumentEconomicTermsErrorV1> {
        validate_input(&input)?;
        let canonical_bytes = serde_json::to_vec(&input)
            .map_err(|_| InstrumentEconomicTermsErrorV1::CodecMismatch)?;
        if canonical_bytes.len() > MAX_BYTES {
            return Err(InstrumentEconomicTermsErrorV1::LengthOverflow);
        }
        Ok(Self {
            identity: digest(FACT_DOMAIN, &canonical_bytes),
            meaning_identity: meaning_identity(&input),
            input,
            canonical_bytes,
        })
    }

    /// Strictly decodes only the canonical Owner encoding.
    ///
    /// # Errors
    ///
    /// Returns a codec or validation failure for altered, unknown, or non-canonical bytes.
    pub fn parse_canonical(bytes: &[u8]) -> Result<Self, InstrumentEconomicTermsErrorV1> {
        if bytes.len() > MAX_BYTES {
            return Err(InstrumentEconomicTermsErrorV1::LengthOverflow);
        }
        let input = serde_json::from_slice(bytes)
            .map_err(|_| InstrumentEconomicTermsErrorV1::CodecMismatch)?;
        let fact = Self::seal(input)?;
        if fact.canonical_bytes != bytes {
            return Err(InstrumentEconomicTermsErrorV1::NonCanonical);
        }
        Ok(fact)
    }

    #[must_use]
    pub const fn identity(&self) -> [u8; 32] {
        self.identity
    }
    #[must_use]
    pub const fn meaning_identity(&self) -> [u8; 32] {
        self.meaning_identity
    }
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    #[must_use]
    pub const fn input(&self) -> &InstrumentEconomicTermsInputV1 {
        &self.input
    }
}

/// Exact recovery locator. Both identities are required and neither selects a latest row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentEconomicTermsLocatorV1 {
    fact_identity: [u8; 32],
    receipt_identity: [u8; 32],
}

impl InstrumentEconomicTermsLocatorV1 {
    /// Creates an untrusted exact locator. Authority is established only by Owner resolution.
    ///
    /// # Errors
    ///
    /// Returns [`InstrumentEconomicTermsErrorV1::InvalidDigest`] for either zero identity.
    pub fn from_identities(
        fact_identity: [u8; 32],
        receipt_identity: [u8; 32],
    ) -> Result<Self, InstrumentEconomicTermsErrorV1> {
        if fact_identity == [0; 32] || receipt_identity == [0; 32] {
            return Err(InstrumentEconomicTermsErrorV1::InvalidDigest);
        }
        Ok(Self {
            fact_identity,
            receipt_identity,
        })
    }
    #[must_use]
    pub const fn fact_identity(&self) -> [u8; 32] {
        self.fact_identity
    }
    #[must_use]
    pub const fn receipt_identity(&self) -> [u8; 32] {
        self.receipt_identity
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InstrumentEconomicTermsReceiptV1 {
    fact_identity: [u8; 32],
    meaning_identity: [u8; 32],
    receipt_identity: [u8; 32],
    canonical_bytes: Vec<u8>,
}

impl InstrumentEconomicTermsReceiptV1 {
    pub(crate) fn issue(fact: &InstrumentEconomicTermsFactV1) -> Self {
        let mut bytes = Vec::with_capacity(66);
        bytes.extend_from_slice(&INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1.to_be_bytes());
        bytes.extend_from_slice(&fact.identity);
        bytes.extend_from_slice(&fact.meaning_identity);
        let receipt_identity = digest(RECEIPT_DOMAIN, &bytes);
        Self {
            fact_identity: fact.identity,
            meaning_identity: fact.meaning_identity,
            receipt_identity,
            canonical_bytes: bytes,
        }
    }

    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, InstrumentEconomicTermsErrorV1> {
        if bytes.len() != 66
            || u16::from_be_bytes([bytes[0], bytes[1]])
                != INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1
        {
            return Err(InstrumentEconomicTermsErrorV1::CodecMismatch);
        }
        let mut fact_identity = [0; 32];
        fact_identity.copy_from_slice(&bytes[2..34]);
        let mut meaning_identity = [0; 32];
        meaning_identity.copy_from_slice(&bytes[34..66]);
        Ok(Self {
            fact_identity,
            meaning_identity,
            receipt_identity: digest(RECEIPT_DOMAIN, bytes),
            canonical_bytes: bytes.to_vec(),
        })
    }

    pub(crate) fn identity(&self) -> [u8; 32] {
        self.receipt_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Move-only Owner readback recovered from an exact fact-and-receipt locator.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentEconomicTermsReadbackV1 {
    fact: InstrumentEconomicTermsFactV1,
    receipt: InstrumentEconomicTermsReceiptV1,
}

impl InstrumentEconomicTermsReadbackV1 {
    pub(crate) fn from_parts(
        fact: InstrumentEconomicTermsFactV1,
        receipt: InstrumentEconomicTermsReceiptV1,
    ) -> Result<Self, InstrumentEconomicTermsErrorV1> {
        let readback = Self { fact, receipt };
        if !readback.verify() {
            return Err(InstrumentEconomicTermsErrorV1::ReceiptMismatch);
        }
        Ok(readback)
    }

    #[must_use]
    pub const fn fact(&self) -> &InstrumentEconomicTermsFactV1 {
        &self.fact
    }
    #[must_use]
    pub const fn receipt_identity(&self) -> [u8; 32] {
        self.receipt.receipt_identity
    }
    #[must_use]
    pub fn locator(&self) -> InstrumentEconomicTermsLocatorV1 {
        InstrumentEconomicTermsLocatorV1 {
            fact_identity: self.fact.identity,
            receipt_identity: self.receipt.receipt_identity,
        }
    }
    #[must_use]
    pub fn verify(&self) -> bool {
        self.fact.identity != [0; 32]
            && self.receipt.fact_identity == self.fact.identity
            && self.receipt.meaning_identity == self.fact.meaning_identity
            && self.receipt == InstrumentEconomicTermsReceiptV1::issue(&self.fact)
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum InstrumentEconomicTermsErrorV1 {
    #[error("unsupported Instrument economic terms schema")]
    UnsupportedSchema,
    #[error("invalid Instrument economic terms identity")]
    InvalidIdentity,
    #[error("invalid Instrument economic terms digest")]
    InvalidDigest,
    #[error("invalid Instrument economic terms validity interval")]
    InvalidValidity,
    #[error("invalid Instrument economic decimal")]
    InvalidDecimal,
    #[error("invalid Instrument economic revision")]
    InvalidRevision,
    #[error("Instrument economic currency mismatch")]
    CurrencyMismatch,
    #[error("Instrument economic terms encoding is invalid")]
    CodecMismatch,
    #[error("Instrument economic terms encoding is non-canonical")]
    NonCanonical,
    #[error("Instrument economic terms encoding is too large")]
    LengthOverflow,
    #[error("Instrument economic receipt mismatches its fact")]
    ReceiptMismatch,
}

fn validate_input(
    input: &InstrumentEconomicTermsInputV1,
) -> Result<(), InstrumentEconomicTermsErrorV1> {
    if input.schema_version != INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1 {
        return Err(InstrumentEconomicTermsErrorV1::UnsupportedSchema);
    }

    for value in [
        &input.instrument_identity,
        &input.venue_identity,
        &input.account_scope_identity,
        &input.source_identity,
        &input.quote_currency,
        &input.fee_currency,
    ] {
        if value.is_empty() || value.len() > MAX_TEXT || !value.is_ascii() || value.trim() != value
        {
            return Err(InstrumentEconomicTermsErrorV1::InvalidIdentity);
        }
    }

    if [
        input.instrument_public_fact_digest,
        input.source_digest,
        input.provenance_digest,
    ]
    .contains(&[0; 32])
    {
        return Err(InstrumentEconomicTermsErrorV1::InvalidDigest);
    }

    if input.valid_from_ns >= input.valid_until_ns_exclusive {
        return Err(InstrumentEconomicTermsErrorV1::InvalidValidity);
    }

    if input.revision == 0 {
        return Err(InstrumentEconomicTermsErrorV1::InvalidRevision);
    }

    if input.quote_currency != input.fee_currency {
        return Err(InstrumentEconomicTermsErrorV1::CurrencyMismatch);
    }

    for value in [
        input.maker_fee,
        input.taker_fee,
        input.initial_margin,
        input.maintenance_margin,
    ] {
        if value.scale > 38 || value.mantissa <= 0 || (value.scale != 0 && value.mantissa % 10 == 0)
        {
            return Err(InstrumentEconomicTermsErrorV1::InvalidDecimal);
        }
    }
    Ok(())
}

fn meaning_identity(input: &InstrumentEconomicTermsInputV1) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(MEANING_DOMAIN);

    for text in [
        &input.instrument_identity,
        &input.venue_identity,
        &input.account_scope_identity,
    ] {
        h.update((text.len() as u32).to_be_bytes());
        h.update(text.as_bytes());
    }
    h.update(input.instrument_public_fact_digest);
    h.update(input.valid_from_ns.to_be_bytes());
    h.update(input.valid_until_ns_exclusive.to_be_bytes());
    h.update(input.revision.to_be_bytes());
    h.finalize().into()
}

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(domain);
    h.update(bytes);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn input() -> InstrumentEconomicTermsInputV1 {
        InstrumentEconomicTermsInputV1 {
            schema_version: 1,
            instrument_identity: "BTCUSDT-PERP".into(),
            instrument_public_fact_digest: [1; 32],
            venue_identity: "BINANCE".into(),
            account_scope_identity: "RDQ-MARGIN".into(),
            account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
            valid_from_ns: 100,
            valid_until_ns_exclusive: 200,
            source_identity: "fee-schedule-1".into(),
            source_digest: [2; 32],
            provenance_digest: [3; 32],
            revision: 1,
            quote_currency: "USDT".into(),
            fee_currency: "USDT".into(),
            maker_fee: InstrumentEconomicDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            taker_fee: InstrumentEconomicDecimalV1 {
                mantissa: 4,
                scale: 4,
            },
            initial_margin: InstrumentEconomicDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: InstrumentEconomicDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
            margin_meaning: InstrumentMarginMeaningV1::StandardNotionalRate,
        }
    }

    #[rstest]
    fn canonical_round_trip_is_byte_identical() {
        let fact = InstrumentEconomicTermsFactV1::seal(input()).unwrap();
        let decoded =
            InstrumentEconomicTermsFactV1::parse_canonical(fact.canonical_bytes()).unwrap();
        assert_eq!(decoded, fact);
    }

    #[rstest]
    fn zero_default_and_unknown_bytes_fail_closed() {
        let mut zero = input();
        zero.maker_fee.mantissa = 0;
        assert_eq!(
            InstrumentEconomicTermsFactV1::seal(zero),
            Err(InstrumentEconomicTermsErrorV1::InvalidDecimal)
        );
        let mut bytes = serde_json::to_value(input()).unwrap();
        bytes
            .as_object_mut()
            .unwrap()
            .insert("extra".into(), serde_json::json!(true));
        assert_eq!(
            InstrumentEconomicTermsFactV1::parse_canonical(&serde_json::to_vec(&bytes).unwrap()),
            Err(InstrumentEconomicTermsErrorV1::CodecMismatch)
        );
    }
}
