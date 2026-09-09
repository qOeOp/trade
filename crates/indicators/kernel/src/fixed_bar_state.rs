//! Clocked true range, Wilder ATR, and previous-close gap state.

use core::num::NonZeroU32;

use crate::{
    DecimalScale, FixedI128, FixedOhlc, FixedStateFailure, NumericFailure, RoundingMode,
    SampleClockInputV1,
};

/// A WARMING observation advances state without exposing a numeric value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixedIndicatorUpdate {
    pub advanced: bool,
    pub value: Option<FixedI128>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    TrueRange,
    Atr {
        period: NonZeroU32,
        rounding: Option<RoundingMode>,
    },
    Gap,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Observation {
    coordinate: [u8; 308],
    bar: FixedOhlc,
}

/// One declared bar-clock primitive. Guest structural checks do not authenticate Owner inputs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedBarState {
    kind: Kind,
    scale: DecimalScale,
    observation: Option<Observation>,
    value: Option<i128>,
}

impl FixedBarState {
    pub const CANONICAL_LEN: usize = 400;

    #[must_use]
    pub const fn new_true_range(scale: DecimalScale) -> Self {
        Self::new(Kind::TrueRange, scale)
    }

    #[must_use]
    pub const fn new_atr(
        period: NonZeroU32,
        scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Self {
        Self::new(Kind::Atr { period, rounding }, scale)
    }

    #[must_use]
    pub const fn new_gap(scale: DecimalScale) -> Self {
        Self::new(Kind::Gap, scale)
    }

    const fn new(kind: Kind, scale: DecimalScale) -> Self {
        Self {
            kind,
            scale,
            observation: None,
            value: None,
        }
    }

    #[must_use]
    pub fn output(&self) -> Option<FixedI128> {
        self.value
            .map(|value| FixedI128::from_parts(value, self.scale))
    }

    pub fn advance(
        &mut self,
        bar: FixedOhlc,
        coordinate: SampleClockInputV1<'_>,
    ) -> Result<FixedIndicatorUpdate, FixedStateFailure> {
        if bar.close().scale() != self.scale {
            return Err(NumericFailure::ScaleMismatch.into());
        }

        if let Some(previous) = self.observation.as_ref()
            && !coordinate.advances_after(SampleClockInputV1::from_untrusted_bytes(
                &previous.coordinate,
            )?)?
        {
            if bar != previous.bar {
                return Err(FixedStateFailure::ConflictingSample);
            }

            return Ok(FixedIndicatorUpdate {
                advanced: false,
                value: self.output(),
            });
        }

        let previous_close = self
            .observation
            .as_ref()
            .map(|previous| previous.bar.close());
        let value = match self.kind {
            Kind::TrueRange => Some(bar.true_range(previous_close)?),
            Kind::Atr { period, rounding } => {
                let range = bar.true_range(previous_close)?;
                Some(match self.output() {
                    Some(previous) => previous.checked_wilder_next(range, period, rounding)?,
                    None => range,
                })
            }
            Kind::Gap => match previous_close {
                Some(previous) => Some(bar.gap(previous)?),
                None => None,
            },
        };

        self.observation = Some(Observation {
            coordinate: *coordinate.as_untrusted_bytes(),
            bar,
        });
        self.value = value.map(FixedI128::coefficient);
        Ok(FixedIndicatorUpdate {
            advanced: true,
            value,
        })
    }

    fn header(&self) -> [u8; 12] {
        let mut bytes = [0; 12];
        bytes[..2].copy_from_slice(&1_u16.to_le_bytes());
        bytes[6] = self.scale.get();

        match self.kind {
            Kind::TrueRange => bytes[4] = 1,
            Kind::Atr { period, rounding } => {
                bytes[4] = 2;
                bytes[5] = RoundingMode::optional_to_canonical_bytes(rounding)[0];
                bytes[8..12].copy_from_slice(&period.get().to_le_bytes());
            }
            Kind::Gap => bytes[4] = 3,
        }

        bytes
    }

    #[must_use]
    pub fn to_canonical_bytes(&self) -> [u8; Self::CANONICAL_LEN] {
        let mut bytes = [0; Self::CANONICAL_LEN];
        bytes[..12].copy_from_slice(&self.header());

        if let Some(observation) = self.observation.as_ref() {
            bytes[7] = if self.value.is_some() { 2 } else { 1 };
            bytes[12..320].copy_from_slice(&observation.coordinate);
            let bar = observation.bar;

            for (value, output) in [bar.open(), bar.high(), bar.low(), bar.close()]
                .iter()
                .zip(bytes[320..384].chunks_exact_mut(16))
            {
                output.copy_from_slice(&value.coefficient().to_le_bytes());
            }

            if let Some(value) = self.value {
                bytes[384..400].copy_from_slice(&value.to_le_bytes());
            }
        }

        bytes
    }

    /// Restores under the declared policy. Host checkpoint authentication remains required.
    pub fn restore_canonical_bytes(&mut self, bytes: &[u8]) -> Result<(), FixedStateFailure> {
        let bytes: &[u8; Self::CANONICAL_LEN] = bytes
            .try_into()
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let header = self.header();

        if bytes[..7] != header[..7] || bytes[8..12] != header[8..12] {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        if bytes[7] == 0 {
            if bytes[12..].iter().any(|byte| *byte != 0) {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            self.observation = None;
            self.value = None;
            return Ok(());
        }

        if bytes[7] > 2 || (bytes[7] == 1 && self.kind != Kind::Gap) {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let coordinate = SampleClockInputV1::from_untrusted_bytes(&bytes[12..320])
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let mut values = [FixedI128::from_parts(0, self.scale); 4];

        for (value, encoded) in values.iter_mut().zip(bytes[320..384].chunks_exact(16)) {
            *value = FixedI128::from_parts(
                i128::from_le_bytes(
                    encoded
                        .try_into()
                        .map_err(|_| FixedStateFailure::NonCanonicalState)?,
                ),
                self.scale,
            );
        }

        let bar = FixedOhlc::new(values[0], values[1], values[2], values[3])
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let coefficient = i128::from_le_bytes(
            bytes[384..400]
                .try_into()
                .map_err(|_| FixedStateFailure::NonCanonicalState)?,
        );
        let value = if bytes[7] == 1 {
            if coefficient != 0 {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            None
        } else {
            if self.kind != Kind::Gap {
                let range = bar
                    .range()
                    .map_err(|_| FixedStateFailure::NonCanonicalState)?;

                if coefficient < 0
                    || (self.kind == Kind::TrueRange && coefficient < range.coefficient())
                {
                    return Err(FixedStateFailure::NonCanonicalState);
                }
            }

            Some(coefficient)
        };

        self.observation = Some(Observation {
            coordinate: *coordinate.as_untrusted_bytes(),
            bar,
        });
        self.value = value;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn scale() -> DecimalScale {
        DecimalScale::new(0).unwrap()
    }

    fn fixed(value: i128) -> FixedI128 {
        FixedI128::from_parts(value, scale())
    }

    fn bar(open: i128, high: i128, low: i128, close: i128) -> FixedOhlc {
        FixedOhlc::new(fixed(open), fixed(high), fixed(low), fixed(close)).unwrap()
    }

    // Structurally valid guest inputs only; these fixtures do not mint Owner evidence.
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

    fn states() -> [FixedBarState; 3] {
        [
            FixedBarState::new_true_range(scale()),
            FixedBarState::new_atr(
                NonZeroU32::new(3).unwrap(),
                scale(),
                Some(RoundingMode::NearestTiesToEven),
            ),
            FixedBarState::new_gap(scale()),
        ]
    }

    fn corpus() -> [FixedOhlc; 4] {
        [
            bar(10, 12, 8, 11),
            bar(12, 15, 11, 14),
            bar(20, 22, 18, 21),
            bar(5, 8, 4, 6),
        ]
    }

    #[rstest]
    fn true_range_wilder_atr_and_gap_follow_their_first_sample_contracts() {
        let expected = [
            [Some(4), Some(4), Some(8), Some(17)],
            [Some(4), Some(4), Some(5), Some(9)],
            [None, Some(1), Some(6), Some(-16)],
        ];

        for (kind, mut state) in states().into_iter().enumerate() {
            assert_eq!(state.output(), None);

            for (index, bar) in corpus().into_iter().enumerate() {
                let result = state.advance(bar, view(&coordinate(index as u64))).unwrap();
                assert!(result.advanced);
                assert_eq!(result.value, expected[kind][index].map(fixed));
                assert_eq!(state.output(), result.value);
            }
        }
    }

    #[rstest]
    fn duplicate_ohlc_reuses_output_but_changed_payload_conflicts() {
        for mut state in states() {
            let first = coordinate(255);
            let next = coordinate(256);
            let sample = bar(10, 12, 8, 11);
            let initial = state.advance(sample, view(&first)).unwrap();
            let before = state.to_canonical_bytes();
            let repeated = state.advance(sample, view(&first)).unwrap();
            assert!(!repeated.advanced);
            assert_eq!(repeated.value, initial.value);
            assert_eq!(state.to_canonical_bytes(), before);

            for conflicting in [
                bar(9, 12, 8, 11),
                bar(10, 13, 8, 11),
                bar(10, 12, 7, 11),
                bar(10, 12, 8, 10),
            ] {
                assert_eq!(
                    state.advance(conflicting, view(&first)),
                    Err(FixedStateFailure::ConflictingSample)
                );
                assert_eq!(state.to_canonical_bytes(), before);
            }

            assert!(state.advance(sample, view(&next)).unwrap().advanced);
            assert_ne!(state.to_canonical_bytes(), before);
        }
    }

    #[rstest]
    fn numerical_and_coordinate_failures_do_not_consume_previous_close() {
        for mut state in states() {
            state
                .advance(bar(0, 2, 0, 1), view(&coordinate(1)))
                .unwrap();
            let before = state.to_canonical_bytes();
            assert_eq!(
                state.advance(
                    bar(i128::MIN, i128::MIN, i128::MIN, i128::MIN),
                    view(&coordinate(2))
                ),
                Err(FixedStateFailure::Numeric(
                    NumericFailure::FinalI128Overflow
                ))
            );
            assert_eq!(state.to_canonical_bytes(), before);
            let mut incompatible = coordinate(2);
            incompatible[204] ^= 1;
            assert_eq!(
                state.advance(bar(0, 2, 0, 1), view(&incompatible)),
                Err(FixedStateFailure::IncompatibleSample)
            );
            assert_eq!(state.to_canonical_bytes(), before);
            assert!(state.advance(bar(0, 2, 0, 1), view(&coordinate(3))).is_ok());
        }

        let mut atr = FixedBarState::new_atr(NonZeroU32::new(2).unwrap(), scale(), None);
        atr.advance(bar(0, 2, 0, 1), view(&coordinate(1))).unwrap();
        let before = atr.to_canonical_bytes();
        assert_eq!(
            atr.advance(bar(0, 3, 0, 2), view(&coordinate(2))),
            Err(FixedStateFailure::Numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(atr.to_canonical_bytes(), before);
        assert_eq!(
            atr.advance(bar(1, 5, 1, 4), view(&coordinate(3)))
                .unwrap()
                .value,
            Some(fixed(3))
        );
    }

    #[rstest]
    fn every_restored_frontier_reproduces_the_same_remaining_state() {
        let samples = corpus();

        for initial in states() {
            for frontier in 0..=samples.len() {
                let mut uninterrupted = initial.clone();

                for (index, sample) in samples[..frontier].iter().enumerate() {
                    uninterrupted
                        .advance(*sample, view(&coordinate(index as u64)))
                        .unwrap();
                }

                let encoded = uninterrupted.to_canonical_bytes();
                let mut restored = initial.clone();
                restored.restore_canonical_bytes(&encoded).unwrap();
                assert_eq!(restored.to_canonical_bytes(), encoded);

                for (index, sample) in samples.iter().enumerate().skip(frontier) {
                    assert_eq!(
                        restored.advance(*sample, view(&coordinate(index as u64))),
                        uninterrupted.advance(*sample, view(&coordinate(index as u64)))
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
    fn restore_rejects_configuration_hidden_payload_and_impossible_bar_state() {
        for mut state in states() {
            let empty = state.to_canonical_bytes();

            for offset in [0, 2, 4, 5, 6, 8, 12, 320, 384] {
                let mut malformed = empty;
                malformed[offset] ^= 1;
                assert!(state.restore_canonical_bytes(&malformed).is_err());
                assert_eq!(state.to_canonical_bytes(), empty);
            }

            state.advance(corpus()[0], view(&coordinate(1))).unwrap();
            let before = state.to_canonical_bytes();
            let mut invalid_bar = before;
            invalid_bar[336..352].copy_from_slice(&0_i128.to_le_bytes());
            assert!(state.restore_canonical_bytes(&invalid_bar).is_err());
            assert_eq!(state.to_canonical_bytes(), before);
            let mut invalid_coordinate = before;
            invalid_coordinate[12] = 2;
            assert!(state.restore_canonical_bytes(&invalid_coordinate).is_err());
            assert_eq!(state.to_canonical_bytes(), before);
            assert!(state.restore_canonical_bytes(&before[..399]).is_err());
            assert_eq!(state.to_canonical_bytes(), before);

            let mut invalid_output = before;
            invalid_output[384..400].copy_from_slice(&(-1_i128).to_le_bytes());
            assert!(state.restore_canonical_bytes(&invalid_output).is_err());
            assert_eq!(state.to_canonical_bytes(), before);
            let mut invalid_status = before;
            invalid_status[7] = 3;
            assert!(state.restore_canonical_bytes(&invalid_status).is_err());
            assert_eq!(state.to_canonical_bytes(), before);
        }
    }
}
