//! Example: EMA crossover strategy backtest using [`BacktestEngine`] directly.
//!
//! Demonstrates a dual-EMA crossover strategy running on synthetic quote data
//! for the AUD/USD FX pair on a simulated venue.
//!
//! Edit the constants below to change the venue, starting balance, trade size,
//! and EMA periods.
//!
//! Run with: `cargo run -p vibe-backtest --features examples --example engine-ema-cross`

use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_model::{
    data::{Data, QuoteTick},
    enums::{AccountType, BookType, OmsType},
    identifiers::{InstrumentId, Venue},
    instruments::{Instrument, InstrumentAny, stubs::audusd_sim},
    types::{Money, Price, Quantity},
};
use vibe_trading::examples::strategies::EmaCross;

const VENUE: &str = "SIM";
const STARTING_BALANCE: &str = "1_000_000 USD";
const TRADE_SIZE: &str = "100000";
const EMA_FAST_PERIOD: usize = 10;
const EMA_SLOW_PERIOD: usize = 20;

fn quote(instrument_id: InstrumentId, bid: &str, ask: &str, ts: u64) -> Data {
    Data::Quote(QuoteTick::new(
        instrument_id,
        Price::from(bid),
        Price::from(ask),
        Quantity::from("100000"),
        Quantity::from("100000"),
        ts.into(),
        ts.into(),
    ))
}

fn generate_quotes(instrument_id: InstrumentId) -> Vec<Data> {
    let spread = 0.00020;
    let base_ts: u64 = 1_735_689_600_000_000_000; // 2025-01-01T00:00:00Z
    let interval: u64 = 1_000_000_000;
    let mut quotes = Vec::new();
    let mut tick: u64 = 0;

    let mut add = |mid: f64| {
        let bid = format!("{mid:.5}");
        let ask = format!("{:.5}", mid + spread);
        quotes.push(quote(instrument_id, &bid, &ask, base_ts + tick * interval));
        tick += 1;
    };

    // Flat initialization - both EMAs converge around 0.65000
    for _ in 0..25 {
        add(0.65000);
    }

    // Repeated up/down cycles to generate multiple crossovers
    let cycles = 6;
    for cycle in 0..cycles {
        let base = 0.65000 + (cycle as f64 * 0.00100);

        // Ramp up - fast EMA crosses above slow → BUY signal
        for i in 0..40 {
            add(base + (i as f64 * 0.00050));
        }

        // Ramp down - fast EMA crosses below slow → SELL signal
        for i in 0..80 {
            let peak = base + 39.0 * 0.00050;
            add(peak - (i as f64 * 0.00050));
        }
    }

    quotes
}

fn main() -> anyhow::Result<()> {
    let mut engine = BacktestEngine::new(BacktestEngineConfig::default())?;

    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from(VENUE))
            .oms_type(OmsType::Hedging)
            .account_type(AccountType::Margin)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![Money::from(STARTING_BALANCE)])
            .build()?,
    )?;

    let instrument = InstrumentAny::CurrencyPair(audusd_sim());
    let instrument_id = instrument.id();
    engine.add_instrument(&instrument)?;

    engine.add_strategy(EmaCross::new(
        instrument_id,
        Quantity::from(TRADE_SIZE),
        EMA_FAST_PERIOD,
        EMA_SLOW_PERIOD,
    ))?;

    let quotes = generate_quotes(instrument_id);
    engine.add_data(quotes, None, true, true).unwrap();
    engine.run(None, None, None, false)?;

    Ok(())
}
