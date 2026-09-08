extern crate std;

use super::*;
use crate::{CatalogOutputRuleV1, PrimitiveOperationV1};
use std::vec;

#[rstest::rstest]
fn complete_catalog_roundtrips_and_hashes_all_canonical_bytes() {
    let catalog = PrimitiveCatalogV1::verify().unwrap();
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
    assert_eq!(validate_rows(&ROWS), Ok(()));
    assert_eq!(
        validate_rows(&ROWS[..56]),
        Err(PrimitiveCatalogFailure::InvalidRows)
    );
    let mut rows = ROWS.to_vec();
    rows.push(ROWS[0]);
    assert_eq!(
        validate_rows(&rows),
        Err(PrimitiveCatalogFailure::InvalidRows)
    );
    rows.pop();
    rows[1] = rows[0];
    assert_eq!(
        validate_rows(&rows),
        Err(PrimitiveCatalogFailure::InvalidRows)
    );
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

    for row in ROWS {
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
    let catalog = PrimitiveCatalogV1::verify().unwrap();
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
