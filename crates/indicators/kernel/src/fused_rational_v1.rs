//! One declared rational expression, evaluated wide and rounded exactly once.
//!
//! Every catalog primitive that computes a value shares one shape: build an I256 numerator and an
//! I256 denominator from the node's inputs and integer constants, then divide and round once. The
//! formulas differ; the shape does not. Wilder's update is
//! `(previous * (period - 1) + change) / period`, an initial average is `sum / period`, and the RSI
//! close is `100 * gain / (gain + loss)`.
//!
//! Baking each of those in as its own primitive is what makes the catalog grow with research. A
//! declared expression moves the formula to the caller while keeping the property that forced the
//! primitives to exist: intermediates stay in I256 and exactly one rounding happens, at the end.
//! Composing the same formula from separately rounded nodes cannot do that, because every node
//! output is an already-rounded `FixedI128`.
//!
//! The expression is a flat postfix program over a bounded stack. It allocates nothing, has one
//! canonical form for one meaning, and every failure is closed: an unknown input index, an
//! unbalanced program, a stack overflow, an I256 overflow, a zero denominator, or inputs that do
//! not share one scale all refuse rather than approximate.

use crate::{
    DecimalScale, FixedI128, NumericFailure, RoundingMode,
    fixed_i128::{apply_decimal_exponent, finish},
    i256::I256,
};

/// Maximum steps one expression program may declare.
///
/// It bounds the canonical encoding and the decode buffer together, so a program too long to check
/// is refused before any of it is evaluated.
pub const MAX_FUSED_PROGRAM_STEPS_V1: usize = 32;

/// Maximum operand stack depth one expression may use.
///
/// It bounds verification and evaluation together: a program that would exceed it is refused rather
/// than evaluated, so no declared expression can cost more than this to check or to run.
pub const FUSED_RATIONAL_STACK_DEPTH_V1: usize = 16;

/// One step of a postfix rational expression.
///
/// There is no division: the single division is the boundary between the numerator and the
/// denominator program, which is what keeps the rounding count at exactly one.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum FusedRationalStepV1 {
    /// Pushes the coefficient of the input at this index.
    Input(u8),
    /// Pushes a dimensionless integer, such as a period or a percentage base.
    Integer(i128),
    /// Replaces the top two operands with their sum.
    Add,
    /// Replaces the top two operands with `second - top`.
    Subtract,
    /// Replaces the top two operands with their product.
    Multiply,
}

/// Why one declared expression was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FusedRationalFailureV1 {
    /// The program is empty, leaves more than one value, or consumes an absent operand.
    Unbalanced,
    /// The program needs more operand slots than [`FUSED_RATIONAL_STACK_DEPTH_V1`].
    StackOverflow,
    /// The program references an input this node was not given.
    UnknownInput,
    /// Inputs do not all carry the same decimal scale.
    ScaleMismatch,
    /// The evaluation, the scale application, the division, or the final narrowing failed.
    Numeric(NumericFailure),
}

impl From<NumericFailure> for FusedRationalFailureV1 {
    fn from(value: NumericFailure) -> Self {
        Self::Numeric(value)
    }
}

/// Evaluates `numerator / denominator` wide and rounds once.
///
/// `quotient_scale` is the decimal scale the quotient itself carries before the result is expressed
/// at `output_scale`. It is the caller's declaration rather than something inferred: a Wilder update
/// divides a value by a dimensionless period and keeps the input scale, while an RSI close divides a
/// value by a value, so the scales cancel and the quotient is dimensionless.
///
/// # Errors
///
/// Returns [`FusedRationalFailureV1`] for an unbalanced or oversized program, an input index this
/// node was not given, inputs that disagree on scale, an I256 overflow at any step, a zero
/// denominator, or a final value outside `i128`.
pub fn evaluate_fused_rational_v1(
    numerator: &[FusedRationalStepV1],
    denominator: &[FusedRationalStepV1],
    inputs: &[FixedI128],
    quotient_scale: DecimalScale,
    output_scale: DecimalScale,
    rounding: Option<RoundingMode>,
) -> Result<FixedI128, FusedRationalFailureV1> {
    require_one_scale(inputs)?;
    let numerator = evaluate(numerator, inputs)?;
    let denominator = evaluate(denominator, inputs)?;
    let exponent = i16::from(output_scale.get()) - i16::from(quotient_scale.get());
    let (numerator, denominator) = apply_decimal_exponent(numerator, denominator, exponent)?;
    Ok(finish(numerator, denominator, output_scale, rounding)?)
}

/// Every input must already agree on scale; this port never rescales one silently.
fn require_one_scale(inputs: &[FixedI128]) -> Result<(), FusedRationalFailureV1> {
    let Some(first) = inputs.first() else {
        return Ok(());
    };

    if inputs.iter().any(|value| value.scale() != first.scale()) {
        return Err(FusedRationalFailureV1::ScaleMismatch);
    }
    Ok(())
}

fn evaluate(
    program: &[FusedRationalStepV1],
    inputs: &[FixedI128],
) -> Result<I256, FusedRationalFailureV1> {
    let mut stack = [I256::ZERO; FUSED_RATIONAL_STACK_DEPTH_V1];
    let mut depth = 0_usize;

    for step in program {
        match step {
            FusedRationalStepV1::Input(index) => {
                let value = inputs
                    .get(usize::from(*index))
                    .ok_or(FusedRationalFailureV1::UnknownInput)?;
                push(&mut stack, &mut depth, I256::from_i128(value.coefficient()))?;
            }
            FusedRationalStepV1::Integer(value) => {
                push(&mut stack, &mut depth, I256::from_i128(*value))?;
            }
            FusedRationalStepV1::Add
            | FusedRationalStepV1::Subtract
            | FusedRationalStepV1::Multiply => {
                let top = pop(&stack, &mut depth)?;
                let second = pop(&stack, &mut depth)?;
                let value = match step {
                    FusedRationalStepV1::Add => second.checked_add(top),
                    FusedRationalStepV1::Subtract => second.checked_sub(top),
                    _ => second.checked_mul(top),
                }
                .ok_or(FusedRationalFailureV1::Numeric(
                    NumericFailure::I256Overflow,
                ))?;
                push(&mut stack, &mut depth, value)?;
            }
        }
    }

    if depth != 1 {
        return Err(FusedRationalFailureV1::Unbalanced);
    }
    Ok(stack[0])
}

fn push(
    stack: &mut [I256; FUSED_RATIONAL_STACK_DEPTH_V1],
    depth: &mut usize,
    value: I256,
) -> Result<(), FusedRationalFailureV1> {
    if *depth >= FUSED_RATIONAL_STACK_DEPTH_V1 {
        return Err(FusedRationalFailureV1::StackOverflow);
    }
    stack[*depth] = value;
    *depth += 1;
    Ok(())
}

fn pop(
    stack: &[I256; FUSED_RATIONAL_STACK_DEPTH_V1],
    depth: &mut usize,
) -> Result<I256, FusedRationalFailureV1> {
    *depth = depth
        .checked_sub(1)
        .ok_or(FusedRationalFailureV1::Unbalanced)?;
    Ok(stack[*depth])
}

/// Decodes one canonical expression program into `steps`, returning how many it wrote.
///
/// The encoding is one step per record: tag `1` pushes the input at the following byte, tag `2`
/// pushes the following little-endian `i128`, and tags `3`, `4` and `5` are add, subtract and
/// multiply with no payload. Trailing bytes, an unknown tag and an over-long program are refused,
/// so one program has exactly one encoding.
///
/// # Errors
///
/// Returns [`FusedRationalFailureV1::Unbalanced`] for a malformed or over-long encoding.
pub fn decode_fused_program_v1(
    bytes: &[u8],
    steps: &mut [FusedRationalStepV1; MAX_FUSED_PROGRAM_STEPS_V1],
) -> Result<usize, FusedRationalFailureV1> {
    let mut offset = 0_usize;
    let mut count = 0_usize;

    while offset < bytes.len() {
        if count >= MAX_FUSED_PROGRAM_STEPS_V1 {
            return Err(FusedRationalFailureV1::StackOverflow);
        }
        let tag = bytes[offset];
        offset += 1;
        steps[count] = match tag {
            1 => {
                let index = *bytes
                    .get(offset)
                    .ok_or(FusedRationalFailureV1::Unbalanced)?;
                offset += 1;
                FusedRationalStepV1::Input(index)
            }
            2 => {
                let raw: [u8; 16] = bytes
                    .get(offset..offset + 16)
                    .ok_or(FusedRationalFailureV1::Unbalanced)?
                    .try_into()
                    .map_err(|_| FusedRationalFailureV1::Unbalanced)?;
                offset += 16;
                FusedRationalStepV1::Integer(i128::from_le_bytes(raw))
            }
            3 => FusedRationalStepV1::Add,
            4 => FusedRationalStepV1::Subtract,
            5 => FusedRationalStepV1::Multiply,
            _ => return Err(FusedRationalFailureV1::Unbalanced),
        };
        count += 1;
    }

    if count == 0 {
        return Err(FusedRationalFailureV1::Unbalanced);
    }
    Ok(count)
}

#[cfg(test)]
#[path = "fused_rational_v1_tests.rs"]
mod tests;
