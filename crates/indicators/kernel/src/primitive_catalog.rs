//! Atomic identity for the complete compiled kernel catalog, never caller-supplied row metadata.

use sha2::{Digest as _, Sha256};

use crate::{
    BoundedFeatureGoldenVectorV1, CATALOG_SEMANTIC_IDS_V1, CatalogRowKindV1, CatalogRowV1,
    EXECUTABLE_PRIMITIVE_IDS_V1, GoldenVectorPartsV1, GoldenVectorTerminalV1,
    REQUIRED_GOLDEN_IDS_V1, RoundingMode, catalog_rows::ROWS, golden_corpus::GOLDENS,
    verify_required_golden_corpus_v1,
};

const DOMAIN: &[u8] = b"bfp.primitive-catalog.v1\0";
const HEADER: &[u8; 12] = b"BFPC\x01\0\0\0\x01\0\0\0";
const SOURCES: [(&str, &[u8]); 16] = [
    ("Cargo.toml", include_bytes!("../Cargo.toml")),
    ("catalog_contract.rs", include_bytes!("catalog_contract.rs")),
    ("catalog_rows.rs", include_bytes!("catalog_rows.rs")),
    ("fixed_bar_state.rs", include_bytes!("fixed_bar_state.rs")),
    ("fixed_features.rs", include_bytes!("fixed_features.rs")),
    ("fixed_i128.rs", include_bytes!("fixed_i128.rs")),
    ("fixed_rsi_state.rs", include_bytes!("fixed_rsi_state.rs")),
    ("fixed_state.rs", include_bytes!("fixed_state.rs")),
    ("fixed_window.rs", include_bytes!("fixed_window.rs")),
    ("golden_corpus.rs", include_bytes!("golden_corpus.rs")),
    ("golden_execution.rs", include_bytes!("golden_execution.rs")),
    ("golden_vector.rs", include_bytes!("golden_vector.rs")),
    ("i256.rs", include_bytes!("i256.rs")),
    ("lib.rs", include_bytes!("lib.rs")),
    (
        "primitive_catalog.rs",
        include_bytes!("primitive_catalog.rs"),
    ),
    (
        "required_golden_ids.rs",
        include_bytes!("required_golden_ids.rs"),
    ),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrimitiveCatalogFailure {
    InvalidRows,
    InvalidContract,
    InvalidGoldens,
    GoldenExecutionFailed,
    InvalidSourceSet,
    LengthOverflow,
    InvalidBufferLength,
    NonCanonicalCatalog,
}

/// Only the complete compiled catalog can construct this verification result.
/// It carries no Research, build, Artifact, Owner-receipt or execution authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PrimitiveCatalogV1 {
    identity: [u8; 32],
    canonical_len: usize,
}

impl PrimitiveCatalogV1 {
    pub fn verify() -> Result<Self, PrimitiveCatalogFailure> {
        validate_rows(&ROWS)?;
        validate_goldens()?;
        verify_required_golden_corpus_v1()
            .map_err(|_| PrimitiveCatalogFailure::GoldenExecutionFailed)?;
        let mut canonical_len = 0_usize;
        let mut hasher = Sha256::new();
        hasher.update(DOMAIN);
        emit_catalog(&mut |bytes| {
            canonical_len = canonical_len
                .checked_add(bytes.len())
                .ok_or(PrimitiveCatalogFailure::LengthOverflow)?;
            hasher.update(bytes);
            Ok(())
        })?;
        Ok(Self {
            identity: hasher.finalize().into(),
            canonical_len,
        })
    }

    /// Accepts exactly the complete catalog for the current pinned kernel, with no aliases.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, PrimitiveCatalogFailure> {
        let mut offset = 0;
        emit_catalog(&mut |expected| {
            let end = offset + expected.len();

            if bytes.get(offset..end) != Some(expected) {
                return Err(PrimitiveCatalogFailure::NonCanonicalCatalog);
            }

            offset = end;
            Ok(())
        })?;

        if offset != bytes.len() {
            return Err(PrimitiveCatalogFailure::NonCanonicalCatalog);
        }

        Self::verify()
    }

    #[must_use]
    pub const fn identity(self) -> [u8; 32] {
        self.identity
    }

    #[must_use]
    pub const fn canonical_len(self) -> usize {
        self.canonical_len
    }

    #[must_use]
    pub fn rows(self) -> &'static [CatalogRowV1; 57] {
        &ROWS
    }

    #[must_use]
    pub fn row(self, semantic_id: &str) -> Option<&'static CatalogRowV1> {
        crate::catalog_rows::catalog_row_v1(semantic_id)
    }

    /// A wrongly sized destination is rejected before any bytes are written.
    pub fn encode_into(self, bytes: &mut [u8]) -> Result<(), PrimitiveCatalogFailure> {
        if bytes.len() != self.canonical_len {
            return Err(PrimitiveCatalogFailure::InvalidBufferLength);
        }

        let mut offset = 0;
        emit_catalog(&mut |value| {
            let end = offset + value.len();
            bytes[offset..end].copy_from_slice(value);
            offset = end;
            Ok(())
        })
    }
}

type Sink<'a> = dyn FnMut(&[u8]) -> Result<(), PrimitiveCatalogFailure> + 'a;

fn validate_rows(rows: &[CatalogRowV1]) -> Result<(), PrimitiveCatalogFailure> {
    if rows.len() != CATALOG_SEMANTIC_IDS_V1.len() {
        return Err(PrimitiveCatalogFailure::InvalidRows);
    }

    let mut counts = [0_u32; 3];

    for (row, expected) in rows.iter().zip(CATALOG_SEMANTIC_IDS_V1) {
        if row.semantic_id != expected {
            return Err(PrimitiveCatalogFailure::InvalidRows);
        }
        let executable = EXECUTABLE_PRIMITIVE_IDS_V1
            .binary_search(&row.semantic_id)
            .is_ok();
        let kind = if executable {
            CatalogRowKindV1::Primitive
        } else if row.semantic_id.starts_with("kernel.") {
            CatalogRowKindV1::LifecycleReference
        } else {
            CatalogRowKindV1::Policy
        };

        if row.kind != kind || row.operation.is_some() != executable {
            return Err(PrimitiveCatalogFailure::InvalidRows);
        }

        let rounding = if row.semantic_id.ends_with(".toward-zero.v1") {
            Some(RoundingMode::TowardZero)
        } else if row.semantic_id.ends_with(".nearest-ties-to-even.v1") {
            Some(RoundingMode::NearestTiesToEven)
        } else {
            None
        };

        if row.rounding != rounding {
            return Err(PrimitiveCatalogFailure::InvalidContract);
        }
        let contract = row.contract();

        for field in [row.semantic_id, contract.formula, contract.state_encoding] {
            ascii_len(field)?;
        }

        counts[usize::from(row.kind.tag() - 1)] += 1;
    }

    if counts != [6, 36, 15] {
        return Err(PrimitiveCatalogFailure::InvalidRows);
    }
    Ok(())
}

fn vector(bytes: &[u8]) -> Result<BoundedFeatureGoldenVectorV1<'_>, PrimitiveCatalogFailure> {
    BoundedFeatureGoldenVectorV1::decode(bytes).map_err(|_| PrimitiveCatalogFailure::InvalidGoldens)
}

fn validate_goldens() -> Result<(), PrimitiveCatalogFailure> {
    for (bytes, expected) in GOLDENS.iter().zip(REQUIRED_GOLDEN_IDS_V1) {
        if vector(bytes)?.parts().vector_id != expected {
            return Err(PrimitiveCatalogFailure::InvalidGoldens);
        }
    }

    Ok(())
}

fn required_by(row: CatalogRowV1, parts: GoldenVectorPartsV1<'_>) -> bool {
    match row.kind {
        CatalogRowKindV1::Primitive => parts.primitive_id == row.semantic_id,
        CatalogRowKindV1::LifecycleReference => false,
        CatalogRowKindV1::Policy => match row.semantic_id {
            "bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1" => true,
            "bfp.round.toward-zero.v1" | "bfp.round.nearest-ties-to-even.v1" => {
                parts.rounding == row.rounding
            }
            "bfp.numeric.failure.no-state-change.v1" => matches!(
                parts.terminal,
                GoldenVectorTerminalV1::NumericFailureNoStateChange
                    | GoldenVectorTerminalV1::Unsupported
            ),
            "bfp.availability.warming-ready.v1" | "bfp.state.post.fixed-canonical.v1" => {
                !parts.pre_state.is_empty()
            }
            _ => false,
        },
    }
}

fn ascii_len(value: &str) -> Result<u16, PrimitiveCatalogFailure> {
    if value.is_empty() || !value.is_ascii() {
        return Err(PrimitiveCatalogFailure::InvalidContract);
    }
    u16::try_from(value.len()).map_err(|_| PrimitiveCatalogFailure::LengthOverflow)
}

fn emit_ascii(value: &str, sink: &mut Sink<'_>) -> Result<(), PrimitiveCatalogFailure> {
    sink(&ascii_len(value)?.to_le_bytes())?;
    sink(value.as_bytes())
}

fn emit_length(length: usize, sink: &mut Sink<'_>) -> Result<(), PrimitiveCatalogFailure> {
    sink(
        &u32::try_from(length)
            .map_err(|_| PrimitiveCatalogFailure::LengthOverflow)?
            .to_le_bytes(),
    )
}

fn emit_row(row: CatalogRowV1, sink: &mut Sink<'_>) -> Result<(), PrimitiveCatalogFailure> {
    let contract = row.contract();
    emit_ascii(row.semantic_id, sink)?;
    sink(&[
        row.kind.tag(),
        RoundingMode::optional_to_canonical_bytes(row.rounding)[0],
    ])?;
    sink(&contract.tags())?;
    emit_ascii(contract.formula, sink)?;
    emit_ascii(contract.state_encoding, sink)?;
    let mut count = 0_u32;

    for bytes in GOLDENS {
        if required_by(row, vector(bytes)?.parts()) {
            count += 1;
        }
    }

    if row.kind != CatalogRowKindV1::LifecycleReference && count == 0 {
        return Err(PrimitiveCatalogFailure::InvalidGoldens);
    }

    sink(&count.to_le_bytes())?;

    for bytes in GOLDENS {
        let golden = vector(bytes)?;

        if required_by(row, golden.parts()) {
            emit_ascii(golden.parts().vector_id, sink)?;
            sink(&golden.identity())?;
        }
    }

    Ok(())
}

fn source_identity() -> Result<[u8; 32], PrimitiveCatalogFailure> {
    if !SOURCES.windows(2).all(|pair| pair[0].0 < pair[1].0) {
        return Err(PrimitiveCatalogFailure::InvalidSourceSet);
    }

    let mut hasher = Sha256::new();
    hasher.update(b"bfp.kernel-source.v1\0");
    hasher.update((SOURCES.len() as u32).to_le_bytes());

    for (path, bytes) in SOURCES {
        if bytes.is_empty() {
            return Err(PrimitiveCatalogFailure::InvalidSourceSet);
        }
        emit_ascii(path, &mut |part| {
            hasher.update(part);
            Ok(())
        })?;
        emit_length(bytes.len(), &mut |part| {
            hasher.update(part);
            Ok(())
        })?;
        hasher.update(bytes);
    }

    Ok(hasher.finalize().into())
}

fn emit_catalog(sink: &mut Sink<'_>) -> Result<(), PrimitiveCatalogFailure> {
    sink(HEADER)?;
    sink(&source_identity()?)?;
    emit_length(ROWS.len(), sink)?;

    for row in ROWS {
        let mut length = 0_usize;
        emit_row(row, &mut |bytes| {
            length = length
                .checked_add(bytes.len())
                .ok_or(PrimitiveCatalogFailure::LengthOverflow)?;
            Ok(())
        })?;
        emit_length(length, sink)?;
        emit_row(row, sink)?;
    }

    emit_length(GOLDENS.len(), sink)?;

    for bytes in GOLDENS {
        emit_length(bytes.len(), sink)?;
        sink(bytes)?;
    }

    Ok(())
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;
