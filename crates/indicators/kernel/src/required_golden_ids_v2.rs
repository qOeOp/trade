//! Version 2's closed name sets, spliced from version 1's.
//!
//! Version 1's lists are pinned through its semantic digest, so deriving from them cannot drift.

use crate::{CATALOG_SEMANTIC_IDS_V1, EXECUTABLE_PRIMITIVE_IDS_V1, REQUIRED_GOLDEN_IDS_V1};

const FUSED_PRIMITIVES: [&str; 2] = [
    "bfp.fused-rational.two-input.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fused-rational.two-input.i256-single-round.toward-zero.v1",
];

const FUSED_GOLDENS: [&str; 2] = [
    "bfp.golden.primitive.fused-rational.two-input.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fused-rational.two-input.i256-single-round.toward-zero.v1.success.v1",
];

pub(super) const CATALOG_SEMANTIC_IDS_V2: [&str; 59] =
    splice::<57, 59>(CATALOG_SEMANTIC_IDS_V1, FUSED_PRIMITIVES, 22);
pub(super) const EXECUTABLE_PRIMITIVE_IDS_V2: [&str; 38] =
    splice::<36, 38>(EXECUTABLE_PRIMITIVE_IDS_V1, FUSED_PRIMITIVES, 21);
pub(super) const REQUIRED_GOLDEN_IDS_V2: [&str; 89] =
    splice::<87, 89>(REQUIRED_GOLDEN_IDS_V1, FUSED_GOLDENS, 34);

const fn splice<const BASE: usize, const OUT: usize>(
    base: [&'static str; BASE],
    extra: [&'static str; 2],
    at: usize,
) -> [&'static str; OUT] {
    let mut out = [base[0]; OUT];
    let mut index = 0;

    while index < OUT {
        out[index] = if index < at {
            base[index]
        } else if index < at + 2 {
            extra[index - at]
        } else {
            base[index - 2]
        };
        index += 1;
    }
    out
}
