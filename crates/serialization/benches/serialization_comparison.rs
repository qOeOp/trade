//! Comparison benchmarks across different serialization formats.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use vibe_core::serialization::{FromMsgPack, Serializable, ToMsgPack};
use vibe_model::{
    data::{
        QuoteTick, TradeTick,
        bar::{Bar, BarSpecification, BarType},
    },
    enums::{AggregationSource, AggressorSide, BarAggregation, PriceType},
    identifiers::{InstrumentId, TradeId},
    types::{Price, Quantity},
};
#[cfg(feature = "capnp")]
use vibe_serialization::capnp::{FromCapnp, ToCapnp, market_capnp};

trait FailLoud<T> {
    #[track_caller]
    fn fail_loud(self) -> T;
}

impl<T> FailLoud<T> for Option<T> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|| panic!("called `Option::unwrap()` on a `None` value"))
    }
}

impl<T, E: std::fmt::Debug> FailLoud<T> for Result<T, E> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|error| {
            panic!("called `Result::unwrap()` on an `Err` value: {error:?}")
        })
    }
}

fn create_quote_tick() -> QuoteTick {
    QuoteTick {
        instrument_id: InstrumentId::from("AAPL.XNAS"),
        bid_price: Price::from("100.50"),
        ask_price: Price::from("100.55"),
        bid_size: Quantity::from("100"),
        ask_size: Quantity::from("100"),
        ts_event: 1_609_459_200_000_000_000.into(),
        ts_init: 1_609_459_200_000_000_000.into(),
    }
}

fn create_trade_tick() -> TradeTick {
    TradeTick {
        instrument_id: InstrumentId::from("ETHUSDT.BINANCE"),
        price: Price::from("2500.75"),
        size: Quantity::from("1.5"),
        aggressor_side: AggressorSide::Buyer,
        trade_id: TradeId::from("12345"),
        ts_event: 1_609_459_200_000_000_000.into(),
        ts_init: 1_609_459_200_000_000_000.into(),
    }
}

fn create_bar() -> Bar {
    let bar_type = BarType::new(
        InstrumentId::from("AAPL.XNAS"),
        BarSpecification::new(1, BarAggregation::Minute, PriceType::Last),
        AggregationSource::Internal,
    );
    Bar::new(
        bar_type,
        Price::from("150.00"),
        Price::from("152.50"),
        Price::from("149.75"),
        Price::from("151.25"),
        Quantity::from("100000"),
        1_609_459_200_000_000_000.into(),
        1_609_459_200_000_000_000.into(),
    )
}

// QuoteTick benchmarks

fn bench_quote_tick_json_serialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    c.bench_function("QuoteTick::json_serialize", |b| {
        b.iter(|| black_box(black_box(&quote).to_json_bytes().fail_loud()));
    });
}

fn bench_quote_tick_json_deserialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    let bytes = quote.to_json_bytes().fail_loud();
    c.bench_function("QuoteTick::json_deserialize", |b| {
        b.iter(|| black_box(QuoteTick::from_json_bytes(black_box(&bytes)).fail_loud()));
    });
}

fn bench_quote_tick_msgpack_serialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    c.bench_function("QuoteTick::msgpack_serialize", |b| {
        b.iter(|| black_box(black_box(&quote).to_msgpack_bytes().fail_loud()));
    });
}

fn bench_quote_tick_msgpack_deserialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    let bytes = quote.to_msgpack_bytes().fail_loud();
    c.bench_function("QuoteTick::msgpack_deserialize", |b| {
        b.iter(|| black_box(QuoteTick::from_msgpack_bytes(black_box(&bytes)).fail_loud()));
    });
}

#[cfg(feature = "capnp")]
fn bench_quote_tick_capnp_serialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    c.bench_function("QuoteTick::capnp_serialize", |b| {
        b.iter(|| {
            let mut message = capnp::message::Builder::new_default();
            let builder = message.init_root::<market_capnp::quote_tick::Builder>();
            black_box(&quote).to_capnp(builder);
            let mut bytes = Vec::new();
            capnp::serialize::write_message(&mut bytes, &message).fail_loud();
            black_box(bytes)
        });
    });
}

#[cfg(feature = "capnp")]
fn bench_quote_tick_capnp_deserialize(c: &mut Criterion) {
    let quote = create_quote_tick();
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<market_capnp::quote_tick::Builder>();
    quote.to_capnp(builder);
    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    c.bench_function("QuoteTick::capnp_deserialize", |b| {
        b.iter(|| {
            let reader = capnp::serialize::read_message(
                &mut black_box(&bytes[..]),
                capnp::message::ReaderOptions::new(),
            )
            .fail_loud();
            let root = reader
                .get_root::<market_capnp::quote_tick::Reader>()
                .fail_loud();
            black_box(QuoteTick::from_capnp(root).fail_loud())
        });
    });
}

// TradeTick benchmarks

fn bench_trade_tick_json_serialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    c.bench_function("TradeTick::json_serialize", |b| {
        b.iter(|| black_box(black_box(&trade).to_json_bytes().fail_loud()));
    });
}

fn bench_trade_tick_json_deserialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    let bytes = trade.to_json_bytes().fail_loud();
    c.bench_function("TradeTick::json_deserialize", |b| {
        b.iter(|| black_box(TradeTick::from_json_bytes(black_box(&bytes)).fail_loud()));
    });
}

fn bench_trade_tick_msgpack_serialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    c.bench_function("TradeTick::msgpack_serialize", |b| {
        b.iter(|| black_box(black_box(&trade).to_msgpack_bytes().fail_loud()));
    });
}

fn bench_trade_tick_msgpack_deserialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    let bytes = trade.to_msgpack_bytes().fail_loud();
    c.bench_function("TradeTick::msgpack_deserialize", |b| {
        b.iter(|| black_box(TradeTick::from_msgpack_bytes(black_box(&bytes)).fail_loud()));
    });
}

#[cfg(feature = "capnp")]
fn bench_trade_tick_capnp_serialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    c.bench_function("TradeTick::capnp_serialize", |b| {
        b.iter(|| {
            let mut message = capnp::message::Builder::new_default();
            let builder = message.init_root::<market_capnp::trade_tick::Builder>();
            black_box(&trade).to_capnp(builder);
            let mut bytes = Vec::new();
            capnp::serialize::write_message(&mut bytes, &message).fail_loud();
            black_box(bytes)
        });
    });
}

#[cfg(feature = "capnp")]
fn bench_trade_tick_capnp_deserialize(c: &mut Criterion) {
    let trade = create_trade_tick();
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<market_capnp::trade_tick::Builder>();
    trade.to_capnp(builder);
    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    c.bench_function("TradeTick::capnp_deserialize", |b| {
        b.iter(|| {
            let reader = capnp::serialize::read_message(
                &mut black_box(&bytes[..]),
                capnp::message::ReaderOptions::new(),
            )
            .fail_loud();
            let root = reader
                .get_root::<market_capnp::trade_tick::Reader>()
                .fail_loud();
            black_box(TradeTick::from_capnp(root).fail_loud())
        });
    });
}

// Bar benchmarks

fn bench_bar_json_serialize(c: &mut Criterion) {
    let bar = create_bar();
    c.bench_function("Bar::json_serialize", |b| {
        b.iter(|| black_box(black_box(&bar).to_json_bytes().fail_loud()));
    });
}

fn bench_bar_json_deserialize(c: &mut Criterion) {
    let bar = create_bar();
    let bytes = bar.to_json_bytes().fail_loud();
    c.bench_function("Bar::json_deserialize", |b| {
        b.iter(|| black_box(Bar::from_json_bytes(black_box(&bytes)).fail_loud()));
    });
}

fn bench_bar_msgpack_serialize(c: &mut Criterion) {
    let bar = create_bar();
    c.bench_function("Bar::msgpack_serialize", |b| {
        b.iter(|| black_box(black_box(&bar).to_msgpack_bytes().fail_loud()));
    });
}

fn bench_bar_msgpack_deserialize(c: &mut Criterion) {
    let bar = create_bar();
    let bytes = bar.to_msgpack_bytes().fail_loud();
    c.bench_function("Bar::msgpack_deserialize", |b| {
        b.iter(|| black_box(Bar::from_msgpack_bytes(black_box(&bytes)).fail_loud()));
    });
}

#[cfg(feature = "capnp")]
fn bench_bar_capnp_serialize(c: &mut Criterion) {
    let bar = create_bar();
    c.bench_function("Bar::capnp_serialize", |b| {
        b.iter(|| {
            let mut message = capnp::message::Builder::new_default();
            let builder = message.init_root::<market_capnp::bar::Builder>();
            black_box(&bar).to_capnp(builder);
            let mut bytes = Vec::new();
            capnp::serialize::write_message(&mut bytes, &message).fail_loud();
            black_box(bytes)
        });
    });
}

#[cfg(feature = "capnp")]
fn bench_bar_capnp_deserialize(c: &mut Criterion) {
    let bar = create_bar();
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<market_capnp::bar::Builder>();
    bar.to_capnp(builder);
    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    c.bench_function("Bar::capnp_deserialize", |b| {
        b.iter(|| {
            let reader = capnp::serialize::read_message(
                &mut black_box(&bytes[..]),
                capnp::message::ReaderOptions::new(),
            )
            .fail_loud();
            let root = reader.get_root::<market_capnp::bar::Reader>().fail_loud();
            black_box(Bar::from_capnp(root).fail_loud())
        });
    });
}

#[cfg(feature = "capnp")]
criterion_group!(
    quote_tick_benches,
    bench_quote_tick_json_serialize,
    bench_quote_tick_json_deserialize,
    bench_quote_tick_msgpack_serialize,
    bench_quote_tick_msgpack_deserialize,
    bench_quote_tick_capnp_serialize,
    bench_quote_tick_capnp_deserialize,
);

#[cfg(not(feature = "capnp"))]
criterion_group!(
    quote_tick_benches,
    bench_quote_tick_json_serialize,
    bench_quote_tick_json_deserialize,
    bench_quote_tick_msgpack_serialize,
    bench_quote_tick_msgpack_deserialize,
);

#[cfg(feature = "capnp")]
criterion_group!(
    trade_tick_benches,
    bench_trade_tick_json_serialize,
    bench_trade_tick_json_deserialize,
    bench_trade_tick_msgpack_serialize,
    bench_trade_tick_msgpack_deserialize,
    bench_trade_tick_capnp_serialize,
    bench_trade_tick_capnp_deserialize,
);

#[cfg(not(feature = "capnp"))]
criterion_group!(
    trade_tick_benches,
    bench_trade_tick_json_serialize,
    bench_trade_tick_json_deserialize,
    bench_trade_tick_msgpack_serialize,
    bench_trade_tick_msgpack_deserialize,
);

#[cfg(feature = "capnp")]
criterion_group!(
    bar_benches,
    bench_bar_json_serialize,
    bench_bar_json_deserialize,
    bench_bar_msgpack_serialize,
    bench_bar_msgpack_deserialize,
    bench_bar_capnp_serialize,
    bench_bar_capnp_deserialize,
);

#[cfg(not(feature = "capnp"))]
criterion_group!(
    bar_benches,
    bench_bar_json_serialize,
    bench_bar_json_deserialize,
    bench_bar_msgpack_serialize,
    bench_bar_msgpack_deserialize,
);

criterion_main!(quote_tick_benches, trade_tick_benches, bar_benches);
