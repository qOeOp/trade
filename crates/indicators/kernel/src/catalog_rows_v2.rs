//! Version 2's row table: version 1's closed set plus the fused rational primitive.
//!
//! Version 2 is derived from version 1 rather than restated. Version 1's rows are pinned by their
//! semantic digest, so deriving from them cannot drift: an edit there fails that pin first.

use crate::{
    RoundingMode,
    catalog_contract::{CatalogRowKindV1 as Kind, CatalogRowV1, PrimitiveOperationV1 as Op},
    catalog_rows::ROWS,
};

/// Where the fused rows sort into version 1's set, by semantic-ID bytes.
const INSERT_AT: usize = 22;

const FUSED: [CatalogRowV1; 2] = [
    CatalogRowV1 {
        semantic_id: "bfp.fused-rational.two-input.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::FusedRational),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fused-rational.two-input.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::FusedRational),
        rounding: Some(RoundingMode::TowardZero),
    },
];

pub(super) const ROWS_V2: [CatalogRowV1; 59] = splice(ROWS, FUSED, INSERT_AT);

const fn splice(
    base: [CatalogRowV1; 57],
    extra: [CatalogRowV1; 2],
    at: usize,
) -> [CatalogRowV1; 59] {
    let mut rows = [base[0]; 59];
    let mut index = 0;

    while index < 59 {
        rows[index] = if index < at {
            base[index]
        } else if index < at + 2 {
            extra[index - at]
        } else {
            base[index - 2]
        };
        index += 1;
    }
    rows
}
