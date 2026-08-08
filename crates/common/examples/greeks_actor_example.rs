//! Example showing how to use the `GreeksCalculator` with a `DataActor`.
//!
//! Edit the constants below to change the trader, target instrument, and greeks underlying.
//!
//! Run with: `cargo run --example greeks_actor_example --package vibe-common --features live`
//!
//! No credentials are required.

use std::{cell::RefCell, rc::Rc};

use vibe_common::{
    actor::data_actor::{DataActor, DataActorConfig, DataActorCore},
    cache::Cache,
    component::Component,
    greeks::{GreeksCalculator, InstrumentGreeksParams, PortfolioGreeksParams},
    live::clock::LiveClock,
    vibe_actor,
};
use vibe_model::{
    data::{
        CustomData,
        greeks::{GreeksData, PortfolioGreeks},
    },
    enums::PositionSide,
    identifiers::{InstrumentId, TraderId},
};

const TRADER_ID: &str = "TRADER-001";
const INSTRUMENT_ID: &str = "SPY.AMEX";
const GREEKS_UNDERLYING: &str = "SPY";

/// A custom actor that uses the `GreeksCalculator`.
#[derive(Debug)]
struct GreeksActor {
    core: DataActorCore,
    greeks_calculator: Option<GreeksCalculator>,
}

impl GreeksActor {
    /// Creates a new [`GreeksActor`] instance.
    pub(crate) fn new(config: DataActorConfig) -> Self {
        let core = DataActorCore::new(config);

        Self {
            core,
            greeks_calculator: None,
        }
    }

    /// Calculates greeks for a specific instrument.
    pub(crate) fn calculate_instrument_greeks(
        &self,
        instrument_id: InstrumentId,
    ) -> anyhow::Result<GreeksData> {
        InstrumentGreeksParams::builder()
            .instrument_id(instrument_id)
            .cache_greeks(true)
            .publish_greeks(true)
            .ts_event(self.clock().timestamp_ns())
            .build()
            .calculate(self.calculator()?)
    }

    /// Calculates portfolio greeks.
    pub(crate) fn calculate_portfolio_greeks(&self) -> anyhow::Result<PortfolioGreeks> {
        PortfolioGreeksParams::builder()
            .side(PositionSide::NoPositionSide)
            .cache_greeks(true)
            .publish_greeks(true)
            .build()
            .calculate(self.calculator()?)
    }

    /// Subscribes to greeks data for a specific underlying.
    pub(crate) fn subscribe_to_greeks(&self, underlying: &str) -> anyhow::Result<()> {
        self.calculator()?
            .subscribe_greeks(underlying, Some(Self::handle_greeks as fn(&GreeksData)));
        Ok(())
    }

    fn handle_greeks(greeks: &GreeksData) {
        println!("Received greeks data: {greeks:?}");
    }

    fn calculator(&self) -> anyhow::Result<&GreeksCalculator> {
        let Some(calculator) = &self.greeks_calculator else {
            anyhow::bail!("GreeksActor must be started before calculating greeks");
        };

        Ok(calculator)
    }
}

vibe_actor!(GreeksActor);

impl DataActor for GreeksActor {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.greeks_calculator = Some(GreeksCalculator::from_actor(self));
        self.subscribe_to_greeks(GREEKS_UNDERLYING)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    fn on_data(&mut self, data: &CustomData) -> anyhow::Result<()> {
        println!("Received custom data: {}", data.data_type);
        Ok(())
    }
}

fn main() -> anyhow::Result<()> {
    // Create components
    let cache = Rc::new(RefCell::new(Cache::default()));
    let clock = Rc::new(RefCell::new(LiveClock::default()));

    // Create actor config
    let config = DataActorConfig::default();

    let trader_id = TraderId::from(TRADER_ID);

    // Create the GreeksActor
    let mut actor = GreeksActor::new(config);
    actor.register(trader_id, clock, cache).unwrap();

    // Start the actor
    actor.start()?;

    // Example: Calculate greeks for an instrument
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);
    match actor.calculate_instrument_greeks(instrument_id) {
        Ok(greeks) => println!("Calculated greeks for {instrument_id}: {greeks:?}"),
        Err(e) => println!("Error calculating greeks: {e}"),
    }

    // Example: Calculate portfolio greeks
    match actor.calculate_portfolio_greeks() {
        Ok(portfolio_greeks) => println!("Portfolio greeks: {portfolio_greeks:?}"),
        Err(e) => println!("Error calculating portfolio greeks: {e}"),
    }

    // Stop the actor
    actor.stop()?;

    Ok(())
}
