//! Benchmarks for applying fills to an order.
//!
//! Targets the average-price hot path of `Order::apply`: each fill folds every surviving fill
//! event into a `Decimal` notional and quantity, so per-fill cost grows with the fills already
//! recorded. The fill counts span a single fill through a heavily worked algorithmic order,
//! which is the range that decides whether a persisted accumulator is worth its serialization
//! and replay contract.
//!
//! Run with `cargo bench -p vibe-model --bench order_fills_criterion`.

use std::hint::black_box;

use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use vibe_core::{UUID4, UnixNanos};
use vibe_model::{
    enums::{LiquiditySide, OrderSide, OrderType, TimeInForce},
    events::{OrderAccepted, OrderEventAny, OrderFilled},
    identifiers::{
        AccountId, ClientOrderId, InstrumentId, StrategyId, TradeId, TraderId, VenueOrderId,
    },
    orders::MarketOrder,
    types::{Currency, Price, Quantity},
};

const FILL_COUNTS: [u64; 4] = [1, 8, 64, 512];
const TRADER_ID: &str = "TRADER-001";
const STRATEGY_ID: &str = "S-001";
const INSTRUMENT_ID: &str = "ETHUSDT-PERP.BINANCE";
const CLIENT_ORDER_ID: &str = "O-19700101-000000-001-001-1";
const VENUE_ORDER_ID: &str = "1";
const ACCOUNT_ID: &str = "SIM-001";
// Distinct prices so no fill folds into a previously accumulated notional by chance.
const PRICES: [&str; 6] = [
    "1.00001", "1.00002", "1.00003", "1.00004", "1.00005", "1.00006",
];

fn accepted_market_order(quantity: Quantity) -> MarketOrder {
    let mut order = MarketOrder::new(
        TraderId::from(TRADER_ID),
        StrategyId::from(STRATEGY_ID),
        InstrumentId::from(INSTRUMENT_ID),
        ClientOrderId::from(CLIENT_ORDER_ID),
        OrderSide::Buy,
        quantity,
        TimeInForce::Gtc,
        UUID4::new(),
        UnixNanos::default(),
        false,
        false,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );

    let accepted = OrderAccepted::new(
        TraderId::from(TRADER_ID),
        StrategyId::from(STRATEGY_ID),
        InstrumentId::from(INSTRUMENT_ID),
        ClientOrderId::from(CLIENT_ORDER_ID),
        VenueOrderId::from(VENUE_ORDER_ID),
        AccountId::from(ACCOUNT_ID),
        UUID4::new(),
        UnixNanos::default(),
        UnixNanos::default(),
        false,
    );
    order
        .apply(OrderEventAny::Accepted(accepted))
        .unwrap_or_else(|error| panic!("benchmark acceptance event must apply: {error:?}"));

    order
}

fn fill_events(count: u64) -> Vec<OrderEventAny> {
    (0..count)
        .map(|i| {
            OrderEventAny::Filled(OrderFilled::new(
                TraderId::from(TRADER_ID),
                StrategyId::from(STRATEGY_ID),
                InstrumentId::from(INSTRUMENT_ID),
                ClientOrderId::from(CLIENT_ORDER_ID),
                VenueOrderId::from(VENUE_ORDER_ID),
                AccountId::from(ACCOUNT_ID),
                TradeId::from(format!("TRADE-{i}").as_str()),
                OrderSide::Buy,
                OrderType::Market,
                Quantity::from(1),
                Price::from(PRICES[(i as usize) % PRICES.len()]),
                Currency::USDT(),
                LiquiditySide::Taker,
                UUID4::new(),
                i.into(),
                i.into(),
                false,
                None,
                None,
                None,
            ))
        })
        .collect()
}

fn bench_order_fills(c: &mut Criterion) {
    let mut group = c.benchmark_group("order_fills");

    for count in FILL_COUNTS {
        let events = fill_events(count);
        group.throughput(Throughput::Elements(count));
        group.bench_with_input(BenchmarkId::from_parameter(count), &events, |b, events| {
            b.iter_batched_ref(
                || accepted_market_order(Quantity::from(count)),
                |order| {
                    for event in events {
                        order
                            .apply(black_box(event.clone()))
                            .unwrap_or_else(|error| {
                                panic!("benchmark fill event must apply: {error:?}")
                            });
                    }
                },
                BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

criterion_group!(benches, bench_order_fills);
criterion_main!(benches);
