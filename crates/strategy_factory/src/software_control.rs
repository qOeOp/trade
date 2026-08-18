//! Non-economic software control for the existing catalog-driven owner chain.
use anyhow::Context;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_binance::common::{
    offline::authenticate_monthly_kline_dataset, parse::binance_interval_to_bar_spec,
    symbol::format_instrument_id,
};
use vibe_data::dataset::CanonicalDatasetManifest;
use vibe_model::{
    data::{Bar, BarType, CustomData, DataType},
    enums::AggregationSource,
    identifiers::{InstrumentId, StrategyId},
    instruments::{Instrument, InstrumentAny},
};
use vibe_persistence::backend::catalog::ParquetDataCatalog;

use crate::{
    artifact::{ArtifactIssuance, StrategyArtifact},
    binance_program_application::{BoundBinanceProgramApplication, run_binance_catalog_program},
    binance_program_data::{
        PreparedBinanceProgramDataset, binance_program_instruments, validate_derived_catalog_target,
    },
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    program_host::{ProgramCustomBinding, ProgramEffectBudget, ProgramHostBindings},
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
const SOURCE_START_NS: u64 = 1_672_532_099_999_000_000;
const SOURCE_END_NS: u64 = 1_704_067_199_999_000_000;
const CUSTOM_DATA_TYPE: &str = r#"{"type_name":"BinanceVisionNonExecutableKlineV1","metadata":{"provider":"BINANCE_VISION","product":"USD_M","symbol":"BTCUSDT","interval":"15m"},"identifier":"BINANCE_VISION/USD_M/BTCUSDT/15m"}"#;
const CUSTOM_RECORD_TYPE: u32 = 1_024;
const CUSTOM_CHANNEL: u32 = 10;
const CHANNEL_CONTROL_EXECUTABLE: u32 = 1;
// One entry, two protective submits, two modifies, two cancels, and one exit.
const CHANNEL_CONTROL_QUANTITY: f64 = 0.001;
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
    let build = embedded_control_build()?;
    verify_representative_software_control_with_build(&build, raw_root, derived_catalog_root)
}

pub(crate) fn prepare_representative_market_dataset(
    raw_root: &Path,
    derived_catalog_root: &Path,
    mut custom_data: Vec<CustomData>,
    source_binding: &[u8],
) -> anyhow::Result<PreparedBinanceProgramDataset> {
    let price_manifest = CanonicalDatasetManifest::parse(PRICE_MANIFEST)?;
    let context_manifest = CanonicalDatasetManifest::parse(CONTEXT_MANIFEST)?;
    let expected_bar_types = EXPECTED_CHANNELS
        .into_iter()
        .map(str::parse)
        .collect::<Result<BTreeSet<BarType>, _>>()?;
    let custom_data_type = DataType::from_persistence_json(CUSTOM_DATA_TYPE)?;
    let derived_catalog_root = validate_derived_catalog_target(raw_root, derived_catalog_root)?;
    let price = authenticate_monthly_kline_dataset(&price_manifest, raw_root, 0..96)?;
    let context = authenticate_monthly_kline_dataset(&context_manifest, raw_root, 0..12)?;
    let archives = price.archives().iter().chain(context.archives());
    let instruments = binance_program_instruments(archives.clone().map(|archive| {
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
    let extra_custom_count = custom_data.len();

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
    anyhow::ensure!(
        custom_data.len() >= excluded_rows
            && custom_data.iter().skip(extra_custom_count).all(|event| {
                event.data_type.type_name() == custom_data_type.type_name()
                    && event.data_type.metadata_str() == custom_data_type.metadata_str()
                    && event.data_type.identifier() == custom_data_type.identifier()
            }),
        "authenticated custom source identity mismatch"
    );
    anyhow::ensure!(
        channels
            .keys()
            .copied()
            .eq(expected_bar_types.iter().copied()),
        "authenticated channel identity mismatch"
    );
    let source_scope = channels
        .values()
        .flatten()
        .fold(None, |scope, bar| match scope {
            None => Some((bar.ts_init.as_u64(), bar.ts_init.as_u64())),
            Some((start, end)) => Some((
                start.min(bar.ts_init.as_u64()),
                end.max(bar.ts_init.as_u64()),
            )),
        })
        .context("control source has no availability scope")?;
    anyhow::ensure!(
        source_scope == (SOURCE_START_NS, SOURCE_END_NS),
        "authenticated source scope mismatch"
    );
    fs::create_dir(&derived_catalog_root).context("derived catalog target must be new")?;
    let catalog = ParquetDataCatalog::new(&derived_catalog_root, None, None, None, None);
    catalog.write_instruments(instruments)?;
    for bars in channels.values() {
        catalog.write_to_parquet(bars, None, None, None)?;
    }
    let mut hasher = blake3::Hasher::new();
    for bytes in [PRICE_MANIFEST, CONTEXT_MANIFEST, source_binding] {
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    Ok(PreparedBinanceProgramDataset {
        catalog_root: derived_catalog_root,
        bar_types: expected_bar_types,
        instruments: by_id,
        custom_data,
        source_manifest_digest: format!("blake3:{}", hasher.finalize().to_hex()),
        source_event_count: source_rows + extra_custom_count,
        executable_bar_count: executable_rows,
    })
}

fn verify_representative_software_control_with_build(
    build: &VerifiedCargoBuild,
    raw_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<()> {
    let bar_types = EXPECTED_CHANNELS
        .into_iter()
        .map(str::parse)
        .collect::<Result<BTreeSet<BarType>, _>>()?;
    let custom_data_type = DataType::from_persistence_json(CUSTOM_DATA_TYPE)?;
    let run_scope = control_run_scope();
    let clock: BarType = BTC_CLOCK.parse()?;
    let (parameters, bindings) = channel_control_inputs(&bar_types, clock, custom_data_type)?;
    let artifact =
        channel_control_artifact_with_build(build, &parameters, &bindings, run_scope, b"")?;
    let program = BoundBinanceProgramApplication {
        artifact,
        parameters,
        bindings,
    };
    let dataset =
        prepare_representative_market_dataset(raw_root, derived_catalog_root, Vec::new(), b"")?;
    let first = run_control(
        &dataset.catalog_root,
        &dataset.bar_types,
        &dataset.instruments,
        run_scope,
        &dataset.custom_data,
        &program,
    )?;
    let second = run_control(
        &dataset.catalog_root,
        &dataset.bar_types,
        &dataset.instruments,
        run_scope,
        &dataset.custom_data,
        &program,
    )?;
    anyhow::ensure!(first == second, "software control is not reproducible");
    Ok(())
}

fn run_control(
    catalog_root: &Path,
    bar_types: &BTreeSet<BarType>,
    instruments: &BTreeMap<InstrumentId, InstrumentAny>,
    run_scope: ProgramRunScope,
    custom_data: &[CustomData],
    program: &BoundBinanceProgramApplication,
) -> anyhow::Result<Vec<u8>> {
    let (canonical, decision_tags) = run_binance_catalog_program(
        catalog_root,
        bar_types,
        instruments,
        custom_data,
        program,
        run_scope,
        StrategyId::from("SOFTWARE-CONTROL-001"),
        RUN_ID,
    )?;
    anyhow::ensure!(
        decision_tags == [0, 10, 11, 12],
        "software control action trace mismatch"
    );
    validate_control(&canonical)?;
    canonical.to_bytes()
}

fn channel_control_inputs(
    bar_types: &BTreeSet<BarType>,
    clock: BarType,
    custom_data_type: DataType,
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
    let executable = CHANNEL_CONTROL_EXECUTABLE;
    let bindings = ProgramHostBindings::new(
        [(executable, clock.instrument_id())],
        bars,
        channel_control_effect_budget()?,
    )?
    .with_custom([ProgramCustomBinding::presence(
        custom_data_type,
        CUSTOM_RECORD_TYPE,
        CUSTOM_CHANNEL,
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
    parameters.extend_from_slice(&CHANNEL_CONTROL_QUANTITY.to_bits().to_le_bytes());
    Ok((parameters, bindings))
}

fn channel_control_effect_budget() -> anyhow::Result<ProgramEffectBudget> {
    ProgramEffectBudget::new(
        8,
        4,
        1,
        [(CHANNEL_CONTROL_EXECUTABLE, CHANNEL_CONTROL_QUANTITY)],
    )
}

#[cfg(test)]
fn channel_control_artifact(
    parameters: &[u8],
    bindings: &ProgramHostBindings,
) -> anyhow::Result<StrategyArtifact> {
    channel_control_artifact_with_build(
        &embedded_control_build()?,
        parameters,
        bindings,
        control_run_scope(),
        b"",
    )
}

fn channel_control_artifact_with_build(
    build: &VerifiedCargoBuild,
    parameters: &[u8],
    bindings: &ProgramHostBindings,
    run_scope: ProgramRunScope,
    source_binding: &[u8],
) -> anyhow::Result<StrategyArtifact> {
    let strategy_spec_digest = bindings.identity()?;
    let trial_id = software_control_trial_id(
        build,
        parameters,
        &strategy_spec_digest,
        run_scope,
        source_binding,
    );
    Ok(StrategyArtifact::issue(&ArtifactIssuance::program(
        9,
        CONTROL_INTENT,
        Some(strategy_spec_digest),
        Some(trial_id),
        Some(parameters.to_vec()),
        build,
    ))?)
}

fn control_run_scope() -> ProgramRunScope {
    ProgramRunScope::new(SOURCE_START_NS, SOURCE_START_NS, SOURCE_END_NS)
        .expect("frozen software-control scope")
}

fn embedded_control_build() -> anyhow::Result<VerifiedCargoBuild> {
    Ok(VerifiedCargoBuild::verify(CargoBuildEvidence {
        wasm_one: CONTROL_WASM_ONE,
        wasm_two: CONTROL_WASM_TWO,
        source_capsule: CONTROL_SOURCE_CAPSULE,
        build_recipe: CONTROL_BUILD_RECIPE,
        runtime_budget: CONTROL_RUNTIME_BUDGET,
    })?)
}

fn software_control_trial_id(
    build: &VerifiedCargoBuild,
    parameters: &[u8],
    strategy_spec_digest: &str,
    run_scope: ProgramRunScope,
    source_binding: &[u8],
) -> String {
    let mut hasher = blake3::Hasher::new();

    for bytes in [
        b"strategy-factory-software-control-trial-v1".as_slice(),
        build.source_capsule.as_ref(),
        PRICE_MANIFEST,
        CONTEXT_MANIFEST,
        parameters,
        strategy_spec_digest.as_bytes(),
        source_binding,
    ] {
        let len = u64::try_from(bytes.len()).expect("bounded trial field");
        hasher.update(&len.to_le_bytes());
        hasher.update(bytes);
    }

    for value in [
        run_scope.source_start_ns,
        run_scope.decision_start_ns,
        run_scope.end_ns,
    ] {
        hasher.update(&value.to_le_bytes());
    }
    format!("software-control/blake3:{}", hasher.finalize().to_hex())
}

pub(crate) fn validate_program_terminal(result: &CanonicalBacktestResult) -> anyhow::Result<()> {
    validate_completed_program_terminal(result)?;
    let value = result.as_value();
    anyhow::ensure!(
        ["orders", "fills", "positions"].into_iter().all(|field| {
            value[field].as_array().is_some_and(|items| {
                items.iter().all(|item| {
                    collect_allowed_instrument_ids(item, &["BTCUSDT-PERP.BINANCE"]).is_ok()
                })
            })
        }),
        "context instrument acquired order authority"
    );
    Ok(())
}

pub(crate) fn validate_completed_program_terminal(
    result: &CanonicalBacktestResult,
) -> anyhow::Result<()> {
    let value = result.as_value();
    anyhow::ensure!(
        value["run"]["outcome"] == "completed"
            && value["accounts"].as_array().is_some_and(|v| !v.is_empty()),
        "run or account state was incomplete"
    );
    anyhow::ensure!(
        ["orders.open", "orders.inflight", "positions.open"]
            .into_iter()
            .all(|field| value["summary"][field] == "0"),
        "terminal state was not flat"
    );
    Ok(())
}

fn validate_control(result: &CanonicalBacktestResult) -> anyhow::Result<()> {
    validate_program_terminal(result)?;
    let value = result.as_value();

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

pub(crate) fn collect_allowed_instrument_ids(
    value: &serde_json::Value,
    allowed: &[&str],
) -> anyhow::Result<BTreeMap<String, usize>> {
    fn collect(
        value: &serde_json::Value,
        allowed: &[&str],
        counts: &mut BTreeMap<String, usize>,
    ) -> anyhow::Result<()> {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    collect(value, allowed, counts)?;
                }
            }
            serde_json::Value::Object(values) => {
                for (key, value) in values {
                    if key == "instrument_id" {
                        let instrument = value
                            .as_str()
                            .context("instrument_id was not an exact string")?;
                        anyhow::ensure!(
                            allowed.contains(&instrument),
                            "instrument_id was outside the allowed set"
                        );
                        *counts.entry(instrument.to_string()).or_default() += 1;
                    } else {
                        collect(value, allowed, counts)?;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    let mut counts = BTreeMap::new();
    collect(value, allowed, &mut counts)?;
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use rstest::rstest;
    use strategy_factory_program_sdk::{
        BAR_RECORD, CODEC_V1, FrameEncoder, ProgramFault, RecordMeta,
    };

    use super::*;
    use crate::{
        program_host::{ProgramHostStrategy, ProgramHostTrace},
        program_session::{ProgramSession, ProgramSessionError},
    };

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

    fn terminal_result(
        orders: &serde_json::Value,
        fills: &serde_json::Value,
        positions: &serde_json::Value,
    ) -> CanonicalBacktestResult {
        let document = serde_json::json!({
            "accounts": [{}],
            "components": {
                "actor_ids": [],
                "exec_algorithm_ids": [],
                "strategy_ids": [],
                "trader_state": "STOPPED",
            },
            "diagnostics": [],
            "fills": fills,
            "orders": orders,
            "portfolio_snapshots": [],
            "position_snapshots": [],
            "positions": positions,
            "run": {
                "backtest_end_ns": "2",
                "backtest_start_ns": "1",
                "iterations": "1",
                "outcome": "completed",
                "run_config_id": null,
                "total_events": "0",
                "total_orders": "0",
                "total_positions": "0",
                "trader_id": "TRADER-001",
            },
            "schema": "vibe-backtest-result/v1",
            "statistics": {
                "general": {},
                "pnls": {},
                "returns": {},
                "returns_series": [],
            },
            "summary": {
                "orders.inflight": "0",
                "orders.open": "0",
                "positions.open": "0",
            },
        });
        CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap()).unwrap()
    }

    #[rstest]
    fn btc_terminal_wrapper_preserves_exact_identity_and_missing_key_behavior() {
        let accepted = terminal_result(
            &serde_json::json!([{"core": {"instrument_id": "BTCUSDT-PERP.BINANCE"}}]),
            &serde_json::json!([{"instrument_id": "BTCUSDT-PERP.BINANCE"}]),
            &serde_json::json!([{"record_without_instrument": true}]),
        );
        assert!(validate_program_terminal(&accepted).is_ok());

        let foreign = terminal_result(
            &serde_json::json!([{"instrument_id": "ETHUSDT-PERP.BINANCE"}]),
            &serde_json::json!([]),
            &serde_json::json!([]),
        );
        assert_eq!(
            validate_program_terminal(&foreign).unwrap_err().to_string(),
            "context instrument acquired order authority"
        );
    }

    #[rstest]
    fn completed_terminal_validator_rejects_each_nonterminal_boundary() {
        let base = terminal_result(
            &serde_json::json!([]),
            &serde_json::json!([]),
            &serde_json::json!([]),
        );

        for (pointer, replacement, expected) in [
            (
                "/run/outcome",
                serde_json::json!("failed"),
                "run or account state was incomplete",
            ),
            (
                "/accounts",
                serde_json::json!([]),
                "run or account state was incomplete",
            ),
            (
                "/summary/orders.open",
                serde_json::json!("1"),
                "terminal state was not flat",
            ),
            (
                "/summary/orders.inflight",
                serde_json::json!("1"),
                "terminal state was not flat",
            ),
            (
                "/summary/positions.open",
                serde_json::json!("1"),
                "terminal state was not flat",
            ),
        ] {
            let mut document = base.as_value().clone();
            *document.pointer_mut(pointer).unwrap() = replacement;
            let changed =
                CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap())
                    .unwrap();
            assert_eq!(
                validate_completed_program_terminal(&changed)
                    .unwrap_err()
                    .to_string(),
                expected
            );
        }
    }

    #[rstest]
    fn instrument_collector_counts_nested_exact_allowed_identities() {
        let value = serde_json::json!({
            "instrument_id": "BTCUSDT-PERP.BINANCE",
            "nested": [
                {"instrument_id": "ETHUSDT-PERP.BINANCE"},
                {"deeper": {"instrument_id": "BTCUSDT-PERP.BINANCE"}},
            ],
        });
        let counts = collect_allowed_instrument_ids(
            &value,
            &["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"],
        )
        .unwrap();

        assert_eq!(counts["BTCUSDT-PERP.BINANCE"], 2);
        assert_eq!(counts["ETHUSDT-PERP.BINANCE"], 1);
        assert_eq!(counts.values().sum::<usize>(), 3);
    }

    #[rstest]
    fn instrument_collector_reports_missing_and_rejects_foreign_or_non_string_ids() {
        let missing = collect_allowed_instrument_ids(
            &serde_json::json!({"nested": [{"other": true}]}),
            &["BTCUSDT-PERP.BINANCE"],
        )
        .unwrap();
        assert!(missing.is_empty());

        for invalid in [
            serde_json::json!({"instrument_id": "ETHUSDT-PERP.BINANCE"}),
            serde_json::json!({"instrument_id": 1}),
        ] {
            assert!(collect_allowed_instrument_ids(&invalid, &["BTCUSDT-PERP.BINANCE"]).is_err());
        }
    }

    fn control_program_inputs(
        bar_types: &BTreeSet<BarType>,
        clock: BarType,
        custom_data_type: &DataType,
    ) -> anyhow::Result<(Vec<u8>, ProgramHostBindings)> {
        channel_control_inputs(bar_types, clock, custom_data_type.clone())
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
        push_test_custom_record(frame, CUSTOM_RECORD_TYPE, CUSTOM_CHANNEL, time, time)
    }

    fn push_test_custom_record(
        frame: &mut FrameEncoder<'_>,
        type_id: u32,
        channel: u32,
        time: u64,
        available_at: u64,
    ) -> Result<(), ProgramFault> {
        frame.push(
            RecordMeta {
                type_id,
                codec_version: CODEC_V1,
                channel,
                ts_event: time,
                available_at,
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
        let context_executable = ProgramHostBindings::new(
            [(CHANNEL_CONTROL_EXECUTABLE, context_id)],
            bar_bindings(&bar_types),
            channel_control_effect_budget().unwrap(),
        )
        .unwrap();
        let swapped = ProgramHostBindings::new(
            [(CHANNEL_CONTROL_EXECUTABLE, clock.instrument_id())],
            swapped_channels,
            channel_control_effect_budget().unwrap(),
        )
        .unwrap();
        let budget_rebound = ProgramHostBindings::new(
            [(CHANNEL_CONTROL_EXECUTABLE, clock.instrument_id())],
            bar_bindings(&bar_types),
            ProgramEffectBudget::new(9, 4, 1, [(CHANNEL_CONTROL_EXECUTABLE, 0.001)]).unwrap(),
        )
        .unwrap()
        .with_custom([
            ProgramCustomBinding::presence(custom, CUSTOM_RECORD_TYPE, CUSTOM_CHANNEL).unwrap(),
        ])
        .unwrap();

        for rebound in [missing_channel, context_executable, swapped, budget_rebound] {
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
    fn software_control_trial_identity_binds_scope() {
        let build = embedded_control_build().unwrap();
        let trial =
            |scope| software_control_trial_id(&build, b"parameters", "bindings", scope, b"");
        assert_ne!(
            trial(test_scope()),
            trial(ProgramRunScope::new(0, 1, 3).unwrap())
        );
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
}
