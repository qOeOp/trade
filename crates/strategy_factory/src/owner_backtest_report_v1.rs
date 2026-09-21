//! The Owner's readable economic report for one canonical Backtest result.
//!
//! The canonical result is the authority: this module reads it and renders it, and derives exactly
//! one number the result does not already carry - maximum drawdown - using the shared
//! [`MaxDrawdown`] statistic rather than a second implementation of it. The default
//! `PortfolioAnalyzer` does not register that statistic, so a canonical result's `statistics` block
//! never contains it and a reader looking for drawdown there finds nothing.
//!
//! Nothing here fabricates a value. A run that produced no fills reports no fills, and a report
//! whose numbers are all zero is a real report of a run that did nothing.

use std::{collections::BTreeMap, fmt::Display};

use vibe_analysis::{statistic::PortfolioStatistic, statistics::max_drawdown::MaxDrawdown};
use vibe_backtest::result::{CanonicalBacktestResult, decode_canonical_f64};
use vibe_core::UnixNanos;

/// One execution the canonical result observed, in the order the run produced it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerBacktestFillV1 {
    /// UNIX timestamp (nanoseconds) the venue stamped on the execution.
    pub ts_event_ns: u64,
    /// The execution's ordinal within its own order's event sequence.
    pub order_event_ordinal: u64,
    /// The client order identifier the execution belongs to.
    pub client_order_id: String,
    /// The instrument the execution traded.
    pub instrument_id: String,
    /// `BUY` or `SELL`, exactly as the canonical result spells it.
    pub order_side: String,
    /// The filled quantity, as the canonical decimal string.
    pub last_qty: String,
    /// The fill price, as the canonical decimal string.
    pub last_px: String,
    /// The commission with its currency, or `None` when the venue charged none.
    pub commission: Option<String>,
}

/// What one canonical Backtest result says a run earned, traded, and risked.
///
/// Every field is read from the canonical document except [`Self::max_drawdown`], which is derived
/// from [`Self::returns_series`] because no canonical result carries it.
#[derive(Clone, Debug, PartialEq)]
pub struct OwnerBacktestReportV1 {
    /// The configured run identity, or `None` when the run carried no configuration identity.
    pub run_config_id: Option<String>,
    /// The trader the run executed as.
    pub trader_id: String,
    /// `completed`, `failed`, `incomplete`, or `stopped`.
    pub outcome: String,
    /// UNIX timestamp (nanoseconds) of the first observed event, if the run observed one.
    pub backtest_start_ns: Option<u64>,
    /// UNIX timestamp (nanoseconds) of the last observed event, if the run observed one.
    pub backtest_end_ns: Option<u64>,
    /// Data elements the engine iterated.
    pub iterations: u64,
    /// Execution events the run produced.
    pub total_events: u64,
    /// Orders the run submitted.
    pub total_orders: u64,
    /// Positions the run opened, including snapshots.
    pub total_positions: u64,
    /// Every execution, ordered by event time and then by order event ordinal.
    pub fills: Vec<OwnerBacktestFillV1>,
    /// The return recorded at each timestamp, in timestamp order.
    pub returns_series: Vec<(u64, f64)>,
    /// Net return over the whole run, compounding [`Self::returns_series`].
    ///
    /// `None` when the run recorded no returns at all. A run that recorded returns summing to
    /// nothing reports `Some(0.0)`, so an unavailable number and a zero one stay distinguishable.
    pub net_return: Option<f64>,
    /// Maximum drawdown as a negative fraction, derived from [`Self::returns_series`].
    ///
    /// `None` when the run recorded no returns, for the same reason as [`Self::net_return`]. No
    /// canonical result carries this number, so it is derived here rather than read.
    pub max_drawdown: Option<f64>,
    /// Return-based statistics, keyed as the canonical result names them.
    pub stats_returns: BTreeMap<String, f64>,
    /// Position-based statistics, keyed as the canonical result names them.
    pub stats_general: BTreeMap<String, f64>,
    /// PnL statistics per settlement currency.
    pub stats_pnls: BTreeMap<String, BTreeMap<String, f64>>,
}

impl OwnerBacktestReportV1 {
    /// Reads one canonical Backtest result into the Owner's economic report.
    ///
    /// # Errors
    ///
    /// Returns an error naming the first field the canonical document does not supply in its
    /// documented shape. A partially read report is never produced, so an absent number cannot be
    /// mistaken for a zero one.
    pub fn from_canonical_result(result: &CanonicalBacktestResult) -> anyhow::Result<Self> {
        let document = result.as_value();
        let run = document
            .get("run")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| anyhow::anyhow!("canonical result carries no run block"))?;
        let statistics = document
            .get("statistics")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| anyhow::anyhow!("canonical result carries no statistics block"))?;
        let returns_series = read_returns_series(statistics)?;
        let (net_return, max_drawdown) = if returns_series.is_empty() {
            (None, None)
        } else {
            let compounded = returns_series
                .iter()
                .fold(1.0, |equity, &(_, value)| equity * (1.0 + value))
                - 1.0;
            let drawdown = MaxDrawdown {}
                .calculate_from_returns(
                    &returns_series
                        .iter()
                        .map(|&(timestamp, value)| (UnixNanos::from(timestamp), value))
                        .collect::<BTreeMap<_, _>>(),
                )
                .ok_or_else(|| {
                    anyhow::anyhow!("maximum drawdown is undefined for a non-empty return series")
                })?;
            (Some(compounded), Some(drawdown))
        };

        Ok(Self {
            run_config_id: optional_text(run, "run_config_id")?,
            trader_id: required_text(run, "trader_id")?,
            outcome: required_text(run, "outcome")?,
            backtest_start_ns: optional_count(run, "backtest_start_ns")?,
            backtest_end_ns: optional_count(run, "backtest_end_ns")?,
            iterations: required_count(run, "iterations")?,
            total_events: required_count(run, "total_events")?,
            total_orders: required_count(run, "total_orders")?,
            total_positions: required_count(run, "total_positions")?,
            fills: read_fills(document)?,
            returns_series,
            net_return,
            max_drawdown,
            stats_returns: read_f64_map(statistics, "returns")?,
            stats_general: read_f64_map(statistics, "general")?,
            stats_pnls: read_pnl_maps(statistics)?,
        })
    }

    /// Returns the number of executions the run produced.
    #[must_use]
    pub const fn fill_count(&self) -> usize {
        self.fills.len()
    }
}

impl Display for OwnerBacktestReportV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(
            formatter,
            "run config id   {}",
            self.run_config_id.as_deref().unwrap_or("none")
        )?;
        writeln!(formatter, "trader id       {}", self.trader_id)?;
        writeln!(formatter, "outcome         {}", self.outcome)?;
        writeln!(
            formatter,
            "window ns       {} .. {}",
            optional_ns(self.backtest_start_ns),
            optional_ns(self.backtest_end_ns)
        )?;
        writeln!(formatter, "iterations      {}", self.iterations)?;
        writeln!(formatter, "total events    {}", self.total_events)?;
        writeln!(formatter, "total orders    {}", self.total_orders)?;
        writeln!(formatter, "total positions {}", self.total_positions)?;
        writeln!(formatter, "fills           {}", self.fill_count())?;
        writeln!(
            formatter,
            "net return      {}",
            optional_ratio(self.net_return)
        )?;
        writeln!(
            formatter,
            "max drawdown    {}",
            optional_ratio(self.max_drawdown)
        )?;
        writeln!(formatter, "return points   {}", self.returns_series.len())?;

        if self.fills.is_empty() {
            writeln!(formatter, "  (no execution)")?;
        }

        for fill in &self.fills {
            writeln!(
                formatter,
                "  fill ts={} ord={} {} {} qty={} px={} commission={} {}",
                fill.ts_event_ns,
                fill.order_event_ordinal,
                fill.order_side,
                fill.instrument_id,
                fill.last_qty,
                fill.last_px,
                fill.commission.as_deref().unwrap_or("none"),
                fill.client_order_id,
            )?;
        }

        for (timestamp, value) in &self.returns_series {
            writeln!(formatter, "  return ts={timestamp} value={value:.10}")?;
        }

        for (name, value) in &self.stats_returns {
            writeln!(formatter, "  returns   {name} = {value}")?;
        }

        for (name, value) in &self.stats_general {
            writeln!(formatter, "  general   {name} = {value}")?;
        }

        for (currency, values) in &self.stats_pnls {
            for (name, value) in values {
                writeln!(formatter, "  pnl {currency} {name} = {value}")?;
            }
        }

        Ok(())
    }
}

fn optional_ratio(value: Option<f64>) -> String {
    value.map_or_else(
        || "unavailable (no return points)".to_owned(),
        |ratio| format!("{ratio:.10}"),
    )
}

fn optional_ns(value: Option<u64>) -> String {
    value.map_or_else(|| "none".to_owned(), |nanos| nanos.to_string())
}

fn required_text(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> anyhow::Result<String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("canonical result field run.{key} is not a string"))
}

fn optional_text(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> anyhow::Result<Option<String>> {
    match object.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => anyhow::bail!("canonical result field run.{key} is neither null nor a string"),
    }
}

fn required_count(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> anyhow::Result<u64> {
    required_text(object, key)?
        .parse()
        .map_err(|e| anyhow::anyhow!("canonical result field run.{key} is not a count: {e}"))
}

fn optional_count(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> anyhow::Result<Option<u64>> {
    match optional_text(object, key)? {
        None => Ok(None),
        Some(text) => text
            .parse()
            .map(Some)
            .map_err(|e| anyhow::anyhow!("canonical result field run.{key} is not a count: {e}")),
    }
}

fn read_f64_map(
    statistics: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> anyhow::Result<BTreeMap<String, f64>> {
    let object = statistics
        .get(key)
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("canonical result statistics.{key} is not an object"))?;
    object
        .iter()
        .map(|(name, value)| {
            let text = value.as_str().ok_or_else(|| {
                anyhow::anyhow!("canonical result statistics.{key}.{name} is not a string")
            })?;
            Ok((name.clone(), decode_canonical_f64(text)?))
        })
        .collect()
}

fn read_pnl_maps(
    statistics: &serde_json::Map<String, serde_json::Value>,
) -> anyhow::Result<BTreeMap<String, BTreeMap<String, f64>>> {
    let object = statistics
        .get("pnls")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("canonical result statistics.pnls is not an object"))?;
    object
        .iter()
        .map(|(currency, values)| {
            let values = values.as_object().ok_or_else(|| {
                anyhow::anyhow!("canonical result statistics.pnls.{currency} is not an object")
            })?;
            let decoded = values
                .iter()
                .map(|(name, value)| {
                    let text = value.as_str().ok_or_else(|| {
                        anyhow::anyhow!(
                            "canonical result statistics.pnls.{currency}.{name} is not a string"
                        )
                    })?;
                    Ok((name.clone(), decode_canonical_f64(text)?))
                })
                .collect::<anyhow::Result<BTreeMap<_, _>>>()?;
            Ok((currency.clone(), decoded))
        })
        .collect()
}

fn read_returns_series(
    statistics: &serde_json::Map<String, serde_json::Value>,
) -> anyhow::Result<Vec<(u64, f64)>> {
    let entries = statistics
        .get("returns_series")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            anyhow::anyhow!("canonical result statistics.returns_series is not an array")
        })?;
    let mut series = entries
        .iter()
        .map(|entry| {
            let entry = entry.as_object().ok_or_else(|| {
                anyhow::anyhow!("canonical result returns_series entry is not an object")
            })?;
            let timestamp = entry
                .get("timestamp_ns")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("returns_series entry carries no timestamp_ns"))?
                .parse::<u64>()?;
            let value = entry
                .get("value")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("returns_series entry carries no value"))?;
            Ok((timestamp, decode_canonical_f64(value)?))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    series.sort_by_key(|&(timestamp, _)| timestamp);
    Ok(series)
}

fn read_fills(document: &serde_json::Value) -> anyhow::Result<Vec<OwnerBacktestFillV1>> {
    let entries = document
        .get("fills")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("canonical result carries no fills array"))?;
    let mut fills = entries
        .iter()
        .map(read_fill)
        .collect::<anyhow::Result<Vec<_>>>()?;

    // The canonical encoder sorts `fills` for determinism, not for time, so a reader that wants
    // execution order has to restore it here.
    fills.sort_by(|left, right| {
        left.ts_event_ns
            .cmp(&right.ts_event_ns)
            .then_with(|| left.client_order_id.cmp(&right.client_order_id))
            .then_with(|| left.order_event_ordinal.cmp(&right.order_event_ordinal))
    });
    Ok(fills)
}

fn read_fill(entry: &serde_json::Value) -> anyhow::Result<OwnerBacktestFillV1> {
    let entry = entry
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("canonical result fill entry is not an object"))?;
    let client_order_id = entry
        .get("client_order_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("canonical result fill carries no client_order_id"))?
        .to_owned();
    let order_event_ordinal = entry
        .get("order_event_ordinal")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("canonical result fill carries no order_event_ordinal"))?
        .parse::<u64>()?;
    let filled = entry
        .get("event")
        .and_then(|event| event.get("Filled"))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("canonical result fill carries no Filled event"))?;
    let text = |key: &'static str| -> anyhow::Result<String> {
        filled
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| anyhow::anyhow!("canonical result fill field {key} is not a string"))
    };

    Ok(OwnerBacktestFillV1 {
        ts_event_ns: text("ts_event")?.parse()?,
        order_event_ordinal,
        client_order_id,
        instrument_id: text("instrument_id")?,
        order_side: text("order_side")?,
        last_qty: text("last_qty")?,
        last_px: text("last_px")?,
        commission: filled
            .get("commission")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned),
    })
}
