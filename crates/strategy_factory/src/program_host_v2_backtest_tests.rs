use anyhow::Context;
use strategy_factory_program_sdk::lifecycle_v1;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_model::identifiers::InstrumentId;

use super::{
    artifact_v2::{StrategyArtifactV2, StrategyArtifactV2Error},
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{
        PLUGIN_FRAME_ABI_V3, PluginFrameKindV2, PluginFrameV2, PluginOutputAvailabilityV3,
        TypedValueV2,
    },
    strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputFactClassV2, InputRoleV2, InputScopeV2,
        LifecycleContextV2, LifecycleKindV2, ParameterV2, PluginManifestV2, PluginStateContractV2,
        PortBindingV2, PortContractV2, ProposalWiringV2, ReactionGraphV2, ResourceBoundsV2,
        STRATEGY_DESIGN_SCHEMA_V2, StateCellV2, StateWriteV2, StrategyDesignV2, TypedConstantV2,
        ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyPlanV2,
        compile_with_binding_and_implementation_receipts_for_test,
        issue_plugin_implementation_receipt_v2_for_test,
    },
};

#[cfg(test)]
use super::strategy_plan_v2::{
    VerifiedStrategyInputBindingsV2, verified_strategy_input_bindings_for_test,
};

const INPUT_PTR: i32 = 1_024;
const OUTPUT_PTR: i32 = 8_192;
const STATIC_PTR: i32 = 16_384;
const PLUGIN_ID: &str = "research.plugin.stateful-trend.v1";
const STATE_POST: &str = "plugin.state.post.v1";
type BacktestFixtureParts = (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyDesignV2,
    Vec<(InputRoleV2, BindingDigest)>,
);
const OUTPUT_PORTS: &[(&str, ValueTypeV2)] = &[
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

#[derive(Clone, Copy)]
enum Phase {
    Enter,
    HoldZero,
    HoldOne,
    Add,
    HoldTwo,
    Reduce,
    HoldThree,
    Exit,
    HoldFour,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum InputMutation {
    None,
    OpenFirst,
    CloseFirst,
}

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

fn stateful_backtest_design() -> StrategyDesignV2 {
    let capabilities = [
        "research.trend.warmup.v1",
        "research.trend.enter.v1",
        "research.trend.add.v1",
        "research.trend.reduce.v1",
        "research.trend.trailing.v1",
        "research.trend.timer-exit.v1",
    ];
    let mut design = StrategyDesignV2 {
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
            max_fuel: 10_000_000,
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
    };
    let mut open = design.inputs[0].clone();
    open.semantic_id = "research.input.open.v1".into();
    open.field_semantic_id = "MARKET_DATA.BAR.OPEN.PRICE.V1".into();
    design.inputs.push(open);
    design.plugins[0].input_ports.push(PortContractV2 {
        semantic_id: "input.open.v1".into(),
        value_type: ValueTypeV2::I128,
        max_bytes: 16,
    });

    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            let source = match reaction.kind {
                LifecycleKindV2::Bar => ValueRefV2::Input {
                    input_id: "research.input.open.v1".into(),
                },
                LifecycleKindV2::Event => ValueRefV2::Input {
                    input_id: "research.input.last-trade.v1".into(),
                },
                _ => ValueRefV2::Parameter {
                    parameter_id: "research.parameter.timer-close.v1".into(),
                },
            };
            node.input_bindings.push(PortBindingV2 {
                port_id: "input.open.v1".into(),
                source,
            });
            node.input_bindings.sort();
        }
    }

    for port in &mut design.plugins[0].output_ports {
        if matches!(
            port.value_type,
            ValueTypeV2::PositionIntentV1
                | ValueTypeV2::TargetVariantV1
                | ValueTypeV2::ProtectionVariantV1
        ) {
            port.max_bytes = 64;
        }
    }
    design.plugins[0].input_ports.sort();
    design.plugins[0].output_ports.sort();
    design.plugins[0].capability_ids.sort();
    design
}

fn bindings(design: &StrategyDesignV2) -> Vec<(InputRoleV2, BindingDigest)> {
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

#[cfg(test)]
pub(crate) fn preparation_fixture(
    instrument_id: InstrumentId,
    meaning: u8,
) -> anyhow::Result<(
    StrategyPlanV2,
    StrategyArtifactV2,
    VerifiedStrategyInputBindingsV2,
)> {
    let (plan, artifact, design, owner_bindings) = fixture_parts(instrument_id, Some(meaning))?;
    let verified_bindings = verified_strategy_input_bindings_for_test(&design, owner_bindings);
    Ok((plan, artifact, verified_bindings))
}

fn fixture_parts(
    instrument_id: InstrumentId,
    meaning: Option<u8>,
) -> anyhow::Result<BacktestFixtureParts> {
    let mut design = stateful_backtest_design();

    if let Some(meaning) = meaning {
        design.research_request_identity = BindingDigest::from_untrusted_bytes([meaning; 32]);
        design.intent_identity = BindingDigest::from_untrusted_bytes([meaning.wrapping_add(1); 32]);
        design.intent_digest = BindingDigest::from_untrusted_bytes([meaning.wrapping_add(2); 32]);
    }

    for input in &mut design.inputs {
        input.instrument = instrument_id.to_string();
        input.timeframe = "1-MINUTE".to_owned();
    }
    design.state[0].initial = TypedConstantV2::Bytes { value: vec![0] };
    design.plugins[0].max_fuel = 10_000_000;
    let manifest = &design.plugins[0];
    let wasm = stateful_plugin_module(manifest)?;
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )?;
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        manifest,
        build.implementation_capsule_digest(),
        build.source_entry_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        manifest.abi_version,
        manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let owner_bindings = bindings(&design);
    let StrategyCompilationV2::Compiled(plan) =
        compile_with_binding_and_implementation_receipts_for_test(
            design.clone(),
            owner_bindings.clone(),
            vec![receipt],
        )
    else {
        anyhow::bail!("stateful Backtest V2 fixture did not compile")
    };
    let artifact = StrategyArtifactV2::issue_versioned(&plan, vec![build.into()])
        .map_err(|error: StrategyArtifactV2Error| anyhow::anyhow!(error))?;
    Ok((*plan, artifact, design, owner_bindings))
}

pub(crate) fn stateful_plugin_module(manifest: &PluginManifestV2) -> anyhow::Result<Vec<u8>> {
    let phases = [
        Phase::Enter,
        Phase::HoldZero,
        Phase::HoldOne,
        Phase::Add,
        Phase::HoldTwo,
        Phase::Reduce,
        Phase::HoldThree,
        Phase::Exit,
        Phase::HoldFour,
    ];
    let bodies = phases
        .into_iter()
        .map(|phase| {
            output_frame(manifest, phase)
                .encode(manifest)
                .map(|bytes| bytes[96..].to_vec())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut pointers = Vec::with_capacity(bodies.len());
    let mut next = STATIC_PTR;
    for body in &bodies {
        pointers.push(next);
        next += i32::try_from(body.len() + 32)?;
    }
    let input = sample_input_frame(manifest).encode(manifest)?;
    let current_position_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.current-position.v1")
        .context("current-position input port")?;
    let position_ptr =
        INPUT_PTR + i32::try_from(payload_offset(&input, current_position_ordinal as u16)?)?;
    let open_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.open.v1")
        .context("open input port")?;
    let open_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, open_ordinal as u16)?)?;
    let close_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.close.v1")
        .context("close input port")?;
    let close_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, close_ordinal as u16)?)?;
    let state_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, u16::MAX)?)?;
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    let input_capacity = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);

    let image =
        |index: usize| output_image(&bodies[index], pointers[index], manifest.output_ports.len());
    let field_relation = |opcode: u8| {
        let mut condition = i32_const(close_ptr);
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.extend(i32_const(open_ptr));
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.push(opcode);
        condition
    };
    let choose_position = |expected: i64, relation_opcode: u8, yes: Vec<u8>, no: Vec<u8>| {
        let mut condition = i32_const(position_ptr);
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.extend(i64_const(expected));
        condition.push(0x51);
        condition.extend(field_relation(relation_opcode));
        condition.push(0x71);
        if_else(condition, yes, no)
    };
    let state_three = choose_position(8, 0x55, image(7), image(6));
    let state_two = choose_position(16, 0x55, image(5), image(4));
    let state_one = choose_position(8, 0x55, image(3), image(2));
    let choose_state = |state: i32, yes: Vec<u8>, no: Vec<u8>| {
        let mut condition = i32_const(state_ptr);
        condition.push(0x2d);
        condition.extend([0, 0]);
        condition.extend(i32_const(state));
        condition.push(0x46);
        if_else(condition, yes, no)
    };
    let invoke = choose_state(
        0,
        if_else(field_relation(0x55), image(0), image(1)),
        choose_state(
            1,
            state_one,
            choose_state(2, state_two, choose_state(3, state_three, image(8))),
        ),
    );

    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, 1, 16]);
    let mut exports = vec![6];
    export(&mut exports, "memory", 2, 0);

    for (name, index) in [
        ("strategy_factory_plugin_input_ptr_v2", 0),
        ("strategy_factory_plugin_input_capacity_v2", 1),
        ("strategy_factory_plugin_output_ptr_v2", 2),
        ("strategy_factory_plugin_output_capacity_v2", 3),
        ("strategy_factory_plugin_invoke_v2", 4),
    ] {
        export(&mut exports, name, 0, index);
    }
    section(&mut wasm, 7, &exports);
    let mut code = vec![5];

    for value in [
        INPUT_PTR,
        input_capacity as i32,
        OUTPUT_PTR,
        output_capacity as i32,
    ] {
        function_body(&mut code, &i32_const(value));
    }
    function_body(&mut code, &invoke);
    section(&mut wasm, 10, &code);
    let mut data = Vec::new();
    u32_leb(&mut data, bodies.len() as u32);
    for (pointer, body) in pointers.into_iter().zip(bodies) {
        data.push(0);
        data.extend(i32_const(pointer));
        data.push(0x0b);
        u32_leb(&mut data, body.len() as u32);
        data.extend(body);
    }
    section(&mut wasm, 11, &data);
    Ok(wasm)
}

fn sample_input_frame(manifest: &PluginManifestV2) -> PluginFrameV2 {
    let values = manifest
        .input_ports
        .iter()
        .map(|port| match port.value_type {
            ValueTypeV2::I32 => TypedValueV2::i32(0),
            ValueTypeV2::I64 => TypedValueV2::i64(0),
            ValueTypeV2::U64 => TypedValueV2::u64(0),
            ValueTypeV2::I128 => TypedValueV2::i128(0),
            ValueTypeV2::Bytes => TypedValueV2::new(ValueTypeV2::Bytes, Vec::new()).unwrap(),
            ValueTypeV2::Digest32 => {
                TypedValueV2::digest(BindingDigest::from_untrusted_bytes([1; 32]))
            }
            ValueTypeV2::StableIdentity16 => TypedValueV2::stable_identity([1; 16]),
            ValueTypeV2::PositionIntentV1
            | ValueTypeV2::TargetVariantV1
            | ValueTypeV2::ProtectionVariantV1 => unreachable!("fixture has no semantic input"),
        })
        .collect();
    PluginFrameV2 {
        kind: PluginFrameKindV2::Input,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        output_availability: None,
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, vec![0]).unwrap(),
    }
}

fn output_frame(manifest: &PluginManifestV2, phase: Phase) -> PluginFrameV2 {
    let (position, target, units, protection, stop, take, distance, trailing, state) = match phase {
        Phase::Enter => (
            lifecycle_v1::ENTER_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            8,
            "kernel.protection.replace.v1",
            8_500,
            12_000,
            500,
            9_000,
            1,
        ),
        Phase::HoldZero => hold(0),
        Phase::HoldOne => hold(1),
        Phase::Add => (
            lifecycle_v1::ADD_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            16,
            lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID,
            0,
            0,
            0,
            9_500,
            2,
        ),
        Phase::HoldTwo => hold(2),
        Phase::Reduce => (
            lifecycle_v1::REDUCE_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            8,
            "kernel.protection.keep.v1",
            0,
            0,
            0,
            0,
            3,
        ),
        Phase::HoldThree => hold(3),
        Phase::Exit => (
            lifecycle_v1::EXIT_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            0,
            "kernel.protection.clear.v1",
            0,
            0,
            0,
            0,
            4,
        ),
        Phase::HoldFour => hold(4),
    };
    let values = manifest
        .output_ports
        .iter()
        .map(|port| match port.semantic_id.as_str() {
            "proposal.position-intent.v1" => {
                TypedValueV2::new(ValueTypeV2::PositionIntentV1, position.as_bytes()).unwrap()
            }
            "proposal.target-variant.v1" => {
                TypedValueV2::new(ValueTypeV2::TargetVariantV1, target.as_bytes()).unwrap()
            }
            "proposal.target-position.v1" | "proposal.reconciliation-target.v1" => {
                TypedValueV2::i64(units)
            }
            "proposal.target-weight.v1" => TypedValueV2::i32(0),
            "proposal.rebalance-sequence.v1" => TypedValueV2::u64(0),
            "proposal.protection-variant.v1" => {
                TypedValueV2::new(ValueTypeV2::ProtectionVariantV1, protection.as_bytes()).unwrap()
            }
            "proposal.stop-loss.v1" => TypedValueV2::i64(stop),
            "proposal.take-profit.v1" => TypedValueV2::i64(take),
            "proposal.trailing-distance.v1" => TypedValueV2::u64(distance),
            "proposal.trailing-stop.v1" => TypedValueV2::i64(trailing),
            value => panic!("unexpected output port {value}"),
        })
        .collect();
    PluginFrameV2 {
        kind: PluginFrameKindV2::Output,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        output_availability: (manifest.abi_version == PLUGIN_FRAME_ABI_V3)
            .then_some(PluginOutputAvailabilityV3::Ready),
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, vec![state]).unwrap(),
    }
}

fn hold(
    state: u8,
) -> (
    &'static str,
    &'static str,
    i64,
    &'static str,
    i64,
    i64,
    u64,
    i64,
    u8,
) {
    (
        lifecycle_v1::HOLD_SEMANTIC_ID,
        "kernel.target.keep.v1",
        0,
        "kernel.protection.keep.v1",
        0,
        0,
        0,
        0,
        state,
    )
}

fn payload_offset(bytes: &[u8], wanted: u16) -> anyhow::Result<usize> {
    let mut cursor = 96;
    while cursor < bytes.len() {
        let ordinal = u16::from_le_bytes(bytes[cursor..cursor + 2].try_into()?);
        let len = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into()?) as usize;
        if ordinal == wanted {
            return Ok(cursor + 8);
        }
        cursor += 8 + len;
    }
    anyhow::bail!("plugin frame ordinal {wanted} is absent")
}

fn output_image(body: &[u8], pointer: i32, output_count: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    for offset in (0..96).step_by(8) {
        bytes.extend(i32_const(OUTPUT_PTR));
        bytes.extend(i32_const(INPUT_PTR));
        bytes.push(0x29);
        bytes.push(3);
        u32_leb(&mut bytes, offset);
        bytes.push(0x37);
        bytes.push(3);
        u32_leb(&mut bytes, offset);
    }
    store_i32(&mut bytes, OUTPUT_PTR, i32::from_le_bytes(*b"SFPO"), 0);
    store_i32_16(&mut bytes, OUTPUT_PTR, (output_count + 1) as i32, 88);
    store_i32(&mut bytes, OUTPUT_PTR, body.len() as i32, 92);
    for offset in 0..body.len() {
        bytes.extend(i32_const(OUTPUT_PTR + 96));
        bytes.extend(i32_const(pointer));
        bytes.push(0x2d);
        bytes.push(0);
        u32_leb(&mut bytes, offset as u32);
        bytes.push(0x3a);
        bytes.push(0);
        u32_leb(&mut bytes, offset as u32);
    }
    bytes.extend(i32_const((96 + body.len()) as i32));
    bytes
}

fn if_else(mut condition: Vec<u8>, yes: Vec<u8>, no: Vec<u8>) -> Vec<u8> {
    condition.extend([0x04, 0x7f]);
    condition.extend(yes);
    condition.push(0x05);
    condition.extend(no);
    condition.push(0x0b);
    condition
}

fn frame_capacity(ports: &[super::strategy_design_v2::PortContractV2], state: u32) -> usize {
    96 + (ports.len() + 1) * 8
        + state as usize
        + ports
            .iter()
            .map(|port| port.max_bytes as usize)
            .sum::<usize>()
}

fn store_i32(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x36);
    bytes.push(2);
    u32_leb(bytes, offset);
}

fn store_i32_16(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x3b);
    bytes.push(1);
    u32_leb(bytes, offset);
}

fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
    wasm.push(id);
    u32_leb(wasm, payload.len() as u32);
    wasm.extend(payload);
}

fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
    name(bytes, export_name);
    bytes.push(kind);
    u32_leb(bytes, index);
}

fn name(bytes: &mut Vec<u8>, value: &str) {
    u32_leb(bytes, value.len() as u32);
    bytes.extend(value.as_bytes());
}

fn function_body(code: &mut Vec<u8>, operators: &[u8]) {
    let mut bytes = vec![0];
    bytes.extend(operators);
    bytes.push(0x0b);
    u32_leb(code, bytes.len() as u32);
    code.extend(bytes);
}

fn i32_const(value: i32) -> Vec<u8> {
    signed_leb(0x41, i64::from(value))
}

fn i64_const(value: i64) -> Vec<u8> {
    signed_leb(0x42, value)
}

fn signed_leb(opcode: u8, mut value: i64) -> Vec<u8> {
    let mut bytes = vec![opcode];

    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        bytes.push(if done { byte } else { byte | 0x80 });
        if done {
            return bytes;
        }
    }
}

fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        bytes.push(if value == 0 { byte } else { byte | 0x80 });
        if value == 0 {
            return;
        }
    }
}
