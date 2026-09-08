//! Sole closed V1 row-to-operation mapping, shared with the golden executor.

use crate::RoundingMode;
use crate::catalog_contract::{CatalogRowKindV1 as Kind, CatalogRowV1, PrimitiveOperationV1 as Op};

pub(super) const ROWS: [CatalogRowV1; 57] = [
    CatalogRowV1 {
        semantic_id: "bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Atr),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.atr.true-range.wilder-first-sample.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Atr),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.availability.warming-ready.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.candle.body-magnitude.ohlc-validated.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Body),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.candle.gap-signed.previous-close.ohlc-validated.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Gap),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.candle.lower-wick.ohlc-validated.v1",
        kind: Kind::Primitive,
        operation: Some(Op::LowerWick),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.candle.range.ohlc-validated.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Range),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.candle.upper-wick.ohlc-validated.v1",
        kind: Kind::Primitive,
        operation: Some(Op::UpperWick),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Ema),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Ema),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Add),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Add),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.compare.equal-scale.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Compare),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Div),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Div),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Mul),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Mul),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Rescale),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Rescale),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.select.equal-scale.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Select),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Sub),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Sub),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.lag.coordinate.offset.full-history.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Lag),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.numeric.failure.no-state-change.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Fraction),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.range-fraction.closed-unit-rational.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Fraction),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.max.full-window.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Maximum),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.mean.full-window.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Mean),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.mean.full-window.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Mean),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.min.full-window.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Minimum),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.sum.full-window.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Sum),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.round.nearest-ties-to-even.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.round.toward-zero.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Rsi),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Rsi),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "bfp.state.post.fixed-canonical.v1",
        kind: Kind::Policy,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1",
        kind: Kind::Primitive,
        operation: Some(Op::SwingHigh),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1",
        kind: Kind::Primitive,
        operation: Some(Op::SwingLow),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.true-range.ohlc.first-high-low.v1",
        kind: Kind::Primitive,
        operation: Some(Op::TrueRange),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Wilder),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Wilder),
        rounding: Some(RoundingMode::TowardZero),
    },
    CatalogRowV1 {
        semantic_id: "kernel.position.add.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.position.enter.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.position.exit.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.position.hold.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.position.reduce.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.clear.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.keep.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.replace.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.stop-loss.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.take-profit.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.protection.trailing-adjust.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.target.keep.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.target.position.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.target.rebalance.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "kernel.target.weight.v1",
        kind: Kind::LifecycleReference,
        operation: None,
        rounding: None,
    },
];

/// Exact lookup only; a row is a contract, not proof of complete catalog verification.
#[must_use]
pub(super) fn catalog_row_v1(semantic_id: &str) -> Option<&'static CatalogRowV1> {
    ROWS.binary_search_by_key(&semantic_id, |row| row.semantic_id)
        .ok()
        .map(|index| &ROWS[index])
}
