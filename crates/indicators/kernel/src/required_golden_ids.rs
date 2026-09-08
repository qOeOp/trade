//! Closed V1 names only. Formula/state metadata and executed goldens remain separate admission requirements.

use crate::{BoundedFeatureGoldenVectorV1, RoundingMode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoldenSetFailure {
    WrongCount,
    UnknownVector,
    DuplicateVector,
    UnknownPrimitive,
    WrongSuccessPrimitive,
    WrongSuccessRounding,
}

/// Checks closed name coverage and per-primitive success bindings only.
///
/// It does not execute vectors, validate their frame/state semantics, or issue a catalog digest.
pub fn validate_required_golden_ids(
    vectors: &[BoundedFeatureGoldenVectorV1<'_>],
) -> Result<(), GoldenSetFailure> {
    if vectors.len() != REQUIRED_GOLDEN_IDS_V1.len() {
        return Err(GoldenSetFailure::WrongCount);
    }

    let mut seen = [false; REQUIRED_GOLDEN_IDS_V1.len()];

    for vector in vectors {
        let parts = vector.parts();
        let index = REQUIRED_GOLDEN_IDS_V1
            .binary_search(&parts.vector_id)
            .map_err(|_| GoldenSetFailure::UnknownVector)?;

        if seen[index] {
            return Err(GoldenSetFailure::DuplicateVector);
        }

        seen[index] = true;

        if EXECUTABLE_PRIMITIVE_IDS_V1
            .binary_search(&parts.primitive_id)
            .is_err()
        {
            return Err(GoldenSetFailure::UnknownPrimitive);
        }

        if let Some(suffix) = parts.vector_id.strip_prefix("bfp.golden.primitive.") {
            if suffix.strip_suffix(".success.v1") != parts.primitive_id.strip_prefix("bfp.") {
                return Err(GoldenSetFailure::WrongSuccessPrimitive);
            }

            let expected = if parts.primitive_id.ends_with(".toward-zero.v1") {
                Some(RoundingMode::TowardZero)
            } else if parts.primitive_id.ends_with(".nearest-ties-to-even.v1") {
                Some(RoundingMode::NearestTiesToEven)
            } else {
                None
            };

            if parts.rounding != expected {
                return Err(GoldenSetFailure::WrongSuccessRounding);
            }
        }
    }

    Ok(())
}

pub const CATALOG_SEMANTIC_IDS_V1: [&str; 57] = [
    "bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1",
    "bfp.atr.true-range.wilder-first-sample.toward-zero.v1",
    "bfp.availability.warming-ready.v1",
    "bfp.candle.body-magnitude.ohlc-validated.v1",
    "bfp.candle.gap-signed.previous-close.ohlc-validated.v1",
    "bfp.candle.lower-wick.ohlc-validated.v1",
    "bfp.candle.range.ohlc-validated.v1",
    "bfp.candle.upper-wick.ohlc-validated.v1",
    "bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1",
    "bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1",
    "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.compare.equal-scale.v1",
    "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.select.equal-scale.v1",
    "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.lag.coordinate.offset.full-history.v1",
    "bfp.numeric.failure.no-state-change.v1",
    "bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1",
    "bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1",
    "bfp.range-fraction.closed-unit-rational.toward-zero.v1",
    "bfp.rolling.max.full-window.v1",
    "bfp.rolling.mean.full-window.nearest-ties-to-even.v1",
    "bfp.rolling.mean.full-window.toward-zero.v1",
    "bfp.rolling.min.full-window.v1",
    "bfp.rolling.sum.full-window.v1",
    "bfp.round.nearest-ties-to-even.v1",
    "bfp.round.toward-zero.v1",
    "bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1",
    "bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1",
    "bfp.state.post.fixed-canonical.v1",
    "bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1",
    "bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1",
    "bfp.true-range.ohlc.first-high-low.v1",
    "bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1",
    "bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1",
    "kernel.position.add.v1",
    "kernel.position.enter.v1",
    "kernel.position.exit.v1",
    "kernel.position.hold.v1",
    "kernel.position.reduce.v1",
    "kernel.protection.clear.v1",
    "kernel.protection.keep.v1",
    "kernel.protection.replace.v1",
    "kernel.protection.stop-loss.v1",
    "kernel.protection.take-profit.v1",
    "kernel.protection.trailing-adjust.v1",
    "kernel.target.keep.v1",
    "kernel.target.position.v1",
    "kernel.target.rebalance.v1",
    "kernel.target.weight.v1",
];

pub const EXECUTABLE_PRIMITIVE_IDS_V1: [&str; 36] = [
    "bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1",
    "bfp.atr.true-range.wilder-first-sample.toward-zero.v1",
    "bfp.candle.body-magnitude.ohlc-validated.v1",
    "bfp.candle.gap-signed.previous-close.ohlc-validated.v1",
    "bfp.candle.lower-wick.ohlc-validated.v1",
    "bfp.candle.range.ohlc-validated.v1",
    "bfp.candle.upper-wick.ohlc-validated.v1",
    "bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1",
    "bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1",
    "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.compare.equal-scale.v1",
    "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1",
    "bfp.fixed-i128.select.equal-scale.v1",
    "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
    "bfp.lag.coordinate.offset.full-history.v1",
    "bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1",
    "bfp.range-fraction.closed-unit-rational.toward-zero.v1",
    "bfp.rolling.max.full-window.v1",
    "bfp.rolling.mean.full-window.nearest-ties-to-even.v1",
    "bfp.rolling.mean.full-window.toward-zero.v1",
    "bfp.rolling.min.full-window.v1",
    "bfp.rolling.sum.full-window.v1",
    "bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1",
    "bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1",
    "bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1",
    "bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1",
    "bfp.true-range.ohlc.first-high-low.v1",
    "bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1",
    "bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1",
];

pub const REQUIRED_GOLDEN_IDS_V1: [&str; 87] = [
    "bfp.golden.atr-period-3.first-ready.v1",
    "bfp.golden.ema-period-3.first-ready.v1",
    "bfp.golden.gap.before-ready.v1",
    "bfp.golden.gap.first-ready.v1",
    "bfp.golden.numeric.divide-by-zero.state-byte-identity.v1",
    "bfp.golden.numeric.final-i128-overflow.state-byte-identity.v1",
    "bfp.golden.numeric.i256-overflow.state-byte-identity.v1",
    "bfp.golden.numeric.invalid-scale.state-byte-identity.v1",
    "bfp.golden.numeric.min-div-negative-one.state-byte-identity.v1",
    "bfp.golden.numeric.remainder-without-rounding.state-byte-identity.v1",
    "bfp.golden.numeric.scale-mismatch.state-byte-identity.v1",
    "bfp.golden.numeric.wide-fit-after-scale.v1",
    "bfp.golden.ohlc.ordering-violation.state-byte-identity.v1",
    "bfp.golden.primitive.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.atr.true-range.wilder-first-sample.toward-zero.v1.success.v1",
    "bfp.golden.primitive.candle.body-magnitude.ohlc-validated.v1.success.v1",
    "bfp.golden.primitive.candle.gap-signed.previous-close.ohlc-validated.v1.success.v1",
    "bfp.golden.primitive.candle.lower-wick.ohlc-validated.v1.success.v1",
    "bfp.golden.primitive.candle.range.ohlc-validated.v1.success.v1",
    "bfp.golden.primitive.candle.upper-wick.ohlc-validated.v1.success.v1",
    "bfp.golden.primitive.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.compare.equal-scale.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.select.equal-scale.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1.success.v1",
    "bfp.golden.primitive.lag.coordinate.offset.full-history.v1.success.v1",
    "bfp.golden.primitive.range-fraction.closed-unit-rational.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.range-fraction.closed-unit-rational.toward-zero.v1.success.v1",
    "bfp.golden.primitive.rolling.max.full-window.v1.success.v1",
    "bfp.golden.primitive.rolling.mean.full-window.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.rolling.mean.full-window.toward-zero.v1.success.v1",
    "bfp.golden.primitive.rolling.min.full-window.v1.success.v1",
    "bfp.golden.primitive.rolling.sum.full-window.v1.success.v1",
    "bfp.golden.primitive.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.rsi.period-deltas.wilder.flat-50.toward-zero.v1.success.v1",
    "bfp.golden.primitive.swing-high.trailing-full-window.latest-coordinate-tie.v1.success.v1",
    "bfp.golden.primitive.swing-low.trailing-full-window.latest-coordinate-tie.v1.success.v1",
    "bfp.golden.primitive.true-range.ohlc.first-high-low.v1.success.v1",
    "bfp.golden.primitive.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.wilder.first-sample.alpha-1-over-period.toward-zero.v1.success.v1",
    "bfp.golden.range-fraction.above-one.v1",
    "bfp.golden.range-fraction.denominator-zero.v1",
    "bfp.golden.range-fraction.low-above-high.v1",
    "bfp.golden.range-fraction.non-reduced-rational.v1",
    "bfp.golden.round.nearest-ties-to-even.negative.even-half.v1",
    "bfp.golden.round.nearest-ties-to-even.negative.odd-half.v1",
    "bfp.golden.round.nearest-ties-to-even.positive.even-half.v1",
    "bfp.golden.round.nearest-ties-to-even.positive.odd-half.v1",
    "bfp.golden.round.toward-zero.negative.even-half.v1",
    "bfp.golden.round.toward-zero.negative.odd-half.v1",
    "bfp.golden.round.toward-zero.positive.even-half.v1",
    "bfp.golden.round.toward-zero.positive.odd-half.v1",
    "bfp.golden.rsi.flat-50.v1",
    "bfp.golden.rsi.zero-gain-0.v1",
    "bfp.golden.rsi.zero-loss-100.v1",
    "bfp.golden.sample.equal-value-new-advance.v1",
    "bfp.golden.sample.same-no-advance.v1",
    "bfp.golden.swing-high.latest-coordinate-tie.v1",
    "bfp.golden.swing-low.latest-coordinate-tie.v1",
    "bfp.golden.true-range.first.v1",
    "bfp.golden.true-range.previous-close.v1",
    "bfp.golden.warm-up.lag-offset-2.before-ready.v1",
    "bfp.golden.warm-up.lag-offset-2.first-ready.v1",
    "bfp.golden.warm-up.rolling-max-window-3.before-ready.v1",
    "bfp.golden.warm-up.rolling-max-window-3.first-ready.v1",
    "bfp.golden.warm-up.rolling-mean-window-3.before-ready.v1",
    "bfp.golden.warm-up.rolling-mean-window-3.first-ready.v1",
    "bfp.golden.warm-up.rolling-min-window-3.before-ready.v1",
    "bfp.golden.warm-up.rolling-min-window-3.first-ready.v1",
    "bfp.golden.warm-up.rolling-sum-window-3.before-ready.v1",
    "bfp.golden.warm-up.rolling-sum-window-3.first-ready.v1",
    "bfp.golden.warm-up.rsi-period-3.before-ready.v1",
    "bfp.golden.warm-up.rsi-period-3.first-ready.v1",
    "bfp.golden.warm-up.swing-high-window-3.before-ready.v1",
    "bfp.golden.warm-up.swing-high-window-3.first-ready.v1",
    "bfp.golden.warm-up.swing-low-window-3.before-ready.v1",
    "bfp.golden.warm-up.swing-low-window-3.first-ready.v1",
    "bfp.golden.wilder-period-3.first-ready.v1",
];

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use crate::{GoldenVectorPartsV1, GoldenVectorTerminalV1};
    use std::{borrow::ToOwned, vec, vec::Vec};

    // Name-only fixtures deliberately contain no executable oracle payload.
    fn encode(id: &str, primitive: &str, rounding: Option<RoundingMode>) -> Vec<u8> {
        let parts = GoldenVectorPartsV1 {
            vector_id: id,
            primitive_id: primitive,
            rounding,
            terminal: GoldenVectorTerminalV1::Ready,
            pre_state: &[],
            input: &[],
            expected_output: &[],
            post_state: &[],
        };
        let mut bytes = vec![0; parts.encoded_len().unwrap()];
        parts.encode_into(&mut bytes).unwrap();
        bytes
    }

    fn fixtures() -> Vec<Vec<u8>> {
        REQUIRED_GOLDEN_IDS_V1
            .iter()
            .map(|id| {
                let primitive = if let Some(suffix) = id.strip_prefix("bfp.golden.primitive.") {
                    EXECUTABLE_PRIMITIVE_IDS_V1
                        .iter()
                        .copied()
                        .find(|primitive| {
                            primitive.strip_prefix("bfp.") == suffix.strip_suffix(".success.v1")
                        })
                        .unwrap()
                } else {
                    EXECUTABLE_PRIMITIVE_IDS_V1[0]
                };
                let rounding = if primitive.ends_with(".toward-zero.v1") {
                    Some(RoundingMode::TowardZero)
                } else if primitive.ends_with(".nearest-ties-to-even.v1") {
                    Some(RoundingMode::NearestTiesToEven)
                } else {
                    None
                };
                encode(id, primitive, rounding)
            })
            .collect()
    }

    fn check(bytes: &[Vec<u8>]) -> Result<(), GoldenSetFailure> {
        let vectors: Vec<_> = bytes
            .iter()
            .map(|bytes| BoundedFeatureGoldenVectorV1::decode(bytes).unwrap())
            .collect();
        validate_required_golden_ids(&vectors)
    }

    #[rstest::rstest]
    fn complete_name_coverage_is_order_independent_not_execution_proof() {
        for ids in [
            &CATALOG_SEMANTIC_IDS_V1[..],
            &EXECUTABLE_PRIMITIVE_IDS_V1[..],
            &REQUIRED_GOLDEN_IDS_V1[..],
        ] {
            assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
        }
        let mut bytes = fixtures();
        assert_eq!(check(&bytes), Ok(()));
        bytes.reverse();
        assert_eq!(check(&bytes), Ok(()));
    }

    #[rstest::rstest]
    fn missing_extra_duplicate_and_unknown_names_fail_closed() {
        let mut bytes = fixtures();
        assert_eq!(check(&bytes[..86]), Err(GoldenSetFailure::WrongCount));
        bytes.push(bytes[0].clone());
        assert_eq!(check(&bytes), Err(GoldenSetFailure::WrongCount));
        bytes.pop();
        bytes[1] = bytes[0].clone();
        assert_eq!(check(&bytes), Err(GoldenSetFailure::DuplicateVector));
        bytes[0] = encode("unknown", EXECUTABLE_PRIMITIVE_IDS_V1[0], None);
        assert_eq!(check(&bytes), Err(GoldenSetFailure::UnknownVector));
    }

    #[rstest::rstest]
    fn success_vectors_bind_executable_primitive_and_rounding() {
        let index = REQUIRED_GOLDEN_IDS_V1
            .iter()
            .position(|id| id.starts_with("bfp.golden.primitive."))
            .unwrap();
        let mut bytes = fixtures();
        let original = BoundedFeatureGoldenVectorV1::decode(&bytes[index])
            .unwrap()
            .parts();
        let id = original.vector_id.to_owned();
        let primitive = original.primitive_id.to_owned();
        let rounding = original.rounding;
        bytes[index] = encode(&id, "bfp.numeric.failure.no-state-change.v1", rounding);
        assert_eq!(check(&bytes), Err(GoldenSetFailure::UnknownPrimitive));
        let different = EXECUTABLE_PRIMITIVE_IDS_V1
            .iter()
            .copied()
            .find(|value| *value != primitive)
            .unwrap();
        bytes[index] = encode(&id, different, rounding);
        assert_eq!(check(&bytes), Err(GoldenSetFailure::WrongSuccessPrimitive));
        let different_rounding = if rounding.is_some() {
            None
        } else {
            Some(RoundingMode::TowardZero)
        };
        bytes[index] = encode(&id, &primitive, different_rounding);
        assert_eq!(check(&bytes), Err(GoldenSetFailure::WrongSuccessRounding));
    }
}
