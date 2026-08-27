use std::{collections::BTreeSet, sync::Arc};

use async_trait::async_trait;
use rstest::rstest;
use serde_json::{Value, json};
use vibe_data::owner::source_binding::{
    BindingDigest, SourceBindingError, SourceBindingOwnerReadback, SourceBindingOwnerResolver,
    UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
    UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf, UntrustedSourceBindingLocator,
    UntrustedSourceBindingLocatorFields,
};

use crate::{
    complex_strategy_compiler::{
        ComplexStrategyCompilerError, ComplexStrategyOwnerSourceResolverV1,
        ExactSymbolicInputBindingV1, PairSpreadStateCompileInputV1, SymbolicInputBindingReceiptV1,
        compile_from_verified_owner_source_for_test,
    },
    complex_strategy_ir::{
        ComplexStrategyIntentAuthorityV1, ComplexStrategyIrError, ComplexStrategyIrV1,
    },
};

fn digest(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}

fn binding_digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn source_locator(byte: u8) -> UntrustedSourceBindingLocator {
    UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
        owner: "MARKET_DATA".to_owned(),
        lineage_root: binding_digest(byte),
        lineage_version: 1,
        predecessor_binding_id: None,
        predecessor_fact_digest: None,
        binding_id: binding_digest(byte),
        fact_digest: binding_digest(byte.saturating_add(1)),
        credential_handle_identity: binding_digest(byte.saturating_add(2)),
        credential_audience: UntrustedCredentialAudienceClaim::MarketData,
        credential_capabilities: BTreeSet::from([
            UntrustedCredentialCapabilityClaim::MarketDataRead,
        ]),
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".to_owned(),
            cut_identity: "source-cut".to_owned(),
            sequence: 1,
            digest: binding_digest(byte.saturating_add(3)),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".to_owned(),
            cut_identity: "correction-cut".to_owned(),
            sequence: 1,
            digest: binding_digest(byte.saturating_add(4)),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: binding_digest(byte.saturating_add(5)),
            clock_identity: "clock".to_owned(),
            clock_epoch: "epoch-1".to_owned(),
            monotonic_sequence: 1,
            restart_continuity_digest: binding_digest(byte.saturating_add(6)),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 1,
            provider_available: 2,
            retrieval: 3,
            correction_publication: 2,
            observed_at: 4,
            effective_at: 4,
            valid_through: 5,
        },
    })
}

struct UnavailableSourceBindingOwner;

#[async_trait]
impl SourceBindingOwnerResolver for UnavailableSourceBindingOwner {
    async fn resolve_source_binding(
        &self,
        _locator: &UntrustedSourceBindingLocator,
    ) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
        Err(SourceBindingError::StoreUnavailable)
    }
}

fn pair_spread_state() -> Value {
    json!({
        "schema": "complex-strategy-ir-v1",
        "schema_version": 1,
        "intent": {
            "identity": "intent:pair-spread-state",
            "semantic_digest": digest('a')
        },
        "inputs": [
            {
                "id": "left_close",
                "instrument_role": "leg_primary_role",
                "timeframe": "PT1H",
                "field": "CLOSE"
            },
            {
                "id": "right_close",
                "instrument_role": "leg_hedge_role",
                "timeframe": "PT1H",
                "field": "CLOSE"
            }
        ],
        "joins": [{
            "id": "pair_cut",
            "left_input": "left_close",
            "right_input": "right_close",
            "alignment": "EXACT_DECISION_CUT"
        }],
        "parameters": [
            {"id": "flat", "value": {"coefficient": 0, "scale": 0}},
            {"id": "threshold", "value": {"coefficient": 250, "scale": 2}}
        ],
        "features": [
            {"id": "left", "operation": {"kind": "JOIN_LEFT", "join": "pair_cut"}},
            {"id": "right", "operation": {"kind": "JOIN_RIGHT", "join": "pair_cut"}},
            {
                "id": "spread",
                "operation": {"kind": "SUBTRACT", "left": "left", "right": "right"}
            }
        ],
        "state_cells": [{
            "id": "spread_state",
            "initial": {"coefficient": 0, "scale": 0}
        }],
        "transitions": [
            {
                "id": "enter_positive",
                "guards": [{
                    "left": {"kind": "FEATURE", "feature": "spread"},
                    "comparison": "GREATER_THAN_OR_EQUAL",
                    "right": {"kind": "PARAMETER", "parameter": "threshold"}
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE",
                    "state_cell": "spread_state",
                    "value": {"kind": "PARAMETER", "parameter": "threshold"}
                }]
            },
            {
                "id": "exit_flat",
                "guards": [{
                    "left": {"kind": "FEATURE", "feature": "spread"},
                    "comparison": "LESS_THAN",
                    "right": {"kind": "PARAMETER", "parameter": "threshold"}
                }],
                "actions": [{
                    "kind": "ASSIGN_STATE",
                    "state_cell": "spread_state",
                    "value": {"kind": "PARAMETER", "parameter": "flat"}
                }]
            }
        ]
    })
}

fn parse(document: &Value) -> Result<ComplexStrategyIrV1, ComplexStrategyIrError> {
    let authority = ComplexStrategyIntentAuthorityV1::for_test(
        document["intent"]["identity"]
            .as_str()
            .expect("test intent identity"),
        document["intent"]["semantic_digest"]
            .as_str()
            .expect("test intent digest"),
    )?;
    ComplexStrategyIrV1::parse_for_intent(
        &serde_json::to_vec(document).expect("test JSON"),
        &authority,
    )
}

fn binding(
    input_id: &str,
    role: &str,
    channel: &str,
    canonical_identity: &str,
) -> ExactSymbolicInputBindingV1 {
    ExactSymbolicInputBindingV1::for_source_test(
        input_id,
        role,
        "PT1H",
        "CLOSE",
        channel,
        canonical_identity,
    )
}

fn exact_bindings() -> Vec<ExactSymbolicInputBindingV1> {
    vec![
        binding(
            "left_close",
            "leg_primary_role",
            "channel:left",
            &digest('b'),
        ),
        binding(
            "right_close",
            "leg_hedge_role",
            "channel:right",
            &digest('c'),
        ),
    ]
}

#[rstest]
fn canonical_pair_spread_state_builds_exact_compile_input() {
    let ir = parse(&pair_spread_state()).expect("validated pair-spread IR");
    let receipt = SymbolicInputBindingReceiptV1::issue_for_test(&ir, exact_bindings())
        .expect("Owner test binding");
    let compile_input = PairSpreadStateCompileInputV1::from_owner_binding(&ir, &receipt)
        .expect("strict compile input");

    assert_eq!(compile_input.binding_identity(), receipt.binding_identity());
    let compiled: Value = serde_json::from_slice(compile_input.canonical_bytes())
        .expect("canonical compile input JSON");
    assert_eq!(compiled["profile_identity"], "complex-strategy-program-v1");
    assert!(
        compiled["program_identity"]
            .as_str()
            .expect("program identity")
            .starts_with("sha256:")
    );
    assert!(
        compiled["program_bytes_digest"]
            .as_str()
            .expect("program bytes digest")
            .starts_with("sha256:")
    );
}

#[tokio::test]
async fn owner_source_resolver_fails_closed_without_a_sealed_readback() {
    let ir = parse(&pair_spread_state()).expect("validated pair-spread IR");
    let resolver =
        ComplexStrategyOwnerSourceResolverV1::new(Arc::new(UnavailableSourceBindingOwner));

    for locator in [source_locator(1), source_locator(9)] {
        assert!(matches!(
            resolver.resolve_compile_input(&ir, &locator).await,
            Err(ComplexStrategyCompilerError::OwnerSourceBindingUnavailable)
        ));
    }
}

#[rstest]
fn verified_owner_source_token_compiles_every_symbolic_input_without_public_receipt_minting() {
    let ir = parse(&pair_spread_state()).expect("validated pair-spread IR");
    let first = compile_from_verified_owner_source_for_test(&ir, digest('b'))
        .expect("first owner compile input");
    let replay = compile_from_verified_owner_source_for_test(&ir, digest('b'))
        .expect("replayed owner compile input");
    let changed = compile_from_verified_owner_source_for_test(&ir, digest('c'))
        .expect("changed owner compile input");

    assert_eq!(first.canonical_bytes(), replay.canonical_bytes());
    assert_ne!(
        first.compile_plan_identity(),
        changed.compile_plan_identity()
    );
    let canonical: Value =
        serde_json::from_slice(first.canonical_bytes()).expect("canonical compile input JSON");
    let bindings = canonical["exact_bindings"]
        .as_array()
        .expect("exact bindings");
    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(|binding| {
        binding["channel_identity"] == "market-data-owner-source-binding-v1"
            && binding["canonical_input"]["identity"] == digest('b')
    }));
}

#[rstest]
fn binding_receipt_is_self_authenticating_and_ir_scoped() {
    let ir = parse(&pair_spread_state()).expect("validated pair-spread IR");
    let expected = SymbolicInputBindingReceiptV1::issue_for_test(&ir, exact_bindings())
        .expect("expected Owner binding");
    let expected_compile = PairSpreadStateCompileInputV1::from_owner_binding(&ir, &expected)
        .expect("expected compile input");

    let swapped = SymbolicInputBindingReceiptV1::issue_for_test(
        &ir,
        vec![
            binding(
                "left_close",
                "leg_primary_role",
                "channel:right",
                &digest('b'),
            ),
            binding(
                "right_close",
                "leg_hedge_role",
                "channel:left",
                &digest('c'),
            ),
        ],
    )
    .expect("different Owner binding");
    assert_ne!(swapped.binding_identity(), expected.binding_identity());
    let swapped_compile = PairSpreadStateCompileInputV1::from_owner_binding(&ir, &swapped)
        .expect("self-authenticating swapped binding");
    assert_ne!(
        swapped_compile.compile_plan_identity(),
        expected_compile.compile_plan_identity()
    );

    let changed_source = SymbolicInputBindingReceiptV1::issue_for_test(
        &ir,
        vec![
            binding(
                "left_close",
                "leg_primary_role",
                "channel:left",
                &digest('d'),
            ),
            binding(
                "right_close",
                "leg_hedge_role",
                "channel:right",
                &digest('c'),
            ),
        ],
    )
    .expect("changed source binding");
    assert_ne!(
        changed_source.binding_identity(),
        expected.binding_identity()
    );
    let changed_source_compile =
        PairSpreadStateCompileInputV1::from_owner_binding(&ir, &changed_source)
            .expect("self-authenticating changed source binding");
    assert_ne!(
        changed_source_compile.compile_plan_identity(),
        expected_compile.compile_plan_identity()
    );

    let corrupted = expected.with_corrupted_canonical_bytes_for_test();
    assert!(matches!(
        PairSpreadStateCompileInputV1::from_owner_binding(&ir, &corrupted),
        Err(ComplexStrategyCompilerError::BindingCustodyMismatch)
    ));

    let mut changed_ir_document = pair_spread_state();
    changed_ir_document["parameters"][1]["value"]["coefficient"] = json!(300);
    let changed_ir = parse(&changed_ir_document).expect("changed valid pair-spread IR");
    assert!(matches!(
        PairSpreadStateCompileInputV1::from_owner_binding(&changed_ir, &expected),
        Err(ComplexStrategyCompilerError::BindingIrMismatch)
    ));
}

#[rstest]
fn incomplete_extra_or_mismatched_binding_keys_are_rejected() {
    let ir = parse(&pair_spread_state()).expect("validated pair-spread IR");

    let mut missing = exact_bindings();
    missing.remove(0);
    let mut cases = vec![missing];
    let mut extra = exact_bindings();
    extra.push(binding(
        "hidden_close",
        "leg_hidden_role",
        "channel:hidden",
        &digest('d'),
    ));
    cases.push(extra);
    let mut duplicate = exact_bindings();
    duplicate.push(binding(
        "left_close",
        "leg_primary_role",
        "channel:left-duplicate",
        &digest('e'),
    ));
    assert!(matches!(
        SymbolicInputBindingReceiptV1::issue_for_test(&ir, duplicate),
        Err(ComplexStrategyCompilerError::DuplicateBindingKey)
    ));

    for replacement in [
        binding("left_close", "leg_wrong_role", "channel:left", &digest('b')),
        ExactSymbolicInputBindingV1::for_source_test(
            "left_close",
            "leg_primary_role",
            "PT5M",
            "CLOSE",
            "channel:left",
            &digest('b'),
        ),
        ExactSymbolicInputBindingV1::for_fixture_test(
            "left_close",
            "leg_primary_role",
            "PT1H",
            "OPEN",
            "channel:left",
            &digest('b'),
        ),
    ] {
        let mut mismatched = exact_bindings();
        mismatched[0] = replacement;
        cases.push(mismatched);
    }

    for bindings in cases {
        assert!(matches!(
            SymbolicInputBindingReceiptV1::issue_for_test(&ir, bindings),
            Err(ComplexStrategyCompilerError::BindingCoverageMismatch)
        ));
    }
}

#[rstest]
fn broader_ir_shapes_compile_instead_of_being_partially_projected() {
    let mut extra_feature = pair_spread_state();
    extra_feature["features"]
        .as_array_mut()
        .expect("features")
        .push(json!({
            "id": "ignored",
            "operation": {"kind": "NEGATE", "operand": "spread"}
        }));
    let extra_feature = parse(&extra_feature).expect("valid broader IR");
    let receipt = SymbolicInputBindingReceiptV1::issue_for_test(&extra_feature, exact_bindings())
        .expect("broader feature binding");
    let broader = PairSpreadStateCompileInputV1::from_owner_binding(&extra_feature, &receipt)
        .expect("broader feature program");

    let mut wrong_join = pair_spread_state();
    wrong_join["joins"][0]["alignment"] = json!("LATEST_AT_OR_BEFORE_DECISION_CUT");
    let wrong_join = parse(&wrong_join).expect("valid non-exact join IR");
    let receipt = SymbolicInputBindingReceiptV1::issue_for_test(&wrong_join, exact_bindings())
        .expect("latest-at-or-before binding");
    let latest = PairSpreadStateCompileInputV1::from_owner_binding(&wrong_join, &receipt)
        .expect("latest-at-or-before program");
    assert_ne!(broader.program().identity(), latest.program().identity());
}

#[rstest]
fn declaration_and_binding_order_preserve_receipt_and_compile_bytes() {
    let original_document = pair_spread_state();
    let mut reordered_document = original_document.clone();
    for declaration in ["inputs", "joins", "parameters", "features", "state_cells"] {
        reordered_document[declaration]
            .as_array_mut()
            .expect("declaration array")
            .reverse();
    }
    let original_ir = parse(&original_document).expect("original IR");
    let reordered_ir = parse(&reordered_document).expect("reordered IR");

    let original_receipt =
        SymbolicInputBindingReceiptV1::issue_for_test(&original_ir, exact_bindings())
            .expect("original receipt");
    let mut reversed_bindings = exact_bindings();
    reversed_bindings.reverse();
    let reordered_receipt =
        SymbolicInputBindingReceiptV1::issue_for_test(&reordered_ir, reversed_bindings)
            .expect("reordered receipt");
    assert_eq!(
        original_receipt.canonical_bytes(),
        reordered_receipt.canonical_bytes()
    );

    let original_compile =
        PairSpreadStateCompileInputV1::from_owner_binding(&original_ir, &original_receipt)
            .expect("original compile input");
    let reordered_compile =
        PairSpreadStateCompileInputV1::from_owner_binding(&reordered_ir, &reordered_receipt)
            .expect("reordered compile input");
    assert_eq!(
        original_compile.canonical_bytes(),
        reordered_compile.canonical_bytes()
    );
}
