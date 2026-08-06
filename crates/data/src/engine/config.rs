use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};
use vibe_model::{
    enums::{BarAggregation, BarIntervalType},
    identifiers::ClientId,
};

/// Configuration for `DataEngine` instances.
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.data", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.data")
)]
#[derive(Clone, Debug, Deserialize, Serialize, bon::Builder)]
#[serde(default, deny_unknown_fields)]
pub struct DataEngineConfig {
    /// If time bar aggregators will build and emit bars with no new market updates.
    #[builder(default = true)]
    pub time_bars_build_with_no_updates: bool,
    /// If time bar aggregators will timestamp `ts_event` on bar close.
    /// If False, then will timestamp on bar open.
    #[builder(default = true)]
    pub time_bars_timestamp_on_close: bool,
    /// If time bar aggregators will skip emitting a bar if the aggregation starts mid-interval.
    #[builder(default)]
    pub time_bars_skip_first_non_full_bar: bool,
    /// Determines the type of interval used for time aggregation.
    /// - `LeftOpen`: start time is excluded and end time is included (default).
    /// - `RightOpen`: start time is included and end time is excluded.
    #[builder(default = BarIntervalType::LeftOpen)]
    pub time_bars_interval_type: BarIntervalType,
    /// The time delay (microseconds) before building and emitting a bar.
    #[builder(default)]
    pub time_bars_build_delay: u64,
    /// A dictionary mapping time bar aggregations to their origin time offsets.
    #[builder(default)]
    pub time_bars_origin_offset: HashMap<BarAggregation, Duration>,
    /// If data objects timestamp sequencing will be validated and handled.
    #[builder(default)]
    pub validate_data_sequence: bool,
    /// If order book deltas should be buffered until the `F_LAST` flag is set for a delta.
    #[builder(default)]
    pub buffer_deltas: bool,
    /// If quotes should be emitted on order book updates.
    #[builder(default)]
    pub emit_quotes_from_book: bool,
    /// If quotes should be emitted on order book depth updates.
    #[builder(default)]
    pub emit_quotes_from_book_depths: bool,
    /// If data published through the pipeline path should be suppressed from the cache.
    ///
    /// When `true`, historical replays still publish on pipeline topics but the engine does not
    /// write the data to the cache.
    #[builder(default)]
    pub disable_historical_cache: bool,
    /// The client IDs declared for external stream processing.
    /// The data engine will not attempt to send data commands to these client IDs.
    pub external_clients: Option<Vec<ClientId>>,
    /// If debug mode is active (will provide extra debug logging).
    #[builder(default)]
    pub debug: bool,
}

impl Default for DataEngineConfig {
    fn default() -> Self {
        Self::builder().build()
    }
}
