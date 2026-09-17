//! What one published catalog version fixes, and which versions this kernel publishes.
//!
//! A frozen program names a version, so every check that decides it has to be able to reach that
//! version's own rows, semantic IDs and goldens rather than whichever set happens to be compiled
//! newest. Holding them together in one value is what makes that possible: a later version selects
//! a different table here and changes nothing about an earlier one.

use crate::{CatalogRowV1, catalog_rows::ROWS, golden_corpus::GOLDENS};

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
}

const VERSION_1: CatalogVersionV1 = CatalogVersionV1 {
    semantic_version: 1,
    rows: &ROWS,
    semantic_ids: &crate::CATALOG_SEMANTIC_IDS_V1,
    executable_ids: &crate::EXECUTABLE_PRIMITIVE_IDS_V1,
    goldens: &GOLDENS,
    required_golden_ids: &crate::REQUIRED_GOLDEN_IDS_V1,
};

/// Every version this kernel publishes, ascending by semantic version.
pub(crate) const PUBLISHED_V1: [&CatalogVersionV1; 1] = [&VERSION_1];

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
