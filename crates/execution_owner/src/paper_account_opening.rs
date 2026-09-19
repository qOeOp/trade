//! Execution-owned PAPER account opening facts.
//!
//! Execution owns account facts. For a simulated PAPER account the opening collateral is an
//! Execution-committed fact bound to the exact admitted adapter binding, never a Portfolio or
//! caller assertion. Portfolio derives its PAPER Capacity View from this fact.
//!
//! A caller cannot mint the sealed fact:
//!
//! ```compile_fail
//! use vibe_execution_owner::paper_account_opening::PaperAccountOpeningFact;
//!
//! let _forged = PaperAccountOpeningFact {};
//! ```
//!
//! ```compile_fail
//! use serde::de::DeserializeOwned;
//! use vibe_execution_owner::paper_account_opening::PaperAccountOpeningFact;
//!
//! fn requires_deserialize<T: DeserializeOwned>() {}
//! requires_deserialize::<PaperAccountOpeningFact>();
//! ```

use std::{error::Error, fmt::Display};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::adapter_binding::PaperAdapterBindingLocator;

/// Canonical fact kind for PAPER account opening facts.
pub const PAPER_ACCOUNT_OPENING_KIND: &str = "execution-paper-account-opening-v1";
/// Schema version of the opening fact contract.
pub const PAPER_ACCOUNT_OPENING_SCHEMA_VERSION: u32 = 1;
const FACT_ID_DOMAIN: &[u8] = b"vibe.execution.paper-account-opening.fact-id.v1\0";

/// Caller-supplied proposal for one simulated account's opening collateral.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperAccountOpeningDraft {
    /// Must equal [`PAPER_ACCOUNT_OPENING_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Exact current admitted binding whose account namespace opens.
    pub binding_locator: PaperAdapterBindingLocator,
    /// ISO-style collateral currency code, upper case ASCII.
    pub collateral_currency: String,
    /// Canonical positive decimal amount (`123`, `123.45`); no sign, no exponent.
    pub collateral_amount: String,
    /// Owner observation time.
    pub observed_at_epoch_ms: u64,
    /// Clock epoch the observation belongs to.
    pub clock_epoch: u64,
}

/// Errors returned by the opening-fact Owner path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaperAccountOpeningError {
    /// A named field is malformed.
    InvalidField(&'static str),
    /// Time evidence is zero, unordered, or outside the binding interval.
    InvalidTimeEvidence,
    /// The binding locator does not resolve to the current admitted head.
    BindingNotAdmitted,
    /// The account namespace already carries a different opening fact.
    ConflictingReplay,
    /// Owner custody is unavailable.
    StoreUnavailable,
    /// No opening fact exists for the namespace.
    FactNotFound,
}

impl Display for PaperAccountOpeningError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidField(field) => write!(formatter, "invalid {field}"),
            Self::InvalidTimeEvidence => formatter.write_str("invalid time evidence"),
            Self::BindingNotAdmitted => formatter.write_str("binding is not the admitted head"),
            Self::ConflictingReplay => formatter.write_str("conflicting opening fact replay"),
            Self::StoreUnavailable => formatter.write_str("Execution custody unavailable"),
            Self::FactNotFound => formatter.write_str("opening fact not found"),
        }
    }
}

impl Error for PaperAccountOpeningError {}

/// Normalized meaning of one opening fact; identity derives from these bytes alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OpeningMeaning {
    pub(crate) schema_version: u32,
    pub(crate) account_namespace: String,
    pub(crate) execution_scope_identity: String,
    pub(crate) binding_fact_identity: String,
    pub(crate) collateral_currency: String,
    pub(crate) collateral_amount: String,
    pub(crate) observed_at_epoch_ms: u64,
    pub(crate) clock_epoch: u64,
}

/// Sealed Execution-committed opening fact.
///
/// Private fields, no public constructor, no `Deserialize`: possession proves Execution custody
/// committed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PaperAccountOpeningFact {
    fact_identity: String,
    meaning: OpeningMeaning,
    sequence: u64,
}

impl PaperAccountOpeningFact {
    pub(crate) fn seal(fact_identity: String, meaning: OpeningMeaning, sequence: u64) -> Self {
        Self {
            fact_identity,
            meaning,
            sequence,
        }
    }

    /// Owner-derived fact identity.
    #[must_use]
    pub fn fact_identity(&self) -> &str {
        &self.fact_identity
    }

    /// PAPER account namespace that opened.
    #[must_use]
    pub fn account_namespace(&self) -> &str {
        &self.meaning.account_namespace
    }

    /// Execution Scope identity of the binding.
    #[must_use]
    pub fn execution_scope_identity(&self) -> &str {
        &self.meaning.execution_scope_identity
    }

    /// Fact identity of the admitted binding this account opened under.
    #[must_use]
    pub fn binding_fact_identity(&self) -> &str {
        &self.meaning.binding_fact_identity
    }

    /// Collateral currency.
    #[must_use]
    pub fn collateral_currency(&self) -> &str {
        &self.meaning.collateral_currency
    }

    /// Canonical collateral amount.
    #[must_use]
    pub fn collateral_amount(&self) -> &str {
        &self.meaning.collateral_amount
    }

    /// Owner observation time.
    #[must_use]
    pub const fn observed_at_epoch_ms(&self) -> u64 {
        self.meaning.observed_at_epoch_ms
    }

    /// Clock epoch of the observation.
    #[must_use]
    pub const fn clock_epoch(&self) -> u64 {
        self.meaning.clock_epoch
    }

    /// Native Execution stream sequence; the account fact cut identity for consumers.
    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    pub(crate) const fn meaning(&self) -> &OpeningMeaning {
        &self.meaning
    }
}

pub(crate) fn validate_currency(value: &str) -> Result<(), PaperAccountOpeningError> {
    if !(3..=12).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(PaperAccountOpeningError::InvalidField(
            "collateral_currency",
        ));
    }
    Ok(())
}

pub(crate) fn validate_amount(value: &str) -> Result<(), PaperAccountOpeningError> {
    let (integer, fraction) = value.split_once('.').unwrap_or((value, ""));
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    let well_formed = digits(integer)
        && (fraction.is_empty() && !value.ends_with('.') || digits(fraction))
        && (integer == "0" || !integer.starts_with('0'))
        && value.len() <= 40
        && value.bytes().any(|byte| (b'1'..=b'9').contains(&byte));

    if !well_formed {
        return Err(PaperAccountOpeningError::InvalidField("collateral_amount"));
    }
    Ok(())
}

pub(crate) fn derive_opening_fact_identity(meaning: &OpeningMeaning) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FACT_ID_DOMAIN);

    for value in [
        meaning.account_namespace.as_str(),
        meaning.execution_scope_identity.as_str(),
        meaning.binding_fact_identity.as_str(),
        meaning.collateral_currency.as_str(),
        meaning.collateral_amount.as_str(),
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    hasher.update(meaning.schema_version.to_be_bytes());
    hasher.update(meaning.observed_at_epoch_ms.to_be_bytes());
    hasher.update(meaning.clock_epoch.to_be_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case("USDT", true)]
    #[case("usdt", false)]
    #[case("US", false)]
    fn currency_is_upper_case_ascii(#[case] value: &str, #[case] valid: bool) {
        assert_eq!(validate_currency(value).is_ok(), valid);
    }

    #[rstest]
    #[case("100000", true)]
    #[case("0.5", true)]
    #[case("12.345678", true)]
    #[case("0", false)]
    #[case("0.0", false)]
    #[case("-1", false)]
    #[case("01", false)]
    #[case("1.", false)]
    #[case(".5", false)]
    #[case("1e5", false)]
    fn amount_is_canonical_positive_decimal(#[case] value: &str, #[case] valid: bool) {
        assert_eq!(validate_amount(value).is_ok(), valid);
    }
}
