use std::{cell::RefCell, collections::VecDeque, fmt::Debug, fs, path::Path, rc::Rc, str::FromStr};

use anyhow::Context;
use serde::Deserialize;
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
    result::CanonicalBacktestResult,
};
use vibe_binance::common::{
    enums::BinanceKlineInterval,
    offline::{
        BinanceVisionArchiveBinding, BinanceVisionTimestampUnit, authenticate_spot_monthly_klines,
    },
};
use vibe_common::{actor::DataActor, logging::logger::LoggerConfig};
use vibe_indicators::{
    average::ema::ExponentialMovingAverage,
    indicator::{Indicator, MovingAverage},
};
use vibe_model::{
    data::{Bar, BarType, Data, HasTsInit},
    enums::{AccountType, BookType, OmsType, OrderSide, PriceType, TimeInForce},
    identifiers::{InstrumentId, StrategyId, Venue},
    instruments::{Instrument, InstrumentAny, stubs::currency_pair_btcusdt},
    types::{Money, Quantity},
};
use vibe_trading::{
    strategy::{Strategy, StrategyConfig, StrategyCore},
    vibe_strategy,
};

use crate::{
    data::project_authenticated_zero_volume_observation,
    decision::{DecisionAction, DecisionInput, DecisionPhase, DecisionPosition},
    intent::{MISSING_OPEN_NS, ZERO_VOLUME_OPEN_NS},
    pilot::{PreparedPilot, prepare_frozen_pilot},
};

const MANIFEST_BYTES: &[u8] = include_bytes!("../assets/pilot_binance_manifest_v1.jcs");
const MANIFEST_ID: &str = "strategy-factory-pilot-binance-vision-manifest-v1";
const ARCHIVE_COUNT: usize = 24;
const MAX_ARCHIVE_BYTES: u64 = 1_048_576;
const MAX_SIDECAR_BYTES: u64 = 256;
const HOUR_NS: u64 = 3_600_000_000_000;
const CLOSED_HOUR_OFFSET_NS: u64 = HOUR_NS - 1_000_000;
const WARMUP_START_NS: u64 = 1_672_531_200_000_000_000;
const VALIDATION_START_NS: u64 = 1_704_067_200_000_000_000;
const VALIDATION_END_NS: u64 = 1_735_686_000_000_000_000;
const EXPECTED_WALL_SLOTS: usize = 17_544;
const EXPECTED_ACTUAL_EVENTS: usize = 17_543;
const EXPECTED_EXECUTABLE_BARS: usize = 17_542;
const BAR_TYPE: &str = "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL";
const STRATEGY_ID: &str = "STRATEGY-FACTORY-PILOT-001";

#[derive(Debug)]
pub struct PilotRun {
    canonical_result: CanonicalBacktestResult,
    source_manifest_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
}

impl PilotRun {
    pub const fn canonical_result(&self) -> &CanonicalBacktestResult {
        &self.canonical_result
    }

    pub const fn source_event_count(&self) -> usize {
        self.source_event_count
    }

    pub fn source_manifest_digest(&self) -> &str {
        &self.source_manifest_digest
    }

    pub const fn executable_bar_count(&self) -> usize {
        self.executable_bar_count
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveManifest {
    archives: Vec<ArchiveEntry>,
    identity: String,
    schema_version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveEntry {
    archive_sha256: String,
    name: String,
    sidecar_sha256: String,
}

#[derive(Debug)]
struct LoadedPilotData {
    data: Vec<Data>,
    execution_clock: Vec<ExecutionBar>,
    source_event_count: usize,
    executable_bar_count: usize,
}

#[derive(Debug)]
struct ExecutionBar {
    ts_event: u64,
    open: String,
}

/// Runs the one frozen pilot through the repository's existing native Backtest stack.
///
/// The cache root must contain the 24 exact Binance Vision archive/sidecar pairs named by the
/// embedded manifest. This function performs no network or production write.
pub fn run_frozen_pilot(cache_root: &Path) -> anyhow::Result<PilotRun> {
    let prepared = prepare_frozen_pilot()?;
    let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
    let bar_type = BarType::from_str(BAR_TYPE)?;
    let loaded = load_pilot_data(cache_root, &instrument, bar_type)?;

    execute_loaded_pilot(prepared, &instrument, bar_type, loaded)
}

fn execute_loaded_pilot(
    prepared: PreparedPilot,
    instrument: &InstrumentAny,
    bar_type: BarType,
    loaded: LoadedPilotData,
) -> anyhow::Result<PilotRun> {
    let callback_failure = Rc::new(RefCell::new(None));
    let trade_quantity = prepared.decision_contract().trade_quantity();
    let starting_balance = prepared.decision_contract().starting_balance();
    let trade_on_close = prepared
        .decision_contract()
        .mechanism()
        .execution()
        .trade_on_close();
    let strategy = FrozenPilotStrategy::new(
        prepared,
        instrument.id(),
        bar_type,
        trade_quantity,
        Rc::clone(&callback_failure),
    )?;
    execute_loaded_pilot_with_strategy(
        instrument,
        loaded,
        strategy,
        starting_balance,
        trade_on_close,
        &callback_failure,
    )
}

fn execute_loaded_pilot_with_strategy(
    instrument: &InstrumentAny,
    loaded: LoadedPilotData,
    strategy: FrozenPilotStrategy,
    starting_balance: Money,
    trade_on_close: bool,
    callback_failure: &Rc<RefCell<Option<String>>>,
) -> anyhow::Result<PilotRun> {
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        logging: LoggerConfig {
            bypass_logging: true,
            ..Default::default()
        },
        run_analysis: true,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("BINANCE"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Cash)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![starting_balance])
            .trade_on_close(trade_on_close)
            .build()?,
    )?;
    engine.add_instrument(instrument)?;
    engine.add_strategy(strategy)?;
    engine.add_data(loaded.data, None, true, true)?;
    engine.run(
        None,
        None,
        Some("strategy-factory-pilot-v1".to_string()),
        false,
    )?;

    if let Some(failure) = callback_failure.borrow().as_ref() {
        anyhow::bail!("frozen pilot strategy callback failed: {failure}");
    }
    let canonical_result = engine.get_canonical_result()?;
    validate_terminal_result(&canonical_result, &loaded.execution_clock)?;

    Ok(PilotRun {
        canonical_result,
        source_manifest_digest: format!("blake3:{}", blake3::hash(MANIFEST_BYTES).to_hex()),
        source_event_count: loaded.source_event_count,
        executable_bar_count: loaded.executable_bar_count,
    })
}

fn validate_terminal_result(
    result: &CanonicalBacktestResult,
    execution_clock: &[ExecutionBar],
) -> anyhow::Result<()> {
    let document = result.as_value();
    anyhow::ensure!(
        document
            .pointer("/run/outcome")
            .and_then(serde_json::Value::as_str)
            == Some("completed"),
        "frozen pilot Backtest did not complete"
    );
    let summary = document
        .get("summary")
        .and_then(serde_json::Value::as_object)
        .context("canonical result summary is missing")?;

    for key in ["orders.open", "orders.inflight", "positions.open"] {
        anyhow::ensure!(
            summary.get(key).and_then(serde_json::Value::as_str) == Some("0"),
            "frozen pilot terminal invariant failed: {key}"
        );
    }
    let orders = document
        .get("orders")
        .and_then(serde_json::Value::as_array)
        .context("canonical result orders are missing")?;
    anyhow::ensure!(
        !orders.is_empty() && orders.len().is_multiple_of(2),
        "frozen pilot must complete one or more round trips"
    );
    anyhow::ensure!(
        document
            .get("fills")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|fills| fills.len() == orders.len()),
        "frozen pilot canonical fill count does not match orders"
    );
    let mut validated = orders
        .iter()
        .map(|order| validate_filled_order(order, execution_clock))
        .collect::<anyhow::Result<Vec<_>>>()?;
    validated.sort_by_key(|order| order.signal_ts);
    anyhow::ensure!(
        validated
            .windows(2)
            .all(|pair| pair[0].signal_ts < pair[1].signal_ts),
        "frozen pilot order signals are duplicated or unordered"
    );

    for (index, pair) in validated.chunks_exact(2).enumerate() {
        anyhow::ensure!(
            pair[0].side == "BUY" && pair[1].side == "SELL",
            "round trip {index} does not alternate BUY/SELL"
        );
    }
    Ok(())
}

struct ValidatedOrder {
    side: String,
    signal_ts: u64,
}

fn validate_filled_order(
    order: &serde_json::Value,
    execution_clock: &[ExecutionBar],
) -> anyhow::Result<ValidatedOrder> {
    let core = order
        .get("Market")
        .and_then(|market| market.get("core"))
        .context("frozen pilot order is not a canonical Market order")?;
    anyhow::ensure!(
        core.get("status").and_then(serde_json::Value::as_str) == Some("FILLED"),
        "frozen pilot order is not FILLED"
    );
    let side = core
        .get("side")
        .and_then(serde_json::Value::as_str)
        .context("frozen pilot order side is missing")?;
    let events = core
        .get("events")
        .and_then(serde_json::Value::as_array)
        .context("frozen pilot order events are missing")?;
    let initialized = exactly_one_variant(events, "Initialized")?;
    let filled = exactly_one_variant(events, "Filled")?;
    let signal_ts = parse_canonical_u64(initialized, "ts_event")?;
    let fill_ts = parse_canonical_u64(filled, "ts_event")?;
    let signal_index = execution_clock
        .binary_search_by_key(&signal_ts, |bar| bar.ts_event)
        .map_err(|_| anyhow::anyhow!("order signal is not bound to an executable source Bar"))?;
    let next = execution_clock
        .get(signal_index + 1)
        .context("filled order has no next executable source Bar")?;
    anyhow::ensure!(
        fill_ts == next.ts_event,
        "order did not fill at the next executable source Bar"
    );
    anyhow::ensure!(
        filled.get("last_px").and_then(serde_json::Value::as_str) == Some(next.open.as_str()),
        "order did not fill at the next executable source Bar open"
    );
    let commission = filled
        .get("commission")
        .and_then(serde_json::Value::as_str)
        .context("filled order has no native commission")?;
    anyhow::ensure!(
        Money::from_str(commission).map_err(anyhow::Error::msg)?.raw > 0,
        "filled order native commission is not positive"
    );
    Ok(ValidatedOrder {
        side: side.to_string(),
        signal_ts,
    })
}

fn exactly_one_variant<'a>(
    events: &'a [serde_json::Value],
    variant: &str,
) -> anyhow::Result<&'a serde_json::Value> {
    let matching = events
        .iter()
        .filter_map(|event| event.get(variant))
        .collect::<Vec<_>>();
    anyhow::ensure!(
        matching.len() == 1,
        "order must contain exactly one {variant} event"
    );
    Ok(matching[0])
}

fn parse_canonical_u64(value: &serde_json::Value, field: &str) -> anyhow::Result<u64> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("canonical order event is missing {field}"))?
        .parse()
        .with_context(|| format!("canonical order event has invalid {field}"))
}

fn load_pilot_data(
    cache_root: &Path,
    instrument: &InstrumentAny,
    bar_type: BarType,
) -> anyhow::Result<LoadedPilotData> {
    let manifest: ArchiveManifest = serde_json::from_slice(MANIFEST_BYTES)?;
    anyhow::ensure!(
        manifest.identity == MANIFEST_ID,
        "archive manifest identity mismatch"
    );
    anyhow::ensure!(
        manifest.schema_version == 1,
        "archive manifest schema mismatch"
    );
    anyhow::ensure!(
        manifest.archives.len() == ARCHIVE_COUNT,
        "archive manifest must bind 24 months"
    );
    anyhow::ensure!(
        cache_root.is_dir(),
        "cache root is not a directory: {}",
        cache_root.display()
    );

    let mut data = Vec::with_capacity(EXPECTED_ACTUAL_EVENTS);
    let mut execution_clock = Vec::with_capacity(EXPECTED_EXECUTABLE_BARS);
    let mut source_open_times = Vec::with_capacity(EXPECTED_ACTUAL_EVENTS);
    let mut zero_observations = 0usize;
    let mut zero_volume_clock = None;
    let mut prior_name: Option<&str> = None;

    for entry in &manifest.archives {
        if let Some(prior) = prior_name {
            anyhow::ensure!(
                prior < entry.name.as_str(),
                "archive manifest is not strictly ordered"
            );
        }
        prior_name = Some(&entry.name);
        let archive =
            read_regular_file(&cache_root.join(&entry.name), MAX_ARCHIVE_BYTES, "archive")?;
        let sidecar_name = format!("{}.CHECKSUM", entry.name);
        let sidecar = read_regular_file(
            &cache_root.join(&sidecar_name),
            MAX_SIDECAR_BYTES,
            "sidecar",
        )?;
        let member_name = format!("{}.csv", entry.name.trim_end_matches(".zip"));
        let binding = BinanceVisionArchiveBinding::new(
            &entry.name,
            member_name,
            &entry.archive_sha256,
            Some(&entry.sidecar_sha256),
            "BTCUSDT",
            BinanceKlineInterval::Hour1,
            BinanceVisionTimestampUnit::Milliseconds,
        )?;
        let authenticated = authenticate_spot_monthly_klines(&binding, &archive, &sidecar)
            .with_context(|| format!("failed to authenticate {}", entry.name))?;

        if let Some((open_ns, event)) =
            project_authenticated_zero_volume_observation(&authenticated)?
        {
            source_open_times.push(open_ns);
            zero_observations += 1;
            anyhow::ensure!(
                zero_volume_clock.is_none(),
                "multiple zero-volume source observations"
            );
            zero_volume_clock = Some(event);
        }

        for mut bar in authenticated.parse_bars(bar_type, instrument, 0u64.into())? {
            let open_ns = bar
                .ts_event
                .as_u64()
                .checked_sub(CLOSED_HOUR_OFFSET_NS)
                .context("bar close timestamp precedes one-hour open")?;
            source_open_times.push(open_ns);
            bar.ts_init = bar.ts_event;
            execution_clock.push(ExecutionBar {
                ts_event: bar.ts_event.as_u64(),
                open: bar.open.to_string(),
            });
            data.push(Data::Bar(bar));
        }
    }

    anyhow::ensure!(
        zero_observations == 1,
        "expected exactly one zero-volume observation"
    );
    anyhow::ensure!(
        data.len() == EXPECTED_EXECUTABLE_BARS,
        "unexpected executable Bar count"
    );
    source_open_times.sort_unstable();
    source_open_times.dedup();
    anyhow::ensure!(
        source_open_times.len() == EXPECTED_ACTUAL_EVENTS,
        "source timestamps are duplicated or incomplete"
    );
    anyhow::ensure!(
        source_open_times.first() == Some(&WARMUP_START_NS),
        "unexpected first source open"
    );
    anyhow::ensure!(
        source_open_times.last() == Some(&VALIDATION_END_NS),
        "unexpected final source open"
    );

    let absent = expected_source_opens()
        .filter(|open| source_open_times.binary_search(open).is_err())
        .collect::<Vec<_>>();
    anyhow::ensure!(
        absent == [MISSING_OPEN_NS],
        "source gap contract mismatch: {absent:?}"
    );
    anyhow::ensure!(
        source_open_times
            .binary_search(&ZERO_VOLUME_OPEN_NS)
            .is_ok(),
        "zero-volume source clock missing"
    );

    data.push(zero_volume_clock.context("authenticated zero-volume source clock is missing")?);
    anyhow::ensure!(
        data.len() == EXPECTED_ACTUAL_EVENTS,
        "projected replay count mismatch"
    );
    data.sort_by_key(HasTsInit::ts_init);
    execution_clock.sort_by_key(|bar| bar.ts_event);

    Ok(LoadedPilotData {
        data,
        execution_clock,
        source_event_count: source_open_times.len(),
        executable_bar_count: EXPECTED_EXECUTABLE_BARS,
    })
}

fn expected_source_opens() -> impl Iterator<Item = u64> {
    (0..EXPECTED_WALL_SLOTS).map(|index| WARMUP_START_NS + index as u64 * HOUR_NS)
}

fn read_regular_file(path: &Path, limit: u64, label: &str) -> anyhow::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("missing {label} {}", path.display()))?;
    anyhow::ensure!(
        metadata.file_type().is_file(),
        "{label} is not a regular file: {}",
        path.display()
    );
    anyhow::ensure!(
        metadata.len() <= limit,
        "{label} exceeds {limit} bytes: {}",
        path.display()
    );
    fs::read(path).with_context(|| format!("failed to read {label} {}", path.display()))
}

struct FrozenPilotStrategy {
    core: StrategyCore,
    prepared: PreparedPilot,
    instrument_id: InstrumentId,
    bar_type: BarType,
    trade_size: Quantity,
    fast_ema: ExponentialMovingAverage,
    slow_ema: ExponentialMovingAverage,
    prior_highs: VecDeque<f64>,
    prior_lows: VecDeque<f64>,
    callback_failure: Rc<RefCell<Option<String>>>,
    #[cfg(test)]
    forced_failure_open_ns: Option<u64>,
    #[cfg(test)]
    forced_action: Option<(u64, DecisionAction)>,
}

impl FrozenPilotStrategy {
    fn new(
        prepared: PreparedPilot,
        instrument_id: InstrumentId,
        bar_type: BarType,
        trade_size: Quantity,
        callback_failure: Rc<RefCell<Option<String>>>,
    ) -> anyhow::Result<Self> {
        let parameters = prepared.intent().payload.mechanism.parameters.clone();
        anyhow::ensure!(
            bar_type.instrument_id() == instrument_id,
            "strategy BarType instrument mismatch"
        );
        Ok(Self {
            core: StrategyCore::new(
                StrategyConfig::builder()
                    .strategy_id(StrategyId::from(STRATEGY_ID))
                    .oms_type(OmsType::Netting)
                    .build()?,
            ),
            prepared,
            instrument_id,
            bar_type,
            trade_size,
            fast_ema: ExponentialMovingAverage::new(
                parameters.fast_ema as usize,
                Some(PriceType::Last),
            ),
            slow_ema: ExponentialMovingAverage::new(
                parameters.slow_ema as usize,
                Some(PriceType::Last),
            ),
            prior_highs: VecDeque::with_capacity(parameters.entry_lookback as usize),
            prior_lows: VecDeque::with_capacity(parameters.exit_lookback as usize),
            callback_failure,
            #[cfg(test)]
            forced_failure_open_ns: None,
            #[cfg(test)]
            forced_action: None,
        })
    }

    fn has_open_position(&self) -> bool {
        let strategy_id = self.strategy_id().expect("registered strategy");
        self.cache().has_positions_open(
            None,
            Some(&self.instrument_id),
            Some(&strategy_id),
            None,
            None,
        )
    }

    fn has_pending_order(&self) -> bool {
        let strategy_id = self.strategy_id().expect("registered strategy");
        let cache = self.cache();
        !cache
            .orders_open(
                None,
                Some(&self.instrument_id),
                Some(&strategy_id),
                None,
                None,
            )
            .is_empty()
            || !cache
                .orders_inflight(
                    None,
                    Some(&self.instrument_id),
                    Some(&strategy_id),
                    None,
                    None,
                )
                .is_empty()
    }

    fn submit_entry(&mut self) -> anyhow::Result<()> {
        let order = self.order().market(
            self.instrument_id,
            OrderSide::Buy,
            self.trade_size,
            Some(TimeInForce::Ioc),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        self.submit_order(order, None, None, None)
    }

    fn submit_exit(&mut self) -> anyhow::Result<()> {
        let strategy_id = self.strategy_id().expect("registered strategy");
        let positions = self
            .cache()
            .positions_open(
                None,
                Some(&self.instrument_id),
                Some(&strategy_id),
                None,
                None,
            )
            .iter()
            .map(|position| (position.id, position.quantity))
            .collect::<Vec<_>>();

        for (position_id, quantity) in positions {
            let order = self.order().market(
                self.instrument_id,
                OrderSide::Sell,
                quantity,
                Some(TimeInForce::Ioc),
                Some(true),
                None,
                None,
                None,
                None,
                None,
            );
            self.submit_order(order, Some(position_id), None, None)?;
        }
        Ok(())
    }

    fn update_windows(&mut self, bar: &Bar) {
        let entry = self
            .prepared
            .intent()
            .payload
            .mechanism
            .parameters
            .entry_lookback as usize;
        let exit = self
            .prepared
            .intent()
            .payload
            .mechanism
            .parameters
            .exit_lookback as usize;
        push_bounded(&mut self.prior_highs, entry, bar.high.as_f64());
        push_bounded(&mut self.prior_lows, exit, bar.low.as_f64());
    }
}

vibe_strategy!(FrozenPilotStrategy);

impl Debug for FrozenPilotStrategy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(FrozenPilotStrategy))
            .field("instrument_id", &self.instrument_id)
            .field("bar_type", &self.bar_type)
            .finish_non_exhaustive()
    }
}

impl DataActor for FrozenPilotStrategy {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.subscribe_bars(self.bar_type, None, None);
        Ok(())
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        self.unsubscribe_bars(self.bar_type, None, None);
        Ok(())
    }

    fn on_bar(&mut self, bar: &Bar) -> anyhow::Result<()> {
        let result = self.on_bar_checked(bar);
        if let Err(e) = &result {
            let mut failure = self.callback_failure.borrow_mut();
            if failure.is_none() {
                *failure = Some(format!("{e:#}"));
            }
        }
        result
    }
}

impl FrozenPilotStrategy {
    fn on_bar_checked(&mut self, bar: &Bar) -> anyhow::Result<()> {
        anyhow::ensure!(
            bar.bar_type == self.bar_type,
            "unexpected BarType delivered to frozen pilot"
        );
        let open_ns = bar
            .ts_event
            .as_u64()
            .checked_sub(CLOSED_HOUR_OFFSET_NS)
            .context("bar timestamp precedes one-hour open")?;
        anyhow::ensure!(
            (WARMUP_START_NS..=VALIDATION_END_NS).contains(&open_ns),
            "bar falls outside frozen pilot windows"
        );

        #[cfg(test)]
        anyhow::ensure!(
            self.forced_failure_open_ns != Some(open_ns),
            "forced penultimate strategy callback failure"
        );

        let prior_high = self.prior_highs.iter().copied().reduce(f64::max);
        let prior_low = self.prior_lows.iter().copied().reduce(f64::min);
        self.fast_ema.update_raw(bar.close.as_f64());
        self.slow_ema.update_raw(bar.close.as_f64());

        if (VALIDATION_START_NS..VALIDATION_END_NS).contains(&open_ns) {
            let parameters = &self.prepared.intent().payload.mechanism.parameters;
            anyhow::ensure!(
                self.prior_highs.len() == parameters.entry_lookback as usize
                    && self.prior_lows.len() == parameters.exit_lookback as usize
                    && self.fast_ema.initialized()
                    && self.slow_ema.initialized(),
                "validation decision channels are not initialized"
            );
            let is_open = self.has_open_position();
            let phase = if open_ns == VALIDATION_END_NS - HOUR_NS {
                DecisionPhase::PenultimateValidation
            } else {
                DecisionPhase::Validation
            };
            let input = DecisionInput::from_abi(
                phase as i32,
                if is_open {
                    DecisionPosition::Long as i32
                } else {
                    DecisionPosition::Flat as i32
                },
                bar.close.as_f64(),
                self.fast_ema.value(),
                self.slow_ema.value(),
                prior_high.context("prior 72-bar high unavailable")?,
                prior_low.context("prior 24-bar low unavailable")?,
            )?;

            if !self.has_pending_order() {
                #[cfg(test)]
                let action = self
                    .forced_action
                    .filter(|(forced_open_ns, _)| *forced_open_ns == open_ns)
                    .map_or_else(|| self.prepared.decide(input), |(_, action)| Ok(action))?;
                #[cfg(not(test))]
                let action = self.prepared.decide(input)?;
                match (action, is_open) {
                    (DecisionAction::EnterLong, false) => self.submit_entry()?,
                    (DecisionAction::ExitLong, true) => self.submit_exit()?,
                    _ => {}
                }
            }
        }

        self.update_windows(bar);
        Ok(())
    }
}

fn push_bounded(values: &mut VecDeque<f64>, capacity: usize, value: f64) {
    if values.len() == capacity {
        values.pop_front();
    }
    values.push_back(value);
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use std::path::PathBuf;
    use vibe_model::types::Price;

    #[rstest]
    fn manifest_is_exact_and_month_ordered() {
        let manifest: ArchiveManifest = serde_json::from_slice(MANIFEST_BYTES).unwrap();
        assert_eq!(manifest.identity, MANIFEST_ID);
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.archives.len(), ARCHIVE_COUNT);
        assert_eq!(
            manifest.archives.first().unwrap().name,
            "BTCUSDT-1h-2023-01.zip"
        );
        assert_eq!(
            manifest.archives.last().unwrap().name,
            "BTCUSDT-1h-2024-12.zip"
        );
        assert!(
            manifest
                .archives
                .windows(2)
                .all(|pair| pair[0].name < pair[1].name)
        );
    }

    #[rstest]
    fn expected_clock_has_one_bound_absence() {
        let opens = expected_source_opens().collect::<Vec<_>>();
        assert_eq!(opens.len(), EXPECTED_WALL_SLOTS);
        assert_eq!(opens.first(), Some(&WARMUP_START_NS));
        assert_eq!(opens.last(), Some(&VALIDATION_END_NS));
        assert!(opens.binary_search(&MISSING_OPEN_NS).is_ok());
        assert!(opens.binary_search(&ZERO_VOLUME_OPEN_NS).is_ok());
    }

    #[rstest]
    fn bounded_window_excludes_current_observation() {
        let mut values = VecDeque::new();
        for value in 1..=4 {
            push_bounded(&mut values, 3, f64::from(value));
        }
        assert_eq!(values, VecDeque::from([2.0, 3.0, 4.0]));
    }

    #[rstest]
    fn loader_rejects_missing_cache_root_without_network() {
        let missing = PathBuf::from("/definitely/not/a/strategy-factory-cache");
        let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let bar_type = BarType::from_str(BAR_TYPE).unwrap();
        let e = load_pilot_data(&missing, &instrument, bar_type).unwrap_err();
        assert!(e.to_string().contains("cache root is not a directory"));
    }

    #[rstest]
    fn swallowed_penultimate_callback_failure_fails_the_application() {
        let prepared = prepare_frozen_pilot().unwrap();
        let trade_quantity = prepared.decision_contract().trade_quantity();
        let starting_balance = prepared.decision_contract().starting_balance();
        let trade_on_close = prepared
            .decision_contract()
            .mechanism()
            .execution()
            .trade_on_close();
        let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let bar_type = BarType::from_str(BAR_TYPE).unwrap();
        let callback_failure = Rc::new(RefCell::new(None));
        let mut strategy = FrozenPilotStrategy::new(
            prepared,
            instrument.id(),
            bar_type,
            trade_quantity,
            Rc::clone(&callback_failure),
        )
        .unwrap();
        let penultimate_open_ns = VALIDATION_END_NS - HOUR_NS;
        strategy.forced_failure_open_ns = Some(penultimate_open_ns);

        let mut data = (1..=120)
            .map(|offset| executable_bar(bar_type, VALIDATION_START_NS - (121 - offset) * HOUR_NS))
            .collect::<Vec<_>>();
        data.push(executable_bar(bar_type, penultimate_open_ns));
        let loaded = LoadedPilotData {
            source_event_count: data.len(),
            executable_bar_count: data.len(),
            execution_clock: execution_clock(&data),
            data,
        };

        let e = execute_loaded_pilot_with_strategy(
            &instrument,
            loaded,
            strategy,
            starting_balance,
            trade_on_close,
            &callback_failure,
        )
        .unwrap_err();
        assert!(
            e.to_string()
                .contains("forced penultimate strategy callback failure")
        );
    }

    #[rstest]
    fn unfilled_market_order_cannot_satisfy_software_acceptance() {
        let prepared = prepare_frozen_pilot().unwrap();
        let starting_balance = prepared.decision_contract().starting_balance();
        let trade_on_close = prepared
            .decision_contract()
            .mechanism()
            .execution()
            .trade_on_close();
        let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let bar_type = BarType::from_str(BAR_TYPE).unwrap();
        let callback_failure = Rc::new(RefCell::new(None));
        let mut strategy = FrozenPilotStrategy::new(
            prepared,
            instrument.id(),
            bar_type,
            Quantity::from("100.000000"),
            Rc::clone(&callback_failure),
        )
        .unwrap();
        strategy.forced_action = Some((VALIDATION_START_NS, DecisionAction::EnterLong));

        let mut data = (1..=120)
            .map(|offset| executable_bar(bar_type, VALIDATION_START_NS - (121 - offset) * HOUR_NS))
            .collect::<Vec<_>>();
        data.push(executable_bar(bar_type, VALIDATION_START_NS));
        data.push(executable_bar(bar_type, VALIDATION_START_NS + HOUR_NS));
        let loaded = LoadedPilotData {
            source_event_count: data.len(),
            executable_bar_count: data.len(),
            execution_clock: execution_clock(&data),
            data,
        };

        let e = execute_loaded_pilot_with_strategy(
            &instrument,
            loaded,
            strategy,
            starting_balance,
            trade_on_close,
            &callback_failure,
        )
        .unwrap_err();
        assert!(
            e.to_string()
                .contains("terminal invariant failed: orders.inflight"),
            "unexpected application error: {e:#}"
        );
    }

    fn execution_clock(data: &[Data]) -> Vec<ExecutionBar> {
        data.iter()
            .filter_map(|datum| match datum {
                Data::Bar(bar) => Some(ExecutionBar {
                    ts_event: bar.ts_event.as_u64(),
                    open: bar.open.to_string(),
                }),
                _ => None,
            })
            .collect()
    }

    fn executable_bar(bar_type: BarType, open_ns: u64) -> Data {
        let close_ns = open_ns + CLOSED_HOUR_OFFSET_NS;
        Data::Bar(Bar::new(
            bar_type,
            Price::from("10000.00"),
            Price::from("10010.00"),
            Price::from("9990.00"),
            Price::from("10000.00"),
            Quantity::from("1.000000"),
            close_ns.into(),
            close_ns.into(),
        ))
    }
}
