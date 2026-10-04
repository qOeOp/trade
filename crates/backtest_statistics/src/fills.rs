//! A run's fills paired into the round trips the control measures.

use serde::Serialize;
use thiserror::Error;

use crate::{BarOpenV1, RoundTripV1, TradeSideV1};

/// The side of one fill.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FillSideV1 {
    Buy,
    Sell,
}

/// One fill of the run, in the order the run made them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FillV1 {
    /// When it filled, in nanoseconds since the Unix epoch: the open of the bar it filled at.
    pub at_ns: i64,
    pub side: FillSideV1,
    pub quantity: f64,
    pub price: f64,
}

/// The round trips a run's fills close, and whether a position is still open after the last.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RoundTripsV1 {
    pub trades: Vec<RoundTripV1>,
    /// A position the fills open and never close is not a round trip; it is reported here.
    pub open_at_end: bool,
}

/// Why fills were not paired.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum RoundTripsFromFillsErrorV1 {
    #[error("STATISTICS_FILL_NOT_AT_A_BAR_OPEN: fill {0} is not at any bar's open")]
    FillNotAtABarOpen(usize),
    #[error("STATISTICS_FILL_INVALID: fill {0}'s quantity or price is not positive and finite")]
    FillInvalid(usize),
    #[error(
        "STATISTICS_FILL_ADDS: fill {0} adds to the position it holds; a round trip is one entry and one exit"
    )]
    FillAdds(usize),
    #[error(
        "STATISTICS_FILL_REDUCES: fill {0} closes part of the position it holds; a round trip is one entry and one exit"
    )]
    FillReduces(usize),
}

/// Pairs fills into round trips: a fill from flat enters, the opposite fill of the same quantity
/// exits, and an opposite fill of a larger quantity exits and enters the other side - a flip.
///
/// # Errors
///
/// Returns the first fill that is not at a bar's open, is not a positive finite quantity and
/// price, or adds to or closes part of a held position, by name.
pub fn round_trips_from_fills(
    fills: &[FillV1],
    bars: &[BarOpenV1],
) -> Result<RoundTripsV1, RoundTripsFromFillsErrorV1> {
    let mut trades = Vec::new();
    // The held position: its side, quantity, entry bar and entry price.
    let mut held: Option<(TradeSideV1, f64, usize, f64)> = None;

    for (index, fill) in fills.iter().enumerate() {
        if !(fill.quantity.is_finite()
            && fill.quantity > 0.0
            && fill.price.is_finite()
            && fill.price > 0.0)
        {
            return Err(RoundTripsFromFillsErrorV1::FillInvalid(index));
        }
        let bar = bars
            .binary_search_by_key(&fill.at_ns, |bar| bar.open_ns)
            .map_err(|_| RoundTripsFromFillsErrorV1::FillNotAtABarOpen(index))?;
        let side = match fill.side {
            FillSideV1::Buy => TradeSideV1::Long,
            FillSideV1::Sell => TradeSideV1::Short,
        };
        held = match held {
            None => Some((side, fill.quantity, bar, fill.price)),
            Some((held_side, ..)) if held_side == side => {
                return Err(RoundTripsFromFillsErrorV1::FillAdds(index));
            }
            Some((_, quantity, ..)) if fill.quantity < quantity => {
                return Err(RoundTripsFromFillsErrorV1::FillReduces(index));
            }
            Some((held_side, quantity, entry_bar, entry_price)) => {
                trades.push(RoundTripV1 {
                    side: held_side,
                    entry_bar,
                    exit_bar: bar,
                    entry_price,
                    exit_price: fill.price,
                });
                (fill.quantity > quantity).then_some((
                    side,
                    fill.quantity - quantity,
                    bar,
                    fill.price,
                ))
            }
        };
    }
    Ok(RoundTripsV1 {
        trades,
        open_at_end: held.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn bars(count: i64) -> Vec<BarOpenV1> {
        (0..count)
            .map(|day| BarOpenV1 {
                open_ns: day * 86_400_000_000_000,
                open: 100.0,
            })
            .collect()
    }

    fn fill(day: i64, side: FillSideV1, quantity: f64, price: f64) -> FillV1 {
        FillV1 {
            at_ns: day * 86_400_000_000_000,
            side,
            quantity,
            price,
        }
    }

    /// Research T0's shape: enter long, exit, enter short, flip to long in one fill of two, and
    /// leave the last position open.
    #[rstest]
    fn entries_exits_and_a_flip_pair_into_round_trips() {
        let fills = [
            fill(1, FillSideV1::Buy, 1.0, 101.0),
            fill(3, FillSideV1::Sell, 1.0, 104.0),
            fill(5, FillSideV1::Sell, 1.0, 99.0),
            fill(7, FillSideV1::Buy, 2.0, 97.0),
        ];
        let paired = round_trips_from_fills(&fills, &bars(10)).expect("pairs");

        assert_eq!(
            paired.trades,
            [
                RoundTripV1 {
                    side: TradeSideV1::Long,
                    entry_bar: 1,
                    exit_bar: 3,
                    entry_price: 101.0,
                    exit_price: 104.0,
                },
                RoundTripV1 {
                    side: TradeSideV1::Short,
                    entry_bar: 5,
                    exit_bar: 7,
                    entry_price: 99.0,
                    exit_price: 97.0,
                },
            ]
        );
        assert!(paired.open_at_end, "the flipped long is still held");
    }

    #[rstest]
    #[case::off_a_bar_open(&[FillV1 { at_ns: 1, side: FillSideV1::Buy, quantity: 1.0, price: 100.0 }], RoundTripsFromFillsErrorV1::FillNotAtABarOpen(0))]
    #[case::zero_quantity(&[fill(1, FillSideV1::Buy, 0.0, 100.0)], RoundTripsFromFillsErrorV1::FillInvalid(0))]
    #[case::adds(&[fill(1, FillSideV1::Buy, 1.0, 100.0), fill(2, FillSideV1::Buy, 1.0, 100.0)], RoundTripsFromFillsErrorV1::FillAdds(1))]
    #[case::reduces(&[fill(1, FillSideV1::Buy, 2.0, 100.0), fill(2, FillSideV1::Sell, 1.0, 100.0)], RoundTripsFromFillsErrorV1::FillReduces(1))]
    fn each_refusal_is_named_at_its_fill(
        #[case] fills: &[FillV1],
        #[case] refusal: RoundTripsFromFillsErrorV1,
    ) {
        assert_eq!(round_trips_from_fills(fills, &bars(5)), Err(refusal));
    }
}
