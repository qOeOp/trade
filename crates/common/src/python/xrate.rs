use ahash::{AHashMap, HashMap};
use pyo3::prelude::*;
use rust_decimal::{Decimal, prelude::FromPrimitive};
use ustr::Ustr;
use vibe_core::python::to_pyvalue_err;
use vibe_model::enums::PriceType;

use crate::xrate::get_exchange_rate;

/// Calculates the exchange rate between two currencies using provided bid and ask quotes.
///
/// This function builds a graph of direct conversion rates from the quotes and uses a DFS to
/// accumulate the conversion rate along a valid conversion path. While a full Floyd-Warshall
/// algorithm could compute all-pairs conversion rates, the DFS approach here provides a quick
/// solution for a single conversion query.
///
/// # Errors
///
/// For conversions between distinct currencies (an identical `from_currency` and `to_currency`
/// returns a rate of one without inspecting the quotes), returns an error if:
/// - `quotes_bid` or `quotes_ask` is empty.
/// - `quotes_bid` and `quotes_ask` lengths are not equal.
/// - `price_type` is equal to `Last` or `Mark` (cannot calculate from quotes).
/// - The bid or ask side of a pair is missing.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.common")]
#[pyo3(name = "get_exchange_rate")]
#[pyo3(signature = (from_currency, to_currency, price_type, quotes_bid, quotes_ask))]
pub fn py_get_exchange_rate(
    from_currency: &str,
    to_currency: &str,
    price_type: PriceType,
    quotes_bid: HashMap<String, f64>,
    quotes_ask: HashMap<String, f64>,
) -> PyResult<Option<Decimal>> {
    let quotes_bid = f64_quotes_to_decimal(quotes_bid).map_err(to_pyvalue_err)?;
    let quotes_ask = f64_quotes_to_decimal(quotes_ask).map_err(to_pyvalue_err)?;

    get_exchange_rate(
        Ustr::from(from_currency),
        Ustr::from(to_currency),
        price_type,
        quotes_bid,
        quotes_ask,
    )
    .map_err(to_pyvalue_err)
}

fn f64_quotes_to_decimal(quotes: HashMap<String, f64>) -> anyhow::Result<AHashMap<Ustr, Decimal>> {
    quotes
        .into_iter()
        .map(|(pair, value)| {
            let rate = Decimal::from_f64(value).ok_or_else(|| {
                anyhow::anyhow!("Invalid quote rate for pair {pair}, was {value}")
            })?;
            Ok((Ustr::from(&pair), rate))
        })
        .collect()
}
