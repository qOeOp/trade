extern crate std;

use super::*;
use crate::{CatalogOutputRuleV1, PrimitiveOperationV1};
use std::vec;

use crate::golden_corpus::GOLDENS;

#[rstest::rstest]
fn complete_catalog_roundtrips_and_hashes_all_canonical_bytes() {
    let catalog = PrimitiveCatalogV1::resolve(1).unwrap();
    let mut bytes = vec![0; catalog.canonical_len()];
    catalog.encode_into(&mut bytes).unwrap();
    assert_eq!(&bytes[..12], b"BFPC\x01\0\0\0\x01\0\0\0");
    assert_eq!(u32::from_le_bytes(bytes[44..48].try_into().unwrap()), 57);
    assert_eq!(
        PrimitiveCatalogV1::from_canonical_bytes(&bytes),
        Ok(catalog)
    );
    let mut hasher = Sha256::new();
    hasher.update(b"bfp.primitive-catalog.v1\0");
    hasher.update(&bytes);
    assert_eq!(catalog.identity(), <[u8; 32]>::from(hasher.finalize()));
    let mut encoded = vec![0xff; bytes.len()];
    PrimitiveCatalogV1::from_canonical_bytes(&bytes)
        .unwrap()
        .encode_into(&mut encoded)
        .unwrap();
    assert_eq!(encoded, bytes);
}

#[rstest::rstest]
fn row_coverage_and_typed_comparison_are_closed() {
    let published = crate::catalog_version::published(1).unwrap();
    assert_eq!(validate_rows(published), Ok(()));

    // A version is refused when its rows no longer match its own declared semantic IDs: one short,
    // one long, or one duplicated.
    for rows in [
        &published.rows[..published.rows.len() - 1],
        &*std::boxed::Box::leak({
            let mut rows = published.rows.to_vec();
            rows.push(published.rows[0]);
            rows.into_boxed_slice()
        }),
        &*std::boxed::Box::leak({
            let mut rows = published.rows.to_vec();
            rows[1] = rows[0];
            rows.into_boxed_slice()
        }),
    ] {
        let mutated = crate::catalog_version::CatalogVersionV1 { rows, ..*published };
        assert_eq!(
            validate_rows(&mutated),
            Err(PrimitiveCatalogFailure::InvalidRows)
        );
    }
    let catalog = PrimitiveCatalogV1::verify().unwrap();
    assert!(catalog.row("bfp.unknown.v1").is_none());
    let compare = catalog
        .row("bfp.fixed-i128.compare.equal-scale.v1")
        .unwrap();
    assert_eq!(compare.operation, Some(PrimitiveOperationV1::Compare));
    assert_eq!(compare.contract().output, CatalogOutputRuleV1::Boolean);

    for semantic_id in [
        "kernel.protection.clear.v1",
        "kernel.protection.keep.v1",
        "kernel.protection.replace.v1",
        "kernel.target.keep.v1",
    ] {
        let lifecycle = catalog.row(semantic_id).unwrap();
        assert_eq!(lifecycle.kind, CatalogRowKindV1::LifecycleReference);
        assert_eq!(lifecycle.operation, None);
        assert_eq!(
            lifecycle.contract().output,
            CatalogOutputRuleV1::LifecycleReference
        );
    }

    for row in published.rows {
        let row = *row;
        let count = GOLDENS
            .iter()
            .filter(|bytes| required_by(row, vector(bytes).unwrap().parts()))
            .count();
        assert_eq!(count == 0, row.kind == CatalogRowKindV1::LifecycleReference);
        assert!(!row.contract().formula.is_empty());
        assert!(!row.contract().state_encoding.is_empty());
    }
}

#[rstest::rstest]
fn catalog_rejects_changed_rows_source_golden_and_envelope() {
    let catalog = PrimitiveCatalogV1::resolve(1).unwrap();
    let mut bytes = vec![0; catalog.canonical_len()];
    catalog.encode_into(&mut bytes).unwrap();
    let mut positions = vec![0, 4, 6, 8, 10, 12, 43, 44];
    let mut offset = 48;

    for _ in 0..57 {
        let length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        positions.push(offset);
        let row = offset + 4;
        let id_len = u16::from_le_bytes(bytes[row..row + 2].try_into().unwrap()) as usize;
        positions.push(row + 2);
        positions.extend(row + 2 + id_len..row + 2 + id_len + 10);
        let formula = row + 2 + id_len + 10;
        let formula_len =
            u16::from_le_bytes(bytes[formula..formula + 2].try_into().unwrap()) as usize;
        positions.extend([formula, formula + 2]);
        let layout = formula + 2 + formula_len;
        let layout_len = u16::from_le_bytes(bytes[layout..layout + 2].try_into().unwrap()) as usize;
        positions.extend([layout, layout + 2, layout + 2 + layout_len]);
        positions.push(row + length - 1);
        offset = row + length;
    }

    assert_eq!(
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
        87
    );
    positions.push(offset);
    offset += 4;

    for _ in 0..87 {
        let length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        positions.push(offset);
        positions.push(offset + 4);
        positions.push(offset + 3 + length);
        offset += 4 + length;
    }

    assert_eq!(offset, bytes.len());

    for position in positions {
        let mut changed = bytes.clone();
        changed[position] ^= 1;
        assert_eq!(
            PrimitiveCatalogV1::from_canonical_bytes(&changed),
            Err(PrimitiveCatalogFailure::NonCanonicalCatalog),
            "byte {position}"
        );
    }

    assert_eq!(
        PrimitiveCatalogV1::from_canonical_bytes(&bytes[..bytes.len() - 1]),
        Err(PrimitiveCatalogFailure::NonCanonicalCatalog)
    );
    bytes.push(0);
    assert_eq!(
        PrimitiveCatalogV1::from_canonical_bytes(&bytes),
        Err(PrimitiveCatalogFailure::NonCanonicalCatalog)
    );
}

#[rstest::rstest]
fn wrong_output_length_does_not_modify_destination() {
    let catalog = PrimitiveCatalogV1::verify().unwrap();

    for length in [0, catalog.canonical_len() - 1, catalog.canonical_len() + 1] {
        let mut bytes = vec![0xa5; length];
        assert_eq!(
            catalog.encode_into(&mut bytes),
            Err(PrimitiveCatalogFailure::InvalidBufferLength)
        );
        assert!(bytes.iter().all(|value| *value == 0xa5));
    }
}

#[rstest::rstest]
fn typed_contracts_match_the_executed_corpus_shapes() {
    use crate::{
        CatalogClockRuleV1 as Clock, CatalogInputRuleV1 as Input, CatalogOutputRuleV1 as Output,
        CatalogParameterRuleV1 as Parameter, CatalogStateRuleV1 as State,
    };
    let catalog = PrimitiveCatalogV1::verify().unwrap();

    for bytes in GOLDENS {
        let parts = vector(bytes).unwrap().parts();
        let contract = catalog.row(parts.primitive_id).unwrap().contract();
        let scalars = match contract.input {
            Input::Fixed | Input::ClockedFixed | Input::ClockedHigh | Input::ClockedLow => 1,
            Input::TwoFixed | Input::BooleanAndTwoFixed => 2,
            Input::Ohlc | Input::ClockedOhlc => 4,
            Input::None => panic!("executable primitive requires input"),
        };
        let stateful = contract.clock == Clock::OneDeclaredTriggerOrSample;
        assert_eq!(
            stateful,
            !parts.pre_state.is_empty(),
            "{} clock",
            parts.vector_id
        );
        assert_eq!(contract.state == State::None, !stateful);
        let parameters = if stateful {
            // The golden state frame carries both scales and a period/window slot;
            // the TR/gap slot is canonical zero, not a configurable period.
            6 + if contract.parameters == Parameter::LagAndMaximum {
                4
            } else {
                0
            }
        } else {
            match contract.parameters {
                Parameter::None => 0,
                Parameter::OutputScale | Parameter::ComparisonPredicate => 1,
                Parameter::OutputScaleAndReducedFraction => 9,
                _ => panic!("state parameters on stateless primitive"),
            }
        };
        let condition = usize::from(contract.input == Input::BooleanAndTwoFixed);
        let coordinate = if stateful { 308 } else { 0 };
        assert_eq!(
            parts.input.len(),
            8 + scalars * 17 + parameters + condition + coordinate,
            "{} input",
            parts.vector_id
        );
        let expected_output = match parts.terminal {
            GoldenVectorTerminalV1::NumericFailureNoStateChange
            | GoldenVectorTerminalV1::Unsupported => 0,
            GoldenVectorTerminalV1::Warming => {
                assert!(stateful);
                1
            }
            GoldenVectorTerminalV1::Ready => match contract.output {
                Output::Boolean => 1,
                Output::Fixed => 17,
                Output::AvailableFixed => 18,
                Output::AvailableFixedAndCoordinate => 326,
                _ => panic!("policy/reference cannot be executed as primitive"),
            },
        };
        assert_eq!(
            parts.expected_output.len(),
            expected_output,
            "{} output",
            parts.vector_id
        );
    }
}

#[rstest::rstest]
fn source_identity_covers_manifest_exports_and_every_production_module() {
    assert!(SOURCES.iter().any(|(path, bytes)| *path == "Cargo.toml" && *bytes == include_bytes!("../Cargo.toml")));
    assert!(
        SOURCES
            .iter()
            .any(|(path, bytes)| *path == "lib.rs" && *bytes == include_bytes!("lib.rs"))
    );
    let mut module_count = 0;

    for line in include_str!("lib.rs").lines() {
        if let Some(module) = line
            .trim()
            .strip_prefix("mod ")
            .and_then(|value| value.strip_suffix(';'))
        {
            module_count += 1;
            assert!(
                SOURCES
                    .iter()
                    .any(|(path, _)| path.strip_suffix(".rs") == Some(module)),
                "missing source {module}"
            );
        }
    }

    assert_eq!(SOURCES.len(), module_count + 2);
    assert!(SOURCES.windows(2).all(|pair| pair[0].0 < pair[1].0));
}

/// The semantic digest binds the version's meaning and deliberately excludes the kernel source set.
///
/// This is what lets a program frozen under one version stay verifiable after the kernel changes:
/// `identity()` moves with any source byte, and the semantic digest does not.
#[rstest::rstest]
fn semantic_digest_separates_meaning_from_the_compiled_kernel() {
    let catalog = PrimitiveCatalogV1::resolve(1).unwrap();

    let mut expected = Sha256::new();
    expected.update(b"bfp.primitive-catalog.semantic.v1\0");
    expected.update(catalog.semantic_version().to_le_bytes());
    emit_rows_and_goldens(
        crate::catalog_version::published(1).unwrap(),
        &mut |bytes| {
            expected.update(bytes);
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(
        catalog.semantic_digest(),
        <[u8; 32]>::from(expected.finalize())
    );
    assert_ne!(catalog.semantic_digest(), catalog.identity());
}

/// Two versions over identical rows still get distinct semantic digests.
///
/// The version number is hashed in, so publishing a later version can never collide with an
/// earlier one's digest, and an earlier freeze cannot be satisfied by a later version's digest.
#[rstest::rstest]
fn semantic_digest_is_separated_by_version_number() {
    let digest_for = |version: u16| {
        let mut hasher = Sha256::new();
        hasher.update(b"bfp.primitive-catalog.semantic.v1\0");
        hasher.update(version.to_le_bytes());
        emit_rows_and_goldens(
            crate::catalog_version::published(1).unwrap(),
            &mut |bytes| {
                hasher.update(bytes);
                Ok(())
            },
        )
        .unwrap();
        <[u8; 32]>::from(hasher.finalize())
    };

    assert_eq!(
        PrimitiveCatalogV1::resolve(1).unwrap().semantic_digest(),
        digest_for(1)
    );
    assert_ne!(digest_for(1), digest_for(2));
}

/// Resolution keys on the requested version and refuses one this kernel does not publish.
#[rstest::rstest]
fn resolution_admits_only_published_versions() {
    assert_eq!(crate::catalog_version::PUBLISHED_V1.len(), 2);
    assert_eq!(crate::catalog_version::newest().semantic_version, 2);
    assert_eq!(
        PrimitiveCatalogV1::resolve(1).unwrap().semantic_version(),
        1
    );
    // `verify` means the newest published version, which is no longer version 1.
    assert_eq!(
        PrimitiveCatalogV1::verify().unwrap(),
        PrimitiveCatalogV1::resolve(2).unwrap()
    );

    for unpublished in [0_u16, 3, 65_535] {
        assert_eq!(
            PrimitiveCatalogV1::resolve(unpublished),
            Err(PrimitiveCatalogFailure::UnpublishedSemanticVersion),
            "version {unpublished} is not published by this kernel"
        );
    }
}

/// Version 1's semantic digest, pinned.
///
/// This is the guarantee that publishing a later version costs an earlier one nothing. Version 1's
/// meaning is its number, its rows and its goldens, so anything that leaves those alone - a new
/// version, a new contract-rule variant, a kernel implementation change - must leave this digest
/// alone too. A change here means some program frozen against version 1 can no longer be read back,
/// and that is a decision to make deliberately rather than discover.
const VERSION_1_SEMANTIC_DIGEST: [u8; 32] = [
    0x34, 0x9e, 0x82, 0x6f, 0xe5, 0x3a, 0x5d, 0x07, 0xb4, 0xaf, 0xcb, 0x93, 0x8d, 0x6a, 0x4a, 0x9b,
    0xbd, 0x42, 0x34, 0xd0, 0xb0, 0xb8, 0x13, 0xc8, 0x8c, 0x54, 0xc6, 0xa4, 0xc5, 0xd4, 0xce, 0xf2,
];

#[rstest::rstest]
fn version_1_meaning_is_pinned_against_every_later_change() {
    let catalog = PrimitiveCatalogV1::resolve(1).unwrap();

    assert_eq!(
        catalog.semantic_digest(),
        VERSION_1_SEMANTIC_DIGEST,
        "version 1's meaning changed; every program frozen against it stops reading back"
    );

    // The implementation identity is free to move; the meaning is not. That separation is the
    // whole point, so assert they are actually different values.
    assert_ne!(catalog.semantic_digest(), catalog.identity());
}

/// Publishing version 2 leaves version 1 exactly as it was, and version 2 carries the new row.
///
/// This is the property the versioned catalog exists for. Until a second version existed it could
/// only be argued; now it is checked.
#[rstest::rstest]
fn publishing_version_2_leaves_version_1_untouched() {
    let one = PrimitiveCatalogV1::resolve(1).unwrap();
    let two = PrimitiveCatalogV1::resolve(2).unwrap();

    assert_eq!(one.semantic_digest(), VERSION_1_SEMANTIC_DIGEST);
    assert_ne!(two.semantic_digest(), one.semantic_digest());
    assert_eq!(one.rows().len(), 57);
    assert_eq!(two.rows().len(), 59);

    for semantic_id in [
        "bfp.fused-rational.two-input.i256-single-round.toward-zero.v1",
        "bfp.fused-rational.two-input.i256-single-round.nearest-ties-to-even.v1",
    ] {
        assert!(
            one.row(semantic_id).is_none(),
            "{semantic_id} is not in version 1"
        );
        let row = two
            .row(semantic_id)
            .expect("version 2 carries the fused row");
        assert_eq!(row.operation, Some(PrimitiveOperationV1::FusedRational));
    }

    // Every version 1 row survives into version 2 unchanged and in order.
    for (index, row) in one.rows().iter().enumerate() {
        let shifted = if index < 22 { index } else { index + 2 };
        assert_eq!(&two.rows()[shifted], row);
    }
}
