use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use vibe_serialization::sbe::SbeCursor;

trait FailLoud<T> {
    #[track_caller]
    fn fail_loud(self) -> T;

    #[track_caller]
    fn fail_loud_with(self, context: &str) -> T;
}

impl<T> FailLoud<T> for Option<T> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|| panic!("called `Option::unwrap()` on a `None` value"))
    }

    #[track_caller]
    fn fail_loud_with(self, context: &str) -> T {
        self.unwrap_or_else(|| panic!("{context}"))
    }
}

impl<T, E: std::fmt::Debug> FailLoud<T> for Result<T, E> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|e| panic!("called `Result::unwrap()` on an `Err` value: {e:?}"))
    }

    #[track_caller]
    fn fail_loud_with(self, context: &str) -> T {
        self.unwrap_or_else(|e| panic!("{context}: {e:?}"))
    }
}

fn make_i64_buffer(count: usize) -> Vec<u8> {
    let mut buf = Vec::with_capacity(count * 8);
    for i in 0..count {
        let value = i64::try_from(i).fail_loud_with("benchmark index must fit in i64");
        buf.extend_from_slice(&value.to_le_bytes());
    }
    buf
}

fn make_var_string8_buffer(count: usize, value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let len = u8::try_from(bytes.len()).fail_loud_with("value must fit in varString8");
    let mut buf = Vec::with_capacity(count * (usize::from(len) + 1));

    for _ in 0..count {
        buf.push(len);
        buf.extend_from_slice(bytes);
    }
    buf
}

fn make_group_buffer(count: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(6 + count as usize * 16);
    buf.extend_from_slice(&16u16.to_le_bytes()); // block_length
    buf.extend_from_slice(&count.to_le_bytes()); // num_in_group

    for i in 0..count {
        buf.extend_from_slice(&(10_000 + i64::from(i)).to_le_bytes());
        buf.extend_from_slice(&(20_000 + i64::from(i)).to_le_bytes());
    }

    buf
}

fn bench_read_i64(c: &mut Criterion) {
    let count = 1024;
    let data = make_i64_buffer(count);

    c.bench_function("SbeCursor::read_i64_le x1024", |b| {
        b.iter(|| {
            let mut cursor = SbeCursor::new(&data);
            let mut sum = 0i64;

            for _ in 0..count {
                sum += cursor.read_i64_le().fail_loud();
            }

            black_box(sum)
        });
    });
}

fn bench_read_var_string8_ref(c: &mut Criterion) {
    let count = 512;
    let data = make_var_string8_buffer(count, "BTCUSDT");

    c.bench_function("SbeCursor::read_var_string8_ref x512", |b| {
        b.iter(|| {
            let mut cursor = SbeCursor::new(&data);
            let mut total_len = 0usize;

            for _ in 0..count {
                total_len += cursor.read_var_string8_ref().fail_loud().len();
            }

            black_box(total_len)
        });
    });
}

fn bench_read_group(c: &mut Criterion) {
    let data = make_group_buffer(256);

    c.bench_function("SbeCursor::read_group (256 levels)", |b| {
        b.iter(|| {
            let mut cursor = SbeCursor::new(&data);
            let (block_length, count) = cursor.read_group_header().fail_loud();

            let levels = cursor
                .read_group(block_length, count, |cur| {
                    let price = cur.read_i64_le()?;
                    let qty = cur.read_i64_le()?;
                    Ok((price, qty))
                })
                .fail_loud();

            black_box(levels.len())
        });
    });
}

criterion_group!(
    sbe_cursor_benches,
    bench_read_i64,
    bench_read_var_string8_ref,
    bench_read_group
);
criterion_main!(sbe_cursor_benches);
