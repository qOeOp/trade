//! What one published catalog version fixes, and which versions this kernel publishes.
//!
//! A frozen program names a version, so every check that decides it has to be able to reach that
//! version's own rows, semantic IDs and goldens rather than whichever set happens to be compiled
//! newest. Holding them together in one value is what makes that possible: a later version selects
//! a different table here and changes nothing about an earlier one.

use crate::{
    CatalogRowV1,
    catalog_rows::ROWS,
    catalog_rows_v2::ROWS_V2,
    catalog_rows_v3::ROWS_V3,
    golden_corpus::GOLDENS,
    golden_corpus_v2::GOLDENS_V2,
    golden_corpus_v3::GOLDENS_V3,
    required_golden_ids_v2::{
        CATALOG_SEMANTIC_IDS_V2, EXECUTABLE_PRIMITIVE_IDS_V2, REQUIRED_GOLDEN_IDS_V2,
    },
    required_golden_ids_v3::{
        CATALOG_SEMANTIC_IDS_V3, EXECUTABLE_PRIMITIVE_IDS_V3, REQUIRED_GOLDEN_IDS_V3,
    },
};

/// Upper bound on the golden vectors one version may declare.
///
/// The kernel is `no_std` with no allocator, so corpus verification decodes into one bounded array.
/// A version declaring more refuses rather than verifying part of its corpus.
pub(crate) const MAX_GOLDEN_VECTORS_V1: usize = 256;

/// The complete content of one published catalog version.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CatalogVersionV1 {
    pub(crate) semantic_version: u16,
    pub(crate) rows: &'static [CatalogRowV1],
    pub(crate) semantic_ids: &'static [&'static str],
    pub(crate) executable_ids: &'static [&'static str],
    pub(crate) goldens: &'static [&'static [u8]],
    pub(crate) required_golden_ids: &'static [&'static str],
    /// Declared row composition as `[policy, primitive, lifecycle]`.
    ///
    /// Each version states the shape of its own row set, so a row silently changing kind is caught
    /// rather than absorbed.
    pub(crate) kind_counts: [u32; 3],
}

const VERSION_1: CatalogVersionV1 = CatalogVersionV1 {
    semantic_version: 1,
    rows: &ROWS,
    semantic_ids: &crate::CATALOG_SEMANTIC_IDS_V1,
    executable_ids: &crate::EXECUTABLE_PRIMITIVE_IDS_V1,
    goldens: &GOLDENS,
    required_golden_ids: &crate::REQUIRED_GOLDEN_IDS_V1,
    kind_counts: [6, 36, 15],
};

/// Version 2 adds the fused rational primitive and changes nothing else.
///
/// Its rows and name sets are spliced from version 1's rather than restated, and its corpus
/// references version 1's vector files unchanged, so publishing it leaves version 1 byte-identical.
const VERSION_2: CatalogVersionV1 = CatalogVersionV1 {
    semantic_version: 2,
    rows: &ROWS_V2,
    semantic_ids: &CATALOG_SEMANTIC_IDS_V2,
    executable_ids: &EXECUTABLE_PRIMITIVE_IDS_V2,
    goldens: &GOLDENS_V2,
    required_golden_ids: &REQUIRED_GOLDEN_IDS_V2,
    kind_counts: [6, 38, 15],
};

/// Version 3 adds the fixed-point square root and changes nothing else.
///
/// Its rows and name sets are spliced from version 2's rather than restated, and its corpus
/// references the earlier vector files unchanged, so publishing it leaves versions 1 and 2
/// byte-identical.
const VERSION_3: CatalogVersionV1 = CatalogVersionV1 {
    semantic_version: 3,
    rows: &ROWS_V3,
    semantic_ids: &CATALOG_SEMANTIC_IDS_V3,
    executable_ids: &EXECUTABLE_PRIMITIVE_IDS_V3,
    goldens: &GOLDENS_V3,
    required_golden_ids: &REQUIRED_GOLDEN_IDS_V3,
    kind_counts: [6, 40, 15],
};

/// Every version this kernel publishes, ascending by semantic version.
///
/// `newest()` reads the last entry, so adding one here is also the change that makes a freshly
/// minted program resolve the new version.
pub(crate) const PUBLISHED_V1: [&CatalogVersionV1; 3] = [&VERSION_1, &VERSION_2, &VERSION_3];

/// Resolves one published version's content, or `None` when this kernel does not publish it.
pub(crate) fn published(semantic_version: u16) -> Option<&'static CatalogVersionV1> {
    let mut index = 0;

    while index < PUBLISHED_V1.len() {
        let version = PUBLISHED_V1[index];

        if version.semantic_version == semantic_version {
            return Some(version);
        }
        index += 1;
    }
    None
}

/// The newest published version, which is what minting a fresh program resolves.
pub(crate) fn newest() -> &'static CatalogVersionV1 {
    PUBLISHED_V1[PUBLISHED_V1.len() - 1]
}
