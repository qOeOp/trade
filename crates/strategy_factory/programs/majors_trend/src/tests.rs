extern crate std;

use super::*;
use rstest::rstest;
use std::vec::Vec;
use strategy_factory_program_sdk::{
    CODEC_V1, FrameEncoder, RecordMeta, decode_actions, dispatch, order_event as oe,
};

const BTC: usize = 0;
const ETH: usize = 1;
const SOL: usize = 2;

fn seeded(coordinate: u8) -> MajorsTrend {
    let mut program = MajorsTrend::new();
    program.parameters =
        Some(Parameters::parse(&Parameters::expected(coordinate).unwrap()).unwrap());
    program.run_end = 1_000 * D1_NS;
    program
}

fn flat() -> Snapshot {
    Snapshot {
        positions: [0.0; LEGS],
        open_orders: [0.0; LEGS],
    }
}

fn day(close: f64, ts: u64) -> Observation {
    Observation {
        bar: Bar {
            high: close,
            low: close,
            close,
        },
        ts,
        available: ts + 1,
        snapshot: flat(),
    }
}

fn days(closes: [f64; LEGS], ts: u64) -> [Observation; LEGS] {
    closes.map(|close| day(close, ts))
}

/// Feeds `count` flat daily closes of 100 to every leg and clears the resulting signal.
fn prime(program: &mut MajorsTrend, count: usize) {
    for k in 0..count {
        program
            .complete_d1(days([100.0; LEGS], (k as u64 + 1) * D1_NS))
            .unwrap();
        program.signal = None;
    }
}

fn actions(
    operation: impl FnOnce(&mut ActionEncoder<'_>) -> Result<(), ProgramFault>,
) -> Result<Vec<Action>, ProgramFault> {
    let mut bytes = [0; 192];
    let mut encoder = ActionEncoder::new(&mut bytes);
    operation(&mut encoder)?;
    let length = encoder.finish();
    Ok(decode_actions(&bytes[..length])
        .unwrap()
        .map(Result::unwrap)
        .collect())
}

fn fields(action: &Action) -> (u32, OrderSide, f64, bool, u32) {
    match action {
        Action::Submit {
            kind: OrderKind::Market,
            instrument,
            side,
            quantity,
            reduce_only,
            decision_tag,
            price,
            trigger_price,
            ..
        } if *price == 0.0 && *trigger_price == 0.0 => {
            (*instrument, *side, *quantity, *reduce_only, *decision_tag)
        }
        _ => panic!("unexpected action"),
    }
}

fn signal(enter: [bool; LEGS], exit: [bool; LEGS]) -> Signal {
    Signal {
        available: 10,
        enter,
        exit,
        stop_distance: [500.0, 50.0, 5.0],
    }
}

fn ready(program: &mut MajorsTrend, signal: Signal, lows: Option<[f64; LEGS]>) -> Vec<Action> {
    program.signal = Some(signal);
    program.h1_available = Some(signal.available + 1);
    actions(|encoder| program.consume(lows, encoder)).unwrap()
}

#[allow(clippy::too_many_arguments)]
fn dispatch_bar(
    program: &mut MajorsTrend,
    channel: u32,
    ts: u64,
    available: u64,
    bar: [f64; 3],
    snapshot: Snapshot,
    balances: [f64; LEGS],
    omit_last_balance: bool,
) -> Result<Vec<Action>, i32> {
    let mut frame_bytes = [0; 1024];
    let mut frame = FrameEncoder::observation(&mut frame_bytes, available.max(ts)).unwrap();
    let meta = |type_id, bound| RecordMeta {
        type_id,
        codec_version: CODEC_V1,
        channel: bound,
        ts_event: ts,
        available_at: available,
    };
    let mut payload = [0; 40];

    for (index, value) in [bar[2], bar[0], bar[1], bar[2], 1.0]
        .into_iter()
        .enumerate()
    {
        payload[index * 8..index * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
    frame.push(meta(BAR_RECORD, channel), &payload).unwrap();

    for leg in 0..LEGS {
        for (record_type, value) in [
            (POSITION_RECORD, snapshot.positions[leg]),
            (ORDER_RECORD, snapshot.open_orders[leg]),
            (BALANCE_RECORD, balances[leg]),
        ] {
            if !(omit_last_balance && leg == SOL && record_type == BALANCE_RECORD) {
                frame
                    .push(meta(record_type, EXECUTABLES[leg]), &value.to_le_bytes())
                    .unwrap();
            }
        }
    }
    let length = frame.finish();
    let mut output = [0; 192];
    let result = dispatch(program, &frame_bytes[..length], &mut output);
    if result < 0 {
        return Err(result);
    }
    Ok(decode_actions(&output[..result as usize])
        .unwrap()
        .map(Result::unwrap)
        .collect())
}

fn bar(
    program: &mut MajorsTrend,
    channel: u32,
    ts: u64,
    available: u64,
    close: f64,
) -> Result<Vec<Action>, i32> {
    dispatch_bar(
        program,
        channel,
        ts,
        available,
        [close, close, close],
        flat(),
        [1_000.0; LEGS],
        false,
    )
}

#[rstest]
fn exact_abi_accepts_three_coordinates_and_rejects_every_flipped_byte() {
    for coordinate in 0..3 {
        let parsed = Parameters::parse(&Parameters::expected(coordinate).unwrap()).unwrap();
        assert_eq!(
            (parsed.entry, parsed.exit),
            (
                usize::from(COORDINATES[usize::from(coordinate)].0),
                usize::from(COORDINATES[usize::from(coordinate)].1)
            )
        );
        assert_eq!(parsed.stop_atr, 2.0);
    }
    assert!(Parameters::expected(3).is_none());
    for offset in 0..64 {
        let mut invalid = Parameters::expected(0).unwrap();
        invalid[offset] ^= 1;
        assert!(Parameters::parse(&invalid).is_err(), "offset {offset}");
    }
    assert!(Parameters::parse(&Parameters::expected(0).unwrap()[..63]).is_err());
}

#[rstest]
#[case(0, 50, 20)]
#[case(1, 100, 50)]
#[case(2, 20, 10)]
fn entry_and_exit_need_the_full_lookback_and_a_strict_break(
    #[case] coordinate: u8,
    #[case] entry: usize,
    #[case] exit: usize,
) {
    // one day short of the entry lookback: no entry even on a higher close
    let mut short = seeded(coordinate);
    prime(&mut short, entry - 1);
    short
        .complete_d1(days([110.0; LEGS], entry as u64 * D1_NS))
        .unwrap();
    assert_eq!(short.signal.unwrap().enter, [false; LEGS]);

    let mut program = seeded(coordinate);
    prime(&mut program, entry);
    let ts = (entry as u64 + 1) * D1_NS;
    // equal to the prior high: no entry; strictly above: entry, independently per leg
    program
        .complete_d1(days([100.0, 100.5, 100.0], ts))
        .unwrap();
    assert_eq!(program.signal.unwrap().enter, [false, true, false]);
    program.signal = None;
    // the exit compares with the prior `exit` closes only
    program
        .complete_d1(days([99.9, 100.0, 100.0], ts + D1_NS))
        .unwrap();
    assert_eq!(program.signal.unwrap().exit, [true, false, false]);
    assert!(exit < entry);
}

#[rstest]
fn wilder_atr_matches_its_recurrence_and_sets_the_stop_distance() {
    let mut history = History::EMPTY;
    let bars = [
        (10.0, 8.0, 9.0),
        (11.0, 9.5, 10.5),
        (10.8, 7.0, 7.5),
        (8.0, 7.2, 7.9),
    ];
    let mut expected = 0.0;
    let mut previous = 0.0;

    for (index, &(high, low, close)) in bars.iter().enumerate() {
        let range: f64 = if index == 0 {
            high - low
        } else {
            (high - low)
                .max((high - previous).abs())
                .max((low - previous).abs())
        };
        expected = if index == 0 {
            range
        } else {
            expected + (range - expected) / 20.0
        };
        previous = close;
        history.push(Bar { high, low, close });
        assert!((history.atr - expected).abs() < 1e-12);
    }
    let mut program = seeded(0);
    prime(&mut program, 50);
    let mut wide = days([120.0; LEGS], 51 * D1_NS);
    wide[BTC].bar = Bar {
        high: 140.0,
        low: 100.0,
        close: 120.0,
    };
    program.complete_d1(wide).unwrap();
    let atr = program.history[BTC].atr;
    assert!((program.signal.unwrap().stop_distance[BTC] - 2.0 * atr).abs() < 1e-12);
}

#[rstest]
fn every_callback_order_of_one_hour_emits_the_same_actions_from_hourly_frames_only() {
    let ts = 60 * D1_NS;
    let mut reference = None;
    let channels = [1_u32, 2, 3, 4, 5, 6];
    let mut order = channels;
    // Heap's algorithm over all 720 orders
    let mut c = [0_usize; 6];
    let mut run = |schedule: [u32; 6]| {
        let mut program = seeded(0);
        prime(&mut program, 50);
        let mut emitted = Vec::new();

        for channel in schedule {
            let daily = channel <= 3;
            let available = ts + if daily { 1 } else { 2 };
            let current = bar(&mut program, channel, ts, available, 120.0).unwrap();

            if daily {
                assert!(
                    current.is_empty(),
                    "daily callback emitted for {schedule:?}"
                );
            }
            emitted.extend(current);
        }

        if emitted.is_empty() {
            for channel in 4..=6 {
                emitted
                    .extend(bar(&mut program, channel, ts + H1_NS, ts + H1_NS + 1, 120.0).unwrap());
            }
        }
        assert_eq!(emitted.len(), 3, "schedule {schedule:?}");
        if let Some(expected) = &reference {
            assert_eq!(&emitted, expected, "schedule {schedule:?}");
        } else {
            reference = Some(emitted);
        }
    };
    run(order);
    let mut i = 0;
    while i < 6 {
        if c[i] < i {
            if i % 2 == 0 {
                order.swap(0, i);
            } else {
                order.swap(c[i], i);
            }
            run(order);
            c[i] += 1;
            i = 0;
        } else {
            c[i] = 0;
            i += 1;
        }
    }
    let tags: Vec<_> = reference
        .unwrap()
        .iter()
        .map(|action| fields(action).4)
        .collect();
    assert_eq!(tags, OPEN_TAGS);
}

#[rstest]
fn legs_are_independent_and_sol_values_never_move_btc_or_eth() {
    let run = |sol_close: f64| {
        let mut program = seeded(0);
        prime(&mut program, 50);
        program
            .complete_d1(days([120.0, 90.0, sol_close], 51 * D1_NS))
            .unwrap();
        let signal = program.signal.unwrap();
        (
            signal.enter,
            signal.exit,
            signal.stop_distance[BTC],
            signal.stop_distance[ETH],
        )
    };
    let up = run(150.0);
    let down = run(50.0);
    assert_eq!(
        (up.0[BTC], up.0[ETH], up.1[BTC], up.1[ETH]),
        (down.0[BTC], down.0[ETH], down.1[BTC], down.1[ETH])
    );
    assert_eq!((up.2, up.3), (down.2, down.3));
    assert_eq!((up.0[SOL], down.1[SOL]), (true, true));
}

fn opening() -> MajorsTrend {
    let mut program = seeded(0);
    let emitted = ready(&mut program, signal([true; LEGS], [false; LEGS]), None);
    assert_eq!(
        emitted.iter().map(fields).collect::<Vec<_>>(),
        [
            (1, OrderSide::Buy, 0.01, false, 101),
            (2, OrderSide::Buy, 0.3, false, 102),
            (3, OrderSide::Buy, 7.0, false, 103),
        ]
    );
    program
}

fn evt(
    program: &mut MajorsTrend,
    handle: u64,
    code: u8,
    side: OrderSide,
    filled: f64,
    price: f64,
) -> Result<(), ProgramFault> {
    program.order_event((handle, code, side as u8, filled, price))
}

fn holding() -> Snapshot {
    Snapshot {
        positions: QUANTITIES,
        open_orders: [0.0; LEGS],
    }
}

#[rstest]
fn the_average_fill_sets_the_stop_and_an_hourly_low_at_the_stop_closes_the_leg() {
    let mut program = opening();
    // the position can show before the fill event: the leg waits instead of guessing the entry price
    program.reconcile(holding()).unwrap();
    assert_eq!(program.legs[BTC].phase, Phase::Opening);
    evt(
        &mut program,
        1,
        oe::PARTIALLY_FILLED,
        OrderSide::Buy,
        0.004,
        60_000.0,
    )
    .unwrap();
    evt(&mut program, 1, oe::FILLED, OrderSide::Buy, 0.006, 60_100.0).unwrap();
    evt(&mut program, 2, oe::FILLED, OrderSide::Buy, 0.3, 3_000.0).unwrap();
    evt(&mut program, 3, oe::FILLED, OrderSide::Buy, 7.0, 150.0).unwrap();
    assert_eq!(
        program.mode,
        Mode::Draining,
        "a partial fill starts the bounded drain"
    );

    let mut clean = opening();

    for (handle, price) in [(1, 60_000.0), (2, 3_000.0), (3, 150.0)] {
        let quantity = QUANTITIES[(handle - 1) as usize];
        evt(&mut clean, handle, oe::ACCEPTED, OrderSide::Buy, 0.0, 0.0).unwrap();
        evt(
            &mut clean,
            handle,
            oe::FILLED,
            OrderSide::Buy,
            quantity,
            price,
        )
        .unwrap();
    }
    clean.reconcile(holding()).unwrap();
    assert!(
        clean
            .legs
            .iter()
            .all(|leg| leg.phase == Phase::Long && leg.order.is_none())
    );
    assert_eq!(clean.legs.map(|leg| leg.stop), [59_500.0, 2_950.0, 145.0]);

    // lows above every stop: nothing; ETH low at its stop: one reduce-only stop exit
    assert!(
        actions(|encoder| clean.consume(Some([59_501.0, 2_951.0, 146.0]), encoder))
            .unwrap()
            .is_empty()
    );
    let stopped =
        actions(|encoder| clean.consume(Some([59_501.0, 2_950.0, 146.0]), encoder)).unwrap();
    assert_eq!(
        stopped.iter().map(fields).collect::<Vec<_>>(),
        [(2, OrderSide::Sell, 0.3, true, 222)]
    );
    assert_eq!(clean.legs[ETH].phase, Phase::Closing);

    // a daily exit signal closes the remaining legs; a stop takes precedence on the same frame
    let exits = ready(
        &mut clean,
        signal([false; LEGS], [true; LEGS]),
        Some([59_000.0, 0.0, 200.0]),
    );
    assert_eq!(
        exits.iter().map(fields).collect::<Vec<_>>(),
        [
            (1, OrderSide::Sell, 0.01, true, 221),
            (3, OrderSide::Sell, 7.0, true, 203)
        ]
    );
    let sell_handle = |program: &MajorsTrend, leg: usize| program.legs[leg].order.unwrap().handle;
    for leg in [BTC, ETH, SOL] {
        let handle = sell_handle(&clean, leg);
        evt(
            &mut clean,
            handle,
            oe::FILLED,
            OrderSide::Sell,
            QUANTITIES[leg],
            100.0,
        )
        .unwrap();
    }
    clean.reconcile(flat()).unwrap();
    assert!(
        clean
            .legs
            .iter()
            .all(|leg| leg.phase == Phase::Flat && leg.stop == 0.0)
    );
}

#[rstest]
fn host_frames_reject_missing_facts_unequal_balances_and_broken_cadence() {
    let mut program = seeded(0);
    let truncated = dispatch_bar(
        &mut program,
        1,
        D1_NS,
        D1_NS + 1,
        [1.0, 1.0, 1.0],
        flat(),
        [1_000.0; LEGS],
        true,
    );
    assert_eq!(truncated.unwrap_err(), ProgramFault::MalformedFrame as i32);
    let mut unequal = seeded(0);
    let balances = dispatch_bar(
        &mut unequal,
        1,
        D1_NS,
        D1_NS + 1,
        [1.0, 1.0, 1.0],
        flat(),
        [1_000.0, 1_000.0, 999.0],
        false,
    );
    assert!(balances.is_err());
    let mut inverted = seeded(0);
    assert!(
        dispatch_bar(
            &mut inverted,
            1,
            D1_NS,
            D1_NS + 1,
            [1.0, 2.0, 1.5],
            flat(),
            [1_000.0; LEGS],
            false
        )
        .is_err()
    );

    let mut gap = seeded(0);
    for channel in 1..=3 {
        bar(&mut gap, channel, D1_NS, D1_NS + 1, 100.0).unwrap();
    }
    assert!(bar(&mut gap, 1, 3 * D1_NS, 3 * D1_NS + 1, 100.0).is_err());
    let mut repeat = seeded(0);
    bar(&mut repeat, 4, H1_NS, H1_NS + 1, 100.0).unwrap();
    assert!(bar(&mut repeat, 4, H1_NS, H1_NS + 1, 100.0).is_err());
    assert!(
        seeded(0)
            .reconcile(Snapshot {
                positions: [0.0; LEGS],
                open_orders: [2.0, 0.0, 0.0]
            })
            .is_err()
    );
    assert!(
        seeded(0)
            .reconcile(Snapshot {
                positions: [0.02, 0.0, 0.0],
                open_orders: [0.0; LEGS]
            })
            .is_err()
    );
}

#[rstest]
fn order_events_fail_closed_and_the_single_drain_flattens_residuals() {
    let mut duplicate = opening();
    evt(&mut duplicate, 1, oe::ACCEPTED, OrderSide::Buy, 0.0, 0.0).unwrap();
    assert!(evt(&mut duplicate, 1, oe::ACCEPTED, OrderSide::Buy, 0.0, 0.0).is_err());
    evt(
        &mut duplicate,
        1,
        oe::FILLED,
        OrderSide::Buy,
        0.01,
        50_000.0,
    )
    .unwrap();
    assert!(
        evt(
            &mut duplicate,
            1,
            oe::FILLED,
            OrderSide::Buy,
            0.01,
            50_000.0
        )
        .is_err()
    );

    for code in [oe::ACCEPTED, oe::CANCELED, oe::REJECTED] {
        assert!(evt(&mut duplicate, 1, code, OrderSide::Buy, 0.0, 0.0).is_err());
    }
    assert_eq!(duplicate.mode, Mode::Active);

    for (handle, side, filled, price) in [
        (99, OrderSide::Buy, 0.01, 1.0),
        (2, OrderSide::Sell, 0.3, 1.0),
        (2, OrderSide::Buy, 0.6, 1.0),
        (2, OrderSide::Buy, 0.3, 0.0),
    ] {
        let mut program = opening();
        assert!(evt(&mut program, handle, oe::FILLED, side, filled, price).is_err());
    }

    let mut draining = opening();
    evt(
        &mut draining,
        1,
        oe::PARTIALLY_FILLED,
        OrderSide::Buy,
        0.005,
        50_000.0,
    )
    .unwrap();
    evt(&mut draining, 1, oe::CANCELED, OrderSide::Buy, 0.0, 0.0).unwrap();
    evt(&mut draining, 2, oe::REJECTED, OrderSide::Buy, 0.0, 0.0).unwrap();
    assert_eq!(draining.mode, Mode::Draining);
    let residual = Snapshot {
        positions: [0.005, 0.0, 7.0],
        open_orders: [0.0, 0.0, 1.0],
    };
    draining.reconcile(residual).unwrap();
    assert!(
        actions(|encoder| draining.drain(encoder))
            .unwrap()
            .is_empty(),
        "waits for open orders"
    );
    draining
        .reconcile(Snapshot {
            open_orders: [0.0; LEGS],
            ..residual
        })
        .unwrap();
    let repairs = actions(|encoder| draining.drain(encoder)).unwrap();
    assert_eq!(
        repairs.iter().map(fields).collect::<Vec<_>>(),
        [
            (1, OrderSide::Sell, 0.005, true, 301),
            (3, OrderSide::Sell, 7.0, true, 303)
        ]
    );
    let repair_handle = draining.legs[BTC].order.unwrap().handle;
    assert!(
        evt(
            &mut draining,
            repair_handle,
            oe::REJECTED,
            OrderSide::Sell,
            0.0,
            0.0
        )
        .is_err()
    );
    draining.legs[BTC].position = 0.001;
    assert!(
        actions(|encoder| draining.drain(encoder)).is_err(),
        "a second repair is never sent"
    );
}

#[rstest]
fn the_last_hour_never_opens_and_terminal_flattens_or_rejects() {
    for ts in [10 * H1_NS, 11 * H1_NS] {
        let mut program = seeded(0);
        program.run_end = 11 * H1_NS;
        program.signal = Some(signal([true; LEGS], [false; LEGS]));
        program.h1_available = Some(2);

        for channel in 4..=6 {
            assert!(
                bar(&mut program, channel, ts, ts + 1, 100.0)
                    .unwrap()
                    .is_empty()
            );
        }
        assert!(program.legs.iter().all(|leg| leg.phase != Phase::Opening));
    }
    let mut terminal = seeded(0);
    terminal.legs[SOL].open_orders = 1.0;
    assert!(actions(|encoder| terminal.terminal(encoder)).is_err());
    terminal.legs[SOL].open_orders = 0.0;
    terminal.legs[SOL].phase = Phase::Long;
    terminal.legs[SOL].position = 7.0;
    let closes = actions(|encoder| terminal.terminal(encoder)).unwrap();
    assert_eq!(
        closes.iter().map(fields).collect::<Vec<_>>(),
        [(3, OrderSide::Sell, 7.0, true, 213)]
    );
    assert_eq!(terminal.halt(), Err(ProgramFault::ProgramRejected));
    terminal.legs[SOL].position = 0.0;
    assert!(terminal.halt().is_ok());
}
