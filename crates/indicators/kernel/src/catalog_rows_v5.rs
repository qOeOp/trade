//! Version 5's row table and closed name sets: version 4's plus the position flip a program may
//! propose, the kernel intent that reverses a held position through zero in one order.
//!
//! Version 5 is derived from version 4 as each version was derived from its predecessor. The new
//! row is a lifecycle reference, which no golden vector is required by, so version 5's executable
//! primitives and its golden corpus are version 4's unchanged.

use crate::{
    catalog_contract::{CatalogRowKindV1 as Kind, CatalogRowV1},
    catalog_rows_v4::{ROWS_V4, bytes_less},
    required_golden_ids_v4::CATALOG_SEMANTIC_IDS_V4,
};

const FLIP: CatalogRowV1 = CatalogRowV1 {
    semantic_id: "kernel.position.flip.v1",
    kind: Kind::LifecycleReference,
    operation: None,
    rounding: None,
};

pub(super) const ROWS_V5: [CatalogRowV1; 66] = insert(ROWS_V4, FLIP, POSITION);
pub(super) const CATALOG_SEMANTIC_IDS_V5: [&str; 66] =
    insert(CATALOG_SEMANTIC_IDS_V4, FLIP.semantic_id, POSITION);

/// Where the flip joins version 4's semantic-ID byte order.
const POSITION: usize = {
    let mut index = 0;

    while index < 65
        && bytes_less(
            ROWS_V4[index].semantic_id.as_bytes(),
            FLIP.semantic_id.as_bytes(),
        )
    {
        index += 1;
    }
    index
};

/// Keeps the two lists this module derives naming the same rows in the same order.
const _: () = {
    let mut index = 0;

    while index < 66 {
        assert!(bytes_equal(
            ROWS_V5[index].semantic_id.as_bytes(),
            CATALOG_SEMANTIC_IDS_V5[index].as_bytes()
        ));
        index += 1;
    }
};

/// Inserts one entry into a list at `position`.
const fn insert<T: Copy>(base: [T; 65], extra: T, position: usize) -> [T; 66] {
    let mut out = [extra; 66];
    let mut index = 0;

    while index < 65 {
        out[if index < position { index } else { index + 1 }] = base[index];
        index += 1;
    }
    out
}

const fn bytes_equal(left: &[u8], right: &[u8]) -> bool {
    !bytes_less(left, right) && !bytes_less(right, left)
}
