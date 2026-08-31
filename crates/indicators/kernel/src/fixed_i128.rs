use core::cmp::Ordering;

use crate::i256::{I256, Sign};

/// Largest decimal scale admitted by Bounded Feature Program V1.
pub const MAX_DECIMAL_SCALE: u8 = 38;

/// A validated BFP V1 base-10 scale.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DecimalScale(u8);

impl DecimalScale {
    /// Canonical one-byte encoding length.
    pub const CANONICAL_LEN: usize = 1;

    /// Validates a scale in the closed interval `0..=38`.
    pub const fn new(scale: u8) -> Result<Self, NumericFailure> {
        if scale <= MAX_DECIMAL_SCALE {
            Ok(Self(scale))
        } else {
            Err(NumericFailure::InvalidScale)
        }
    }

    /// Returns the canonical unsigned scale byte.
    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }

    /// Encodes this scale as one fixed-width canonical byte.
    #[must_use]
    pub const fn to_canonical_bytes(self) -> [u8; Self::CANONICAL_LEN] {
        [self.get()]
    }

    /// Decodes exactly one canonical scale byte.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, CanonicalDecodeError> {
        let scale = decode_one_byte(bytes)?;
        Self::new(scale).map_err(|_| CanonicalDecodeError::InvalidScale)
    }
}

/// The only rounding modes admitted by BFP V1.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RoundingMode {
    /// Discard the fractional remainder.
    TowardZero,
    /// Round a half to the nearest result whose coefficient is even.
    NearestTiesToEven,
}

impl RoundingMode {
    /// Canonical one-byte encoding length.
    pub const CANONICAL_LEN: usize = 1;

    /// Returns the stable canonical tag (`1` or `2`).
    #[must_use]
    pub const fn canonical_tag(self) -> u8 {
        match self {
            Self::TowardZero => 1,
            Self::NearestTiesToEven => 2,
        }
    }

    /// Encodes this mode as one fixed-width canonical byte.
    #[must_use]
    pub const fn to_canonical_bytes(self) -> [u8; Self::CANONICAL_LEN] {
        [self.canonical_tag()]
    }

    /// Encodes an optional rounding declaration (`0 = none`, `1` and `2` are modes).
    #[must_use]
    pub const fn optional_to_canonical_bytes(rounding: Option<Self>) -> [u8; Self::CANONICAL_LEN] {
        match rounding {
            None => [0],
            Some(mode) => mode.to_canonical_bytes(),
        }
    }

    /// Decodes an optional rounding declaration and rejects unknown or trailing bytes.
    pub fn optional_from_canonical_bytes(
        bytes: &[u8],
    ) -> Result<Option<Self>, CanonicalDecodeError> {
        match decode_one_byte(bytes)? {
            0 => Ok(None),
            1 => Ok(Some(Self::TowardZero)),
            2 => Ok(Some(Self::NearestTiesToEven)),
            _ => Err(CanonicalDecodeError::UnknownTag),
        }
    }

    /// Decodes one mode and rejects reserved, unknown, or trailing bytes.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, CanonicalDecodeError> {
        let tag = decode_one_byte(bytes)?;
        match tag {
            0 => Err(CanonicalDecodeError::ReservedTag),
            1 => Ok(Self::TowardZero),
            2 => Ok(Self::NearestTiesToEven),
            _ => Err(CanonicalDecodeError::UnknownTag),
        }
    }
}

/// Closed arithmetic failures for BFP V1 numeric evaluation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum NumericFailure {
    InvalidScale,
    ScaleMismatch,
    DivideByZero,
    RoundingRequired,
    I256Overflow,
    FinalI128Overflow,
}

impl NumericFailure {
    /// Canonical one-byte encoding length.
    pub const CANONICAL_LEN: usize = 1;

    /// Returns the stable canonical failure tag.
    #[must_use]
    pub const fn canonical_tag(self) -> u8 {
        match self {
            Self::InvalidScale => 1,
            Self::ScaleMismatch => 2,
            Self::DivideByZero => 3,
            Self::RoundingRequired => 4,
            Self::I256Overflow => 5,
            Self::FinalI128Overflow => 6,
        }
    }

    /// Encodes this failure as one fixed-width canonical byte.
    #[must_use]
    pub const fn to_canonical_bytes(self) -> [u8; Self::CANONICAL_LEN] {
        [self.canonical_tag()]
    }

    /// Decodes one failure and rejects reserved, unknown, or trailing bytes.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, CanonicalDecodeError> {
        let tag = decode_one_byte(bytes)?;
        match tag {
            0 => Err(CanonicalDecodeError::ReservedTag),
            1 => Ok(Self::InvalidScale),
            2 => Ok(Self::ScaleMismatch),
            3 => Ok(Self::DivideByZero),
            4 => Ok(Self::RoundingRequired),
            5 => Ok(Self::I256Overflow),
            6 => Ok(Self::FinalI128Overflow),
            _ => Err(CanonicalDecodeError::UnknownTag),
        }
    }
}

/// Failures while decoding a fixed-width canonical numeric representation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CanonicalDecodeError {
    InvalidLength,
    InvalidScale,
    ReservedTag,
    UnknownTag,
}

/// A signed fixed decimal represented as `coefficient * 10^-scale`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct FixedI128 {
    coefficient: i128,
    scale: DecimalScale,
}

impl FixedI128 {
    /// Canonical byte length: signed little-endian coefficient followed by scale.
    pub const CANONICAL_LEN: usize = 17;

    /// Constructs a value after validating its scale.
    pub const fn new(coefficient: i128, scale: u8) -> Result<Self, NumericFailure> {
        match DecimalScale::new(scale) {
            Ok(scale) => Ok(Self { coefficient, scale }),
            Err(e) => Err(e),
        }
    }

    /// Constructs a value from an already validated scale.
    #[must_use]
    pub const fn from_parts(coefficient: i128, scale: DecimalScale) -> Self {
        Self { coefficient, scale }
    }

    /// Returns the signed coefficient.
    #[must_use]
    pub const fn coefficient(self) -> i128 {
        self.coefficient
    }

    /// Returns the validated decimal scale.
    #[must_use]
    pub const fn scale(self) -> DecimalScale {
        self.scale
    }

    /// Encodes the coefficient as signed two's-complement little-endian bytes,
    /// followed by the canonical scale byte.
    #[must_use]
    pub const fn to_canonical_bytes(self) -> [u8; Self::CANONICAL_LEN] {
        let coefficient = self.coefficient.to_le_bytes();
        let mut bytes = [0_u8; Self::CANONICAL_LEN];
        let mut index = 0;
        while index < coefficient.len() {
            bytes[index] = coefficient[index];
            index += 1;
        }
        bytes[16] = self.scale.get();
        bytes
    }

    /// Decodes exactly 17 bytes and rejects invalid scale or trailing bytes.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, CanonicalDecodeError> {
        if bytes.len() != Self::CANONICAL_LEN {
            return Err(CanonicalDecodeError::InvalidLength);
        }

        let mut coefficient = [0_u8; 16];
        coefficient.copy_from_slice(&bytes[..16]);
        let scale = DecimalScale::new(bytes[16]).map_err(|_| CanonicalDecodeError::InvalidScale)?;
        Ok(Self::from_parts(i128::from_le_bytes(coefficient), scale))
    }

    /// Adds equal-scale values through the I256 boundary.
    pub fn checked_add(self, rhs: Self) -> Result<Self, NumericFailure> {
        self.require_same_scale(rhs)?;
        let value = to_i256(self.coefficient)
            .checked_add(to_i256(rhs.coefficient))
            .ok_or(NumericFailure::I256Overflow)?;
        finish(value, I256::ONE, self.scale, None)
    }

    /// Subtracts equal-scale values through the I256 boundary.
    pub fn checked_sub(self, rhs: Self) -> Result<Self, NumericFailure> {
        self.require_same_scale(rhs)?;
        let value = to_i256(self.coefficient)
            .checked_sub(to_i256(rhs.coefficient))
            .ok_or(NumericFailure::I256Overflow)?;
        finish(value, I256::ONE, self.scale, None)
    }

    /// Multiplies two values and rounds once into `output_scale`.
    ///
    /// `rounding` may be absent only when the exact final remainder is zero.
    pub fn checked_mul(
        self,
        rhs: Self,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, NumericFailure> {
        let product = to_i256(self.coefficient)
            .checked_mul(to_i256(rhs.coefficient))
            .ok_or(NumericFailure::I256Overflow)?;
        let exponent = i16::from(output_scale.get())
            - i16::from(self.scale.get())
            - i16::from(rhs.scale.get());
        let (numerator, denominator) = apply_decimal_exponent(product, I256::ONE, exponent)?;
        finish(numerator, denominator, output_scale, rounding)
    }

    /// Divides by `rhs` and rounds once into `output_scale`.
    ///
    /// `rounding` may be absent only when the exact final remainder is zero.
    pub fn checked_div(
        self,
        rhs: Self,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, NumericFailure> {
        if rhs.coefficient == 0 {
            return Err(NumericFailure::DivideByZero);
        }

        let exponent = i16::from(rhs.scale.get()) + i16::from(output_scale.get())
            - i16::from(self.scale.get());
        let (numerator, denominator) = apply_decimal_exponent(
            to_i256(self.coefficient),
            to_i256(rhs.coefficient),
            exponent,
        )?;
        finish(numerator, denominator, output_scale, rounding)
    }

    /// Explicitly changes scale and rounds once when digits are discarded.
    pub fn rescale(
        self,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, NumericFailure> {
        let exponent = i16::from(output_scale.get()) - i16::from(self.scale.get());
        let (numerator, denominator) =
            apply_decimal_exponent(to_i256(self.coefficient), I256::ONE, exponent)?;
        finish(numerator, denominator, output_scale, rounding)
    }

    /// Compares equal-scale values without an implicit rescale.
    pub fn checked_cmp(self, rhs: Self) -> Result<Ordering, NumericFailure> {
        self.require_same_scale(rhs)?;
        Ok(self.coefficient.cmp(&rhs.coefficient))
    }

    /// Selects one equal-scale value without rescaling either branch.
    pub fn checked_select(
        condition: bool,
        when_true: Self,
        when_false: Self,
    ) -> Result<Self, NumericFailure> {
        when_true.require_same_scale(when_false)?;
        Ok(if condition { when_true } else { when_false })
    }

    fn require_same_scale(self, rhs: Self) -> Result<(), NumericFailure> {
        if self.scale == rhs.scale {
            Ok(())
        } else {
            Err(NumericFailure::ScaleMismatch)
        }
    }
}

fn decode_one_byte(bytes: &[u8]) -> Result<u8, CanonicalDecodeError> {
    if bytes.len() == 1 {
        Ok(bytes[0])
    } else {
        Err(CanonicalDecodeError::InvalidLength)
    }
}

fn to_i256(value: i128) -> I256 {
    I256::from_i128(value)
}

fn power_of_ten(exponent: u8) -> Result<I256, NumericFailure> {
    let ten = to_i256(10);
    let mut result = I256::ONE;
    let mut remaining = exponent;
    while remaining != 0 {
        result = result
            .checked_mul(ten)
            .ok_or(NumericFailure::I256Overflow)?;
        remaining -= 1;
    }
    Ok(result)
}

fn apply_decimal_exponent(
    numerator: I256,
    denominator: I256,
    exponent: i16,
) -> Result<(I256, I256), NumericFailure> {
    if exponent >= 0 {
        let factor = power_of_ten(exponent as u8)?;
        let numerator = numerator
            .checked_mul(factor)
            .ok_or(NumericFailure::I256Overflow)?;
        Ok((numerator, denominator))
    } else {
        let factor = power_of_ten((-exponent) as u8)?;
        let denominator = denominator
            .checked_mul(factor)
            .ok_or(NumericFailure::I256Overflow)?;
        Ok((numerator, denominator))
    }
}

fn finish(
    numerator: I256,
    denominator: I256,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, NumericFailure> {
    let coefficient = divide_and_round(numerator, denominator, rounding)?;
    let coefficient = coefficient
        .to_i128()
        .ok_or(NumericFailure::FinalI128Overflow)?;
    Ok(FixedI128::from_parts(coefficient, output_scale))
}

fn divide_and_round(
    numerator: I256,
    denominator: I256,
    rounding: Option<RoundingMode>,
) -> Result<I256, NumericFailure> {
    if denominator.is_zero() {
        return Err(NumericFailure::DivideByZero);
    }

    let (numerator_sign, numerator_abs) = numerator.into_sign_and_abs();
    let (denominator_sign, denominator_abs) = denominator.into_sign_and_abs();
    let (quotient_abs, remainder_abs) = numerator_abs.div_rem(denominator_abs);
    let result_sign = numerator_sign * denominator_sign;
    let quotient = I256::checked_from_sign_and_abs(result_sign, quotient_abs)
        .ok_or(NumericFailure::I256Overflow)?;

    if remainder_abs.is_zero() {
        return Ok(quotient);
    }

    match rounding {
        None => Err(NumericFailure::RoundingRequired),
        Some(RoundingMode::TowardZero) => Ok(quotient),
        Some(RoundingMode::NearestTiesToEven) => {
            let complement = denominator_abs
                .checked_sub(remainder_abs)
                .ok_or(NumericFailure::I256Overflow)?;
            let round_away =
                remainder_abs > complement || (remainder_abs == complement && quotient.is_odd());
            if !round_away {
                return Ok(quotient);
            }

            let unit = match result_sign {
                Sign::Positive => I256::ONE,
                Sign::Negative => I256::MINUS_ONE,
            };
            quotient
                .checked_add(unit)
                .ok_or(NumericFailure::I256Overflow)
        }
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn scale(value: u8) -> DecimalScale {
        match DecimalScale::new(value) {
            Ok(scale) => scale,
            Err(e) => panic!("test scale must be valid: {e:?}"),
        }
    }

    fn fixed(coefficient: i128, decimal_scale: u8) -> FixedI128 {
        match FixedI128::new(coefficient, decimal_scale) {
            Ok(value) => value,
            Err(e) => panic!("test fixed decimal must be valid: {e:?}"),
        }
    }

    #[rstest]
    fn scale_boundary_is_closed() {
        for candidate in 0..=MAX_DECIMAL_SCALE {
            let expected = DecimalScale(candidate);
            assert_eq!(DecimalScale::new(candidate), Ok(expected));
            assert_eq!(
                DecimalScale::from_canonical_bytes(&expected.to_canonical_bytes()),
                Ok(expected)
            );
        }
        assert_eq!(DecimalScale::new(39), Err(NumericFailure::InvalidScale));
        assert_eq!(
            FixedI128::new(0, u8::MAX),
            Err(NumericFailure::InvalidScale)
        );
        assert_eq!(
            DecimalScale::from_canonical_bytes(&[39]),
            Err(CanonicalDecodeError::InvalidScale)
        );
        assert_eq!(
            DecimalScale::from_canonical_bytes(&[0, 0]),
            Err(CanonicalDecodeError::InvalidLength)
        );
    }

    #[rstest]
    fn powers_of_ten_through_scale_38_rescale_exactly() {
        let mut coefficient = 1_i128;

        for decimal_scale in 0..=MAX_DECIMAL_SCALE {
            let value = fixed(1, 0)
                .rescale(scale(decimal_scale), None)
                .unwrap_or_else(|e| panic!("exact rescale failed: {e:?}"));
            assert_eq!(value, fixed(coefficient, decimal_scale));
            if decimal_scale < MAX_DECIMAL_SCALE {
                coefficient *= 10;
            }
        }
    }

    #[rstest]
    fn nearest_ties_to_even_covers_sign_and_quotient_parity() {
        let cases = [
            (5, 2, 2),
            (7, 2, 4),
            (-5, 2, -2),
            (-7, 2, -4),
            (5, -2, -2),
            (7, -2, -4),
            (-5, -2, 2),
            (-7, -2, 4),
        ];

        for (numerator, denominator, expected) in cases {
            let actual = fixed(numerator, 0)
                .checked_div(
                    fixed(denominator, 0),
                    scale(0),
                    Some(RoundingMode::NearestTiesToEven),
                )
                .unwrap_or_else(|e| panic!("half-even division failed: {e:?}"));
            assert_eq!(actual, fixed(expected, 0));
        }
    }

    #[rstest]
    fn toward_zero_and_missing_rounding_are_distinct() {
        assert_eq!(
            fixed(-19, 1).rescale(scale(0), Some(RoundingMode::TowardZero)),
            Ok(fixed(-1, 0))
        );
        assert_eq!(
            fixed(19, 1).rescale(scale(0), None),
            Err(NumericFailure::RoundingRequired)
        );
        assert_eq!(fixed(20, 1).rescale(scale(0), None), Ok(fixed(2, 0)));
    }

    #[rstest]
    fn multiplication_and_division_cross_scales() {
        assert_eq!(
            fixed(125, 2).checked_mul(
                fixed(24, 1),
                scale(3),
                Some(RoundingMode::NearestTiesToEven),
            ),
            Ok(fixed(3000, 3))
        );
        assert_eq!(
            fixed(125, 2).checked_div(
                fixed(25, 1),
                scale(4),
                Some(RoundingMode::NearestTiesToEven),
            ),
            Ok(fixed(5000, 4))
        );
        assert_eq!(
            fixed(1, 3).checked_div(fixed(2, 0), scale(0), Some(RoundingMode::TowardZero)),
            Ok(fixed(0, 0))
        );
    }

    #[rstest]
    fn wide_intermediate_can_round_back_into_i128() {
        let wide = fixed(100_000_000_000_000_000_000_000_000_000_000_000_000, 38);
        assert_eq!(
            wide.checked_mul(wide, scale(38), Some(RoundingMode::NearestTiesToEven)),
            Ok(wide)
        );
    }

    #[rstest]
    fn all_numeric_terminals_fail_closed() {
        assert_eq!(
            fixed(1, 0).checked_add(fixed(1, 1)),
            Err(NumericFailure::ScaleMismatch)
        );
        assert_eq!(
            fixed(1, 0).checked_div(fixed(0, 0), scale(0), None),
            Err(NumericFailure::DivideByZero)
        );
        assert_eq!(
            fixed(i128::MAX, 0).checked_div(
                fixed(1, 38),
                scale(38),
                Some(RoundingMode::TowardZero),
            ),
            Err(NumericFailure::I256Overflow)
        );
        assert_eq!(
            fixed(i128::MAX, 0).checked_mul(fixed(2, 0), scale(0), Some(RoundingMode::TowardZero),),
            Err(NumericFailure::FinalI128Overflow)
        );
        assert_eq!(
            fixed(i128::MIN, 0)
                .checked_div(fixed(-1, 0), scale(0), Some(RoundingMode::TowardZero),),
            Err(NumericFailure::FinalI128Overflow)
        );
    }

    #[rstest]
    fn zero_compare_and_select_are_exact_and_scale_checked() {
        let negative_zero = fixed(0, 38);
        assert_eq!(
            negative_zero.checked_mul(fixed(i128::MIN, 0), scale(38), None),
            Ok(negative_zero)
        );
        assert_eq!(fixed(-1, 2).checked_cmp(fixed(1, 2)), Ok(Ordering::Less));
        assert_eq!(
            FixedI128::checked_select(true, fixed(1, 2), fixed(2, 2)),
            Ok(fixed(1, 2))
        );
        assert_eq!(
            FixedI128::checked_select(false, fixed(1, 2), fixed(2, 3)),
            Err(NumericFailure::ScaleMismatch)
        );
    }

    #[rstest]
    fn small_domain_add_sub_mul_match_i128_reference() {
        for left in -32_i128..=32 {
            for right in -32_i128..=32 {
                let lhs = fixed(left, 2);
                let rhs = fixed(right, 2);
                assert_eq!(lhs.checked_add(rhs), Ok(fixed(left + right, 2)));
                assert_eq!(lhs.checked_sub(rhs), Ok(fixed(left - right, 2)));
                assert_eq!(
                    lhs.checked_mul(rhs, scale(4), None),
                    Ok(fixed(left * right, 4))
                );
            }
        }
    }

    #[rstest]
    fn small_cross_scale_division_matches_integer_reference() {
        for numerator in -24_i128..=24 {
            for denominator in -9_i128..=9 {
                if denominator == 0 {
                    continue;
                }

                for lhs_scale in 0_u8..=3 {
                    for rhs_scale in 0_u8..=3 {
                        for output_scale in 0_u8..=3 {
                            let exponent = i16::from(rhs_scale) + i16::from(output_scale)
                                - i16::from(lhs_scale);
                            let (wide_numerator, wide_denominator) = if exponent >= 0 {
                                (numerator * 10_i128.pow(exponent as u32), denominator)
                            } else {
                                (numerator, denominator * 10_i128.pow((-exponent) as u32))
                            };

                            for rounding in
                                [RoundingMode::TowardZero, RoundingMode::NearestTiesToEven]
                            {
                                let expected =
                                    reference_round(wide_numerator, wide_denominator, rounding);
                                let actual = fixed(numerator, lhs_scale).checked_div(
                                    fixed(denominator, rhs_scale),
                                    scale(output_scale),
                                    Some(rounding),
                                );
                                assert_eq!(actual, Ok(fixed(expected, output_scale)));
                            }
                        }
                    }
                }
            }
        }
    }

    #[rstest]
    fn canonical_fixed_decimal_bytes_are_stable_and_strict() {
        let cases = [
            fixed(0, 0),
            fixed(1, 38),
            fixed(-1, 1),
            fixed(i128::MIN, 38),
            fixed(i128::MAX, 0),
        ];

        for value in cases {
            let bytes = value.to_canonical_bytes();
            assert_eq!(FixedI128::from_canonical_bytes(&bytes), Ok(value));
            assert_eq!(bytes[16], value.scale().get());
        }

        assert_eq!(fixed(-1, 1).to_canonical_bytes()[..16], [u8::MAX; 16]);
        let mut invalid_scale = fixed(1, 0).to_canonical_bytes();
        invalid_scale[16] = 39;
        assert_eq!(
            FixedI128::from_canonical_bytes(&invalid_scale),
            Err(CanonicalDecodeError::InvalidScale)
        );
        let mut trailing = [0_u8; FixedI128::CANONICAL_LEN + 1];
        trailing[..FixedI128::CANONICAL_LEN].copy_from_slice(&fixed(1, 0).to_canonical_bytes());
        assert_eq!(
            FixedI128::from_canonical_bytes(&trailing),
            Err(CanonicalDecodeError::InvalidLength)
        );
    }

    #[rstest]
    fn canonical_tags_reject_reserved_unknown_and_trailing_values() {
        for mode in [RoundingMode::TowardZero, RoundingMode::NearestTiesToEven] {
            assert_eq!(
                RoundingMode::from_canonical_bytes(&mode.to_canonical_bytes()),
                Ok(mode)
            );
        }
        assert_eq!(
            RoundingMode::optional_from_canonical_bytes(
                &RoundingMode::optional_to_canonical_bytes(None)
            ),
            Ok(None)
        );
        assert_eq!(
            RoundingMode::optional_from_canonical_bytes(
                &RoundingMode::optional_to_canonical_bytes(Some(RoundingMode::NearestTiesToEven))
            ),
            Ok(Some(RoundingMode::NearestTiesToEven))
        );

        for failure in [
            NumericFailure::InvalidScale,
            NumericFailure::ScaleMismatch,
            NumericFailure::DivideByZero,
            NumericFailure::RoundingRequired,
            NumericFailure::I256Overflow,
            NumericFailure::FinalI128Overflow,
        ] {
            assert_eq!(
                NumericFailure::from_canonical_bytes(&failure.to_canonical_bytes()),
                Ok(failure)
            );
        }

        assert_eq!(
            RoundingMode::from_canonical_bytes(&[0]),
            Err(CanonicalDecodeError::ReservedTag)
        );
        assert_eq!(
            NumericFailure::from_canonical_bytes(&[u8::MAX]),
            Err(CanonicalDecodeError::UnknownTag)
        );
        assert_eq!(
            RoundingMode::from_canonical_bytes(&[1, 0]),
            Err(CanonicalDecodeError::InvalidLength)
        );
    }

    fn reference_round(numerator: i128, denominator: i128, rounding: RoundingMode) -> i128 {
        let quotient = numerator / denominator;
        let remainder = numerator % denominator;
        if remainder == 0 || rounding == RoundingMode::TowardZero {
            return quotient;
        }

        let remainder_abs = remainder.abs();
        let denominator_abs = denominator.abs();
        let complement = denominator_abs - remainder_abs;
        let round_away = remainder_abs > complement
            || (remainder_abs == complement && quotient.rem_euclid(2) != 0);
        if !round_away {
            quotient
        } else if numerator.is_negative() == denominator.is_negative() {
            quotient + 1
        } else {
            quotient - 1
        }
    }
}
