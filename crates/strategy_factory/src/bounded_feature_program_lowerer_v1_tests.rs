use super::*;
use crate::{
    bounded_feature_program_v1::tests::candidate,
    develop_composer_v2::CurrentResearchDevelopCustodyV2,
    lowered_guest_build_for_test::{
        AMBIENT_RUST_FLAG_VARS, build_lowered_guest_for_test, lowered_guest_build_command,
    },
    plugin_wire_v2::{PluginFrameKindV2, PluginFrameV2, PluginOutputAvailabilityV3, TypedValueV2},
    rd_bounded_feature_program_v1::freeze_research_bounded_feature_program_v1,
    strategy_plan_v2::plugin_manifest_digest,
};
use std::{ffi::OsStr, fs, path::Path};

/// The frozen project, not the surrounding job, decides what a guest compiles under.
#[rstest::rstest]
fn a_lowered_guest_build_ignores_ambient_rust_flags() {
    let command = lowered_guest_build_command(Path::new("project"), Path::new("target-out"));

    for name in AMBIENT_RUST_FLAG_VARS {
        assert!(
            matches!(
                command.get_envs().find(|(key, _)| *key == OsStr::new(name)),
                Some((_, None))
            ),
            "a guest build must not inherit {name}"
        );
    }
    assert_eq!(
        command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("CARGO_BUILD_WARNINGS"))
            .and_then(|(_, value)| value),
        Some(OsStr::new("deny"))
    );
    // The frozen configuration is then the only thing that can size the guest's memory, and it
    // asks for exactly the linear memory the strict envelope admits.
    assert!(frozen_config(1_048_576).contains(
        "\"link-arg=--max-memory=1048576\", \"-C\", \"link-arg=--initial-memory=1048576\""
    ));
}

#[rstest::rstest]
fn fixed_source_identities_are_repeatable_and_guest_is_float_free() {
    assert_eq!(
        first_party_bfp_sdk_source_digest_v1(),
        first_party_bfp_sdk_source_digest_v1()
    );
    assert_eq!(
        complete_kernel_source_digest().expect("complete source identity"),
        complete_kernel_source_digest().expect("complete source identity")
    );
    assert!(
        GUEST_KERNEL_SOURCES
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0)
    );

    for (_, bytes) in GUEST_KERNEL_SOURCES {
        let source = std::str::from_utf8(bytes).expect("committed Rust source is UTF-8");
        assert!(!source.contains("f32"));
        assert!(!source.contains("f64"));
        assert!(!source.contains("Action::Submit"));
    }
}

/// The complete binding claims to commit the catalog's whole source. A primitive whose
/// implementation is outside it would let the catalog's meaning change under a frozen program
/// without changing the digest that program is sealed against, so the list is compared to the
/// kernel directory rather than maintained by hand.
#[rstest::rstest]
fn the_complete_kernel_binding_commits_every_kernel_source() {
    let kernel = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../indicators/kernel/src")
        .canonicalize()
        .expect("the pinned kernel source directory");
    let mut present = std::collections::BTreeSet::new();

    for entry in std::fs::read_dir(&kernel).expect("the kernel source directory reads") {
        let name = entry.expect("a kernel source entry").file_name();
        let name = name
            .to_str()
            .expect("kernel file names are UTF-8")
            .to_owned();

        // Test modules carry no catalog meaning and are excluded from every committed list.
        if name.ends_with(".rs") && !name.ends_with("_tests.rs") {
            present.insert(name);
        }
    }
    let committed = COMPLETE_KERNEL_SOURCES
        .iter()
        .map(|(path, _)| (*path).to_owned())
        .filter(|path| path.ends_with(".rs"))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        present, committed,
        "every non-test kernel source must be committed by the complete catalog binding"
    );
}

/// A lowered symbol the guest crate does not re-export emits source that cannot compile, and
/// nothing else in this crate would notice until a real build ran.
#[rstest::rstest]
fn every_lowered_symbol_is_re_exported_by_the_guest_crate() {
    let lib = std::str::from_utf8(LIB_SOURCE).expect("the guest crate root is UTF-8");
    let catalog = PrimitiveCatalogV1::verify().expect("fixed catalog verifies");

    for row in catalog.rows() {
        if let Some(operation) = row.operation {
            let symbol = lowered_symbol(operation);
            let owner = symbol
                .split("::")
                .next()
                .expect("a lowered symbol is non-empty");
            assert!(
                lib.contains(owner),
                "the guest crate root must re-export {owner} for {symbol}"
            );
        }
    }
}

#[rstest::rstest]
fn every_catalog_primitive_has_a_direct_first_party_symbol() {
    let catalog = PrimitiveCatalogV1::verify().expect("fixed catalog verifies");
    for row in catalog.rows() {
        if let Some(operation) = row.operation {
            assert!(!lowered_symbol(operation).is_empty());
        }
    }
}

#[rstest::rstest]
fn every_operation_has_concrete_generated_execution_source() {
    use PrimitiveOperationV1 as Op;

    /// Operations this fixture cannot build a node for, each with the reason it cannot.
    ///
    /// `FusedRational` declares its arithmetic as two postfix programs rather than as typed
    /// parameters, and the fixture's parameter builder says so with `unimplemented!`. It is
    /// listed rather than skipped because a name in this list is a gap someone can find; an
    /// operation merely absent from the tables below is a gap nobody can.
    const WITHOUT_A_FIXTURE: [Op; 1] = [Op::FusedRational];

    let stateless = [
        (
            Op::Add,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Sub,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Mul,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Div,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Rescale,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Sqrt,
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Compare,
            BoundedFeatureParametersV1::ComparisonPredicate {
                predicate: BoundedFeaturePredicateV1::Equal,
            },
        ),
        (Op::Select, BoundedFeatureParametersV1::None),
        (Op::Body, BoundedFeatureParametersV1::None),
        (Op::Range, BoundedFeatureParametersV1::None),
        (Op::UpperWick, BoundedFeatureParametersV1::None),
        (Op::LowerWick, BoundedFeatureParametersV1::None),
        (
            Op::Fraction,
            BoundedFeatureParametersV1::RangeFraction {
                numerator: 1,
                denominator: 2,
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
    ];
    let stateless_operations: Vec<Op> = stateless.iter().map(|(operation, _)| *operation).collect();

    for (operation, parameters) in stateless {
        let node = crate::bounded_feature_program_v1::BoundedFeatureNodeV1 {
            node_id: "probe".into(),
            primitive_semantic_id: "probe".into(),
            input_bindings: vec![],
            output_ports: vec![],
            parameters,
            state_id: None,
            update_clock: None,
        };
        let mut emitted = String::new();
        emit_stateless_expression(&mut emitted, &node, operation, &|port| {
            Ok(format!("datum_{port}"))
        })
        .unwrap();
        assert!(emitted.contains("Datum::"));
        assert!(!emitted.contains("KERNEL_CALL"));
    }

    let stateful = [
        (
            Op::Ema,
            BoundedFeatureParametersV1::Period {
                period: 2,
                rounding: Some(BoundedFeatureRoundingV1::TowardZero),
            },
        ),
        (
            Op::Wilder,
            BoundedFeatureParametersV1::Period {
                period: 2,
                rounding: Some(BoundedFeatureRoundingV1::TowardZero),
            },
        ),
        (Op::TrueRange, BoundedFeatureParametersV1::None),
        (
            Op::Atr,
            BoundedFeatureParametersV1::Period {
                period: 2,
                rounding: Some(BoundedFeatureRoundingV1::TowardZero),
            },
        ),
        (Op::Gap, BoundedFeatureParametersV1::None),
        (
            Op::Rsi,
            BoundedFeatureParametersV1::PeriodAndOutputScale {
                period: 2,
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            },
        ),
        (
            Op::Lag,
            BoundedFeatureParametersV1::Lag {
                offset: 1,
                declared_max_lag: 2,
            },
        ),
        (
            Op::Sum,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 2,
                rounding: None,
            },
        ),
        (
            Op::Mean,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 2,
                rounding: Some(BoundedFeatureRoundingV1::TowardZero),
            },
        ),
        (
            Op::Minimum,
            BoundedFeatureParametersV1::Window {
                window: 2,
                rounding: None,
            },
        ),
        (
            Op::Maximum,
            BoundedFeatureParametersV1::Window {
                window: 2,
                rounding: None,
            },
        ),
        (
            Op::SwingHigh,
            BoundedFeatureParametersV1::Window {
                window: 2,
                rounding: None,
            },
        ),
        (
            Op::SwingLow,
            BoundedFeatureParametersV1::Window {
                window: 2,
                rounding: None,
            },
        ),
        (
            Op::BarsSinceMaximum,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 0,
                rounding: None,
            },
        ),
        (
            Op::BarsSinceMinimum,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 0,
                rounding: None,
            },
        ),
        (
            Op::PercentRank,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 2,
                rounding: Some(BoundedFeatureRoundingV1::TowardZero),
            },
        ),
    ];
    // The two tables are hand-written, so on their own they prove only that the operations
    // somebody remembered produce source. Comparing them against the catalog is what makes
    // this test's name true: a new row nobody adds here fails now, rather than shipping with
    // no coverage of its generated execution source at all.
    let catalog = PrimitiveCatalogV1::verify().expect("fixed catalog verifies");

    for row in catalog.rows() {
        let Some(operation) = row.operation else {
            continue;
        };
        let covered = stateless_operations.contains(&operation)
            || stateful
                .iter()
                .any(|(candidate, _)| *candidate == operation)
            || WITHOUT_A_FIXTURE.contains(&operation);

        assert!(
            covered,
            "{operation:?} is a catalog operation with no generated-execution-source coverage; \
                 add it to one of the tables above, or to WITHOUT_A_FIXTURE with the reason"
        );
    }

    for (operation, parameters) in stateful {
        let (constructor, restore, encode) =
            state_constructor(operation, &parameters, 2, 2).unwrap();
        assert!(constructor.contains("State"));
        assert!(restore.starts_with("restore_"));
        assert!(encode.contains("canonical"));
        let mut emitted = String::new();
        let outputs = usize::from(matches!(operation, Op::Lag | Op::SwingHigh | Op::SwingLow)) + 1;
        emit_stateful_advance(
            &mut emitted,
            operation,
            "state",
            "clock",
            &|port| Ok(format!("datum_{port}")),
            outputs,
        )
        .unwrap();
        assert!(emitted.contains(".advance("));
    }
}

#[rstest::rstest]
fn only_the_joint_owner_freeze_produces_repeatable_source_inputs() {
    let (design, proposal) = candidate();
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");

    let one =
        prepare_frozen_bounded_feature_source_inputs_v1(&frozen).expect("first source preparation");
    let two = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
        .expect("second source preparation");

    assert_eq!(one, two);
    assert_eq!(one.joint_freeze_digest(), frozen.joint_freeze_digest());
    assert_eq!(one.program_digest(), frozen.program_digest());
    assert_eq!(one.program_bytes(), frozen.program_bytes());
    assert_eq!(one.manifest_digest(), frozen.plugin_manifest_digest());
    assert_eq!(one.source_files().len(), 14);
}

fn operation_parameters(operation: PrimitiveOperationV1) -> BoundedFeatureParametersV1 {
    use PrimitiveOperationV1 as Op;

    match operation {
        // `(a + b) / 2`: both input programs and the one division the primitive exists for.
        Op::FusedRational => BoundedFeatureParametersV1::FusedRational {
            numerator: vec![1, 0, 1, 1, 3],
            denominator: {
                let mut bytes = vec![2];
                bytes.extend_from_slice(&2_i128.to_le_bytes());
                bytes
            },
            quotient_scale: 2,
            output_scale: 2,
            output_unit: "PRICE".into(),
            rounding: BoundedFeatureRoundingV1::TowardZero,
        },
        Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Rescale | Op::Sqrt => {
            BoundedFeatureParametersV1::OutputScale {
                output_scale: 2,
                rounding: BoundedFeatureRoundingV1::TowardZero,
            }
        }
        Op::Compare => BoundedFeatureParametersV1::ComparisonPredicate {
            predicate: BoundedFeaturePredicateV1::Greater,
        },
        Op::Select
        | Op::Body
        | Op::Range
        | Op::UpperWick
        | Op::LowerWick
        | Op::TrueRange
        | Op::Gap => BoundedFeatureParametersV1::None,
        Op::Fraction => BoundedFeatureParametersV1::RangeFraction {
            numerator: 1,
            denominator: 2,
            output_scale: 2,
            rounding: BoundedFeatureRoundingV1::TowardZero,
        },
        Op::Ema | Op::Wilder | Op::Atr => BoundedFeatureParametersV1::Period {
            period: 2,
            rounding: Some(BoundedFeatureRoundingV1::TowardZero),
        },
        Op::Rsi => BoundedFeatureParametersV1::PeriodAndOutputScale {
            period: 2,
            output_scale: 2,
            rounding: BoundedFeatureRoundingV1::TowardZero,
        },
        Op::Lag => BoundedFeatureParametersV1::Lag {
            offset: 1,
            declared_max_lag: 2,
        },
        Op::Sum => BoundedFeatureParametersV1::WindowAndOutputScale {
            window: 2,
            output_scale: 2,
            rounding: None,
        },
        Op::Mean => BoundedFeatureParametersV1::WindowAndOutputScale {
            window: 2,
            output_scale: 2,
            rounding: Some(BoundedFeatureRoundingV1::TowardZero),
        },
        Op::Minimum | Op::Maximum | Op::SwingHigh | Op::SwingLow => {
            BoundedFeatureParametersV1::Window {
                window: 2,
                rounding: None,
            }
        }
        Op::BarsSinceMaximum | Op::BarsSinceMinimum => {
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window: 2,
                output_scale: 2,
                rounding: None,
            }
        }
        Op::PercentRank => BoundedFeatureParametersV1::WindowAndOutputScale {
            window: 2,
            output_scale: 2,
            rounding: Some(BoundedFeatureRoundingV1::TowardZero),
        },
    }
}

fn operation_input_bindings(
    operation: PrimitiveOperationV1,
) -> Vec<crate::bounded_feature_program_v1::BoundedFeatureInputBindingV1> {
    use crate::bounded_feature_program_v1::{
        BoundedFeatureInputBindingV1, BoundedFeatureValueRefV1,
    };
    use PrimitiveOperationV1 as Op;

    let input = || BoundedFeatureValueRefV1::InputValue {
        input_role_id: "research.input.close.v1".into(),
    };
    let constant = |constant_id: &str| BoundedFeatureValueRefV1::Constant {
        constant_id: constant_id.into(),
    };
    let ports: Vec<(&str, BoundedFeatureValueRefV1)> = match operation {
        Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Compare | Op::FusedRational => {
            vec![("a", input()), ("b", input())]
        }
        Op::Select => vec![
            ("condition", constant("initial-condition")),
            ("when_false", input()),
            ("when_true", input()),
        ],
        Op::Body
        | Op::Range
        | Op::UpperWick
        | Op::LowerWick
        | Op::TrueRange
        | Op::Atr
        | Op::Gap => vec![
            ("close", input()),
            ("high", input()),
            ("low", input()),
            ("open", input()),
        ],
        Op::Fraction => vec![("high", input()), ("low", input())],
        Op::Rescale
        | Op::Sqrt
        | Op::Ema
        | Op::Wilder
        | Op::Rsi
        | Op::Lag
        | Op::Sum
        | Op::Mean
        | Op::Minimum
        | Op::Maximum
        | Op::SwingHigh
        | Op::SwingLow
        | Op::BarsSinceMaximum
        | Op::BarsSinceMinimum
        | Op::PercentRank => vec![("value", input())],
    };
    ports
        .into_iter()
        .map(|(port_id, source)| BoundedFeatureInputBindingV1 {
            port_id: port_id.into(),
            source,
            require_ready: false,
        })
        .collect()
}

fn operation_output_unit(operation: PrimitiveOperationV1) -> &'static str {
    use PrimitiveOperationV1 as Op;

    match operation {
        Op::Mul => "PRICE*PRICE",
        Op::Div => "PRICE/PRICE",
        Op::Rsi | Op::BarsSinceMaximum | Op::BarsSinceMinimum | Op::PercentRank => "dimensionless",
        _ => "PRICE",
    }
}

fn operation_state_bytes(operation: PrimitiveOperationV1) -> Option<u32> {
    use PrimitiveOperationV1 as Op;

    match operation {
        Op::Ema | Op::Wilder => Some(352),
        Op::TrueRange | Op::Atr | Op::Gap => Some(400),
        Op::Rsi => Some(1_376),
        Op::Lag
        | Op::Sum
        | Op::Mean
        | Op::Minimum
        | Op::Maximum
        | Op::SwingHigh
        | Op::SwingLow
        | Op::BarsSinceMaximum
        | Op::BarsSinceMinimum
        | Op::PercentRank => Some(668),
        _ => None,
    }
}

/// Every operation a program can declare, each lowered, and built and run as Wasm by the ignored
/// toolchain proof. `every_declarable_catalog_operation_is_lowered_built_and_run` holds this list
/// to the newest catalog, so a new operation cannot join the catalog without joining it.
const EXECUTABLE_OPERATIONS: [PrimitiveOperationV1; 30] = {
    use PrimitiveOperationV1 as Op;
    [
        Op::Add,
        Op::Sub,
        Op::Mul,
        Op::Div,
        Op::Rescale,
        Op::Compare,
        Op::Select,
        Op::Body,
        Op::Range,
        Op::UpperWick,
        Op::LowerWick,
        Op::Fraction,
        Op::Ema,
        Op::Wilder,
        Op::TrueRange,
        Op::Atr,
        Op::Gap,
        Op::Rsi,
        Op::Lag,
        Op::Sum,
        Op::Mean,
        Op::Minimum,
        Op::Maximum,
        Op::SwingHigh,
        Op::SwingLow,
        Op::Sqrt,
        Op::BarsSinceMaximum,
        Op::BarsSinceMinimum,
        Op::PercentRank,
        Op::FusedRational,
    ]
};

#[rstest::rstest]
fn every_declarable_catalog_operation_is_lowered_built_and_run() {
    let catalog = PrimitiveCatalogV1::verify().unwrap();
    let in_catalog = catalog
        .rows()
        .iter()
        .filter_map(|row| row.operation.map(|operation| operation as u8))
        .collect::<BTreeSet<_>>();
    let covered = EXECUTABLE_OPERATIONS
        .into_iter()
        .map(|operation| operation as u8)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        covered, in_catalog,
        "every operation in the newest catalog is built and run"
    );
    assert_eq!(
        covered.len(),
        EXECUTABLE_OPERATIONS.len(),
        "no operation is listed twice"
    );
}

fn dynamic_operation_candidate(
    operation: PrimitiveOperationV1,
) -> (
    StrategyDesignV2,
    crate::bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
) {
    use crate::bounded_feature_program_v1::{
        BoundedFeatureAvailabilityV1, BoundedFeatureClockV1, BoundedFeatureInitialStateV1,
        BoundedFeatureNodeV1, BoundedFeatureOutputPortV1, BoundedFeatureStateCellV1,
        BoundedFeatureStateKindV1, BoundedFeatureValueRefV1, BoundedFeatureValueTypeV1,
    };
    use vibe_indicators_kernel::{CatalogAvailabilityRuleV1, CatalogOutputRuleV1, RoundingMode};

    let catalog = PrimitiveCatalogV1::verify().unwrap();
    let (design, mut proposal) = candidate();
    if operation == PrimitiveOperationV1::Compare {
        return (design, proposal);
    }
    let parameters = operation_parameters(operation);
    let row = catalog
        .rows()
        .iter()
        .find(|row| {
            row.operation == Some(operation)
                && (row.rounding.is_none() || row.rounding == Some(RoundingMode::TowardZero))
        })
        .expect("operation has a compatible fixed catalog row");
    let contract = row.contract();
    let availability = match contract.availability {
        CatalogAvailabilityRuleV1::ReadyInputs | CatalogAvailabilityRuleV1::FirstSample => {
            BoundedFeatureAvailabilityV1::Ready
        }
        CatalogAvailabilityRuleV1::FullWindow
        | CatalogAvailabilityRuleV1::LagOffsetPlusOne
        | CatalogAvailabilityRuleV1::PeriodPlusOne
        | CatalogAvailabilityRuleV1::PreviousClose => BoundedFeatureAvailabilityV1::WarmingReady,
        CatalogAvailabilityRuleV1::Policy | CatalogAvailabilityRuleV1::LifecycleOwned => {
            panic!("executable primitive has non-executable availability")
        }
    };
    let fixed_type = BoundedFeatureValueTypeV1::FixedI128 {
        unit: operation_output_unit(operation).into(),
        scale: 2,
    };
    let mut outputs = Vec::new();
    if contract.output == CatalogOutputRuleV1::AvailableFixedAndCoordinate {
        outputs.push(BoundedFeatureOutputPortV1 {
            port_id: "coordinate".into(),
            value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                input_role_identity: proposal.inputs[0].input_role_identity,
            },
            availability,
        });
    }
    outputs.push(BoundedFeatureOutputPortV1 {
        port_id: "value".into(),
        value_type: fixed_type,
        availability,
    });
    let state_id = operation_state_bytes(operation).map(|_| "a-probe-state".to_owned());
    let probe = BoundedFeatureNodeV1 {
        node_id: "a-probe".into(),
        primitive_semantic_id: row.semantic_id.into(),
        input_bindings: operation_input_bindings(operation),
        output_ports: outputs,
        parameters,
        state_id: state_id.clone(),
        update_clock: state_id.as_ref().map(|_| BoundedFeatureClockV1::Trigger {
            input_role_id: "research.input.close.v1".into(),
        }),
    };
    let compare = &mut proposal.nodes[0];
    let compare_value = compare
        .input_bindings
        .iter_mut()
        .find(|binding| binding.port_id == "a")
        .expect("candidate compare has its value input");
    compare_value.source = BoundedFeatureValueRefV1::NodeOutput {
        node_id: "a-probe".into(),
        port_id: "value".into(),
    };
    compare_value.require_ready = availability == BoundedFeatureAvailabilityV1::WarmingReady;

    for constant in &mut proposal.constants {
        if constant.constant_id == "threshold" {
            let crate::bounded_feature_program_v1::BoundedFeatureConstantValueV1::FixedI128 {
                unit,
                scale,
                ..
            } = &mut constant.value
            else {
                panic!("threshold stays fixed I128")
            };
            *unit = operation_output_unit(operation).into();
            *scale = 2;
        }
    }
    proposal.nodes.insert(0, probe);
    if operation == PrimitiveOperationV1::Sqrt {
        // A square root takes a squared unit, so the probe reads the close multiplied by itself
        // rather than the close: PRICE*PRICE in, PRICE out.
        let (_, squared) = dynamic_operation_candidate(PrimitiveOperationV1::Mul);
        let mut square = squared.nodes[0].clone();
        square.node_id = "a-square".into();
        proposal.nodes[0].input_bindings[0].source = BoundedFeatureValueRefV1::NodeOutput {
            node_id: "a-square".into(),
            port_id: "value".into(),
        };
        proposal.nodes.insert(0, square);
    }
    // The shared candidate is frozen against catalog version 1. An operation a later version
    // added is declared against the newest catalog instead, which holds every earlier row.
    let declared = PrimitiveCatalogV1::resolve(proposal.catalog_semantic_version).unwrap();
    if declared.row(row.semantic_id).is_none() {
        proposal.catalog_semantic_version = catalog.semantic_version();
        proposal.catalog_digest = BindingDigest::from_untrusted_bytes(catalog.semantic_digest());
    }

    if let (Some(state_id), Some(max_bytes)) = (state_id, operation_state_bytes(operation)) {
        proposal.state_cells.push(BoundedFeatureStateCellV1 {
            state_id,
            writer_node_id: "a-probe".into(),
            state_kind: BoundedFeatureStateKindV1::Primitive,
            initial: BoundedFeatureInitialStateV1::CanonicalEmpty,
            max_bytes,
        });
    }
    (design, proposal)
}

fn canonical_coordinate(sample: u64) -> [u8; 308] {
    let mut bytes = [1_u8; 308];
    bytes[..4].copy_from_slice(&1_u32.to_le_bytes());
    bytes[84..116].fill(u8::try_from(sample).expect("small corpus sample"));
    for offset in [116, 124, 132, 236] {
        bytes[offset..offset + 8].copy_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[rstest::rstest]
#[ignore = "invokes the pinned local wasm compiler"]
fn generated_candidate_is_a_real_strict_abi_three_module() {
    let (design, proposal) = candidate();
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");
    let root = tempfile::tempdir().expect("private build root");
    let guest = build_lowered_guest_for_test(
        &frozen,
        root.path(),
        &root.path().join("target-out"),
        "candidate",
    );
    let (manifest, wasm) = (guest.manifest, guest.wasm);

    let manifest_digest = plugin_manifest_digest(&manifest);
    let module_identity = BindingDigest::from_untrusted_bytes([91; 32]);
    let input = PluginFrameV2 {
        kind: PluginFrameKindV2::Input,
        output_availability: None,
        manifest_digest,
        module_identity,
        invocation_identity: [17; 16],
        values: vec![
            TypedValueV2::i128(200),
            TypedValueV2::new(ValueTypeV2::Bytes, [1u8; 308].as_slice()).unwrap(),
        ],
        state: TypedValueV2::new(ValueTypeV2::Bytes, []).unwrap(),
    };
    let input_bytes = input.encode(&manifest).unwrap();
    let engine = wasmi::Engine::default();
    let module = wasmi::Module::new(&engine, &wasm).unwrap();
    let mut store = wasmi::Store::new(&engine, ());
    let instance = wasmi::Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let memory = instance.get_memory(&store, "memory").unwrap();
    let input_ptr_function = instance
        .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_input_ptr_v2")
        .unwrap();
    let input_capacity_function = instance
        .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_input_capacity_v2")
        .unwrap();
    let output_ptr_function = instance
        .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_output_ptr_v2")
        .unwrap();
    let output_capacity_function = instance
        .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_output_capacity_v2")
        .unwrap();
    let invoke = instance
        .get_typed_func::<i32, i32>(&store, "strategy_factory_plugin_invoke_v2")
        .unwrap();
    let input_ptr = input_ptr_function.call(&mut store, ()).unwrap() as u32 as usize;
    let input_capacity = input_capacity_function.call(&mut store, ()).unwrap();
    let output_ptr = output_ptr_function.call(&mut store, ()).unwrap() as u32 as usize;
    let output_capacity = output_capacity_function.call(&mut store, ()).unwrap();
    assert_eq!(
        input_capacity as usize,
        frame_capacity_v3(&manifest.input_ports, manifest.state.max_bytes, false).unwrap()
    );
    assert_eq!(
        output_capacity as usize,
        frame_capacity_v3(&manifest.output_ports, manifest.state.max_bytes, true).unwrap()
    );
    assert!(
        input_ptr + input_capacity as usize <= output_ptr
            || output_ptr + output_capacity as usize <= input_ptr
    );
    assert_eq!(invoke.call(&mut store, -1).unwrap(), -2);
    memory.write(&mut store, input_ptr, &input_bytes).unwrap();
    assert_eq!(
        invoke
            .call(&mut store, (input_bytes.len() - 1) as i32)
            .unwrap(),
        -2
    );
    let output_len = invoke.call(&mut store, input_bytes.len() as i32).unwrap();
    assert!(output_len > 0);
    let mut output_bytes = vec![0; output_len as usize];
    memory.read(&store, output_ptr, &mut output_bytes).unwrap();
    let output = PluginFrameV2::decode_exact(
        &output_bytes,
        PluginFrameKindV2::Output,
        &manifest,
        manifest_digest,
        module_identity,
        [17; 16],
    )
    .unwrap();
    assert_eq!(
        output.output_availability,
        Some(PluginOutputAvailabilityV3::Ready)
    );
    assert_eq!(output.state.bytes(), &[1]);
    assert_eq!(output.values[0].bytes(), b"kernel.position.enter.v1");
}

/// No lowered program names a decoded value it never reads.
///
/// `lowered_guest_build_command` denies warnings, so a binding nothing reads is not untidy in
/// a built guest, it is a build failure. That failure only appears once a real toolchain runs,
/// which is what the ignored proof below costs a compiler run to do. This one asserts the same
/// property from the lowered text alone, on every host, in milliseconds.
#[rstest::rstest]
fn no_lowered_program_names_a_value_it_never_reads() {
    for operation in EXECUTABLE_OPERATIONS {
        let (design, proposal) = dynamic_operation_candidate(operation);
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
            .unwrap_or_else(|e| panic!("{operation:?} joint Owner freeze: {e}"));
        let lowered = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .unwrap_or_else(|e| panic!("{operation:?} source lowering: {e}"));
        let Some((_, program_bytes)) = lowered
            .source_files()
            .find(|(path, _)| path.ends_with("program.rs"))
        else {
            panic!("{operation:?} lowering emits a program source");
        };
        let program = std::str::from_utf8(program_bytes).expect("lowered source is UTF-8");

        for line in program.lines() {
            let Some(rest) = line.trim_start().strip_prefix("let ") else {
                continue;
            };
            let name = rest.split(' ').next().unwrap_or_default();

            if !name.starts_with("input_") || name.ends_with("_bytes") {
                continue;
            }
            // `{name}_bytes` merely carries the same prefix, so those occurrences are not reads
            // of this binding. One occurrence remains for the binding itself.
            let reads =
                program.matches(name).count() - program.matches(&format!("{name}_bytes")).count();
            assert!(
                reads >= 2,
                "{operation:?} lowering binds {name}, which nothing reads"
            );
        }
    }
}

/// Every `let` a lowering emits must be read somewhere in the same body.
///
/// The guest is built with warnings denied, so an unused binding is not cosmetic: it turns a
/// proposal that validates cleanly into one that cannot be built. The guard above checks the
/// same property, but only for names beginning with `input_` and only for programs built from
/// its own list of operations. The defect that prompted this test sat outside both limits at
/// once - a constant reachable only as a state cell's initial value is not an `input_`, and
/// "being a state cell's initial value" is not an operation - so neither restriction could
/// have been widened into catching it. This test therefore fixes the axis rather than
/// extending the list: it reads the bindings the lowering actually emitted and requires each
/// one to be read, whatever produced it.
/// Every `let` a lowering emits must be read somewhere in the same body.
///
/// The guest is built with warnings denied, so an unused binding is not cosmetic: it turns a
/// proposal that validates cleanly into one that cannot be built. The `input_`-prefixed guard
/// above checks the same property, but restricts itself twice - to that prefix, and to
/// programs built from its own list of operations. Both shapes below sit outside both limits
/// at once, so neither restriction could have been widened into catching them. This test
/// therefore fixes the axis rather than extending the list: it reads the bindings the lowering
/// actually emitted and requires each one to be read, whatever produced it.
#[rstest::rstest]
fn no_lowering_binds_a_name_the_body_never_reads() {
    use crate::bounded_feature_program_v1::{
        BoundedFeatureConstantV1, BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1,
    };

    fn unread_bindings(
        design: &StrategyDesignV2,
        proposal: crate::bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    ) -> (Vec<String>, String) {
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(design);
        let frozen = freeze_research_bounded_feature_program_v1(&custody, design, proposal)
            .expect("joint Owner freeze");
        let lowered =
            prepare_frozen_bounded_feature_source_inputs_v1(&frozen).expect("source lowering");
        let (_, program_bytes) = lowered
            .source_files()
            .find(|(path, _)| path.ends_with("program.rs"))
            .expect("lowering emits a program source");
        let program = std::str::from_utf8(program_bytes).expect("lowered source is UTF-8");

        // `constant_1` is a prefix of `constant_10`, and `input_0_value_bytes` contains the
        // name `input_0_value`, so occurrences are counted over identifier tokens rather than
        // substrings. Anything else lets a longer name pay for a shorter one's read.
        let tokens = program
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .filter(|token| !token.is_empty())
            .fold(BTreeMap::<&str, usize>::new(), |mut counts, token| {
                *counts.entry(token).or_default() += 1;
                counts
            });

        let mut unread = Vec::new();

        for line in program.lines() {
            let Some(rest) = line.trim_start().strip_prefix("let ") else {
                continue;
            };
            let name = rest
                .trim_start_matches("mut ")
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .next()
                .unwrap_or_default();

            // A leading underscore is the compiler's own mark for a binding that is
            // deliberately not read, and the build does not warn about those.
            if name.is_empty() || name.starts_with('_') {
                continue;
            }
            // One occurrence is the binding itself; a read is any occurrence beyond it.
            if tokens.get(name).copied().unwrap_or_default() < 2 {
                unread.push(name.to_owned());
            }
        }
        (unread, program.to_owned())
    }

    // `candidate()` reaches its state cell's initial constant from a decision predicate too, so
    // the body reads it and the shape is absent there. Point the cell at a constant nothing
    // else names, which is what a real proposal produces and what validation accepts: an
    // initial-value constant *is* consumed, by the initial state bytes.
    let (design, mut proposal) = candidate();
    proposal.constants.push(BoundedFeatureConstantV1 {
        constant_id: "unread-initial".into(),
        value: BoundedFeatureConstantValueV1::Boolean { value: false },
    });
    proposal.state_cells[0].initial = BoundedFeatureInitialStateV1::Constant {
        constant_id: "unread-initial".into(),
    };
    let (found, _) = unread_bindings(&design, proposal);
    assert!(
        found.is_empty(),
        "a constant reachable only as a state cell's initial value: {found:?}"
    );

    // A program with no state cells reads no prior state and writes none back, so `pre_empty`
    // is read nowhere and `post_state` is never assigned.
    let (design, mut proposal) = candidate();
    proposal.state_cells.clear();
    let (found, program) = unread_bindings(&design, proposal);
    assert!(found.is_empty(), "a program with no state cells: {found:?}");
    // `post_state` is read - the frame always carries a state entry - but with no state cell
    // nothing assigns it, and `unused_mut` is denied just as `unused_variables` is. Counting
    // reads cannot see that, so this one is asserted directly rather than by a heuristic for
    // "was it written", which would have to recognise every way a binding can be mutated.
    assert!(
        !program.contains("let mut post_state"),
        "a program with no state cells declares post_state mutable"
    );
    assert!(program.contains("let post_state"));
}

/// An `Unsupported` failure names the region it arose in.
///
/// The guest has one code for every unsupported condition, so a reader who sees it cannot tell
/// a rejected coordinate from a state restore that failed, and bisects blind. `SITE` is
/// stamped by each generated region and folded into the returned code, leaving `-2` to mean
/// what it means today: a failure before any generated region ran, which is the frame decode
/// and its own checks.
///
/// This asserts the emitted source rather than a running module. Invoking one needs the wasm
/// compiler, which is why the execution tests in this module are `#[ignore]`; what can be
/// checked cheaply is that every region is stamped and that the ordinals are dense and
/// distinct, since a repeated ordinal would merge two regions back together silently.
#[rstest::rstest]
fn every_generated_region_stamps_a_distinct_failure_site() {
    let (design, proposal) = candidate();
    let node_count = proposal.nodes.len();
    let region_count = node_count + proposal.state_cells.len();
    assert!(
        region_count > 1,
        "the fixture must have regions to tell apart"
    );

    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");
    let lowered =
        prepare_frozen_bounded_feature_source_inputs_v1(&frozen).expect("source lowering");
    let (_, program_bytes) = lowered
        .source_files()
        .find(|(path, _)| path.ends_with("program.rs"))
        .expect("lowering emits a program source");
    let program = std::str::from_utf8(program_bytes).expect("lowered source is UTF-8");

    // 0 is the reset at the top of `run`; 1..=region_count are the regions themselves.
    for ordinal in 0..=region_count {
        let stamp = format!("SITE.store({ordinal}i32, Ordering::Relaxed);");
        assert_eq!(
            program.matches(&stamp).count(),
            1,
            "site {ordinal} is stamped exactly once"
        );
    }
    assert_eq!(
        program.matches("SITE.store(").count(),
        region_count + 1,
        "no region is stamped twice and none is missed"
    );
    assert!(
        program.contains("2i32.saturating_sub(SITE.load(Ordering::Relaxed))"),
        "the invoke wrapper folds the site into the returned code"
    );
}

#[rstest::rstest]
#[ignore = "builds and dynamically invokes every executable primitive operation"]
fn every_executable_operation_builds_and_runs_as_strict_abi_three_wasm() {
    let root = tempfile::tempdir().expect("private corpus build root");
    let target_dir = root.path().join("target-out");

    for operation in EXECUTABLE_OPERATIONS {
        let (design, proposal) = dynamic_operation_candidate(operation);
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
            .unwrap_or_else(|e| panic!("{operation:?} joint Owner freeze: {e}"));
        let label = format!("{operation:?}");
        let mut guest = BuiltGuest::build(&frozen, root.path(), &target_dir, &label);
        let mut prior_state = Vec::new();
        let mut became_ready = false;

        for sample in 1_u64..=3 {
            let output = guest.invoke(sample, i128::from(199 + sample), &prior_state, &label);
            became_ready |= output.output_availability == Some(PluginOutputAvailabilityV3::Ready);
            prior_state = output.state.bytes().to_vec();
        }
        assert!(became_ready, "{operation:?} never became READY");
    }
}

/// One frozen program lowered, built as strict ABI 3 Wasm, and instantiated, taking one frame per
/// sample of its input roles the way the program host drives it.
struct BuiltGuest {
    manifest: crate::strategy_design_v2::PluginManifestV2,
    manifest_digest: BindingDigest,
    store: wasmi::Store<()>,
    memory: wasmi::Memory,
    input_ptr: usize,
    output_ptr: usize,
    invoke: wasmi::TypedFunc<i32, i32>,
}

impl BuiltGuest {
    /// Lowers `frozen` into `root` and builds it into `target_dir` with the production command.
    fn build(
        frozen: &crate::rd_bounded_feature_program_v1::FrozenResearchBoundedFeatureProgramV1,
        root: &Path,
        target_dir: &Path,
        label: &str,
    ) -> Self {
        let guest = build_lowered_guest_for_test(frozen, root, target_dir, label);
        let (manifest, wasm) = (guest.manifest, guest.wasm);

        let manifest_digest = plugin_manifest_digest(&manifest);
        let engine = wasmi::Engine::default();
        let module = wasmi::Module::new(&engine, &wasm).unwrap();
        let mut store = wasmi::Store::new(&engine, ());
        let instance = wasmi::Linker::new(&engine)
            .instantiate_and_start(&mut store, &module)
            .unwrap();
        let memory = instance.get_memory(&store, "memory").unwrap();
        let input_ptr = instance
            .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_input_ptr_v2")
            .unwrap()
            .call(&mut store, ())
            .unwrap() as u32 as usize;
        let output_ptr = instance
            .get_typed_func::<(), i32>(&store, "strategy_factory_plugin_output_ptr_v2")
            .unwrap()
            .call(&mut store, ())
            .unwrap() as u32 as usize;
        let invoke = instance
            .get_typed_func::<i32, i32>(&store, "strategy_factory_plugin_invoke_v2")
            .unwrap();

        Self {
            manifest,
            manifest_digest,
            store,
            memory,
            input_ptr,
            output_ptr,
            invoke,
        }
    }

    /// Invokes a guest of one input role on one sample of it, with `prior_state` as the state it
    /// resumes.
    fn invoke(
        &mut self,
        sample: u64,
        value: i128,
        prior_state: &[u8],
        label: &str,
    ) -> PluginFrameV2 {
        let [port] = self
            .manifest
            .input_ports
            .iter()
            .filter(|port| !port.semantic_id.starts_with(SAMPLE_COORDINATE_PORT_PREFIX))
            .collect::<Vec<_>>()[..]
        else {
            panic!("{label} reads more than one input role");
        };
        let port = port.semantic_id.clone();
        self.invoke_ports(sample, &[(port.as_str(), value)], prior_state, label)
    }

    /// Invokes the guest on one sample of every input role, naming each role's value by its
    /// manifest port; every role's coordinate is the sample's.
    fn invoke_ports(
        &mut self,
        sample: u64,
        values: &[(&str, i128)],
        prior_state: &[u8],
        label: &str,
    ) -> PluginFrameV2 {
        let module_identity = BindingDigest::from_untrusted_bytes([91; 32]);
        let invocation_identity = [u8::try_from(16 + sample).unwrap(); 16];
        let input = PluginFrameV2 {
            kind: PluginFrameKindV2::Input,
            output_availability: None,
            manifest_digest: self.manifest_digest,
            module_identity,
            invocation_identity,
            values: self
                .manifest
                .input_ports
                .iter()
                .map(|port| {
                    if port.semantic_id.starts_with(SAMPLE_COORDINATE_PORT_PREFIX) {
                        TypedValueV2::new(ValueTypeV2::Bytes, canonical_coordinate(sample)).unwrap()
                    } else {
                        let (_, value) = values
                            .iter()
                            .find(|(port_id, _)| *port_id == port.semantic_id)
                            .unwrap_or_else(|| panic!("{label} has no value for {port:?}"));
                        TypedValueV2::i128(*value)
                    }
                })
                .collect(),
            state: TypedValueV2::new(ValueTypeV2::Bytes, prior_state).unwrap(),
        };
        let input_bytes = input.encode(&self.manifest).unwrap();
        self.memory
            .write(&mut self.store, self.input_ptr, &input_bytes)
            .unwrap();
        let output_len = self
            .invoke
            .call(&mut self.store, input_bytes.len() as i32)
            .unwrap();
        assert!(output_len > 0, "{label} sample {sample}: {output_len}");
        let mut output_bytes = vec![0; output_len as usize];
        self.memory
            .read(&self.store, self.output_ptr, &mut output_bytes)
            .unwrap();
        PluginFrameV2::decode_exact(
            &output_bytes,
            PluginFrameKindV2::Output,
            &self.manifest,
            self.manifest_digest,
            module_identity,
            invocation_identity,
        )
        .unwrap_or_else(|e| panic!("{label} sample {sample}: {e}"))
    }
}

/// The manifest port prefix of every input role's Owner sample coordinate.
const SAMPLE_COORDINATE_PORT_PREFIX: &str = "strategy.input.sample-coordinate.v1.";

/// Daily closes, in whole units, whose only bearish divergence is confirmed at bar 14.
///
/// Bars 1 to 7 only rise, so RSI(3) at bar 7 is 100, and bar 7 at 120 is the first order-2 pivot
/// high, confirmed at bar 9. After a pullback bar 12 closes higher at 121 on a smaller gain, so its
/// RSI is below 100: a higher high on a lower RSI, the second pivot, confirmed two bars later at
/// bar 14. Every other bar is below the highest of the five around it.
const DIVERGENCE_CLOSES: [i128; 16] = [
    100, 102, 104, 106, 108, 110, 120, 115, 112, 113, 114, 121, 118, 116, 117, 119,
];

/// The authored program `name` from the declared-meaning corpus, assembled as `declare` does.
fn corpus_program(name: &str) -> (StrategyDesignV2, BoundedFeatureProgramProposalV1) {
    use crate::bounded_feature_program_derivation_v1::{
        BoundedFeatureProgramMeaningV1, derive_bounded_feature_program_proposal_v1,
    };

    let corpus = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/test_data/bounded_feature_program_meaning_v1/"
    );
    let design: StrategyDesignV2 =
        serde_json::from_str(&fs::read_to_string(format!("{corpus}{name}-design.json")).unwrap())
            .unwrap();
    let declared: BoundedFeatureProgramMeaningV1 =
        serde_json::from_str(&fs::read_to_string(format!("{corpus}{name}-meaning.json")).unwrap())
            .unwrap();
    let receipts = design
        .inputs
        .iter()
        .enumerate()
        .map(|(index, role)| {
            let mut bytes = [0x5a_u8; 32];
            bytes[0] = u8::try_from(index).unwrap();
            (role.clone(), BindingDigest::from_untrusted_bytes(bytes))
        })
        .collect();
    let bindings =
        crate::strategy_plan_v2::verified_strategy_input_bindings_for_test(&design, receipts);
    let proposal = derive_bounded_feature_program_proposal_v1(
        &design,
        PrimitiveCatalogV1::verify().unwrap(),
        &declared,
        &bindings,
    )
    .unwrap_or_else(|e| panic!("{name} assembles: {e}"));
    (design, proposal)
}

/// What one run of the divergence program emitted: the bars it exited on, and the previous
/// pivot's close its fixed-point strategy state held after each bar.
struct DivergenceRun {
    first_ready: Option<u64>,
    exits: Vec<u64>,
    carried_close: Vec<i128>,
}

/// Runs `guest` over `closes`. With `frozen_cells`, each named strategy state cell is put back to
/// its initial bytes before every bar, so the program sees its seed where its carried value was.
fn run_divergence(
    guest: &mut BuiltGuest,
    slots: &[(String, usize, usize, Vec<u8>)],
    closes: &[i128],
    frozen_cells: bool,
) -> DivergenceRun {
    let (_, close_start, close_end, _) = slots
        .iter()
        .find(|(state_id, ..)| state_id == "prev_close")
        .expect("the program carries the previous pivot's close");
    let mut state = Vec::new();
    let mut run = DivergenceRun {
        first_ready: None,
        exits: Vec::new(),
        carried_close: Vec::new(),
    };

    for (sample, close) in (1_u64..).zip(closes) {
        if frozen_cells && !state.is_empty() {
            for (_, start, end, initial) in slots {
                state[*start..*end].copy_from_slice(initial);
            }
        }
        let output = guest.invoke(sample, close * 100, &state, "d1");
        let ready = output.output_availability == Some(PluginOutputAvailabilityV3::Ready);

        if ready && run.first_ready.is_none() {
            run.first_ready = Some(sample);
        }

        if ready
            && output
                .values
                .iter()
                .any(|value| value.bytes() == b"kernel.position.exit.v1")
        {
            run.exits.push(sample);
        }
        state = output.state.bytes().to_vec();
        run.carried_close.push(i128::from_le_bytes(
            state[*close_start..*close_end].try_into().unwrap(),
        ));
    }
    run
}

/// A bearish divergence runs through fixed-point strategy state as Wasm, and needs that state.
///
/// `d1` is the first authored program whose strategy state is a fixed-point value rather than a
/// flag: the previous confirmed pivot's close and RSI, rewritten only on a pivot. The validator
/// admitted that shape and the lowerer emitted it, but nothing had built and run it. Here the
/// program exits exactly at bar 14 - the second pivot plus its confirmation lag of two bars, never
/// earlier - and its state holds each pivot's close from the bar that confirms it.
///
/// Two controls give the exit a single cause. A lower high at bar 12 removes the divergence from
/// the prices and the exit goes with it. Putting the two carried cells back to their zero seeds
/// before every bar leaves the prices alone and removes only the memory of the previous pivot,
/// and the exit goes too: the signal is carried by that state, not by the prices around bar 14.
#[rstest::rstest]
#[ignore = "builds and invokes the divergence program with the pinned local wasm compiler"]
fn a_divergence_program_carries_its_previous_pivot_through_fixed_point_state() {
    let (design, proposal) = corpus_program("d1");
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");
    let canonical = crate::bounded_feature_program_v1::parse_bounded_feature_program_v1(
        frozen.program_bytes(),
        &design,
    )
    .expect("frozen program parses");
    let slots: Vec<_> = canonical
        .state_layout()
        .slots()
        .iter()
        .filter(|slot| ["prev_close", "prev_rsi"].contains(&slot.state_id()))
        .map(|slot| {
            let start = slot.offset() as usize;
            (
                slot.state_id().to_owned(),
                start,
                start + slot.width() as usize,
                slot.initial_bytes()
                    .expect("a strategy cell has initial bytes")
                    .to_vec(),
            )
        })
        .collect();
    assert_eq!(slots.len(), 2, "both carried cells are in the layout");
    let root = tempfile::tempdir().expect("private build root");
    let mut guest = BuiltGuest::build(&frozen, root.path(), &root.path().join("target-out"), "d1");

    let divergence = run_divergence(&mut guest, &slots, &DIVERGENCE_CLOSES, false);
    // RSI(3) is ready from bar 4 and its two-bar lag from bar 6, the last node to warm.
    assert_eq!(divergence.first_ready, Some(6));
    assert_eq!(
        divergence.exits,
        [14],
        "the only exit is the second pivot plus two bars"
    );
    assert_eq!(
        divergence.carried_close[7], 0,
        "no pivot is confirmed before bar 9"
    );
    assert_eq!(
        divergence.carried_close[8], 12_000,
        "bar 9 confirms bar 7's close of 120"
    );
    assert_eq!(
        divergence.carried_close[12], 12_000,
        "no pivot between bars 9 and 14"
    );
    assert_eq!(
        divergence.carried_close[13], 12_100,
        "bar 14 confirms bar 12's close of 121"
    );

    let mut lower_high = DIVERGENCE_CLOSES;
    lower_high[11] = 119;
    let without = run_divergence(&mut guest, &slots, &lower_high, false);
    assert_eq!(without.exits, [0_u64; 0], "a lower high is no divergence");
    assert_eq!(
        without.carried_close[13], 11_900,
        "bar 14 still confirms a pivot"
    );

    let forgotten = run_divergence(&mut guest, &slots, &DIVERGENCE_CLOSES, true);
    assert_eq!(
        forgotten.exits, [0_u64; 0],
        "without the previous pivot in state there is nothing to diverge from"
    );
    // The reset removed only that memory: both pivots are still found and written on the bars
    // that confirm them, and read back as the seed on the bar after.
    assert_eq!(forgotten.first_ready, Some(6));
    assert_eq!(forgotten.carried_close[8], 12_000);
    assert_eq!(forgotten.carried_close[9], 0);
    assert_eq!(forgotten.carried_close[13], 12_100);
}

/// Daily highs and lows, in whole units, with three bullish fair value gaps and three returns.
///
/// Gap A forms at bar 3 (low 102 above bar 1's high of 100), B at bar 6 (111 above 109) and C at
/// bar 9 (121 above 120); no other bar's low is above the high two bars back. Until bar 10 every
/// low stays above every gap's upper edge. Then bar 10 trades into C alone (a low of 119), bar 11
/// into B alone (108), and bar 12 into A's interval alone (101).
const FAIR_VALUE_GAP_BARS: [(i128, i128); 12] = [
    (100, 95),
    (105, 96),
    (108, 102),
    (109, 104),
    (112, 106),
    (118, 111),
    (120, 112),
    (122, 115),
    (128, 121),
    (124, 119),
    (116, 108),
    (106, 101),
];

/// What one run of a fair value gap program emitted: the first bar its output was ready, the bars
/// it entered on, and each slot's upper edge after every bar.
struct FairValueGapRun {
    first_ready: Option<u64>,
    entries: Vec<u64>,
    upper_edges: Vec<Vec<i128>>,
}

/// Builds the corpus program `name` and runs it over [`FAIR_VALUE_GAP_BARS`].
fn run_fair_value_gap(name: &str, slots: usize) -> FairValueGapRun {
    let (design, proposal) = corpus_program(name);
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen = freeze_research_bounded_feature_program_v1(&custody, &design, proposal)
        .expect("joint Owner freeze");
    let canonical = crate::bounded_feature_program_v1::parse_bounded_feature_program_v1(
        frozen.program_bytes(),
        &design,
    )
    .expect("frozen program parses");
    let upper_edges: Vec<_> = (1..=slots)
        .map(|slot| {
            let cell = canonical
                .state_layout()
                .slots()
                .iter()
                .find(|cell| cell.state_id() == format!("up{slot}"))
                .expect("every slot's upper edge is in the layout");
            let start = cell.offset() as usize;
            (start, start + cell.width() as usize)
        })
        .collect();
    let root = tempfile::tempdir().expect("private build root");
    let mut guest = BuiltGuest::build(&frozen, root.path(), &root.path().join("target-out"), name);
    let mut state = Vec::new();
    let mut run = FairValueGapRun {
        first_ready: None,
        entries: Vec::new(),
        upper_edges: Vec::new(),
    };

    for (sample, (high, low)) in (1_u64..).zip(FAIR_VALUE_GAP_BARS) {
        let output = guest.invoke_ports(
            sample,
            &[("input.high.v1", high * 100), ("input.low.v1", low * 100)],
            &state,
            name,
        );
        let ready = output.output_availability == Some(PluginOutputAvailabilityV3::Ready);

        if ready && run.first_ready.is_none() {
            run.first_ready = Some(sample);
        }

        if ready
            && output
                .values
                .iter()
                .any(|value| value.bytes() == b"kernel.position.enter.v1")
        {
            run.entries.push(sample);
        }
        state = output.state.bytes().to_vec();
        run.upper_edges.push(
            upper_edges
                .iter()
                .map(|(start, end)| i128::from_le_bytes(state[*start..*end].try_into().unwrap()))
                .collect(),
        );
    }
    run
}

/// A fair value gap program holds its open gaps in fixed slots, and a new gap replaces the oldest
/// only when every slot is open.
///
/// `g2` and `g3` are one program with two and three slots. Three gaps form, each above the last,
/// and every later bar trades into exactly one of them. With two slots the third gap evicts the
/// first, so the bar that trades into the first gap's interval emits nothing; with three slots the
/// same bars keep it, and that bar enters. The two other returns enter under both, which is the
/// control that the eviction, not the price path, is what removes the signal.
#[rstest::rstest]
#[ignore = "builds and invokes the fair value gap programs with the pinned local wasm compiler"]
fn a_fair_value_gap_program_evicts_the_oldest_gap_only_when_its_slots_are_full() {
    let two = run_fair_value_gap("g2", 2);
    let three = run_fair_value_gap("g3", 3);

    // The high two bars back is the last node to warm.
    assert_eq!(two.first_ready, Some(3));
    assert_eq!(three.first_ready, Some(3));

    assert_eq!(
        two.upper_edges[7],
        [11_100, 10_200],
        "A and B fill both slots"
    );
    assert_eq!(
        two.upper_edges[8],
        [12_100, 11_100],
        "C takes a slot and A, the oldest, is gone"
    );
    assert_eq!(
        three.upper_edges[8],
        [12_100, 11_100, 10_200],
        "a third slot keeps A"
    );

    assert_eq!(
        two.entries,
        [10, 11],
        "the return into A's interval finds no gap"
    );
    assert_eq!(
        three.entries,
        [10, 11, 12],
        "the same return enters while A is held"
    );
    assert_eq!(
        three.upper_edges[11],
        [0, 0, 0],
        "each gap is cleared by the bar that trades into it"
    );
}

/// The lowerer keeps its own spelling of a coordinate port id because its source is frozen: the V3
/// build capsule binds the lowerer's source digest, so deleting the copy would re-identify every
/// build and needs a capsule compatibility migration. This holds the copy to the Owner's one
/// spelling in `strategy_plan_v2` instead.
#[rstest::rstest]
fn the_lowerer_s_frozen_coordinate_port_id_is_the_owner_s() {
    for bytes in [
        [0_u8; 32],
        [0xff; 32],
        std::array::from_fn(|index| u8::try_from(index).expect("32 bytes")),
    ] {
        let identity = BindingDigest::from_untrusted_bytes(bytes);
        assert_eq!(
            coordinate_port_id(identity),
            crate::strategy_plan_v2::coordinate_port_id(identity),
        );
    }
}
