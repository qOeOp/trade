//! The Design every bounded feature program is authored into.
//!
//! A bounded feature program runs as one plugin that receives the Design's roles and emits the
//! eleven proposal outputs, and that shape is the same whichever surface stated the program. Both
//! the single-threshold author and the authoring language build their Designs here, so a role,
//! a port or a reaction is spelled one way.

use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    bounded_feature_program_v1::{
        BOUNDED_FEATURE_NUMERIC_FAILURE_V1, BOUNDED_FEATURE_PLUGIN_ABI_V1,
        BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1, OWNER_SAMPLE_COORDINATE_SOURCE_V1,
        manifest_width,
    },
    strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputRoleV2, InputScopeV2, LifecycleKindV2,
        PluginManifestV2, PluginStateContractV2, PortBindingV2, PortContractV2, ProposalWiringV2,
        ReactionGraphV2, ResourceBoundsV2, STRATEGY_DESIGN_SCHEMA_V2, StateCellV2, StateWriteV2,
        StrategyDesignV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{coordinate_port_id, strategy_input_role_identity_v2},
};

/// The bounded plugin every authored program runs as.
pub(crate) const PLUGIN_SEMANTIC_ID: &str = "research.plugin.bfp.v1";
/// The capability the bounded plugin runs under.
pub(crate) const CAPABILITY_SEMANTIC_ID: &str = "research.bfp.v1";
/// The Design state cell carrying the plugin's own serialized state.
pub(crate) const PLUGIN_STATE_CELL: &str = "research.state.bfp.v1";
/// Plugin state ports. The post port is named by the bounded ABI, not by this module.
pub(crate) const PLUGIN_STATE_PRE_PORT: &str = "plugin.state.pre.v1";
pub(crate) const PLUGIN_STATE_POST_PORT: &str = "plugin.state.post.v1";
/// The compute node the consuming reaction calls.
///
/// One of these two is bounded and the other is empty, decided by the input's Owner data kind.
/// Both were bounded until the Composer refused the result: a Bar-triggered and an Event-triggered
/// consumer of the same role contradict each other for every possible input.
pub(crate) const BAR_NODE: &str = "research.node.bfp.bar.v1";
pub(crate) const EVENT_NODE: &str = "research.node.bfp.event.v1";

/// One Design role the plugin receives, with the value port it arrives on and the coordinate port
/// its Owner sample coordinate arrives on.
struct ReceivedRole {
    role: InputRoleV2,
    value_port: String,
    coordinate_port: String,
}

impl ReceivedRole {
    fn new(role: InputRoleV2, value_port: String) -> Self {
        let coordinate_port = coordinate_port_id(strategy_input_role_identity_v2(&role));
        Self {
            role,
            value_port,
            coordinate_port,
        }
    }

    /// The two plugin input bindings of this role.
    ///
    /// An exact-instrument role is read as itself. A universe-member role is read at member 0: the
    /// program emits one instrument's proposal, and under a one-member universe the host lifts it
    /// into the universe's target set.
    fn bindings(&self) -> [PortBindingV2; 2] {
        let input_id = self.role.semantic_id.clone();
        let source_semantic_id = format!("{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({input_id})");
        let (value, coordinate) = match self.role.scope {
            InputScopeV2::ExactInstrument => (
                ValueRefV2::Input {
                    input_id: input_id.clone(),
                },
                ValueRefV2::OwnerSampleCoordinate {
                    input_id,
                    source_semantic_id,
                },
            ),
            InputScopeV2::UniverseMembers => (
                ValueRefV2::UniverseMemberInput {
                    input_id: input_id.clone(),
                    member_ordinal: 0,
                },
                ValueRefV2::UniverseMemberSampleCoordinate {
                    input_id,
                    member_ordinal: 0,
                    source_semantic_id,
                },
            ),
        };
        [
            PortBindingV2 {
                port_id: self.value_port.clone(),
                source: value,
            },
            PortBindingV2 {
                port_id: self.coordinate_port.clone(),
                source: coordinate,
            },
        ]
    }
}

/// What a bounded feature program's Design is built from: the Research identities a run supplies,
/// the roles the plugin receives with their value ports, and the bounds the program states.
pub(crate) struct BoundedFeatureDesignSpecV1<'a> {
    pub(crate) research_request_identity: BindingDigest,
    pub(crate) intent_identity: BindingDigest,
    pub(crate) intent_digest: BindingDigest,
    /// Each role with the plugin input port its value arrives on.
    pub(crate) received: Vec<(InputRoleV2, String)>,
    /// Whether the Owner data kind of an exact-instrument role is BAR.
    pub(crate) bar_triggered: bool,
    /// The plugin's serialized state bound, which the program's state cells may not exceed.
    pub(crate) state_max_bytes: u32,
    pub(crate) max_fuel: u64,
    pub(crate) falsifier: &'a str,
}

/// The one Design every bounded feature program is authored into: one plugin reacting to the
/// roles it receives, wired to the eleven proposal outputs.
pub(crate) fn bounded_feature_design_v1(spec: &BoundedFeatureDesignSpecV1<'_>) -> StrategyDesignV2 {
    let received = spec
        .received
        .iter()
        .map(|(role, port)| ReceivedRole::new(role.clone(), port.clone()))
        .collect::<Vec<_>>();
    // The host binds a plugin's inputs to its manifest ports by position, so the node's bindings
    // and the manifest's ports are listed in one order, the canonical one of the port ids.
    let mut bindings = received
        .iter()
        .flat_map(ReceivedRole::bindings)
        .collect::<Vec<_>>();
    bindings.sort_by(|a, b| a.port_id.as_bytes().cmp(b.port_id.as_bytes()));
    let input_ports = bindings
        .iter()
        .map(|binding| match binding.source {
            ValueRefV2::Input { .. } | ValueRefV2::UniverseMemberInput { .. } => PortContractV2 {
                semantic_id: binding.port_id.clone(),
                value_type: ValueTypeV2::I128,
                max_bytes: 16,
            },
            _ => PortContractV2 {
                semantic_id: binding.port_id.clone(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 308,
            },
        })
        .collect();

    // An exact-instrument role is consumed only by the lifecycle its Owner data kind triggers:
    // the Plan refuses a BAR role read by the EVENT reaction, and the reverse. A universe frame
    // carries both kinds, and the universe vertical requires exactly one compute node in each of
    // BAR and EVENT, so the universe-member form reads its roles in both.
    let universe = received
        .iter()
        .any(|received| received.role.scope == InputScopeV2::UniverseMembers);
    let reacts_to_bar = universe || spec.bar_triggered;
    let reacts_to_event = universe || !spec.bar_triggered;

    let manifest = PluginManifestV2 {
        semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        abi_version: BOUNDED_FEATURE_PLUGIN_ABI_V1,
        input_ports,
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
            max_bytes: spec.state_max_bytes,
        },
        capability_ids: vec![CAPABILITY_SEMANTIC_ID.to_owned()],
        // Measured per invocation on the Sim: about 86,000 for a program with no exits, 205,000
        // with a price exit, and 378,000 for the family's largest program, which names every
        // exit and enters in both directions. The 100,000 this was before is what that largest
        // program's measurement replaced: it ran out on its first frame.
        max_fuel: spec.max_fuel,
        max_linear_memory_bytes: 1_048_576,
        max_invocations_per_event: 1,
        failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.to_owned(),
    };

    StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: spec.research_request_identity,
        intent_identity: spec.intent_identity,
        intent_digest: spec.intent_digest,
        inputs: received
            .iter()
            .map(|received| received.role.clone())
            .collect(),
        joins: vec![],
        // One channel joins nothing and needs no parameter: the threshold is a frozen graph
        // constant, not a Design parameter, because a proposer declares it and the Design does not.
        parameters: vec![],
        state: vec![StateCellV2 {
            semantic_id: PLUGIN_STATE_CELL.to_owned(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: spec.state_max_bytes,
        }],
        reactions: vec![
            empty_reaction(LifecycleKindV2::Start),
            if reacts_to_bar {
                bounded_reaction(LifecycleKindV2::Bar, BAR_NODE, &bindings)
            } else {
                empty_reaction(LifecycleKindV2::Bar)
            },
            if reacts_to_event {
                bounded_reaction(LifecycleKindV2::Event, EVENT_NODE, &bindings)
            } else {
                empty_reaction(LifecycleKindV2::Event)
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
            max_inputs: u16::try_from(received.len())
                .expect("a Design declares fewer than 65536 roles"),
            max_nodes_per_reaction: 1,
            max_dependency_edges: 256,
            max_state_bytes: spec.state_max_bytes,
            max_plugin_calls_per_event: 1,
        },
        falsifier: spec.falsifier.to_owned(),
    }
}

/// A lifecycle the bounded plugin does not react to.
pub(crate) fn empty_reaction(kind: LifecycleKindV2) -> ReactionGraphV2 {
    ReactionGraphV2 {
        kind,
        nodes: vec![],
        state_writes: vec![],
        proposal: None,
    }
}

/// A lifecycle that calls the bounded plugin and wires its eleven outputs to the proposal.
pub(crate) fn bounded_reaction(
    kind: LifecycleKindV2,
    node_id: &str,
    bindings: &[PortBindingV2],
) -> ReactionGraphV2 {
    let compute = ComputeNodeV2 {
        semantic_id: node_id.to_owned(),
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        input_bindings: bindings.to_vec(),
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
