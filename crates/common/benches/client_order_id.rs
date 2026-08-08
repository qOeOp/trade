use std::{cell::RefCell, hint::black_box, rc::Rc};

use criterion::{Criterion, criterion_group, criterion_main};
use vibe_common::{clock::TestClock, generators::client_order_id::ClientOrderIdGenerator};
use vibe_core::UnixNanos;
use vibe_model::identifiers::{StrategyId, TraderId};

const SECOND_NS: u64 = 1_000_000_000;

fn make_generator(clock: Rc<RefCell<TestClock>>, use_hyphens: bool) -> ClientOrderIdGenerator {
    ClientOrderIdGenerator::new(
        TraderId::from("TRADER-101"),
        StrategyId::from("STRATEGY-101"),
        0,
        clock,
        false,
        use_hyphens,
    )
}

fn bench_same_second_hyphenated(c: &mut Criterion) {
    c.bench_function("client_order_id/same_second_hyphenated", |b| {
        let mut generator = make_generator(Rc::new(RefCell::new(TestClock::new())), true);
        b.iter(|| black_box(generator.generate()));
    });
}

fn bench_same_second_no_hyphens(c: &mut Criterion) {
    c.bench_function("client_order_id/same_second_no_hyphens", |b| {
        let mut generator = make_generator(Rc::new(RefCell::new(TestClock::new())), false);
        b.iter(|| black_box(generator.generate()));
    });
}

fn bench_cross_second_hyphenated(c: &mut Criterion) {
    c.bench_function("client_order_id/cross_second_hyphenated", |b| {
        let clock = Rc::new(RefCell::new(TestClock::new()));
        let mut generator = make_generator(clock.clone(), true);
        let mut next_ns = 0_u64;
        b.iter(|| {
            next_ns += SECOND_NS;
            clock.borrow_mut().set_time(UnixNanos::from(next_ns));
            black_box(generator.generate())
        });
    });
}

criterion_group!(
    benches,
    bench_same_second_hyphenated,
    bench_same_second_no_hyphens,
    bench_cross_second_hyphenated,
);
criterion_main!(benches);
