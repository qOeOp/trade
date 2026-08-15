//! Non-economic software control for the existing catalog-driven owner chain.
use anyhow::Context;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    rc::Rc,
};
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_backtest::{
    config::{
        BacktestDataConfig, BacktestEngineConfig, BacktestRunConfig, BacktestVenueConfig,
        VibeDataType,
    },
    node::BacktestNode,
    result::CanonicalBacktestResult,
};
use vibe_binance::common::{
    enums::BinanceProductType, offline::authenticate_monthly_kline_dataset,
    parse::binance_interval_to_bar_spec, symbol::format_instrument_id,
};
use vibe_common::logging::logger::LoggerConfig;
use vibe_data::dataset::CanonicalDatasetManifest;
use vibe_model::{
    data::{Bar, BarType, CustomData, Data, DataType},
    enums::{AccountType, AggregationSource, BookType, OmsType},
    identifiers::{InstrumentId, StrategyId, Symbol},
    instruments::{
        Instrument, InstrumentAny, crypto_perpetual::CryptoPerpetual, currency_pair::CurrencyPair,
    },
    types::{Currency, Price, Quantity},
};
use vibe_persistence::backend::catalog::ParquetDataCatalog;

use crate::{
    artifact::{ArtifactIssuance, StrategyArtifact},
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    program_host::{
        ProgramCustomBinding, ProgramHostBindings, ProgramHostStrategy, ProgramHostTrace,
    },
    program_runtime::ProgramRuntimeBudget,
};

const PRICE_MANIFEST: &[u8] = include_bytes!("../assets/representative_binance_usdm_2023_v1.jcs");
const CONTEXT_MANIFEST: &[u8] =
    include_bytes!("../assets/representative_binance_paxg_spot_2023_v1.jcs");
const CONTROL_WASM_ONE: &[u8] =
    include_bytes!("../assets/program_channel_control_v1/program.first.wasm");
const CONTROL_WASM_TWO: &[u8] =
    include_bytes!("../assets/program_channel_control_v1/program.second.wasm");
const CONTROL_SOURCE_CAPSULE: &[u8] =
    include_bytes!("../assets/program_channel_control_v1/source-capsule.tar");
const CONTROL_BUILD_RECIPE: &[u8] =
    include_bytes!("../assets/program_channel_control_v1/build-recipe.jcs");
const CONTROL_INTENT: &[u8] =
    b"{\"claim\":\"NON_PIT_NON_ECONOMIC_SOFTWARE_CONTROL\",\"schema_version\":1}\n";
const CONTROL_RUNTIME_BUDGET: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
const EXPECTED_COVERAGE: (usize, usize, usize, usize, usize) = (3, 9, 93_075, 93_070, 5);
const RUN_ID: &str = "strategy-factory-software-control-v1";
const BTC_CLOCK: &str = "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL";
const CUSTOM_RECORD_TYPE: u32 = 1_024;
const CUSTOM_CHANNEL: u32 = 10;
const EXPECTED_CHANNELS: [&str; 9] = [
    "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
    "PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL",
];

/// Authenticates the frozen price inputs and runs a non-PIT, non-economic owner-chain control.
/// The derived path must be new. Recovery selects another new path; raw custody is never modified.
/// # Errors
/// Rejects owner-chain mismatch or a non-deterministic, non-flat round trip.
pub fn verify_representative_software_control(
    raw_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<()> {
    verify_representative_software_control_result(raw_root, derived_catalog_root).map(drop)
}

fn verify_representative_software_control_result(
    raw_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<Vec<u8>> {
    let derived_catalog_root = validate_derived_target(raw_root, derived_catalog_root)?;
    let price_manifest = CanonicalDatasetManifest::parse(PRICE_MANIFEST)?;
    let context_manifest = CanonicalDatasetManifest::parse(CONTEXT_MANIFEST)?;
    let price = authenticate_monthly_kline_dataset(&price_manifest, raw_root, 0..96)?;
    let context = authenticate_monthly_kline_dataset(&context_manifest, raw_root, 0..12)?;
    let archives = price.archives().iter().chain(context.archives());
    let instruments = control_instruments(archives.clone().map(|archive| {
        let binding = archive.metadata().binding();
        (binding.product(), binding.symbol())
    }))?;
    let by_id = instruments
        .iter()
        .cloned()
        .map(|instrument| (instrument.id(), instrument))
        .collect::<BTreeMap<_, _>>();
    let mut channels = BTreeMap::<BarType, Vec<Bar>>::new();
    let mut source_rows = 0usize;
    let mut excluded_rows = 0usize;
    let mut executable_rows = 0usize;
    let mut custom_data = Vec::new();

    for archive in archives {
        let binding = archive.metadata().binding();
        source_rows += archive.metadata().total_rows();
        excluded_rows += archive.metadata().zero_volume_rows();
        custom_data.extend(archive.non_executable_kline_custom_data()?);
        let instrument_id = format_instrument_id(&binding.symbol().into(), binding.product());
        let instrument = by_id
            .get(&instrument_id)
            .context("missing control instrument")?;
        let bar_type = BarType::new(
            instrument_id,
            binance_interval_to_bar_spec(binding.interval()),
            AggregationSource::External,
        );
        let batch = channels.entry(bar_type).or_default();
        let bars = archive.parse_bars(bar_type, instrument, 0u64.into())?;
        executable_rows += bars.len();
        for mut bar in bars {
            bar.ts_init = bar.ts_event;
            batch.push(bar);
        }
    }
    anyhow::ensure!(
        (
            instruments.len(),
            channels.len(),
            source_rows,
            executable_rows,
            excluded_rows,
        ) == EXPECTED_COVERAGE
            && channels.values().all(|bars| !bars.is_empty()),
        "authenticated instrument, channel, or row coverage mismatch"
    );
    let custom_data_type = custom_data
        .first()
        .context("authenticated non-executable source observations are unavailable")?
        .data_type
        .clone();
    anyhow::ensure!(
        custom_data.len() == excluded_rows
            && custom_data.iter().all(|event| {
                event.data_type.type_name() == custom_data_type.type_name()
                    && event.data_type.metadata_str() == custom_data_type.metadata_str()
                    && event.data_type.identifier() == custom_data_type.identifier()
            }),
        "authenticated custom source identity mismatch"
    );
    let bar_types = channels.keys().copied().collect::<BTreeSet<_>>();
    let expected = EXPECTED_CHANNELS
        .into_iter()
        .map(str::parse)
        .collect::<Result<BTreeSet<BarType>, _>>()?;
    anyhow::ensure!(
        bar_types == expected,
        "authenticated channel identity mismatch"
    );
    fs::create_dir(&derived_catalog_root).context("derived catalog target must be new")?;
    let catalog = ParquetDataCatalog::new(&derived_catalog_root, None, None, None, None);
    catalog.write_instruments(instruments)?;
    for bars in channels.values() {
        catalog.write_to_parquet(bars, None, None, None)?;
    }
    let source_start = channels
        .values()
        .flatten()
        .map(|bar| bar.ts_init.as_u64())
        .min()
        .context("control source has no first availability time")?;
    let source_end = channels
        .values()
        .flatten()
        .map(|bar| bar.ts_init.as_u64())
        .max()
        .context("control source has no final availability time")?;
    let run_scope = ProgramRunScope::new(source_start, source_start, source_end)
        .map_err(|_| anyhow::anyhow!("control source cannot form a program run scope"))?;
    drop((channels, price, context));
    let first = run_control(
        &derived_catalog_root,
        &bar_types,
        &by_id,
        run_scope,
        &custom_data_type,
        &custom_data,
    )?;
    let second = run_control(
        &derived_catalog_root,
        &bar_types,
        &by_id,
        run_scope,
        &custom_data_type,
        &custom_data,
    )?;
    anyhow::ensure!(first == second, "software control is not reproducible");
    Ok(first)
}

fn validate_derived_target(raw_root: &Path, target: &Path) -> anyhow::Result<std::path::PathBuf> {
    anyhow::ensure!(
        fs::symlink_metadata(target).is_err(),
        "derived catalog target must be new"
    );
    let parent = target.parent().context("derived target has no parent")?;
    anyhow::ensure!(
        target.file_name().is_some() && !parent.as_os_str().is_empty(),
        "derived target must name a child directory"
    );
    let metadata = fs::symlink_metadata(parent)?;
    anyhow::ensure!(
        metadata.is_dir() && !metadata.file_type().is_symlink(),
        "derived parent must be a real directory"
    );
    let raw = fs::canonicalize(raw_root)?;
    let target = fs::canonicalize(parent)?.join(target.file_name().unwrap());
    anyhow::ensure!(
        !target.starts_with(&raw) && !raw.starts_with(&target),
        "raw and derived custody must be disjoint"
    );
    Ok(target)
}

fn control_instruments<'a>(
    bindings: impl Iterator<Item = (BinanceProductType, &'a str)>,
) -> anyhow::Result<Vec<InstrumentAny>> {
    let mut unique = BTreeMap::new();

    for (product, symbol) in bindings {
        let instrument_id = format_instrument_id(&symbol.into(), product);
        if let Some(previous) = unique.insert(instrument_id, (product, symbol)) {
            anyhow::ensure!(
                previous == (product, symbol),
                "instrument binding collision"
            );
        }
    }
    unique
        .into_values()
        .map(|(product, symbol)| {
            let base = symbol
                .strip_suffix("USDT")
                .context("control symbol is not USDT quoted")?;
            let instrument_id = format_instrument_id(&symbol.into(), product);
            let instrument = match product {
                BinanceProductType::UsdM => InstrumentAny::CryptoPerpetual(
                    CryptoPerpetual::builder()
                        .instrument_id(instrument_id)
                        .raw_symbol(Symbol::from(symbol))
                        .base_currency(Currency::get_or_create_crypto(base))
                        .quote_currency(Currency::from("USDT"))
                        .settlement_currency(Currency::from("USDT"))
                        .is_inverse(false)
                        .price_precision(8)
                        .size_precision(8)
                        .price_increment(Price::from("0.00000001"))
                        .size_increment(Quantity::from("0.00000001"))
                        .min_quantity(Quantity::from("0.00000001"))
                        .margin_init("0.1".parse()?)
                        .margin_maint("0.05".parse()?)
                        .maker_fee("0.0002".parse()?)
                        .taker_fee("0.0004".parse()?)
                        .ts_event(0.into())
                        .ts_init(0.into())
                        .build()?,
                ),
                BinanceProductType::Spot => InstrumentAny::CurrencyPair(
                    CurrencyPair::builder()
                        .instrument_id(instrument_id)
                        .raw_symbol(Symbol::from(symbol))
                        .base_currency(Currency::get_or_create_crypto(base))
                        .quote_currency(Currency::from("USDT"))
                        .price_precision(8)
                        .size_precision(8)
                        .price_increment(Price::from("0.00000001"))
                        .size_increment(Quantity::from("0.00000001"))
                        .maker_fee("0.0002".parse()?)
                        .taker_fee("0.0004".parse()?)
                        .ts_event(0.into())
                        .ts_init(0.into())
                        .build()?,
                ),
                _ => anyhow::bail!("unsupported control product {product}"),
            };
            Ok(instrument)
        })
        .collect()
}

fn run_control(
    catalog_root: &Path,
    bar_types: &BTreeSet<BarType>,
    instruments: &BTreeMap<InstrumentId, InstrumentAny>,
    run_scope: ProgramRunScope,
    custom_data_type: &DataType,
    custom_data: &[CustomData],
) -> anyhow::Result<Vec<u8>> {
    let clock: BarType = BTC_CLOCK.parse()?;
    anyhow::ensure!(bar_types.contains(&clock), "control clock is unavailable");
    let (parameters, bindings) = control_program_inputs(bar_types, clock, custom_data_type)?;
    let artifact = channel_control_artifact(&parameters, &bindings)?;
    let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
    let strategy = ProgramHostStrategy::new(
        StrategyId::from("SOFTWARE-CONTROL-001"),
        &artifact,
        &parameters,
        run_scope,
        bindings,
        Rc::clone(&trace),
    )?;
    let catalog_path = catalog_root
        .to_str()
        .context("catalog path is not UTF-8")?
        .to_owned();
    let venue = BacktestVenueConfig::builder()
        .name("BINANCE")
        .oms_type(OmsType::Netting)
        .account_type(AccountType::Margin)
        .book_type(BookType::L1_MBP)
        .starting_balances(vec!["1_000_000 USDT".to_string()])
        .bar_execution(true)
        .build()?;
    let data = BacktestDataConfig::builder()
        .data_type(VibeDataType::Bar)
        .catalog_path(catalog_path)
        .instrument_ids(instruments.keys().copied().collect())
        .bar_types(bar_types.iter().map(ToString::to_string).collect())
        .build()?;
    let run = BacktestRunConfig::builder()
        .id(RUN_ID.to_string())
        .venues(vec![venue])
        .data(vec![data])
        .engine(BacktestEngineConfig {
            bypass_logging: true,
            logging: LoggerConfig {
                bypass_logging: true,
                ..Default::default()
            },
            run_analysis: false,
            ..Default::default()
        })
        .dispose_on_completion(false)
        .raise_exception(true)
        .build()?;
    let mut node = BacktestNode::new(vec![run])?;
    node.build()?;
    let engine = node
        .get_engine_mut(RUN_ID)
        .context("software control engine was not built")?;
    engine.add_strategy(strategy)?;
    engine.add_data(
        custom_data.iter().cloned().map(Data::Custom).collect(),
        None,
        true,
        true,
    )?;
    let results = node.run()?;
    anyhow::ensure!(results.len() == 1, "software control result count mismatch");
    anyhow::ensure!(
        trace.borrow().callback_failure.is_none(),
        "software control program callback failed: {:?}",
        trace.borrow().callback_failure.as_deref()
    );
    anyhow::ensure!(
        trace.borrow().decision_tags == [0, 10, 11, 12],
        "software control action trace mismatch"
    );
    let canonical = node
        .get_engine(RUN_ID)
        .context("software control engine was not retained")?
        .get_canonical_result()?;
    validate_control(&canonical)?;
    canonical.to_bytes()
}

fn control_program_inputs(
    bar_types: &BTreeSet<BarType>,
    clock: BarType,
    custom_data_type: &DataType,
) -> anyhow::Result<(Vec<u8>, ProgramHostBindings)> {
    let mut expected = 0_u64;
    let mut clock_channel = None;
    let mut bars = Vec::with_capacity(bar_types.len());
    for (index, bar_type) in bar_types.iter().copied().enumerate() {
        let channel = u32::try_from(index + 1)?;
        anyhow::ensure!(channel < 64, "software control exceeds the channel bound");
        expected |= 1_u64 << channel;
        clock_channel = (bar_type == clock).then_some(channel).or(clock_channel);
        bars.push((channel, bar_type));
    }
    expected |= 1_u64 << CUSTOM_CHANNEL;
    let executable = 1_u32;
    let bindings = ProgramHostBindings::new([(executable, clock.instrument_id())], bars)?
        .with_custom([ProgramCustomBinding::new(
            custom_data_type.clone(),
            CUSTOM_RECORD_TYPE,
            CUSTOM_CHANNEL,
            4_096,
        )?])?;
    let mut parameters = Vec::with_capacity(32);
    parameters.extend_from_slice(&expected.to_le_bytes());
    parameters.extend_from_slice(
        &clock_channel
            .context("control clock channel is unavailable")?
            .to_le_bytes(),
    );
    parameters.extend_from_slice(&executable.to_le_bytes());
    parameters.extend_from_slice(&CUSTOM_RECORD_TYPE.to_le_bytes());
    parameters.extend_from_slice(&CUSTOM_CHANNEL.to_le_bytes());
    parameters.extend_from_slice(&0.001_f64.to_bits().to_le_bytes());
    Ok((parameters, bindings))
}

fn channel_control_artifact(
    parameters: &[u8],
    bindings: &ProgramHostBindings,
) -> anyhow::Result<StrategyArtifact> {
    let build = VerifiedCargoBuild::verify(CargoBuildEvidence {
        wasm_one: CONTROL_WASM_ONE,
        wasm_two: CONTROL_WASM_TWO,
        source_capsule: CONTROL_SOURCE_CAPSULE,
        build_recipe: CONTROL_BUILD_RECIPE,
        runtime_budget: CONTROL_RUNTIME_BUDGET,
    })?;
    Ok(StrategyArtifact::issue(&ArtifactIssuance::program(
        9,
        CONTROL_INTENT,
        Some(bindings.identity()?),
        Some("software-control/channel-control/full".to_string()),
        Some(parameters.to_vec()),
        &build,
    ))?)
}

fn validate_control(result: &CanonicalBacktestResult) -> anyhow::Result<()> {
    let value = result.as_value();
    anyhow::ensure!(
        value["run"]["outcome"] == "completed"
            && value["accounts"].as_array().is_some_and(|v| !v.is_empty()),
        "run or account state was incomplete"
    );

    for (field, count) in [("orders", 4), ("fills", 2), ("positions", 1)] {
        anyhow::ensure!(
            value[field]
                .as_array()
                .is_some_and(|items| items.len() == count),
            "{field} count mismatch"
        );
    }
    let orders = value["orders"]
        .as_array()
        .context("canonical orders are not an array")?;
    let market_events = ["Initialized", "Submitted", "Filled"];
    let protection_events = [
        "Initialized",
        "Submitted",
        "Accepted",
        "PendingUpdate",
        "Updated",
        "PendingCancel",
        "Canceled",
    ];
    for expected in [
        ("Market", "FILLED", false, market_events.as_slice()),
        ("Market", "FILLED", true, market_events.as_slice()),
        ("Limit", "CANCELED", true, protection_events.as_slice()),
        ("StopMarket", "CANCELED", true, protection_events.as_slice()),
    ] {
        anyhow::ensure!(
            orders
                .iter()
                .filter(|order| has_order_lifecycle(order, expected))
                .count()
                == 1,
            "order lifecycle mismatch for {}",
            expected.0
        );
    }
    anyhow::ensure!(
        ["orders", "fills", "positions"].into_iter().all(|field| {
            value[field]
                .as_array()
                .is_some_and(|items| items.iter().all(has_only_clock_instrument))
        }),
        "context instrument acquired order authority"
    );
    anyhow::ensure!(
        ["orders.open", "orders.inflight", "positions.open"]
            .into_iter()
            .all(|field| value["summary"][field] == "0"),
        "terminal state was not flat"
    );
    Ok(())
}

fn has_order_lifecycle(order: &serde_json::Value, expected: (&str, &str, bool, &[&str])) -> bool {
    let (kind, status, reduce_only, event_names) = expected;
    let Some(core) = order.get(kind).and_then(|payload| payload.get("core")) else {
        return false;
    };
    core["status"] == status
        && core["is_reduce_only"] == reduce_only
        && core["events"].as_array().is_some_and(|events| {
            events.len() == event_names.len()
                && events
                    .iter()
                    .zip(event_names)
                    .all(|(event, name)| event.get(*name).is_some())
        })
}

fn has_only_clock_instrument(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(values) => values.iter().all(has_only_clock_instrument),
        serde_json::Value::Object(values) => values.iter().all(|(key, value)| {
            if key == "instrument_id" {
                value == "BTCUSDT-PERP.BINANCE"
            } else {
                has_only_clock_instrument(value)
            }
        }),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use strategy_factory_program_sdk::{
        BAR_RECORD, CODEC_V1, FrameEncoder, ProgramFault, RecordMeta,
    };

    use super::*;
    use crate::program_session::{ProgramSession, ProgramSessionError};

    #[derive(Clone, Copy)]
    struct BarObservation {
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: f64,
    }

    fn test_scope() -> ProgramRunScope {
        ProgramRunScope::new(1, 1, 100).unwrap()
    }

    fn test_custom_data_type() -> DataType {
        DataType::new(
            "TestNonExecutableObservationV1",
            None,
            Some("test/series".to_string()),
        )
    }

    fn push_test_bar(
        frame: &mut FrameEncoder<'_>,
        channel: u32,
        time: u64,
        bar: BarObservation,
    ) -> Result<(), ProgramFault> {
        let mut payload = [0_u8; 40];
        for (index, value) in [bar.open, bar.high, bar.low, bar.close, bar.volume]
            .into_iter()
            .enumerate()
        {
            payload[index * 8..index * 8 + 8].copy_from_slice(&value.to_bits().to_le_bytes());
        }
        frame.push(
            RecordMeta {
                type_id: BAR_RECORD,
                codec_version: CODEC_V1,
                channel,
                ts_event: time,
                available_at: time,
            },
            &payload,
        )
    }

    fn push_test_custom(frame: &mut FrameEncoder<'_>, time: u64) -> Result<(), ProgramFault> {
        frame.push(
            RecordMeta {
                type_id: CUSTOM_RECORD_TYPE,
                codec_version: CODEC_V1,
                channel: CUSTOM_CHANNEL,
                ts_event: time,
                available_at: time,
            },
            br#"{"observed":true}"#,
        )
    }

    #[rstest]
    fn sealed_channel_control_rejects_rebound_host_inputs() {
        let bar_types = EXPECTED_CHANNELS
            .into_iter()
            .map(str::parse)
            .collect::<Result<BTreeSet<BarType>, _>>()
            .unwrap();
        let clock = BTC_CLOCK.parse().unwrap();
        let custom = test_custom_data_type();
        let (parameters, bindings) = control_program_inputs(&bar_types, clock, &custom).unwrap();
        let artifact = channel_control_artifact(&parameters, &bindings).unwrap();
        ProgramHostStrategy::new(
            StrategyId::from("BOUND-CONTROL"),
            &artifact,
            &parameters,
            test_scope(),
            bindings,
            Rc::new(RefCell::new(ProgramHostTrace::default())),
        )
        .unwrap();
        let bar_bindings = |types: &BTreeSet<BarType>| {
            types
                .iter()
                .copied()
                .enumerate()
                .map(|(index, bar_type)| (u32::try_from(index + 1).unwrap(), bar_type))
                .collect::<Vec<_>>()
        };
        let mut reduced = bar_types.clone();
        reduced.remove(&"PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL".parse().unwrap());
        let (_, missing_channel) = control_program_inputs(&reduced, clock, &custom).unwrap();
        let mut swapped_channels = bar_bindings(&bar_types);
        let first = swapped_channels[0].1;
        swapped_channels[0].1 = swapped_channels[1].1;
        swapped_channels[1].1 = first;
        let context_id = "PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL"
            .parse::<BarType>()
            .unwrap()
            .instrument_id();
        let context_executable =
            ProgramHostBindings::new([(1, context_id)], bar_bindings(&bar_types)).unwrap();
        let swapped =
            ProgramHostBindings::new([(1, clock.instrument_id())], swapped_channels).unwrap();

        for rebound in [missing_channel, context_executable, swapped] {
            let error = ProgramHostStrategy::new(
                StrategyId::from("REBOUND-CONTROL"),
                &artifact,
                &parameters,
                test_scope(),
                rebound,
                Rc::new(RefCell::new(ProgramHostTrace::default())),
            )
            .unwrap_err();
            assert!(error.to_string().contains("input contract"));
        }
    }

    #[rstest]
    fn channel_control_cannot_propose_before_every_bound_channel_arrives() {
        let bar_types = EXPECTED_CHANNELS
            .into_iter()
            .map(str::parse)
            .collect::<Result<BTreeSet<BarType>, _>>()
            .unwrap();
        let clock = BTC_CLOCK.parse().unwrap();
        let custom = test_custom_data_type();
        let (parameters, bindings) = control_program_inputs(&bar_types, clock, &custom).unwrap();
        let artifact = channel_control_artifact(&parameters, &bindings).unwrap();
        let mut session = ProgramSession::new(&artifact, &parameters, test_scope()).unwrap();
        assert!(session.start(0).unwrap().is_empty());
        for (index, bar_type) in bar_types.iter().enumerate() {
            let channel = u32::try_from(
                bar_types
                    .iter()
                    .position(|candidate| candidate == bar_type)
                    .unwrap()
                    + 1,
            )
            .unwrap();
            let proposal = session
                .observe(u64::try_from(index + 1).unwrap(), |frame| {
                    push_test_bar(
                        frame,
                        channel,
                        u64::try_from(index + 1).unwrap(),
                        BarObservation {
                            open: 1.0,
                            high: 1.0,
                            low: 1.0,
                            close: 1.0,
                            volume: 1.0,
                        },
                    )
                })
                .unwrap();
            assert!(proposal.is_empty());
        }
        let clock_channel =
            u32::try_from(bar_types.iter().position(|bar| *bar == clock).unwrap() + 1).unwrap();
        assert!(
            session
                .observe(10, |frame| push_test_bar(
                    frame,
                    clock_channel,
                    10,
                    BarObservation {
                        open: 1.0,
                        high: 1.0,
                        low: 1.0,
                        close: 1.0,
                        volume: 1.0
                    },
                ))
                .unwrap()
                .is_empty()
        );
        assert!(
            session
                .observe(11, |frame| push_test_custom(frame, 11))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            session
                .observe(12, |frame| push_test_bar(
                    frame,
                    clock_channel,
                    12,
                    BarObservation {
                        open: 1.0,
                        high: 1.0,
                        low: 1.0,
                        close: 1.0,
                        volume: 1.0,
                    },
                ))
                .unwrap()
                .len(),
            1
        );
    }

    #[rstest]
    fn one_artifact_obeys_distinct_formation_and_qualification_scopes() {
        let clock: BarType = BTC_CLOCK.parse().unwrap();
        let bar_types = BTreeSet::from([clock]);
        let custom = test_custom_data_type();
        let (parameters, bindings) = control_program_inputs(&bar_types, clock, &custom).unwrap();
        let artifact = channel_control_artifact(&parameters, &bindings).unwrap();
        let channel = 1;
        let observe = |session: &mut ProgramSession, time| {
            session.observe(time, |frame| {
                push_test_custom(frame, time)?;
                push_test_bar(
                    frame,
                    channel,
                    time,
                    BarObservation {
                        open: 1.0,
                        high: 1.0,
                        low: 1.0,
                        close: 1.0,
                        volume: 1.0,
                    },
                )
            })
        };

        let formation_scope = ProgramRunScope::new(10, 10, 30).unwrap();
        let mut formation = ProgramSession::new(&artifact, &parameters, formation_scope).unwrap();
        formation.start(0).unwrap();
        assert!(!observe(&mut formation, 10).unwrap().is_empty());

        let qualification_scope = ProgramRunScope::new(10, 20, 30).unwrap();

        for (time, expected) in [
            (9, ProgramSessionError::ObservationOutsideSourceWindow),
            (10, ProgramSessionError::ActionOutsideDecisionWindow),
            (30, ProgramSessionError::ActionOutsideDecisionWindow),
            (31, ProgramSessionError::ObservationOutsideSourceWindow),
        ] {
            let mut qualification =
                ProgramSession::new(&artifact, &parameters, qualification_scope).unwrap();
            qualification.start(0).unwrap();
            assert_eq!(observe(&mut qualification, time).unwrap_err(), expected);
        }
    }

    #[rstest]
    #[ignore = "requires the separately downloaded frozen 2023 USD-M and PAXG Spot datasets"]
    fn fresh_catalogs_produce_identical_canonical_results() {
        let raw = std::path::PathBuf::from(
            std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap(),
        );
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first =
            verify_representative_software_control_result(&raw, &first.path().join("catalog"))
                .unwrap();
        let second =
            verify_representative_software_control_result(&raw, &second.path().join("catalog"))
                .unwrap();
        assert_eq!(first, second);
    }
}
