//! Bounded, clocked trailing windows. Owner authentication remains outside the guest kernel.

use core::num::NonZeroU32;

use crate::{
    DecimalScale, FixedFeatureFailure, FixedI128, FixedStateFailure, NumericFailure, RoundingMode,
    SampleClockInputV1, fixed_window_mean, fixed_window_sum,
};

const HEADER_LEN: usize = 20;
const ENTRY_LEN: usize = 324;
const LAG: u8 = 7;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedWindowFunction {
    Sum,
    Mean,
    Minimum,
    Maximum,
    SwingHigh,
    SwingLow,
}

impl FixedWindowFunction {
    const fn tag(self) -> u8 {
        match self {
            Self::Sum => 1,
            Self::Mean => 2,
            Self::Minimum => 3,
            Self::Maximum => 4,
            Self::SwingHigh => 5,
            Self::SwingLow => 6,
        }
    }
}

/// WARMING has no readable value; lag and swing results retain the exact selected coordinate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedWindowOutput {
    value: Option<FixedI128>,
    coordinate: Option<[u8; 308]>,
}

impl FixedWindowOutput {
    #[must_use]
    pub const fn value(&self) -> Option<FixedI128> {
        self.value
    }

    /// Original guest input bytes, not a newly issued Owner proof.
    #[must_use]
    pub const fn sample_coordinate_bytes(&self) -> Option<&[u8; 308]> {
        self.coordinate.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedWindowUpdate {
    pub advanced: bool,
    pub output: FixedWindowOutput,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StoredSample {
    coordinate: [u8; 308],
    coefficient: i128,
}

impl StoredSample {
    const EMPTY: Self = Self {
        coordinate: [0; 308],
        coefficient: 0,
    };
}

/// The compiled capacity bounds storage; only the declared window participates in state bytes.
///
/// A primitive update commits only after its output succeeds. The BFP owner still needs a scratch
/// bundle to make a whole event across multiple primitives failure-atomic.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedWindowState<const CAPACITY: usize> {
    kind: u8,
    window: NonZeroU32,
    input_scale: DecimalScale,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
    count: u32,
    next: u32,
    samples: [StoredSample; CAPACITY],
}

impl<const CAPACITY: usize> FixedWindowState<CAPACITY> {
    pub fn new(
        function: FixedWindowFunction,
        window: NonZeroU32,
        input_scale: DecimalScale,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, FixedStateFailure> {
        if !matches!(
            function,
            FixedWindowFunction::Sum | FixedWindowFunction::Mean
        ) && (input_scale != output_scale || rounding.is_some())
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        Self::with_kind(function.tag(), window, input_scale, output_scale, rounding)
    }

    pub fn new_lag(
        offset: NonZeroU32,
        declared_max_lag: NonZeroU32,
        scale: DecimalScale,
    ) -> Result<Self, FixedStateFailure> {
        if offset > declared_max_lag {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let window = offset
            .get()
            .checked_add(1)
            .and_then(NonZeroU32::new)
            .ok_or(FixedStateFailure::NonCanonicalState)?;
        Self::with_kind(LAG, window, scale, scale, None)
    }

    fn with_kind(
        kind: u8,
        window: NonZeroU32,
        input_scale: DecimalScale,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, FixedStateFailure> {
        let length =
            usize::try_from(window.get()).map_err(|_| FixedStateFailure::NonCanonicalState)?;

        if length > CAPACITY
            || length
                .checked_mul(ENTRY_LEN)
                .and_then(|n| n.checked_add(HEADER_LEN))
                .is_none()
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        Ok(Self {
            kind,
            window,
            input_scale,
            output_scale,
            rounding,
            count: 0,
            next: 0,
            samples: [StoredSample::EMPTY; CAPACITY],
        })
    }

    #[must_use]
    pub fn canonical_len(&self) -> usize {
        HEADER_LEN + self.window.get() as usize * ENTRY_LEN
    }

    pub(super) const fn sample_count(&self) -> u32 {
        self.count
    }

    pub(super) fn sample_at_age(&self, age: u32) -> Option<(FixedI128, &[u8; 308])> {
        if age >= self.count {
            return None;
        }

        let latest = if self.next == 0 {
            self.window.get() - 1
        } else {
            self.next - 1
        };
        let index = if age <= latest {
            latest - age
        } else {
            self.window.get() - (age - latest)
        };
        let sample = &self.samples[index as usize];
        Some((
            FixedI128::from_parts(sample.coefficient, self.input_scale),
            &sample.coordinate,
        ))
    }

    pub fn advance(
        &mut self,
        sample: FixedI128,
        coordinate: SampleClockInputV1<'_>,
    ) -> Result<FixedWindowUpdate, FixedStateFailure> {
        if sample.scale() != self.input_scale {
            return Err(NumericFailure::ScaleMismatch.into());
        }

        if self.count > 0 {
            let latest = if self.next == 0 {
                self.window.get() - 1
            } else {
                self.next - 1
            };
            let previous = &self.samples[latest as usize];

            if !coordinate.advances_after(SampleClockInputV1::from_untrusted_bytes(
                &previous.coordinate,
            )?)? {
                if sample.coefficient() != previous.coefficient {
                    return Err(FixedStateFailure::ConflictingSample);
                }

                return Ok(FixedWindowUpdate {
                    advanced: false,
                    output: self.output()?,
                });
            }
        }

        let mut next = self.clone();
        next.samples[next.next as usize] = StoredSample {
            coordinate: *coordinate.as_untrusted_bytes(),
            coefficient: sample.coefficient(),
        };
        next.next = if next.next + 1 == next.window.get() {
            0
        } else {
            next.next + 1
        };

        if next.count < next.window.get() {
            next.count += 1;
        }

        let output = next.output()?;
        *self = next;
        Ok(FixedWindowUpdate {
            advanced: true,
            output,
        })
    }

    pub fn output(&self) -> Result<FixedWindowOutput, FixedStateFailure> {
        if self.count < self.window.get() {
            return Ok(FixedWindowOutput {
                value: None,
                coordinate: None,
            });
        }

        if self.kind == 1 || self.kind == 2 {
            let mut values = [FixedI128::from_parts(0, self.input_scale); CAPACITY];

            for (value, sample) in values
                .iter_mut()
                .zip(self.samples.iter())
                .take(self.window.get() as usize)
            {
                *value = FixedI128::from_parts(sample.coefficient, self.input_scale);
            }

            let values = &values[..self.window.get() as usize];
            let value = if self.kind == 1 {
                fixed_window_sum(values, self.window, self.output_scale, self.rounding)
            } else {
                fixed_window_mean(values, self.window, self.output_scale, self.rounding)
            }
            .map_err(|e| match e {
                FixedFeatureFailure::Numeric(failure) => FixedStateFailure::Numeric(failure),
                _ => FixedStateFailure::NonCanonicalState,
            })?;
            return Ok(FixedWindowOutput {
                value: Some(value),
                coordinate: None,
            });
        }

        let mut winner = self.samples[self.next as usize];

        if self.kind != LAG {
            let mut index = self.next;

            for _ in 1..self.window.get() {
                index = if index + 1 == self.window.get() {
                    0
                } else {
                    index + 1
                };
                let sample = self.samples[index as usize];
                let replace = if self.kind == 3 || self.kind == 6 {
                    sample.coefficient <= winner.coefficient
                } else {
                    sample.coefficient >= winner.coefficient
                };

                if replace {
                    winner = sample;
                }
            }
        }

        Ok(FixedWindowOutput {
            value: Some(FixedI128::from_parts(winner.coefficient, self.input_scale)),
            coordinate: if self.kind >= 5 {
                Some(winner.coordinate)
            } else {
                None
            },
        })
    }

    /// Encodes into an exactly sized buffer, independent of the unused compiled capacity.
    pub fn encode_canonical(&self, bytes: &mut [u8]) -> Result<(), FixedStateFailure> {
        if bytes.len() != self.canonical_len() {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        bytes.fill(0);
        bytes[..2].copy_from_slice(&1_u16.to_le_bytes());
        bytes[4] = self.kind;
        bytes[5] = RoundingMode::optional_to_canonical_bytes(self.rounding)[0];
        bytes[6] = self.input_scale.get();
        bytes[7] = self.output_scale.get();
        bytes[8..12].copy_from_slice(&self.window.get().to_le_bytes());
        bytes[12..16].copy_from_slice(&self.count.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.next.to_le_bytes());

        for (sample, entry) in self
            .samples
            .iter()
            .zip(bytes[HEADER_LEN..].chunks_exact_mut(ENTRY_LEN))
        {
            entry[..308].copy_from_slice(&sample.coordinate);
            entry[308..].copy_from_slice(&sample.coefficient.to_le_bytes());
        }

        Ok(())
    }

    /// Restores under the current declared configuration, then verifies the entire ring history.
    pub fn restore_canonical(&mut self, bytes: &[u8]) -> Result<(), FixedStateFailure> {
        if bytes.len() != self.canonical_len()
            || bytes[..4] != [1, 0, 0, 0]
            || bytes[4] != self.kind
            || bytes[5] != RoundingMode::optional_to_canonical_bytes(self.rounding)[0]
            || bytes[6] != self.input_scale.get()
            || bytes[7] != self.output_scale.get()
            || bytes[8..12] != self.window.get().to_le_bytes()
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let mut restored = self.clone();
        restored.count = u32::from_le_bytes(
            bytes[12..16]
                .try_into()
                .map_err(|_| FixedStateFailure::NonCanonicalState)?,
        );
        restored.next = u32::from_le_bytes(
            bytes[16..20]
                .try_into()
                .map_err(|_| FixedStateFailure::NonCanonicalState)?,
        );

        if restored.count > restored.window.get()
            || restored.next >= restored.window.get()
            || (restored.count < restored.window.get() && restored.next != restored.count)
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        for (index, entry) in bytes[HEADER_LEN..].chunks_exact(ENTRY_LEN).enumerate() {
            if restored.count < restored.window.get() && index >= restored.count as usize {
                if entry.iter().any(|byte| *byte != 0) {
                    return Err(FixedStateFailure::NonCanonicalState);
                }

                restored.samples[index] = StoredSample::EMPTY;
                continue;
            }

            let coordinate = SampleClockInputV1::from_untrusted_bytes(&entry[..308])
                .map_err(|_| FixedStateFailure::NonCanonicalState)?;
            restored.samples[index] = StoredSample {
                coordinate: *coordinate.as_untrusted_bytes(),
                coefficient: i128::from_le_bytes(
                    entry[308..]
                        .try_into()
                        .map_err(|_| FixedStateFailure::NonCanonicalState)?,
                ),
            };
        }

        if restored.count > 1 {
            let mut index = if restored.count == restored.window.get() {
                restored.next
            } else {
                0
            };

            for _ in 1..restored.count {
                let previous = SampleClockInputV1::from_untrusted_bytes(
                    &restored.samples[index as usize].coordinate,
                )?;
                index = if index + 1 == restored.window.get() {
                    0
                } else {
                    index + 1
                };
                let current = SampleClockInputV1::from_untrusted_bytes(
                    &restored.samples[index as usize].coordinate,
                )?;

                if current.advances_after(previous) != Ok(true) {
                    return Err(FixedStateFailure::NonCanonicalState);
                }
            }
        }

        restored
            .output()
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        *self = restored;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use self::std::{vec, vec::Vec};

    use rstest::rstest;

    use super::*;

    fn scale() -> DecimalScale {
        DecimalScale::new(0).unwrap()
    }

    fn fixed(value: i128) -> FixedI128 {
        FixedI128::from_parts(value, scale())
    }

    // These structurally valid guest inputs do not claim Owner custody.
    fn coordinate(sequence: u64) -> [u8; 308] {
        let mut bytes = [7; 308];
        bytes[..4].copy_from_slice(&[1, 0, 0, 0]);
        bytes[68..76].copy_from_slice(&sequence.to_be_bytes());
        bytes[84..92].copy_from_slice(&sequence.to_be_bytes());

        for offset in [116, 124, 132] {
            bytes[offset..offset + 8].copy_from_slice(&sequence.to_le_bytes());
        }

        bytes[236..244].copy_from_slice(&1_u64.to_le_bytes());
        bytes
    }

    fn view(bytes: &[u8]) -> SampleClockInputV1<'_> {
        SampleClockInputV1::from_untrusted_bytes(bytes).unwrap()
    }

    fn bytes<const N: usize>(state: &FixedWindowState<N>) -> Vec<u8> {
        let mut bytes = vec![0; state.canonical_len()];
        state.encode_canonical(&mut bytes).unwrap();
        bytes
    }

    fn window(function: FixedWindowFunction) -> FixedWindowState<4> {
        let rounding = if function == FixedWindowFunction::Mean {
            Some(RoundingMode::NearestTiesToEven)
        } else {
            None
        };
        FixedWindowState::new(
            function,
            NonZeroU32::new(3).unwrap(),
            scale(),
            scale(),
            rounding,
        )
        .unwrap()
    }

    #[rstest]
    fn complete_window_boundaries_and_wraparound_match_trailing_slices() {
        let samples = [2, -4, 8, 8, 2, -4, -4, 8];

        for function in [
            FixedWindowFunction::Sum,
            FixedWindowFunction::Mean,
            FixedWindowFunction::Minimum,
            FixedWindowFunction::Maximum,
            FixedWindowFunction::SwingHigh,
            FixedWindowFunction::SwingLow,
        ] {
            let mut state = window(function);

            for (index, value) in samples.iter().enumerate() {
                let update = state
                    .advance(fixed(*value), view(&coordinate(index as u64)))
                    .unwrap();
                assert!(update.advanced);

                if index < 2 {
                    assert_eq!(update.output.value(), None);
                    assert_eq!(update.output.sample_coordinate_bytes(), None);
                    continue;
                }

                let slice = &samples[index - 2..=index];
                let sum: i128 = slice.iter().sum();
                let expected = match function {
                    FixedWindowFunction::Sum => sum,
                    FixedWindowFunction::Mean => {
                        let truncated = sum / 3;
                        if (sum % 3).abs() == 2 {
                            truncated + sum.signum()
                        } else {
                            truncated
                        }
                    }
                    FixedWindowFunction::Minimum | FixedWindowFunction::SwingLow => {
                        *slice.iter().min().unwrap()
                    }
                    FixedWindowFunction::Maximum | FixedWindowFunction::SwingHigh => {
                        *slice.iter().max().unwrap()
                    }
                };
                assert_eq!(update.output.value(), Some(fixed(expected)));

                if matches!(
                    function,
                    FixedWindowFunction::SwingHigh | FixedWindowFunction::SwingLow
                ) {
                    let latest_match = slice.iter().rposition(|value| *value == expected).unwrap();
                    assert_eq!(
                        update.output.sample_coordinate_bytes(),
                        Some(&coordinate((index - 2 + latest_match) as u64))
                    );
                } else {
                    assert_eq!(update.output.sample_coordinate_bytes(), None);
                }
            }
        }
    }

    #[rstest]
    fn lag_offset_two_returns_the_exact_old_sample_and_coordinate() {
        let mut state = FixedWindowState::<4>::new_lag(
            NonZeroU32::new(2).unwrap(),
            NonZeroU32::new(3).unwrap(),
            scale(),
        )
        .unwrap();

        for index in 0_u64..7 {
            let update = state
                .advance(fixed(i128::from(index) * 10), view(&coordinate(index)))
                .unwrap();

            if index < 2 {
                assert_eq!(update.output.value(), None);
            } else {
                assert_eq!(
                    update.output.value(),
                    Some(fixed(i128::from(index - 2) * 10))
                );
                assert_eq!(
                    update.output.sample_coordinate_bytes(),
                    Some(&coordinate(index - 2))
                );
            }
        }

        assert!(
            FixedWindowState::<4>::new_lag(
                NonZeroU32::new(3).unwrap(),
                NonZeroU32::new(2).unwrap(),
                scale()
            )
            .is_err()
        );
        assert!(
            FixedWindowState::<4>::new_lag(
                NonZeroU32::new(4).unwrap(),
                NonZeroU32::new(4).unwrap(),
                scale()
            )
            .is_err()
        );
        assert!(
            FixedWindowState::<4>::new_lag(
                NonZeroU32::new(u32::MAX).unwrap(),
                NonZeroU32::new(u32::MAX).unwrap(),
                scale()
            )
            .is_err()
        );
    }

    #[rstest]
    fn repeats_do_not_warm_up_but_equal_value_successors_do() {
        let mut state = window(FixedWindowFunction::SwingHigh);
        let first = coordinate(255);
        let second = coordinate(256);
        state.advance(fixed(7), view(&first)).unwrap();
        let before = bytes(&state);
        let repeated = state.advance(fixed(7), view(&first)).unwrap();
        assert!(!repeated.advanced);
        assert_eq!(repeated.output.value(), None);
        assert_eq!(bytes(&state), before);
        assert_eq!(
            state.advance(fixed(8), view(&first)),
            Err(FixedStateFailure::ConflictingSample)
        );
        assert_eq!(bytes(&state), before);
        assert_eq!(
            state
                .advance(fixed(7), view(&second))
                .unwrap()
                .output
                .value(),
            None
        );
        let ready = state.advance(fixed(7), view(&coordinate(257))).unwrap();
        assert_eq!(ready.output.value(), Some(fixed(7)));
        assert_eq!(
            ready.output.sample_coordinate_bytes(),
            Some(&coordinate(257))
        );
        let before = bytes(&state);
        let repeated = state.advance(fixed(7), view(&coordinate(257))).unwrap();
        assert!(!repeated.advanced);
        assert_eq!(repeated.output, ready.output);
        assert_eq!(bytes(&state), before);
    }

    #[rstest]
    fn overflow_rejection_preserves_warmup_and_full_ring_state() {
        let mut state = FixedWindowState::<2>::new(
            FixedWindowFunction::Sum,
            NonZeroU32::new(2).unwrap(),
            scale(),
            scale(),
            None,
        )
        .unwrap();
        state
            .advance(fixed(i128::MAX), view(&coordinate(1)))
            .unwrap();
        let warming = bytes(&state);
        assert_eq!(
            state.advance(fixed(1), view(&coordinate(2))),
            Err(FixedStateFailure::Numeric(
                NumericFailure::FinalI128Overflow
            ))
        );
        assert_eq!(bytes(&state), warming);
        assert_eq!(
            state
                .advance(fixed(-i128::MAX), view(&coordinate(3)))
                .unwrap()
                .output
                .value(),
            Some(fixed(0))
        );
        let full = bytes(&state);
        assert_eq!(
            state.advance(fixed(i128::MIN), view(&coordinate(4))),
            Err(FixedStateFailure::Numeric(
                NumericFailure::FinalI128Overflow
            ))
        );
        assert_eq!(bytes(&state), full);
        assert_eq!(
            state
                .advance(fixed(0), view(&coordinate(5)))
                .unwrap()
                .output
                .value(),
            Some(fixed(-i128::MAX))
        );
    }

    #[rstest]
    fn restore_at_each_frontier_keeps_future_outputs_and_state_identical() {
        for initial in [
            window(FixedWindowFunction::Mean),
            window(FixedWindowFunction::SwingLow),
            FixedWindowState::<4>::new_lag(
                NonZeroU32::new(2).unwrap(),
                NonZeroU32::new(3).unwrap(),
                scale(),
            )
            .unwrap(),
        ] {
            let samples = [1, 3, 3, 9, -4, 1, 0];

            for frontier in 0..=samples.len() {
                let mut continuous = initial.clone();

                for (index, sample) in samples[..frontier].iter().enumerate() {
                    continuous
                        .advance(fixed(*sample), view(&coordinate(index as u64)))
                        .unwrap();
                }

                let encoded = bytes(&continuous);
                let mut restored = initial.clone();
                restored.restore_canonical(&encoded).unwrap();
                assert_eq!(bytes(&restored), encoded);

                for (index, sample) in samples.iter().enumerate().skip(frontier) {
                    assert_eq!(
                        restored.advance(fixed(*sample), view(&coordinate(index as u64))),
                        continuous.advance(fixed(*sample), view(&coordinate(index as u64)))
                    );
                    assert_eq!(bytes(&restored), bytes(&continuous));
                }
            }
        }
    }

    #[rstest]
    fn restore_rejects_policy_count_cursor_hidden_slots_and_history_splices() {
        let mut state = window(FixedWindowFunction::SwingHigh);
        state.advance(fixed(7), view(&coordinate(1))).unwrap();
        let before = bytes(&state);

        for (offset, value) in [
            (0, 2),
            (2, 1),
            (4, 6),
            (5, 1),
            (6, 1),
            (7, 1),
            (8, 4),
            (12, 4),
            (16, 0),
            (16, 3),
            (HEADER_LEN + ENTRY_LEN, 1),
        ] {
            let mut malformed = before.clone();
            malformed[offset] = value;
            assert!(state.restore_canonical(&malformed).is_err());
            assert_eq!(bytes(&state), before);
        }

        assert!(
            state
                .restore_canonical(&before[..before.len() - 1])
                .is_err()
        );
        assert_eq!(bytes(&state), before);
        state.advance(fixed(9), view(&coordinate(2))).unwrap();
        state.advance(fixed(9), view(&coordinate(3))).unwrap();
        let full = bytes(&state);
        let mut duplicate = full.clone();
        duplicate[HEADER_LEN + ENTRY_LEN..HEADER_LEN + 2 * ENTRY_LEN]
            .copy_from_slice(&full[HEADER_LEN..HEADER_LEN + ENTRY_LEN]);
        assert!(state.restore_canonical(&duplicate).is_err());
        assert_eq!(bytes(&state), full);
        let mut cross_lineage = full.clone();
        cross_lineage[HEADER_LEN + ENTRY_LEN + 204] ^= 1;
        assert!(state.restore_canonical(&cross_lineage).is_err());
        assert_eq!(bytes(&state), full);
    }

    #[rstest]
    fn encoding_is_capacity_independent_and_invalid_buffers_are_unchanged() {
        let mut smaller = window(FixedWindowFunction::Sum);
        let mut larger = FixedWindowState::<8>::new(
            FixedWindowFunction::Sum,
            NonZeroU32::new(3).unwrap(),
            scale(),
            scale(),
            None,
        )
        .unwrap();

        for index in 0_u64..4 {
            smaller
                .advance(fixed(i128::from(index)), view(&coordinate(index)))
                .unwrap();
            larger
                .advance(fixed(i128::from(index)), view(&coordinate(index)))
                .unwrap();
        }

        assert_eq!(bytes(&smaller), bytes(&larger));
        let mut invalid = [5; 20];
        assert!(smaller.encode_canonical(&mut invalid).is_err());
        assert_eq!(invalid, [5; 20]);
        assert!(
            FixedWindowState::<0>::new(
                FixedWindowFunction::Sum,
                NonZeroU32::MIN,
                scale(),
                scale(),
                None
            )
            .is_err()
        );
        assert!(
            FixedWindowState::<4>::new(
                FixedWindowFunction::SwingHigh,
                NonZeroU32::MIN,
                scale(),
                DecimalScale::new(1).unwrap(),
                None
            )
            .is_err()
        );
    }
}
