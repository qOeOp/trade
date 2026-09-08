//! Guest-side fixed primitive state. Structural input validation confers no Market Data custody.

use core::num::NonZeroU32;

use crate::{DecimalScale, FixedI128, NumericFailure, RoundingMode};

const COORDINATE_LEN: usize = 308;

/// Structural/state failures; these are not a new wire-status or Owner-receipt codec.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedStateFailure {
    NonCanonicalCoordinate,
    IncompatibleSample,
    ConflictingSample,
    RegressedSample,
    NonCanonicalState,
    Numeric(NumericFailure),
}

impl From<NumericFailure> for FixedStateFailure {
    fn from(value: NumericFailure) -> Self {
        Self::Numeric(value)
    }
}

/// Borrowed structural view of the existing 308-byte sample-coordinate input.
///
/// This view cannot authenticate, construct or repair an Owner coordinate. The Host must verify
/// its Owner receipt and Plan binding before copying the exact bytes into the guest input port.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SampleClockInputV1<'a> {
    bytes: &'a [u8; COORDINATE_LEN],
}

impl<'a> SampleClockInputV1<'a> {
    pub fn from_untrusted_bytes(bytes: &'a [u8]) -> Result<Self, FixedStateFailure> {
        let bytes: &[u8; COORDINATE_LEN] = bytes
            .try_into()
            .map_err(|_| FixedStateFailure::NonCanonicalCoordinate)?;

        if bytes[..4] != [1, 0, 0, 0] {
            return Err(FixedStateFailure::NonCanonicalCoordinate);
        }

        // These are the same fixed identity fields required by the Owner's coordinate decoder.
        for (start, end) in [
            (4, 36),
            (36, 68),
            (68, 84),
            (84, 116),
            (140, 172),
            (172, 204),
            (204, 236),
            (244, 276),
            (276, 308),
        ] {
            if bytes[start..end].iter().all(|byte| *byte == 0) {
                return Err(FixedStateFailure::NonCanonicalCoordinate);
            }
        }

        Ok(Self { bytes })
    }

    /// Returns only the originally supplied bytes, without encoding or attesting them.
    #[must_use]
    pub const fn as_untrusted_bytes(self) -> &'a [u8; COORDINATE_LEN] {
        self.bytes
    }

    pub(super) fn advances_after(self, previous: Self) -> Result<bool, FixedStateFailure> {
        if self.bytes == previous.bytes {
            return Ok(false);
        }

        for (start, end) in [(4, 68), (140, 172), (204, 236), (244, 276)] {
            if self.bytes[start..end] != previous.bytes[start..end] {
                return Err(FixedStateFailure::IncompatibleSample);
            }
        }

        if self.bytes[84..116] == previous.bytes[84..116] {
            return Err(FixedStateFailure::ConflictingSample);
        }

        if coordinate_u64(self.bytes, 236) < coordinate_u64(previous.bytes, 236)
            || self.order_key() <= previous.order_key()
        {
            return Err(FixedStateFailure::RegressedSample);
        }

        Ok(true)
    }

    fn order_key(self) -> (u64, u64, u64, &'a [u8], &'a [u8]) {
        (
            coordinate_u64(self.bytes, 116),
            coordinate_u64(self.bytes, 124),
            coordinate_u64(self.bytes, 132),
            &self.bytes[68..84],
            &self.bytes[84..116],
        )
    }
}

fn coordinate_u64(bytes: &[u8; COORDINATE_LEN], start: usize) -> u64 {
    u64::from_le_bytes([
        bytes[start],
        bytes[start + 1],
        bytes[start + 2],
        bytes[start + 3],
        bytes[start + 4],
        bytes[start + 5],
        bytes[start + 6],
        bytes[start + 7],
    ])
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedSmoothingKind {
    Ema,
    Wilder,
}

/// A repeated coordinate returns the stored output without another numerical update.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedSampleUpdate {
    Reused(FixedI128),
    Advanced(FixedI128),
}

/// Bounded EMA/Wilder state for one declared update clock.
///
/// The BFP state owner must evaluate its whole event in scratch storage before committing it;
/// atomicity of this primitive alone is not atomicity of the complete plugin or Host checkpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedSmoothingState {
    kind: FixedSmoothingKind,
    period: NonZeroU32,
    scale: DecimalScale,
    rounding: Option<RoundingMode>,
    coordinate: Option<[u8; COORDINATE_LEN]>,
    input: i128,
    value: i128,
}

impl FixedSmoothingState {
    pub const CANONICAL_LEN: usize = 352;

    #[must_use]
    pub const fn new(
        kind: FixedSmoothingKind,
        period: NonZeroU32,
        scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Self {
        Self {
            kind,
            period,
            scale,
            rounding,
            coordinate: None,
            input: 0,
            value: 0,
        }
    }

    /// No numeric value is readable before the first sample; that first sample is READY.
    #[must_use]
    pub fn output(&self) -> Option<FixedI128> {
        self.coordinate
            .as_ref()
            .map(|_| FixedI128::from_parts(self.value, self.scale))
    }

    pub fn advance(
        &mut self,
        sample: FixedI128,
        coordinate: SampleClockInputV1<'_>,
    ) -> Result<FixedSampleUpdate, FixedStateFailure> {
        if sample.scale() != self.scale {
            return Err(NumericFailure::ScaleMismatch.into());
        }

        let value = if let Some(previous_bytes) = self.coordinate.as_ref() {
            let previous = SampleClockInputV1::from_untrusted_bytes(previous_bytes)?;

            if !coordinate.advances_after(previous)? {
                if sample.coefficient() != self.input {
                    return Err(FixedStateFailure::ConflictingSample);
                }

                return Ok(FixedSampleUpdate::Reused(FixedI128::from_parts(
                    self.value, self.scale,
                )));
            }

            let old = FixedI128::from_parts(self.value, self.scale);

            match self.kind {
                FixedSmoothingKind::Ema => {
                    old.checked_ema_next(sample, self.period, self.rounding)?
                }
                FixedSmoothingKind::Wilder => {
                    old.checked_wilder_next(sample, self.period, self.rounding)?
                }
            }
        } else {
            sample
        };

        self.coordinate = Some(*coordinate.bytes);
        self.input = sample.coefficient();
        self.value = value.coefficient();
        Ok(FixedSampleUpdate::Advanced(value))
    }

    /// Fixed-width state payload: header/config, original coordinate, input, then output.
    #[must_use]
    pub fn to_canonical_bytes(&self) -> [u8; Self::CANONICAL_LEN] {
        let mut bytes = [0; Self::CANONICAL_LEN];
        bytes[..2].copy_from_slice(&1_u16.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.period.get().to_le_bytes());
        bytes[8] = match self.kind {
            FixedSmoothingKind::Ema => 1,
            FixedSmoothingKind::Wilder => 2,
        };
        bytes[9] = RoundingMode::optional_to_canonical_bytes(self.rounding)[0];
        bytes[10] = self.scale.get();

        if let Some(coordinate) = self.coordinate.as_ref() {
            bytes[11] = 1;
            bytes[12..320].copy_from_slice(coordinate);
            bytes[320..336].copy_from_slice(&self.input.to_le_bytes());
            bytes[336..352].copy_from_slice(&self.value.to_le_bytes());
        }

        bytes
    }

    /// Restores state only under the current declared configuration.
    ///
    /// Checkpoint authenticity remains with the Host. Invalid bytes or a changed configuration
    /// leave the current state untouched; serialized input cannot replace the declared policy.
    pub fn restore_canonical_bytes(&mut self, bytes: &[u8]) -> Result<(), FixedStateFailure> {
        let restored = Self::from_canonical_bytes(bytes)?;

        if (
            restored.kind,
            restored.period,
            restored.scale,
            restored.rounding,
        ) != (self.kind, self.period, self.scale, self.rounding)
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        *self = restored;
        Ok(())
    }

    fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, FixedStateFailure> {
        let bytes: &[u8; Self::CANONICAL_LEN] = bytes
            .try_into()
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;

        if bytes[..4] != [1, 0, 0, 0] {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let period = NonZeroU32::new(u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]))
            .ok_or(FixedStateFailure::NonCanonicalState)?;
        let kind = match bytes[8] {
            1 => FixedSmoothingKind::Ema,
            2 => FixedSmoothingKind::Wilder,
            _ => return Err(FixedStateFailure::NonCanonicalState),
        };
        let rounding = RoundingMode::optional_from_canonical_bytes(&bytes[9..10])
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let scale =
            DecimalScale::new(bytes[10]).map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let mut state = Self::new(kind, period, scale, rounding);

        match bytes[11] {
            0 => {
                if bytes[12..].iter().any(|byte| *byte != 0) {
                    return Err(FixedStateFailure::NonCanonicalState);
                }
            }
            1 => {
                let coordinate = SampleClockInputV1::from_untrusted_bytes(&bytes[12..320])
                    .map_err(|_| FixedStateFailure::NonCanonicalState)?;
                state.coordinate = Some(*coordinate.bytes);
                state.input = i128::from_le_bytes(
                    bytes[320..336]
                        .try_into()
                        .map_err(|_| FixedStateFailure::NonCanonicalState)?,
                );
                state.value = i128::from_le_bytes(
                    bytes[336..352]
                        .try_into()
                        .map_err(|_| FixedStateFailure::NonCanonicalState)?,
                );
            }
            _ => return Err(FixedStateFailure::NonCanonicalState),
        }

        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    // Structural test inputs only. No fabricated fixture is an Owner receipt or Host proof.
    fn coordinate(sequence: u64) -> [u8; COORDINATE_LEN] {
        let mut bytes = [7; COORDINATE_LEN];
        bytes[..4].copy_from_slice(&[1, 0, 0, 0]);
        bytes[68..76].copy_from_slice(&sequence.to_be_bytes());
        bytes[84..92].copy_from_slice(&sequence.to_be_bytes());

        for offset in [116, 124, 132] {
            bytes[offset..offset + 8].copy_from_slice(&sequence.to_le_bytes());
        }

        bytes[236..244].copy_from_slice(&1_u64.to_le_bytes());
        bytes
    }

    fn input(bytes: &[u8]) -> SampleClockInputV1<'_> {
        SampleClockInputV1::from_untrusted_bytes(bytes).unwrap()
    }

    fn fixed(value: i128) -> FixedI128 {
        FixedI128::new(value, 0).unwrap()
    }

    fn state(kind: FixedSmoothingKind, rounding: Option<RoundingMode>) -> FixedSmoothingState {
        let period = match kind {
            FixedSmoothingKind::Ema => 3,
            FixedSmoothingKind::Wilder => 2,
        };
        FixedSmoothingState::new(
            kind,
            NonZeroU32::new(period).unwrap(),
            DecimalScale::new(0).unwrap(),
            rounding,
        )
    }

    #[rstest]
    fn repeated_samples_reuse_and_equal_valued_successors_advance() {
        for kind in [FixedSmoothingKind::Ema, FixedSmoothingKind::Wilder] {
            let mut state = state(kind, Some(RoundingMode::NearestTiesToEven));
            assert_eq!(state.output(), None);
            let first = coordinate(255);
            let second = coordinate(256);
            let third = coordinate(257);
            // Byte sorting of these little-endian timestamps would invert their order.
            assert!(first[116..124] > second[116..124]);
            assert_eq!(
                state.advance(fixed(0), input(&first)),
                Ok(FixedSampleUpdate::Advanced(fixed(0)))
            );
            assert_eq!(
                state.advance(fixed(2), input(&second)),
                Ok(FixedSampleUpdate::Advanced(fixed(1)))
            );
            let before = state.to_canonical_bytes();
            assert_eq!(
                state.advance(fixed(2), input(&second)),
                Ok(FixedSampleUpdate::Reused(fixed(1)))
            );
            assert_eq!(state.to_canonical_bytes(), before);
            assert_eq!(
                state.advance(fixed(2), input(&third)),
                Ok(FixedSampleUpdate::Advanced(fixed(2)))
            );
            assert_ne!(state.to_canonical_bytes(), before);
        }
    }

    #[rstest]
    fn restore_at_every_frontier_reproduces_the_suffix_bytes() {
        for kind in [FixedSmoothingKind::Ema, FixedSmoothingKind::Wilder] {
            let initial = state(kind, Some(RoundingMode::TowardZero));
            let samples = [0, 2, -4, -4, 10, i128::MAX, i128::MIN];

            for frontier in 0..=samples.len() {
                let mut uninterrupted = initial.clone();

                for (index, sample) in samples[..frontier].iter().enumerate() {
                    uninterrupted
                        .advance(fixed(*sample), input(&coordinate(index as u64)))
                        .unwrap();
                }

                let bytes = uninterrupted.to_canonical_bytes();
                let mut restored = initial.clone();
                restored.restore_canonical_bytes(&bytes).unwrap();
                assert_eq!(restored.to_canonical_bytes(), bytes);

                for (index, sample) in samples.iter().enumerate().skip(frontier) {
                    let coordinate = coordinate(index as u64);
                    assert_eq!(
                        restored.advance(fixed(*sample), input(&coordinate)),
                        uninterrupted.advance(fixed(*sample), input(&coordinate))
                    );
                    assert_eq!(
                        restored.to_canonical_bytes(),
                        uninterrupted.to_canonical_bytes()
                    );
                }
            }
        }
    }

    #[rstest]
    fn all_failed_updates_preserve_the_entire_state() {
        let mut state = state(FixedSmoothingKind::Ema, None);
        let first = coordinate(255);
        let next = coordinate(256);
        state.advance(fixed(0), input(&first)).unwrap();
        let before = state.to_canonical_bytes();
        assert_eq!(
            state.advance(fixed(1), input(&next)),
            Err(FixedStateFailure::Numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(state.to_canonical_bytes(), before);
        assert_eq!(
            state.advance(FixedI128::new(2, 1).unwrap(), input(&next)),
            Err(FixedStateFailure::Numeric(NumericFailure::ScaleMismatch))
        );
        assert_eq!(state.to_canonical_bytes(), before);
        assert_eq!(
            state.advance(fixed(1), input(&first)),
            Err(FixedStateFailure::ConflictingSample)
        );
        assert_eq!(state.to_canonical_bytes(), before);

        for offset in [4, 36, 140, 204, 244] {
            let mut conflicting = next;
            conflicting[offset] ^= 1;
            assert_eq!(
                state.advance(fixed(2), input(&conflicting)),
                Err(FixedStateFailure::IncompatibleSample)
            );
            assert_eq!(state.to_canonical_bytes(), before);
        }

        for offset in [68, 116, 124, 132, 172, 236, 276] {
            let mut conflicting = first;
            conflicting[offset] ^= 1;
            assert_eq!(
                state.advance(fixed(2), input(&conflicting)),
                Err(FixedStateFailure::ConflictingSample)
            );
            assert_eq!(state.to_canonical_bytes(), before);
        }

        let mut regressed = next;
        regressed[236..244].copy_from_slice(&0_u64.to_le_bytes());
        assert_eq!(
            state.advance(fixed(2), input(&regressed)),
            Err(FixedStateFailure::RegressedSample)
        );
        assert_eq!(state.to_canonical_bytes(), before);
        assert_eq!(
            state.advance(fixed(2), input(&coordinate(254))),
            Err(FixedStateFailure::RegressedSample)
        );
        assert_eq!(state.to_canonical_bytes(), before);
        // Numeric failure did not consume the new coordinate or partially update the average.
        assert_eq!(
            state.advance(fixed(2), input(&next)),
            Ok(FixedSampleUpdate::Advanced(fixed(1)))
        );
    }

    #[rstest]
    fn every_order_component_and_lineage_version_follow_the_contract() {
        let previous = coordinate(255);

        for offset in [116, 124, 132] {
            let mut next = previous;
            next[84] += 1;
            next[offset..offset + 8].copy_from_slice(&256_u64.to_le_bytes());
            assert_eq!(input(&next).advances_after(input(&previous)), Ok(true));
            next[offset..offset + 8].copy_from_slice(&254_u64.to_le_bytes());
            assert_eq!(
                input(&next).advances_after(input(&previous)),
                Err(FixedStateFailure::RegressedSample)
            );
        }

        let mut next = previous;
        next[68] += 1;
        next[84] += 1;
        assert_eq!(input(&next).advances_after(input(&previous)), Ok(true));
        next = previous;
        next[84] += 1;
        assert_eq!(input(&next).advances_after(input(&previous)), Ok(true));
        next[236..244].copy_from_slice(&2_u64.to_le_bytes());
        assert_eq!(input(&next).advances_after(input(&previous)), Ok(true));
    }

    #[rstest]
    fn coordinate_view_rejects_noncanonical_fields_without_reencoding() {
        let bytes = coordinate(256);
        assert_eq!(input(&bytes).as_untrusted_bytes(), &bytes);
        assert!(SampleClockInputV1::from_untrusted_bytes(&bytes[..307]).is_err());
        assert!(SampleClockInputV1::from_untrusted_bytes(&[0; 309]).is_err());

        for offset in 0..4 {
            let mut malformed = bytes;
            malformed[offset] ^= 1;
            assert!(SampleClockInputV1::from_untrusted_bytes(&malformed).is_err());
        }

        for (start, end) in [
            (4, 36),
            (36, 68),
            (68, 84),
            (84, 116),
            (140, 172),
            (172, 204),
            (204, 236),
            (244, 276),
            (276, 308),
        ] {
            let mut malformed = bytes;
            malformed[start..end].fill(0);
            assert!(SampleClockInputV1::from_untrusted_bytes(&malformed).is_err());
        }
    }

    #[rstest]
    fn state_codec_rejects_hidden_empty_payload_and_unknown_configuration() {
        let state = state(
            FixedSmoothingKind::Ema,
            Some(RoundingMode::NearestTiesToEven),
        );
        let bytes = state.to_canonical_bytes();
        assert_eq!(&bytes[..12], &[1, 0, 0, 0, 3, 0, 0, 0, 1, 2, 0, 0]);
        assert!(bytes[12..].iter().all(|byte| *byte == 0));
        assert!(FixedSmoothingState::from_canonical_bytes(&bytes[..351]).is_err());
        assert!(FixedSmoothingState::from_canonical_bytes(&[0; 353]).is_err());

        for (offset, value) in [
            (0, 2),
            (2, 1),
            (4, 0),
            (8, 0),
            (8, 3),
            (9, 3),
            (10, 39),
            (11, 2),
            (12, 1),
            (320, 1),
            (351, 1),
        ] {
            let mut malformed = bytes;
            malformed[offset] = value;
            assert!(FixedSmoothingState::from_canonical_bytes(&malformed).is_err());
        }

        let mut ready = state;
        ready.advance(fixed(-1), input(&coordinate(0))).unwrap();
        let bytes = ready.to_canonical_bytes();
        assert_eq!(bytes[11], 1);
        assert_eq!(&bytes[320..352], &[255; 32]);
        assert_eq!(
            FixedSmoothingState::from_canonical_bytes(&bytes).unwrap(),
            ready
        );
        let mut malformed = bytes;
        malformed[12] = 2;
        assert!(FixedSmoothingState::from_canonical_bytes(&malformed).is_err());
    }

    #[rstest]
    fn restore_cannot_replace_declared_configuration_or_partially_apply_bytes() {
        let mut state = state(
            FixedSmoothingKind::Ema,
            Some(RoundingMode::NearestTiesToEven),
        );
        state.advance(fixed(2), input(&coordinate(255))).unwrap();
        let before = state.to_canonical_bytes();

        for (offset, value) in [(4, 4), (8, 2), (9, 1), (10, 1), (2, 1), (12, 2)] {
            let mut changed = before;
            changed[offset] = value;
            assert_eq!(
                state.restore_canonical_bytes(&changed),
                Err(FixedStateFailure::NonCanonicalState)
            );
            assert_eq!(state.to_canonical_bytes(), before);
        }

        assert_eq!(
            state.restore_canonical_bytes(&before[..351]),
            Err(FixedStateFailure::NonCanonicalState)
        );
        assert_eq!(state.to_canonical_bytes(), before);
    }
}
