//! The first COMPOSER_V3 Replay's one report point, computed independently of the engine and the
//! report.
//!
//! F's endpoint is a report with one point and one fill. The Host decides a GTC limit buy of
//! `quantity` at the frame's close and submits it when the frame's fill quote arrives. That
//! Quote's ask is below the limit, so the venue's on-arrival check matches the order against it
//! and it fills as TAKER at the ask, the touch (`OrderMatchingEngine`,
//! `crates/execution/src/matching_engine/engine.rs`: a limit the book already crosses on arrival
//! fills as TAKER at the book's price). It pays the taker fee on that fill and marks the long
//! position at the bid. So the point is `(-fee + unrealized) / starting_balance`. The inputs are
//! what production decoders read back: the quote cut's bid and ask, the Owner's taker fee and
//! multiplier, the family's sealed starting balance, and the target's quantity. Before the Host
//! waited for the fill quote, owner-chains run 37093452400 filled at the limit (123.450) as MAKER,
//! not at the ask (123.440). From them this module computes the fee and the
//! unrealized PnL as exact decimals, and the point as an exact quotient. It calls no engine or
//! report function; it restates the arithmetic those functions perform, measured at `main`
//! c4bddc3b2, so a report that disagrees with it is refused rather than trusted.
//!
//! **The fee** is two exact decimal steps, both rounded half-to-even at the settlement currency's
//! precision. The notional is `quantity * multiplier * fill_price`, rounded to a `Money`
//! (`try_notional_value`, `crates/model/src/instruments/mod.rs`). The commission is that notional
//! times the taker rate, rounded again (`MakerTakerFeeModel::get_commission`,
//! `crates/execution/src/models/fee.rs`). Both roundings are `bankers_round`
//! (`crates/model/src/types/fixed.rs`). The report's fee must equal this one exactly.
//!
//! **The unrealized PnL** is not decimal in the engine. `Position::try_unrealized_pnl`
//! (`crates/model/src/position.rs`) computes `quantity * multiplier * (mark - open)` in `f64` and
//! rounds `pnl * 10^precision` half away from zero (`f64_to_fixed_i128`). It equals the exact
//! decimal only when that decimal has no more places than the currency and the `f64` error stays
//! under half a tick. [`fill_oracle_v1`] derives that error bound and refuses a fill it cannot prove
//! exact, instead of comparing against a guess. The mark is the bid, because a long is marked at the
//! bid (`Portfolio::get_price`, `crates/portfolio/src/portfolio.rs`).
//!
//! **The point** is the engine's `f64`. The analyzer takes each day's equity as `Money::as_f64` and
//! returns `equity_day / equity_before - 1.0` (`calculate_daily_returns`,
//! `crates/analysis/src/analyzer.rs`). A margin account's equity is its balance plus its unrealized
//! PnL (`Portfolio` snapshot, `portfolio.rs`), so the day after registration holds
//! `starting_balance - fee + unrealized`. [`FillOracleV1::admits_point`] compares against the exact
//! quotient within the bound derived at [`point_bound`].

use rust_decimal::{Decimal, RoundingStrategy};

/// What the fill's arithmetic starts from, each value as a production decoder read it back.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FillOracleInputsV1 {
    /// The quote cut's best bid for the member: the long position's mark.
    pub(crate) bid: Decimal,
    /// The price the order fills at: the quote cut's ask, the touch, since the order the Host
    /// submits on that Quote already crosses it.
    pub(crate) fill_price: Decimal,
    /// The target's quantity, in the instrument's units.
    pub(crate) quantity: Decimal,
    /// The Owner's contract multiplier.
    pub(crate) multiplier: Decimal,
    /// The Owner's fee rate for the fill's liquidity side: the taker rate for F's crossing limit.
    pub(crate) fee_rate: Decimal,
    /// The family's sealed starting balance, in the settlement currency.
    pub(crate) starting_balance: Decimal,
    /// The settlement currency's precision, in decimal places.
    pub(crate) currency_precision: u32,
}

/// The fill's fee, its unrealized PnL and the point they make, all exact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FillOracleV1 {
    /// The commission, at the currency's precision.
    pub(crate) fee: Decimal,
    /// The unrealized PnL at the bid, at the currency's precision.
    pub(crate) unrealized: Decimal,
    /// The equity after the fill: `starting_balance - fee + unrealized`.
    pub(crate) equity: Decimal,
    starting_balance: Decimal,
}

/// Why no exact value can be stated for a fill.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FillOracleRefusalV1 {
    /// A price, quantity, multiplier or balance is not positive, or the fee rate is negative.
    OutOfDomain,
    /// The exact unrealized PnL has more places than the currency, so the engine rounds it from
    /// `f64` and no decimal equals it by construction.
    UnrealizedFinerThanCurrency,
    /// The engine's `f64` error may reach half a tick, so its rounded PnL can differ from the
    /// exact one.
    UnrealizedFloatErrorTooLarge,
    /// The point is outside the range where the engine's final subtraction is exact.
    PointOutOfRange,
    /// A decimal step overflowed.
    Overflow,
}

/// Why a reported value is not this fill's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum FillOracleMismatchV1 {
    Fee {
        reported: Decimal,
        oracle: Decimal,
    },
    Unrealized {
        reported: Decimal,
        oracle: Decimal,
    },
    Point {
        reported: f64,
        oracle: Decimal,
        bound: Decimal,
    },
}

/// The unit roundoff of IEEE-754 binary64, `2^-53` (`1.1102230246251565...e-16`), rounded up at
/// the 28 places a `Decimal` holds.
///
/// Rounding it up keeps every bound built from it an upper bound.
fn unit_roundoff() -> Decimal {
    Decimal::from_i128_with_scale(1_110_223_024_626, 28)
}

/// What one `Decimal` step can lose at its 28th place, summed over the few steps a bound takes and
/// rounded up, so that a bound computed in `Decimal` stays above the real one.
fn decimal_slack() -> Decimal {
    Decimal::from_i128_with_scale(1, 27)
}

/// Computes the fill's exact fee, unrealized PnL and equity.
///
/// # Errors
///
/// Refuses by name when an input is out of domain, when a step overflows, or when the engine's
/// `f64` path cannot be proven to round to the exact unrealized PnL (see the module documentation).
pub(crate) fn fill_oracle_v1(
    inputs: FillOracleInputsV1,
) -> Result<FillOracleV1, FillOracleRefusalV1> {
    let FillOracleInputsV1 {
        bid,
        fill_price,
        quantity,
        multiplier,
        fee_rate,
        starting_balance,
        currency_precision,
    } = inputs;

    if [bid, fill_price, quantity, multiplier, starting_balance]
        .iter()
        .any(|value| *value <= Decimal::ZERO)
        || fee_rate < Decimal::ZERO
    {
        return Err(FillOracleRefusalV1::OutOfDomain);
    }
    let at_currency = |value: Decimal| {
        value.round_dp_with_strategy(currency_precision, RoundingStrategy::MidpointNearestEven)
    };
    let notional = at_currency(
        quantity
            .checked_mul(multiplier)
            .and_then(|value| value.checked_mul(fill_price))
            .ok_or(FillOracleRefusalV1::Overflow)?,
    );
    let fee = at_currency(
        notional
            .checked_mul(fee_rate)
            .ok_or(FillOracleRefusalV1::Overflow)?,
    );

    let unrealized = quantity
        .checked_mul(multiplier)
        .and_then(|value| value.checked_mul(bid - fill_price))
        .ok_or(FillOracleRefusalV1::Overflow)?;

    if unrealized.normalize().scale() > currency_precision {
        return Err(FillOracleRefusalV1::UnrealizedFinerThanCurrency);
    }

    if unrealized_scaled_error_bound(inputs, unrealized)? >= Decimal::new(5, 1) {
        return Err(FillOracleRefusalV1::UnrealizedFloatErrorTooLarge);
    }
    let equity = starting_balance - fee + unrealized;
    Ok(FillOracleV1 {
        fee,
        unrealized,
        equity,
        starting_balance,
    })
}

/// An upper bound on `|y - P * 10^p|`, where `y` is the engine's `pnl * 10^p` in `f64` and `P` the
/// exact unrealized PnL.
///
/// With `u = 2^-53`, and every `as_f64` correctly rounded since #1180, the engine holds `o = fl(O)`
/// (the fill's price, its position's open), `c = fl(C)` (the bid), `q = fl(Q)` and `m = fl(M)`,
/// each within a relative `u`. It then computes `points = fl(c - o)`, `t = fl(q * m)`,
/// `pnl = fl(t * points)` and `y = fl(pnl * 10^p)`, where `10^p` is exact for `p <= 22`.
///
/// `c - o = (C - O) + η` with `|η| <= u (|C| + |O|)`. The five remaining relative errors, from
/// `q`, `m`, `points`, `t` and `pnl`, compound to at most `(1 + u)^5 - 1`. So
/// `|pnl - P| <= E = Q M [ |C - O| ((1 + u)^5 - 1) + u (|C| + |O|) (1 + u)^5 ]`. The last step adds
/// `|pnl| 10^p u <= (|P| + E) 10^p u`, so `|y - P 10^p| <= 10^p [ E + (|P| + E) u ]`. When that is
/// under `1/2` and `P 10^p` is an integer, rounding `y` half away from zero gives `P 10^p` exactly.
fn unrealized_scaled_error_bound(
    inputs: FillOracleInputsV1,
    unrealized: Decimal,
) -> Result<Decimal, FillOracleRefusalV1> {
    let u = unit_roundoff();
    let one_plus_u_to_5 =
        (1..=5).try_fold(Decimal::ONE, |acc, _| acc.checked_mul(Decimal::ONE + u));
    let one_plus_u_to_5 = one_plus_u_to_5.ok_or(FillOracleRefusalV1::Overflow)?;
    let prices = inputs.bid.abs() + inputs.fill_price.abs();
    let quantity_multiplier = inputs
        .quantity
        .checked_mul(inputs.multiplier)
        .ok_or(FillOracleRefusalV1::Overflow)?;
    let spread = (inputs.bid - inputs.fill_price).abs();
    let error = quantity_multiplier
        .checked_mul(spread * (one_plus_u_to_5 - Decimal::ONE) + u * prices * one_plus_u_to_5)
        .ok_or(FillOracleRefusalV1::Overflow)?;
    let scale = Decimal::from(10_u64.pow(inputs.currency_precision));
    scale
        .checked_mul(error + (unrealized.abs() + error) * u + decimal_slack())
        .ok_or(FillOracleRefusalV1::Overflow)
}

impl FillOracleV1 {
    /// The exact point, `equity / starting_balance - 1`, to 28 significant digits.
    pub(crate) fn point(&self) -> Decimal {
        (self.equity - self.starting_balance) / self.starting_balance
    }

    /// Checks the report's fee against this one, exactly.
    ///
    /// # Errors
    ///
    /// The reported fee and the oracle's, when they differ.
    pub(crate) fn admits_fee(&self, reported: Decimal) -> Result<(), FillOracleMismatchV1> {
        if reported == self.fee {
            Ok(())
        } else {
            Err(FillOracleMismatchV1::Fee {
                reported,
                oracle: self.fee,
            })
        }
    }

    /// Checks the report's unrealized PnL against this one, exactly.
    ///
    /// # Errors
    ///
    /// The reported PnL and the oracle's, when they differ.
    pub(crate) fn admits_unrealized(&self, reported: Decimal) -> Result<(), FillOracleMismatchV1> {
        if reported == self.unrealized {
            Ok(())
        } else {
            Err(FillOracleMismatchV1::Unrealized {
                reported,
                oracle: self.unrealized,
            })
        }
    }

    /// Checks the report's point against the exact quotient, within [`point_bound`].
    ///
    /// # Errors
    ///
    /// The reported point, the exact one and the bound, when they are farther apart than the bound
    /// or the reported value cannot be read as a decimal. Refuses [`FillOracleRefusalV1::PointOutOfRange`]
    /// as a mismatch too, since no bound is derived outside it.
    pub(crate) fn admits_point(&self, reported: f64) -> Result<(), FillOracleMismatchV1> {
        let oracle = self.point();
        let mismatch = |bound| FillOracleMismatchV1::Point {
            reported,
            oracle,
            bound,
        };
        let bound =
            point_bound(self.equity, self.starting_balance).map_err(|_| mismatch(Decimal::ZERO))?;
        // The reported `f64`'s exact value, to 28 significant digits: well inside the bound, which
        // is about fifteen orders of magnitude above the point's last digit here.
        let reported_decimal = Decimal::from_f64_retain(reported).ok_or_else(|| mismatch(bound))?;

        if (reported_decimal - oracle).abs() <= bound {
            Ok(())
        } else {
            Err(mismatch(bound))
        }
    }
}

/// The largest distance the engine's `f64` point can have from the exact quotient.
///
/// The engine reads `a = fl(E1)` and `b = fl(E0)` with `Money::as_f64`, which is correctly rounded
/// since #1180 at the one precision, 16, that every build uses since #1193. So
/// `a = E1 (1 + e1)` and `b = E0 (1 + e0)` with `|e0|, |e1| <= u = 2^-53`. It divides,
/// `d = fl(a / b) = (a / b)(1 + e2)`, and subtracts one. When `d` lies in `[1/2, 2]`, Sterbenz's
/// lemma makes `fl(d - 1) = d - 1` exact, which holds for any point in `[-1/2, 1]` with room for
/// the errors above. With `q = E1 / E0` the exact point is `q - 1`, so the engine's differs by
/// `q |(1 + e1)(1 + e2) / (1 + e0) - 1| <= q ((1 + u)^2 / (1 - u) - 1)`.
///
/// A fee one tick off moves the point by `10^-p / E0`, which for any balance this run uses is many
/// orders of magnitude above that bound, so the bound cannot admit it.
fn point_bound(equity: Decimal, starting_balance: Decimal) -> Result<Decimal, FillOracleRefusalV1> {
    let q = equity / starting_balance;

    if q < Decimal::new(55, 2) || q > Decimal::new(19, 1) {
        return Err(FillOracleRefusalV1::PointOutOfRange);
    }
    let u = unit_roundoff();
    let factor = (Decimal::ONE + u) * (Decimal::ONE + u) / (Decimal::ONE - u) - Decimal::ONE;
    Ok(q * factor + decimal_slack())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use rust_decimal::Decimal;

    use super::*;

    /// A LINKUSDT-PERP fill: bid 123.44, filled at 123.46, one contract, multiplier 1, a
    /// fee rate of 0.05%, a 10,000 USDT balance, and USDT at 8 places.
    fn linkusdt() -> FillOracleInputsV1 {
        FillOracleInputsV1 {
            bid: Decimal::new(12_344, 2),
            fill_price: Decimal::new(12_346, 2),
            quantity: Decimal::ONE,
            multiplier: Decimal::ONE,
            fee_rate: Decimal::new(5, 4),
            starting_balance: Decimal::new(10_000, 0),
            currency_precision: 8,
        }
    }

    /// The engine's own `f64` steps for the point, from exact decimal equities: each equity read as
    /// its nearest `f64`, divided, and one subtracted.
    fn engine_point(equity: Decimal, starting_balance: Decimal) -> f64 {
        let as_f64 = |value: Decimal| value.to_string().parse::<f64>().expect("a decimal parses");
        as_f64(equity) / as_f64(starting_balance) - 1.0
    }

    /// By hand: the notional is 123.46, the fee 0.06173, the PnL at the bid -0.02, the equity
    /// 9,999.91827, and the point -0.08173 / 10,000.
    #[rstest]
    fn the_linkusdt_fill_is_computed_by_hand() {
        let oracle = fill_oracle_v1(linkusdt()).expect("the fill is exact");
        assert_eq!(oracle.fee, Decimal::new(6_173, 5));
        assert_eq!(oracle.unrealized, Decimal::new(-2, 2));
        assert_eq!(oracle.equity, Decimal::new(999_991_827, 5));
        assert_eq!(oracle.point(), Decimal::new(-8_173, 9));
        assert_eq!(oracle.admits_fee(Decimal::new(6_173, 5)), Ok(()));
        assert_eq!(oracle.admits_unrealized(Decimal::new(-2, 2)), Ok(()));
        assert_eq!(
            oracle.admits_point(engine_point(oracle.equity, oracle.starting_balance)),
            Ok(())
        );
    }

    /// A fee one tick off is refused at every check: its own, and the point it would make.
    #[rstest]
    #[case::a_tick_over(1)]
    #[case::a_tick_under(-1)]
    fn a_fee_one_tick_off_is_refused(#[case] ticks: i64) {
        let oracle = fill_oracle_v1(linkusdt()).expect("the fill is exact");
        let tick = Decimal::new(ticks, 8);
        assert!(matches!(
            oracle.admits_fee(oracle.fee + tick),
            Err(FillOracleMismatchV1::Fee { .. })
        ));
        let shifted = engine_point(oracle.equity - tick, oracle.starting_balance);
        assert!(
            matches!(
                oracle.admits_point(shifted),
                Err(FillOracleMismatchV1::Point { .. })
            ),
            "a point {shifted} from a fee a tick off is outside the bound"
        );
    }

    /// Both of the fee's roundings are half to even at the currency's places, never half up.
    #[rstest]
    // 0.00000003 * 0.5 = 0.000000015: odd below the half, so it rounds up to 0.00000002.
    #[case::commission_odd_half_rounds_up("0.00000003", "1", "0.5", "0.00000002")]
    // 0.00000005 * 0.5 = 0.000000025: even below the half, so it stays at 0.00000002.
    #[case::commission_even_half_stays("0.00000005", "1", "0.5", "0.00000002")]
    // The notional 0.123456785 is even below its half, so it is 0.12345678 before the rate.
    #[case::notional_even_half_stays("0.123456785", "1", "1", "0.12345678")]
    // The notional 0.123456775 is odd below its half, so it is 0.12345678 too.
    #[case::notional_odd_half_rounds_up("0.123456775", "1", "1", "0.12345678")]
    // The notional rounds before the rate: 0.123456789 is 0.12345679, whose half 0.061728395 is odd
    // below its half and goes to 0.06172840; halving the unrounded notional would give 0.06172839.
    #[case::notional_rounds_before_the_rate("0.123456789", "1", "0.5", "0.06172840")]
    fn each_fee_rounding_is_half_to_even(
        #[case] fill_price: &str,
        #[case] quantity: &str,
        #[case] fee_rate: &str,
        #[case] fee: &str,
    ) {
        let fill_price: Decimal = fill_price.parse().unwrap();
        let oracle = fill_oracle_v1(FillOracleInputsV1 {
            bid: fill_price,
            fill_price,
            quantity: quantity.parse().unwrap(),
            fee_rate: fee_rate.parse().unwrap(),
            ..linkusdt()
        })
        .expect("the fill is exact");
        assert_eq!(oracle.fee, fee.parse::<Decimal>().unwrap());
    }

    /// No exact PnL is claimed where the engine's `f64` path may not produce it.
    #[rstest]
    fn an_unrealized_pnl_the_engine_rounds_from_f64_is_refused() {
        let finer = FillOracleInputsV1 {
            bid: Decimal::new(123_440_000_001, 9),
            ..linkusdt()
        };
        assert_eq!(
            fill_oracle_v1(finer),
            Err(FillOracleRefusalV1::UnrealizedFinerThanCurrency)
        );
        let huge = FillOracleInputsV1 {
            bid: Decimal::new(1_000_000_000, 0),
            fill_price: Decimal::new(1_000_000_001, 0),
            quantity: Decimal::new(1_000_000_000, 0),
            starting_balance: Decimal::new(1_000_000_000_000_000, 0),
            ..linkusdt()
        };
        assert_eq!(
            fill_oracle_v1(huge),
            Err(FillOracleRefusalV1::UnrealizedFloatErrorTooLarge)
        );
    }

    /// The bound is the derivation's, evaluated: about three units of roundoff at a point near
    /// zero, and a point outside the range the derivation covers is refused.
    #[rstest]
    fn the_point_bound_is_three_units_of_roundoff_near_zero() {
        let bound = point_bound(Decimal::new(10_000, 0), Decimal::new(10_000, 0)).unwrap();
        let three_u = Decimal::new(3, 0) * unit_roundoff();
        assert!(bound >= three_u && bound < three_u * Decimal::new(10_001, 4));
        assert_eq!(
            point_bound(Decimal::new(40, 0), Decimal::new(100, 0)),
            Err(FillOracleRefusalV1::PointOutOfRange)
        );
    }
}
