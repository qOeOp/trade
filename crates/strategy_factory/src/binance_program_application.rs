//! Binance Margin application adapter from a bound Program Artifact into existing backtest owners.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    path::Path,
    rc::Rc,
};

use anyhow::Context;
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_backtest::{
    config::{
        BacktestDataConfig, BacktestEngineConfig, BacktestRunConfig, BacktestVenueConfig,
        VibeDataType,
    },
    node::BacktestNode,
    result::CanonicalBacktestResult,
};
use vibe_common::logging::logger::LoggerConfig;
use vibe_model::{
    data::{BarType, CustomData, Data},
    enums::{AccountType, BookType, OmsType},
    identifiers::{InstrumentId, StrategyId},
    instruments::InstrumentAny,
};

use crate::{
    artifact::StrategyArtifact,
    program_host::{ProgramHostBindings, ProgramHostStrategy, ProgramHostTrace},
};

pub(crate) struct BoundBinanceProgramApplication {
    pub(crate) artifact: StrategyArtifact,
    pub(crate) parameters: Vec<u8>,
    pub(crate) bindings: ProgramHostBindings,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_binance_catalog_program(
    catalog_root: &Path,
    bar_types: &BTreeSet<BarType>,
    instruments: &BTreeMap<InstrumentId, InstrumentAny>,
    custom_data: &[CustomData],
    program: &BoundBinanceProgramApplication,
    run_scope: ProgramRunScope,
    strategy_id: StrategyId,
    run_id: &str,
) -> anyhow::Result<(CanonicalBacktestResult, Vec<u32>)> {
    let trace = Rc::new(RefCell::new(ProgramHostTrace::default()));
    let strategy = ProgramHostStrategy::new(
        strategy_id,
        &program.artifact,
        &program.parameters,
        run_scope,
        program.bindings.clone(),
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
        .id(run_id.to_string())
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
        .get_engine_mut(run_id)
        .context("Program engine was not built")?;
    engine.add_strategy(strategy)?;
    engine.add_data(
        custom_data.iter().cloned().map(Data::Custom).collect(),
        None,
        true,
        true,
    )?;
    let results = node.run()?;
    anyhow::ensure!(results.len() == 1, "Program result count mismatch");
    anyhow::ensure!(
        trace.borrow().callback_failure.is_none(),
        "Program callback failed: {:?}",
        trace.borrow().callback_failure.as_deref()
    );
    let canonical = node
        .get_engine(run_id)
        .context("Program engine was not retained")?
        .get_canonical_result()?;
    let decision_tags = trace.borrow().decision_tags.clone();
    Ok((canonical, decision_tags))
}
