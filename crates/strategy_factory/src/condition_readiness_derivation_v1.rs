//! Derives, from one frozen bounded feature program, the tick at which each decision condition
//! first becomes evaluable and the rule that fixes it.
//!
//! The program already knows this. Every primitive names a published availability rule, and every
//! rule is a function of one frozen parameter, so the first evaluable tick of a condition is the
//! longest warmup in its dependency closure. Reading it here rather than observing it at runtime
//! keeps the answer available before a replay runs, and it carries the reason a run cannot: which
//! node imposed the wait, under which rule, for which window.
//!
//! Nothing here observes a run and nothing here judges whether a wait is acceptable.

use std::collections::BTreeMap;

use vibe_backtest_owner_contracts::condition_readiness::{
    ConditionReadinessCensusV1, ConditionReadinessFaultV1, ConditionReadinessV1,
    ConditionWarmupRuleV1,
};
use vibe_indicators_kernel::{CatalogAvailabilityRuleV1, PrimitiveCatalogV1};

use crate::bounded_feature_program_v1::{
    BoundedFeatureNodeV1, BoundedFeatureParametersV1, BoundedFeatureProposalDecisionTableV1,
    BoundedFeatureValueRefV1,
};

/// The first rule a program does not let this derivation satisfy.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ConditionReadinessDerivationErrorV1 {
    #[error("the primitive catalog does not verify")]
    Catalog,
    #[error("node {node_id} names a primitive the catalog does not publish")]
    UnknownPrimitive { node_id: String },
    #[error("node {node_id} pairs availability rule {rule} with parameters it does not read")]
    RuleParameterMismatch { node_id: String, rule: String },
    #[error("a decision branch reads {reference}, which the program does not produce")]
    UnknownReference { reference: String },
    #[error("the program's value graph reaches {node_id} through itself")]
    Cyclic { node_id: String },
    #[error("the derived census does not satisfy its own rules: {0}")]
    Census(#[from] ConditionReadinessFaultV1),
}

/// One node's own rule, before its inputs are taken into account.
fn node_rule(
    availability: CatalogAvailabilityRuleV1,
    parameters: &BoundedFeatureParametersV1,
    node_id: &str,
) -> Result<ConditionWarmupRuleV1, ConditionReadinessDerivationErrorV1> {
    let mismatch = || ConditionReadinessDerivationErrorV1::RuleParameterMismatch {
        node_id: node_id.to_owned(),
        rule: format!("{availability:?}"),
    };

    match availability {
        // A rule that reads no parameter says the node is evaluable from its first sample. `Atr`
        // reaches here while carrying a period: the period sets its smoothing coefficient and its
        // state size, and not when it first produces a value.
        CatalogAvailabilityRuleV1::ReadyInputs | CatalogAvailabilityRuleV1::FirstSample => {
            Ok(ConditionWarmupRuleV1::ReadyFromFirstSample)
        }
        CatalogAvailabilityRuleV1::PreviousClose => Ok(ConditionWarmupRuleV1::PreviousClose),
        CatalogAvailabilityRuleV1::FullWindow => match parameters {
            BoundedFeatureParametersV1::Window { window, .. }
            | BoundedFeatureParametersV1::WindowAndOutputScale { window, .. } => {
                Ok(ConditionWarmupRuleV1::FullWindow { window: *window })
            }
            _ => Err(mismatch()),
        },
        CatalogAvailabilityRuleV1::LagOffsetPlusOne => match parameters {
            BoundedFeatureParametersV1::Lag { offset, .. } => {
                Ok(ConditionWarmupRuleV1::LagOffsetPlusOne { offset: *offset })
            }
            _ => Err(mismatch()),
        },
        CatalogAvailabilityRuleV1::PeriodPlusOne => match parameters {
            BoundedFeatureParametersV1::PeriodAndOutputScale { period, .. }
            | BoundedFeatureParametersV1::Period { period, .. } => {
                Ok(ConditionWarmupRuleV1::PeriodPlusOne { period: *period })
            }
            _ => Err(mismatch()),
        },
        // A non-executable availability cannot appear on a node the lowerer accepts, so a program
        // that reaches here is one this derivation must refuse rather than guess for.
        CatalogAvailabilityRuleV1::Policy | CatalogAvailabilityRuleV1::LifecycleOwned => {
            Err(mismatch())
        }
    }
}

/// What a value costs to become evaluable, and which node imposed that cost.
#[derive(Clone, Copy)]
struct Readiness {
    tick: u32,
    rule: ConditionWarmupRuleV1,
}

fn reference_key(reference: &BoundedFeatureValueRefV1) -> String {
    match reference {
        BoundedFeatureValueRefV1::InputValue { input_role_id } => format!("i:{input_role_id}"),
        BoundedFeatureValueRefV1::InputCoordinate { input_role_id } => {
            format!("c:{input_role_id}")
        }
        BoundedFeatureValueRefV1::Constant { constant_id } => format!("k:{constant_id}"),
        BoundedFeatureValueRefV1::PriorState { state_id } => format!("s:{state_id}"),
        BoundedFeatureValueRefV1::NodeOutput { node_id, port_id } => {
            format!("n:{node_id}:{port_id}")
        }
    }
}

/// Derives the readiness census of every decision condition in one frozen program.
///
/// The graph and the decision table are taken separately because a frozen program and the meaning
/// it was derived from carry the same two, and both are worth deriving from. A table naming a
/// predicate these nodes do not produce is refused rather than skipped, so passing a mismatched
/// pair fails closed.
///
/// # Errors
///
/// Returns the first program rule this derivation cannot satisfy, including a census that does not
/// satisfy its own vocabulary.
pub fn derive_condition_readiness_census_v1(
    nodes: &[BoundedFeatureNodeV1],
    decision_table: &BoundedFeatureProposalDecisionTableV1,
) -> Result<ConditionReadinessCensusV1, ConditionReadinessDerivationErrorV1> {
    let catalog =
        PrimitiveCatalogV1::verify().map_err(|_| ConditionReadinessDerivationErrorV1::Catalog)?;

    // A node's readiness needs its inputs' readiness, and the program's nodes are frozen in
    // dependency order, so one forward pass fills every node. A reference that is still missing
    // afterwards is one the program does not produce, which is a refusal rather than a default.
    let mut resolved: BTreeMap<String, (Readiness, String)> = BTreeMap::new();

    for node in nodes {
        let row = catalog.row(&node.primitive_semantic_id).ok_or_else(|| {
            ConditionReadinessDerivationErrorV1::UnknownPrimitive {
                node_id: node.node_id.clone(),
            }
        })?;
        let own = node_rule(row.contract().availability, &node.parameters, &node.node_id)?;

        // Every input must already be resolved. An input this pass has not reached is either a
        // raw input, a constant or a prior state, each of which is evaluable at the first sample,
        // or it is a forward reference the program should not contain.
        let mut inputs_tick = 1_u32;
        let mut binding = (
            Readiness {
                tick: own.earliest_tick(),
                rule: own,
            },
            node.node_id.clone(),
        );
        // A raw input, a constant and a prior state are all evaluable at the first sample: the
        // guest decodes a prior Boolean or fixed state into a ready value with no warming branch,
        // so none of them can impose a wait and only a node output is worth resolving.
        for input in &node.input_bindings {
            if let BoundedFeatureValueRefV1::NodeOutput { node_id, .. } = &input.source {
                let key = reference_key(&input.source);
                let (readiness, imposer) = resolved.get(&key).ok_or_else(|| {
                    ConditionReadinessDerivationErrorV1::Cyclic {
                        node_id: node_id.clone(),
                    }
                })?;

                if readiness.tick > inputs_tick {
                    inputs_tick = readiness.tick;
                    binding = (*readiness, imposer.clone());
                }
            }
        }

        let tick = inputs_tick
            .saturating_add(own.earliest_tick())
            .saturating_sub(1);

        if tick > binding.0.tick {
            binding = (Readiness { tick, rule: own }, node.node_id.clone());
        }

        for port in &node.output_ports {
            let key = reference_key(&BoundedFeatureValueRefV1::NodeOutput {
                node_id: node.node_id.clone(),
                port_id: port.port_id.clone(),
            });
            resolved.insert(
                key,
                (
                    Readiness {
                        tick,
                        rule: binding.0.rule,
                    },
                    binding.1.clone(),
                ),
            );
        }
    }

    let mut conditions = Vec::with_capacity(decision_table.branches.len());
    for branch in &decision_table.branches {
        let key = reference_key(&branch.predicate);
        let (readiness, imposer) = resolved.get(&key).ok_or_else(|| {
            ConditionReadinessDerivationErrorV1::UnknownReference {
                reference: key.clone(),
            }
        })?;
        let condition_node_id = match &branch.predicate {
            BoundedFeatureValueRefV1::NodeOutput { node_id, .. } => node_id.clone(),
            other => reference_key(other),
        };
        conditions.push(ConditionReadinessV1 {
            condition_node_id,
            branch_priority: branch.priority,
            expected_ready_tick: readiness.tick,
            binding_rule: readiness.rule,
            binding_node_id: imposer.clone(),
        });
    }

    let census = ConditionReadinessCensusV1 {
        schema_version: 1,
        conditions,
    };
    census.validate()?;
    Ok(census)
}

#[cfg(test)]
mod tests {
    use vibe_backtest_owner_contracts::condition_readiness::ConditionWarmupRuleV1;

    use super::{ConditionReadinessDerivationErrorV1, derive_condition_readiness_census_v1};
    use crate::bounded_feature_program_v1::{
        BoundedFeatureAvailabilityV1, BoundedFeatureInputBindingV1, BoundedFeatureNodeV1,
        BoundedFeatureOutputPortV1, BoundedFeatureParametersV1,
        BoundedFeatureProposalDecisionBranchV1, BoundedFeatureProposalDecisionTableV1,
        BoundedFeatureProposalFrameV1, BoundedFeatureRoundingV1, BoundedFeatureValueRefV1,
        BoundedFeatureValueTypeV1,
    };

    const COMPARE: &str = "bfp.fixed-i128.compare.equal-scale.v1";
    const MEAN: &str = "bfp.rolling.mean.full-window.toward-zero.v1";
    const LAG: &str = "bfp.lag.coordinate.offset.full-history.v1";
    const ATR: &str = "bfp.atr.true-range.wilder-first-sample.toward-zero.v1";

    fn node(
        node_id: &str,
        semantic_id: &str,
        sources: &[BoundedFeatureValueRefV1],
        parameters: BoundedFeatureParametersV1,
        value_type: BoundedFeatureValueTypeV1,
    ) -> BoundedFeatureNodeV1 {
        BoundedFeatureNodeV1 {
            node_id: node_id.to_owned(),
            primitive_semantic_id: semantic_id.to_owned(),
            input_bindings: sources
                .iter()
                .enumerate()
                .map(|(index, source)| BoundedFeatureInputBindingV1 {
                    port_id: format!("in{index}"),
                    source: source.clone(),
                    require_ready: false,
                })
                .collect(),
            output_ports: vec![BoundedFeatureOutputPortV1 {
                port_id: "value".to_owned(),
                value_type,
                availability: BoundedFeatureAvailabilityV1::Ready,
            }],
            parameters,
            state_id: None,
            update_clock: None,
        }
    }

    fn role(name: &str) -> BoundedFeatureValueRefV1 {
        BoundedFeatureValueRefV1::InputValue {
            input_role_id: name.to_owned(),
        }
    }

    fn output(node_id: &str) -> BoundedFeatureValueRefV1 {
        BoundedFeatureValueRefV1::NodeOutput {
            node_id: node_id.to_owned(),
            port_id: "value".to_owned(),
        }
    }

    /// The derivation reads the branch's predicate and priority and never its frame, so an empty
    /// frame keeps these programs to the part under test.
    fn table(predicates: &[(&str, u16)]) -> BoundedFeatureProposalDecisionTableV1 {
        let frame = || BoundedFeatureProposalFrameV1 {
            terminal_outputs: vec![],
        };
        BoundedFeatureProposalDecisionTableV1 {
            branches: predicates
                .iter()
                .map(
                    |(node_id, priority)| BoundedFeatureProposalDecisionBranchV1 {
                        priority: *priority,
                        predicate: output(node_id),
                        frame: frame(),
                    },
                )
                .collect(),
            default_frame: frame(),
        }
    }

    fn window(value: u32) -> BoundedFeatureParametersV1 {
        BoundedFeatureParametersV1::WindowAndOutputScale {
            window: value,
            output_scale: 8,
            rounding: Some(BoundedFeatureRoundingV1::TowardZero),
        }
    }

    /// The only bounded feature corpus this repository carries lives behind
    /// `sealed-strategy-input-acceptance`, which `sealed-develop-composer-acceptance` enables and
    /// the ordered chain therefore compiles.
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[rstest::rstest]
    fn the_admitted_corpus_has_no_condition_that_waits() {
        let design =
            crate::bounded_feature_program_six_role_bar_fixture_v1::six_role_bar_bounded_feature_design_v1();
        let meaning =
            crate::bounded_feature_program_six_role_bar_fixture_v1::six_role_bar_bounded_feature_meaning_v1(&design);
        let census =
            derive_condition_readiness_census_v1(&meaning.nodes, &meaning.proposal_decision_table)
                .expect("the admitted corpus derives");

        assert_eq!(census.conditions.len(), 3);
        for condition in &census.conditions {
            assert_eq!(
                condition.binding_rule,
                ConditionWarmupRuleV1::ReadyFromFirstSample
            );
            assert_eq!(condition.expected_ready_tick, 1);
            // Nothing upstream waits, so each condition is its own binding constraint.
            assert_eq!(condition.binding_node_id, condition.condition_node_id);
        }
    }

    #[rstest::rstest]
    fn a_condition_waits_as_long_as_the_window_it_reads() {
        let nodes = vec![
            node(
                "mean",
                MEAN,
                &[role("close")],
                window(20),
                BoundedFeatureValueTypeV1::FixedI128 {
                    unit: "price".to_owned(),
                    scale: 8,
                },
            ),
            node(
                "breakout",
                COMPARE,
                &[output("mean"), role("close")],
                BoundedFeatureParametersV1::None,
                BoundedFeatureValueTypeV1::Boolean,
            ),
        ];

        let census = derive_condition_readiness_census_v1(&nodes, &table(&[("breakout", 10)]))
            .expect("the program derives");

        let condition = &census.conditions[0];
        assert_eq!(condition.expected_ready_tick, 20);
        assert_eq!(
            condition.binding_rule,
            ConditionWarmupRuleV1::FullWindow { window: 20 }
        );
        // The condition itself is ready from its first sample; the mean is what imposed the wait,
        // and naming it is the difference between "this light is dark" and "this light needs
        // twenty bars".
        assert_eq!(condition.binding_node_id, "mean");
    }

    #[rstest::rstest]
    fn waits_compose_along_the_closure() {
        let nodes = vec![
            node(
                "mean",
                MEAN,
                &[role("close")],
                window(20),
                BoundedFeatureValueTypeV1::FixedI128 {
                    unit: "price".to_owned(),
                    scale: 8,
                },
            ),
            node(
                "lagged",
                LAG,
                &[output("mean")],
                BoundedFeatureParametersV1::Lag {
                    offset: 3,
                    declared_max_lag: 8,
                },
                BoundedFeatureValueTypeV1::FixedI128 {
                    unit: "price".to_owned(),
                    scale: 8,
                },
            ),
            node(
                "breakout",
                COMPARE,
                &[output("lagged"), role("close")],
                BoundedFeatureParametersV1::None,
                BoundedFeatureValueTypeV1::Boolean,
            ),
        ];

        let census = derive_condition_readiness_census_v1(&nodes, &table(&[("breakout", 10)]))
            .expect("the program derives");

        // The mean is ready at 20, and the lag needs its offset plus one more sample after that.
        let condition = &census.conditions[0];
        assert_eq!(condition.expected_ready_tick, 23);
        assert_eq!(
            condition.binding_rule,
            ConditionWarmupRuleV1::LagOffsetPlusOne { offset: 3 }
        );
        assert_eq!(condition.binding_node_id, "lagged");
    }

    #[rstest::rstest]
    fn a_period_that_does_not_delay_the_first_value_imposes_no_wait() {
        // `Atr` carries a period, and its published rule is `FirstSample`: the period sets its
        // smoothing coefficient and its state size, not when it first produces a value. Reading
        // the rule from the catalog rather than from the parameter is what keeps this at one.
        let nodes = vec![
            node(
                "atr",
                ATR,
                &[role("bar")],
                BoundedFeatureParametersV1::Period {
                    period: 14,
                    rounding: Some(BoundedFeatureRoundingV1::TowardZero),
                },
                BoundedFeatureValueTypeV1::FixedI128 {
                    unit: "price".to_owned(),
                    scale: 8,
                },
            ),
            node(
                "wide",
                COMPARE,
                &[output("atr"), role("close")],
                BoundedFeatureParametersV1::None,
                BoundedFeatureValueTypeV1::Boolean,
            ),
        ];

        let census = derive_condition_readiness_census_v1(&nodes, &table(&[("wide", 10)]))
            .expect("the program derives");

        assert_eq!(census.conditions[0].expected_ready_tick, 1);
        assert_eq!(
            census.conditions[0].binding_rule,
            ConditionWarmupRuleV1::ReadyFromFirstSample
        );
    }

    #[rstest::rstest]
    fn a_table_naming_a_predicate_the_graph_does_not_produce_is_refused() {
        let nodes = vec![node(
            "breakout",
            COMPARE,
            &[role("close"), role("open")],
            BoundedFeatureParametersV1::None,
            BoundedFeatureValueTypeV1::Boolean,
        )];

        let error = derive_condition_readiness_census_v1(&nodes, &table(&[("absent", 10)]))
            .expect_err("a predicate with no producer yields no census");

        assert!(matches!(
            error,
            ConditionReadinessDerivationErrorV1::UnknownReference { .. }
        ));
    }
}
