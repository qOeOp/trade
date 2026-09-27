use std::hint::black_box;

use criterion::{Criterion, criterion_group};
use vibe_model::types::fixed::{
    FIXED_PRECISION, FIXED_SCALAR, check_fixed_raw_i64, check_fixed_raw_i128, check_fixed_raw_u64,
    check_fixed_raw_u128, f64_to_fixed_i64, f64_to_fixed_i128, fixed_i64_to_f64,
    fixed_i128_at_precision_to_f64, fixed_i128_to_f64,
};

pub fn bench_fixed_i64(c: &mut Criterion) {
    c.bench_function("f64_to_fixed_i64", |b| {
        b.iter(|| f64_to_fixed_i64(black_box(-1.0), black_box(1)));
    });
}

pub fn bench_fixed_i128(c: &mut Criterion) {
    c.bench_function("f64_to_fixed_i128", |b| {
        b.iter(|| f64_to_fixed_i128(black_box(-1.0), black_box(1)));
    });
}

pub fn bench_check_fixed_raw_u64(c: &mut Criterion) {
    // Valid raw value: 120 with precision 0 -> raw = 120 * 10^9
    let valid_raw: u64 = 120_000_000_000;
    c.bench_function("check_fixed_raw_u64_valid", |b| {
        b.iter(|| check_fixed_raw_u64(black_box(valid_raw), black_box(0)));
    });
}

pub fn bench_check_fixed_raw_u128(c: &mut Criterion) {
    let valid_raw: u128 = 120_000_000_000;
    c.bench_function("check_fixed_raw_u128_valid", |b| {
        b.iter(|| check_fixed_raw_u128(black_box(valid_raw), black_box(0)));
    });
}

pub fn bench_check_fixed_raw_i64(c: &mut Criterion) {
    let valid_raw: i64 = 120_000_000_000;
    c.bench_function("check_fixed_raw_i64_valid", |b| {
        b.iter(|| check_fixed_raw_i64(black_box(valid_raw), black_box(0)));
    });
}

pub fn bench_check_fixed_raw_i128(c: &mut Criterion) {
    let valid_raw: i128 = 120_000_000_000;
    c.bench_function("check_fixed_raw_i128_valid", |b| {
        b.iter(|| check_fixed_raw_i128(black_box(valid_raw), black_box(0)));
    });
}

pub fn bench_check_fixed_raw_u64_high_precision(c: &mut Criterion) {
    // Valid raw value with precision 8 -> raw = 120 * 10^(9-8) = 120 * 10 = 1200
    let valid_raw: u64 = 1200;
    c.bench_function("check_fixed_raw_u64_prec8", |b| {
        b.iter(|| check_fixed_raw_u64(black_box(valid_raw), black_box(8)));
    });
}

/// 1024 raw values shaped like what the engine converts: prices at 2 decimals between 100 and
/// 100000, quantities at 0 to 8 decimals, and money at 2 decimals up to 10 million, as
/// `coefficient * 10^(FIXED_PRECISION - precision)`.
fn engine_shaped_raw_values() -> Vec<(i128, u8)> {
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    (0..1024)
        .map(|i| {
            let (coefficient, precision) = match i % 3 {
                0 => (10_000 + i128::from(next() % 9_990_000), 2),
                1 => {
                    let precision = (next() % 9) as u8;
                    (i128::from(next() % 1_000_000_000), precision)
                }
                _ => (i128::from(next() % 1_000_000_000), 2),
            };
            (
                coefficient * 10_i128.pow(u32::from(FIXED_PRECISION - precision)),
                precision,
            )
        })
        .collect()
}

/// The previous conversion, kept here only as the benchmark's baseline.
#[expect(clippy::cast_precision_loss, reason = "the baseline being measured")]
fn legacy_i128_to_f64(value: i128) -> f64 {
    (value as f64) / FIXED_SCALAR
}

pub fn bench_raw_to_f64(c: &mut Criterion) {
    let typed = engine_shaped_raw_values();
    let values: Vec<i128> = typed.iter().map(|&(raw, _)| raw).collect();
    let narrow: Vec<i64> = values
        .iter()
        .filter_map(|&raw| i64::try_from(raw).ok())
        .collect();
    c.bench_function("raw_to_f64_legacy_x1024", |b| {
        b.iter(|| {
            values
                .iter()
                .map(|&raw| legacy_i128_to_f64(black_box(raw)))
                .sum::<f64>()
        });
    });
    c.bench_function("fixed_i128_to_f64_x1024", |b| {
        b.iter(|| {
            values
                .iter()
                .map(|&raw| fixed_i128_to_f64(black_box(raw)))
                .sum::<f64>()
        });
    });
    c.bench_function("fixed_i128_at_precision_to_f64_x1024", |b| {
        b.iter(|| {
            typed
                .iter()
                .map(|&(raw, precision)| fixed_i128_at_precision_to_f64(black_box(raw), precision))
                .sum::<f64>()
        });
    });
    c.bench_function(&format!("fixed_i64_to_f64_x{}", narrow.len()), |b| {
        b.iter(|| {
            narrow
                .iter()
                .map(|&raw| fixed_i64_to_f64(black_box(raw)))
                .sum::<f64>()
        });
    });
}

criterion_group!(
    benches,
    bench_raw_to_f64,
    bench_fixed_i64,
    bench_fixed_i128,
    bench_check_fixed_raw_u64,
    bench_check_fixed_raw_u128,
    bench_check_fixed_raw_i64,
    bench_check_fixed_raw_i128,
    bench_check_fixed_raw_u64_high_precision,
);
criterion::criterion_main!(benches);
