//! Exact JSON number serialization for BitMEX financial values.

use std::str::FromStr;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize, de::Error as _, ser::Error as _};
use serde_json::value::RawValue;

fn parse_decimal(raw: &str) -> Result<Decimal, rust_decimal::Error> {
    Decimal::from_str(raw).or_else(|_| Decimal::from_scientific(raw))
}

pub(crate) mod optional_decimal {
    use super::*;

    pub(crate) fn deserialize<'de, D>(deserializer: D) -> Result<Option<Decimal>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = Box::<RawValue>::deserialize(deserializer)?;
        if raw.get() == "null" {
            return Ok(None);
        }

        parse_decimal(raw.get()).map(Some).map_err(D::Error::custom)
    }

    pub(crate) fn serialize<S>(value: &Option<Decimal>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match value {
            Some(value) => RawValue::from_string(value.to_string())
                .map_err(S::Error::custom)?
                .serialize(serializer),
            None => serializer.serialize_none(),
        }
    }
}
