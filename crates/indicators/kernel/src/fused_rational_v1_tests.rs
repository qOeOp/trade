extern crate std;

use core::num::NonZeroU32;

use rstest::rstest;
use std::vec::Vec;

use super::*;
use crate::{FixedRsiState, SampleClockInputV1};

const SCALE: u8 = 4;
const PERIOD: u32 = 3;

fn scale() -> DecimalScale {
    DecimalScale::new(SCALE).unwrap()
}

fn fixed(coefficient: i128) -> FixedI128 {
    FixedI128::from_parts(coefficient, scale())
}

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

/// RSI expressed the way a Design would declare it: no RSI primitive, only the shared basis.
///
/// Each field is a declared state cell and each method body is one fused rational expression. The
/// delta split is an exact equal-scale subtraction with a comparison and a selection, all of which
/// the basis already has. Nothing here knows what RSI means.
struct DeclaredRsi {
    period: u32,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
    previous_close: Option<FixedI128>,
    warm_up_gains: Vec<FixedI128>,
    warm_up_losses: Vec<FixedI128>,
    gain_average: Option<FixedI128>,
    loss_average: Option<FixedI128>,
}

impl DeclaredRsi {
    fn new(period: u32, output_scale: DecimalScale, rounding: Option<RoundingMode>) -> Self {
        Self {
            period,
            output_scale,
            rounding,
            previous_close: None,
            warm_up_gains: Vec::new(),
            warm_up_losses: Vec::new(),
            gain_average: None,
            loss_average: None,
        }
    }

    /// `sum / period`, one fused expression over the window members.
    fn average_of(&self, values: &[FixedI128]) -> FixedI128 {
        let mut numerator = Vec::new();
        for index in 0..values.len() {
            numerator.push(FusedRationalStepV1::Input(u8::try_from(index).unwrap()));
            if index > 0 {
                numerator.push(FusedRationalStepV1::Add);
            }
        }
        evaluate_fused_rational_v1(
            &numerator,
            &[FusedRationalStepV1::Integer(i128::from(self.period))],
            values,
            scale(),
            scale(),
            self.rounding,
        )
        .unwrap()
    }

    /// `(previous * (period - 1) + change) / period`, one fused expression.
    fn wilder(&self, previous: FixedI128, change: FixedI128) -> FixedI128 {
        evaluate_fused_rational_v1(
            &[
                FusedRationalStepV1::Input(0),
                FusedRationalStepV1::Integer(i128::from(self.period) - 1),
                FusedRationalStepV1::Multiply,
                FusedRationalStepV1::Input(1),
                FusedRationalStepV1::Add,
            ],
            &[FusedRationalStepV1::Integer(i128::from(self.period))],
            &[previous, change],
            scale(),
            scale(),
            self.rounding,
        )
        .unwrap()
    }

    /// `100 * gain / (gain + loss)`; the scales cancel, so the quotient is dimensionless.
    fn close(&self, gain: FixedI128, loss: FixedI128) -> FixedI128 {
        let zero = DecimalScale::new(0).unwrap();

        // The three special cases are comparisons and selections in the basis, not arithmetic.
        if gain.coefficient() == 0 && loss.coefficient() == 0 {
            return FixedI128::from_parts(50, zero)
                .rescale(self.output_scale, self.rounding)
                .unwrap();
        }

        if loss.coefficient() == 0 {
            return FixedI128::from_parts(100, zero)
                .rescale(self.output_scale, self.rounding)
                .unwrap();
        }

        if gain.coefficient() == 0 {
            return FixedI128::from_parts(0, zero)
                .rescale(self.output_scale, self.rounding)
                .unwrap();
        }

        evaluate_fused_rational_v1(
            &[
                FusedRationalStepV1::Input(0),
                FusedRationalStepV1::Integer(100),
                FusedRationalStepV1::Multiply,
            ],
            &[
                FusedRationalStepV1::Input(0),
                FusedRationalStepV1::Input(1),
                FusedRationalStepV1::Add,
            ],
            &[gain, loss],
            zero,
            self.output_scale,
            self.rounding,
        )
        .unwrap()
    }

    fn advance(&mut self, close: FixedI128) -> Option<FixedI128> {
        let Some(previous) = self.previous_close else {
            self.previous_close = Some(close);
            return None;
        };
        self.previous_close = Some(close);

        // Exact at equal scale, then split by sign with a comparison and a selection.
        let delta = close.coefficient() - previous.coefficient();
        let gain = fixed(delta.max(0));
        let loss = fixed((-delta).max(0));

        match (self.gain_average, self.loss_average) {
            (Some(gain_average), Some(loss_average)) => {
                self.gain_average = Some(self.wilder(gain_average, gain));
                self.loss_average = Some(self.wilder(loss_average, loss));
            }
            _ => {
                self.warm_up_gains.push(gain);
                self.warm_up_losses.push(loss);

                if self.warm_up_gains.len() == usize::try_from(self.period).unwrap() {
                    self.gain_average = Some(self.average_of(&self.warm_up_gains));
                    self.loss_average = Some(self.average_of(&self.warm_up_losses));
                }
            }
        }

        let gain_average = self.gain_average?;
        let loss_average = self.loss_average?;
        Some(self.close(gain_average, loss_average))
    }
}

/// Drives the shipped RSI primitive and the declared decomposition over the same closes.
fn assert_identical_over(closes: &[i128], rounding: Option<RoundingMode>, case: &str) {
    let mut primitive =
        FixedRsiState::<8>::new(NonZeroU32::new(PERIOD).unwrap(), scale(), scale(), rounding)
            .unwrap();
    let mut declared = DeclaredRsi::new(PERIOD, scale(), rounding);
    let mut observed = 0_usize;
    let mut distinct = Vec::new();

    for (index, close) in closes.iter().enumerate() {
        let bytes = coordinate(index as u64);
        let update = primitive
            .advance(
                fixed(*close),
                SampleClockInputV1::from_untrusted_bytes(&bytes).unwrap(),
            )
            .unwrap();
        let mine = declared.advance(fixed(*close));

        assert_eq!(
            update.value.map(FixedI128::coefficient),
            mine.map(FixedI128::coefficient),
            "{case} step {index}: declared RSI must reproduce the primitive coefficient exactly"
        );
        assert_eq!(
            update.value.map(FixedI128::scale),
            mine.map(FixedI128::scale),
            "{case} step {index}: scale must match"
        );

        if let Some(value) = mine {
            observed += 1;

            if !distinct.contains(&value.coefficient()) {
                distinct.push(value.coefficient());
            }
        }
    }

    // Without this the equality above could pass on `None == None` and prove nothing.
    assert!(
        observed
            >= closes
                .len()
                .saturating_sub(usize::try_from(PERIOD).unwrap() + 1),
        "{case}: expected a READY output for nearly every close, saw {observed} of {}",
        closes.len()
    );
    assert!(
        !distinct.is_empty(),
        "{case}: the comparison never observed a value"
    );
}

#[rstest]
#[case::rising(&[1000, 1100, 1250, 1300, 1450, 1500, 1610, 1700, 1705, 1900])]
#[case::falling(&[1900, 1800, 1650, 1600, 1450, 1400, 1290, 1200, 1195, 1000])]
#[case::mixed(&[1000, 1100, 1050, 1300, 1120, 1500, 1310, 1700, 1205, 1900, 1204, 1907])]
#[case::flat(&[1000, 1000, 1000, 1000, 1000, 1000, 1000])]
#[case::zero_loss(&[1000, 1100, 1200, 1300, 1400, 1500, 1600])]
#[case::zero_gain(&[1600, 1500, 1400, 1300, 1200, 1100, 1000])]
#[case::single_spike(&[1000, 1000, 1000, 5000, 1000, 1000, 1000, 1000])]
#[case::negative_prices(&[-500, -400, -600, -300, -700, -200, -800, -100])]
fn declared_rsi_reproduces_the_primitive_bit_for_bit(#[case] closes: &[i128]) {
    for rounding in [
        Some(RoundingMode::TowardZero),
        Some(RoundingMode::NearestTiesToEven),
    ] {
        assert_identical_over(closes, rounding, "declared");
    }
}

/// A deterministic sweep, so the equivalence is not an artifact of the chosen series.
#[rstest]
fn declared_rsi_reproduces_the_primitive_across_a_deterministic_sweep() {
    let mut state = 0x2545_F491_4F6C_DD1D_u64;
    let mut closes = Vec::new();

    for _ in 0..600 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        closes.push(i128::from(state % 4_000) - 2_000);
    }

    for rounding in [
        Some(RoundingMode::TowardZero),
        Some(RoundingMode::NearestTiesToEven),
    ] {
        assert_identical_over(&closes, rounding, "sweep");
    }
}

#[rstest]
fn an_unbalanced_or_oversized_program_is_refused() {
    let inputs = [fixed(1), fixed(2)];
    let one = [FusedRationalStepV1::Integer(1)];

    // Two values left on the stack.
    assert_eq!(
        evaluate_fused_rational_v1(
            &[FusedRationalStepV1::Input(0), FusedRationalStepV1::Input(1)],
            &one,
            &inputs,
            scale(),
            scale(),
            None,
        ),
        Err(FusedRationalFailureV1::Unbalanced)
    );

    // An operator with no operands.
    assert_eq!(
        evaluate_fused_rational_v1(
            &[FusedRationalStepV1::Add],
            &one,
            &inputs,
            scale(),
            scale(),
            None
        ),
        Err(FusedRationalFailureV1::Unbalanced)
    );

    // An empty program.
    assert_eq!(
        evaluate_fused_rational_v1(&[], &one, &inputs, scale(), scale(), None),
        Err(FusedRationalFailureV1::Unbalanced)
    );

    let deep: Vec<_> = core::iter::repeat_n(
        FusedRationalStepV1::Integer(1),
        FUSED_RATIONAL_STACK_DEPTH_V1 + 1,
    )
    .collect();
    assert_eq!(
        evaluate_fused_rational_v1(&deep, &one, &inputs, scale(), scale(), None),
        Err(FusedRationalFailureV1::StackOverflow)
    );
}

#[rstest]
fn an_absent_input_a_mixed_scale_and_a_zero_denominator_are_refused() {
    let inputs = [fixed(1)];
    let one = [FusedRationalStepV1::Integer(1)];

    assert_eq!(
        evaluate_fused_rational_v1(
            &[FusedRationalStepV1::Input(3)],
            &one,
            &inputs,
            scale(),
            scale(),
            None
        ),
        Err(FusedRationalFailureV1::UnknownInput)
    );

    let mixed = [
        fixed(1),
        FixedI128::from_parts(1, DecimalScale::new(2).unwrap()),
    ];
    assert_eq!(
        evaluate_fused_rational_v1(
            &[FusedRationalStepV1::Input(0)],
            &one,
            &mixed,
            scale(),
            scale(),
            None
        ),
        Err(FusedRationalFailureV1::ScaleMismatch)
    );

    assert_eq!(
        evaluate_fused_rational_v1(
            &[FusedRationalStepV1::Input(0)],
            &[FusedRationalStepV1::Integer(0)],
            &inputs,
            scale(),
            scale(),
            None
        ),
        Err(FusedRationalFailureV1::Numeric(
            NumericFailure::DivideByZero
        ))
    );
}

/// Intermediates stay wide: a product that overflows `i128` still yields the exact final value.
///
/// This is the property that a composition of separately rounded nodes cannot reproduce, and the
/// reason the shipped primitives had to carry their formulas themselves.
#[rstest]
fn intermediates_stay_in_i256_until_the_single_rounding() {
    let huge = FixedI128::from_parts(i128::MAX, scale());

    let value = evaluate_fused_rational_v1(
        &[
            FusedRationalStepV1::Input(0),
            FusedRationalStepV1::Integer(1_000),
            FusedRationalStepV1::Multiply,
        ],
        &[FusedRationalStepV1::Integer(1_000)],
        &[huge],
        scale(),
        scale(),
        Some(RoundingMode::TowardZero),
    )
    .unwrap();

    assert_eq!(value.coefficient(), i128::MAX);

    // The same expression whose final value does not fit refuses instead of wrapping.
    assert_eq!(
        evaluate_fused_rational_v1(
            &[
                FusedRationalStepV1::Input(0),
                FusedRationalStepV1::Integer(1_000),
                FusedRationalStepV1::Multiply,
            ],
            &[FusedRationalStepV1::Integer(1)],
            &[huge],
            scale(),
            scale(),
            Some(RoundingMode::TowardZero),
        ),
        Err(FusedRationalFailureV1::Numeric(
            NumericFailure::FinalI128Overflow
        ))
    );
}
