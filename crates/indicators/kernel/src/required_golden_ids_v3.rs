//! Version 3's closed name sets, spliced from version 2's.
//!
//! Version 2's lists are themselves spliced from version 1's and both are pinned through their
//! semantic digests, so deriving from them cannot drift.

use crate::{
    catalog_rows_v2::ROWS_V2,
    required_golden_ids_v2::{
        CATALOG_SEMANTIC_IDS_V2, EXECUTABLE_PRIMITIVE_IDS_V2, REQUIRED_GOLDEN_IDS_V2,
    },
};

const SQRT_PRIMITIVES: [&str; 2] = [
    "bfp.fixed-i128.sqrt.max-scale-38.i256-single-round.nearest-ties-to-even.v1",
    "bfp.fixed-i128.sqrt.max-scale-38.i256-single-round.toward-zero.v1",
];

const SQRT_GOLDENS: [&str; 2] = [
    "bfp.golden.primitive.fixed-i128.sqrt.max-scale-38.i256-single-round.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.fixed-i128.sqrt.max-scale-38.i256-single-round.toward-zero.v1.success.v1",
];

pub(super) const CATALOG_SEMANTIC_IDS_V3: [&str; 61] =
    splice::<59, 61>(CATALOG_SEMANTIC_IDS_V2, SQRT_PRIMITIVES, 20);
pub(super) const EXECUTABLE_PRIMITIVE_IDS_V3: [&str; 40] =
    splice::<38, 40>(EXECUTABLE_PRIMITIVE_IDS_V2, SQRT_PRIMITIVES, 19);
pub(super) const REQUIRED_GOLDEN_IDS_V3: [&str; 91] =
    splice::<89, 91>(REQUIRED_GOLDEN_IDS_V2, SQRT_GOLDENS, 32);

/// Keeps this module honest about what it splices into: the row table it mirrors.
const _: () = assert!(ROWS_V2.len() + 2 == CATALOG_SEMANTIC_IDS_V3.len());

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
