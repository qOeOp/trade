//! Represents a system client ID.

use std::{
    fmt::{Debug, Display},
    hash::Hash,
};

use ustr::Ustr;
use vibe_core::correctness::{
    CorrectnessResult, CorrectnessResultExt, FAILED, check_valid_string_ascii,
};

/// Represents a system client ID.
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
pub struct ClientId(Ustr);

impl ClientId {
    /// Creates a new [`ClientId`] instance with correctness checking.
    ///
    /// # Errors
    ///
    /// Returns an error if `value` is not a valid string.
    ///
    /// # Notes
    ///
    /// PyO3 requires a `Result` type for proper error handling and stacktrace printing in Python.
    pub fn new_checked<T: AsRef<str>>(value: T) -> CorrectnessResult<Self> {
        let value = value.as_ref();
        check_valid_string_ascii(value, stringify!(value))?;
        Ok(Self(Ustr::from(value)))
    }

    /// Creates a new [`ClientId`] instance.
    ///
    /// # Panics
    ///
    /// Panics if `value` is not a valid string.
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
}

impl Debug for ClientId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "\"{}\"", self.0)
    }
}

impl Display for ClientId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::identifiers::stubs::*;

    #[rstest]
    fn test_string_reprs(client_id_binance: ClientId) {
        assert_eq!(client_id_binance.as_str(), "BINANCE");
        assert_eq!(format!("{client_id_binance}"), "BINANCE");
    }

    #[rstest]
    fn test_deserialize_from_owned_value() {
        let value = serde_json::Value::String("BINANCE".to_string());

        let deserialized: ClientId = serde_json::from_value(value).unwrap();
        assert_eq!(deserialized, ClientId::new("BINANCE"));
    }

    #[rstest]
    #[should_panic(expected = "Condition failed: invalid string for 'value', was empty")]
    fn test_new_with_empty_string_panics_with_display_format() {
        let _ = ClientId::new("");
    }
}
