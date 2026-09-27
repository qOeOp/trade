//! Version 4's closed name sets, merged from version 3's in semantic-ID byte order.
//!
//! Version 3's lists are themselves derived from the earlier versions', and every version is
//! pinned through its semantic digest, so deriving from them cannot drift.

use crate::{
    catalog_rows_v3::ROWS_V3,
    catalog_rows_v4::bytes_less,
    required_golden_ids_v3::{
        CATALOG_SEMANTIC_IDS_V3, EXECUTABLE_PRIMITIVE_IDS_V3, REQUIRED_GOLDEN_IDS_V3,
    },
};

const WINDOW_RANK_PRIMITIVES: [&str; 4] = [
    "bfp.rolling.bars-since-max.full-window.latest-tie.v1",
    "bfp.rolling.bars-since-min.full-window.latest-tie.v1",
    "bfp.rolling.percent-rank.full-window.midrank.nearest-ties-to-even.v1",
    "bfp.rolling.percent-rank.full-window.midrank.toward-zero.v1",
];

const WINDOW_RANK_GOLDENS: [&str; 4] = [
    "bfp.golden.primitive.rolling.bars-since-max.full-window.latest-tie.v1.success.v1",
    "bfp.golden.primitive.rolling.bars-since-min.full-window.latest-tie.v1.success.v1",
    "bfp.golden.primitive.rolling.percent-rank.full-window.midrank.nearest-ties-to-even.v1.success.v1",
    "bfp.golden.primitive.rolling.percent-rank.full-window.midrank.toward-zero.v1.success.v1",
];

pub(super) const CATALOG_SEMANTIC_IDS_V4: [&str; 65] =
    merge::<61, 65>(CATALOG_SEMANTIC_IDS_V3, WINDOW_RANK_PRIMITIVES);
pub(super) const EXECUTABLE_PRIMITIVE_IDS_V4: [&str; 44] =
    merge::<40, 44>(EXECUTABLE_PRIMITIVE_IDS_V3, WINDOW_RANK_PRIMITIVES);
pub(super) const REQUIRED_GOLDEN_IDS_V4: [&str; 95] =
    merge::<91, 95>(REQUIRED_GOLDEN_IDS_V3, WINDOW_RANK_GOLDENS);

/// Keeps this module honest about what it merges into: the row table it mirrors.
const _: () = assert!(ROWS_V3.len() + 4 == CATALOG_SEMANTIC_IDS_V4.len());

/// Merges two byte-ordered name lists into one, keeping that order.
const fn merge<const BASE: usize, const OUT: usize>(
    base: [&'static str; BASE],
    extra: [&'static str; 4],
) -> [&'static str; OUT] {
    let mut out = [base[0]; OUT];
    let (mut from_base, mut from_extra, mut index) = (0, 0, 0);

    while index < OUT {
        let take_extra = from_base == BASE
            || (from_extra < 4
                && bytes_less(extra[from_extra].as_bytes(), base[from_base].as_bytes()));
        if take_extra {
            out[index] = extra[from_extra];
            from_extra += 1;
        } else {
            out[index] = base[from_base];
            from_base += 1;
        }
        index += 1;
    }
    out
}
