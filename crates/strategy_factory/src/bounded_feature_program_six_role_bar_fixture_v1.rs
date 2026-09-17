//! The six-role BAR Design a declared Bounded Feature Program can be assembled against.
//!
//! `prepare_owner_bar_joined_cut_acceptance_basis_v1` is the only producer of real Market Data
//! strategy input binding custody, and it issues that custody for exactly the six BAR roles
//! `six_role_bar_design` carries. That Design's own plugin, however, is a general host fixture: it
//! declares input ports a Bounded Feature Program cannot bind, and a program must bind every port
//! its manifest declares. This module narrows it to the bounded-plugin shape without touching the
//! six input roles, so the Design keeps the role identities Owner custody is issued for.
//!
//! It also carries the proposer's half: what a proposer decides, and nothing the Design, the
//! pinned catalog or the plugin manifest already fixes.

use crate::{
    bounded_feature_program_derivation_v1::{
        BoundedFeatureGraphBoundsV1, BoundedFeatureInputMeaningV1, BoundedFeatureProgramMeaningV1,
    },
    bounded_feature_program_v1::{
        BoundedFeatureAvailabilityV1, BoundedFeatureClockV1, BoundedFeatureConstantV1,
        BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1, BoundedFeatureInputBindingV1,
        BoundedFeatureNodeV1, BoundedFeatureOutputPortV1, BoundedFeatureParametersV1,
        BoundedFeaturePredicateV1, BoundedFeatureProposalDecisionBranchV1,
        BoundedFeatureProposalDecisionTableV1, BoundedFeatureProposalFrameV1,
        BoundedFeatureStateCellV1, BoundedFeatureStateKindV1, BoundedFeatureTerminalConversionV1,
        BoundedFeatureTerminalOutputV1, BoundedFeatureValueRefV1, BoundedFeatureValueTypeV1,
        BoundedFeatureWarmupContractV1, BoundedFeatureWarmupPostStateV1,
        OWNER_SAMPLE_COORDINATE_SOURCE_V1,
    },
    program_host_v2::{
        BAR_HOUR_CLOSE, BAR_MINUTE_CLOSE, BAR_MINUTE_HIGH, BAR_MINUTE_LOW, BAR_MINUTE_OPEN,
        BAR_SESSION_DAY_CLOSE,
    },
    strategy_design_v2::{LifecycleKindV2, StrategyDesignV2, ValueRefV2},
};

/// Narrows the six-role BAR Design to the bounded-plugin shape.
///
/// Only the plugin manifest and the reaction bindings change. The six input roles, the join and
/// the Research identities are left exactly as they are, so the Design keeps the role identities
/// the Market Data Owner acceptance basis issues binding custody for.
pub(crate) fn six_role_bar_bounded_feature_design_v1() -> StrategyDesignV2 {
    let mut design = crate::program_host_v2::six_role_bar_design();
    let bound_ports = design
        .reactions
        .iter()
        .filter(|reaction| reaction.kind == LifecycleKindV2::Bar)
        .flat_map(|reaction| &reaction.nodes)
        .flat_map(|node| &node.input_bindings)
        .filter(|binding| {
            matches!(
                binding.source,
                ValueRefV2::Input { .. } | ValueRefV2::OwnerSampleCoordinate { .. }
            )
        })
        .map(|binding| binding.port_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        bound_ports.len(),
        12,
        "the bounded plugin binds six value ports and their six Owner sample coordinates"
    );

    design.plugins[0]
        .input_ports
        .retain(|port| bound_ports.contains(&port.semantic_id));

    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            node.input_bindings
                .retain(|binding| bound_ports.contains(&binding.port_id));
        }
    }
    // A bounded plugin's proposal port is exactly as wide as its lifecycle value, while the host
    // fixture rounded each one up to a uniform frame width.
    for port in &mut design.plugins[0].output_ports {
        port.max_bytes = crate::bounded_feature_program_v1::manifest_width(port.value_type)
            .expect("every proposal output port carries a bounded lifecycle value");
    }
    // Dropping the bindings that carried them leaves the Design's parameters unreachable, and a
    // Design whose parameter never reaches a compute node does not compile.
    let reached = design
        .reactions
        .iter()
        .flat_map(|reaction| &reaction.nodes)
        .flat_map(|node| &node.input_bindings)
        .filter_map(|binding| match &binding.source {
            ValueRefV2::Parameter { parameter_id } => Some(parameter_id.clone()),
            _ => None,
        })
        .collect::<std::collections::BTreeSet<_>>();
    design
        .parameters
        .retain(|parameter| reached.contains(&parameter.semantic_id));
    design
}

/// This minute closed above where it opened.
const BREAKOUT_NODE: &str = "minute-close-above-open";
/// This minute reached above the last hourly close.
const EXTENDING_NODE: &str = "minute-high-above-hour-close";
/// This minute fell below the last session close.
const UNDERCUT_NODE: &str = "minute-low-below-session-close";
/// The strategy state cell the decision carries between events.
const BREAKOUT_STATE: &str = "breakout-state";

/// Builds the declared meaning a proposer sends for the six-role BAR bounded Design.
///
/// The role-to-port assignment is read back from the Design's own reaction bindings rather than
/// restated: the Design already fixes which manifest port carries which role, and a proposer that
/// disagreed would simply be refused.
pub(crate) fn six_role_bar_bounded_feature_meaning_v1(
    design: &StrategyDesignV2,
) -> BoundedFeatureProgramMeaningV1 {
    let plugin_semantic_id = design.plugins[0].semantic_id.clone();
    let mut inputs = design
        .reactions
        .iter()
        .filter(|reaction| reaction.kind == LifecycleKindV2::Bar)
        .flat_map(|reaction| &reaction.nodes)
        .flat_map(|node| &node.input_bindings)
        .filter_map(|binding| match &binding.source {
            ValueRefV2::Input { input_id } => Some(BoundedFeatureInputMeaningV1 {
                role_semantic_id: input_id.clone(),
                value_port_semantic_id: binding.port_id.clone(),
                // Only the join's trigger role advances on its own event; every other role is
                // sampled at that trigger through the Owner's own sample coordinate.
                update_clock: if input_id == BAR_MINUTE_CLOSE {
                    BoundedFeatureClockV1::Trigger {
                        input_role_id: input_id.clone(),
                    }
                } else {
                    BoundedFeatureClockV1::Sample {
                        input_role_id: input_id.clone(),
                        source_semantic_id: format!(
                            "{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({input_id})"
                        ),
                    }
                },
            }),
            _ => None,
        })
        .collect::<Vec<_>>();
    inputs.sort_by(|left, right| left.role_semantic_id.cmp(&right.role_semantic_id));
    assert_eq!(inputs.len(), 6, "the Design declares six input roles");

    BoundedFeatureProgramMeaningV1 {
        plugin_semantic_id,
        inputs,
        constants: constants(),
        state_cells: vec![BoundedFeatureStateCellV1 {
            state_id: BREAKOUT_STATE.to_owned(),
            writer_node_id: BREAKOUT_NODE.to_owned(),
            state_kind: BoundedFeatureStateKindV1::Strategy {
                value_type: BoundedFeatureValueTypeV1::Boolean,
                source_port_id: "value".to_owned(),
            },
            initial: BoundedFeatureInitialStateV1::Constant {
                constant_id: "initial-condition".to_owned(),
            },
            max_bytes: 1,
        }],
        // Every declared input must reach the graph, so the six roles pair into three comparisons.
        nodes: vec![
            comparison(
                BREAKOUT_NODE,
                BAR_MINUTE_CLOSE,
                BAR_MINUTE_OPEN,
                BoundedFeaturePredicateV1::Greater,
            ),
            comparison(
                EXTENDING_NODE,
                BAR_MINUTE_HIGH,
                BAR_HOUR_CLOSE,
                BoundedFeaturePredicateV1::Greater,
            ),
            comparison(
                UNDERCUT_NODE,
                BAR_MINUTE_LOW,
                BAR_SESSION_DAY_CLOSE,
                BoundedFeaturePredicateV1::Less,
            ),
        ],
        proposal_decision_table: BoundedFeatureProposalDecisionTableV1 {
            branches: [UNDERCUT_NODE, EXTENDING_NODE, BREAKOUT_NODE]
                .into_iter()
                .zip([30_u16, 20, 10])
                .map(
                    |(node_id, priority)| BoundedFeatureProposalDecisionBranchV1 {
                        priority,
                        predicate: BoundedFeatureValueRefV1::NodeOutput {
                            node_id: node_id.to_owned(),
                            port_id: "value".to_owned(),
                        },
                        frame: enter_frame(),
                    },
                )
                .collect(),
            default_frame: enter_frame(),
        },
        warmup: BoundedFeatureWarmupContractV1 {
            position_intent_semantic_id: "kernel.position.hold.v1".to_owned(),
            target_variant_semantic_id: "kernel.target.keep.v1".to_owned(),
            target_position_units: 0,
            target_weight_micros: 0,
            rebalance_sequence: 0,
            reconciliation_target_units: 0,
            protection_variant_semantic_id: "kernel.protection.keep.v1".to_owned(),
            stop_loss_ticks: 0,
            take_profit_ticks: 0,
            trailing_distance_ticks: 0,
            trailing_stop_ticks: 0,
            post_state: BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent,
        },
        graph_bounds: BoundedFeatureGraphBoundsV1 {
            max_nodes: 8,
            max_edges: 64,
            max_depth: 8,
            max_ports: 64,
            max_constants: 32,
            max_fan_out: 16,
            // The graph declares no lag and no rolling window, and a zero bound is refused
            // outright, so both carry the smallest bound a program may state.
            max_lag: 1,
            max_window: 1,
            max_state_cells: 4,
            max_decision_branches: 4,
            max_source_bytes: 262_144,
            max_wasm_bytes: 1_048_576,
        },
    }
}

/// One equal-scale comparison of two declared input roles.
fn comparison(
    node_id: &str,
    left_role: &str,
    right_role: &str,
    predicate: BoundedFeaturePredicateV1,
) -> BoundedFeatureNodeV1 {
    BoundedFeatureNodeV1 {
        node_id: node_id.to_owned(),
        primitive_semantic_id: "bfp.fixed-i128.compare.equal-scale.v1".to_owned(),
        input_bindings: vec![
            BoundedFeatureInputBindingV1 {
                port_id: "a".to_owned(),
                source: BoundedFeatureValueRefV1::InputValue {
                    input_role_id: left_role.to_owned(),
                },
                require_ready: false,
            },
            BoundedFeatureInputBindingV1 {
                port_id: "b".to_owned(),
                source: BoundedFeatureValueRefV1::InputValue {
                    input_role_id: right_role.to_owned(),
                },
                require_ready: false,
            },
        ],
        output_ports: vec![BoundedFeatureOutputPortV1 {
            port_id: "value".to_owned(),
            value_type: BoundedFeatureValueTypeV1::Boolean,
            availability: BoundedFeatureAvailabilityV1::Ready,
        }],
        parameters: BoundedFeatureParametersV1::ComparisonPredicate { predicate },
        state_id: None,
        update_clock: None,
    }
}

fn constants() -> Vec<BoundedFeatureConstantV1> {
    [
        (
            "initial-condition",
            BoundedFeatureConstantValueV1::Boolean { value: false },
        ),
        (
            "position",
            BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: "kernel.position.enter.v1".to_owned(),
            },
        ),
        (
            "target",
            BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: "kernel.target.position.v1".to_owned(),
            },
        ),
        (
            "target-position",
            BoundedFeatureConstantValueV1::I64 { value: 1 },
        ),
        (
            "target-weight",
            BoundedFeatureConstantValueV1::I32 { value: 0 },
        ),
        ("rebalance", BoundedFeatureConstantValueV1::U64 { value: 1 }),
        (
            "reconciliation",
            BoundedFeatureConstantValueV1::I64 { value: 1 },
        ),
        (
            "protection",
            BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                semantic_id: "kernel.protection.replace.v1".to_owned(),
            },
        ),
        (
            "stop-loss",
            BoundedFeatureConstantValueV1::I64 { value: 90 },
        ),
        (
            "take-profit",
            BoundedFeatureConstantValueV1::I64 { value: 120 },
        ),
        (
            "trailing-distance",
            BoundedFeatureConstantValueV1::U64 { value: 5 },
        ),
        (
            "trailing-stop",
            BoundedFeatureConstantValueV1::I64 { value: 95 },
        ),
    ]
    .into_iter()
    .map(|(constant_id, value)| BoundedFeatureConstantV1 {
        constant_id: constant_id.to_owned(),
        value,
    })
    .collect()
}

fn enter_frame() -> BoundedFeatureProposalFrameV1 {
    BoundedFeatureProposalFrameV1 {
        terminal_outputs: [
            (
                "proposal.position-intent.v1",
                "kernel.position.enter.v1",
                "position",
            ),
            (
                "proposal.target-variant.v1",
                "kernel.target.position.v1",
                "target",
            ),
            (
                "proposal.target-position.v1",
                "kernel.target.position.v1",
                "target-position",
            ),
            (
                "proposal.target-weight.v1",
                "kernel.target.weight.v1",
                "target-weight",
            ),
            (
                "proposal.rebalance-sequence.v1",
                "kernel.target.rebalance.v1",
                "rebalance",
            ),
            (
                "proposal.reconciliation-target.v1",
                "kernel.target.position.v1",
                "reconciliation",
            ),
            (
                "proposal.protection-variant.v1",
                "kernel.protection.replace.v1",
                "protection",
            ),
            (
                "proposal.stop-loss.v1",
                "kernel.protection.stop-loss.v1",
                "stop-loss",
            ),
            (
                "proposal.take-profit.v1",
                "kernel.protection.take-profit.v1",
                "take-profit",
            ),
            (
                "proposal.trailing-distance.v1",
                "kernel.protection.trailing-adjust.v1",
                "trailing-distance",
            ),
            (
                "proposal.trailing-stop.v1",
                "kernel.protection.trailing-adjust.v1",
                "trailing-stop",
            ),
        ]
        .into_iter()
        .map(|(manifest_port_id, lifecycle_semantic_id, constant_id)| {
            BoundedFeatureTerminalOutputV1 {
                manifest_port_id: manifest_port_id.to_owned(),
                lifecycle_semantic_id: lifecycle_semantic_id.to_owned(),
                source: BoundedFeatureValueRefV1::Constant {
                    constant_id: constant_id.to_owned(),
                },
                conversion: BoundedFeatureTerminalConversionV1::Exact,
            }
        })
        .collect(),
    }
}
