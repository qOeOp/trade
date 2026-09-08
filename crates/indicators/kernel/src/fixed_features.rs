//! Pure fixed-decimal feature formulas. Sample selection, clocks and warm-up are caller-owned.

use core::num::NonZeroU32;

use crate::{
    DecimalScale, FixedI128, NumericFailure, RoundingMode,
    fixed_i128::{apply_decimal_exponent, finish},
    i256::I256,
};

/// Feature input failures, separate from the stable numeric-failure wire tags.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedFeatureFailure {
    Numeric(NumericFailure),
    InvalidOhlc,
    InvertedRange,
    NegativeAverage,
    InvalidWindow,
}

impl From<NumericFailure> for FixedFeatureFailure {
    fn from(value: NumericFailure) -> Self {
        Self::Numeric(value)
    }
}

/// A validated canonical reduced rational in the closed unit interval.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReducedUnitFraction {
    numerator: u32,
    denominator: u32,
}

impl ReducedUnitFraction {
    /// Rejects noncanonical ratios instead of reducing, clamping or extending them.
    #[must_use]
    pub const fn new(numerator: u32, denominator: u32) -> Option<Self> {
        if denominator == 0 || numerator > denominator {
            return None;
        }

        let mut left = numerator;
        let mut right = denominator;

        while right != 0 {
            let remainder = left % right;
            left = right;
            right = remainder;
        }

        if left == 1 {
            Some(Self {
                numerator,
                denominator,
            })
        } else {
            None
        }
    }

    #[must_use]
    pub const fn numerator(self) -> u32 {
        self.numerator
    }

    #[must_use]
    pub const fn denominator(self) -> u32 {
        self.denominator
    }
}

/// Equal-scale OHLC values whose ordering has already been validated.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixedOhlc {
    open: FixedI128,
    high: FixedI128,
    low: FixedI128,
    close: FixedI128,
}

impl FixedOhlc {
    pub fn new(
        open: FixedI128,
        high: FixedI128,
        low: FixedI128,
        close: FixedI128,
    ) -> Result<Self, FixedFeatureFailure> {
        for value in [high, low, close] {
            require_same_scale(open, value)?;
        }

        if low.coefficient() > open.coefficient().min(close.coefficient())
            || high.coefficient() < open.coefficient().max(close.coefficient())
        {
            return Err(FixedFeatureFailure::InvalidOhlc);
        }

        Ok(Self {
            open,
            high,
            low,
            close,
        })
    }

    #[must_use]
    pub const fn open(self) -> FixedI128 {
        self.open
    }

    #[must_use]
    pub const fn close(self) -> FixedI128 {
        self.close
    }

    #[must_use]
    pub const fn high(self) -> FixedI128 {
        self.high
    }

    #[must_use]
    pub const fn low(self) -> FixedI128 {
        self.low
    }

    pub fn body(self) -> Result<FixedI128, NumericFailure> {
        let upper = self.open.coefficient().max(self.close.coefficient());
        let lower = self.open.coefficient().min(self.close.coefficient());
        self.difference(upper, lower)
    }

    pub fn range(self) -> Result<FixedI128, NumericFailure> {
        self.high.checked_sub(self.low)
    }

    pub fn upper_wick(self) -> Result<FixedI128, NumericFailure> {
        self.difference(
            self.high.coefficient(),
            self.open.coefficient().max(self.close.coefficient()),
        )
    }

    pub fn lower_wick(self) -> Result<FixedI128, NumericFailure> {
        self.difference(
            self.open.coefficient().min(self.close.coefficient()),
            self.low.coefficient(),
        )
    }

    /// The state owner reports WARMING when no previous close exists.
    pub fn gap(self, previous_close: FixedI128) -> Result<FixedI128, NumericFailure> {
        self.open.checked_sub(previous_close)
    }

    /// Evaluates the first-sample or previous-close true range without storing either sample.
    pub fn true_range(
        self,
        previous_close: Option<FixedI128>,
    ) -> Result<FixedI128, NumericFailure> {
        let Some(previous) = previous_close else {
            return self.range();
        };
        require_same_scale(self.close, previous)?;
        // For validated low <= high, this is exactly the maximum of the three ranges.
        self.difference(
            self.high.coefficient().max(previous.coefficient()),
            self.low.coefficient().min(previous.coefficient()),
        )
    }

    fn difference(self, upper: i128, lower: i128) -> Result<FixedI128, NumericFailure> {
        let value = I256::from_i128(upper)
            .checked_sub(I256::from_i128(lower))
            .ok_or(NumericFailure::I256Overflow)?;
        finish(value, I256::ONE, self.close.scale(), None)
    }
}

/// Sums an already selected complete, nonempty window. This does not admit a partial window.
pub fn fixed_window_sum(
    values: &[FixedI128],
    window: NonZeroU32,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, FixedFeatureFailure> {
    let (sum, input_scale, _) = window_sum(values, window)?;
    Ok(finish_at_scale(
        sum,
        I256::ONE,
        input_scale,
        output_scale,
        rounding,
    )?)
}

/// Computes the arithmetic mean of a complete window with one final division and rounding.
pub fn fixed_window_mean(
    values: &[FixedI128],
    window: NonZeroU32,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, FixedFeatureFailure> {
    let (sum, input_scale, count) = window_sum(values, window)?;
    Ok(finish_at_scale(
        sum,
        I256::from_i128(i128::from(count)),
        input_scale,
        output_scale,
        rounding,
    )?)
}

/// Computes the dimensionless RSI output from validated, externally maintained averages.
///
/// Initial delta accumulation and subsequent Wilder updates are separate state transitions.
pub fn fixed_rsi_from_averages(
    gain: FixedI128,
    loss: FixedI128,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, FixedFeatureFailure> {
    require_same_scale(gain, loss)?;

    if gain.coefficient() < 0 || loss.coefficient() < 0 {
        return Err(FixedFeatureFailure::NegativeAverage);
    }

    let zero_scale = DecimalScale::new(0)?;

    if gain.coefficient() == 0 && loss.coefficient() == 0 {
        return Ok(FixedI128::from_parts(50, zero_scale).rescale(output_scale, rounding)?);
    }

    if loss.coefficient() == 0 {
        return Ok(FixedI128::from_parts(100, zero_scale).rescale(output_scale, rounding)?);
    }

    if gain.coefficient() == 0 {
        return Ok(FixedI128::from_parts(0, zero_scale).rescale(output_scale, rounding)?);
    }

    let numerator = I256::from_i128(gain.coefficient())
        .checked_mul(I256::from_i128(100))
        .ok_or(NumericFailure::I256Overflow)?;
    let denominator = I256::from_i128(gain.coefficient())
        .checked_add(I256::from_i128(loss.coefficient()))
        .ok_or(NumericFailure::I256Overflow)?;
    Ok(finish_at_scale(
        numerator,
        denominator,
        zero_scale,
        output_scale,
        rounding,
    )?)
}

/// Evaluates low + (high - low) * fraction as one I256 expression at an explicit output scale.
pub fn fixed_range_fraction(
    low: FixedI128,
    high: FixedI128,
    fraction: ReducedUnitFraction,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, FixedFeatureFailure> {
    require_same_scale(low, high)?;

    if low.coefficient() > high.coefficient() {
        return Err(FixedFeatureFailure::InvertedRange);
    }

    let low_coefficient = I256::from_i128(low.coefficient());
    let denominator = I256::from_i128(i128::from(fraction.denominator));
    let increment = I256::from_i128(high.coefficient())
        .checked_sub(low_coefficient)
        .and_then(|difference| {
            difference.checked_mul(I256::from_i128(i128::from(fraction.numerator)))
        })
        .ok_or(NumericFailure::I256Overflow)?;
    let numerator = low_coefficient
        .checked_mul(denominator)
        .and_then(|base| base.checked_add(increment))
        .ok_or(NumericFailure::I256Overflow)?;
    Ok(finish_at_scale(
        numerator,
        denominator,
        low.scale(),
        output_scale,
        rounding,
    )?)
}

fn require_same_scale(left: FixedI128, right: FixedI128) -> Result<(), NumericFailure> {
    if left.scale() == right.scale() {
        Ok(())
    } else {
        Err(NumericFailure::ScaleMismatch)
    }
}

fn window_sum(
    values: &[FixedI128],
    window: NonZeroU32,
) -> Result<(I256, DecimalScale, u32), FixedFeatureFailure> {
    let expected_len =
        usize::try_from(window.get()).map_err(|_| FixedFeatureFailure::InvalidWindow)?;

    if values.len() != expected_len {
        return Err(FixedFeatureFailure::InvalidWindow);
    }

    let Some(first) = values.first() else {
        return Err(FixedFeatureFailure::InvalidWindow);
    };
    let count = window.get();
    let mut sum = I256::ZERO;

    for value in values {
        require_same_scale(*first, *value)?;
        sum = sum
            .checked_add(I256::from_i128(value.coefficient()))
            .ok_or(NumericFailure::I256Overflow)?;
    }

    Ok((sum, first.scale(), count))
}

fn finish_at_scale(
    numerator: I256,
    denominator: I256,
    input_scale: DecimalScale,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, NumericFailure> {
    let exponent = i16::from(output_scale.get()) - i16::from(input_scale.get());
    let (numerator, denominator) = apply_decimal_exponent(numerator, denominator, exponent)?;
    finish(numerator, denominator, output_scale, rounding)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn fixed(coefficient: i128, scale: u8) -> FixedI128 {
        FixedI128::new(coefficient, scale).unwrap()
    }

    fn scale(value: u8) -> DecimalScale {
        DecimalScale::new(value).unwrap()
    }

    fn round(numerator: i128, denominator: i128, mode: RoundingMode) -> i128 {
        let quotient = numerator / denominator;
        let remainder = numerator % denominator;
        let twice_remainder = remainder.abs() * 2;

        if mode == RoundingMode::NearestTiesToEven
            && (twice_remainder > denominator
                || (twice_remainder == denominator && quotient % 2 != 0))
        {
            quotient + numerator.signum()
        } else {
            quotient
        }
    }

    #[rstest]
    fn fraction_configuration_rejects_noncanonical_values() {
        for (numerator, denominator) in [(0, 0), (1, 0), (0, 2), (2, 2), (2, 4), (4, 3)] {
            assert_eq!(ReducedUnitFraction::new(numerator, denominator), None);
        }

        for (numerator, denominator) in [(0, 1), (1, 1), (1, 2), (2, 3), (1, u32::MAX)] {
            let ratio = ReducedUnitFraction::new(numerator, denominator).unwrap();
            assert_eq!(
                (ratio.numerator(), ratio.denominator()),
                (numerator, denominator)
            );
        }
    }

    #[rstest]
    fn range_fraction_matches_weighted_endpoint_oracle_at_explicit_scales() {
        for low in -5_i128..=5 {
            for high in low..=5 {
                for denominator in 1_u32..=5 {
                    for numerator in 0..=denominator {
                        let Some(ratio) = ReducedUnitFraction::new(numerator, denominator) else {
                            continue;
                        };
                        let weighted = i128::from(denominator - numerator) * low
                            + i128::from(numerator) * high;

                        for output in 0..=2 {
                            for mode in [RoundingMode::TowardZero, RoundingMode::NearestTiesToEven]
                            {
                                let expected = round(
                                    weighted * 10_i128.pow(u32::from(output)),
                                    i128::from(denominator) * 10,
                                    mode,
                                );
                                assert_eq!(
                                    fixed_range_fraction(
                                        fixed(low, 1),
                                        fixed(high, 1),
                                        ratio,
                                        scale(output),
                                        Some(mode)
                                    ),
                                    Ok(fixed(expected, output)),
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[rstest]
    fn wide_range_and_window_math_narrows_only_at_the_result() {
        let even = Some(RoundingMode::NearestTiesToEven);
        let half = ReducedUnitFraction::new(1, 2).unwrap();
        assert_eq!(
            fixed_range_fraction(
                fixed(i128::MIN, 0),
                fixed(i128::MAX, 0),
                half,
                scale(0),
                even
            ),
            Ok(fixed(0, 0))
        );
        assert_eq!(
            fixed_range_fraction(
                fixed(i128::MIN, 0),
                fixed(i128::MAX, 0),
                ReducedUnitFraction::new(0, 1).unwrap(),
                scale(0),
                None
            ),
            Ok(fixed(i128::MIN, 0))
        );
        assert_eq!(
            fixed_range_fraction(
                fixed(i128::MIN, 0),
                fixed(i128::MAX, 0),
                ReducedUnitFraction::new(1, 1).unwrap(),
                scale(0),
                None
            ),
            Ok(fixed(i128::MAX, 0))
        );
        assert_eq!(
            fixed_range_fraction(
                fixed(-50, 1),
                fixed(50, 1),
                ReducedUnitFraction::new(3, 4).unwrap(),
                scale(2),
                None
            ),
            Ok(fixed(250, 2))
        );

        let two = NonZeroU32::new(2).unwrap();

        for endpoint in [i128::MIN, i128::MAX] {
            let values = [fixed(endpoint, 0); 2];
            assert_eq!(
                fixed_window_mean(&values, two, scale(0), None),
                Ok(fixed(endpoint, 0))
            );
            assert_eq!(
                fixed_window_sum(&values, two, scale(0), None),
                Err(FixedFeatureFailure::Numeric(
                    NumericFailure::FinalI128Overflow
                ))
            );
        }

        let values = [
            fixed(i128::MAX, 0),
            fixed(i128::MAX, 0),
            fixed(i128::MIN, 0),
            fixed(i128::MIN, 0),
        ];
        let four = NonZeroU32::new(4).unwrap();
        assert_eq!(
            fixed_window_sum(&values, four, scale(0), None),
            Ok(fixed(-2, 0))
        );
        assert_eq!(
            fixed_window_mean(&values, four, scale(1), None),
            Ok(fixed(-5, 1))
        );
    }

    #[rstest]
    fn full_window_mean_matches_rational_reference() {
        let two = NonZeroU32::new(2).unwrap();

        for left in -6_i128..=6 {
            for right in -6_i128..=6 {
                let values = [fixed(left, 1), fixed(right, 1)];

                for output in 0..=2 {
                    for mode in [RoundingMode::TowardZero, RoundingMode::NearestTiesToEven] {
                        let factor = 10_i128.pow(u32::from(output));
                        assert_eq!(
                            fixed_window_mean(&values, two, scale(output), Some(mode)),
                            Ok(fixed(round((left + right) * factor, 20, mode), output))
                        );
                        assert_eq!(
                            fixed_window_sum(&values, two, scale(output), Some(mode)),
                            Ok(fixed(round((left + right) * factor, 10, mode), output))
                        );
                    }
                }
            }
        }
    }

    #[rstest]
    fn ohlc_geometry_matches_integer_definitions() {
        for low in -2_i128..=2 {
            for high in low..=2 {
                for open in low..=high {
                    for close in low..=high {
                        let bar = FixedOhlc::new(
                            fixed(open, 2),
                            fixed(high, 2),
                            fixed(low, 2),
                            fixed(close, 2),
                        )
                        .unwrap();
                        assert_eq!(bar.close(), fixed(close, 2));
                        assert_eq!(bar.high(), fixed(high, 2));
                        assert_eq!(bar.low(), fixed(low, 2));
                        assert_eq!(bar.body(), Ok(fixed((close - open).abs(), 2)));
                        assert_eq!(bar.range(), Ok(fixed(high - low, 2)));
                        assert_eq!(bar.upper_wick(), Ok(fixed(high - open.max(close), 2)));
                        assert_eq!(bar.lower_wick(), Ok(fixed(open.min(close) - low, 2)));
                        assert_eq!(bar.true_range(None), Ok(fixed(high - low, 2)));

                        for previous in -3_i128..=3 {
                            let true_range = (high - low)
                                .max((high - previous).abs())
                                .max((low - previous).abs());
                            assert_eq!(
                                bar.true_range(Some(fixed(previous, 2))),
                                Ok(fixed(true_range, 2))
                            );
                            assert_eq!(bar.gap(fixed(previous, 2)), Ok(fixed(open - previous, 2)));
                        }
                    }
                }
            }
        }
    }

    #[rstest]
    fn rsi_uses_zero_frontiers_and_one_scaled_ratio() {
        for gain in 0_i128..=12 {
            for loss in 0_i128..=12 {
                for output in 0..=2 {
                    for mode in [RoundingMode::TowardZero, RoundingMode::NearestTiesToEven] {
                        let factor = 10_i128.pow(u32::from(output));
                        let expected = if gain + loss == 0 {
                            50 * factor
                        } else {
                            round(100 * gain * factor, gain + loss, mode)
                        };
                        assert_eq!(
                            fixed_rsi_from_averages(
                                fixed(gain, 3),
                                fixed(loss, 3),
                                scale(output),
                                Some(mode)
                            ),
                            Ok(fixed(expected, output))
                        );
                    }
                }
            }
        }

        let wide = fixed(i128::MAX, 0);
        assert_eq!(
            fixed_rsi_from_averages(wide, wide, scale(0), None),
            Ok(fixed(50, 0))
        );
        assert_eq!(
            fixed_rsi_from_averages(wide, fixed(0, 0), scale(0), None),
            Ok(fixed(100, 0))
        );
        assert_eq!(
            fixed_rsi_from_averages(fixed(0, 0), wide, scale(38), None),
            Ok(fixed(0, 38))
        );
        assert_eq!(
            fixed_rsi_from_averages(wide, fixed(0, 0), scale(38), None),
            Err(FixedFeatureFailure::Numeric(
                NumericFailure::FinalI128Overflow
            ))
        );
    }

    #[rstest]
    fn invalid_shapes_scales_and_unrounded_remainders_are_rejected() {
        let value = fixed(1, 0);
        let two = NonZeroU32::new(2).unwrap();
        let half = ReducedUnitFraction::new(1, 2).unwrap();
        let numeric = FixedFeatureFailure::Numeric;
        assert_eq!(
            fixed_window_mean(&[value], two, scale(0), None),
            Err(FixedFeatureFailure::InvalidWindow)
        );
        assert_eq!(
            fixed_window_sum(&[], two, scale(0), None),
            Err(FixedFeatureFailure::InvalidWindow)
        );
        assert_eq!(
            fixed_window_mean(&[value, fixed(1, 1)], two, scale(0), None),
            Err(numeric(NumericFailure::ScaleMismatch))
        );
        assert_eq!(
            fixed_window_mean(&[value, fixed(2, 0)], two, scale(0), None),
            Err(numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(
            fixed_range_fraction(value, fixed(0, 0), half, scale(0), None),
            Err(FixedFeatureFailure::InvertedRange)
        );
        assert_eq!(
            fixed_range_fraction(value, fixed(2, 1), half, scale(0), None),
            Err(numeric(NumericFailure::ScaleMismatch))
        );
        assert_eq!(
            fixed_range_fraction(value, fixed(2, 0), half, scale(0), None),
            Err(numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(
            fixed_rsi_from_averages(value, fixed(-1, 0), scale(0), None),
            Err(FixedFeatureFailure::NegativeAverage)
        );
        assert_eq!(
            fixed_rsi_from_averages(value, fixed(1, 1), scale(0), None),
            Err(numeric(NumericFailure::ScaleMismatch))
        );
        assert_eq!(
            fixed_rsi_from_averages(value, fixed(2, 0), scale(0), None),
            Err(numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(
            FixedOhlc::new(value, fixed(0, 0), value, value),
            Err(FixedFeatureFailure::InvalidOhlc)
        );
        assert_eq!(
            FixedOhlc::new(value, value, fixed(2, 0), value),
            Err(FixedFeatureFailure::InvalidOhlc)
        );
        assert_eq!(
            FixedOhlc::new(value, value, value, fixed(1, 1)),
            Err(numeric(NumericFailure::ScaleMismatch))
        );

        let bar = FixedOhlc::new(value, value, value, value).unwrap();
        assert_eq!(bar.gap(fixed(1, 1)), Err(NumericFailure::ScaleMismatch));
        assert_eq!(
            bar.true_range(Some(fixed(1, 1))),
            Err(NumericFailure::ScaleMismatch)
        );
        let wide_bar = FixedOhlc::new(
            fixed(i128::MIN, 0),
            fixed(i128::MAX, 0),
            fixed(i128::MIN, 0),
            fixed(i128::MAX, 0),
        )
        .unwrap();
        assert_eq!(wide_bar.body(), Err(NumericFailure::FinalI128Overflow));
        assert_eq!(
            wide_bar.true_range(None),
            Err(NumericFailure::FinalI128Overflow)
        );
    }
}
