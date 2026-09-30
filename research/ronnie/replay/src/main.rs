//! Replays exported order intents through the repository's BacktestEngine and records every outcome.
//!
//! usage: engine-replay <bars.csv> <orders.json> <key> <adaptive 0|1> <out.csv>
//! bars.csv columns: open,high,low,close,volume,ts (ts = bar close, ns)

use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    fmt::Debug,
    io::Write,
    rc::Rc,
};

use rust_decimal_macros::dec;
use serde::Deserialize;
use ustr::Ustr;
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_common::actor::DataActor;
use vibe_core::UnixNanos;
use vibe_model::{
    data::{Bar, BarSpecification, BarType, Data},
    enums::{
        AccountType, AggregationSource, BarAggregation, BookType, OmsType, OrderSide, OrderType,
        PriceType, TimeInForce,
    },
    events::{OrderEventAny, OrderCanceled, OrderDenied, OrderExpired, OrderFilled, OrderRejected},
    identifiers::{ClientOrderId, InstrumentId, StrategyId, Symbol},
    instruments::{CryptoPerpetual, Instrument, InstrumentAny},
    orders::Order,
    types::{Currency, Money, Price, Quantity},
};
use vibe_trading::{Strategy, StrategyConfig, StrategyCore, vibe_strategy};

#[derive(Debug, Clone, Deserialize)]
struct Plan {
    id: String,
    submit_ns: u64,
    side: i8,
    kind: String,
    entry: f64,
    stop: f64,
    target: f64,
    expire_ns: u64,
    deadline_ns: u64,
}

#[derive(Debug, Clone, Default)]
struct Outcome {
    id: String,
    side: i8,
    plan_entry: f64,
    stop: f64,
    target: f64,
    status: String,
    entry_px: f64,
    entry_ns: u64,
    exit_px: f64,
    exit_ns: u64,
    exit_role: String,
    commission: f64,
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum Role {
    Entry,
    Tp,
    Sl,
}

struct Replay {
    core: StrategyCore,
    instrument_id: InstrumentId,
    bar_type: BarType,
    plans: VecDeque<Plan>,
    roles: HashMap<ClientOrderId, Role>,
    current: Option<Outcome>,
    deadline: u64,
    entry_expire: u64,
    in_position: bool,
    closing: bool,
    skipped_busy: Rc<RefCell<u64>>,
    out: Rc<RefCell<Vec<Outcome>>>,
}

impl Replay {
    fn finish(&mut self, status: &str) {
        if let Some(mut o) = self.current.take() {
            if o.status.is_empty() {
                o.status = status.to_string();
            }
            self.out.borrow_mut().push(o);
        }
        self.in_position = false;
        self.closing = false;
        self.roles.clear();
    }
}

vibe_strategy!(Replay, {
    fn on_order_event(&mut self, event: OrderEventAny) {
        if std::env::var("DBG").is_ok_and(|v| self.current.as_ref().is_some_and(|o| o.id == v)) {
            eprintln!("EV {:?}", event);
        }
    }
    fn on_order_filled(&mut self, event: &OrderFilled) {
        let px = event.last_px.as_f64();
        let ts = event.ts_event.as_u64();
        let fee = event.commission.map_or(0.0, |m| m.as_f64());
        let role = self.roles.get(&event.client_order_id).copied();
        let Some(o) = self.current.as_mut() else { return };
        o.commission += fee;
        match role {
            Some(Role::Entry) => {
                o.entry_px = px;
                o.entry_ns = ts;
                self.in_position = true;
            }
            Some(r) => {
                o.exit_px = px;
                o.exit_ns = ts;
                o.exit_role = if r == Role::Tp { "TP".into() } else { "SL".into() };
                o.status = "CLOSED".into();
                self.finish("CLOSED");
            }
            None => {
                o.exit_px = px;
                o.exit_ns = ts;
                o.exit_role = "TIME".into();
                o.status = "CLOSED".into();
                let ids: Vec<ClientOrderId> = self.roles.iter().filter(|(_, r)| **r != Role::Entry).map(|(k, _)| *k).collect();
                for id in ids { let _ = self.cancel_order(id, None, None); }
                self.finish("CLOSED");
            }
        }
    }
    fn on_order_expired(&mut self, event: OrderExpired) {
        if self.roles.get(&event.client_order_id) == Some(&Role::Entry) && !self.in_position {
            self.finish("EXPIRED");
        }
    }
    fn on_order_canceled(&mut self, event: &OrderCanceled) {
        if self.roles.get(&event.client_order_id) == Some(&Role::Entry) && !self.in_position {
            self.finish("CANCELED");
        }
    }
    fn on_order_rejected(&mut self, event: OrderRejected) {
        if self.roles.get(&event.client_order_id) == Some(&Role::Entry) {
            self.finish(&format!("REJECTED:{}", event.reason));
        }
    }
    fn on_order_denied(&mut self, event: OrderDenied) {
        if self.roles.get(&event.client_order_id) == Some(&Role::Entry) {
            self.finish(&format!("DENIED:{}", event.reason));
        }
    }
});

impl Debug for Replay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Replay").finish()
    }
}

impl DataActor for Replay {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.subscribe_bars(self.bar_type, None, None);
        Ok(())
    }

    fn on_bar(&mut self, bar: &Bar) -> anyhow::Result<()> {
        let ts = bar.ts_event.as_u64();
        // time exit
        if self.in_position && !self.closing && ts >= self.deadline {
            self.closing = true;
            let iid = self.instrument_id;
            self.close_all_positions(iid, None, None, Some(vec![Ustr::from("TIME")]), None, Some(true), None, None)?;
        }
        // an unfilled limit entry whose bar has passed is gone, exactly as in the Python simulator
        if self.current.is_some() && !self.in_position && self.entry_expire > 0 && ts >= self.entry_expire {
            let ids: Vec<ClientOrderId> = self.roles.keys().copied().collect();
            for id in ids { let _ = self.cancel_order(id, None, None); }
            self.finish("EXPIRED");
        }
        while let Some(p) = self.plans.front() {
            if p.submit_ns > ts {
                break;
            }
            let p = self.plans.pop_front().unwrap();
            if p.submit_ns < ts {
                continue; // bar missing at submit time
            }
            if self.current.is_some() {
                *self.skipped_busy.borrow_mut() += 1;
                continue;
            }
            let side = if p.side > 0 { OrderSide::Buy } else { OrderSide::Sell };
            let limit = p.kind == "LIMIT";
            let orders = self
                .order()
                .bracket()
                .instrument_id(self.instrument_id)
                .order_side(side)
                .quantity(Quantity::from("1.000"))
                .entry_order_type(if limit { OrderType::Limit } else { OrderType::Market })
                .maybe_entry_price(limit.then(|| Price::new(p.entry, 2)))
                .maybe_expire_time(limit.then(|| UnixNanos::from(p.expire_ns + 1)))
                .time_in_force(if limit { TimeInForce::Gtd } else { TimeInForce::Gtc })
                .tp_price(Price::new(p.target, 2))
                .tp_post_only(false)
                .sl_trigger_price(Price::new(p.stop, 2))
                .call();
            self.roles.clear();
            for o in &orders {
                let tags = o.tags().map(|t| t.to_vec()).unwrap_or_default();
                let role = if tags.contains(&Ustr::from("ENTRY")) {
                    Role::Entry
                } else if tags.contains(&Ustr::from("TAKE_PROFIT")) {
                    Role::Tp
                } else {
                    Role::Sl
                };
                self.roles.insert(o.client_order_id(), role);
            }
            self.current = Some(Outcome {
                id: p.id.clone(),
                side: p.side,
                plan_entry: p.entry,
                stop: p.stop,
                target: p.target,
                ..Default::default()
            });
            self.deadline = p.deadline_ns;
            self.entry_expire = if limit { p.expire_ns } else { 0 };
            self.in_position = false;
            self.closing = false;
            self.submit_order_list(orders, None, None, None)?;
        }
        Ok(())
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (bars_path, orders_path, key, adaptive, out_path) =
        (&args[1], &args[2], &args[3], args[4] == "1", &args[5]);

    let instrument = CryptoPerpetual::new(
        InstrumentId::from("BTCUSDT-PERP.BINANCE"),
        Symbol::from("BTCUSDT"),
        Currency::from("BTC"),
        Currency::from("USDT"),
        Currency::from("USDT"),
        false,
        2,
        3,
        Price::from("0.01"),
        Quantity::from("0.001"),
        None,
        None,
        Some(Quantity::from("100000.0")),
        Some(Quantity::from("0.001")),
        None,
        Some(Money::new(1.00, Currency::from("USDT"))),
        Some(Price::from("10000000.00")),
        Some(Price::from("0.01")),
        Some(dec!(0.1)),
        Some(dec!(0.05)),
        Some(dec!(0.0002)),
        Some(dec!(0.0005)),
        None,
        None,
        UnixNanos::default(),
        UnixNanos::default(),
    );
    let instrument = InstrumentAny::CryptoPerpetual(instrument);
    let iid = instrument.id();
    let spec_min: usize = if bars_path.contains("1m") { 1 } else { 4 };
    let bar_type = BarType::new(
        iid,
        if spec_min == 1 {
            BarSpecification::new(1, BarAggregation::Minute, PriceType::Last)
        } else {
            BarSpecification::new(4, BarAggregation::Hour, PriceType::Last)
        },
        AggregationSource::External,
    );

    let config = BacktestEngineConfig { bypass_logging: true, run_analysis: false, ..Default::default() };
    let mut engine = BacktestEngine::new(config)?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(iid.venue)
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![Money::from("100_000_000 USDT")])
            .trade_on_close(false)
            .use_market_order_acks(std::env::var("NO_ACKS").is_err())
            .reject_stop_orders(std::env::var("REJECT_STOPS").is_ok())
            .bar_execution(true)
            .bar_adaptive_high_low_ordering(adaptive)
            .build()?,
    )?;
    engine.add_instrument(&instrument)?;

    let all: HashMap<String, Vec<Plan>> = serde_json::from_str(&std::fs::read_to_string(orders_path)?)?;
    let mut plans = all[key.as_str()].clone();
    plans.sort_by_key(|p| p.submit_ns);
    let out = Rc::new(RefCell::new(Vec::new()));
    let skipped = Rc::new(RefCell::new(0u64));
    let cfg = StrategyConfig {
        strategy_id: Some(StrategyId::from("REPLAY-001")),
        order_id_tag: Some("001".to_string()),
        ..Default::default()
    };
    engine.add_strategy(Replay {
        core: StrategyCore::new(cfg),
        instrument_id: iid,
        bar_type,
        plans: plans.into(),
        roles: HashMap::new(),
        current: None,
        deadline: 0,
        entry_expire: 0,
        in_position: false,
        closing: false,
        skipped_busy: Rc::clone(&skipped),
        out: Rc::clone(&out),
    })?;

    // bars, streamed in chunks to bound memory
    let text = std::fs::read_to_string(bars_path)?;
    let mut data = Vec::new();
    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split(',').collect();
        let ts: u64 = f[5].parse()?;
        let px = |s: &str| -> anyhow::Result<Price> { Ok(Price::new(s.parse::<f64>()?, 2)) };
        data.push(Data::Bar(Bar::new(
            bar_type,
            px(f[0])?,
            px(f[1])?,
            px(f[2])?,
            px(f[3])?,
            Quantity::from("1000000.000"),
            ts.into(),
            ts.into(),
        )));
    }
    eprintln!("bars {}", data.len());
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, None, false)?;

    let mut w = std::fs::File::create(out_path)?;
    writeln!(w, "id,side,plan_entry,stop,target,status,entry_px,entry_ns,exit_px,exit_ns,exit_role,commission")?;
    for o in out.borrow().iter() {
        writeln!(
            w,
            "{},{},{},{},{},{},{},{},{},{},{},{}",
            o.id, o.side, o.plan_entry, o.stop, o.target, o.status, o.entry_px, o.entry_ns, o.exit_px, o.exit_ns, o.exit_role, o.commission
        )?;
    }
    eprintln!("outcomes {} skipped_busy {}", out.borrow().len(), skipped.borrow());
    Ok(())
}
