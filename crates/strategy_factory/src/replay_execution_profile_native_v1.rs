//! Version-bound native materialization for the sealed EVENT Replay execution profile.
//!
//! The materializer consumes the move-only profile binding and returns an opaque capability. The
//! capability is the only path to construct a Backtest engine from these seals: it rechecks the
//! native instrument against the Instrument Owner terms before registering either the simulated
//! venue or instrument.

use std::{collections::HashMap, str::FromStr, time::Duration};

use ahash::AHashMap;
use rust_decimal::Decimal;
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_MEMBER_COUNT;
use thiserror::Error;
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_common::{
    cache::CacheConfig,
    enums::{Environment, LogLevel, SerializationEncoding},
    logging::{logger::LoggerConfig, map_log_level_to_filter},
    msgbus::config::MessageBusConfig,
    throttler::RateLimit,
};
use vibe_core::UUID4;
use vibe_data::engine::config::DataEngineConfig;
use vibe_execution::{
    engine::config::ExecutionEngineConfig,
    models::{
        fee::{FeeModelHandle, MakerTakerFeeModel},
        fill::{DefaultFillModel, FillModelHandle},
    },
};
use vibe_model::{
    accounts::margin_model::{MarginModelAny, StandardMarginModel},
    data::Data,
    enums::{AccountType, BarAggregation, BarIntervalType, BookType, OmsType},
    identifiers::{AccountId, ClientId, InstrumentId, Symbol, TraderId, Venue},
    instruments::{Instrument, InstrumentAny},
    types::{Currency, Money, Price},
};
use vibe_portfolio::config::PortfolioConfig;
use vibe_risk::engine::config::RiskEngineConfig;

#[cfg(test)]
use vibe_model::data::BarType;

use crate::{
    replay_economic_configuration_v1::{
        DisabledEconomicModelV1, ReplayAccountTypeV1, ReplayBookTypeV1,
        ReplayEconomicConfigurationV1, ReplayFeeModelV1, ReplayFillModelV1, ReplayFixedDecimalV1,
        ReplayInputKindV1, ReplayLiquidationPolicyV1, ReplayMarginModelV1, ReplayOmsTypeV1,
        ReplaySettlementPricesV1, ReplaySimulationModulesV1, ReplayVenueCensusV1,
    },
    replay_execution_profile_binding_v1::{
        BoundInstrumentEconomicTermsV1, InstrumentMarginModelSelectionV1,
        ReplayExecutionProfileBindingV1,
    },
    replay_runner_operational_profile_v1::{
        ReplayRunnerBarAggregationV1, ReplayRunnerBarIntervalTypeV1, ReplayRunnerFileLoggingV1,
        ReplayRunnerFloatOnlyIntervalV1, ReplayRunnerInstanceIdentityV1, ReplayRunnerLogLevelV1,
        ReplayRunnerOperationalProfileV1, ReplayRunnerOptionalSubsystemV1,
        ReplayRunnerSerializationEncodingV1,
    },
};

/// Exact native layout and inactive-float contract implemented by this adapter.
pub const REPLAY_NATIVE_ENGINE_PROFILE_ID_V1: &str =
    "vibe-backtest/0.62.0:replay-event-execution-profile-v1";
const EXPECTED_NATIVE_WORKSPACE_VERSION_V1: &str = "0.62.0";
const MATERIALIZATION_DIGEST_DOMAIN_V1: &[u8] =
    b"strategy-factory.replay-native-execution-profile.v1\0";
const INSTANCE_UUID_DOMAIN_V1: &[u8] = b"strategy-factory.replay-instance-uuid.v1\0";
const FILL_SEED_DOMAIN_V1: &[u8] = b"strategy-factory.replay-fill-seed.v1\0";

/// The native field is validated even while liquidation is disabled. This version-specific value
/// lives outside sealed policy meaning and cannot be selected by a caller, environment, or default.
const NATIVE_DISABLED_LIQUIDATION_TRIGGER_RATIO_V1: f64 = 1.0;
const NATIVE_FULL_FILL_PROBABILITY_V1: f64 = 1.0;
const NATIVE_DISABLED_SLIPPAGE_PROBABILITY_V1: f64 = 0.0;

/// Move-only native materialization capability for one exact request/profile/Owner binding.
///
/// Native configs remain private so a consumer cannot register a different instrument before the
/// Owner terms check. [`Self::into_backtest_engine`] is the only extraction path.
pub(crate) struct ReplayNativeExecutionProfileV1 {
    engine_config: BacktestEngineConfig,
    venue_config: SimulatedVenueConfig,
    instrument_ids: [InstrumentId; TARGET_SET_MEMBER_COUNT],
    instrument_terms: [BoundInstrumentEconomicTermsV1; TARGET_SET_MEMBER_COUNT],
    materialization_digest: [u8; 32],
    fill_seed: u64,
    instance_id: UUID4,
}

impl ReplayNativeExecutionProfileV1 {
    /// Content identity available for downstream actual-consumption evidence.
    #[must_use]
    pub(crate) const fn materialization_digest(&self) -> [u8; 32] {
        self.materialization_digest
    }

    #[must_use]
    pub(crate) const fn instance_id(&self) -> UUID4 {
        self.instance_id
    }

    #[must_use]
    pub(crate) const fn deterministic_fill_seed(&self) -> u64 {
        self.fill_seed
    }

    /// Rechecks the supplied native instrument against Owner-derived exact terms, then constructs
    /// the engine and registers the one venue and instrument.
    ///
    /// # Errors
    ///
    /// Returns before a Backtest engine exists when the instrument identity, quote currency, fee,
    /// or margin terms differ. Native configuration or engine registration errors also fail closed.
    pub(crate) fn into_backtest_engine(
        self,
        instruments: &[InstrumentAny; TARGET_SET_MEMBER_COUNT],
    ) -> Result<BacktestEngine, ReplayNativeExecutionProfileErrorV1> {
        self.validate_target_set(instruments)?;
        self.validate_account_scope()?;
        let mut engine = BacktestEngine::new(self.engine_config)
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;
        engine
            .add_venue(self.venue_config)
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;
        for instrument in instruments {
            engine
                .add_instrument(instrument)
                .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;
        }
        Ok(engine)
    }

    pub(crate) fn validate_target_set(
        &self,
        instruments: &[InstrumentAny; TARGET_SET_MEMBER_COUNT],
    ) -> Result<(), ReplayNativeExecutionProfileErrorV1> {
        if instruments[0].id() >= instruments[1].id()
            || instruments.each_ref().map(|instrument| instrument.id()) != self.instrument_ids
        {
            return Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch);
        }
        for (instrument, terms) in instruments.iter().zip(&self.instrument_terms) {
            self.validate_instrument(instrument, terms)?;
        }
        Ok(())
    }

    fn validate_instrument(
        &self,
        instrument: &InstrumentAny,
        terms: &BoundInstrumentEconomicTermsV1,
    ) -> Result<(), ReplayNativeExecutionProfileErrorV1> {
        let quote_currency = native_currency(&terms.quote_currency)?;
        let maker_fee = native_decimal(terms.maker_fee)?;
        let taker_fee = native_decimal(terms.taker_fee)?;
        let initial_margin = native_decimal(terms.initial_margin)?;
        let maintenance_margin = native_decimal(terms.maintenance_margin)?;
        if instrument.id().to_string()
            != format!("{}.{}", terms.instrument_identity, terms.venue_identity)
            || instrument.quote_currency() != quote_currency
            || instrument.maker_fee() != maker_fee
            || instrument.taker_fee() != taker_fee
            || instrument.margin_init() != initial_margin
            || instrument.margin_maint() != maintenance_margin
        {
            return Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch);
        }
        Ok(())
    }

    pub(crate) fn validate_account_scope(&self) -> Result<(), ReplayNativeExecutionProfileErrorV1> {
        let expected = format!("{}-001", self.venue_config.venue);
        if self
            .instrument_terms
            .iter()
            .any(|terms| terms.account_scope_identity != expected)
        {
            return Err(ReplayNativeExecutionProfileErrorV1::AccountScopeMismatch);
        }
        Ok(())
    }

    pub(crate) fn validate_data(
        &self,
        data: &[Data],
    ) -> Result<(), ReplayNativeExecutionProfileErrorV1> {
        let mut signal_time = [None; TARGET_SET_MEMBER_COUNT];
        let mut event_time = [None; TARGET_SET_MEMBER_COUNT];
        for datum in data {
            let instrument_id = datum.instrument_id();
            let ordinal = self
                .instrument_ids
                .iter()
                .position(|expected| *expected == instrument_id)
                .ok_or(ReplayNativeExecutionProfileErrorV1::EventInputMismatch)?;
            let ts_event = data_event_time_ns(datum)?;
            let terms = &self.instrument_terms[ordinal];
            if ts_event < terms.valid_from_ns || ts_event >= terms.valid_until_ns_exclusive {
                return Err(ReplayNativeExecutionProfileErrorV1::EventTimeOutsideOwnerValidity);
            }
            match datum {
                Data::Bar(_) => {
                    if signal_time[ordinal].replace(ts_event).is_some() {
                        return Err(ReplayNativeExecutionProfileErrorV1::EventInputMismatch);
                    }
                }
                Data::Delta(_)
                | Data::Deltas(_)
                | Data::Depth10(_)
                | Data::Quote(_)
                | Data::Trade(_) => {
                    event_time[ordinal] = Some(
                        event_time[ordinal].map_or(ts_event, |current: i128| current.max(ts_event)),
                    );
                }
                _ => return Err(ReplayNativeExecutionProfileErrorV1::EventInputMismatch),
            }
        }
        if signal_time
            .iter()
            .zip(event_time)
            .any(|(signal, event)| !matches!((*signal, event), (Some(signal), Some(event)) if event > signal))
        {
            return Err(ReplayNativeExecutionProfileErrorV1::EventInputMismatch);
        }
        Ok(())
    }

    pub(crate) fn account_scope_id(&self) -> AccountId {
        AccountId::from(format!("{}-001", self.venue_config.venue).as_str())
    }

    pub(crate) const fn instrument_terms(
        &self,
    ) -> &[BoundInstrumentEconomicTermsV1; TARGET_SET_MEMBER_COUNT] {
        &self.instrument_terms
    }
}

fn data_event_time_ns(data: &Data) -> Result<i128, ReplayNativeExecutionProfileErrorV1> {
    let value = match data {
        Data::Delta(value) => value.ts_event,
        Data::Deltas(value) => value.ts_event,
        Data::Depth10(value) => value.ts_event,
        Data::Quote(value) => value.ts_event,
        Data::Trade(value) => value.ts_event,
        Data::Bar(value) => value.ts_event,
        _ => return Err(ReplayNativeExecutionProfileErrorV1::EventInputMismatch),
    };
    Ok(i128::from(value.as_u64()))
}

/// Materializes both exact seals into native Backtest and Sim Exchange configuration.
///
/// # Errors
///
/// Fails before returning a capability for seal mismatch, native version drift, lossy fixed-point
/// conversion, invalid native identifiers or currencies, unsupported codecs, or invalid native
/// configuration.
pub(crate) fn materialize_event_replay_execution_profile_v1(
    binding: ReplayExecutionProfileBindingV1,
    economic: &ReplayEconomicConfigurationV1,
    runner: &ReplayRunnerOperationalProfileV1,
) -> Result<ReplayNativeExecutionProfileV1, ReplayNativeExecutionProfileErrorV1> {
    if env!("CARGO_PKG_VERSION") != EXPECTED_NATIVE_WORKSPACE_VERSION_V1 {
        return Err(ReplayNativeExecutionProfileErrorV1::NativeVersionMismatch);
    }
    if binding.economic_configuration_digest() != economic.digest()
        || binding.runner_operational_profile_digest() != runner.digest()
    {
        return Err(ReplayNativeExecutionProfileErrorV1::ProfileMismatch);
    }

    let economic_input = economic.input();
    let runner_input = runner.input();
    let venue = Venue::new_checked(&economic_input.venue_identity)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)?;
    let symbol = Symbol::new_checked(&economic_input.instrument_terms.instrument_identity)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)?;
    let instrument_id = InstrumentId::new(symbol, venue);
    let instrument_ids = binding.instrument_terms().each_ref().map(|terms| {
        Symbol::new_checked(&terms.instrument_identity)
            .map(|symbol| InstrumentId::new(symbol, venue))
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)
    });
    let [first, second] = instrument_ids;
    let instrument_ids = [first?, second?];
    if instrument_ids[0] >= instrument_ids[1] || !instrument_ids.contains(&instrument_id) {
        return Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch);
    }
    let starting_currency = native_currency(&economic_input.starting_balance_currency)?;
    let quote_currency = native_currency(&economic_input.common_quote_currency)?;
    if starting_currency != quote_currency {
        return Err(ReplayNativeExecutionProfileErrorV1::CurrencyMismatch);
    }
    let starting_balance = native_money(economic_input.starting_balance, starting_currency)?;
    let default_leverage = native_decimal(economic_input.default_leverage)?;
    let instrument_leverage = native_decimal(economic_input.instrument_leverage)?;

    let instance_id = deterministic_instance_id(&binding);
    let fill_seed = deterministic_fill_seed(&binding);
    let engine_config = materialize_engine_config(runner_input, instance_id)?;
    let fill_model = DefaultFillModel::new(
        NATIVE_FULL_FILL_PROBABILITY_V1,
        NATIVE_DISABLED_SLIPPAGE_PROBABILITY_V1,
        Some(fill_seed),
    )
    .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    // Exhaustive matches pin every closed semantic choice to one native implementation. None of
    // these matches invokes a native default or admits a caller-selected alternative.
    let ReplayInputKindV1::EventOnly = economic_input.input_kind;
    let ReplayVenueCensusV1::SingleVenue = economic_input.venue_census;
    let ReplayOmsTypeV1::Netting = economic_input.oms_type;
    let ReplayAccountTypeV1::Margin = economic_input.account_type;
    let ReplayBookTypeV1::L1Mbp = economic_input.book_type;
    let ReplaySimulationModulesV1::None = economic_input.modules;
    let ReplayFillModelV1::DeterministicFullFill = economic_input.fill_model;
    let ReplayFeeModelV1::SealedInstrumentTerms = economic_input.fee_model;
    let ReplayMarginModelV1::SealedInstrumentTerms = economic_input.margin_model;
    let DisabledEconomicModelV1::Disabled = economic_input.latency_model;
    let DisabledEconomicModelV1::Disabled = economic_input.slippage_model;
    let DisabledEconomicModelV1::Disabled = economic_input.capacity_model;
    let ReplaySettlementPricesV1::None = economic_input.settlement_prices;
    let ReplayLiquidationPolicyV1::Disabled = economic_input.liquidation_policy;

    let mut leverages = AHashMap::new();
    for member_id in instrument_ids {
        leverages.insert(member_id, instrument_leverage);
    }
    let venue_config = SimulatedVenueConfig::builder()
        .venue(venue)
        .oms_type(OmsType::Netting)
        .account_type(AccountType::Margin)
        .book_type(BookType::L1_MBP)
        .starting_balances(vec![starting_balance])
        .base_currency(quote_currency)
        .default_leverage(default_leverage)
        .leverages(leverages)
        .margin_model(MarginModelAny::Standard(StandardMarginModel))
        .modules(Vec::new())
        .fill_model(FillModelHandle::new(fill_model))
        .fee_model(FeeModelHandle::new(MakerTakerFeeModel))
        .maybe_latency_model(None)
        .routing(economic_input.routing)
        .reject_stop_orders(economic_input.reject_stop_orders)
        .support_gtd_orders(economic_input.support_gtd_orders)
        .support_contingent_orders(economic_input.support_contingent_orders)
        .use_position_ids(economic_input.use_position_ids)
        .use_random_ids(economic_input.use_random_ids)
        .use_reduce_only(economic_input.use_reduce_only)
        .use_message_queue(economic_input.use_message_queue)
        .use_market_order_acks(economic_input.use_market_order_acks)
        .bar_execution(economic_input.bar_execution)
        .trade_on_close(economic_input.trade_on_close)
        .bar_adaptive_high_low_ordering(economic_input.bar_adaptive_high_low_ordering)
        .trade_execution(economic_input.trade_execution)
        .liquidity_consumption(economic_input.liquidity_consumption)
        .allow_cash_borrowing(economic_input.allow_cash_borrowing)
        .frozen_account(economic_input.frozen_account)
        .queue_position(economic_input.queue_position)
        .oto_full_trigger(economic_input.oto_full_trigger)
        .price_protection_points(economic_input.price_protection_points)
        .settlement_prices(AHashMap::<InstrumentId, Price>::new())
        .liquidation_enabled(false)
        .liquidation_trigger_ratio(NATIVE_DISABLED_LIQUIDATION_TRIGGER_RATIO_V1)
        .liquidation_cancel_open_orders(economic_input.liquidation_cancel_open_orders)
        .build()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let instrument_terms = binding.instrument_terms();
    let Some(primary_terms) = instrument_terms.iter().find(|terms| {
        terms.instrument_identity == economic_input.instrument_terms.instrument_identity
    }) else {
        return Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch);
    };
    if primary_terms.venue_identity != economic_input.venue_identity
        || primary_terms.margin_model != InstrumentMarginModelSelectionV1::StandardMarginModel
        || primary_terms.maker_fee != economic_input.instrument_terms.maker_fee
        || primary_terms.taker_fee != economic_input.instrument_terms.taker_fee
        || primary_terms.initial_margin != economic_input.instrument_terms.initial_margin
        || primary_terms.maintenance_margin != economic_input.instrument_terms.maintenance_margin
    {
        return Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch);
    }
    let materialization_digest = materialization_digest(&binding, instrument_id, instance_id)?;
    let instrument_terms = binding.into_instrument_terms();

    Ok(ReplayNativeExecutionProfileV1 {
        engine_config,
        venue_config,
        instrument_ids,
        instrument_terms,
        materialization_digest,
        fill_seed,
        instance_id,
    })
}

fn materialize_engine_config(
    input: &crate::replay_runner_operational_profile_v1::ReplayRunnerOperationalProfileInputV1,
    instance_id: UUID4,
) -> Result<BacktestEngineConfig, ReplayNativeExecutionProfileErrorV1> {
    let trader_id = TraderId::new_checked(&input.trader_identity)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)?;
    let component_level = input
        .logging
        .component_level
        .iter()
        .map(|entry| (entry.target.as_str().into(), native_log_level(entry.level)))
        .collect();
    let module_level = input
        .logging
        .module_level
        .iter()
        .map(|entry| (entry.target.as_str().into(), native_log_level(entry.level)))
        .collect();
    let ReplayRunnerFileLoggingV1::Disabled = input.logging.file_config;
    let logging = LoggerConfig {
        stdout_level: native_log_level(input.logging.stdout_level),
        fileout_level: native_log_level(input.logging.fileout_level),
        component_level,
        module_level,
        log_components_only: input.logging.log_components_only,
        is_colored: input.logging.is_colored,
        print_config: input.logging.print_config,
        use_tracing: input.logging.use_tracing,
        bypass_logging: input.logging.bypass_logging,
        file_config: None,
        clear_log_file: input.logging.clear_log_file,
        fileout_sync_on_flush: input.logging.fileout_sync_on_flush,
        buffered_stdout: input.logging.buffered_stdout,
    };
    logging
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let cache = CacheConfig {
        encoding: native_encoding(input.cache.encoding),
        timestamps_as_iso8601: input.cache.timestamps_as_iso8601,
        buffer_interval_ms: optional_usize(input.cache.buffer_interval_ms)?,
        bulk_read_batch_size: optional_usize(input.cache.bulk_read_batch_size)?,
        use_trader_prefix: input.cache.use_trader_prefix,
        use_instance_id: input.cache.use_instance_id,
        flush_on_start: input.cache.flush_on_start,
        drop_instruments_on_reset: input.cache.drop_instruments_on_reset,
        tick_capacity: usize::try_from(input.cache.tick_capacity)
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::IntegerOverflow)?,
        bar_capacity: usize::try_from(input.cache.bar_capacity)
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::IntegerOverflow)?,
        persist_account_events: input.cache.persist_account_events,
        save_market_data: input.cache.save_market_data,
    };
    cache
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let msgbus = MessageBusConfig {
        encoding: native_encoding(input.message_bus.encoding),
        encoding_market_data: input.message_bus.encoding_market_data.map(native_encoding),
        encoding_builtin: input.message_bus.encoding_builtin.map(native_encoding),
        timestamps_as_iso8601: input.message_bus.timestamps_as_iso8601,
        buffer_interval_ms: input.message_bus.buffer_interval_ms,
        autotrim_mins: input.message_bus.autotrim_mins,
        autotrim_maxlen: input.message_bus.autotrim_maxlen,
        use_trader_prefix: input.message_bus.use_trader_prefix,
        use_trader_id: input.message_bus.use_trader_id,
        use_instance_id: input.message_bus.use_instance_id,
        streams_prefix: input.message_bus.streams_prefix.clone(),
        stream_per_topic: input.message_bus.stream_per_topic,
        external_streams: input.message_bus.external_streams.clone(),
        types_filter: input.message_bus.types_filter.clone(),
        heartbeat_interval_secs: input.message_bus.heartbeat_interval_secs,
    };
    msgbus
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let mut time_bars_origin_offset = HashMap::new();
    for offset in &input.data_engine.time_bars_origin_offset {
        if time_bars_origin_offset
            .insert(
                native_bar_aggregation(offset.aggregation),
                Duration::from_nanos(offset.duration_ns),
            )
            .is_some()
        {
            return Err(ReplayNativeExecutionProfileErrorV1::NativeConfiguration);
        }
    }
    let data_engine = DataEngineConfig {
        time_bars_build_with_no_updates: input.data_engine.time_bars_build_with_no_updates,
        time_bars_timestamp_on_close: input.data_engine.time_bars_timestamp_on_close,
        time_bars_skip_first_non_full_bar: input.data_engine.time_bars_skip_first_non_full_bar,
        time_bars_interval_type: native_bar_interval(input.data_engine.time_bars_interval_type),
        time_bars_build_delay: input.data_engine.time_bars_build_delay,
        time_bars_origin_offset,
        validate_data_sequence: input.data_engine.validate_data_sequence,
        buffer_deltas: input.data_engine.buffer_deltas,
        emit_quotes_from_book: input.data_engine.emit_quotes_from_book,
        emit_quotes_from_book_depths: input.data_engine.emit_quotes_from_book_depths,
        disable_historical_cache: input.data_engine.disable_historical_cache,
        external_clients: native_client_ids(&input.data_engine.external_clients)?,
        debug: input.data_engine.debug,
    };

    let mut max_notional_per_order = AHashMap::new();
    for limit in &input.risk_engine.max_notional_per_order {
        let instrument_id = InstrumentId::from_str(&limit.instrument_identity)
            .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)?;
        let value = native_decimal(ReplayFixedDecimalV1 {
            mantissa: limit.mantissa,
            scale: limit.scale,
        })?;
        if max_notional_per_order
            .insert(instrument_id, value)
            .is_some()
        {
            return Err(ReplayNativeExecutionProfileErrorV1::NativeConfiguration);
        }
    }
    let risk_engine = RiskEngineConfig {
        bypass: input.risk_engine.bypass,
        max_order_submit: native_rate_limit(&input.risk_engine.max_order_submit)?,
        max_order_modify: native_rate_limit(&input.risk_engine.max_order_modify)?,
        max_notional_per_order,
        debug: input.risk_engine.debug,
    };
    risk_engine
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let ReplayRunnerFloatOnlyIntervalV1::Disabled =
        input.execution_engine.snapshot_positions_interval;
    let execution_engine = ExecutionEngineConfig {
        load_cache: input.execution_engine.load_cache,
        manage_own_order_books: input.execution_engine.manage_own_order_books,
        snapshot_orders: input.execution_engine.snapshot_orders,
        snapshot_positions: input.execution_engine.snapshot_positions,
        snapshot_positions_interval_secs: None,
        carry_replay_events_on_reopen: input.execution_engine.carry_replay_events_on_reopen,
        allow_overfills: input.execution_engine.allow_overfills,
        filter_unclaimed_external_orders: input.execution_engine.filter_unclaimed_external_orders,
        external_clients: native_client_ids(&input.execution_engine.external_clients)?,
        purge_closed_orders_interval_mins: input.execution_engine.purge_closed_orders_interval_mins,
        purge_closed_orders_buffer_mins: input.execution_engine.purge_closed_orders_buffer_mins,
        purge_closed_positions_interval_mins: input
            .execution_engine
            .purge_closed_positions_interval_mins,
        purge_closed_positions_buffer_mins: input
            .execution_engine
            .purge_closed_positions_buffer_mins,
        purge_account_events_interval_mins: input
            .execution_engine
            .purge_account_events_interval_mins,
        purge_account_events_lookback_mins: input
            .execution_engine
            .purge_account_events_lookback_mins,
        purge_from_database: input.execution_engine.purge_from_database,
        debug: input.execution_engine.debug,
    };
    execution_engine
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let portfolio = PortfolioConfig {
        use_mark_prices: input.portfolio.use_mark_prices,
        use_mark_xrates: input.portfolio.use_mark_xrates,
        bar_updates: input.portfolio.bar_updates,
        convert_to_account_base_currency: input.portfolio.convert_to_account_base_currency,
        equity_curve: input.portfolio.equity_curve,
        min_account_state_logging_interval_ms: input
            .portfolio
            .min_account_state_logging_interval_ms,
        snapshot_interval_ms: input.portfolio.snapshot_interval_ms,
        debug: input.portfolio.debug,
    };
    portfolio
        .validate()
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)?;

    let ReplayRunnerOptionalSubsystemV1::Disabled = input.controller;
    let ReplayRunnerOptionalSubsystemV1::Disabled = input.streaming;
    let ReplayRunnerInstanceIdentityV1::DeterministicFromRequest = input.instance_identity;
    let crate::replay_runner_operational_profile_v1::ReplayRunnerEnvironmentV1::Backtest =
        input.environment;
    Ok(BacktestEngineConfig {
        environment: Environment::Backtest,
        trader_id,
        load_state: input.load_state,
        save_state: input.save_state,
        shutdown_on_error: input.shutdown_on_error,
        logging,
        instance_id: Some(instance_id),
        timeout_connection: Duration::from_nanos(input.timeout_connection_ns),
        timeout_reconciliation: Duration::from_nanos(input.timeout_reconciliation_ns),
        timeout_portfolio: Duration::from_nanos(input.timeout_portfolio_ns),
        timeout_disconnection: Duration::from_nanos(input.timeout_disconnection_ns),
        delay_post_stop: Duration::from_nanos(input.delay_post_stop_ns),
        timeout_shutdown: Duration::from_nanos(input.timeout_shutdown_ns),
        cache: Some(cache),
        msgbus: Some(msgbus),
        data_engine: Some(data_engine),
        risk_engine: Some(risk_engine),
        exec_engine: Some(execution_engine),
        portfolio: Some(portfolio),
        controller: None,
        streaming: None,
        bypass_logging: input.bypass_logging,
        run_analysis: input.run_analysis,
    })
}

fn native_encoding(value: ReplayRunnerSerializationEncodingV1) -> SerializationEncoding {
    match value {
        ReplayRunnerSerializationEncodingV1::Json => SerializationEncoding::Json,
        ReplayRunnerSerializationEncodingV1::MsgPack => SerializationEncoding::MsgPack,
        ReplayRunnerSerializationEncodingV1::Capnp => SerializationEncoding::Capnp,
        ReplayRunnerSerializationEncodingV1::Sbe => SerializationEncoding::Sbe,
    }
}

fn native_log_level(value: ReplayRunnerLogLevelV1) -> log::LevelFilter {
    let value = match value {
        ReplayRunnerLogLevelV1::Off => LogLevel::Off,
        ReplayRunnerLogLevelV1::Error => LogLevel::Error,
        ReplayRunnerLogLevelV1::Warn => LogLevel::Warning,
        ReplayRunnerLogLevelV1::Info => LogLevel::Info,
        ReplayRunnerLogLevelV1::Debug => LogLevel::Debug,
        ReplayRunnerLogLevelV1::Trace => LogLevel::Trace,
    };
    map_log_level_to_filter(value)
}

const fn native_bar_aggregation(value: ReplayRunnerBarAggregationV1) -> BarAggregation {
    match value {
        ReplayRunnerBarAggregationV1::Tick => BarAggregation::Tick,
        ReplayRunnerBarAggregationV1::TickImbalance => BarAggregation::TickImbalance,
        ReplayRunnerBarAggregationV1::TickRuns => BarAggregation::TickRuns,
        ReplayRunnerBarAggregationV1::Volume => BarAggregation::Volume,
        ReplayRunnerBarAggregationV1::VolumeImbalance => BarAggregation::VolumeImbalance,
        ReplayRunnerBarAggregationV1::VolumeRuns => BarAggregation::VolumeRuns,
        ReplayRunnerBarAggregationV1::Value => BarAggregation::Value,
        ReplayRunnerBarAggregationV1::ValueImbalance => BarAggregation::ValueImbalance,
        ReplayRunnerBarAggregationV1::ValueRuns => BarAggregation::ValueRuns,
        ReplayRunnerBarAggregationV1::Millisecond => BarAggregation::Millisecond,
        ReplayRunnerBarAggregationV1::Second => BarAggregation::Second,
        ReplayRunnerBarAggregationV1::Minute => BarAggregation::Minute,
        ReplayRunnerBarAggregationV1::Hour => BarAggregation::Hour,
        ReplayRunnerBarAggregationV1::Day => BarAggregation::Day,
        ReplayRunnerBarAggregationV1::Week => BarAggregation::Week,
        ReplayRunnerBarAggregationV1::Month => BarAggregation::Month,
        ReplayRunnerBarAggregationV1::Year => BarAggregation::Year,
        ReplayRunnerBarAggregationV1::Renko => BarAggregation::Renko,
    }
}

const fn native_bar_interval(value: ReplayRunnerBarIntervalTypeV1) -> BarIntervalType {
    match value {
        ReplayRunnerBarIntervalTypeV1::LeftOpen => BarIntervalType::LeftOpen,
        ReplayRunnerBarIntervalTypeV1::RightOpen => BarIntervalType::RightOpen,
    }
}

fn native_client_ids(
    values: &Option<Vec<String>>,
) -> Result<Option<Vec<ClientId>>, ReplayNativeExecutionProfileErrorV1> {
    values
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|value| {
                    ClientId::new_checked(value)
                        .map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidIdentifier)
                })
                .collect()
        })
        .transpose()
}

fn native_rate_limit(
    value: &crate::replay_runner_operational_profile_v1::ReplayRunnerRateLimitV1,
) -> Result<RateLimit, ReplayNativeExecutionProfileErrorV1> {
    let limit = usize::try_from(value.limit)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::IntegerOverflow)?;
    RateLimit::new_checked(limit, value.interval_ns)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::NativeConfiguration)
}

fn native_decimal(
    value: ReplayFixedDecimalV1,
) -> Result<Decimal, ReplayNativeExecutionProfileErrorV1> {
    Decimal::try_from_i128_with_scale(value.mantissa, u32::from(value.scale))
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::DecimalUnrepresentable)
}

fn native_money(
    value: ReplayFixedDecimalV1,
    currency: Currency,
) -> Result<Money, ReplayNativeExecutionProfileErrorV1> {
    let decimal = native_decimal(value)?;
    let money = Money::from_decimal(decimal, currency)
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::DecimalUnrepresentable)?;
    if money.as_decimal() != decimal {
        return Err(ReplayNativeExecutionProfileErrorV1::DecimalUnrepresentable);
    }
    Ok(money)
}

fn native_currency(value: &str) -> Result<Currency, ReplayNativeExecutionProfileErrorV1> {
    Currency::from_str(value).map_err(|_| ReplayNativeExecutionProfileErrorV1::InvalidCurrency)
}

fn optional_usize(
    value: Option<u64>,
) -> Result<Option<usize>, ReplayNativeExecutionProfileErrorV1> {
    value
        .map(|value| {
            usize::try_from(value).map_err(|_| ReplayNativeExecutionProfileErrorV1::IntegerOverflow)
        })
        .transpose()
}

fn deterministic_instance_id(binding: &ReplayExecutionProfileBindingV1) -> UUID4 {
    let mut hasher = Sha256::new();
    hasher.update(INSTANCE_UUID_DOMAIN_V1);
    hasher.update(binding.binding_digest());
    hasher.update(binding.request_meaning_digest());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    UUID4::from_bytes(bytes)
}

fn deterministic_fill_seed(binding: &ReplayExecutionProfileBindingV1) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(FILL_SEED_DOMAIN_V1);
    hasher.update(binding.binding_digest());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    u64::from_le_bytes(bytes)
}

fn materialization_digest(
    binding: &ReplayExecutionProfileBindingV1,
    instrument_id: InstrumentId,
    instance_id: UUID4,
) -> Result<[u8; 32], ReplayNativeExecutionProfileErrorV1> {
    let terms = binding.instrument_terms();
    let mut hasher = Sha256::new();
    hasher.update(MATERIALIZATION_DIGEST_DOMAIN_V1);
    hash_bytes(&mut hasher, REPLAY_NATIVE_ENGINE_PROFILE_ID_V1.as_bytes())?;
    hasher.update(binding.binding_digest());
    hasher.update(binding.economic_configuration_digest());
    hasher.update(binding.runner_operational_profile_digest());
    for terms in terms {
        hasher.update(terms.instrument_fact_digest);
        hasher.update(terms.instrument_receipt_digest);
        hasher.update(terms.terms_digest);
        hash_bytes(&mut hasher, terms.account_scope_identity.as_bytes())?;
        hasher.update(terms.event_time_ns.to_be_bytes());
        hasher.update(terms.valid_from_ns.to_be_bytes());
        hasher.update(terms.valid_until_ns_exclusive.to_be_bytes());
    }
    hash_bytes(&mut hasher, instrument_id.to_string().as_bytes())?;
    hasher.update(instance_id.as_bytes());
    Ok(hasher.finalize().into())
}

fn hash_bytes(
    hasher: &mut Sha256,
    value: &[u8],
) -> Result<(), ReplayNativeExecutionProfileErrorV1> {
    let length = u32::try_from(value.len())
        .map_err(|_| ReplayNativeExecutionProfileErrorV1::IntegerOverflow)?;
    hasher.update(length.to_le_bytes());
    hasher.update(value);
    Ok(())
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ReplayNativeExecutionProfileErrorV1 {
    #[error("Replay native execution profile is bound to a different engine version")]
    NativeVersionMismatch,
    #[error("Replay native execution profile seal binding mismatches")]
    ProfileMismatch,
    #[error("Replay native execution profile identifier is invalid")]
    InvalidIdentifier,
    #[error("Replay native execution profile currency is invalid")]
    InvalidCurrency,
    #[error("Replay native execution profile currency binding mismatches")]
    CurrencyMismatch,
    #[error("Replay native execution profile fixed decimal is not exactly representable")]
    DecimalUnrepresentable,
    #[error("Replay native execution profile integer conversion overflows")]
    IntegerOverflow,
    #[error("Replay native execution profile configuration is invalid")]
    NativeConfiguration,
    #[error("Replay native instrument does not match sealed Instrument Owner terms")]
    InstrumentTermsMismatch,
    #[error("Replay native venue account does not match sealed Instrument Owner scope")]
    AccountScopeMismatch,
    #[error(
        "Replay native market data does not provide BAR signal plus later EVENT execution input"
    )]
    EventInputMismatch,
    #[error("Replay native market data event is outside sealed Instrument Owner validity")]
    EventTimeOutsideOwnerValidity,
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use rstest::rstest;
    use vibe_execution::models::fill::FillModel;
    use vibe_model::{
        data::{Bar, BarSpecification, BookOrder, OrderBookDelta},
        enums::{AggregationSource, BookAction, OrderSide, PriceType},
        identifiers::{InstrumentId, Symbol},
        instruments::{InstrumentAny, stubs::crypto_perpetual_ethusdt},
        types::Quantity,
    };

    use super::*;
    use crate::{
        replay_economic_configuration_v1::{
            ReplayEconomicConfigurationV1, ReplayFixedDecimalV1, economic_fixture,
        },
        replay_execution_profile_binding_v1::{
            ReplayExecutionProfileFamilyBindingV1, ReplayExecutionProfileRequestBindingV1,
            bind_replay_execution_profiles_v1, instrument_terms_provenance_fixture_v1,
        },
        replay_runner_operational_profile_v1::{ReplayRunnerOperationalProfileV1, runner_fixture},
    };

    fn fixture_profiles() -> (
        ReplayEconomicConfigurationV1,
        ReplayRunnerOperationalProfileV1,
    ) {
        (
            ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap(),
            ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap(),
        )
    }

    fn fixture_binding(
        economic: &ReplayEconomicConfigurationV1,
        runner: &ReplayRunnerOperationalProfileV1,
        request_meaning_digest: [u8; 32],
    ) -> ReplayExecutionProfileBindingV1 {
        let family = ReplayExecutionProfileFamilyBindingV1 {
            schema_version: 1,
            trial_family_identity: "trial-family-1".into(),
            trial_family_digest: [3; 32],
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let request = ReplayExecutionProfileRequestBindingV1 {
            schema_version: 1,
            request_identity: "replay-request-1".into(),
            request_meaning_digest,
            trial_family_identity: family.trial_family_identity.clone(),
            trial_family_digest: family.trial_family_digest,
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        bind_replay_execution_profiles_v1(
            &family,
            &request,
            economic,
            runner,
            instrument_terms_provenance_fixture_v1(economic),
        )
        .unwrap()
    }

    fn matching_instruments() -> [InstrumentAny; TARGET_SET_MEMBER_COUNT] {
        let mut instrument = crypto_perpetual_ethusdt();
        instrument.id = InstrumentId::from("ETHUSDT-PERP.SIM");
        instrument.raw_symbol = Symbol::from("ETHUSDT-PERP");
        instrument.maker_fee = Decimal::new(2, 4);
        instrument.taker_fee = Decimal::new(4, 4);
        instrument.margin_init = Decimal::new(1, 1);
        instrument.margin_maint = Decimal::new(5, 2);
        let mut second = instrument.clone();
        second.id = InstrumentId::from("SOLUSDT-PERP.SIM");
        second.raw_symbol = Symbol::from("SOLUSDT-PERP");
        [
            InstrumentAny::CryptoPerpetual(instrument),
            InstrumentAny::CryptoPerpetual(second),
        ]
    }

    fn event_data(
        instruments: &[InstrumentAny; TARGET_SET_MEMBER_COUNT],
        event_time: u64,
    ) -> Vec<Data> {
        let bar_types = instruments.each_ref().map(|instrument| {
            BarType::new(
                instrument.id(),
                BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
                AggregationSource::External,
            )
        });
        let mut data = Vec::new();
        for (ordinal, (instrument, bar_type)) in instruments.iter().zip(bar_types).enumerate() {
            data.push(Data::Bar(Bar::new(
                bar_type,
                Price::from("100"),
                Price::from("101"),
                Price::from("99"),
                Price::from("100"),
                Quantity::from("10"),
                1_u64.into(),
                1_u64.into(),
            )));
            data.push(Data::Delta(OrderBookDelta::new(
                instrument.id(),
                BookAction::Add,
                BookOrder::new(
                    OrderSide::Sell,
                    Price::from("100"),
                    Quantity::from("10"),
                    ordinal as u64 + 1,
                ),
                0,
                ordinal as u64 + 1,
                event_time.into(),
                event_time.into(),
            )));
        }
        data
    }

    #[rstest]
    fn every_native_engine_and_venue_field_is_materialized_explicitly() {
        let (economic, runner) = fixture_profiles();
        let mut profile = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        let input = runner.input();
        let engine = &profile.engine_config;
        assert_eq!(engine.environment, Environment::Backtest);
        assert_eq!(engine.trader_id.as_str(), input.trader_identity);
        assert_eq!(engine.load_state, input.load_state);
        assert_eq!(engine.save_state, input.save_state);
        assert_eq!(engine.shutdown_on_error, input.shutdown_on_error);
        assert_eq!(engine.instance_id, Some(profile.instance_id));
        assert_eq!(
            engine.timeout_connection,
            Duration::from_nanos(input.timeout_connection_ns)
        );
        assert_eq!(
            engine.timeout_reconciliation,
            Duration::from_nanos(input.timeout_reconciliation_ns)
        );
        assert_eq!(
            engine.timeout_portfolio,
            Duration::from_nanos(input.timeout_portfolio_ns)
        );
        assert_eq!(
            engine.timeout_disconnection,
            Duration::from_nanos(input.timeout_disconnection_ns)
        );
        assert_eq!(
            engine.delay_post_stop,
            Duration::from_nanos(input.delay_post_stop_ns)
        );
        assert_eq!(
            engine.timeout_shutdown,
            Duration::from_nanos(input.timeout_shutdown_ns)
        );
        assert_eq!(engine.bypass_logging, input.bypass_logging);
        assert_eq!(engine.run_analysis, input.run_analysis);
        assert!(engine.controller.is_none());
        assert!(engine.streaming.is_none());

        let logging = &engine.logging;
        assert_eq!(
            logging.stdout_level,
            native_log_level(input.logging.stdout_level)
        );
        assert_eq!(
            logging.fileout_level,
            native_log_level(input.logging.fileout_level)
        );
        assert!(logging.component_level.is_empty());
        assert!(logging.module_level.is_empty());
        assert_eq!(
            logging.log_components_only,
            input.logging.log_components_only
        );
        assert_eq!(logging.is_colored, input.logging.is_colored);
        assert_eq!(logging.print_config, input.logging.print_config);
        assert_eq!(logging.use_tracing, input.logging.use_tracing);
        assert_eq!(logging.bypass_logging, input.logging.bypass_logging);
        assert!(logging.file_config.is_none());
        assert_eq!(logging.clear_log_file, input.logging.clear_log_file);
        assert_eq!(
            logging.fileout_sync_on_flush,
            input.logging.fileout_sync_on_flush
        );
        assert_eq!(logging.buffered_stdout, input.logging.buffered_stdout);

        let cache = engine.cache.as_ref().unwrap();
        assert_eq!(cache.encoding, native_encoding(input.cache.encoding));
        assert_eq!(
            cache.timestamps_as_iso8601,
            input.cache.timestamps_as_iso8601
        );
        assert_eq!(cache.buffer_interval_ms, None);
        assert_eq!(cache.bulk_read_batch_size, None);
        assert_eq!(cache.use_trader_prefix, input.cache.use_trader_prefix);
        assert_eq!(cache.use_instance_id, input.cache.use_instance_id);
        assert_eq!(cache.flush_on_start, input.cache.flush_on_start);
        assert_eq!(
            cache.drop_instruments_on_reset,
            input.cache.drop_instruments_on_reset
        );
        assert_eq!(cache.tick_capacity, input.cache.tick_capacity as usize);
        assert_eq!(cache.bar_capacity, input.cache.bar_capacity as usize);
        assert_eq!(
            cache.persist_account_events,
            input.cache.persist_account_events
        );
        assert_eq!(cache.save_market_data, input.cache.save_market_data);

        let msgbus = engine.msgbus.as_ref().unwrap();
        assert_eq!(msgbus.encoding, native_encoding(input.message_bus.encoding));
        assert_eq!(msgbus.encoding_market_data, None);
        assert_eq!(msgbus.encoding_builtin, None);
        assert_eq!(
            msgbus.timestamps_as_iso8601,
            input.message_bus.timestamps_as_iso8601
        );
        assert_eq!(
            msgbus.buffer_interval_ms,
            input.message_bus.buffer_interval_ms
        );
        assert_eq!(msgbus.autotrim_mins, input.message_bus.autotrim_mins);
        assert_eq!(msgbus.autotrim_maxlen, input.message_bus.autotrim_maxlen);
        assert_eq!(
            msgbus.use_trader_prefix,
            input.message_bus.use_trader_prefix
        );
        assert_eq!(msgbus.use_trader_id, input.message_bus.use_trader_id);
        assert_eq!(msgbus.use_instance_id, input.message_bus.use_instance_id);
        assert_eq!(msgbus.streams_prefix, input.message_bus.streams_prefix);
        assert_eq!(msgbus.stream_per_topic, input.message_bus.stream_per_topic);
        assert_eq!(msgbus.external_streams, input.message_bus.external_streams);
        assert_eq!(msgbus.types_filter, input.message_bus.types_filter);
        assert_eq!(
            msgbus.heartbeat_interval_secs,
            input.message_bus.heartbeat_interval_secs
        );

        let data = engine.data_engine.as_ref().unwrap();
        assert_eq!(
            data.time_bars_build_with_no_updates,
            input.data_engine.time_bars_build_with_no_updates
        );
        assert_eq!(
            data.time_bars_timestamp_on_close,
            input.data_engine.time_bars_timestamp_on_close
        );
        assert_eq!(
            data.time_bars_skip_first_non_full_bar,
            input.data_engine.time_bars_skip_first_non_full_bar
        );
        assert_eq!(
            data.time_bars_interval_type,
            native_bar_interval(input.data_engine.time_bars_interval_type)
        );
        assert_eq!(
            data.time_bars_build_delay,
            input.data_engine.time_bars_build_delay
        );
        assert!(data.time_bars_origin_offset.is_empty());
        assert_eq!(
            data.validate_data_sequence,
            input.data_engine.validate_data_sequence
        );
        assert_eq!(data.buffer_deltas, input.data_engine.buffer_deltas);
        assert_eq!(
            data.emit_quotes_from_book,
            input.data_engine.emit_quotes_from_book
        );
        assert_eq!(
            data.emit_quotes_from_book_depths,
            input.data_engine.emit_quotes_from_book_depths
        );
        assert_eq!(
            data.disable_historical_cache,
            input.data_engine.disable_historical_cache
        );
        assert!(data.external_clients.is_none());
        assert_eq!(data.debug, input.data_engine.debug);

        let risk = engine.risk_engine.as_ref().unwrap();
        assert_eq!(risk.bypass, input.risk_engine.bypass);
        assert_eq!(
            risk.max_order_submit.limit(),
            input.risk_engine.max_order_submit.limit as usize
        );
        assert_eq!(
            risk.max_order_submit.interval_ns(),
            input.risk_engine.max_order_submit.interval_ns
        );
        assert_eq!(
            risk.max_order_modify.limit(),
            input.risk_engine.max_order_modify.limit as usize
        );
        assert_eq!(
            risk.max_order_modify.interval_ns(),
            input.risk_engine.max_order_modify.interval_ns
        );
        assert!(risk.max_notional_per_order.is_empty());
        assert_eq!(risk.debug, input.risk_engine.debug);

        let execution = engine.exec_engine.as_ref().unwrap();
        assert_eq!(execution.load_cache, input.execution_engine.load_cache);
        assert_eq!(
            execution.manage_own_order_books,
            input.execution_engine.manage_own_order_books
        );
        assert_eq!(
            execution.snapshot_orders,
            input.execution_engine.snapshot_orders
        );
        assert_eq!(
            execution.snapshot_positions,
            input.execution_engine.snapshot_positions
        );
        assert!(execution.snapshot_positions_interval_secs.is_none());
        assert_eq!(
            execution.carry_replay_events_on_reopen,
            input.execution_engine.carry_replay_events_on_reopen
        );
        assert_eq!(
            execution.allow_overfills,
            input.execution_engine.allow_overfills
        );
        assert_eq!(
            execution.filter_unclaimed_external_orders,
            input.execution_engine.filter_unclaimed_external_orders
        );
        assert!(execution.external_clients.is_none());
        assert_eq!(
            execution.purge_closed_orders_interval_mins,
            input.execution_engine.purge_closed_orders_interval_mins
        );
        assert_eq!(
            execution.purge_closed_orders_buffer_mins,
            input.execution_engine.purge_closed_orders_buffer_mins
        );
        assert_eq!(
            execution.purge_closed_positions_interval_mins,
            input.execution_engine.purge_closed_positions_interval_mins
        );
        assert_eq!(
            execution.purge_closed_positions_buffer_mins,
            input.execution_engine.purge_closed_positions_buffer_mins
        );
        assert_eq!(
            execution.purge_account_events_interval_mins,
            input.execution_engine.purge_account_events_interval_mins
        );
        assert_eq!(
            execution.purge_account_events_lookback_mins,
            input.execution_engine.purge_account_events_lookback_mins
        );
        assert_eq!(
            execution.purge_from_database,
            input.execution_engine.purge_from_database
        );
        assert_eq!(execution.debug, input.execution_engine.debug);

        let portfolio = engine.portfolio.as_ref().unwrap();
        assert_eq!(portfolio.use_mark_prices, input.portfolio.use_mark_prices);
        assert_eq!(portfolio.use_mark_xrates, input.portfolio.use_mark_xrates);
        assert_eq!(portfolio.bar_updates, input.portfolio.bar_updates);
        assert_eq!(
            portfolio.convert_to_account_base_currency,
            input.portfolio.convert_to_account_base_currency
        );
        assert_eq!(portfolio.equity_curve, input.portfolio.equity_curve);
        assert_eq!(
            portfolio.min_account_state_logging_interval_ms,
            input.portfolio.min_account_state_logging_interval_ms
        );
        assert_eq!(
            portfolio.snapshot_interval_ms,
            input.portfolio.snapshot_interval_ms
        );
        assert_eq!(portfolio.debug, input.portfolio.debug);

        let venue = &mut profile.venue_config;
        assert_eq!(venue.venue, Venue::from("SIM"));
        assert_eq!(venue.oms_type, OmsType::Netting);
        assert_eq!(venue.account_type, AccountType::Margin);
        assert_eq!(venue.book_type, BookType::L1_MBP);
        assert_eq!(venue.starting_balances.len(), 1);
        assert_eq!(
            venue.starting_balances[0].as_decimal(),
            Decimal::from(100_000)
        );
        assert_eq!(venue.base_currency, Some(Currency::USDT()));
        assert_eq!(venue.default_leverage, Some(Decimal::from(10)));
        assert_eq!(
            venue.leverages.get(&InstrumentId::from("ETHUSDT-PERP.SIM")),
            Some(&Decimal::from(10))
        );
        assert!(matches!(
            venue.margin_model,
            Some(MarginModelAny::Standard(_))
        ));
        assert!(venue.modules.is_empty());
        assert!(venue.fill_model.is_limit_filled().unwrap());
        assert!(!venue.fill_model.is_slipped().unwrap());
        assert!(venue.latency_model.is_none());
        assert!(!venue.routing);
        assert!(venue.reject_stop_orders);
        assert!(venue.support_gtd_orders);
        assert!(venue.support_contingent_orders);
        assert!(venue.use_position_ids);
        assert!(!venue.use_random_ids);
        assert!(venue.use_reduce_only);
        assert!(venue.use_message_queue);
        assert!(!venue.use_market_order_acks);
        assert!(!venue.bar_execution);
        assert!(!venue.trade_on_close);
        assert!(!venue.bar_adaptive_high_low_ordering);
        assert!(!venue.trade_execution);
        assert!(!venue.liquidity_consumption);
        assert!(!venue.allow_cash_borrowing);
        assert!(!venue.frozen_account);
        assert!(!venue.queue_position);
        assert!(!venue.oto_full_trigger);
        assert_eq!(venue.price_protection_points, 0);
        assert!(venue.settlement_prices.is_empty());
        assert!(!venue.liquidation_enabled);
        assert_eq!(
            venue.liquidation_trigger_ratio,
            NATIVE_DISABLED_LIQUIDATION_TRIGGER_RATIO_V1
        );
        assert!(venue.liquidation_cancel_open_orders);
    }

    #[rstest]
    fn same_binding_is_deterministic_and_request_change_changes_native_identity() {
        let (economic, runner) = fixture_profiles();
        let first = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        let repeated = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        let changed = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [5; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        assert_eq!(first.instance_id(), repeated.instance_id());
        assert_eq!(
            first.deterministic_fill_seed(),
            repeated.deterministic_fill_seed()
        );
        assert_eq!(
            first.materialization_digest(),
            repeated.materialization_digest()
        );
        assert_ne!(first.instance_id(), changed.instance_id());
        assert_ne!(
            first.deterministic_fill_seed(),
            changed.deterministic_fill_seed()
        );
        assert_ne!(
            first.materialization_digest(),
            changed.materialization_digest()
        );
    }

    #[rstest]
    fn owner_terms_are_rechecked_before_native_engine_state_exists() {
        let (economic, runner) = fixture_profiles();
        let profile = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        assert!(
            profile
                .into_backtest_engine(&matching_instruments())
                .is_ok()
        );

        let profile = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        let mut wrong = matching_instruments();
        if let InstrumentAny::CryptoPerpetual(instrument) = &mut wrong[1] {
            instrument.maker_fee = Decimal::new(3, 4);
        }
        assert!(matches!(
            profile.into_backtest_engine(&wrong),
            Err(ReplayNativeExecutionProfileErrorV1::InstrumentTermsMismatch)
        ));
    }

    #[rstest]
    fn account_validity_and_bar_only_inputs_fail_before_engine_or_host_state() {
        let (economic, runner) = fixture_profiles();
        let mut wrong_account = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        wrong_account.instrument_terms[1].account_scope_identity = "OTHER-001".into();
        assert_eq!(
            wrong_account.validate_account_scope(),
            Err(ReplayNativeExecutionProfileErrorV1::AccountScopeMismatch)
        );

        let instruments = matching_instruments();
        let mut expired = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        expired.instrument_terms[1].valid_until_ns_exclusive = 2;
        assert_eq!(
            expired.validate_data(&event_data(&instruments, 2)),
            Err(ReplayNativeExecutionProfileErrorV1::EventTimeOutsideOwnerValidity)
        );

        let profile = materialize_event_replay_execution_profile_v1(
            fixture_binding(&economic, &runner, [4; 32]),
            &economic,
            &runner,
        )
        .unwrap();
        let bars_only = event_data(&instruments, 2)
            .into_iter()
            .filter(|data| matches!(data, Data::Bar(_)))
            .collect::<Vec<_>>();
        assert_eq!(
            profile.validate_data(&bars_only),
            Err(ReplayNativeExecutionProfileErrorV1::EventInputMismatch)
        );
    }

    #[rstest]
    fn unknown_currency_and_lossy_money_have_no_native_fallback() {
        let mut unknown = economic_fixture();
        unknown.starting_balance_currency = "ZZZ".into();
        unknown.common_quote_currency = "ZZZ".into();
        unknown.instrument_terms.quote_currency = "ZZZ".into();
        let unknown = ReplayEconomicConfigurationV1::seal(unknown).unwrap();
        let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        assert!(matches!(
            materialize_event_replay_execution_profile_v1(
                fixture_binding(&unknown, &runner, [4; 32]),
                &unknown,
                &runner,
            ),
            Err(ReplayNativeExecutionProfileErrorV1::InvalidCurrency)
        ));

        let mut lossy = economic_fixture();
        lossy.starting_balance = ReplayFixedDecimalV1 {
            mantissa: 1,
            scale: 9,
        };
        let lossy = ReplayEconomicConfigurationV1::seal(lossy).unwrap();
        assert!(matches!(
            materialize_event_replay_execution_profile_v1(
                fixture_binding(&lossy, &runner, [4; 32]),
                &lossy,
                &runner,
            ),
            Err(ReplayNativeExecutionProfileErrorV1::DecimalUnrepresentable)
        ));
    }

    #[rstest]
    fn cross_spliced_seal_cannot_materialize() {
        let (economic, runner) = fixture_profiles();
        let binding = fixture_binding(&economic, &runner, [4; 32]);
        let mut changed = runner_fixture();
        changed.risk_engine.max_order_submit.limit += 1;
        let changed = ReplayRunnerOperationalProfileV1::seal(changed).unwrap();
        assert!(matches!(
            materialize_event_replay_execution_profile_v1(binding, &economic, &changed),
            Err(ReplayNativeExecutionProfileErrorV1::ProfileMismatch)
        ));
    }
}
