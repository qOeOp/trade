use rstest::rstest;
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    strategy_design_v2::*,
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyDesignPreparationV2,
        compile_with_binding_projections_for_test,
    },
};

const PLUGIN_ID: &str = "research.plugin.stateful-trend.v1";
const STATE_POST: &str = "plugin.state.post.v1";

pub(crate) const OUTPUT_PORTS: &[(&str, ValueTypeV2)] = &[
    ("proposal.position-intent.v1", ValueTypeV2::PositionIntentV1),
    ("proposal.target-variant.v1", ValueTypeV2::TargetVariantV1),
    ("proposal.target-position.v1", ValueTypeV2::I64),
    ("proposal.target-weight.v1", ValueTypeV2::I32),
    ("proposal.rebalance-sequence.v1", ValueTypeV2::U64),
    ("proposal.reconciliation-target.v1", ValueTypeV2::I64),
    (
        "proposal.protection-variant.v1",
        ValueTypeV2::ProtectionVariantV1,
    ),
    ("proposal.stop-loss.v1", ValueTypeV2::I64),
    ("proposal.take-profit.v1", ValueTypeV2::I64),
    ("proposal.trailing-distance.v1", ValueTypeV2::U64),
    ("proposal.trailing-stop.v1", ValueTypeV2::I64),
];

fn output(node: &str, port: &str) -> ValueRefV2 {
    ValueRefV2::NodeOutput {
        node_id: node.into(),
        port_id: port.into(),
    }
}

fn context(field: LifecycleContextV2) -> ValueRefV2 {
    ValueRefV2::LifecycleContext { field }
}

fn proposal(node: &str) -> ProposalWiringV2 {
    ProposalWiringV2 {
        position_intent: output(node, "proposal.position-intent.v1"),
        target_variant: output(node, "proposal.target-variant.v1"),
        target_position_units: output(node, "proposal.target-position.v1"),
        target_weight_micros: output(node, "proposal.target-weight.v1"),
        rebalance_sequence: output(node, "proposal.rebalance-sequence.v1"),
        reconciliation_target_units: output(node, "proposal.reconciliation-target.v1"),
        protection_variant: output(node, "proposal.protection-variant.v1"),
        stop_loss_ticks: output(node, "proposal.stop-loss.v1"),
        take_profit_ticks: output(node, "proposal.take-profit.v1"),
        trailing_distance_ticks: output(node, "proposal.trailing-distance.v1"),
        trailing_stop_ticks: output(node, "proposal.trailing-stop.v1"),
        member_target_set: None,
    }
}

fn compute_node(node: &str, state: &str) -> ComputeNodeV2 {
    ComputeNodeV2 {
        semantic_id: node.into(),
        plugin_semantic_id: PLUGIN_ID.into(),
        input_bindings: vec![
            PortBindingV2 {
                port_id: "input.close.v1".into(),
                source: ValueRefV2::Input {
                    input_id: "research.input.close.v1".into(),
                },
            },
            PortBindingV2 {
                port_id: "input.current-position.v1".into(),
                source: context(LifecycleContextV2::CurrentPositionUnits),
            },
            PortBindingV2 {
                port_id: "input.envelope-digest.v1".into(),
                source: context(LifecycleContextV2::EnvelopeDigest),
            },
            PortBindingV2 {
                port_id: "input.intent.v1".into(),
                source: context(LifecycleContextV2::IntentIdentity),
            },
            PortBindingV2 {
                port_id: "input.lookback.v1".into(),
                source: ValueRefV2::Parameter {
                    parameter_id: "research.parameter.lookback.v1".into(),
                },
            },
            PortBindingV2 {
                port_id: "input.rebalance-sequence.v1".into(),
                source: context(LifecycleContextV2::RebalanceSequence),
            },
        ],
        pre_state: ValueRefV2::PriorState {
            state_id: state.into(),
        },
        output_port_ids: OUTPUT_PORTS
            .iter()
            .map(|(port, _)| (*port).to_owned())
            .collect(),
        post_state_port_id: STATE_POST.into(),
    }
}

fn reaction(kind: LifecycleKindV2, node: &str, state: &str) -> ReactionGraphV2 {
    let mut compute = compute_node(node, state);
    let close_source = match kind {
        LifecycleKindV2::Event => ValueRefV2::Input {
            input_id: "research.input.last-trade.v1".into(),
        },
        LifecycleKindV2::Timer => ValueRefV2::Parameter {
            parameter_id: "research.parameter.timer-close.v1".into(),
        },
        _ => ValueRefV2::Input {
            input_id: "research.input.close.v1".into(),
        },
    };

    if let Some(binding) = compute
        .input_bindings
        .iter_mut()
        .find(|binding| binding.port_id == "input.close.v1")
    {
        binding.source = close_source;
    }
    ReactionGraphV2 {
        kind,
        nodes: vec![compute],
        state_writes: vec![StateWriteV2 {
            state_id: state.into(),
            source: output(node, STATE_POST),
        }],
        proposal: Some(proposal(node)),
    }
}

pub(crate) fn design() -> StrategyDesignV2 {
    let capabilities = [
        "research.trend.warmup.v1",
        "research.trend.enter.v1",
        "research.trend.add.v1",
        "research.trend.reduce.v1",
        "research.trend.trailing.v1",
        "research.trend.timer-exit.v1",
    ];
    StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
        intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        inputs: vec![
            InputRoleV2 {
                semantic_id: "research.input.close.v1".into(),
                fact_class: InputFactClassV2::MarketData,
                instrument: "AAPL.XNAS".into(),
                scope: InputScopeV2::ExactInstrument,
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
                channel: "MARKET".into(),
                timeframe: "1M".into(),
                unit: "PRICE".into(),
                scale: 2,
                value_type: ValueTypeV2::I128,
            },
            InputRoleV2 {
                semantic_id: "research.input.last-trade.v1".into(),
                fact_class: InputFactClassV2::MarketData,
                instrument: "AAPL.XNAS".into(),
                scope: InputScopeV2::ExactInstrument,
                field_semantic_id: "MARKET_DATA.TRADE.LAST.PRICE.V1".into(),
                channel: "MARKET".into(),
                timeframe: "TICK".into(),
                unit: "PRICE".into(),
                scale: 2,
                value_type: ValueTypeV2::I128,
            },
        ],
        joins: vec![],
        parameters: vec![
            ParameterV2 {
                semantic_id: "research.parameter.lookback.v1".into(),
                value_type: ValueTypeV2::I64,
                value: TypedConstantV2::I64 { value: 20 },
                unit: "BAR_COUNT".into(),
            },
            ParameterV2 {
                semantic_id: "research.parameter.timer-close.v1".into(),
                value_type: ValueTypeV2::I128,
                value: TypedConstantV2::I128 { value: 0 },
                unit: "PRICE".into(),
            },
        ],
        state: vec![StateCellV2 {
            semantic_id: "research.state.trend.v1".into(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: 256,
        }],
        reactions: vec![
            ReactionGraphV2 {
                kind: LifecycleKindV2::Start,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            reaction(
                LifecycleKindV2::Bar,
                "research.node.bar.v1",
                "research.state.trend.v1",
            ),
            reaction(
                LifecycleKindV2::Event,
                "research.node.event.v1",
                "research.state.trend.v1",
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Fill,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            reaction(
                LifecycleKindV2::Timer,
                "research.node.timer.v1",
                "research.state.trend.v1",
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Stop,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
        ],
        capabilities: capabilities
            .into_iter()
            .map(|semantic_id| CapabilityDeclarationV2 {
                semantic_id: semantic_id.into(),
                version: 1,
                dependencies: vec![],
            })
            .collect(),
        plugins: vec![PluginManifestV2 {
            semantic_id: PLUGIN_ID.into(),
            abi_version: 2,
            input_ports: vec![
                PortContractV2 {
                    semantic_id: "input.close.v1".into(),
                    value_type: ValueTypeV2::I128,
                    max_bytes: 16,
                },
                PortContractV2 {
                    semantic_id: "input.current-position.v1".into(),
                    value_type: ValueTypeV2::I64,
                    max_bytes: 8,
                },
                PortContractV2 {
                    semantic_id: "input.envelope-digest.v1".into(),
                    value_type: ValueTypeV2::Digest32,
                    max_bytes: 32,
                },
                PortContractV2 {
                    semantic_id: "input.intent.v1".into(),
                    value_type: ValueTypeV2::StableIdentity16,
                    max_bytes: 16,
                },
                PortContractV2 {
                    semantic_id: "input.lookback.v1".into(),
                    value_type: ValueTypeV2::I64,
                    max_bytes: 8,
                },
                PortContractV2 {
                    semantic_id: "input.rebalance-sequence.v1".into(),
                    value_type: ValueTypeV2::U64,
                    max_bytes: 8,
                },
            ],
            output_ports: OUTPUT_PORTS
                .iter()
                .map(|(semantic_id, value_type)| PortContractV2 {
                    semantic_id: (*semantic_id).into(),
                    value_type: *value_type,
                    max_bytes: match value_type {
                        ValueTypeV2::Digest32 => 32,
                        ValueTypeV2::I32
                        | ValueTypeV2::PositionIntentV1
                        | ValueTypeV2::TargetVariantV1
                        | ValueTypeV2::ProtectionVariantV1 => 4,
                        _ => 8,
                    },
                })
                .collect(),
            state: PluginStateContractV2 {
                pre_port_id: "plugin.state.pre.v1".into(),
                post_port_id: STATE_POST.into(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 256,
            },
            capability_ids: capabilities.into_iter().map(str::to_owned).collect(),
            max_fuel: 100_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".into(),
        }],
        resources: ResourceBoundsV2 {
            max_inputs: 4,
            max_nodes_per_reaction: 4,
            max_dependency_edges: 256,
            max_state_bytes: 4096,
            max_plugin_calls_per_event: 4,
        },
        falsifier: "trend state does not improve the frozen next-return decision".into(),
    }
}

pub(crate) fn bindings(design: &StrategyDesignV2) -> Vec<(InputRoleV2, BindingDigest)> {
    let mut inputs = design.inputs.clone();
    inputs.sort();
    inputs
        .into_iter()
        .enumerate()
        .map(|(index, role)| {
            (
                role,
                BindingDigest::from_untrusted_bytes([10 + index as u8; 32]),
            )
        })
        .collect()
}

#[rstest]
fn version_and_under_specification_have_only_the_two_nonpositive_terminals() {
    let mut version = design();
    version.schema_version = 1;
    assert!(matches!(
        compile_with_binding_projections_for_test(version, vec![]),
        StrategyCompilationV2::Unsupported(issue) if issue.coordinate == "schema_version"
    ));

    let mut missing = design();
    missing.reactions.pop();
    assert!(matches!(
        compile_with_binding_projections_for_test(missing, vec![]),
        StrategyCompilationV2::NeedsResearchRefinement(issue) if issue.coordinate == "reactions"
    ));

    let mut falsifier = design();
    falsifier.falsifier.clear();
    assert!(matches!(
        compile_with_binding_projections_for_test(falsifier, vec![]),
        StrategyCompilationV2::NeedsResearchRefinement(issue) if issue.coordinate == "falsifier"
    ));
}

#[rstest]
fn input_scope_rejects_unknown_caller_authority_and_empty_exact_instrument() {
    let mut wire = serde_json::to_value(design()).unwrap();
    wire["inputs"][0]["scope"] = serde_json::json!({
        "kind": "UNIVERSE_SELECTION",
        "selection_identity": vec![7; 32],
    });
    assert!(serde_json::from_value::<StrategyDesignV2>(wire).is_err());

    let mut candidate = design();
    candidate.inputs[0].instrument.clear();
    assert!(!matches!(
        compile_with_binding_projections_for_test(candidate.clone(), bindings(&candidate)),
        StrategyCompilationV2::Compiled(_)
    ));
}

#[rstest]
fn origin_schema_two_json_without_scope_round_trips_without_identity_drift() {
    let origin = design();
    let origin_bytes = serde_json::to_vec(&origin).unwrap();
    assert!(!String::from_utf8_lossy(&origin_bytes).contains("\"scope\""));

    let restored: StrategyDesignV2 = serde_json::from_slice(&origin_bytes).unwrap();
    assert_eq!(serde_json::to_vec(&restored).unwrap(), origin_bytes);
    let before = crate::strategy_plan_v2::prepare_strategy_design_v2(&origin);
    let after = crate::strategy_plan_v2::prepare_strategy_design_v2(&restored);
    assert!(
        matches!(before, StrategyDesignPreparationV2::Prepared { .. }),
        "{before:?}"
    );
    assert_eq!(after, before);
}

#[rstest]
fn capability_cycle_and_resource_excess_are_unsupported() {
    let mut cycle = design();
    cycle.capabilities[0].dependencies = vec![cycle.capabilities[1].semantic_id.clone()];
    cycle.capabilities[1].dependencies = vec![cycle.capabilities[0].semantic_id.clone()];
    assert!(matches!(
        compile_with_binding_projections_for_test(cycle, vec![]),
        StrategyCompilationV2::Unsupported(issue) if issue.coordinate == "capabilities"
    ));

    let mut excessive = design();
    excessive.resources.max_state_bytes = u32::MAX;
    assert!(matches!(
        compile_with_binding_projections_for_test(excessive, vec![]),
        StrategyCompilationV2::Unsupported(issue) if issue.coordinate == "resources"
    ));
}

fn joined_design() -> StrategyDesignV2 {
    let mut candidate = crate::program_host_v2_tests::executable_design();
    let open = candidate
        .inputs
        .iter_mut()
        .find(|input| input.semantic_id == "research.input.open.v1")
        .expect("executable fixture has an OPEN role");
    open.timeframe = "1H".into();
    candidate.joins = vec![InputJoinV2 {
        semantic_id: "research.join.regime.v1".into(),
        inputs: vec![
            "research.input.open.v1".into(),
            "research.input.close.v1".into(),
        ],
        alignment_semantic_id: INPUT_JOIN_LATEST_NOT_AFTER_TRIGGER_V1.into(),
        trigger_input_id: "research.input.close.v1".into(),
        max_staleness_ns: 60_000_000_000,
    }];
    candidate
}

#[rstest]
fn canonical_input_join_lowers_multi_timeframe_roles_byte_stably() {
    let candidate = joined_design();
    let mut reversed = bindings(&candidate);
    reversed.reverse();
    let first_compilation =
        compile_with_binding_projections_for_test(candidate.clone(), bindings(&candidate));
    let StrategyCompilationV2::Compiled(first) = first_compilation else {
        panic!("valid canonical input join did not compile: {first_compilation:?}");
    };
    let StrategyCompilationV2::Compiled(second) =
        compile_with_binding_projections_for_test(candidate, reversed)
    else {
        panic!("binding order changed input-join compilation");
    };
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&second).unwrap()
    );
    assert_eq!(first.design_identity(), second.design_identity());
    assert_eq!(first.binding_digest(), second.binding_digest());
}

#[rstest]
fn input_join_rejects_missing_duplicate_unknown_cyclic_and_overlapping_roles() {
    let invalid = [
        {
            let mut value = joined_design();
            value.joins[0].inputs.pop();
            value
        },
        {
            let mut value = joined_design();
            value.joins[0].inputs.push("research.input.close.v1".into());
            value
        },
        {
            let mut value = joined_design();
            value.joins[0].inputs[0] = "research.input.unknown.v1".into();
            value
        },
        {
            let mut value = joined_design();
            value.joins.push(InputJoinV2 {
                semantic_id: "research.join.outer.v1".into(),
                inputs: vec![
                    "research.join.regime.v1".into(),
                    "research.input.close.v1".into(),
                ],
                alignment_semantic_id: INPUT_JOIN_LATEST_NOT_AFTER_TRIGGER_V1.into(),
                trigger_input_id: "research.input.close.v1".into(),
                max_staleness_ns: 1,
            });
            value
        },
        {
            let mut value = joined_design();
            let mut overlap = value.joins[0].clone();
            overlap.semantic_id = "research.join.overlap.v1".into();
            value.joins.push(overlap);
            value
        },
    ];

    for candidate in invalid {
        assert!(matches!(
            compile_with_binding_projections_for_test(candidate.clone(), bindings(&candidate)),
            StrategyCompilationV2::Unsupported(_)
        ));
    }
}

#[rstest]
fn input_join_rejects_implicit_trigger_alignment_unbounded_staleness_and_incompatible_roles() {
    let invalid = [
        {
            let mut value = joined_design();
            value.joins[0].trigger_input_id = "research.input.unknown.v1".into();
            value
        },
        {
            let mut value = joined_design();
            value.joins[0].alignment_semantic_id = "research.alignment.heuristic.v1".into();
            value
        },
        {
            let mut value = joined_design();
            value.joins[0].max_staleness_ns = 0;
            value
        },
        {
            let mut value = joined_design();
            value.joins[0].max_staleness_ns = u64::MAX;
            value
        },
        {
            let mut value = joined_design();
            value
                .inputs
                .iter_mut()
                .find(|input| input.semantic_id == "research.input.open.v1")
                .unwrap()
                .unit = "QUANTITY".into();
            value
        },
        {
            let mut value = joined_design();
            value
                .inputs
                .iter_mut()
                .find(|input| input.semantic_id == "research.input.open.v1")
                .unwrap()
                .scale = 3;
            value
        },
    ];

    for candidate in invalid {
        assert!(matches!(
            compile_with_binding_projections_for_test(candidate.clone(), bindings(&candidate)),
            StrategyCompilationV2::Unsupported(_)
        ));
    }
}
