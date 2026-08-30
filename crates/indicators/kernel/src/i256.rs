use core::cmp::Ordering;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Sign {
    Positive,
    Negative,
}

impl core::ops::Mul for Sign {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self::Output {
        if self == rhs {
            Self::Positive
        } else {
            Self::Negative
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct I256(U256);

impl I256 {
    pub(crate) const ZERO: Self = Self(U256::ZERO);
    pub(crate) const ONE: Self = Self(U256::ONE);
    pub(crate) const MINUS_ONE: Self = Self(U256([u64::MAX; 4]));

    pub(crate) const fn from_i128(value: i128) -> Self {
        let raw = value as u128;
        let extension = if value.is_negative() { u64::MAX } else { 0 };
        Self(U256([raw as u64, (raw >> 64) as u64, extension, extension]))
    }

    pub(crate) fn checked_add(self, rhs: Self) -> Option<Self> {
        let (raw, _) = self.0.overflowing_add(rhs.0);
        let result = Self(raw);
        let overflow = self.sign() == rhs.sign() && self.sign() != result.sign();

        if overflow { None } else { Some(result) }
    }

    pub(crate) fn checked_sub(self, rhs: Self) -> Option<Self> {
        let (raw, _) = self.0.overflowing_sub(rhs.0);
        let result = Self(raw);
        let overflow = self.sign() != rhs.sign() && self.sign() != result.sign();

        if overflow { None } else { Some(result) }
    }

    pub(crate) fn checked_mul(self, rhs: Self) -> Option<Self> {
        if self.is_zero() || rhs.is_zero() {
            return Some(Self::ZERO);
        }

        let sign = self.sign() * rhs.sign();
        let magnitude = self.unsigned_abs().checked_mul(rhs.unsigned_abs())?;
        Self::checked_from_sign_and_abs(sign, magnitude)
    }

    pub(crate) const fn is_zero(self) -> bool {
        self.0.const_eq(U256::ZERO)
    }

    pub(crate) const fn is_odd(self) -> bool {
        self.0.0[0] & 1 == 1
    }

    pub(crate) const fn sign(self) -> Sign {
        if self.0.0[3] >> 63 == 0 {
            Sign::Positive
        } else {
            Sign::Negative
        }
    }

    pub(crate) fn into_sign_and_abs(self) -> (Sign, U256) {
        let sign = self.sign();
        (sign, self.unsigned_abs())
    }

    pub(crate) fn checked_from_sign_and_abs(sign: Sign, magnitude: U256) -> Option<Self> {
        if magnitude.is_zero() {
            return Some(Self::ZERO);
        }

        match sign {
            Sign::Positive => {
                if magnitude.0[3] >> 63 == 0 {
                    Some(Self(magnitude))
                } else {
                    None
                }
            }
            Sign::Negative => {
                let minimum_magnitude = U256([0, 0, 0, 1_u64 << 63]);

                if magnitude <= minimum_magnitude {
                    Some(Self(magnitude.twos_complement()))
                } else {
                    None
                }
            }
        }
    }

    pub(crate) const fn to_i128(self) -> Option<i128> {
        let limbs = self.0.0;
        let low = (limbs[0] as u128) | ((limbs[1] as u128) << 64);
        let positive_fits = limbs[3] == 0 && limbs[2] == 0 && limbs[1] >> 63 == 0;
        let negative_fits = limbs[3] == u64::MAX && limbs[2] == u64::MAX && limbs[1] >> 63 == 1;

        if positive_fits || negative_fits {
            Some(low as i128)
        } else {
            None
        }
    }

    fn unsigned_abs(self) -> U256 {
        match self.sign() {
            Sign::Positive => self.0,
            Sign::Negative => self.0.twos_complement(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct U256([u64; 4]);

impl U256 {
    const ZERO: Self = Self([0; 4]);
    const ONE: Self = Self([1, 0, 0, 0]);

    const fn const_eq(self, rhs: Self) -> bool {
        self.0[0] == rhs.0[0]
            && self.0[1] == rhs.0[1]
            && self.0[2] == rhs.0[2]
            && self.0[3] == rhs.0[3]
    }

    pub(crate) const fn is_zero(self) -> bool {
        self.const_eq(Self::ZERO)
    }

    pub(crate) fn checked_sub(self, rhs: Self) -> Option<Self> {
        let (result, borrow) = self.overflowing_sub(rhs);

        if borrow { None } else { Some(result) }
    }

    pub(crate) fn div_rem(self, divisor: Self) -> (Self, Self) {
        debug_assert!(!divisor.is_zero());
        let mut quotient = Self::ZERO;
        let mut remainder = Self::ZERO;

        for bit in (0..256).rev() {
            remainder = remainder.shl_one();
            if self.bit(bit) {
                remainder.0[0] |= 1;
            }

            if remainder >= divisor {
                let (next, borrowed) = remainder.overflowing_sub(divisor);
                debug_assert!(!borrowed);
                remainder = next;
                quotient.set_bit(bit);
            }
        }

        (quotient, remainder)
    }

    fn overflowing_add(self, rhs: Self) -> (Self, bool) {
        let mut result = [0_u64; 4];
        let mut carry = false;

        for (index, output) in result.iter_mut().enumerate() {
            let sum = u128::from(self.0[index]) + u128::from(rhs.0[index]) + u128::from(carry);
            *output = sum as u64;
            carry = sum >> 64 != 0;
        }

        (Self(result), carry)
    }

    fn overflowing_sub(self, rhs: Self) -> (Self, bool) {
        let mut result = [0_u64; 4];
        let mut borrow = false;

        for (index, output) in result.iter_mut().enumerate() {
            let subtrahend = u128::from(rhs.0[index]) + u128::from(borrow);
            let minuend = u128::from(self.0[index]);
            *output = minuend.wrapping_sub(subtrahend) as u64;
            borrow = minuend < subtrahend;
        }

        (Self(result), borrow)
    }

    fn checked_mul(self, rhs: Self) -> Option<Self> {
        let mut product = [0_u64; 8];

        for left in 0..4 {
            let mut carry = 0_u128;

            for right in 0..4 {
                let index = left + right;
                let term = u128::from(self.0[left]) * u128::from(rhs.0[right])
                    + u128::from(product[index])
                    + carry;
                product[index] = term as u64;
                carry = term >> 64;
            }
            product[left + 4] = carry as u64;
        }

        if product[4..].iter().any(|limb| *limb != 0) {
            None
        } else {
            Some(Self([product[0], product[1], product[2], product[3]]))
        }
    }

    fn twos_complement(self) -> Self {
        let inverted = Self(self.0.map(|limb| !limb));
        inverted.overflowing_add(Self::ONE).0
    }

    fn shl_one(self) -> Self {
        let mut result = [0_u64; 4];
        let mut carry = 0_u64;

        for (input, output) in self.0.into_iter().zip(result.iter_mut()) {
            *output = (input << 1) | carry;
            carry = input >> 63;
        }

        debug_assert_eq!(carry, 0);
        Self(result)
    }

    const fn bit(self, index: usize) -> bool {
        self.0[index / 64] & (1_u64 << (index % 64)) != 0
    }

    fn set_bit(&mut self, index: usize) {
        self.0[index / 64] |= 1_u64 << (index % 64);
    }
}

impl Ord for U256 {
    fn cmp(&self, rhs: &Self) -> Ordering {
        for index in (0..4).rev() {
            match self.0[index].cmp(&rhs.0[index]) {
                Ordering::Equal => {}
                ordering => return ordering,
            }
        }

        Ordering::Equal
    }
}

impl PartialOrd for U256 {
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Some(self.cmp(rhs))
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn signed_boundaries_convert_without_layout_assumptions() {
        for value in [i128::MIN, -1, 0, 1, i128::MAX] {
            assert_eq!(I256::from_i128(value).to_i128(), Some(value));
        }
        assert_eq!(
            I256::from_i128(i128::MAX)
                .checked_add(I256::ONE)
                .and_then(I256::to_i128),
            None
        );
    }

    #[rstest]
    fn unsigned_division_reconstructs_boundary_values() {
        let values = [U256::ONE, U256([u64::MAX, 0, 0, 0]), U256([u64::MAX; 4])];
        let divisors = [
            U256::ONE,
            U256([2, 0, 0, 0]),
            U256([u64::MAX, u64::MAX, 0, 0]),
        ];

        for value in values {
            for divisor in divisors {
                let (quotient, remainder) = value.div_rem(divisor);
                let rebuilt = quotient.checked_mul(divisor).and_then(|product| {
                    product.overflowing_add(remainder).0.checked_sub(U256::ZERO)
                });
                assert_eq!(rebuilt, Some(value));
                assert!(remainder < divisor);
            }
        }
    }
}
