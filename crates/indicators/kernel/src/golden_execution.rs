//! Executes the fixed kernel corpus for catalog verification, never a BFP DAG or Host program.

use core::num::NonZeroU32;

use crate::{catalog_contract::PrimitiveOperationV1 as Op, catalog_rows::catalog_row_v1};

use crate::{
    BoundedFeatureGoldenVectorV1, ComparisonPredicateV1, DecimalScale, FixedBarState,
    FixedFeatureFailure, FixedI128, FixedRsiState, FixedSampleUpdate, FixedSmoothingKind,
    FixedSmoothingState, FixedStateFailure, FixedWindowFunction, FixedWindowState,
    GoldenVectorPartsV1, GoldenVectorTerminalV1 as Terminal, ReducedUnitFraction, RoundingMode,
    SampleClockInputV1,
    catalog_version::{CatalogVersionV1, MAX_GOLDEN_VECTORS_V1},
    fixed_range_fraction,
    fused_rational_v1::MAX_FUSED_PROGRAM_STEPS_V1,
};

const CAPACITY: usize = 4;
const STATE_CAPACITY: usize = 384 + 20 + 324 * CAPACITY;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoldenVerificationFailure {
    InvalidVector,
    InvalidCoverage,
    UnknownPrimitive,
    InvalidRounding,
    InvalidInput,
    InvalidState,
    TerminalMismatch,
    OutputMismatch,
    StateMismatch,
    FailureChangedState,
}

/// Executes the newest published version's corpus, including expected output and post-state.
/// This supplies kernel evidence only; it does not issue a catalog digest or authenticate a Host.
///
/// # Errors
///
/// Returns the vector, coverage, or execution failure that closed verification.
pub fn verify_required_golden_corpus_v1() -> Result<(), GoldenVerificationFailure> {
    verify_catalog_version_corpus_v1(crate::catalog_version::newest())
}

/// Executes one published version's corpus against the running kernel.
///
/// This is what lets a program frozen under an earlier version stay readable: the version's own
/// vectors must still reproduce byte for byte before anything parses against it.
pub(crate) fn verify_catalog_version_corpus_v1(
    version: &CatalogVersionV1,
) -> Result<(), GoldenVerificationFailure> {
    let first_bytes = version
        .goldens
        .first()
        .ok_or(GoldenVerificationFailure::InvalidCoverage)?;

    if version.goldens.len() > MAX_GOLDEN_VECTORS_V1 {
        return Err(GoldenVerificationFailure::InvalidCoverage);
    }

    let first = BoundedFeatureGoldenVectorV1::decode(first_bytes)
        .map_err(|_| GoldenVerificationFailure::InvalidVector)?;
    let mut vectors = [first; MAX_GOLDEN_VECTORS_V1];

    for (vector, bytes) in vectors.iter_mut().zip(version.goldens) {
        *vector = BoundedFeatureGoldenVectorV1::decode(bytes)
            .map_err(|_| GoldenVerificationFailure::InvalidVector)?;
    }

    let declared = &vectors[..version.goldens.len()];
    crate::required_golden_ids::validate_golden_ids_for(
        declared,
        version.required_golden_ids,
        version.executable_ids,
    )
    .map_err(|_| GoldenVerificationFailure::InvalidCoverage)?;

    for vector in declared {
        verify(vector.parts())?;
    }

    Ok(())
}

#[derive(Clone, Copy)]
struct RawFixed {
    coefficient: i128,
    scale: u8,
}

impl RawFixed {
    fn value(self) -> Result<FixedI128, Eval> {
        FixedI128::new(self.coefficient, self.scale).map_err(|_| Eval::Numeric)
    }
}

struct Frame<'a> {
    values: [RawFixed; 4],
    coordinate: &'a [u8],
    input_scale: u8,
    output_scale: u8,
    period: u32,
    max_lag: u32,
    numerator: u32,
    denominator: u32,
    condition: bool,
    comparison: Option<ComparisonPredicateV1>,
    quotient_scale: u8,
    numerator_program: &'a [u8],
    denominator_program: &'a [u8],
}

impl<'a> Frame<'a> {
    fn parse(op: Op, bytes: &'a [u8]) -> Result<Self, GoldenVerificationFailure> {
        let mut input = Reader { bytes, offset: 0 };

        if input.take(8)? != b"BFGI\x01\0\0\0" {
            return Err(GoldenVerificationFailure::InvalidInput);
        }

        let mut frame = Self {
            values: [RawFixed {
                coefficient: 0,
                scale: 0,
            }; 4],
            coordinate: &[],
            input_scale: 0,
            output_scale: 0,
            period: 0,
            max_lag: 0,
            numerator: 0,
            denominator: 0,
            condition: false,
            comparison: None,
            quotient_scale: 0,
            numerator_program: &[],
            denominator_program: &[],
        };

        if op.stateful() {
            frame.coordinate = input.take(308)?;
        }

        if matches!(op, Op::Select) {
            frame.condition = match input.byte()? {
                0 => false,
                1 => true,
                _ => return Err(GoldenVerificationFailure::InvalidInput),
            };
        }

        let count = if op.bar() {
            4
        } else if op.stateful() || matches!(op, Op::Rescale) {
            1
        } else {
            2
        };

        for value in &mut frame.values[..count] {
            value.coefficient = i128::from_le_bytes(
                input
                    .take(16)?
                    .try_into()
                    .map_err(|_| GoldenVerificationFailure::InvalidInput)?,
            );
            value.scale = input.byte()?;
        }

        if op.stateful() {
            frame.input_scale = input.byte()?;
            frame.output_scale = input.byte()?;
            frame.period = input.u32()?;

            if matches!(op, Op::Lag) {
                frame.max_lag = input.u32()?;
            }
        } else if matches!(
            op,
            Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Rescale | Op::Fraction | Op::FusedRational
        ) {
            frame.output_scale = input.byte()?;
        }

        if matches!(op, Op::FusedRational) {
            frame.quotient_scale = input.byte()?;
            let numerator = usize::from(input.byte()?);
            frame.numerator_program = input.take(numerator)?;
            let denominator = usize::from(input.byte()?);
            frame.denominator_program = input.take(denominator)?;
        }

        if matches!(op, Op::Fraction) {
            frame.numerator = input.u32()?;
            frame.denominator = input.u32()?;
        }

        if matches!(op, Op::Compare) {
            frame.comparison = Some(
                ComparisonPredicateV1::from_canonical_bytes(input.take(1)?)
                    .map_err(|_| GoldenVerificationFailure::InvalidInput)?,
            );
        }

        if input.offset != bytes.len() {
            return Err(GoldenVerificationFailure::InvalidInput);
        }

        Ok(frame)
    }

    fn bar(&self) -> Result<crate::FixedOhlc, Eval> {
        crate::FixedOhlc::new(
            self.values[0].value()?,
            self.values[1].value()?,
            self.values[2].value()?,
            self.values[3].value()?,
        )
        .map_err(feature_failure)
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], GoldenVerificationFailure> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(GoldenVerificationFailure::InvalidInput)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(GoldenVerificationFailure::InvalidInput)?;
        self.offset = end;
        Ok(value)
    }

    fn byte(&mut self) -> Result<u8, GoldenVerificationFailure> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, GoldenVerificationFailure> {
        Ok(u32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| GoldenVerificationFailure::InvalidInput)?,
        ))
    }
}

#[derive(Clone, Copy)]
enum Eval {
    Numeric,
    Unsupported,
    InvalidState,
}

fn feature_failure(error: FixedFeatureFailure) -> Eval {
    match error {
        FixedFeatureFailure::Numeric(_) | FixedFeatureFailure::InvalidOhlc => Eval::Numeric,
        _ => Eval::Unsupported,
    }
}

fn state_failure(error: FixedStateFailure) -> Eval {
    match error {
        FixedStateFailure::Numeric(_) => Eval::Numeric,
        _ => Eval::InvalidState,
    }
}

struct Output {
    terminal: Terminal,
    bytes: [u8; 326],
    len: usize,
}

impl Output {
    fn scalar(value: FixedI128) -> Self {
        let mut output = Self {
            terminal: Terminal::Ready,
            bytes: [0; 326],
            len: 17,
        };
        output.bytes[..17].copy_from_slice(&value.to_canonical_bytes());
        output
    }

    fn state(advanced: bool, value: Option<FixedI128>, coordinate: Option<&[u8; 308]>) -> Self {
        let mut output = Self {
            terminal: if value.is_some() {
                Terminal::Ready
            } else {
                Terminal::Warming
            },
            bytes: [0; 326],
            len: 1,
        };
        output.bytes[0] = u8::from(advanced);

        if let Some(value) = value {
            output.bytes[1..18].copy_from_slice(&value.to_canonical_bytes());
            output.len = 18;

            if let Some(coordinate) = coordinate {
                output.bytes[18..326].copy_from_slice(coordinate);
                output.len = 326;
            }
        }

        output
    }
}

fn scalar_execute(
    op: Op,
    frame: &Frame<'_>,
    rounding: Option<RoundingMode>,
) -> Result<Output, Eval> {
    let a = frame.values[0].value()?;
    let output_scale = DecimalScale::new(frame.output_scale).map_err(|_| Eval::Numeric)?;
    let numeric = |value: Result<FixedI128, crate::NumericFailure>| {
        value.map(Output::scalar).map_err(|_| Eval::Numeric)
    };

    match op {
        Op::FusedRational => {
            let quotient_scale =
                DecimalScale::new(frame.quotient_scale).map_err(|_| Eval::Numeric)?;
            let mut numerator = [crate::FusedRationalStepV1::Add; MAX_FUSED_PROGRAM_STEPS_V1];
            let mut denominator = [crate::FusedRationalStepV1::Add; MAX_FUSED_PROGRAM_STEPS_V1];
            let numerator_len =
                crate::decode_fused_program_v1(frame.numerator_program, &mut numerator)
                    .map_err(|_| Eval::Numeric)?;
            let denominator_len =
                crate::decode_fused_program_v1(frame.denominator_program, &mut denominator)
                    .map_err(|_| Eval::Numeric)?;

            crate::evaluate_fused_rational_v1(
                &numerator[..numerator_len],
                &denominator[..denominator_len],
                &[a, frame.values[1].value()?],
                quotient_scale,
                output_scale,
                rounding,
            )
            .map(Output::scalar)
            .map_err(|_| Eval::Numeric)
        }
        Op::Add => {
            numeric(a.checked_add_to_scale(frame.values[1].value()?, output_scale, rounding))
        }
        Op::Sub => {
            numeric(a.checked_sub_to_scale(frame.values[1].value()?, output_scale, rounding))
        }
        Op::Mul => numeric(a.checked_mul(frame.values[1].value()?, output_scale, rounding)),
        Op::Div => numeric(a.checked_div(frame.values[1].value()?, output_scale, rounding)),
        Op::Rescale => numeric(a.rescale(output_scale, rounding)),
        Op::Compare => {
            let condition = a
                .checked_compare(
                    frame.values[1].value()?,
                    frame.comparison.ok_or(Eval::InvalidState)?,
                )
                .map_err(|_| Eval::Numeric)?;
            let mut output = Output {
                terminal: Terminal::Ready,
                bytes: [0; 326],
                len: 1,
            };
            output.bytes[0] = u8::from(condition);
            Ok(output)
        }
        Op::Select => numeric(FixedI128::checked_select(
            frame.condition,
            a,
            frame.values[1].value()?,
        )),
        Op::Body => numeric(frame.bar()?.body()),
        Op::Range => numeric(frame.bar()?.range()),
        Op::UpperWick => numeric(frame.bar()?.upper_wick()),
        Op::LowerWick => numeric(frame.bar()?.lower_wick()),
        Op::Fraction => {
            let ratio = ReducedUnitFraction::new(frame.numerator, frame.denominator)
                .ok_or(Eval::Unsupported)?;
            fixed_range_fraction(a, frame.values[1].value()?, ratio, output_scale, rounding)
                .map(Output::scalar)
                .map_err(feature_failure)
        }
        _ => Err(Eval::InvalidState),
    }
}

fn verify(parts: GoldenVectorPartsV1<'_>) -> Result<(), GoldenVerificationFailure> {
    let (op, rounding) = primitive(parts.primitive_id)?;

    if parts.rounding != rounding {
        return Err(GoldenVerificationFailure::InvalidRounding);
    }

    let frame = Frame::parse(op, parts.input)?;
    let mut state_bytes = [0; STATE_CAPACITY];
    let (result, state_len) = if op.stateful() {
        state_execute(
            op,
            &frame,
            parts.rounding,
            parts.pre_state,
            &mut state_bytes,
        )?
    } else {
        if !parts.pre_state.is_empty() {
            return Err(GoldenVerificationFailure::InvalidState);
        }

        (scalar_execute(op, &frame, parts.rounding), 0)
    };
    let actual = match result {
        Ok(output) => output,
        Err(e) => Output {
            terminal: match e {
                Eval::Numeric => Terminal::NumericFailureNoStateChange,
                Eval::Unsupported => Terminal::Unsupported,
                Eval::InvalidState => return Err(GoldenVerificationFailure::InvalidState),
            },
            bytes: [0; 326],
            len: 0,
        },
    };

    if matches!(
        actual.terminal,
        Terminal::NumericFailureNoStateChange | Terminal::Unsupported
    ) && state_bytes[..state_len] != *parts.pre_state
    {
        return Err(GoldenVerificationFailure::FailureChangedState);
    }

    if actual.terminal != parts.terminal {
        return Err(GoldenVerificationFailure::TerminalMismatch);
    }

    if actual.bytes[..actual.len] != *parts.expected_output {
        return Err(GoldenVerificationFailure::OutputMismatch);
    }

    if state_bytes[..state_len] != *parts.post_state {
        return Err(GoldenVerificationFailure::StateMismatch);
    }
    Ok(())
}

fn state_execute(
    op: Op,
    frame: &Frame<'_>,
    rounding: Option<RoundingMode>,
    pre: &[u8],
    post: &mut [u8; STATE_CAPACITY],
) -> Result<(Result<Output, Eval>, usize), GoldenVerificationFailure> {
    fn bad<T>(_: T) -> GoldenVerificationFailure {
        GoldenVerificationFailure::InvalidState
    }
    let input_scale = DecimalScale::new(frame.input_scale).map_err(bad)?;
    let output_scale = DecimalScale::new(frame.output_scale).map_err(bad)?;
    let coordinate = SampleClockInputV1::from_untrusted_bytes(frame.coordinate).map_err(bad)?;

    match op {
        Op::Ema | Op::Wilder => {
            if input_scale != output_scale {
                return Err(GoldenVerificationFailure::InvalidState);
            }
            let period =
                NonZeroU32::new(frame.period).ok_or(GoldenVerificationFailure::InvalidState)?;
            let kind = if matches!(op, Op::Ema) {
                FixedSmoothingKind::Ema
            } else {
                FixedSmoothingKind::Wilder
            };
            let mut state = FixedSmoothingState::new(kind, period, input_scale, rounding);
            state.restore_canonical_bytes(pre).map_err(bad)?;
            let result = frame.values[0]
                .value()
                .and_then(|value| state.advance(value, coordinate).map_err(state_failure))
                .map(|update| match update {
                    FixedSampleUpdate::Advanced(value) => Output::state(true, Some(value), None),
                    FixedSampleUpdate::Reused(value) => Output::state(false, Some(value), None),
                });
            let bytes = state.to_canonical_bytes();
            post[..bytes.len()].copy_from_slice(&bytes);
            Ok((result, bytes.len()))
        }
        Op::TrueRange | Op::Atr | Op::Gap => {
            if input_scale != output_scale
                || (!matches!(op, Op::Atr) && (frame.period != 0 || rounding.is_some()))
            {
                return Err(GoldenVerificationFailure::InvalidState);
            }
            let mut state = match op {
                Op::TrueRange => FixedBarState::new_true_range(input_scale),
                Op::Gap => FixedBarState::new_gap(input_scale),
                _ => FixedBarState::new_atr(
                    NonZeroU32::new(frame.period).ok_or(GoldenVerificationFailure::InvalidState)?,
                    input_scale,
                    rounding,
                ),
            };
            state.restore_canonical_bytes(pre).map_err(bad)?;
            let result = frame
                .bar()
                .and_then(|bar| state.advance(bar, coordinate).map_err(state_failure))
                .map(|update| Output::state(update.advanced, update.value, None));
            let bytes = state.to_canonical_bytes();
            post[..bytes.len()].copy_from_slice(&bytes);
            Ok((result, bytes.len()))
        }
        Op::Rsi => {
            let period =
                NonZeroU32::new(frame.period).ok_or(GoldenVerificationFailure::InvalidState)?;
            let mut state =
                FixedRsiState::<CAPACITY>::new(period, input_scale, output_scale, rounding)
                    .map_err(bad)?;
            state.restore_canonical(pre).map_err(bad)?;
            let result = frame.values[0]
                .value()
                .and_then(|value| state.advance(value, coordinate).map_err(state_failure))
                .map(|update| Output::state(update.advanced, update.value, None));
            let len = state.canonical_len();
            state.encode_canonical(&mut post[..len]).map_err(bad)?;
            Ok((result, len))
        }
        _ => {
            let window =
                NonZeroU32::new(frame.period).ok_or(GoldenVerificationFailure::InvalidState)?;
            let mut state = if matches!(op, Op::Lag) {
                if input_scale != output_scale || rounding.is_some() {
                    return Err(GoldenVerificationFailure::InvalidState);
                }
                FixedWindowState::<CAPACITY>::new_lag(
                    window,
                    NonZeroU32::new(frame.max_lag)
                        .ok_or(GoldenVerificationFailure::InvalidState)?,
                    input_scale,
                )
            } else {
                let function = match op {
                    Op::Sum => FixedWindowFunction::Sum,
                    Op::Mean => FixedWindowFunction::Mean,
                    Op::Minimum => FixedWindowFunction::Minimum,
                    Op::Maximum => FixedWindowFunction::Maximum,
                    Op::SwingHigh => FixedWindowFunction::SwingHigh,
                    Op::SwingLow => FixedWindowFunction::SwingLow,
                    _ => return Err(GoldenVerificationFailure::UnknownPrimitive),
                };
                FixedWindowState::new(function, window, input_scale, output_scale, rounding)
            }
            .map_err(bad)?;
            state.restore_canonical(pre).map_err(bad)?;
            let result = frame.values[0]
                .value()
                .and_then(|value| state.advance(value, coordinate).map_err(state_failure))
                .map(|update| {
                    Output::state(
                        update.advanced,
                        update.output.value(),
                        update.output.sample_coordinate_bytes(),
                    )
                });
            let len = state.canonical_len();
            state.encode_canonical(&mut post[..len]).map_err(bad)?;
            Ok((result, len))
        }
    }
}

fn primitive(id: &str) -> Result<(Op, Option<RoundingMode>), GoldenVerificationFailure> {
    let row = catalog_row_v1(id).ok_or(GoldenVerificationFailure::UnknownPrimitive)?;
    let operation = row
        .operation
        .ok_or(GoldenVerificationFailure::UnknownPrimitive)?;
    Ok((operation, row.rounding))
}

#[cfg(test)]
mod tests {
    use crate::golden_corpus::GOLDENS;
    extern crate std;
    use super::*;

    #[rstest::rstest]
    fn entire_builtin_corpus_executes_with_exact_output_and_state() {
        for bytes in GOLDENS {
            let parts = BoundedFeatureGoldenVectorV1::decode(bytes).unwrap().parts();
            assert_eq!(verify(parts), Ok(()), "{}", parts.vector_id);
        }

        assert_eq!(verify_required_golden_corpus_v1(), Ok(()));
    }

    #[rstest::rstest]
    fn every_vector_rejects_tampered_expectations_and_pre_state() {
        for bytes in GOLDENS {
            let parts = BoundedFeatureGoldenVectorV1::decode(bytes).unwrap().parts();
            let terminal = match parts.terminal {
                Terminal::Ready => Terminal::Warming,
                _ => Terminal::Ready,
            };
            assert!(
                verify(GoldenVectorPartsV1 { terminal, ..parts }).is_err(),
                "{} terminal",
                parts.vector_id
            );
            let mut output = parts.expected_output.to_vec();
            output.push(1);
            assert!(
                verify(GoldenVectorPartsV1 {
                    expected_output: &output,
                    ..parts
                })
                .is_err(),
                "{} output",
                parts.vector_id
            );
            let mut post = parts.post_state.to_vec();
            post.push(1);
            assert!(
                verify(GoldenVectorPartsV1 {
                    post_state: &post,
                    ..parts
                })
                .is_err(),
                "{} post-state",
                parts.vector_id
            );
            let mut pre = parts.pre_state.to_vec();
            pre.push(1);
            assert!(
                verify(GoldenVectorPartsV1 {
                    pre_state: &pre,
                    ..parts
                })
                .is_err(),
                "{} pre-state",
                parts.vector_id
            );

            if !parts.expected_output.is_empty() {
                let mut output = parts.expected_output.to_vec();
                output[0] ^= 1;
                assert!(
                    verify(GoldenVectorPartsV1 {
                        expected_output: &output,
                        ..parts
                    })
                    .is_err(),
                    "{} changed output",
                    parts.vector_id
                );
            }

            if !parts.post_state.is_empty() {
                let mut post = parts.post_state.to_vec();
                post[0] ^= 1;
                assert!(
                    verify(GoldenVectorPartsV1 {
                        post_state: &post,
                        ..parts
                    })
                    .is_err(),
                    "{} changed state",
                    parts.vector_id
                );
            }
        }
    }

    #[rstest::rstest]
    fn shape_errors_cannot_masquerade_as_numeric_failures() {
        for bytes in GOLDENS {
            let parts = BoundedFeatureGoldenVectorV1::decode(bytes).unwrap().parts();

            for length in 0..parts.input.len() {
                assert_eq!(
                    verify(GoldenVectorPartsV1 {
                        input: &parts.input[..length],
                        ..parts
                    }),
                    Err(GoldenVerificationFailure::InvalidInput),
                    "{} length {}",
                    parts.vector_id,
                    length
                );
            }

            let mut input = parts.input.to_vec();
            input.push(0);
            assert_eq!(
                verify(GoldenVectorPartsV1 {
                    input: &input,
                    ..parts
                }),
                Err(GoldenVerificationFailure::InvalidInput)
            );
            input = parts.input.to_vec();
            input[6] = 1;
            assert_eq!(
                verify(GoldenVectorPartsV1 {
                    input: &input,
                    ..parts
                }),
                Err(GoldenVerificationFailure::InvalidInput)
            );
            let rounding = if parts.rounding == Some(RoundingMode::TowardZero) {
                Some(RoundingMode::NearestTiesToEven)
            } else {
                Some(RoundingMode::TowardZero)
            };
            assert_eq!(
                verify(GoldenVectorPartsV1 { rounding, ..parts }),
                Err(GoldenVerificationFailure::InvalidRounding)
            );
        }
    }
}
