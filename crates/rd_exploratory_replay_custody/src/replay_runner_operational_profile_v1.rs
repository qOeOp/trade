//! Canonical non-economic runner profile for isolated EVENT Replay acceptance.
//!
//! Every `BacktestEngineConfig` state, timeout, logging, cache, and subsystem choice is explicit.
//! Nested records mirror the complete native configuration fields without invoking their
//! default-bearing deserializers or constructing an engine.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_core::datetime::checked_mins_to_nanos;

/// Replay runner operational-profile schema version.
pub const REPLAY_RUNNER_OPERATIONAL_PROFILE_SCHEMA_VERSION_V1: u16 = 1;
const RUNNER_PROFILE_DIGEST_DOMAIN_V1: &[u8] =
    b"strategy-factory.replay-runner-operational-profile.v1\0";
const MAX_CANONICAL_BYTES_V1: usize = 64 * 1024;
const MAX_IDENTITY_BYTES_V1: usize = 256;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerEnvironmentV1 {
    Backtest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerSerializationEncodingV1 {
    Json,
    MsgPack,
    Capnp,
    Sbe,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerInstanceIdentityV1 {
    DeterministicFromRequest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerLogLevelV1 {
    Off,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerLogOverrideV1 {
    pub target: String,
    pub level: ReplayRunnerLogLevelV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerFileLoggingV1 {
    Disabled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerOptionalSubsystemV1 {
    Disabled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerBarAggregationV1 {
    Tick,
    TickImbalance,
    TickRuns,
    Volume,
    VolumeImbalance,
    VolumeRuns,
    Value,
    ValueImbalance,
    ValueRuns,
    Millisecond,
    Second,
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
    Renko,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerBarIntervalTypeV1 {
    LeftOpen,
    RightOpen,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayRunnerFloatOnlyIntervalV1 {
    Disabled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerLoggerConfigV1 {
    pub stdout_level: ReplayRunnerLogLevelV1,
    pub fileout_level: ReplayRunnerLogLevelV1,
    pub component_level: Vec<ReplayRunnerLogOverrideV1>,
    pub module_level: Vec<ReplayRunnerLogOverrideV1>,
    pub log_components_only: bool,
    pub is_colored: bool,
    pub print_config: bool,
    pub use_tracing: bool,
    pub bypass_logging: bool,
    pub file_config: ReplayRunnerFileLoggingV1,
    pub clear_log_file: bool,
    pub fileout_sync_on_flush: bool,
    pub buffered_stdout: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerCacheConfigV1 {
    pub encoding: ReplayRunnerSerializationEncodingV1,
    pub timestamps_as_iso8601: bool,
    pub buffer_interval_ms: Option<u64>,
    pub bulk_read_batch_size: Option<u64>,
    pub use_trader_prefix: bool,
    pub use_instance_id: bool,
    pub flush_on_start: bool,
    pub drop_instruments_on_reset: bool,
    pub tick_capacity: u64,
    pub bar_capacity: u64,
    pub persist_account_events: bool,
    pub save_market_data: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerMessageBusConfigV1 {
    pub encoding: ReplayRunnerSerializationEncodingV1,
    pub encoding_market_data: Option<ReplayRunnerSerializationEncodingV1>,
    pub encoding_builtin: Option<ReplayRunnerSerializationEncodingV1>,
    pub timestamps_as_iso8601: bool,
    pub buffer_interval_ms: Option<u32>,
    pub autotrim_mins: Option<u32>,
    pub autotrim_maxlen: Option<u32>,
    pub use_trader_prefix: bool,
    pub use_trader_id: bool,
    pub use_instance_id: bool,
    pub streams_prefix: String,
    pub stream_per_topic: bool,
    pub external_streams: Option<Vec<String>>,
    pub types_filter: Option<Vec<String>>,
    pub heartbeat_interval_secs: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerTimeBarOriginOffsetV1 {
    pub aggregation: ReplayRunnerBarAggregationV1,
    pub duration_ns: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerDataEngineConfigV1 {
    pub time_bars_build_with_no_updates: bool,
    pub time_bars_timestamp_on_close: bool,
    pub time_bars_skip_first_non_full_bar: bool,
    pub time_bars_interval_type: ReplayRunnerBarIntervalTypeV1,
    pub time_bars_build_delay: u64,
    pub time_bars_origin_offset: Vec<ReplayRunnerTimeBarOriginOffsetV1>,
    pub validate_data_sequence: bool,
    pub buffer_deltas: bool,
    pub emit_quotes_from_book: bool,
    pub emit_quotes_from_book_depths: bool,
    pub disable_historical_cache: bool,
    pub external_clients: Option<Vec<String>>,
    pub debug: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerRateLimitV1 {
    pub limit: u64,
    pub interval_ns: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerInstrumentNotionalLimitV1 {
    pub instrument_identity: String,
    pub mantissa: i128,
    pub scale: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerRiskEngineConfigV1 {
    pub bypass: bool,
    pub max_order_submit: ReplayRunnerRateLimitV1,
    pub max_order_modify: ReplayRunnerRateLimitV1,
    pub max_notional_per_order: Vec<ReplayRunnerInstrumentNotionalLimitV1>,
    pub debug: bool,
}

#[expect(
    clippy::struct_excessive_bools,
    reason = "fields mirror the native execution-engine configuration"
)]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerExecutionEngineConfigV1 {
    pub load_cache: bool,
    pub manage_own_order_books: bool,
    pub snapshot_orders: bool,
    pub snapshot_positions: bool,
    pub snapshot_positions_interval: ReplayRunnerFloatOnlyIntervalV1,
    pub carry_replay_events_on_reopen: bool,
    pub allow_overfills: bool,
    pub filter_unclaimed_external_orders: bool,
    pub external_clients: Option<Vec<String>>,
    pub purge_closed_orders_interval_mins: Option<u32>,
    pub purge_closed_orders_buffer_mins: Option<u32>,
    pub purge_closed_positions_interval_mins: Option<u32>,
    pub purge_closed_positions_buffer_mins: Option<u32>,
    pub purge_account_events_interval_mins: Option<u32>,
    pub purge_account_events_lookback_mins: Option<u32>,
    pub purge_from_database: bool,
    pub debug: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerPortfolioConfigV1 {
    pub use_mark_prices: bool,
    pub use_mark_xrates: bool,
    pub bar_updates: bool,
    pub convert_to_account_base_currency: bool,
    pub equity_curve: bool,
    pub min_account_state_logging_interval_ms: Option<u64>,
    pub snapshot_interval_ms: Option<u64>,
    pub debug: bool,
}

/// Every native Backtest engine operational field, with no default-bearing omission.
#[expect(
    clippy::struct_excessive_bools,
    reason = "fields mirror the native Backtest engine state and control switches"
)]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRunnerOperationalProfileInputV1 {
    pub schema_version: u16,
    pub environment: ReplayRunnerEnvironmentV1,
    pub trader_identity: String,
    pub load_state: bool,
    pub save_state: bool,
    pub shutdown_on_error: bool,
    pub logging: ReplayRunnerLoggerConfigV1,
    pub instance_identity: ReplayRunnerInstanceIdentityV1,
    pub timeout_connection_ns: u64,
    pub timeout_reconciliation_ns: u64,
    pub timeout_portfolio_ns: u64,
    pub timeout_disconnection_ns: u64,
    pub delay_post_stop_ns: u64,
    pub timeout_shutdown_ns: u64,
    pub cache: ReplayRunnerCacheConfigV1,
    pub message_bus: ReplayRunnerMessageBusConfigV1,
    pub data_engine: ReplayRunnerDataEngineConfigV1,
    pub risk_engine: ReplayRunnerRiskEngineConfigV1,
    pub execution_engine: ReplayRunnerExecutionEngineConfigV1,
    pub portfolio: ReplayRunnerPortfolioConfigV1,
    pub controller: ReplayRunnerOptionalSubsystemV1,
    pub streaming: ReplayRunnerOptionalSubsystemV1,
    pub bypass_logging: bool,
    pub run_analysis: bool,
}

/// Strict, content-addressed runner operational profile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayRunnerOperationalProfileV1 {
    input: ReplayRunnerOperationalProfileInputV1,
    canonical_bytes: Vec<u8>,
    digest: [u8; 32],
}

impl ReplayRunnerOperationalProfileV1 {
    /// Validates and seals a complete runner profile.
    pub fn seal(
        input: ReplayRunnerOperationalProfileInputV1,
    ) -> Result<Self, ReplayRunnerOperationalProfileErrorV1> {
        validate(&input)?;
        let canonical_bytes = serde_json::to_vec(&input)
            .map_err(|_| ReplayRunnerOperationalProfileErrorV1::CodecMismatch)?;
        if canonical_bytes.len() > MAX_CANONICAL_BYTES_V1 {
            return Err(ReplayRunnerOperationalProfileErrorV1::LengthOverflow);
        }
        Ok(Self {
            digest: digest(&canonical_bytes),
            input,
            canonical_bytes,
        })
    }

    /// Parses only the unique compact JSON encoding emitted by [`Self::seal`].
    pub fn parse_canonical(bytes: &[u8]) -> Result<Self, ReplayRunnerOperationalProfileErrorV1> {
        if bytes.len() > MAX_CANONICAL_BYTES_V1 {
            return Err(ReplayRunnerOperationalProfileErrorV1::LengthOverflow);
        }
        let input: ReplayRunnerOperationalProfileInputV1 = serde_json::from_slice(bytes)
            .map_err(|_| ReplayRunnerOperationalProfileErrorV1::CodecMismatch)?;
        let sealed = Self::seal(input)?;
        if sealed.canonical_bytes != bytes {
            return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonical);
        }
        Ok(sealed)
    }

    #[must_use]
    pub fn input(&self) -> &ReplayRunnerOperationalProfileInputV1 {
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
pub enum ReplayRunnerOperationalProfileErrorV1 {
    #[error("Replay runner operational profile schema is unsupported")]
    UnsupportedSchema,
    #[error("Replay runner operational identity is invalid")]
    InvalidIdentity,
    #[error("Replay runner timeout must be nonzero")]
    InvalidTimeout,
    #[error("Replay runner persistent state is unavailable in the isolated profile")]
    PersistentStateUnavailable,
    #[error("Replay runner logging binding mismatches")]
    LoggingMismatch,
    #[error("Replay runner nested native configuration is invalid")]
    InvalidConfiguration,
    #[error("Replay runner map-like fields are not in canonical unique order")]
    NonCanonicalOrder,
    #[error("Replay runner operational profile canonical bytes are too large")]
    LengthOverflow,
    #[error("Replay runner operational profile codec mismatch")]
    CodecMismatch,
    #[error("Replay runner operational profile bytes are not canonical")]
    NonCanonical,
}

fn validate(
    input: &ReplayRunnerOperationalProfileInputV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    if input.schema_version != REPLAY_RUNNER_OPERATIONAL_PROFILE_SCHEMA_VERSION_V1 {
        return Err(ReplayRunnerOperationalProfileErrorV1::UnsupportedSchema);
    }

    if input.trader_identity.is_empty()
        || input.trader_identity.len() > MAX_IDENTITY_BYTES_V1
        || !input.trader_identity.is_ascii()
        || input.trader_identity.trim() != input.trader_identity
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidIdentity);
    }

    if [
        input.timeout_connection_ns,
        input.timeout_reconciliation_ns,
        input.timeout_portfolio_ns,
        input.timeout_disconnection_ns,
        input.timeout_shutdown_ns,
    ]
    .contains(&0)
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidTimeout);
    }

    if input.load_state || input.save_state {
        return Err(ReplayRunnerOperationalProfileErrorV1::PersistentStateUnavailable);
    }

    if !input.bypass_logging
        || !input.logging.bypass_logging
        || input.logging.fileout_level != ReplayRunnerLogLevelV1::Off
        || input.logging.file_config != ReplayRunnerFileLoggingV1::Disabled
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::LoggingMismatch);
    }
    validate_overrides(&input.logging.component_level)?;
    validate_overrides(&input.logging.module_level)?;
    validate_cache(&input.cache)?;
    validate_message_bus(&input.message_bus)?;
    validate_data_engine(&input.data_engine)?;
    validate_risk_engine(&input.risk_engine)?;
    validate_execution_engine(&input.execution_engine)?;
    validate_portfolio(&input.portfolio)?;
    Ok(())
}

fn validate_cache(
    cache: &ReplayRunnerCacheConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    if cache.tick_capacity == 0
        || cache.bar_capacity == 0
        || cache.buffer_interval_ms == Some(0)
        || cache.bulk_read_batch_size == Some(0)
        || cache.drop_instruments_on_reset
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
    }
    Ok(())
}

fn validate_message_bus(
    message_bus: &ReplayRunnerMessageBusConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    if !supports_general_payloads(message_bus.encoding)
        || message_bus
            .encoding_builtin
            .is_some_and(|encoding| !supports_general_payloads(encoding))
        || message_bus.encoding_market_data == Some(message_bus.encoding)
        || message_bus.encoding_builtin == Some(message_bus.encoding)
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
    }
    validate_identity(&message_bus.streams_prefix)?;
    validate_optional_identity_list(&message_bus.external_streams)?;
    validate_optional_identity_list(&message_bus.types_filter)?;
    if message_bus.buffer_interval_ms == Some(0)
        || message_bus.autotrim_mins == Some(0)
        || message_bus.autotrim_maxlen == Some(0)
        || message_bus.heartbeat_interval_secs == Some(0)
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
    }
    Ok(())
}

const fn supports_general_payloads(encoding: ReplayRunnerSerializationEncodingV1) -> bool {
    matches!(
        encoding,
        ReplayRunnerSerializationEncodingV1::Json | ReplayRunnerSerializationEncodingV1::MsgPack
    )
}

fn validate_data_engine(
    data_engine: &ReplayRunnerDataEngineConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    for offset in &data_engine.time_bars_origin_offset {
        if offset.duration_ns == 0 || !is_time_aggregation(offset.aggregation) {
            return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
        }
    }

    for pair in data_engine.time_bars_origin_offset.windows(2) {
        if pair[0].aggregation >= pair[1].aggregation {
            return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder);
        }
    }
    validate_optional_identity_list(&data_engine.external_clients)
}

const fn is_time_aggregation(aggregation: ReplayRunnerBarAggregationV1) -> bool {
    matches!(
        aggregation,
        ReplayRunnerBarAggregationV1::Millisecond
            | ReplayRunnerBarAggregationV1::Second
            | ReplayRunnerBarAggregationV1::Minute
            | ReplayRunnerBarAggregationV1::Hour
            | ReplayRunnerBarAggregationV1::Day
            | ReplayRunnerBarAggregationV1::Week
            | ReplayRunnerBarAggregationV1::Month
            | ReplayRunnerBarAggregationV1::Year
    )
}

fn validate_risk_engine(
    risk_engine: &ReplayRunnerRiskEngineConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    for limit in [&risk_engine.max_order_submit, &risk_engine.max_order_modify] {
        if limit.limit == 0 || limit.interval_ns == 0 {
            return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
        }
    }

    for notional in &risk_engine.max_notional_per_order {
        validate_identity(&notional.instrument_identity)?;
        if notional.mantissa <= 0
            || notional.scale > 38
            || (notional.scale != 0 && notional.mantissa % 10 == 0)
        {
            return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
        }
    }

    for pair in risk_engine.max_notional_per_order.windows(2) {
        if pair[0].instrument_identity >= pair[1].instrument_identity {
            return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder);
        }
    }
    Ok(())
}

fn validate_execution_engine(
    execution_engine: &ReplayRunnerExecutionEngineConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    validate_optional_identity_list(&execution_engine.external_clients)?;

    for (interval_mins, retention_mins) in [
        (
            execution_engine.purge_closed_orders_interval_mins,
            execution_engine.purge_closed_orders_buffer_mins,
        ),
        (
            execution_engine.purge_closed_positions_interval_mins,
            execution_engine.purge_closed_positions_buffer_mins,
        ),
        (
            execution_engine.purge_account_events_interval_mins,
            execution_engine.purge_account_events_lookback_mins,
        ),
    ] {
        validate_purge_configuration(interval_mins, retention_mins)?;
    }
    Ok(())
}

fn validate_purge_configuration(
    interval_mins: Option<u32>,
    retention_mins: Option<u32>,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    match (interval_mins, retention_mins) {
        (None, None) => Ok(()),
        (Some(interval_mins @ 1..), Some(_))
            if checked_mins_to_nanos(u64::from(interval_mins)).is_some() =>
        {
            Ok(())
        }
        _ => Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration),
    }
}

fn validate_portfolio(
    portfolio: &ReplayRunnerPortfolioConfigV1,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    if portfolio.min_account_state_logging_interval_ms == Some(0)
        || portfolio.snapshot_interval_ms == Some(0)
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration);
    }
    Ok(())
}

fn validate_overrides(
    overrides: &[ReplayRunnerLogOverrideV1],
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    for value in overrides {
        validate_identity(&value.target)?;
    }

    for pair in overrides.windows(2) {
        if pair[0].target >= pair[1].target {
            return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder);
        }
    }
    Ok(())
}

fn validate_optional_identity_list(
    values: &Option<Vec<String>>,
) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    let Some(values) = values else {
        return Ok(());
    };

    if values.is_empty() {
        return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder);
    }

    for value in values {
        validate_identity(value)?;
    }

    for pair in values.windows(2) {
        if pair[0] >= pair[1] {
            return Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder);
        }
    }
    Ok(())
}

fn validate_identity(value: &str) -> Result<(), ReplayRunnerOperationalProfileErrorV1> {
    if value.is_empty()
        || value.len() > MAX_IDENTITY_BYTES_V1
        || !value.is_ascii()
        || value.trim() != value
    {
        return Err(ReplayRunnerOperationalProfileErrorV1::InvalidIdentity);
    }
    Ok(())
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RUNNER_PROFILE_DIGEST_DOMAIN_V1);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
pub(crate) fn runner_fixture() -> ReplayRunnerOperationalProfileInputV1 {
    ReplayRunnerOperationalProfileInputV1 {
        schema_version: 1,
        environment: ReplayRunnerEnvironmentV1::Backtest,
        trader_identity: "BACKTESTER-001".into(),
        load_state: false,
        save_state: false,
        shutdown_on_error: true,
        logging: ReplayRunnerLoggerConfigV1 {
            stdout_level: ReplayRunnerLogLevelV1::Off,
            fileout_level: ReplayRunnerLogLevelV1::Off,
            component_level: Vec::new(),
            module_level: Vec::new(),
            log_components_only: false,
            is_colored: false,
            print_config: false,
            use_tracing: false,
            bypass_logging: true,
            file_config: ReplayRunnerFileLoggingV1::Disabled,
            clear_log_file: false,
            fileout_sync_on_flush: false,
            buffered_stdout: false,
        },
        instance_identity: ReplayRunnerInstanceIdentityV1::DeterministicFromRequest,
        timeout_connection_ns: 60_000_000_000,
        timeout_reconciliation_ns: 30_000_000_000,
        timeout_portfolio_ns: 10_000_000_000,
        timeout_disconnection_ns: 10_000_000_000,
        delay_post_stop_ns: 10_000_000_000,
        timeout_shutdown_ns: 5_000_000_000,
        cache: ReplayRunnerCacheConfigV1 {
            encoding: ReplayRunnerSerializationEncodingV1::Json,
            timestamps_as_iso8601: false,
            buffer_interval_ms: None,
            bulk_read_batch_size: None,
            use_trader_prefix: true,
            use_instance_id: true,
            flush_on_start: true,
            drop_instruments_on_reset: false,
            tick_capacity: 10_000,
            bar_capacity: 10_000,
            persist_account_events: false,
            save_market_data: false,
        },
        message_bus: ReplayRunnerMessageBusConfigV1 {
            encoding: ReplayRunnerSerializationEncodingV1::Json,
            encoding_market_data: None,
            encoding_builtin: None,
            timestamps_as_iso8601: false,
            buffer_interval_ms: None,
            autotrim_mins: None,
            autotrim_maxlen: None,
            use_trader_prefix: true,
            use_trader_id: true,
            use_instance_id: true,
            streams_prefix: "stream".into(),
            stream_per_topic: true,
            external_streams: None,
            types_filter: None,
            heartbeat_interval_secs: None,
        },
        data_engine: ReplayRunnerDataEngineConfigV1 {
            time_bars_build_with_no_updates: false,
            time_bars_timestamp_on_close: true,
            time_bars_skip_first_non_full_bar: false,
            time_bars_interval_type: ReplayRunnerBarIntervalTypeV1::LeftOpen,
            time_bars_build_delay: 0,
            time_bars_origin_offset: Vec::new(),
            validate_data_sequence: true,
            buffer_deltas: false,
            emit_quotes_from_book: false,
            emit_quotes_from_book_depths: false,
            disable_historical_cache: true,
            external_clients: None,
            debug: false,
        },
        risk_engine: ReplayRunnerRiskEngineConfigV1 {
            bypass: false,
            max_order_submit: ReplayRunnerRateLimitV1 {
                limit: 100,
                interval_ns: 1_000_000_000,
            },
            max_order_modify: ReplayRunnerRateLimitV1 {
                limit: 100,
                interval_ns: 1_000_000_000,
            },
            max_notional_per_order: Vec::new(),
            debug: false,
        },
        execution_engine: ReplayRunnerExecutionEngineConfigV1 {
            load_cache: false,
            manage_own_order_books: false,
            snapshot_orders: false,
            snapshot_positions: false,
            snapshot_positions_interval: ReplayRunnerFloatOnlyIntervalV1::Disabled,
            carry_replay_events_on_reopen: false,
            allow_overfills: false,
            filter_unclaimed_external_orders: false,
            external_clients: None,
            purge_closed_orders_interval_mins: None,
            purge_closed_orders_buffer_mins: None,
            purge_closed_positions_interval_mins: None,
            purge_closed_positions_buffer_mins: None,
            purge_account_events_interval_mins: None,
            purge_account_events_lookback_mins: None,
            purge_from_database: false,
            debug: false,
        },
        portfolio: ReplayRunnerPortfolioConfigV1 {
            use_mark_prices: true,
            use_mark_xrates: false,
            bar_updates: false,
            convert_to_account_base_currency: true,
            equity_curve: true,
            min_account_state_logging_interval_ms: None,
            snapshot_interval_ms: None,
            debug: false,
        },
        controller: ReplayRunnerOptionalSubsystemV1::Disabled,
        streaming: ReplayRunnerOptionalSubsystemV1::Disabled,
        bypass_logging: true,
        run_analysis: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn canonical_round_trip_is_byte_exact_and_digest_stable() {
        let sealed = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let reparsed =
            ReplayRunnerOperationalProfileV1::parse_canonical(sealed.canonical_bytes()).unwrap();
        assert_eq!(reparsed, sealed);
        assert_eq!(reparsed.digest(), sealed.digest());
    }

    #[rstest]
    fn whitespace_reordering_unknown_fields_and_float_timeouts_are_rejected() {
        let sealed = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let pretty = serde_json::to_string_pretty(sealed.input()).unwrap();
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(pretty.as_bytes()),
            Err(ReplayRunnerOperationalProfileErrorV1::NonCanonical)
        );

        let mut unknown = serde_json::to_value(sealed.input()).unwrap();
        unknown["unknown"] = serde_json::Value::Null;
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(
                serde_json::to_vec(&unknown).unwrap().as_slice()
            ),
            Err(ReplayRunnerOperationalProfileErrorV1::CodecMismatch)
        );

        let mut missing = serde_json::to_value(sealed.input()).unwrap();
        missing.as_object_mut().unwrap().remove("cache");
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(
                serde_json::to_vec(&missing).unwrap().as_slice()
            ),
            Err(ReplayRunnerOperationalProfileErrorV1::CodecMismatch)
        );

        let mut missing_nested = serde_json::to_value(sealed.input()).unwrap();
        missing_nested["risk_engine"]
            .as_object_mut()
            .unwrap()
            .remove("max_order_modify");
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(
                serde_json::to_vec(&missing_nested).unwrap().as_slice()
            ),
            Err(ReplayRunnerOperationalProfileErrorV1::CodecMismatch)
        );

        let floating = String::from_utf8(sealed.canonical_bytes().to_vec())
            .unwrap()
            .replace("60000000000", "60000000000.0");
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(floating.as_bytes()),
            Err(ReplayRunnerOperationalProfileErrorV1::CodecMismatch)
        );
    }

    #[rstest]
    fn persistent_state_and_implicit_logging_are_unavailable() {
        let mut state = runner_fixture();
        state.load_state = true;
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(state),
            Err(ReplayRunnerOperationalProfileErrorV1::PersistentStateUnavailable)
        );

        let mut logging = runner_fixture();
        logging.bypass_logging = false;
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(logging),
            Err(ReplayRunnerOperationalProfileErrorV1::LoggingMismatch)
        );
    }

    #[rstest]
    fn distinct_cache_and_risk_settings_have_distinct_bytes_and_digests() {
        let baseline = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();

        let mut changed_cache = runner_fixture();
        changed_cache.cache.tick_capacity += 1;
        let changed_cache = ReplayRunnerOperationalProfileV1::seal(changed_cache).unwrap();

        let mut changed_risk = runner_fixture();
        changed_risk.risk_engine.max_order_submit.limit += 1;
        let changed_risk = ReplayRunnerOperationalProfileV1::seal(changed_risk).unwrap();

        assert_ne!(baseline.canonical_bytes(), changed_cache.canonical_bytes());
        assert_ne!(baseline.digest(), changed_cache.digest());
        assert_ne!(baseline.canonical_bytes(), changed_risk.canonical_bytes());
        assert_ne!(baseline.digest(), changed_risk.digest());
        assert_ne!(changed_cache.digest(), changed_risk.digest());
    }

    #[rstest]
    fn engine_forced_cache_rejects_before_sealing() {
        let mut cache = runner_fixture();
        cache.cache.drop_instruments_on_reset = true;
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(cache),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );
    }

    #[rstest]
    #[case(ReplayRunnerSerializationEncodingV1::Capnp)]
    #[case(ReplayRunnerSerializationEncodingV1::Sbe)]
    fn custom_and_builtin_payloads_reject_unsupported_encoding(
        #[case] encoding: ReplayRunnerSerializationEncodingV1,
    ) {
        let mut default_encoding = runner_fixture();
        default_encoding.message_bus.encoding = encoding;
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(default_encoding),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );

        let mut builtin_encoding = runner_fixture();
        builtin_encoding.message_bus.encoding_builtin = Some(encoding);
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(builtin_encoding),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );
    }

    #[rstest]
    #[case(
        ReplayRunnerSerializationEncodingV1::Json,
        ReplayRunnerSerializationEncodingV1::MsgPack
    )]
    #[case(
        ReplayRunnerSerializationEncodingV1::MsgPack,
        ReplayRunnerSerializationEncodingV1::Json
    )]
    fn distinct_category_overrides_accept_supported_encoding(
        #[case] default_encoding: ReplayRunnerSerializationEncodingV1,
        #[case] override_encoding: ReplayRunnerSerializationEncodingV1,
    ) {
        let mut input = runner_fixture();
        input.message_bus.encoding = default_encoding;
        input.message_bus.encoding_market_data = Some(override_encoding);
        input.message_bus.encoding_builtin = Some(override_encoding);
        assert!(ReplayRunnerOperationalProfileV1::seal(input).is_ok());
    }

    #[rstest]
    fn category_overrides_equal_to_default_are_noncanonical() {
        let redundant_overrides: [fn(&mut ReplayRunnerMessageBusConfigV1); 2] = [
            |message_bus| message_bus.encoding_market_data = Some(message_bus.encoding),
            |message_bus| message_bus.encoding_builtin = Some(message_bus.encoding),
        ];

        for apply_override in redundant_overrides {
            let mut input = runner_fixture();
            apply_override(&mut input.message_bus);
            assert_eq!(
                ReplayRunnerOperationalProfileV1::seal(input),
                Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
            );
        }
    }

    #[rstest]
    fn optional_identity_lists_reject_every_explicit_empty_representation() {
        let explicit_empty_lists: [fn(&mut ReplayRunnerOperationalProfileInputV1); 4] = [
            |input| input.message_bus.external_streams = Some(Vec::new()),
            |input| input.message_bus.types_filter = Some(Vec::new()),
            |input| input.data_engine.external_clients = Some(Vec::new()),
            |input| input.execution_engine.external_clients = Some(Vec::new()),
        ];

        for configure in explicit_empty_lists {
            let mut input = runner_fixture();
            configure(&mut input);
            assert_eq!(
                ReplayRunnerOperationalProfileV1::seal(input),
                Err(ReplayRunnerOperationalProfileErrorV1::NonCanonicalOrder)
            );
        }
    }

    #[rstest]
    fn optional_identity_lists_accept_sorted_unique_nonempty_values() {
        let mut input = runner_fixture();
        input.message_bus.external_streams = Some(vec!["stream-a".into(), "stream-b".into()]);
        input.message_bus.types_filter = Some(vec!["type-a".into(), "type-b".into()]);
        input.data_engine.external_clients =
            Some(vec!["data-client-a".into(), "data-client-b".into()]);
        input.execution_engine.external_clients =
            Some(vec!["exec-client-a".into(), "exec-client-b".into()]);
        let sealed = ReplayRunnerOperationalProfileV1::seal(input).unwrap();
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(sealed.canonical_bytes()),
            Ok(sealed)
        );
    }

    #[rstest]
    #[case(ReplayRunnerBarAggregationV1::Tick, 1)]
    #[case(ReplayRunnerBarAggregationV1::Minute, 0)]
    fn ignored_or_zero_time_bar_origin_offsets_are_rejected(
        #[case] aggregation: ReplayRunnerBarAggregationV1,
        #[case] duration_ns: u64,
    ) {
        let mut input = runner_fixture();
        input.data_engine.time_bars_origin_offset = vec![ReplayRunnerTimeBarOriginOffsetV1 {
            aggregation,
            duration_ns,
        }];
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(input),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );
    }

    #[rstest]
    fn distinct_positive_minute_origin_offsets_have_distinct_seals() {
        let mut one_second = runner_fixture();
        one_second.data_engine.time_bars_origin_offset = vec![ReplayRunnerTimeBarOriginOffsetV1 {
            aggregation: ReplayRunnerBarAggregationV1::Minute,
            duration_ns: 1_000_000_000,
        }];
        let one_second = ReplayRunnerOperationalProfileV1::seal(one_second).unwrap();

        let mut two_seconds = runner_fixture();
        two_seconds.data_engine.time_bars_origin_offset = vec![ReplayRunnerTimeBarOriginOffsetV1 {
            aggregation: ReplayRunnerBarAggregationV1::Minute,
            duration_ns: 2_000_000_000,
        }];
        let two_seconds = ReplayRunnerOperationalProfileV1::seal(two_seconds).unwrap();

        assert_ne!(one_second.canonical_bytes(), two_seconds.canonical_bytes());
        assert_ne!(one_second.digest(), two_seconds.digest());
    }

    #[rstest]
    #[case(Some(1), None)]
    #[case(None, Some(0))]
    #[case(Some(0), Some(0))]
    fn purge_configuration_rejects_implicit_or_zero_equivalent_forms(
        #[case] interval_mins: Option<u32>,
        #[case] retention_mins: Option<u32>,
    ) {
        assert_eq!(
            validate_purge_configuration(interval_mins, retention_mins),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );
    }

    #[rstest]
    fn enabled_purge_configuration_accepts_explicit_zero_retention() {
        let disabled = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let mut input = runner_fixture();
        input.execution_engine.purge_closed_orders_interval_mins = Some(1);
        input.execution_engine.purge_closed_orders_buffer_mins = Some(0);
        input.execution_engine.purge_closed_positions_interval_mins = Some(1);
        input.execution_engine.purge_closed_positions_buffer_mins = Some(0);
        input.execution_engine.purge_account_events_interval_mins = Some(1);
        input.execution_engine.purge_account_events_lookback_mins = Some(0);
        let enabled = ReplayRunnerOperationalProfileV1::seal(input).unwrap();
        assert_ne!(enabled.canonical_bytes(), disabled.canonical_bytes());
        assert_ne!(enabled.digest(), disabled.digest());
    }

    #[rstest]
    fn purge_interval_exceeding_native_nanosecond_bound_is_rejected() {
        let mut input = runner_fixture();
        input.execution_engine.purge_closed_orders_interval_mins = Some(u32::MAX);
        input.execution_engine.purge_closed_orders_buffer_mins = Some(0);
        assert_eq!(
            ReplayRunnerOperationalProfileV1::seal(input),
            Err(ReplayRunnerOperationalProfileErrorV1::InvalidConfiguration)
        );
    }
}
