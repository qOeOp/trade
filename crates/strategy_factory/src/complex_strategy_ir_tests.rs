use crate::complex_strategy_ir::{
    COMPLEX_STRATEGY_IR_SCHEMA_V1, COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1,
    ComplexStrategyIntentAuthorityV1, ComplexStrategyIrError, ComplexStrategyIrV1,
};
use rstest::rstest;
use serde_json::{Value, json};

fn digest(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}

fn feature(id: &str, operation: Value) -> Value {
    let mut node = json!({"id": id});
    node["operation"] = operation;
    node
}

fn value(kind: &str, name: &str) -> Value {
    match kind {
        "FEATURE" => json!({"kind": "FEATURE", "feature": name}),
        "PARAMETER" => json!({"kind": "PARAMETER", "parameter": name}),
        "STATE" => json!({"kind": "STATE", "state_cell": name}),
        _ => unreachable!("test value kind"),
    }
}

pub(crate) fn dual_tsmom() -> Value {
    json!({
        "schema": "complex-strategy-ir-v1",
        "schema_version": 1,
        "intent": {"identity": "intent:dual-tsmom", "semantic_digest": digest('a')},
        "inputs": [
            {"id": "secondary_close", "instrument_role": "leg_eth_role", "timeframe": "P1D", "field": "CLOSE"},
            {"id": "primary_close", "instrument_role": "leg_btc_role", "timeframe": "P1D", "field": "CLOSE"}
        ],
        "joins": [],
        "parameters": [
            {"id": "flat", "value": {"coefficient": 0, "scale": 0}},
            {"id": "short", "value": {"coefficient": -1, "scale": 0}},
            {"id": "long", "value": {"coefficient": 1, "scale": 0}}
        ],
        "features": [
            feature("secondary_price", json!({"kind": "INPUT", "input": "secondary_close"})),
            feature("primary_lag", json!({"kind": "LAG", "operand": "primary_price", "periods": 90})),
            feature("primary_price", json!({"kind": "INPUT", "input": "primary_close"})),
            feature("secondary_return", json!({
                "kind": "DIVIDE", "numerator": "secondary_momentum", "denominator": "secondary_lag",
                "zero_denominator": {"kind": "REJECT_EVALUATION"}
            })),
            feature("primary_momentum", json!({"kind": "SUBTRACT", "left": "primary_price", "right": "primary_lag"})),
            feature("secondary_lag", json!({"kind": "LAG", "operand": "secondary_price", "periods": 90})),
            feature("primary_return", json!({
                "kind": "DIVIDE", "numerator": "primary_momentum", "denominator": "primary_lag",
                "zero_denominator": {"kind": "REJECT_EVALUATION"}
            })),
            feature("secondary_momentum", json!({"kind": "SUBTRACT", "left": "secondary_price", "right": "secondary_lag"})),
            feature("combined_momentum", json!({"kind": "ADD", "left": "primary_return", "right": "secondary_return"}))
        ],
        "state_cells": [{"id": "regime", "initial": {"coefficient": 0, "scale": 0}}],
        "transitions": [
            {
                "id": "enter_long",
                "guards": [{
                    "left": value("FEATURE", "combined_momentum"),
                    "comparison": "GREATER_THAN",
                    "right": value("PARAMETER", "flat")
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE", "state_cell": "regime", "value": value("PARAMETER", "long")
                }]
            },
            {
                "id": "enter_short",
                "guards": [{
                    "left": value("FEATURE", "combined_momentum"),
                    "comparison": "LESS_THAN",
                    "right": value("PARAMETER", "flat")
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE", "state_cell": "regime", "value": value("PARAMETER", "short")
                }]
            }
        ]
    })
}

pub(crate) fn pair_mean_reversion() -> Value {
    json!({
        "schema": "complex-strategy-ir-v1",
        "schema_version": 1,
        "intent": {"identity": "intent:pair-mean-reversion", "semantic_digest": digest('b')},
        "inputs": [
            {"id": "pair_left", "instrument_role": "leg_primary_role", "timeframe": "PT1H", "field": "CLOSE"},
            {"id": "pair_right", "instrument_role": "leg_hedge_role", "timeframe": "PT1H", "field": "CLOSE"}
        ],
        "joins": [{
            "id": "hourly_pair", "left_input": "pair_left", "right_input": "pair_right",
            "alignment": "EXACT_DECISION_CUT"
        }],
        "parameters": [
            {"id": "entry_z", "value": {"coefficient": 200, "scale": 2}},
            {"id": "negative_entry_z", "value": {"coefficient": -200, "scale": 2}},
            {"id": "long_spread", "value": {"coefficient": 1, "scale": 0}},
            {"id": "short_spread", "value": {"coefficient": -1, "scale": 0}},
            {"id": "flat", "value": {"coefficient": 0, "scale": 0}}
        ],
        "features": [
            feature("left", json!({"kind": "JOIN_LEFT", "join": "hourly_pair"})),
            feature("right", json!({"kind": "JOIN_RIGHT", "join": "hourly_pair"})),
            feature("spread", json!({"kind": "SUBTRACT", "left": "left", "right": "right"})),
            feature("spread_mean", json!({"kind": "ROLLING_MEAN", "operand": "spread", "window": 120})),
            feature("spread_std", json!({"kind": "ROLLING_STD_DEV", "operand": "spread", "window": 120})),
            feature("centered", json!({"kind": "SUBTRACT", "left": "spread", "right": "spread_mean"})),
            feature("zscore", json!({
                "kind": "DIVIDE", "numerator": "centered", "denominator": "spread_std",
                "zero_denominator": {"kind": "RETURN_ZERO"}
            }))
        ],
        "state_cells": [{"id": "spread_regime", "initial": {"coefficient": 0, "scale": 0}}],
        "transitions": [
            {
                "id": "short_rich_spread",
                "guards": [{
                    "left": value("FEATURE", "zscore"), "comparison": "GREATER_THAN_OR_EQUAL",
                    "right": value("PARAMETER", "entry_z")
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE", "state_cell": "spread_regime",
                    "value": value("PARAMETER", "short_spread")
                }]
            },
            {
                "id": "long_cheap_spread",
                "guards": [{
                    "left": value("FEATURE", "zscore"), "comparison": "LESS_THAN_OR_EQUAL",
                    "right": value("PARAMETER", "negative_entry_z")
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE", "state_cell": "spread_regime",
                    "value": value("PARAMETER", "long_spread")
                }]
            },
            {
                "id": "close_at_mean",
                "guards": [{
                    "left": value("FEATURE", "zscore"), "comparison": "EQUAL",
                    "right": value("PARAMETER", "flat")
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE", "state_cell": "spread_regime",
                    "value": value("PARAMETER", "flat")
                }]
            }
        ]
    })
}

pub(crate) fn parse(document: &Value) -> Result<ComplexStrategyIrV1, ComplexStrategyIrError> {
    let authority = ComplexStrategyIntentAuthorityV1::for_test(
        document["intent"]["identity"]
            .as_str()
            .expect("test Intent identity"),
        document["intent"]["semantic_digest"]
            .as_str()
            .expect("test Intent digest"),
    )?;
    ComplexStrategyIrV1::parse_for_intent(
        &serde_json::to_vec(document).expect("test JSON"),
        &authority,
    )
}

fn dependency_first_feature_chain(depth: usize) -> Value {
    assert!(depth > 0, "test feature chain must be non-empty");
    let mut document = dual_tsmom();
    let mut features = Vec::with_capacity(depth);
    features.push(feature(
        "chain-000",
        json!({"kind": "INPUT", "input": "primary_close"}),
    ));

    for index in 1..depth {
        features.push(feature(
            &format!("chain-{index:03}"),
            json!({"kind": "NEGATE", "operand": format!("chain-{:03}", index - 1)}),
        ));
    }
    document["features"] = Value::Array(features);
    let terminal = format!("chain-{:03}", depth - 1);

    for transition in document["transitions"]
        .as_array_mut()
        .expect("ordered transitions")
    {
        transition["guards"][0]["left"] = value("FEATURE", &terminal);
    }
    document
}

#[rstest]
fn public_api_accepts_materially_different_strategy_meanings() {
    let momentum_document = dual_tsmom();
    let momentum = parse(&momentum_document).expect("dual TSMOM IR");
    let pair = parse(&pair_mean_reversion()).expect("pair mean reversion IR");
    let mut five_role_document = momentum_document;
    five_role_document["inputs"]
        .as_array_mut()
        .expect("symbolic inputs")
        .extend([
            json!({"id": "macro_close", "instrument_role": "leg_macro_role", "timeframe": "P1D", "field": "CLOSE"}),
            json!({"id": "defensive_close", "instrument_role": "leg_defensive_role", "timeframe": "P1D", "field": "CLOSE"}),
            json!({"id": "carry_close", "instrument_role": "leg_carry_role", "timeframe": "P1D", "field": "CLOSE"}),
        ]);
    let five_role_basket = parse(&five_role_document).expect("five-role symbolic basket IR");

    assert_eq!(momentum.schema(), COMPLEX_STRATEGY_IR_SCHEMA_V1);
    assert_eq!(
        momentum.schema_version(),
        COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1
    );
    assert_eq!(momentum.intent_identity(), "intent:dual-tsmom");
    assert_eq!(momentum.intent_semantic_digest(), digest('a'));
    assert!(momentum.semantic_digest().starts_with("sha256:"));
    assert_ne!(momentum.semantic_digest(), pair.semantic_digest());
    assert_ne!(
        momentum.semantic_digest(),
        five_role_basket.semantic_digest()
    );
    assert!(momentum.canonical_bytes().ends_with(b"\n"));
}

#[rstest]
fn declaration_order_does_not_change_canonical_identity() {
    let original = dual_tsmom();
    let mut reordered = original.clone();

    for name in [
        "inputs",
        "parameters",
        "features",
        "state_cells",
        "joins",
        "transitions",
    ] {
        reordered[name]
            .as_array_mut()
            .expect("declaration array")
            .reverse();
    }

    let original = parse(&original).expect("original IR");
    let reordered = parse(&reordered).expect("reordered IR");
    assert_eq!(original.canonical_bytes(), reordered.canonical_bytes());
    assert_eq!(original.semantic_digest(), reordered.semantic_digest());
}

#[rstest]
fn behavior_change_changes_semantic_identity() {
    let original = pair_mean_reversion();
    let mut changed = original.clone();
    changed["features"][3]["operation"]["window"] = json!(121);

    let original = parse(&original).expect("original IR");
    let changed = parse(&changed).expect("changed IR");
    assert_ne!(original.canonical_bytes(), changed.canonical_bytes());
    assert_ne!(original.semantic_digest(), changed.semantic_digest());
}

#[rstest]
fn unknown_fields_and_floats_are_rejected() {
    for forbidden in [
        "source",
        "import",
        "path",
        "command",
        "provider",
        "dependency",
        "credential",
        "network",
        "deployment",
        "backtest",
        "qualification",
        "trading",
        "effect",
    ] {
        let mut unknown = dual_tsmom();
        unknown[forbidden] = json!("forbidden");
        assert!(matches!(
            parse(&unknown),
            Err(ComplexStrategyIrError::InvalidJson(_))
        ));
    }

    let mut float = dual_tsmom();
    float["parameters"][0]["value"]["coefficient"] = json!(1.5);
    assert!(matches!(
        parse(&float),
        Err(ComplexStrategyIrError::InvalidJson(_))
    ));

    let mut invalid_role = dual_tsmom();
    invalid_role["inputs"][0]["instrument_role"] = json!("not a safe role");
    assert!(matches!(
        parse(&invalid_role),
        Err(ComplexStrategyIrError::InvalidField { .. })
    ));

    let mut unsupported_opcode = dual_tsmom();
    unsupported_opcode["features"][0]["operation"] = json!({"kind": "NETWORK_FETCH"});
    assert!(matches!(
        parse(&unsupported_opcode),
        Err(ComplexStrategyIrError::InvalidJson(_))
    ));

    let mut effect_action = dual_tsmom();
    effect_action["transitions"][0]["actions"][0] = json!({
        "kind": "SUBMIT_ORDER",
        "instrument": "caller-selected"
    });
    assert!(matches!(
        parse(&effect_action),
        Err(ComplexStrategyIrError::InvalidJson(_))
    ));
}

#[rstest]
fn duplicate_declarations_and_meanings_are_rejected() {
    let mut duplicate_id = dual_tsmom();
    duplicate_id["inputs"][1]["id"] = json!("secondary_close");
    assert!(matches!(
        parse(&duplicate_id),
        Err(ComplexStrategyIrError::DuplicateDeclaration { .. })
    ));

    let mut duplicate_meaning = dual_tsmom();
    duplicate_meaning["inputs"][1]["instrument_role"] = json!("leg_eth_role");
    assert!(matches!(
        parse(&duplicate_meaning),
        Err(ComplexStrategyIrError::DuplicateDeclaration { .. })
    ));
}

#[rstest]
fn cycles_and_unbound_references_are_rejected() {
    let mut cycle = dual_tsmom();
    cycle["features"][2]["operation"] = json!({"kind": "NEGATE", "operand": "primary_lag"});
    assert!(matches!(
        parse(&cycle),
        Err(ComplexStrategyIrError::FeatureCycle { .. })
    ));

    let mut unbound = dual_tsmom();
    unbound["features"][0]["operation"] = json!({"kind": "INPUT", "input": "missing"});
    assert!(matches!(
        parse(&unbound),
        Err(ComplexStrategyIrError::UnboundReference { .. })
    ));
}

#[rstest]
fn bounds_are_enforced() {
    parse(&dependency_first_feature_chain(64)).expect("feature depth exactly at bound");
    assert!(matches!(
        parse(&dependency_first_feature_chain(65)),
        Err(ComplexStrategyIrError::FeatureDepth)
    ));

    let mut too_many = dual_tsmom();
    too_many["transitions"] = Value::Array(
        (0..129)
            .map(|index| {
                json!({
                    "id": format!("transition-{index}"),
                    "guards": [{
                        "left": value("FEATURE", "combined_momentum"), "comparison": "EQUAL",
                        "right": value("PARAMETER", "flat")
                    }],
                    "actions": [{
                        "kind": "ASSIGN_STATE", "state_cell": "regime",
                        "value": value("PARAMETER", "flat")
                    }]
                })
            })
            .collect(),
    );
    assert!(matches!(
        parse(&too_many),
        Err(ComplexStrategyIrError::BoundExceeded { .. })
    ));

    let oversized = vec![b' '; 64 * 1024 + 1];
    let authority = ComplexStrategyIntentAuthorityV1::for_test("intent:oversized", &digest('c'))
        .expect("test authority");
    assert!(matches!(
        ComplexStrategyIrV1::parse_for_intent(&oversized, &authority),
        Err(ComplexStrategyIrError::DocumentSize)
    ));
}

#[rstest]
fn frozen_intent_identity_and_digest_must_match_expected_authority() {
    let document = dual_tsmom();
    let bytes = serde_json::to_vec(&document).expect("test JSON");
    let different_identity = ComplexStrategyIntentAuthorityV1::for_test(
        "intent:different",
        document["intent"]["semantic_digest"]
            .as_str()
            .expect("test Intent digest"),
    )
    .expect("test authority");

    assert!(matches!(
        ComplexStrategyIrV1::parse_for_intent(&bytes, &different_identity),
        Err(ComplexStrategyIrError::IntentBindingMismatch)
    ));
    let different_digest = ComplexStrategyIntentAuthorityV1::for_test(
        document["intent"]["identity"]
            .as_str()
            .expect("test Intent identity"),
        &digest('d'),
    )
    .expect("test authority");
    assert!(matches!(
        ComplexStrategyIrV1::parse_for_intent(&bytes, &different_digest),
        Err(ComplexStrategyIrError::IntentBindingMismatch)
    ));
    assert!(matches!(
        ComplexStrategyIntentAuthorityV1::for_test("invalid/identity", &digest('a')),
        Err(ComplexStrategyIrError::InvalidField { .. })
    ));
    assert!(matches!(
        ComplexStrategyIntentAuthorityV1::for_test("intent:dual-tsmom", "sha256:invalid"),
        Err(ComplexStrategyIrError::InvalidField { .. })
    ));
}

#[rstest]
fn caller_cannot_rebind_authority_to_a_tampered_document_intent() {
    let accepted = dual_tsmom();
    let authority = ComplexStrategyIntentAuthorityV1::for_test(
        accepted["intent"]["identity"]
            .as_str()
            .expect("accepted Intent identity"),
        accepted["intent"]["semantic_digest"]
            .as_str()
            .expect("accepted Intent digest"),
    )
    .expect("test authority");
    let mut tampered = accepted;
    tampered["intent"] = json!({
        "identity": "intent:caller-selected",
        "semantic_digest": digest('e'),
    });

    assert!(matches!(
        ComplexStrategyIrV1::parse_for_intent(
            &serde_json::to_vec(&tampered).expect("test JSON"),
            &authority,
        ),
        Err(ComplexStrategyIrError::IntentBindingMismatch)
    ));
}

#[rstest]
fn division_requires_an_explicit_zero_denominator_policy() {
    let mut missing = pair_mean_reversion();
    missing["features"][6]["operation"]
        .as_object_mut()
        .expect("division operation")
        .remove("zero_denominator");
    assert!(matches!(
        parse(&missing),
        Err(ComplexStrategyIrError::InvalidJson(_))
    ));
}

#[rstest]
fn ambiguous_duplicate_state_assignments_are_rejected_before_lowering() {
    let mut duplicate = dual_tsmom();
    let action = duplicate["transitions"][0]["actions"][0].clone();
    duplicate["transitions"][0]["actions"]
        .as_array_mut()
        .expect("transition actions")
        .push(action);

    assert!(matches!(
        parse(&duplicate),
        Err(ComplexStrategyIrError::InvalidField {
            field: "transitions.actions.state_cell"
        })
    ));
}
