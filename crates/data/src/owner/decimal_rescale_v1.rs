//! Exact rescaling of a fixed-point decimal `mantissa * 10^-scale` to another scale.
//!
//! It depends on integers alone, so any Market Data surface that aligns values to one scale - a
//! PIT window custody series to its Instrument Master increment, a binding role to its declared
//! scale - shares one arithmetic. It never rounds: a value finer than the target is refused.

/// Why a value cannot be stated exactly at the target scale.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RescaleErrorV1 {
    /// The value has more decimal places than the target scale holds.
    FinerThanTarget,
    /// The rescaled mantissa does not fit an `i128`.
    Overflow,
}

/// The mantissa of `mantissa * 10^-scale` at `target_scale`, exactly.
///
/// # Errors
///
/// [`RescaleErrorV1::FinerThanTarget`] when `scale` is above `target_scale`, and
/// [`RescaleErrorV1::Overflow`] when the rescaled mantissa does not fit.
pub(crate) fn rescale_exact_v1(
    mantissa: i128,
    scale: u8,
    target_scale: u8,
) -> Result<i128, RescaleErrorV1> {
    let widen = target_scale
        .checked_sub(scale)
        .ok_or(RescaleErrorV1::FinerThanTarget)?;
    10_i128
        .checked_pow(u32::from(widen))
        .and_then(|factor| mantissa.checked_mul(factor))
        .ok_or(RescaleErrorV1::Overflow)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case::one_place_to_two(450_001, 1, 2, Ok(4_500_010))]
    #[case::same_scale(4_500_012, 2, 2, Ok(4_500_012))]
    #[case::integer_to_three(-7, 0, 3, Ok(-7_000))]
    #[case::finer(45_000_123, 3, 2, Err(RescaleErrorV1::FinerThanTarget))]
    #[case::finer_even_when_trailing_zero(4_500_010, 2, 1, Err(RescaleErrorV1::FinerThanTarget))]
    #[case::overflow_of_the_product(i128::MAX / 5, 0, 1, Err(RescaleErrorV1::Overflow))]
    #[case::overflow_of_the_factor(1, 0, 39, Err(RescaleErrorV1::Overflow))]
    fn a_value_is_rescaled_exactly_or_refused(
        #[case] mantissa: i128,
        #[case] scale: u8,
        #[case] target_scale: u8,
        #[case] expected: Result<i128, RescaleErrorV1>,
    ) {
        assert_eq!(rescale_exact_v1(mantissa, scale, target_scale), expected);
    }
}
