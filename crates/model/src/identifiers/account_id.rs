//! Represents a valid account ID.

use std::{
    fmt::{Debug, Display},
    hash::Hash,
};

use ustr::Ustr;
use vibe_core::correctness::{
    CorrectnessResult, CorrectnessResultExt, FAILED, check_predicate_false, check_string_contains,
    check_valid_string_ascii,
};

use super::Venue;

/// Represents a valid account ID.
#[repr(C)]
#[derive(Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.model", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.model")
)]
pub struct AccountId(Ustr);

impl AccountId {
    /// Creates a new [`AccountId`] instance with correctness checking.
    ///
    /// Must be correctly formatted with two valid strings either side of a hyphen '-'.
    ///
    /// It is expected an account ID is the name of the issuer with an account number
    /// separated by a hyphen.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - `value` is not a valid ASCII string.
    /// - `value` does not contain a hyphen '-' separator.
    /// - Either the issuer or account part (before/after the hyphen) is empty.
    ///
    /// # Notes
    ///
    /// PyO3 requires a `Result` type for proper error handling and stacktrace printing in Python.
    pub fn new_checked<T: AsRef<str>>(value: T) -> CorrectnessResult<Self> {
        let value = value.as_ref();
        check_valid_string_ascii(value, stringify!(value))?;
        check_string_contains(value, "-", stringify!(value))?;

        if let Some((issuer, account)) = value.split_once('-') {
            check_predicate_false(
                issuer.is_empty(),
                "`value` issuer part (before '-') cannot be empty",
            )?;
            check_predicate_false(
                account.is_empty(),
                "`value` account part (after '-') cannot be empty",
            )?;
        }

        Ok(Self(Ustr::from(value)))
    }

    /// Creates a new [`AccountId`] instance.
    ///
    /// # Panics
    ///
    /// Panics if `value` is not a valid string, or value length is greater than 36.
    pub fn new<T: AsRef<str>>(value: T) -> Self {
        Self::new_checked(value).expect_display(FAILED)
    }

    /// Sets the inner identifier value.
    #[cfg_attr(not(feature = "python"), allow(dead_code))]
    pub(crate) fn set_inner(&mut self, value: &str) {
        self.0 = Ustr::from(value);
    }

    /// Returns the inner identifier value.
    #[must_use]
    pub fn inner(&self) -> Ustr {
        self.0
    }

    /// Returns the inner identifier value as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    /// Returns the account issuer for this identifier.
    ///
    /// # Panics
    ///
    /// Panics if the internal ID does not contain a hyphen separator.
    #[must_use]
    pub fn get_issuer(&self) -> Venue {
        Venue::from_str_unchecked(
            self.0
                .split_once('-')
                .unwrap_or_else(|| panic!("AccountId contains '-'"))
                .0,
        )
    }

    /// Returns the account ID assigned by the issuer.
    ///
    /// # Panics
    ///
    /// Panics if the internal ID does not contain a hyphen separator.
    #[must_use]
    pub fn get_issuers_id(&self) -> &str {
        self.0
            .split_once('-')
            .unwrap_or_else(|| panic!("AccountId contains '-'"))
            .1
    }
}

impl Debug for AccountId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "\"{}\"", self.0)
    }
}

impl Display for AccountId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_core::correctness::CorrectnessError;

    use super::*;
    use crate::identifiers::stubs::*;

    #[rstest]
    #[should_panic(expected = "invalid string for 'value', was empty")]
    fn test_account_id_new_invalid_string() {
        AccountId::new("");
    }

    #[rstest]
    #[should_panic(expected = "did not contain '-'")]
    fn test_account_id_new_missing_hyphen() {
        AccountId::new("123456789");
    }

    #[rstest]
    fn test_account_id_fmt() {
        let s = "IB-U123456789";
        let account_id = AccountId::new(s);
        let formatted = format!("{account_id}");
        assert_eq!(formatted, s);
    }

    #[rstest]
    fn test_string_reprs(account_ib: AccountId) {
        assert_eq!(account_ib.as_str(), "IB-1234567890");
    }

    #[rstest]
    fn test_get_issuer(account_ib: AccountId) {
        assert_eq!(account_ib.get_issuer(), Venue::new("IB"));
    }

    #[rstest]
    fn test_get_issuers_id(account_ib: AccountId) {
        assert_eq!(account_ib.get_issuers_id(), "1234567890");
    }

    #[rstest]
    #[should_panic(expected = "issuer part (before '-') cannot be empty")]
    fn test_new_with_empty_issuer_panics() {
        let _ = AccountId::new("-123456");
    }

    #[rstest]
    #[should_panic(expected = "account part (after '-') cannot be empty")]
    fn test_new_with_empty_account_panics() {
        let _ = AccountId::new("IB-");
    }

    #[rstest]
    fn test_new_checked_with_empty_issuer_returns_error() {
        assert!(AccountId::new_checked("-123456").is_err());
    }

    #[rstest]
    fn test_new_checked_with_empty_account_returns_error() {
        assert!(AccountId::new_checked("IB-").is_err());
    }

    #[rstest]
    fn test_new_checked_with_empty_issuer_returns_typed_error_with_stable_display() {
        let error = AccountId::new_checked("-123456").unwrap_err();

        match error {
            CorrectnessError::PredicateViolation { ref message } => {
                assert_eq!(message, "`value` issuer part (before '-') cannot be empty");
            }
            other => panic!("Expected typed predicate violation, was: {other:?}"),
        }

        assert_eq!(
            error.to_string(),
            "`value` issuer part (before '-') cannot be empty"
        );
    }

    #[rstest]
    fn test_new_checked_with_empty_account_returns_typed_error_with_stable_display() {
        let error = AccountId::new_checked("IB-").unwrap_err();

        match error {
            CorrectnessError::PredicateViolation { ref message } => {
                assert_eq!(message, "`value` account part (after '-') cannot be empty");
            }
            other => panic!("Expected typed predicate violation, was: {other:?}"),
        }

        assert_eq!(
            error.to_string(),
            "`value` account part (after '-') cannot be empty"
        );
    }
}
