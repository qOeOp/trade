use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use vibe_tardis::machine::message::TradeMsg;

const TRADE: &[u8] = include_bytes!("../test_data/trade.json");

fn bench_messages(c: &mut Criterion) {
    let mut group = c.benchmark_group("ingest_parse");
    group.throughput(Throughput::Elements(1));
    group.bench_function("trade", |b| {
        b.iter(|| {
            let message = serde_json::from_slice::<TradeMsg>(black_box(TRADE)).unwrap();
            black_box(message);
        });
    });
    group.finish();
}

criterion_group!(benches, bench_messages);
criterion_main!(benches);
