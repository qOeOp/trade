//! Version 4's row table: version 3's closed set plus two bar counts and a percent rank over a
//! trailing window.
//!
//! Version 4 is derived from version 3 rather than restated, as each earlier version was derived
//! from its predecessor: the earlier rows are pinned by their semantic digests, so deriving from
//! them cannot drift. The new rows join by semantic-ID byte order, the order every version keeps.

use crate::{
    RoundingMode,
    catalog_contract::{CatalogRowKindV1 as Kind, CatalogRowV1, PrimitiveOperationV1 as Op},
    catalog_rows_v3::ROWS_V3,
};

/// Version 4's rows, in semantic-ID byte order.
const WINDOW_RANKS: [CatalogRowV1; 4] = [
    CatalogRowV1 {
        semantic_id: "bfp.rolling.bars-since-max.full-window.latest-tie.v1",
        kind: Kind::Primitive,
        operation: Some(Op::BarsSinceMaximum),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.bars-since-min.full-window.latest-tie.v1",
        kind: Kind::Primitive,
        operation: Some(Op::BarsSinceMinimum),
        rounding: None,
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.percent-rank.full-window.midrank.nearest-ties-to-even.v1",
        kind: Kind::Primitive,
        operation: Some(Op::PercentRank),
        rounding: Some(RoundingMode::NearestTiesToEven),
    },
    CatalogRowV1 {
        semantic_id: "bfp.rolling.percent-rank.full-window.midrank.toward-zero.v1",
        kind: Kind::Primitive,
        operation: Some(Op::PercentRank),
        rounding: Some(RoundingMode::TowardZero),
    },
];

pub(super) const ROWS_V4: [CatalogRowV1; 65] = merge(ROWS_V3, WINDOW_RANKS);

/// Merges two semantic-ID-ordered row lists into one, keeping that order.
const fn merge(base: [CatalogRowV1; 61], extra: [CatalogRowV1; 4]) -> [CatalogRowV1; 65] {
    let mut rows = [base[0]; 65];
    let (mut from_base, mut from_extra, mut index) = (0, 0, 0);

    while index < 65 {
        let take_extra = from_base == 61
            || (from_extra < 4
                && bytes_less(
                    extra[from_extra].semantic_id.as_bytes(),
                    base[from_base].semantic_id.as_bytes(),
                ));

        if take_extra {
            rows[index] = extra[from_extra];
            from_extra += 1;
        } else {
            rows[index] = base[from_base];
            from_base += 1;
        }
        index += 1;
    }
    rows
}

pub(super) const fn bytes_less(left: &[u8], right: &[u8]) -> bool {
    let mut index = 0;

    while index < left.len() && index < right.len() {
        if left[index] != right[index] {
            return left[index] < right[index];
        }
        index += 1;
    }
    left.len() < right.len()
}
