use std::hint::black_box;

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use vibe_core::{
    UnixNanos,
    datetime::{unix_nanos_to_iso8601, unix_nanos_to_iso8601_millis},
};

const EPOCH: u64 = 0;
const CURRENT_SAMPLE: u64 = 1_707_578_323_456_789_123;
const MILLIS_SAMPLE: u64 = 1_707_578_323_456_000_000;

fn max_chrono_nanos() -> u64 {
    u64::try_from(i64::MAX).expect("i64::MAX fits in u64")
}

fn raw_fallback_nanos() -> u64 {
    max_chrono_nanos() + 1
}

fn bench_unix_nanos_to_iso8601(c: &mut Criterion) {
    let mut group = c.benchmark_group("datetime/unix_nanos_to_iso8601");
    let cases = [
        ("epoch", EPOCH),
        ("current_sample", CURRENT_SAMPLE),
        ("max_chrono", max_chrono_nanos()),
        ("raw_fallback", raw_fallback_nanos()),
    ];

    for (name, nanos) in cases {
        group.bench_with_input(BenchmarkId::from_parameter(name), &nanos, |b, &nanos| {
            b.iter(|| unix_nanos_to_iso8601(UnixNanos::from(black_box(nanos))));
        });
    }
    group.finish();
}

fn bench_unix_nanos_to_iso8601_millis(c: &mut Criterion) {
    let mut group = c.benchmark_group("datetime/unix_nanos_to_iso8601_millis");
    let cases = [
        ("epoch", EPOCH),
        ("millis_sample", MILLIS_SAMPLE),
        ("raw_fallback", raw_fallback_nanos()),
    ];

    for (name, nanos) in cases {
        group.bench_with_input(BenchmarkId::from_parameter(name), &nanos, |b, &nanos| {
            b.iter(|| unix_nanos_to_iso8601_millis(UnixNanos::from(black_box(nanos))));
        });
    }
    group.finish();
}

fn bench_logging_style_line(c: &mut Criterion) {
    let timestamp = UnixNanos::from(CURRENT_SAMPLE);
    c.bench_function("datetime/logging_style_line", |b| {
        b.iter(|| {
            format!(
                "{} INFO Trader-001 RiskEngine order accepted",
                unix_nanos_to_iso8601(black_box(timestamp))
            )
        });
    });
}

criterion_group!(
    benches,
    bench_unix_nanos_to_iso8601,
    bench_unix_nanos_to_iso8601_millis,
    bench_logging_style_line,
);
criterion_main!(benches);
