//! Failure-atomic RSI state with wide deltas and a bounded close-history warm-up.

use core::num::NonZeroU32;

use crate::{
    DecimalScale, FixedFeatureFailure, FixedI128, FixedIndicatorUpdate, FixedStateFailure,
    FixedWindowState, NumericFailure, RoundingMode, SampleClockInputV1,
    fixed_i128::finish,
    fixed_rsi_from_averages,
    i256::{I256, Sign},
};

const PREFIX_LEN: usize = 384;

#[derive(Clone, Debug, Eq, PartialEq)]
struct Observation {
    coordinate: [u8; 308],
    close: i128,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Ready {
    gain: i128,
    loss: i128,
    value: i128,
}

/// RSI with exactly p initial deltas, followed only by Wilder updates.
///
/// The compiled capacity must cover p+1 closes. Coordinates are guest inputs, not Owner proofs;
/// the Host must authenticate them before invocation and commit the whole BFP event atomically.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FixedRsiState<const CAPACITY: usize> {
    period: NonZeroU32,
    input_scale: DecimalScale,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
    observation: Option<Observation>,
    ready: Option<Ready>,
    history: FixedWindowState<CAPACITY>,
}

impl<const CAPACITY: usize> FixedRsiState<CAPACITY> {
    pub fn new(
        period: NonZeroU32,
        input_scale: DecimalScale,
        output_scale: DecimalScale,
        rounding: Option<RoundingMode>,
    ) -> Result<Self, FixedStateFailure> {
        let history = FixedWindowState::new_lag(period, period, input_scale)?;
        history
            .canonical_len()
            .checked_add(PREFIX_LEN)
            .ok_or(FixedStateFailure::NonCanonicalState)?;
        Ok(Self {
            period,
            input_scale,
            output_scale,
            rounding,
            observation: None,
            ready: None,
            history,
        })
    }

    #[must_use]
    pub fn output(&self) -> Option<FixedI128> {
        self.ready
            .map(|ready| FixedI128::from_parts(ready.value, self.output_scale))
    }

    pub fn advance(
        &mut self,
        close: FixedI128,
        coordinate: SampleClockInputV1<'_>,
    ) -> Result<FixedIndicatorUpdate, FixedStateFailure> {
        if close.scale() != self.input_scale {
            return Err(NumericFailure::ScaleMismatch.into());
        }

        if let Some(previous) = self.observation.as_ref()
            && !coordinate.advances_after(SampleClockInputV1::from_untrusted_bytes(
                &previous.coordinate,
            )?)?
        {
            if close.coefficient() != previous.close {
                return Err(FixedStateFailure::ConflictingSample);
            }

            return Ok(FixedIndicatorUpdate {
                advanced: false,
                value: self.output(),
            });
        }

        let mut next = self.clone();
        let averages = if let Some(ready) = self.ready {
            let previous = self
                .observation
                .as_ref()
                .ok_or(FixedStateFailure::NonCanonicalState)?;
            let (gain, loss) = wide_delta(previous.close, close.coefficient())?;
            Some((
                next.wilder_average(ready.gain, gain)?,
                next.wilder_average(ready.loss, loss)?,
            ))
        } else {
            next.history.advance(close, coordinate)?;

            if next.history.sample_count() > self.period.get() {
                Some(next.initial_averages()?)
            } else {
                None
            }
        };

        if let Some((gain, loss)) = averages {
            let value = fixed_rsi_from_averages(gain, loss, self.output_scale, self.rounding)
                .map_err(feature_failure)?;
            next.ready = Some(Ready {
                gain: gain.coefficient(),
                loss: loss.coefficient(),
                value: value.coefficient(),
            });
            // Initialization history has no consumer after the first average; canonical READY
            // state retains only the current close and the two Wilder averages.
            if self.ready.is_none() {
                next.history =
                    FixedWindowState::new_lag(self.period, self.period, self.input_scale)?;
            }
        }

        next.observation = Some(Observation {
            coordinate: *coordinate.as_untrusted_bytes(),
            close: close.coefficient(),
        });
        let value = next.output();
        *self = next;
        Ok(FixedIndicatorUpdate {
            advanced: true,
            value,
        })
    }

    fn initial_averages(&self) -> Result<(FixedI128, FixedI128), FixedStateFailure> {
        let mut gains = I256::ZERO;
        let mut losses = I256::ZERO;

        for age in (1..=self.period.get()).rev() {
            let (previous, _) = self
                .history
                .sample_at_age(age)
                .ok_or(FixedStateFailure::NonCanonicalState)?;
            let (current, _) = self
                .history
                .sample_at_age(age - 1)
                .ok_or(FixedStateFailure::NonCanonicalState)?;
            let (gain, loss) = wide_delta(previous.coefficient(), current.coefficient())?;
            gains = gains
                .checked_add(gain)
                .ok_or(NumericFailure::I256Overflow)?;
            losses = losses
                .checked_add(loss)
                .ok_or(NumericFailure::I256Overflow)?;
        }

        let denominator = I256::from_i128(i128::from(self.period.get()));
        Ok((
            finish(gains, denominator, self.input_scale, self.rounding)?,
            finish(losses, denominator, self.input_scale, self.rounding)?,
        ))
    }

    fn wilder_average(&self, previous: i128, change: I256) -> Result<FixedI128, NumericFailure> {
        let numerator = I256::from_i128(previous)
            .checked_mul(I256::from_i128(i128::from(self.period.get()) - 1))
            .and_then(|weighted| weighted.checked_add(change))
            .ok_or(NumericFailure::I256Overflow)?;
        finish(
            numerator,
            I256::from_i128(i128::from(self.period.get())),
            self.input_scale,
            self.rounding,
        )
    }

    #[must_use]
    pub fn canonical_len(&self) -> usize {
        PREFIX_LEN + self.history.canonical_len()
    }

    fn header(&self) -> [u8; 12] {
        let mut bytes = [0; 12];
        bytes[..2].copy_from_slice(&1_u16.to_le_bytes());
        bytes[4] = RoundingMode::optional_to_canonical_bytes(self.rounding)[0];
        bytes[5] = self.input_scale.get();
        bytes[6] = self.output_scale.get();
        bytes[8..12].copy_from_slice(&self.period.get().to_le_bytes());
        bytes
    }

    pub fn encode_canonical(&self, bytes: &mut [u8]) -> Result<(), FixedStateFailure> {
        if bytes.len() != self.canonical_len() {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        bytes[..PREFIX_LEN].fill(0);
        bytes[..12].copy_from_slice(&self.header());

        if let Some(observation) = self.observation.as_ref() {
            bytes[7] = if self.ready.is_some() { 2 } else { 1 };
            bytes[12..320].copy_from_slice(&observation.coordinate);
            bytes[320..336].copy_from_slice(&observation.close.to_le_bytes());
        }

        if let Some(ready) = self.ready {
            bytes[336..352].copy_from_slice(&ready.gain.to_le_bytes());
            bytes[352..368].copy_from_slice(&ready.loss.to_le_bytes());
            bytes[368..384].copy_from_slice(&ready.value.to_le_bytes());
        }

        self.history.encode_canonical(&mut bytes[PREFIX_LEN..])
    }

    /// Validates the current configuration, phase and nested history before replacing state.
    /// Host checkpoint authenticity cannot be established from these structural bytes alone.
    pub fn restore_canonical(&mut self, bytes: &[u8]) -> Result<(), FixedStateFailure> {
        let header = self.header();

        if bytes.len() != self.canonical_len()
            || bytes[..7] != header[..7]
            || bytes[8..12] != header[8..12]
        {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let mut restored = Self::new(
            self.period,
            self.input_scale,
            self.output_scale,
            self.rounding,
        )?;
        restored.history.restore_canonical(&bytes[PREFIX_LEN..])?;

        if bytes[7] == 0 {
            if bytes[12..PREFIX_LEN].iter().any(|byte| *byte != 0)
                || restored.history.sample_count() != 0
            {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            *self = restored;
            return Ok(());
        }

        if bytes[7] > 2 {
            return Err(FixedStateFailure::NonCanonicalState);
        }

        let coordinate = SampleClockInputV1::from_untrusted_bytes(&bytes[12..320])
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;
        let close = read_coefficient(&bytes[320..336])?;

        if bytes[7] == 1 {
            if bytes[336..PREFIX_LEN].iter().any(|byte| *byte != 0)
                || restored.history.sample_count() > self.period.get()
            {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            let (latest, latest_coordinate) = restored
                .history
                .sample_at_age(0)
                .ok_or(FixedStateFailure::NonCanonicalState)?;

            if latest.coefficient() != close || latest_coordinate != coordinate.as_untrusted_bytes()
            {
                return Err(FixedStateFailure::NonCanonicalState);
            }
        } else {
            if restored.history.sample_count() != 0 {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            let gain = read_coefficient(&bytes[336..352])?;
            let loss = read_coefficient(&bytes[352..368])?;
            let value = read_coefficient(&bytes[368..384])?;
            let expected = fixed_rsi_from_averages(
                FixedI128::from_parts(gain, self.input_scale),
                FixedI128::from_parts(loss, self.input_scale),
                self.output_scale,
                self.rounding,
            )
            .map_err(|_| FixedStateFailure::NonCanonicalState)?;

            if value != expected.coefficient() {
                return Err(FixedStateFailure::NonCanonicalState);
            }

            restored.ready = Some(Ready { gain, loss, value });
        }

        restored.observation = Some(Observation {
            coordinate: *coordinate.as_untrusted_bytes(),
            close,
        });
        *self = restored;
        Ok(())
    }
}

fn wide_delta(previous: i128, current: i128) -> Result<(I256, I256), NumericFailure> {
    let change = I256::from_i128(current)
        .checked_sub(I256::from_i128(previous))
        .ok_or(NumericFailure::I256Overflow)?;

    if change.sign() == Sign::Negative {
        Ok((
            I256::ZERO,
            I256::ZERO
                .checked_sub(change)
                .ok_or(NumericFailure::I256Overflow)?,
        ))
    } else {
        Ok((change, I256::ZERO))
    }
}

fn read_coefficient(bytes: &[u8]) -> Result<i128, FixedStateFailure> {
    Ok(i128::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| FixedStateFailure::NonCanonicalState)?,
    ))
}

fn feature_failure(failure: FixedFeatureFailure) -> FixedStateFailure {
    match failure {
        FixedFeatureFailure::Numeric(numeric) => FixedStateFailure::Numeric(numeric),
        _ => FixedStateFailure::NonCanonicalState,
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use self::std::{vec, vec::Vec};

    use rstest::rstest;

    use super::*;

    fn scale(value: u8) -> DecimalScale {
        DecimalScale::new(value).unwrap()
    }

    fn fixed(value: i128) -> FixedI128 {
        FixedI128::from_parts(value, scale(0))
    }

    fn state(rounding: Option<RoundingMode>, output_scale: u8) -> FixedRsiState<4> {
        FixedRsiState::new(
            NonZeroU32::new(3).unwrap(),
            scale(0),
            scale(output_scale),
            rounding,
        )
        .unwrap()
    }

    // Structural guest fixtures only; no Owner-provenance claim is made here.
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

    fn bytes<const N: usize>(state: &FixedRsiState<N>) -> Vec<u8> {
        let mut bytes = vec![0; state.canonical_len()];
        state.encode_canonical(&mut bytes).unwrap();
        bytes
    }

    #[rstest]
    fn exactly_period_deltas_precede_wilder_updates() {
        let mut state = state(Some(RoundingMode::NearestTiesToEven), 0);
        let closes = [100, 103, 100, 106, 103, 109];
        let outputs = [None, None, None, Some(75), Some(50), Some(75)];

        for (index, close) in closes.into_iter().enumerate() {
            let update = state
                .advance(fixed(close), view(&coordinate(index as u64)))
                .unwrap();
            assert!(update.advanced);
            assert_eq!(update.value, outputs[index].map(fixed));
            assert_eq!(state.output(), update.value);

            if index >= 3 {
                assert_eq!(state.history.sample_count(), 0);
            }
        }
    }

    #[rstest]
    fn flat_rising_and_falling_frontiers_are_50_100_and_zero() {
        for (closes, expected) in [([5, 5, 5, 5], 50), ([0, 3, 6, 9], 100), ([9, 6, 3, 0], 0)] {
            let mut state = state(None, 2);

            for (index, close) in closes.into_iter().enumerate() {
                let update = state
                    .advance(fixed(close), view(&coordinate(index as u64)))
                    .unwrap();

                if index < 3 {
                    assert_eq!(update.value, None);
                } else {
                    assert_eq!(
                        update.value,
                        Some(FixedI128::from_parts(expected * 100, scale(2)))
                    );
                }
            }
        }
    }

    #[rstest]
    fn wide_delta_can_fit_initial_and_subsequent_average_without_i128_narrowing() {
        let mut state = state(Some(RoundingMode::NearestTiesToEven), 0);

        for (index, close) in [i128::MIN, i128::MAX, i128::MAX, i128::MAX]
            .into_iter()
            .enumerate()
        {
            state
                .advance(fixed(close), view(&coordinate(index as u64)))
                .unwrap();
        }

        assert_eq!(
            state.ready.unwrap().gain,
            113_427_455_640_312_821_154_458_202_477_256_070_485
        );
        assert_eq!(state.output(), Some(fixed(100)));
        assert_eq!(
            state
                .advance(fixed(i128::MIN), view(&coordinate(4)))
                .unwrap()
                .value,
            Some(fixed(40))
        );
        assert_eq!(
            state.ready.unwrap().loss,
            113_427_455_640_312_821_154_458_202_477_256_070_485
        );

        let mut one = FixedRsiState::<2>::new(NonZeroU32::MIN, scale(0), scale(0), None).unwrap();
        one.advance(fixed(i128::MIN), view(&coordinate(0))).unwrap();
        let before = bytes(&one);
        assert_eq!(
            one.advance(fixed(i128::MAX), view(&coordinate(1))),
            Err(FixedStateFailure::Numeric(
                NumericFailure::FinalI128Overflow
            ))
        );
        assert_eq!(bytes(&one), before);
    }

    #[rstest]
    fn repeat_is_not_a_delta_and_equal_value_successor_is() {
        let mut state = state(None, 0);
        state.advance(fixed(5), view(&coordinate(255))).unwrap();
        let before = bytes(&state);
        assert_eq!(
            state.advance(fixed(5), view(&coordinate(255))),
            Ok(FixedIndicatorUpdate {
                advanced: false,
                value: None
            })
        );
        assert_eq!(bytes(&state), before);
        assert_eq!(
            state.advance(fixed(6), view(&coordinate(255))),
            Err(FixedStateFailure::ConflictingSample)
        );
        assert_eq!(bytes(&state), before);

        for sequence in 256..=258 {
            let update = state
                .advance(fixed(5), view(&coordinate(sequence)))
                .unwrap();
            assert!(update.advanced);
            assert_eq!(
                update.value,
                if sequence == 258 {
                    Some(fixed(50))
                } else {
                    None
                }
            );
        }

        let before = bytes(&state);
        assert_eq!(
            state.advance(fixed(5), view(&coordinate(258))),
            Ok(FixedIndicatorUpdate {
                advanced: false,
                value: Some(fixed(50))
            })
        );
        assert_eq!(bytes(&state), before);
    }

    #[rstest]
    fn average_or_output_failure_does_not_partially_commit_initialization() {
        let mut unrounded = state(None, 0);

        for (index, close) in [0, 1, 1].into_iter().enumerate() {
            unrounded
                .advance(fixed(close), view(&coordinate(index as u64)))
                .unwrap();
        }

        let before = bytes(&unrounded);
        assert_eq!(
            unrounded.advance(fixed(1), view(&coordinate(3))),
            Err(FixedStateFailure::Numeric(NumericFailure::RoundingRequired))
        );
        assert_eq!(bytes(&unrounded), before);
        assert_eq!(
            unrounded
                .advance(fixed(3), view(&coordinate(4)))
                .unwrap()
                .value,
            Some(fixed(100))
        );

        let mut overflow = state(Some(RoundingMode::NearestTiesToEven), 38);

        for index in 0..3 {
            overflow
                .advance(fixed(5), view(&coordinate(index)))
                .unwrap();
        }

        let before = bytes(&overflow);
        assert_eq!(
            overflow.advance(fixed(5), view(&coordinate(3))),
            Err(FixedStateFailure::Numeric(
                NumericFailure::FinalI128Overflow
            ))
        );
        assert_eq!(bytes(&overflow), before);
        assert_eq!(
            overflow
                .advance(fixed(2), view(&coordinate(4)))
                .unwrap()
                .value,
            Some(FixedI128::from_parts(0, scale(38)))
        );
    }

    #[rstest]
    fn restore_at_every_frontier_preserves_the_entire_suffix() {
        let initial = state(Some(RoundingMode::NearestTiesToEven), 2);
        let samples = [100, 103, 100, 106, 103, 109, 109, 100];

        for frontier in 0..=samples.len() {
            let mut continuous = initial.clone();

            for (index, close) in samples[..frontier].iter().enumerate() {
                continuous
                    .advance(fixed(*close), view(&coordinate(index as u64)))
                    .unwrap();
            }

            let encoded = bytes(&continuous);
            let mut restored = initial.clone();
            restored.restore_canonical(&encoded).unwrap();
            assert_eq!(bytes(&restored), encoded);

            for (index, close) in samples.iter().enumerate().skip(frontier) {
                assert_eq!(
                    restored.advance(fixed(*close), view(&coordinate(index as u64))),
                    continuous.advance(fixed(*close), view(&coordinate(index as u64)))
                );
                assert_eq!(bytes(&restored), bytes(&continuous));
            }
        }
    }

    #[rstest]
    fn restore_rejects_phase_history_configuration_and_derived_output_splices() {
        let mut state = state(Some(RoundingMode::NearestTiesToEven), 0);
        let empty = bytes(&state);

        for offset in [0, 2, 4, 5, 6, 8, 12, 336, PREFIX_LEN + 4] {
            let mut malformed = empty.clone();
            malformed[offset] ^= 1;
            assert!(state.restore_canonical(&malformed).is_err());
            assert_eq!(bytes(&state), empty);
        }

        state.advance(fixed(100), view(&coordinate(0))).unwrap();
        let warming = bytes(&state);

        for offset in [7, 12 + 172, 320, 336, PREFIX_LEN + 12] {
            let mut malformed = warming.clone();
            malformed[offset] ^= 1;
            assert!(state.restore_canonical(&malformed).is_err());
            assert_eq!(bytes(&state), warming);
        }

        for (index, close) in [103, 100, 106].into_iter().enumerate() {
            state
                .advance(fixed(close), view(&coordinate(index as u64 + 1)))
                .unwrap();
        }

        let ready = bytes(&state);

        for offset in [336, 352, 368] {
            let mut malformed = ready.clone();
            malformed[offset] ^= 1;
            assert!(state.restore_canonical(&malformed).is_err());
            assert_eq!(bytes(&state), ready);
        }

        let mut spliced = ready.clone();
        spliced[PREFIX_LEN..].copy_from_slice(&warming[PREFIX_LEN..]);
        assert!(state.restore_canonical(&spliced).is_err());
        assert_eq!(bytes(&state), ready);
        assert!(state.restore_canonical(&ready[..ready.len() - 1]).is_err());
        assert_eq!(bytes(&state), ready);
        assert!(
            FixedRsiState::<3>::new(NonZeroU32::new(3).unwrap(), scale(0), scale(0), None).is_err()
        );
        let mut short = [9; 12];
        assert!(state.encode_canonical(&mut short).is_err());
        assert_eq!(short, [9; 12]);
    }
}
