use std::{cell::RefCell, hint::black_box, rc::Rc};

use criterion::{Criterion, criterion_group, criterion_main};
use vibe_common::{clock::TestClock, generators::position_id::PositionIdGenerator};
use vibe_core::UnixNanos;
use vibe_model::identifiers::{StrategyId, TraderId};

const SECOND_NS: u64 = 1_000_000_000;

fn make_generator(clock: Rc<RefCell<TestClock>>) -> PositionIdGenerator {
    PositionIdGenerator::new(TraderId::from("TRADER-101"), clock)
}

fn bench_same_second_one_strategy(c: &mut Criterion) {
    let strategy = StrategyId::from("STRATEGY-101");
    c.bench_function("position_id/same_second_one_strategy", |b| {
        let mut generator = make_generator(Rc::new(RefCell::new(TestClock::new())));
        b.iter(|| black_box(generator.generate(strategy, false)));
    });
}

fn bench_same_second_rotating_strategies(c: &mut Criterion) {
    let strategies = [
        StrategyId::from("STRATEGY-001"),
        StrategyId::from("STRATEGY-002"),
        StrategyId::from("STRATEGY-003"),
        StrategyId::from("STRATEGY-004"),
    ];
    c.bench_function("position_id/same_second_rotating_strategies", |b| {
        let mut generator = make_generator(Rc::new(RefCell::new(TestClock::new())));
        let mut idx = 0_usize;
        b.iter(|| {
            let strategy = strategies[idx % strategies.len()];
            idx += 1;
            black_box(generator.generate(strategy, false))
        });
    });
}

fn bench_cross_second_one_strategy(c: &mut Criterion) {
    let strategy = StrategyId::from("STRATEGY-101");
    c.bench_function("position_id/cross_second_one_strategy", |b| {
        let clock = Rc::new(RefCell::new(TestClock::new()));
        let mut generator = make_generator(clock.clone());
        let mut next_ns = 0_u64;
        b.iter(|| {
            next_ns += SECOND_NS;
            clock.borrow_mut().set_time(UnixNanos::from(next_ns));
            black_box(generator.generate(strategy, false))
        });
    });
}

criterion_group!(
    benches,
    bench_same_second_one_strategy,
    bench_same_second_rotating_strategies,
    bench_cross_second_one_strategy,
);
criterion_main!(benches);
