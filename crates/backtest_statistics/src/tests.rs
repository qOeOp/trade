use rstest::rstest;

use super::*;

const DAY: i64 = 86_400_000_000_000;
/// 2024-01-01T00:00Z, a Monday.
const NEW_YEAR_2024: i64 = 19_723 * DAY;

/// Daily bars from `first_day` (days since the epoch), each opening at `price(index)`.
fn daily(first_day: i64, count: usize, price: impl Fn(usize) -> f64) -> Vec<BarOpenV1> {
    (0..count)
        .map(|index| BarOpenV1 {
            open_ns: (first_day + index as i64) * DAY,
            open: price(index),
        })
        .collect()
}

fn long(entry_bar: usize, exit_bar: usize, entry_price: f64, exit_price: f64) -> RoundTripV1 {
    RoundTripV1 {
        side: TradeSideV1::Long,
        entry_bar,
        exit_bar,
        entry_price,
        exit_price,
    }
}

fn measure(
    bars: &[BarOpenV1],
    funding: &[f64],
    cost: f64,
    trades: &[RoundTripV1],
    seed: u64,
) -> MatchedEntryControlV1 {
    matched_entry_control_v1(&MatchedEntryControlInputV1 {
        bars,
        funding_per_bar: Some(funding),
        cost_per_side: cost,
        trades,
        seed,
    })
    .expect("measurable")
}

/// On flat prices every random entry earns exactly minus its cost, so a long from 100 to 110
/// earns 10% minus cost and beats its control by exactly 10%; one cluster gives a point interval.
#[rstest]
fn on_flat_prices_the_edge_is_the_move_itself() {
    let bars = daily(19_723, 60, |_| 100.0);
    let control = measure(&bars, &[0.0; 60], 0.0005, &[long(10, 15, 100.0, 110.0)], 3);
    let entry = &control.entries[0];

    assert!((entry.result - (0.1 - 0.001)).abs() < 1e-12);
    assert_eq!(entry.control_draws.len(), 20);
    assert!(
        entry
            .control_draws
            .iter()
            .all(|draw| (draw + 0.001).abs() < 1e-12)
    );
    let edge = control.edge.expect("one controlled trade");
    assert!((edge - 0.1).abs() < 1e-12, "{edge}");
    let interval = control.interval.expect("an interval");
    assert_eq!(
        (
            interval.clusters,
            interval.resamples,
            interval.level_percent
        ),
        (1, 4_000, 95)
    );
    assert!((interval.low - edge).abs() < 1e-12 && (interval.high - edge).abs() < 1e-12);
    assert_eq!(
        control.method,
        "backtest.control.matched-entry.holding-period.v1"
    );
}

/// Prices that rise one unit a bar make each draw's result name its entry bar, so every draw is
/// shown to enter in the trade's own calendar year and to leave room for the trade's hold.
#[rstest]
fn every_draw_enters_in_the_trade_s_year_with_room_for_its_hold() {
    // 2023-12-02 to 2024-01-30: thirty bars of 2023, then thirty of 2024.
    let bars = daily(19_693, 60, |index| 100.0 + index as f64);
    let hold = 5;
    let trades = [
        long(40, 40 + hold, 140.0, 145.0),
        long(3, 3 + hold, 103.0, 108.0),
    ];
    let control = measure(&bars, &[0.0; 60], 0.0, &trades, 11);

    for (trade, entry) in trades.iter().zip(&control.entries) {
        let year = calendar::utc_year_of_ns(bars[trade.entry_bar].open_ns);
        let mut entered = std::collections::BTreeSet::new();

        for draw in &entry.control_draws {
            // open[j + hold] / open[j] - 1 = hold / (100 + j), so j = hold / draw - 100.
            let j = (hold as f64 / draw - 100.0).round() as usize;
            assert_eq!(calendar::utc_year_of_ns(bars[j].open_ns), year);
            assert!(j + hold < bars.len());
            entered.insert(j);
        }
        assert!(entered.len() > 5, "draws vary: {entered:?}");
    }
}

/// A trade near the end of the bars draws only entries that leave room for its hold, which its
/// own entry always does, so every trade has a control.
#[rstest]
fn a_trade_whose_hold_reaches_the_last_bar_still_has_a_control() {
    let bars = daily(19_723, 23, |index| 100.0 + index as f64);
    let control = measure(&bars, &[0.0; 23], 0.0, &[long(0, 22, 100.0, 122.0)], 1);

    assert!(
        control.entries[0]
            .control_draws
            .iter()
            .all(|draw| (draw - 0.22).abs() < 1e-12)
    );
    assert!(control.edge.expect("a control").abs() < 1e-12);
}

/// Funding is paid by a long and received by a short, on both the trade and its control.
#[rstest]
#[case::long_pays(TradeSideV1::Long, -0.003)]
#[case::short_receives(TradeSideV1::Short, 0.003)]
fn funding_follows_the_side(#[case] side: TradeSideV1, #[case] carried: f64) {
    let bars = daily(19_723, 30, |_| 100.0);
    let trade = RoundTripV1 {
        side,
        entry_bar: 4,
        exit_bar: 7,
        entry_price: 100.0,
        exit_price: 100.0,
    };
    let control = measure(&bars, &[0.001; 30], 0.0, &[trade], 5);
    let entry = &control.entries[0];

    assert!((entry.result - carried).abs() < 1e-12);
    assert!(
        entry
            .control_draws
            .iter()
            .all(|draw| (draw - carried).abs() < 1e-12)
    );
}

/// Trades are resampled by ISO week: two trades in one week are one cluster, and a trade the
/// next Monday is another.
#[rstest]
fn trades_in_one_week_resample_together() {
    let bars = daily(19_723, 40, |_| 100.0);
    let trades = [
        long(0, 2, 100.0, 101.0),
        long(7, 9, 100.0, 102.0),
        long(8, 10, 100.0, 103.0),
    ];
    let control = measure(&bars, &[0.0; 40], 0.0, &trades, 2);
    let interval = control.interval.expect("an interval");

    assert_eq!(interval.clusters, 2);
    assert!(interval.low <= control.edge.unwrap() && control.edge.unwrap() <= interval.high);
    // Bar 0 is Monday 2024-01-01 and bars 7 and 8 the next Monday and Tuesday: a resample of the
    // first week alone gives 1%, of the second alone 2.5%, each a quarter of the time.
    assert!((interval.low - 0.01).abs() < 1e-12 && (interval.high - 0.025).abs() < 1e-12);
}

/// The same values and seed give the same bytes; another seed draws other entries; the input
/// digest moves with every input.
#[rstest]
fn the_result_is_a_function_of_its_values_and_seed() {
    let bars = daily(19_723, 80, |index| 100.0 + (index % 7) as f64);
    let trades = [long(10, 14, 103.0, 104.0), long(30, 41, 102.0, 106.0)];
    let first = measure(&bars, &[0.0; 80], 0.0004, &trades, 9);

    assert_eq!(first, measure(&bars, &[0.0; 80], 0.0004, &trades, 9));
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&measure(&bars, &[0.0; 80], 0.0004, &trades, 9)).unwrap()
    );
    let reseeded = measure(&bars, &[0.0; 80], 0.0004, &trades, 10);
    assert_ne!(
        first.entries[0].control_draws,
        reseeded.entries[0].control_draws
    );
    assert_ne!(first.input_digest, reseeded.input_digest);
    assert_ne!(
        first.input_digest,
        measure(&bars, &[0.0; 80], 0.0005, &trades, 9).input_digest
    );
    assert_ne!(
        first.input_digest,
        measure(&bars, &[0.0; 80], 0.0004, &trades[..1], 9).input_digest
    );
}

/// Funding not stated is priced as none and said so, and is not the same input as zero funding.
#[rstest]
fn unstated_funding_is_said_not_assumed() {
    let bars = daily(19_723, 30, |_| 100.0);
    let trades = [long(4, 7, 100.0, 101.0)];
    let unstated = matched_entry_control_v1(&MatchedEntryControlInputV1 {
        bars: &bars,
        funding_per_bar: None,
        cost_per_side: 0.0,
        trades: &trades,
        seed: 4,
    })
    .expect("measurable");
    let zero = measure(&bars, &[0.0; 30], 0.0, &trades, 4);

    assert!(!unstated.funding_stated && zero.funding_stated);
    assert_eq!(unstated.entries, zero.entries);
    assert_ne!(unstated.input_digest, zero.input_digest);
}

#[rstest]
fn the_seed_is_the_request_identity_s_first_eight_bytes() {
    let mut identity = [0; 32];
    identity[0] = 1;
    identity[7] = 2;
    assert_eq!(seed_from_request_identity(&identity), 1 + (2 << 56));
}

/// Linear interpolation between the closest ranks, as numpy's default percentile reads it.
#[rstest]
#[case(0.0, 1.0)]
#[case(25.0, 1.75)]
#[case(50.0, 2.5)]
#[case(97.5, 3.925)]
#[case(100.0, 4.0)]
fn percentiles_interpolate_linearly(#[case] q: f64, #[case] value: f64) {
    assert!((percentile(&[1.0, 2.0, 3.0, 4.0], q) - value).abs() < 1e-12);
}

#[rstest]
#[case::no_bars(vec![], vec![], 0.0, vec![], MatchedEntryControlErrorV1::BarsEmpty)]
#[case::not_ascending(vec![BarOpenV1 { open_ns: DAY, open: 1.0 }, BarOpenV1 { open_ns: DAY, open: 1.0 }], vec![0.0; 2], 0.0, vec![], MatchedEntryControlErrorV1::BarsNotAscending(1))]
#[case::bad_open(vec![BarOpenV1 { open_ns: 0, open: 0.0 }], vec![0.0], 0.0, vec![], MatchedEntryControlErrorV1::BarPriceInvalid(0))]
#[case::funding_length(daily(0, 3, |_| 1.0), vec![0.0; 2], 0.0, vec![], MatchedEntryControlErrorV1::FundingLength { funding: 2, bars: 3 })]
#[case::funding_nan(daily(0, 3, |_| 1.0), vec![0.0, f64::NAN, 0.0], 0.0, vec![], MatchedEntryControlErrorV1::FundingInvalid(1))]
#[case::negative_cost(daily(0, 3, |_| 1.0), vec![0.0; 3], -0.1, vec![], MatchedEntryControlErrorV1::CostInvalid)]
#[case::exit_before_entry(daily(0, 3, |_| 1.0), vec![0.0; 3], 0.0, vec![long(2, 1, 1.0, 1.0)], MatchedEntryControlErrorV1::TradeBarsInvalid(0))]
#[case::exit_past_bars(daily(0, 3, |_| 1.0), vec![0.0; 3], 0.0, vec![long(0, 3, 1.0, 1.0)], MatchedEntryControlErrorV1::TradeBarsInvalid(0))]
#[case::bad_price(daily(0, 3, |_| 1.0), vec![0.0; 3], 0.0, vec![long(0, 1, 1.0, f64::INFINITY)], MatchedEntryControlErrorV1::TradePriceInvalid(0))]
fn each_refusal_is_named(
    #[case] bars: Vec<BarOpenV1>,
    #[case] funding: Vec<f64>,
    #[case] cost: f64,
    #[case] trades: Vec<RoundTripV1>,
    #[case] refusal: MatchedEntryControlErrorV1,
) {
    let result = matched_entry_control_v1(&MatchedEntryControlInputV1 {
        bars: &bars,
        funding_per_bar: Some(&funding),
        cost_per_side: cost,
        trades: &trades,
        seed: 0,
    });
    assert_eq!(result, Err(refusal));
}

#[rstest]
fn a_new_year_2024_bar_is_a_monday() {
    assert_eq!(
        calendar::iso_week_of_ns(NEW_YEAR_2024),
        calendar::iso_week_of_ns(NEW_YEAR_2024 + 6 * DAY)
    );
}
