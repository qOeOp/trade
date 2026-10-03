//! Exact rescaling of a fixed-point decimal to another scale.
//!
//! A value `mantissa * 10^-scale` is restated at `target_scale` only when that restatement is
//! exact. Widening multiplies the mantissa by `10^(target_scale - scale)`; narrowing divides it by
//! `10^(scale - target_scale)` and is admitted only when the remainder is zero, so `4500010` at
//! scale 2 is `450001` at scale 1 while `4500011` is refused. A value with a nonzero digit finer
//! than the target would have to be rounded, and a widened mantissa that does not fit in an `i128`
//! would have to be truncated; both are refused by name. Nothing here ever rounds.

use std::fmt::Display;

/// The one decimal scale Market Data states a market value at: every custody series and every
/// strategy input role. A tick is not a scale - an instrument's tick changes over its history, and
/// BTCUSDT's 2021 bars sit on a finer grid than today's tick - so the scale is fixed here once.
pub const MARKET_DATA_VALUE_SCALE_V1: u8 = 9;

/// Why a value cannot be restated exactly at the target scale.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RescaleErrorV1 {
    /// The value has a nonzero digit finer than the target scale can hold.
    FinerThanTarget,
    /// The exact restatement does not fit in an `i128`.
    Overflow,
}

impl Display for RescaleErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::FinerThanTarget => "the value is finer than the target scale",
            Self::Overflow => "the value does not fit at the target scale",
        })
    }
}

impl std::error::Error for RescaleErrorV1 {}

/// Restates `mantissa * 10^-scale` at `target_scale` and returns the new mantissa.
///
/// A value already at `target_scale` comes back unchanged.
///
/// # Errors
///
/// [`RescaleErrorV1::FinerThanTarget`] when narrowing would drop a nonzero digit, and
/// [`RescaleErrorV1::Overflow`] when the widened mantissa does not fit in an `i128`.
pub fn rescale_exact_v1(
    mantissa: i128,
    scale: u8,
    target_scale: u8,
) -> Result<i128, RescaleErrorV1> {
    if let Some(places) = target_scale.checked_sub(scale) {
        return 10_i128
            .checked_pow(u32::from(places))
            .and_then(|factor| mantissa.checked_mul(factor))
            .ok_or(RescaleErrorV1::Overflow);
    }
    // Narrowing past 38 places leaves no representable nonzero digit, so only zero survives it.
    let Some(divisor) = 10_i128.checked_pow(u32::from(scale - target_scale)) else {
        return if mantissa == 0 {
            Ok(0)
        } else {
            Err(RescaleErrorV1::FinerThanTarget)
        };
    };

    if mantissa % divisor == 0 {
        Ok(mantissa / divisor)
    } else {
        Err(RescaleErrorV1::FinerThanTarget)
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case::same_scale(123_456, 8, 8, Ok(123_456))]
    #[case::one_place_to_eight(1_234_565, 1, 8, Ok(12_345_650_000_000))]
    #[case::negative(-15, 1, 3, Ok(-1_500))]
    #[case::zero(0, 0, 38, Ok(0))]
    #[case::narrow_exact(4_500_010, 2, 1, Ok(450_001))]
    #[case::nine_to_eight_exact(37_244_360_000_000, 9, 8, Ok(3_724_436_000_000))]
    #[case::narrow_negative_exact(-1_500, 3, 1, Ok(-15))]
    #[case::narrow_inexact(4_500_011, 2, 1, Err(RescaleErrorV1::FinerThanTarget))]
    #[case::finer(123_456_789, 9, 8, Err(RescaleErrorV1::FinerThanTarget))]
    #[case::narrow_past_i128_zero(0, 60, 0, Ok(0))]
    #[case::narrow_past_i128_nonzero(1, 60, 0, Err(RescaleErrorV1::FinerThanTarget))]
    #[case::mantissa_overflow(i128::MAX / 10 + 1, 0, 1, Err(RescaleErrorV1::Overflow))]
    #[case::factor_overflow(1, 0, 39, Err(RescaleErrorV1::Overflow))]
    fn restates_only_exactly(
        #[case] mantissa: i128,
        #[case] scale: u8,
        #[case] target_scale: u8,
        #[case] expected: Result<i128, RescaleErrorV1>,
    ) {
        assert_eq!(rescale_exact_v1(mantissa, scale, target_scale), expected);
    }
}
