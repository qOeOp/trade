//! Version 3's row table: version 2's closed set plus the fixed-point square root.
//!
//! Version 3 is derived from version 2 rather than restated, for the same reason version 2 was
//! derived from version 1: the earlier rows are pinned by their semantic digest, so deriving from
//! them cannot drift. An edit there fails that pin before it reaches this table.

use crate::{
    RoundingMode,
    catalog_contract::{CatalogRowKindV1 as Kind, CatalogRowV1, PrimitiveOperationV1 as Op},
    catalog_rows_v2::ROWS_V2,
};

/// Where the square-root rows sort into version 2's set, by semantic-ID bytes.
///
/// Between `bfp.fixed-i128.select.…` and `bfp.fixed-i128.sub.…`. The identifier is spelled after
/// `rescale` rather than after the indicator rows because a square root is a fixed-point scalar
/// operation that declares its own output scale, not an indicator over a window.
const INSERT_AT: usize = 20;

const SQRT: [CatalogRowV1; 2] = [
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.sqrt.max-scale-38.i256-single-round.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Sqrt),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.fixed-i128.sqrt.max-scale-38.i256-single-round.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::Sqrt),
        rounding: Some(RoundingMode::TowardZero),
    },
];

pub(super) const ROWS_V3: [CatalogRowV1; 61] = splice(ROWS_V2, SQRT, INSERT_AT);

const fn splice(
    base: [CatalogRowV1; 59],
    extra: [CatalogRowV1; 2],
    at: usize,
) -> [CatalogRowV1; 61] {
    let mut rows = [base[0]; 61];
    let mut index = 0;

    while index < 61 {
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
