//! Authoring the one admitted Strategy family: a single channel against a single threshold.
//!
//! `docs/owners/rd.md` admits exactly one authoring slice, and bounds it twice. The family is "a
//! single declared channel compared against a single threshold", with the decision clock taken
//! from that channel. The output "stops at meaning": this module's product is the `design` and
//! `meaning` pair and nothing further - no syntax, no new primitive, no execution path. What it
//! emits is checked by the same contract that checks a hand-written declaration, which is why
//! there is no validation here that `prepare_bounded_feature_program_v1` already performs.
//!
//! The same document forbids the thing this module could easily have become: R&D does not derive
//! a Design from research prose, because a judgement an Owner makes is a fact the Owner invented.
//! So the input is not prose and not a description. Every judgement - which channel, which
//! threshold, which comparison, and what to propose on each side of it - is stated by the author
//! in `SingleThresholdAuthoringRequestV1`. This module decides nothing about the strategy. It
//! decides only the encoding: which fields of `StrategyDesignV2` and
//! `BoundedFeatureProgramMeaningV1` those judgements land in, and it derives nothing else because
//! everything else is already fixed by the schema, the catalog and the plugin manifest.
//!
//! One other place in this crate produces a `(design, meaning)` pair, and it is worth saying what
//! is different here. `bounded_feature_program_six_role_bar_fixture_v1` is a specimen: it takes no
//! authoring input, carries six fixed BAR roles, and gives all three of its decision branches the
//! same frame as the default, so the table it declares cannot change a proposal. It also exists
//! only under `#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]`, declared on its
//! `mod` line rather than in its own file. It is there to prove that a declaration assembles.
//!
//! So nothing outside a gated test could produce the pair before this module, and the pair that
//! could be produced had a decision table with no observable effect. This module is reachable from
//! an ordinary build, takes the author's judgements as input, and refuses the degenerate table
//! rather than emitting one.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_data::owner::strategy_input_binding::MarketDataFieldSemantic;

use crate::{
    bounded_feature_program_derivation_v1::{
        BoundedFeatureGraphBoundsV1, BoundedFeatureInputMeaningV1, BoundedFeatureProgramMeaningV1,
        redeclare_frozen_bounded_feature_program_v1,
    },
    bounded_feature_program_v1::{
        BOUNDED_FEATURE_NUMERIC_FAILURE_V1, BOUNDED_FEATURE_PLUGIN_ABI_V1,
        BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1, BoundedFeatureAvailabilityV1,
        BoundedFeatureClockV1, BoundedFeatureConstantV1, BoundedFeatureConstantValueV1,
        BoundedFeatureInputBindingV1, BoundedFeatureNodeV1, BoundedFeatureOutputPortV1,
        BoundedFeatureParametersV1, BoundedFeaturePredicateV1, BoundedFeatureProgramProposalV1,
        BoundedFeatureProposalDecisionBranchV1, BoundedFeatureProposalDecisionTableV1,
        BoundedFeatureProposalFrameV1, BoundedFeatureTerminalConversionV1,
        BoundedFeatureTerminalOutputV1, BoundedFeatureValueRefV1, BoundedFeatureValueTypeV1,
        BoundedFeatureWarmupContractV1, BoundedFeatureWarmupPostStateV1,
        CanonicalBoundedFeatureProgramV1, OWNER_SAMPLE_COORDINATE_SOURCE_V1, coordinate_port_id,
        manifest_width, prepare_bounded_feature_program_v1,
    },
    strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputFactClassV2, InputRoleV2, InputScopeV2,
        LifecycleKindV2, PluginManifestV2, PluginStateContractV2, PortBindingV2, PortContractV2,
        ProposalWiringV2, ReactionGraphV2, ResourceBoundsV2, STRATEGY_DESIGN_SCHEMA_V2,
        StateCellV2, StateWriteV2, StrategyDesignV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::strategy_input_role_identity_v2,
};

/// The bounded plugin every program in this family is authored against.
const PLUGIN_SEMANTIC_ID: &str = "research.plugin.bfp.v1";
/// The capability the bounded plugin runs under.
const CAPABILITY_SEMANTIC_ID: &str = "research.bfp.v1";
/// The Design state cell carrying the plugin's own serialized state.
const PLUGIN_STATE_CELL: &str = "research.state.bfp.v1";
/// Plugin state ports. The post port is named by the bounded ABI, not by this module.
const PLUGIN_STATE_PRE_PORT: &str = "plugin.state.pre.v1";
const PLUGIN_STATE_POST_PORT: &str = "plugin.state.post.v1";
/// The compute node the consuming reaction calls.
///
/// One of these two is bounded and the other is empty, decided by the input's Owner data kind.
/// Both were bounded until the Composer refused the result: a Bar-triggered and an Event-triggered
/// consumer of the same role contradict each other for every possible input.
const BAR_NODE: &str = "research.node.bfp.bar.v1";
const EVENT_NODE: &str = "research.node.bfp.event.v1";
/// The one graph node: the channel compared against the threshold.
const COMPARISON_NODE: &str = "channel-against-threshold";
/// Its single boolean output port.
const COMPARISON_PORT: &str = "value";
/// The manifest port the channel's value arrives on.
const CHANNEL_VALUE_PORT: &str = "input.channel.v1";
/// How wide the plugin's serialized state may be.
const PLUGIN_STATE_MAX_BYTES: u32 = 4096;

/// The one channel this family reads, as the author declares it.
///
/// `channel` and `fact_class` are absent on purpose: the family reads Market Data, and an author
/// that could name another Owner would be authoring a different family.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdChannelV1 {
    /// Identifier the Design and the graph both use for this role.
    pub role_semantic_id: String,
    /// Instrument the channel is read for.
    pub instrument: String,
    /// Market Data fact this channel carries.
    pub field_semantic_id: String,
    /// Bar timeframe.
    pub timeframe: String,
    /// Unit of the channel's value.
    pub unit: String,
    /// Fixed-point scale of the channel's value.
    pub scale: u8,
}

/// What the program proposes on one side of the threshold.
///
/// The eleven terminal outputs a frame must carry are not all here. The eight this type leaves
/// out - weight, rebalance, reconciliation and the five protection terminals - are the same on
/// both sides of a single threshold, so asking for them twice could only produce a disagreement
/// the author did not mean. The three that are here are the three that make one side a different
/// proposal from the other.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdOutcomeV1 {
    /// Lifecycle position intent, e.g. `kernel.position.enter.v1`.
    pub position_intent_semantic_id: String,
    /// Lifecycle target variant, e.g. `kernel.target.position.v1`.
    pub target_variant_semantic_id: String,
    /// Target position in units.
    pub target_position_units: i64,
}

/// Everything an author decides about one single-threshold program.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdAuthoringRequestV1 {
    /// The Research Request this program answers. An author does not invent it.
    pub research_request_identity: BindingDigest,
    /// The Research Intent identity the Request carries.
    pub intent_identity: BindingDigest,
    /// The Research Intent digest the Request carries.
    pub intent_digest: BindingDigest,
    /// The one channel read, which is also the decision clock.
    pub channel: SingleThresholdChannelV1,
    /// The threshold, in the channel's own unit and scale.
    ///
    /// The comparison primitive is equal-scale, so the threshold cannot carry a scale of its own:
    /// one that differed from the channel's would be refused, and one that agreed would be a
    /// restatement. Only the coefficient is declared.
    pub threshold_coefficient: i128,
    /// How the channel is compared against the threshold.
    pub comparison: BoundedFeaturePredicateV1,
    /// What to propose when the comparison holds.
    pub when_true: SingleThresholdOutcomeV1,
    /// What to propose otherwise.
    pub otherwise: SingleThresholdOutcomeV1,
    /// The statement this program can be wrong about.
    pub falsifier: String,
}

/// Why a request could not be authored into a program.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SingleThresholdAuthoringErrorV1 {
    /// A declared identifier is empty or padded.
    #[error("{0} must be a non-empty exact value")]
    Identifier(&'static str),
    /// Both sides of the threshold propose the same thing.
    ///
    /// Such a program assembles and prepares: the decision table is well-formed, the branch is
    /// reachable, and every terminal resolves. It simply cannot act on the comparison it declares,
    /// so the threshold it was authored around has no observable effect. Refusing it here is the
    /// difference between a program and a well-formed document.
    #[error(
        "both sides of the threshold propose the same frame, so the comparison cannot change a proposal"
    )]
    IndistinguishableOutcomes,
    /// The declared field semantic is not one the Owner resolves.
    ///
    /// The Owner's data kind decides which lifecycle may consume the input, so a semantic the
    /// Owner cannot resolve leaves that undecidable. Refusing here rather than guessing keeps the
    /// authored Design from being one the Composer must reject later, where the refusal would read
    /// as a fault of the program rather than of the request.
    #[error("channel.field_semantic_id {0} is not a field semantic this Owner resolves")]
    UnknownFieldSemantic(String),
}

/// Authors one single-threshold program: the Design it needs and the meaning a proposer declares.
///
/// The pair is returned together because neither half is checkable alone. Declared meaning names
/// a plugin, input roles and manifest ports, and only the Design says whether those exist; a
/// Design admits a shape of program, and only the meaning says which one. `declare` is handed
/// both, and so is the caller here.
///
/// # Errors
///
/// Returns [`SingleThresholdAuthoringErrorV1`] when a declared identifier is empty or padded, or
/// when both sides of the threshold propose the same frame.
pub fn author_single_threshold_program_v1(
    request: &SingleThresholdAuthoringRequestV1,
) -> Result<(StrategyDesignV2, BoundedFeatureProgramMeaningV1), SingleThresholdAuthoringErrorV1> {
    exact(
        &request.channel.role_semantic_id,
        "channel.role_semantic_id",
    )?;
    exact(&request.channel.instrument, "channel.instrument")?;
    exact(
        &request.channel.field_semantic_id,
        "channel.field_semantic_id",
    )?;
    exact(&request.channel.timeframe, "channel.timeframe")?;
    exact(&request.channel.unit, "channel.unit")?;
    exact(&request.falsifier, "falsifier")?;

    for (outcome, position_field, target_field) in [
        (
            &request.when_true,
            "when_true.position_intent_semantic_id",
            "when_true.target_variant_semantic_id",
        ),
        (
            &request.otherwise,
            "otherwise.position_intent_semantic_id",
            "otherwise.target_variant_semantic_id",
        ),
    ] {
        exact(&outcome.position_intent_semantic_id, position_field)?;
        exact(&outcome.target_variant_semantic_id, target_field)?;
    }

    // Checked before anything is built, because the two frames are what the rest of the program
    // exists to choose between.
    if request.when_true == request.otherwise {
        return Err(SingleThresholdAuthoringErrorV1::IndistinguishableOutcomes);
    }

    // The Owner's data kind decides which lifecycle may consume this input. `strategy_plan_v2`
    // maps BAR to Bar and QUOTE/TRADE/REFERENCE/ECONOMIC/SCALAR to Event, then requires the
    // consuming reaction's kind to equal it. This surface emitted both a Bar-triggered and an
    // Event-triggered consumer of the same role, which is refused for every possible input:
    // whichever kind the binding carries, the other reaction contradicts it.
    let semantic = MarketDataFieldSemantic::from_identity(&request.channel.field_semantic_id)
        .ok_or_else(|| {
            SingleThresholdAuthoringErrorV1::UnknownFieldSemantic(
                request.channel.field_semantic_id.clone(),
            )
        })?;
    let bar_triggered = semantic.data_kind() == "BAR";
    let design = design_for(request, bar_triggered);
    let meaning = meaning_for(request);
    Ok((design, meaning))
}

/// Refuses an identifier that is empty, or that carries surrounding whitespace.
fn exact(value: &str, field: &'static str) -> Result<(), SingleThresholdAuthoringErrorV1> {
    if value.is_empty() || value.trim() != value {
        return Err(SingleThresholdAuthoringErrorV1::Identifier(field));
    }
    Ok(())
}

/// The input role the Design declares, which is also what the role identity is taken over.
fn input_role(request: &SingleThresholdAuthoringRequestV1) -> InputRoleV2 {
    InputRoleV2 {
        semantic_id: request.channel.role_semantic_id.clone(),
        fact_class: InputFactClassV2::MarketData,
        instrument: request.channel.instrument.clone(),
        scope: InputScopeV2::ExactInstrument,
        field_semantic_id: request.channel.field_semantic_id.clone(),
        channel: "MARKET".to_owned(),
        timeframe: request.channel.timeframe.clone(),
        unit: request.channel.unit.clone(),
        scale: request.channel.scale,
        value_type: ValueTypeV2::I128,
    }
}

fn design_for(
    request: &SingleThresholdAuthoringRequestV1,
    bar_triggered: bool,
) -> StrategyDesignV2 {
    let input = input_role(request);
    let coordinate_port = coordinate_port_id(strategy_input_role_identity_v2(&input));
    let role = input.semantic_id.clone();

    let manifest = PluginManifestV2 {
        semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        abi_version: BOUNDED_FEATURE_PLUGIN_ABI_V1,
        input_ports: vec![
            PortContractV2 {
                semantic_id: CHANNEL_VALUE_PORT.to_owned(),
                value_type: ValueTypeV2::I128,
                max_bytes: 16,
            },
            PortContractV2 {
                semantic_id: coordinate_port.clone(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 308,
            },
        ],
        output_ports: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1
            .iter()
            .map(|(semantic_id, value_type)| PortContractV2 {
                semantic_id: (*semantic_id).to_owned(),
                value_type: *value_type,
                max_bytes: manifest_width(*value_type)
                    .expect("every proposal output port carries a bounded lifecycle value"),
            })
            .collect(),
        state: PluginStateContractV2 {
            pre_port_id: PLUGIN_STATE_PRE_PORT.to_owned(),
            post_port_id: PLUGIN_STATE_POST_PORT.to_owned(),
            value_type: ValueTypeV2::Bytes,
            max_bytes: PLUGIN_STATE_MAX_BYTES,
        },
        capability_ids: vec![CAPABILITY_SEMANTIC_ID.to_owned()],
        max_fuel: 100_000,
        max_linear_memory_bytes: 1_048_576,
        max_invocations_per_event: 1,
        failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.to_owned(),
    };

    StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: request.research_request_identity,
        intent_identity: request.intent_identity,
        intent_digest: request.intent_digest,
        inputs: vec![input],
        joins: vec![],
        // One channel joins nothing and needs no parameter: the threshold is a frozen graph
        // constant, not a Design parameter, because a proposer declares it and the Design does not.
        parameters: vec![],
        state: vec![StateCellV2 {
            semantic_id: PLUGIN_STATE_CELL.to_owned(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: PLUGIN_STATE_MAX_BYTES,
        }],
        reactions: vec![
            empty_reaction(LifecycleKindV2::Start),
            if bar_triggered {
                bounded_reaction(LifecycleKindV2::Bar, BAR_NODE, &role, &coordinate_port)
            } else {
                empty_reaction(LifecycleKindV2::Bar)
            },
            if bar_triggered {
                empty_reaction(LifecycleKindV2::Event)
            } else {
                bounded_reaction(LifecycleKindV2::Event, EVENT_NODE, &role, &coordinate_port)
            },
            empty_reaction(LifecycleKindV2::Fill),
            empty_reaction(LifecycleKindV2::Timer),
            empty_reaction(LifecycleKindV2::Stop),
        ],
        capabilities: vec![CapabilityDeclarationV2 {
            semantic_id: CAPABILITY_SEMANTIC_ID.to_owned(),
            version: 1,
            dependencies: vec![],
        }],
        plugins: vec![manifest],
        resources: ResourceBoundsV2 {
            max_inputs: 1,
            max_nodes_per_reaction: 1,
            max_dependency_edges: 256,
            max_state_bytes: PLUGIN_STATE_MAX_BYTES,
            max_plugin_calls_per_event: 1,
        },
        falsifier: request.falsifier.clone(),
    }
}

/// A lifecycle the bounded plugin does not react to.
fn empty_reaction(kind: LifecycleKindV2) -> ReactionGraphV2 {
    ReactionGraphV2 {
        kind,
        nodes: vec![],
        state_writes: vec![],
        proposal: None,
    }
}

/// A lifecycle that calls the bounded plugin and wires its eleven outputs to the proposal.
fn bounded_reaction(
    kind: LifecycleKindV2,
    node_id: &str,
    role: &str,
    coordinate_port: &str,
) -> ReactionGraphV2 {
    let compute = ComputeNodeV2 {
        semantic_id: node_id.to_owned(),
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        input_bindings: vec![
            PortBindingV2 {
                port_id: CHANNEL_VALUE_PORT.to_owned(),
                source: ValueRefV2::Input {
                    input_id: role.to_owned(),
                },
            },
            PortBindingV2 {
                port_id: coordinate_port.to_owned(),
                source: ValueRefV2::OwnerSampleCoordinate {
                    input_id: role.to_owned(),
                    source_semantic_id: format!("{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({role})"),
                },
            },
        ],
        pre_state: ValueRefV2::PriorState {
            state_id: PLUGIN_STATE_CELL.to_owned(),
        },
        output_port_ids: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1
            .iter()
            .map(|(id, _)| (*id).to_owned())
            .collect(),
        post_state_port_id: PLUGIN_STATE_POST_PORT.to_owned(),
    };
    let wire = |index: usize| ValueRefV2::NodeOutput {
        node_id: node_id.to_owned(),
        port_id: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1[index].0.to_owned(),
    };
    ReactionGraphV2 {
        kind,
        nodes: vec![compute],
        state_writes: vec![StateWriteV2 {
            state_id: PLUGIN_STATE_CELL.to_owned(),
            source: ValueRefV2::NodeOutput {
                node_id: node_id.to_owned(),
                port_id: PLUGIN_STATE_POST_PORT.to_owned(),
            },
        }],
        proposal: Some(ProposalWiringV2 {
            position_intent: wire(0),
            target_variant: wire(1),
            target_position_units: wire(2),
            target_weight_micros: wire(3),
            rebalance_sequence: wire(4),
            reconciliation_target_units: wire(5),
            protection_variant: wire(6),
            stop_loss_ticks: wire(7),
            take_profit_ticks: wire(8),
            trailing_distance_ticks: wire(9),
            trailing_stop_ticks: wire(10),
            member_target_set: None,
        }),
    }
}

/// Constant ids. The two sides carry their own three, which is what makes the frames differ.
const THRESHOLD: &str = "threshold";
const TRUE_POSITION: &str = "when-true-position";
const TRUE_TARGET: &str = "when-true-target";
const TRUE_TARGET_POSITION: &str = "when-true-target-position";
const FALSE_POSITION: &str = "otherwise-position";
const FALSE_TARGET: &str = "otherwise-target";
const FALSE_TARGET_POSITION: &str = "otherwise-target-position";
const TARGET_WEIGHT: &str = "target-weight";
const REBALANCE: &str = "rebalance";
const RECONCILIATION: &str = "reconciliation";
const PROTECTION: &str = "protection";
const STOP_LOSS: &str = "stop-loss";
const TAKE_PROFIT: &str = "take-profit";
const TRAILING_DISTANCE: &str = "trailing-distance";
const TRAILING_STOP: &str = "trailing-stop";

fn meaning_for(request: &SingleThresholdAuthoringRequestV1) -> BoundedFeatureProgramMeaningV1 {
    let role = request.channel.role_semantic_id.clone();

    BoundedFeatureProgramMeaningV1 {
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        inputs: vec![BoundedFeatureInputMeaningV1 {
            role_semantic_id: role.clone(),
            value_port_semantic_id: CHANNEL_VALUE_PORT.to_owned(),
            // The family's decision clock is the declared channel itself. With one channel there
            // is nothing to sample against, so the clock is its trigger.
            update_clock: BoundedFeatureClockV1::Trigger {
                input_role_id: role.clone(),
            },
        }],
        constants: constants(request),
        // The comparison is memoryless: it reads this sample and the frozen threshold. A state
        // cell would have to be written by some node, and there is no second node to write one.
        state_cells: vec![],
        nodes: vec![BoundedFeatureNodeV1 {
            node_id: COMPARISON_NODE.to_owned(),
            primitive_semantic_id: "bfp.fixed-i128.compare.equal-scale.v1".to_owned(),
            input_bindings: vec![
                BoundedFeatureInputBindingV1 {
                    port_id: "a".to_owned(),
                    source: BoundedFeatureValueRefV1::InputValue {
                        input_role_id: role,
                    },
                    require_ready: false,
                },
                BoundedFeatureInputBindingV1 {
                    port_id: "b".to_owned(),
                    source: BoundedFeatureValueRefV1::Constant {
                        constant_id: THRESHOLD.to_owned(),
                    },
                    require_ready: false,
                },
            ],
            output_ports: vec![BoundedFeatureOutputPortV1 {
                port_id: COMPARISON_PORT.to_owned(),
                value_type: BoundedFeatureValueTypeV1::Boolean,
                availability: BoundedFeatureAvailabilityV1::Ready,
            }],
            parameters: BoundedFeatureParametersV1::ComparisonPredicate {
                predicate: request.comparison,
            },
            state_id: None,
            update_clock: None,
        }],
        proposal_decision_table: BoundedFeatureProposalDecisionTableV1 {
            branches: vec![BoundedFeatureProposalDecisionBranchV1 {
                priority: 10,
                predicate: BoundedFeatureValueRefV1::NodeOutput {
                    node_id: COMPARISON_NODE.to_owned(),
                    port_id: COMPARISON_PORT.to_owned(),
                },
                frame: frame(
                    &request.when_true,
                    TRUE_POSITION,
                    TRUE_TARGET,
                    TRUE_TARGET_POSITION,
                ),
            }],
            // Not a fallback: it is the other side of the threshold, and
            // `IndistinguishableOutcomes` is what keeps it from collapsing into the branch.
            default_frame: frame(
                &request.otherwise,
                FALSE_POSITION,
                FALSE_TARGET,
                FALSE_TARGET_POSITION,
            ),
        },
        warmup: BoundedFeatureWarmupContractV1 {
            // Before the first sample the program has compared nothing, so it proposes neither
            // side of its own threshold and holds.
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
            max_nodes: 1,
            max_edges: 64,
            max_depth: 2,
            max_ports: 16,
            max_constants: 15,
            // Not one. The eight terminals a single threshold does not change are declared once
            // and consumed by both frames, so every one of them has a fan-out of two.
            max_fan_out: 16,
            // The graph declares no lag and no rolling window, and a zero bound is refused
            // outright, so both carry the smallest bound a program may state.
            max_lag: 1,
            max_window: 1,
            max_state_cells: 1,
            max_decision_branches: 1,
            max_source_bytes: 262_144,
            max_wasm_bytes: 1_048_576,
        },
    }
}

fn constants(request: &SingleThresholdAuthoringRequestV1) -> Vec<BoundedFeatureConstantV1> {
    let outcome = |ids: (&str, &str, &str), o: &SingleThresholdOutcomeV1| {
        [
            (
                ids.0.to_owned(),
                BoundedFeatureConstantValueV1::PositionIntentV1 {
                    semantic_id: o.position_intent_semantic_id.clone(),
                },
            ),
            (
                ids.1.to_owned(),
                BoundedFeatureConstantValueV1::TargetVariantV1 {
                    semantic_id: o.target_variant_semantic_id.clone(),
                },
            ),
            (
                ids.2.to_owned(),
                BoundedFeatureConstantValueV1::I64 {
                    value: o.target_position_units,
                },
            ),
        ]
    };

    let mut values = vec![(
        THRESHOLD.to_owned(),
        // The comparison primitive is equal-scale, so the threshold takes the channel's own unit
        // and scale. Nothing here can disagree with the channel, because nothing here restates it.
        BoundedFeatureConstantValueV1::FixedI128 {
            coefficient: request.threshold_coefficient,
            unit: request.channel.unit.clone(),
            scale: request.channel.scale,
        },
    )];
    values.extend(outcome(
        (TRUE_POSITION, TRUE_TARGET, TRUE_TARGET_POSITION),
        &request.when_true,
    ));
    values.extend(outcome(
        (FALSE_POSITION, FALSE_TARGET, FALSE_TARGET_POSITION),
        &request.otherwise,
    ));
    // Shared by both frames: a single threshold does not change them, so the author is not asked
    // for them twice.
    values.extend([
        (
            TARGET_WEIGHT.to_owned(),
            BoundedFeatureConstantValueV1::I32 { value: 0 },
        ),
        (
            REBALANCE.to_owned(),
            BoundedFeatureConstantValueV1::U64 { value: 1 },
        ),
        (
            RECONCILIATION.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
        (
            PROTECTION.to_owned(),
            BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                semantic_id: "kernel.protection.keep.v1".to_owned(),
            },
        ),
        (
            STOP_LOSS.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
        (
            TAKE_PROFIT.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
        (
            TRAILING_DISTANCE.to_owned(),
            BoundedFeatureConstantValueV1::U64 { value: 0 },
        ),
        (
            TRAILING_STOP.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
    ]);

    values
        .into_iter()
        .map(|(constant_id, value)| BoundedFeatureConstantV1 { constant_id, value })
        .collect()
}

/// One side of the threshold, as the eleven terminal outputs a frame must carry.
fn frame(
    outcome: &SingleThresholdOutcomeV1,
    position: &str,
    target: &str,
    target_position: &str,
) -> BoundedFeatureProposalFrameV1 {
    BoundedFeatureProposalFrameV1 {
        terminal_outputs: [
            (
                "proposal.position-intent.v1",
                outcome.position_intent_semantic_id.as_str(),
                position,
            ),
            (
                "proposal.target-variant.v1",
                outcome.target_variant_semantic_id.as_str(),
                target,
            ),
            (
                "proposal.target-position.v1",
                outcome.target_variant_semantic_id.as_str(),
                target_position,
            ),
            (
                "proposal.target-weight.v1",
                "kernel.target.weight.v1",
                TARGET_WEIGHT,
            ),
            (
                "proposal.rebalance-sequence.v1",
                "kernel.target.rebalance.v1",
                REBALANCE,
            ),
            (
                "proposal.reconciliation-target.v1",
                outcome.target_variant_semantic_id.as_str(),
                RECONCILIATION,
            ),
            (
                "proposal.protection-variant.v1",
                "kernel.protection.keep.v1",
                PROTECTION,
            ),
            (
                "proposal.stop-loss.v1",
                "kernel.protection.stop-loss.v1",
                STOP_LOSS,
            ),
            (
                "proposal.take-profit.v1",
                "kernel.protection.take-profit.v1",
                TAKE_PROFIT,
            ),
            (
                "proposal.trailing-distance.v1",
                "kernel.protection.trailing-adjust.v1",
                TRAILING_DISTANCE,
            ),
            (
                "proposal.trailing-stop.v1",
                "kernel.protection.trailing-adjust.v1",
                TRAILING_STOP,
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

/// What a proposer hands the Owner, in the exact shape the Owner's route accepts.
///
/// The proposer is not the Owner: `docs/owners/rd.md` assigns this translation to "a language
/// model, a person or any other caller", so the two sides are separate programs and the only
/// thing joining them is this JSON. Both ends had their own tests and nothing compared them,
/// which is the shape this repository keeps finding: two healthy parts and an unmeasured wire.
///
/// It lives here rather than in the binary so that a test can serialise what the binary actually
/// emits, instead of a copy of it that drifts on the next edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesignRoleIntentProposalV1 {
    /// The body of `POST /v1/strategy-designs/publish-role-intent`, field for field. The route
    /// declares `deny_unknown_fields`, so an extra key here is a refusal there.
    pub publish_role_intent: PublishRoleIntentBodyV1,
    /// The meaning that belongs with the Design. The Owner derives its own; this is what the
    /// proposer computed, carried so the author can compare them.
    pub meaning: BoundedFeatureProgramMeaningV1,
}

/// The publish-role-intent request body a proposer emits.
///
/// The caller states no identity, digest or role coordinate of its own: the Owner derives all of
/// them from the Design and from the Research custody the locator names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishRoleIntentBodyV1 {
    /// Names a request the Owner already holds. The proposer does not invent it.
    pub research_request_locator: String,
    pub design: StrategyDesignV2,
}

impl DesignRoleIntentProposalV1 {
    /// Authors the pair and packages it as the Owner's route expects it.
    ///
    /// # Errors
    ///
    /// Returns the authoring refusal under its own name when the statement is not one this
    /// family admits.
    pub fn author(
        research_request_locator: impl Into<String>,
        request: &SingleThresholdAuthoringRequestV1,
    ) -> Result<Self, SingleThresholdAuthoringErrorV1> {
        let (design, meaning) = author_single_threshold_program_v1(request)?;
        Ok(Self {
            publish_role_intent: PublishRoleIntentBodyV1 {
                research_request_locator: research_request_locator.into(),
                design,
            },
            meaning,
        })
    }
}

/// Recovers the author's request from a Design and a program the Owner froze, or `None` when the
/// pair is not exactly what this family authors.
///
/// Membership is decided by authoring, not by a second reading of the family's shape. A candidate
/// request is read out of the pair leniently and then authored again, and the pair belongs to the
/// family only when that reproduces the stored program's canonical bytes, which bind the stored
/// Design's identity and digest as well. A candidate that is wrong in any field therefore fails
/// closed instead of stating a strategy the program does not run, and a later change to how this
/// family authors cannot leave a stale recognizer behind, because there is no recognizer apart
/// from the author.
///
/// A program frozen by an earlier version of this author that the current one no longer
/// reproduces is outside the family by this test. That is the honest answer: the statement this
/// returns is one the current author would turn back into exactly that program.
pub(crate) fn recover_single_threshold_request_v1(
    design: &StrategyDesignV2,
    frozen: &CanonicalBoundedFeatureProgramV1,
) -> Option<SingleThresholdAuthoringRequestV1> {
    let candidate = candidate_request(design, frozen.program())?;
    let (authored_design, authored_meaning) =
        author_single_threshold_program_v1(&candidate).ok()?;

    // One comparison covers both halves. The redeclared program is assembled against the authored
    // Design, so it carries that Design's identity and digest; its canonical bytes equal the
    // frozen program's only if the authored Design is also the frozen one. A separate Design
    // comparison was written first and removed after mutation showed nothing depended on it.
    let redeclared = redeclare_frozen_bounded_feature_program_v1(
        &authored_design,
        frozen.program(),
        &authored_meaning,
    )
    .ok()?;
    let reprepared = prepare_bounded_feature_program_v1(redeclared, &authored_design).ok()?;
    (reprepared.canonical_bytes() == frozen.canonical_bytes()).then_some(candidate)
}

/// Reads a candidate request out of a Design and program by the ids this family writes.
///
/// Nothing here is a judgement that the pair is in the family. Every field is only a guess until
/// [`recover_single_threshold_request_v1`] authors it again and compares.
fn candidate_request(
    design: &StrategyDesignV2,
    program: &BoundedFeatureProgramProposalV1,
) -> Option<SingleThresholdAuthoringRequestV1> {
    let [input] = design.inputs.as_slice() else {
        return None;
    };
    let constant = |constant_id: &str| {
        program
            .constants
            .iter()
            .find(|constant| constant.constant_id == constant_id)
            .map(|constant| &constant.value)
    };
    let BoundedFeatureConstantValueV1::FixedI128 { coefficient, .. } = constant(THRESHOLD)? else {
        return None;
    };
    let comparison = program
        .nodes
        .iter()
        .find(|node| node.node_id == COMPARISON_NODE)
        .and_then(|node| match &node.parameters {
            BoundedFeatureParametersV1::ComparisonPredicate { predicate } => Some(*predicate),
            _ => None,
        })?;
    let outcome = |position: &str, target: &str, target_position: &str| {
        let (
            BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: position_intent_semantic_id,
            },
            BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: target_variant_semantic_id,
            },
            BoundedFeatureConstantValueV1::I64 {
                value: target_position_units,
            },
        ) = (
            constant(position)?,
            constant(target)?,
            constant(target_position)?,
        )
        else {
            return None;
        };
        Some(SingleThresholdOutcomeV1 {
            position_intent_semantic_id: position_intent_semantic_id.clone(),
            target_variant_semantic_id: target_variant_semantic_id.clone(),
            target_position_units: *target_position_units,
        })
    };

    Some(SingleThresholdAuthoringRequestV1 {
        research_request_identity: design.research_request_identity,
        intent_identity: design.intent_identity,
        intent_digest: design.intent_digest,
        channel: SingleThresholdChannelV1 {
            role_semantic_id: input.semantic_id.clone(),
            instrument: input.instrument.clone(),
            field_semantic_id: input.field_semantic_id.clone(),
            timeframe: input.timeframe.clone(),
            unit: input.unit.clone(),
            scale: input.scale,
        },
        threshold_coefficient: *coefficient,
        comparison,
        when_true: outcome(TRUE_POSITION, TRUE_TARGET, TRUE_TARGET_POSITION)?,
        otherwise: outcome(FALSE_POSITION, FALSE_TARGET, FALSE_TARGET_POSITION)?,
        falsifier: design.falsifier.clone(),
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_indicators_kernel::PrimitiveCatalogV1;

    use super::*;
    use crate::{
        bounded_feature_program_derivation_v1::derive_bounded_feature_program_proposal_v1,
        bounded_feature_program_v1::prepare_bounded_feature_program_v1,
        strategy_plan_v2::{
            StrategyDesignPreparationV2, prepare_strategy_design_v2,
            verified_strategy_input_bindings_for_test,
        },
    };

    /// A distinct, non-degenerate receipt digest. `validate_inputs_and_constants` refuses an
    /// all-zero digest, so a digest that is merely absent must not read as one that is present.
    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    /// The shipped example must deserialise and author.
    ///
    /// The example is what `strategy-factory-author-role-intent` is documented with, so it is the
    /// only statement of the wire form: the comparison is `GREATER`, not `Greater`, and each
    /// digest is thirty-two numbers, not hex. Both were gotten wrong on the first attempt to feed
    /// the binary by hand, and neither is visible from the Rust types. Deriving serde does not
    /// document what it produces; an example that must parse does.
    #[rstest]
    fn the_shipped_example_statement_parses_and_authors() {
        #[derive(serde::Deserialize)]
        struct Example {
            research_request_locator: String,
            authoring: SingleThresholdAuthoringRequestV1,
        }
        let raw = include_str!("../test_data/single_threshold/example_statement.json");
        let example: Example =
            serde_json::from_str(raw).expect("the shipped example parses as a statement");
        assert!(
            !example.research_request_locator.is_empty(),
            "the example names a locator, because the route's body carries one"
        );
        let (design, meaning) = author_single_threshold_program_v1(&example.authoring)
            .expect("the shipped example is authorable");
        // Serialising is the half the binary adds, and a type that authors but cannot be written
        // out would make the binary useless while every test here still passed.
        serde_json::to_string(&design).expect("the design serialises");
        serde_json::to_string(&meaning).expect("the meaning serialises");
    }

    fn request() -> SingleThresholdAuthoringRequestV1 {
        SingleThresholdAuthoringRequestV1 {
            research_request_identity: digest(1),
            intent_identity: digest(2),
            intent_digest: digest(3),
            channel: SingleThresholdChannelV1 {
                role_semantic_id: "research.input.close.daily.v1".to_owned(),
                instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                timeframe: "1D".to_owned(),
                unit: "PRICE".to_owned(),
                scale: 2,
            },
            threshold_coefficient: 10_000,
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 1,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
            },
            falsifier: "the channel never crosses the threshold in the admitted window".to_owned(),
        }
    }

    /// Owner-shaped custody whose receipts are this test's own, not the request's.
    fn bindings(
        design: &StrategyDesignV2,
    ) -> crate::strategy_plan_v2::VerifiedStrategyInputBindingsV2 {
        verified_strategy_input_bindings_for_test(
            design,
            design
                .inputs
                .iter()
                .enumerate()
                .map(|(index, role)| {
                    let mut bytes = [0x5au8; 32];
                    bytes[0] = u8::try_from(index).expect("fewer than 256 roles");
                    (role.clone(), BindingDigest::from_untrusted_bytes(bytes))
                })
                .collect(),
        )
    }

    /// What the whole module is for: an authored pair must survive the same two steps a
    /// hand-written declaration does, with no database in reach of either.
    ///
    /// `derive` copies the graph through without inspecting it, so it cannot fail on a bad graph;
    /// `prepare` is what judges identity, bounds, inputs, the graph and the terminals. Both are
    /// here because passing only the first would prove the pair is well-formed, not that it is a
    /// program.
    #[rstest]
    fn an_authored_pair_derives_and_prepares() {
        let (design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");

        let proposal = derive_bounded_feature_program_proposal_v1(
            &design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            &meaning,
            &bindings(&design),
        )
        .unwrap_or_else(|e| panic!("authored meaning does not assemble: {e}"));

        prepare_bounded_feature_program_v1(proposal, &design)
            .unwrap_or_else(|e| panic!("the assembled proposal does not prepare: {e}"));
    }

    /// Freezes a Design and meaning the way the Owner does: derive against Owner custody, then
    /// prepare, which is where canonical ordering and every judgement happens.
    fn frozen(
        design: &StrategyDesignV2,
        meaning: &BoundedFeatureProgramMeaningV1,
    ) -> CanonicalBoundedFeatureProgramV1 {
        let proposal = derive_bounded_feature_program_proposal_v1(
            design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            meaning,
            &bindings(design),
        )
        .unwrap_or_else(|e| panic!("meaning does not assemble: {e}"));
        prepare_bounded_feature_program_v1(proposal, design)
            .unwrap_or_else(|e| panic!("the assembled proposal does not prepare: {e}"))
    }

    fn authored(
        request: &SingleThresholdAuthoringRequestV1,
    ) -> (StrategyDesignV2, CanonicalBoundedFeatureProgramV1) {
        let (design, meaning) =
            author_single_threshold_program_v1(request).expect("the request is authorable");
        let program = frozen(&design, &meaning);
        (design, program)
    }

    /// Every declared field is read out of the frozen pair, not assumed: each case differs from
    /// the base request in one field, and the statement read back must differ in that field too.
    #[rstest]
    #[case::base(|_: &mut SingleThresholdAuthoringRequestV1| {})]
    #[case::threshold(|r: &mut SingleThresholdAuthoringRequestV1| r.threshold_coefficient = -12_345)]
    #[case::comparison(|r: &mut SingleThresholdAuthoringRequestV1| r.comparison = BoundedFeaturePredicateV1::LessOrEqual)]
    #[case::scale(|r: &mut SingleThresholdAuthoringRequestV1| r.channel.scale = 4)]
    #[case::instrument(|r: &mut SingleThresholdAuthoringRequestV1| r.channel.instrument = "ETHUSDT-PERP.BINANCE".to_owned())]
    #[case::timeframe(|r: &mut SingleThresholdAuthoringRequestV1| r.channel.timeframe = "1H".to_owned())]
    #[case::when_true(|r: &mut SingleThresholdAuthoringRequestV1| r.when_true.target_position_units = 3)]
    #[case::otherwise(|r: &mut SingleThresholdAuthoringRequestV1| r.otherwise.position_intent_semantic_id = "kernel.position.hold.v1".to_owned())]
    #[case::falsifier(|r: &mut SingleThresholdAuthoringRequestV1| r.falsifier = "a different statement to be wrong about".to_owned())]
    fn a_frozen_authored_program_states_the_request_it_was_authored_from(
        #[case] change: fn(&mut SingleThresholdAuthoringRequestV1),
    ) {
        let mut expected = request();
        change(&mut expected);
        let (design, program) = authored(&expected);

        assert_eq!(
            recover_single_threshold_request_v1(&design, &program),
            Some(expected)
        );
    }

    /// A program whose declared fields all read back cleanly, but which fixes a terminal this
    /// family never varies, is not in the family. Reading alone would state a strategy for it;
    /// authoring again is what refuses.
    #[rstest]
    fn a_program_the_family_would_not_author_has_no_statement() {
        let (design, mut meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let weight = meaning
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == TARGET_WEIGHT)
            .expect("the family declares a target weight");
        weight.value = BoundedFeatureConstantValueV1::I32 { value: 7 };
        let program = frozen(&design, &meaning);

        assert_eq!(recover_single_threshold_request_v1(&design, &program), None);
    }

    /// The same for the Design half: a Design the family would not write, carrying a program the
    /// family would, is not in the family either.
    #[rstest]
    fn a_design_the_family_would_not_author_has_no_statement() {
        let (mut design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        design.resources.max_dependency_edges = 255;
        let program = frozen(&design, &meaning);

        assert_eq!(recover_single_threshold_request_v1(&design, &program), None);
    }

    /// The Design half must canonicalize on its own, which is what gives the pair an identity.
    #[rstest]
    fn the_authored_design_canonicalizes() {
        let (design, _) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");

        assert!(
            matches!(
                prepare_strategy_design_v2(&design),
                StrategyDesignPreparationV2::Prepared { .. }
            ),
            "an authored Design canonicalizes",
        );
    }

    /// The refusal this module adds over the existing specimen.
    ///
    /// The positive control is the whole point: the identical-outcome program is refused *here*,
    /// and the only difference from the accepted request above is the outcome. Without that
    /// control this test would also pass if authoring refused everything.
    #[rstest]
    fn two_identical_outcomes_are_refused() {
        let mut degenerate = request();
        degenerate.otherwise = degenerate.when_true.clone();

        assert_eq!(
            author_single_threshold_program_v1(&degenerate),
            Err(SingleThresholdAuthoringErrorV1::IndistinguishableOutcomes),
        );
        assert!(
            author_single_threshold_program_v1(&request()).is_ok(),
            "the same request with differing outcomes is authorable",
        );
    }

    /// Both frames must be emitted in full, and they must differ.
    ///
    /// A frame that dropped a terminal, or two frames that agreed on every terminal, would still
    /// derive and prepare. This is what `prepare` cannot catch.
    #[rstest]
    fn the_two_frames_are_complete_and_distinct() {
        let (_, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let table = &meaning.proposal_decision_table;

        assert_eq!(table.branches.len(), 1, "one threshold means one branch");
        for frame in [&table.branches[0].frame, &table.default_frame] {
            assert_eq!(
                frame.terminal_outputs.len(),
                11,
                "every frame carries the manifest's whole proposal port set",
            );
        }
        assert_ne!(
            table.branches[0].frame, table.default_frame,
            "the two sides of the threshold propose different frames",
        );
    }

    /// The threshold takes the channel's unit and scale, because the primitive is equal-scale.
    #[rstest]
    fn the_threshold_carries_the_channel_unit_and_scale() {
        let source = request();
        let (_, meaning) =
            author_single_threshold_program_v1(&source).expect("the request is authorable");

        let threshold = meaning
            .constants
            .iter()
            .find(|constant| constant.constant_id == THRESHOLD)
            .expect("the graph declares its threshold");

        assert_eq!(
            threshold.value,
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient: source.threshold_coefficient,
                unit: source.channel.unit.clone(),
                scale: source.channel.scale,
            },
        );
    }

    /// An empty or padded identifier is refused, and the field is named.
    #[rstest]
    #[case::empty("")]
    #[case::padded(" research.input.close.daily.v1 ")]
    fn an_inexact_identifier_is_refused(#[case] role: &str) {
        let mut inexact = request();
        inexact.channel.role_semantic_id = role.to_owned();

        assert_eq!(
            author_single_threshold_program_v1(&inexact),
            Err(SingleThresholdAuthoringErrorV1::Identifier(
                "channel.role_semantic_id"
            )),
        );
    }
}
