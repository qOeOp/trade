//! The canonical form of a Bounded Feature Program: what two programs share exactly when they are
//! the same program.
//!
//! `docs/owners/rd.md` (Strategy authoring surface, *Acceptance*) defines it for the authoring
//! compiler's corpus equivalence. Every node, constant and state identity is replaced with a
//! structural digest over its inputs in port order, decision priorities are kept only by their
//! relative order, and the bounds are dropped. A compiled document and the hand-written program it
//! rewrites are equal in canonical form exactly when they differ only in what the form drops.
//!
//! Port order is the order the node binds its ports in, never a sorted one, so swapping the operands
//! of `sub` changes the form. What the form keeps as it is: the Design's input roles (the program's
//! interface, not its identities), port ids (a primitive's, not the author's), parameters, output
//! types, clocks, terminal conversions, the warmup contract, and every Design and catalog digest.
//!
//! A state cell is written by a node that may read the same cell, so a state's digest cannot hold
//! its writer's. Digests are taken twice. The shallow pass digests a state by its kind, seed and
//! size alone; the full pass digests a state by its shallow digest and its writer's shallow digest,
//! and every node again with full digests. Two cells differing only in their writer are then told
//! apart, and a cycle through state never recurses.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use sha2::{Digest as _, Sha256};

use crate::bounded_feature_program_v1::{
    BoundedFeatureClockV1, BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1,
    BoundedFeatureInputV1, BoundedFeatureOutputPortV1, BoundedFeatureParametersV1,
    BoundedFeatureProgramProposalV1, BoundedFeatureProposalFrameV1, BoundedFeatureStateKindV1,
    BoundedFeatureTerminalConversionV1, BoundedFeatureValueRefV1, BoundedFeatureWarmupContractV1,
};
use vibe_data::owner::source_binding::BindingDigest;

/// A structural digest standing in for an identity the author chose.
type StructuralDigestV1 = [u8; 32];

/// One program in canonical form.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct CanonicalBoundedFeatureProgramFormV1 {
    schema_version: u16,
    semantic_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    plugin_semantic_id: String,
    plugin_manifest_digest: BindingDigest,
    catalog_semantic_version: u16,
    catalog_digest: BindingDigest,
    first_party_sdk_source_digest: BindingDigest,
    inputs: Vec<BoundedFeatureInputV1>,
    carried_input_role_ids: Vec<String>,
    constants: Vec<CanonicalConstantV1>,
    state_cells: Vec<CanonicalStateCellV1>,
    nodes: Vec<CanonicalNodeV1>,
    branches: Vec<CanonicalBranchV1>,
    default_frame: Vec<CanonicalTerminalV1>,
    warmup: BoundedFeatureWarmupContractV1,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct CanonicalConstantV1 {
    digest: StructuralDigestV1,
    value: BoundedFeatureConstantValueV1,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct CanonicalStateCellV1 {
    digest: StructuralDigestV1,
    writer: StructuralDigestV1,
    kind: BoundedFeatureStateKindV1,
    initial: Option<StructuralDigestV1>,
    max_bytes: u32,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct CanonicalNodeV1 {
    digest: StructuralDigestV1,
    primitive_semantic_id: String,
    parameters: BoundedFeatureParametersV1,
    inputs: Vec<CanonicalBindingV1>,
    outputs: Vec<BoundedFeatureOutputPortV1>,
    state: Option<StructuralDigestV1>,
    update_clock: Option<BoundedFeatureClockV1>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct CanonicalBindingV1 {
    port_id: String,
    source: CanonicalRefV1,
    require_ready: bool,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
enum CanonicalRefV1 {
    InputValue(String),
    InputCoordinate(String),
    Constant(StructuralDigestV1),
    PriorState(StructuralDigestV1),
    NodeOutput(StructuralDigestV1, String),
}

/// A decision branch in evaluation order. Its priority is kept only as its place in that order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct CanonicalBranchV1 {
    predicate: CanonicalRefV1,
    frame: Vec<CanonicalTerminalV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct CanonicalTerminalV1 {
    manifest_port_id: String,
    lifecycle_semantic_id: String,
    source: CanonicalRefV1,
    conversion: BoundedFeatureTerminalConversionV1,
}

/// Why a program has no canonical form: it names an identity it does not declare.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CanonicalFormErrorV1 {
    UnknownConstant(String),
    UnknownState(String),
    UnknownNode(String),
    /// Node outputs refer to each other in a cycle, which no program `prepare` admits has.
    NodeCycle(String),
}

impl CanonicalBoundedFeatureProgramFormV1 {
    /// Projects `program` onto its canonical form.
    ///
    /// # Errors
    ///
    /// Names the first identity `program` refers to without declaring, or a cycle between node
    /// outputs.
    pub(crate) fn of(
        program: &BoundedFeatureProgramProposalV1,
    ) -> Result<Self, CanonicalFormErrorV1> {
        let constants = program
            .constants
            .iter()
            .map(|constant| {
                (
                    constant.constant_id.as_str(),
                    digest_of(&("constant", &constant.value)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let shallow = Digests::take(program, &constants, None)?;
        let full_states = program
            .state_cells
            .iter()
            .map(|cell| {
                let writer = shallow
                    .nodes
                    .get(cell.writer_node_id.as_str())
                    .ok_or_else(|| {
                        CanonicalFormErrorV1::UnknownNode(cell.writer_node_id.clone())
                    })?;
                let own = shallow.states[cell.state_id.as_str()];
                Ok((cell.state_id.as_str(), digest_of(&("state", own, writer))))
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let full = Digests::take(program, &constants, Some(&full_states))?;

        let mut constant_forms = program
            .constants
            .iter()
            .map(|constant| CanonicalConstantV1 {
                digest: constants[constant.constant_id.as_str()],
                value: constant.value.clone(),
            })
            .collect::<Vec<_>>();
        constant_forms.sort();
        let mut state_forms = program
            .state_cells
            .iter()
            .map(|cell| {
                Ok(CanonicalStateCellV1 {
                    digest: full.states[cell.state_id.as_str()],
                    writer: full.nodes[cell.writer_node_id.as_str()],
                    kind: cell.state_kind.clone(),
                    initial: initial_digest(&cell.initial, &constants)?,
                    max_bytes: cell.max_bytes,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        state_forms.sort();
        let mut node_forms = program
            .nodes
            .iter()
            .map(|node| {
                Ok(CanonicalNodeV1 {
                    digest: full.nodes[node.node_id.as_str()],
                    primitive_semantic_id: node.primitive_semantic_id.clone(),
                    parameters: node.parameters.clone(),
                    inputs: node
                        .input_bindings
                        .iter()
                        .map(|binding| {
                            Ok(CanonicalBindingV1 {
                                port_id: binding.port_id.clone(),
                                source: full.reference(&binding.source, &constants)?,
                                require_ready: binding.require_ready,
                            })
                        })
                        .collect::<Result<_, _>>()?,
                    outputs: node.output_ports.clone(),
                    state: node
                        .state_id
                        .as_deref()
                        .map(|state| full.state(state))
                        .transpose()?,
                    update_clock: node.update_clock.clone(),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        node_forms.sort();
        let frame = |frame: &BoundedFeatureProposalFrameV1| {
            frame
                .terminal_outputs
                .iter()
                .map(|terminal| {
                    Ok(CanonicalTerminalV1 {
                        manifest_port_id: terminal.manifest_port_id.clone(),
                        lifecycle_semantic_id: terminal.lifecycle_semantic_id.clone(),
                        source: full.reference(&terminal.source, &constants)?,
                        conversion: terminal.conversion.clone(),
                    })
                })
                .collect::<Result<Vec<_>, CanonicalFormErrorV1>>()
        };
        let mut ordered = program
            .proposal_decision_table
            .branches
            .iter()
            .collect::<Vec<_>>();
        ordered.sort_by_key(|branch| branch.priority);
        let branches = ordered
            .into_iter()
            .map(|branch| {
                Ok(CanonicalBranchV1 {
                    predicate: full.reference(&branch.predicate, &constants)?,
                    frame: frame(&branch.frame)?,
                })
            })
            .collect::<Result<Vec<_>, CanonicalFormErrorV1>>()?;

        Ok(Self {
            schema_version: program.schema_version,
            semantic_version: program.semantic_version,
            research_request_identity: program.research_request_identity,
            intent_identity: program.intent_identity,
            intent_digest: program.intent_digest,
            design_identity: program.design_identity,
            design_digest: program.design_digest,
            plugin_semantic_id: program.plugin_semantic_id.clone(),
            plugin_manifest_digest: program.plugin_manifest_digest,
            catalog_semantic_version: program.catalog_semantic_version,
            catalog_digest: program.catalog_digest,
            first_party_sdk_source_digest: program.first_party_sdk_source_digest,
            inputs: program.inputs.clone(),
            carried_input_role_ids: program.carried_input_role_ids.clone(),
            constants: constant_forms,
            state_cells: state_forms,
            nodes: node_forms,
            branches,
            default_frame: frame(&program.proposal_decision_table.default_frame)?,
            warmup: program.warmup.clone(),
        })
    }

    /// One digest of the whole form, for comparing two programs at a glance.
    pub(crate) fn digest(&self) -> StructuralDigestV1 {
        digest_of(self)
    }
}

/// The structural digest of every node and state in one pass.
struct Digests<'a> {
    nodes: BTreeMap<&'a str, StructuralDigestV1>,
    states: BTreeMap<&'a str, StructuralDigestV1>,
}

impl<'a> Digests<'a> {
    /// Takes the shallow digests when `full_states` is absent, and the full ones when it holds
    /// every state's full digest.
    fn take(
        program: &'a BoundedFeatureProgramProposalV1,
        constants: &BTreeMap<&str, StructuralDigestV1>,
        full_states: Option<&BTreeMap<&'a str, StructuralDigestV1>>,
    ) -> Result<Self, CanonicalFormErrorV1> {
        let states = match full_states {
            Some(full) => full.clone(),
            None => program
                .state_cells
                .iter()
                .map(|cell| {
                    Ok((
                        cell.state_id.as_str(),
                        digest_of(&(
                            "state-shallow",
                            &cell.state_kind,
                            initial_digest(&cell.initial, constants)?,
                            cell.max_bytes,
                        )),
                    ))
                })
                .collect::<Result<_, CanonicalFormErrorV1>>()?,
        };
        let mut digests = Self {
            nodes: BTreeMap::new(),
            states,
        };
        let by_id = program
            .nodes
            .iter()
            .map(|node| (node.node_id.as_str(), node))
            .collect::<BTreeMap<_, _>>();

        for node in &program.nodes {
            digests.node(
                node.node_id.as_str(),
                &by_id,
                constants,
                &mut BTreeSet::new(),
            )?;
        }
        Ok(digests)
    }

    fn node(
        &mut self,
        node_id: &'a str,
        by_id: &BTreeMap<&'a str, &'a crate::bounded_feature_program_v1::BoundedFeatureNodeV1>,
        constants: &BTreeMap<&str, StructuralDigestV1>,
        visiting: &mut BTreeSet<&'a str>,
    ) -> Result<StructuralDigestV1, CanonicalFormErrorV1> {
        if let Some(digest) = self.nodes.get(node_id) {
            return Ok(*digest);
        }
        let node = by_id
            .get(node_id)
            .ok_or_else(|| CanonicalFormErrorV1::UnknownNode(node_id.to_owned()))?;

        if !visiting.insert(node_id) {
            return Err(CanonicalFormErrorV1::NodeCycle(node_id.to_owned()));
        }

        for binding in &node.input_bindings {
            if let BoundedFeatureValueRefV1::NodeOutput {
                node_id: source, ..
            } = &binding.source
            {
                self.node(source.as_str(), by_id, constants, visiting)?;
            }
        }
        visiting.remove(node_id);
        let inputs = node
            .input_bindings
            .iter()
            .map(|binding| {
                Ok((
                    binding.port_id.as_str(),
                    self.reference(&binding.source, constants)?,
                    binding.require_ready,
                ))
            })
            .collect::<Result<Vec<_>, CanonicalFormErrorV1>>()?;
        let state = node
            .state_id
            .as_deref()
            .map(|state| self.state(state))
            .transpose()?;
        let digest = digest_of(&(
            "node",
            &node.primitive_semantic_id,
            &node.parameters,
            inputs,
            &node.output_ports,
            state,
            &node.update_clock,
        ));
        self.nodes.insert(node_id, digest);
        Ok(digest)
    }

    fn state(&self, state_id: &str) -> Result<StructuralDigestV1, CanonicalFormErrorV1> {
        self.states
            .get(state_id)
            .copied()
            .ok_or_else(|| CanonicalFormErrorV1::UnknownState(state_id.to_owned()))
    }

    fn reference(
        &self,
        reference: &BoundedFeatureValueRefV1,
        constants: &BTreeMap<&str, StructuralDigestV1>,
    ) -> Result<CanonicalRefV1, CanonicalFormErrorV1> {
        Ok(match reference {
            BoundedFeatureValueRefV1::InputValue { input_role_id } => {
                CanonicalRefV1::InputValue(input_role_id.clone())
            }
            BoundedFeatureValueRefV1::InputCoordinate { input_role_id } => {
                CanonicalRefV1::InputCoordinate(input_role_id.clone())
            }
            BoundedFeatureValueRefV1::Constant { constant_id } => CanonicalRefV1::Constant(
                constants
                    .get(constant_id.as_str())
                    .copied()
                    .ok_or_else(|| CanonicalFormErrorV1::UnknownConstant(constant_id.clone()))?,
            ),
            BoundedFeatureValueRefV1::PriorState { state_id } => {
                CanonicalRefV1::PriorState(self.state(state_id)?)
            }
            BoundedFeatureValueRefV1::NodeOutput { node_id, port_id } => {
                CanonicalRefV1::NodeOutput(
                    self.nodes
                        .get(node_id.as_str())
                        .copied()
                        .ok_or_else(|| CanonicalFormErrorV1::UnknownNode(node_id.clone()))?,
                    port_id.clone(),
                )
            }
        })
    }
}

fn initial_digest(
    initial: &BoundedFeatureInitialStateV1,
    constants: &BTreeMap<&str, StructuralDigestV1>,
) -> Result<Option<StructuralDigestV1>, CanonicalFormErrorV1> {
    match initial {
        BoundedFeatureInitialStateV1::CanonicalEmpty => Ok(None),
        BoundedFeatureInitialStateV1::Constant { constant_id } => constants
            .get(constant_id.as_str())
            .copied()
            .map(Some)
            .ok_or_else(|| CanonicalFormErrorV1::UnknownConstant(constant_id.clone())),
    }
}

/// SHA-256 over the value's JSON, which every canonical component serializes to without loss.
fn digest_of(value: &impl Serialize) -> StructuralDigestV1 {
    let bytes = serde_json::to_vec(value).expect("a canonical component serializes");
    Sha256::digest(bytes).into()
}

/// Programs changed in exactly one respect, for the two sides of the canonical form's proof.
///
/// The first three change only what the form drops and must leave both the form and the program's
/// behaviour alone; the other four change what a program means and must change both.
pub(crate) mod transform {
    use sha2::{Digest as _, Sha256};

    use crate::bounded_feature_program_v1::{
        BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1, BoundedFeatureParametersV1,
        BoundedFeaturePredicateV1, BoundedFeatureProgramProposalV1, BoundedFeatureProposalFrameV1,
        BoundedFeatureValueRefV1, expected_state_bytes,
    };
    use vibe_indicators_kernel::CatalogStateRuleV1;

    /// Every node, constant and state identity renamed to a digest of it, which also scrambles
    /// the order `prepare` sorts them into.
    pub(crate) fn renamed(
        program: &BoundedFeatureProgramProposalV1,
    ) -> BoundedFeatureProgramProposalV1 {
        let rename = |id: &mut String| {
            let digest: [u8; 32] = Sha256::digest(id.as_bytes()).into();
            *id = format!("renamed-{}", hex(&digest[..8]));
        };
        let reference = |source: &mut BoundedFeatureValueRefV1| match source {
            BoundedFeatureValueRefV1::Constant { constant_id } => rename(constant_id),
            BoundedFeatureValueRefV1::PriorState { state_id } => rename(state_id),
            BoundedFeatureValueRefV1::NodeOutput { node_id, .. } => rename(node_id),
            BoundedFeatureValueRefV1::InputValue { .. }
            | BoundedFeatureValueRefV1::InputCoordinate { .. } => {}
        };
        let frame = |frame: &mut BoundedFeatureProposalFrameV1| {
            for terminal in &mut frame.terminal_outputs {
                reference(&mut terminal.source);
            }
        };
        let mut program = program.clone();

        for constant in &mut program.constants {
            rename(&mut constant.constant_id);
        }

        for cell in &mut program.state_cells {
            rename(&mut cell.state_id);
            rename(&mut cell.writer_node_id);

            if let BoundedFeatureInitialStateV1::Constant { constant_id } = &mut cell.initial {
                rename(constant_id);
            }
        }

        for node in &mut program.nodes {
            rename(&mut node.node_id);
            node.state_id.as_mut().map(rename);

            for binding in &mut node.input_bindings {
                reference(&mut binding.source);
            }
        }

        for branch in &mut program.proposal_decision_table.branches {
            reference(&mut branch.predicate);
            frame(&mut branch.frame);
        }
        frame(&mut program.proposal_decision_table.default_frame);
        program
    }

    /// Every decision priority tripled and shifted, which keeps their order.
    pub(crate) fn priorities_scaled(
        program: &BoundedFeatureProgramProposalV1,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();

        for branch in &mut program.proposal_decision_table.branches {
            branch.priority = branch.priority * 3 + 1;
        }
        program
    }

    /// Every graph bound one larger. The state bytes are the Design's plugin manifest's and are
    /// not a graph bound, and the source and Wasm byte bounds are the language version's ceilings.
    pub(crate) fn bounds_enlarged(
        program: &BoundedFeatureProgramProposalV1,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let bounds = &mut program.bounds;
        bounds.max_nodes += 1;
        bounds.max_edges += 1;
        bounds.max_depth += 1;
        bounds.max_ports += 1;
        bounds.max_constants += 1;
        bounds.max_fan_out += 1;
        bounds.max_lag += 1;
        bounds.max_window += 1;
        bounds.max_state_cells += 1;
        bounds.max_decision_branches += 1;
        program
    }

    /// Node `node_id`'s rolling window set to `window`, with the state cell it owns sized for it
    /// by the Owner's own rule.
    pub(crate) fn window_changed(
        program: &BoundedFeatureProgramProposalV1,
        node_id: &str,
        window: u32,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let node = program
            .nodes
            .iter_mut()
            .find(|node| node.node_id == node_id)
            .unwrap_or_else(|| panic!("the program has node {node_id}"));

        match &mut node.parameters {
            BoundedFeatureParametersV1::Window { window: value, .. }
            | BoundedFeatureParametersV1::WindowAndOutputScale { window: value, .. } => {
                assert_ne!(*value, window, "node {node_id}'s window changes");
                *value = window;
            }
            other => panic!("node {node_id} has no rolling window: {other:?}"),
        }
        let parameters = node.parameters.clone();
        let state_id = node
            .state_id
            .clone()
            .unwrap_or_else(|| panic!("node {node_id} owns a state cell"));
        let bytes = expected_state_bytes(CatalogStateRuleV1::Window, &parameters, &program.bounds)
            .expect("the Owner sizes a rolling window's state");
        program
            .state_cells
            .iter_mut()
            .find(|cell| cell.state_id == state_id)
            .unwrap_or_else(|| panic!("the program has state {state_id}"))
            .max_bytes = bytes;
        program
    }

    /// Fixed-point constant `constant_id` set to `coefficient`, at its own unit and scale.
    pub(crate) fn constant_changed(
        program: &BoundedFeatureProgramProposalV1,
        constant_id: &str,
        coefficient: i128,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let constant = program
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == constant_id)
            .unwrap_or_else(|| panic!("the program has constant {constant_id}"));

        match &mut constant.value {
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient: value, ..
            } => {
                assert_ne!(*value, coefficient, "{constant_id} changes");
                *value = coefficient;
            }
            other => panic!("constant {constant_id} is not fixed-point: {other:?}"),
        }
        program
    }

    /// The first and last decision branches' priorities exchanged.
    pub(crate) fn priority_order_swapped(
        program: &BoundedFeatureProgramProposalV1,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let branches = &mut program.proposal_decision_table.branches;
        assert!(branches.len() > 1, "a priority order needs two branches");
        let last = branches.len() - 1;
        let (first, rest) = branches.split_at_mut(1);
        std::mem::swap(&mut first[0].priority, &mut rest[last - 1].priority);
        program
    }

    /// Each decision branch's predicate replaced by the named node output, by priority.
    pub(crate) fn predicates_rewired(
        program: &BoundedFeatureProgramProposalV1,
        predicates: &[(u16, &str)],
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();

        for (priority, node_id) in predicates {
            program
                .proposal_decision_table
                .branches
                .iter_mut()
                .find(|branch| branch.priority == *priority)
                .unwrap_or_else(|| panic!("the program has a branch at priority {priority}"))
                .predicate = BoundedFeatureValueRefV1::NodeOutput {
                node_id: (*node_id).to_owned(),
                port_id: "value".to_owned(),
            };
        }
        program
    }

    /// Comparison node `node_id`'s predicate set to `predicate`, which changes nothing but its
    /// parameters.
    pub(crate) fn predicate_changed(
        program: &BoundedFeatureProgramProposalV1,
        node_id: &str,
        predicate: BoundedFeaturePredicateV1,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let node = program
            .nodes
            .iter_mut()
            .find(|node| node.node_id == node_id)
            .unwrap_or_else(|| panic!("the program has node {node_id}"));

        match &mut node.parameters {
            BoundedFeatureParametersV1::ComparisonPredicate { predicate: value } => {
                assert_ne!(*value, predicate, "node {node_id}'s predicate changes");
                *value = predicate;
            }
            other => panic!("node {node_id} is no comparison: {other:?}"),
        }
        program
    }

    /// Node `node_id`'s read of prior state on `port_id` pointed at `state_id` instead.
    pub(crate) fn prior_state_repointed(
        program: &BoundedFeatureProgramProposalV1,
        node_id: &str,
        port_id: &str,
        state_id: &str,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let binding = program
            .nodes
            .iter_mut()
            .find(|node| node.node_id == node_id)
            .and_then(|node| {
                node.input_bindings
                    .iter_mut()
                    .find(|binding| binding.port_id == port_id)
            })
            .unwrap_or_else(|| panic!("the program binds {node_id}.{port_id}"));

        match &mut binding.source {
            BoundedFeatureValueRefV1::PriorState { state_id: read } => {
                assert_ne!(read, state_id, "{node_id}.{port_id} reads another state");
                *read = state_id.to_owned();
            }
            other => panic!("{node_id}.{port_id} reads no prior state: {other:?}"),
        }
        program
    }

    /// Node `node_id`'s two operands exchanged between its ports, each with the readiness it
    /// requires.
    pub(crate) fn operands_swapped(
        program: &BoundedFeatureProgramProposalV1,
        node_id: &str,
    ) -> BoundedFeatureProgramProposalV1 {
        let mut program = program.clone();
        let node = program
            .nodes
            .iter_mut()
            .find(|node| node.node_id == node_id)
            .unwrap_or_else(|| panic!("the program has node {node_id}"));
        let [a, b] = &mut node.input_bindings[..] else {
            panic!("node {node_id} has two operands");
        };
        assert_ne!(a.source, b.source, "node {node_id}'s operands differ");
        std::mem::swap(&mut a.source, &mut b.source);
        std::mem::swap(&mut a.require_ready, &mut b.require_ready);
        program
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{CanonicalBoundedFeatureProgramFormV1, transform};
    use crate::bounded_feature_program_corpus_for_test::corpus_program;
    use crate::bounded_feature_program_v1::BoundedFeaturePredicateV1;

    fn form(
        program: &crate::bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    ) -> CanonicalBoundedFeatureProgramFormV1 {
        CanonicalBoundedFeatureProgramFormV1::of(program)
            .expect("a corpus program has a canonical form")
    }

    /// Renaming identities, scaling priorities and enlarging bounds leave every corpus program's
    /// canonical form as it was, though each changes the program's own bytes.
    #[rstest]
    fn what_the_form_drops_leaves_every_corpus_program_equal(
        #[values(
            "a0", "a0v3", "ctl8", "d1", "g2", "g3", "s1", "t3", "t4", "t5", "t6", "t7", "t8", "t9",
            "w1", "w2"
        )]
        name: &str,
    ) {
        let (_, program) = corpus_program(name);
        let canonical = form(&program);

        for (change, changed) in [
            ("renamed", transform::renamed(&program)),
            ("priorities scaled", transform::priorities_scaled(&program)),
            ("bounds enlarged", transform::bounds_enlarged(&program)),
        ] {
            assert_ne!(changed, program, "{name}: {change} changes the program");
            assert_eq!(
                form(&changed),
                canonical,
                "{name}: {change} keeps the canonical form"
            );
        }
    }

    /// A changed window, a changed comparison, a changed constant, a swapped priority order and
    /// swapped `sub` operands each change the canonical form. The comparison changes nothing but a
    /// node's parameters, where the window also resizes the state it owns.
    #[rstest]
    fn what_the_form_keeps_changes_it() {
        let (_, program) = corpus_program("t3");
        let canonical = form(&program);

        for (change, changed) in [
            ("window", transform::window_changed(&program, "m", 3)),
            (
                "comparison",
                transform::predicate_changed(
                    &program,
                    "c_low",
                    BoundedFeaturePredicateV1::LessOrEqual,
                ),
            ),
            (
                "constant",
                transform::constant_changed(&program, "k_enter", -100),
            ),
            (
                "priority order",
                transform::priority_order_swapped(&program),
            ),
            ("sub operands", transform::operands_swapped(&program, "dev")),
        ] {
            assert_ne!(
                form(&changed).digest(),
                canonical.digest(),
                "t3: the {change} changes the form"
            );
        }
    }

    /// A program that names an identity it does not declare, or whose node outputs feed each other,
    /// has no canonical form, and says which.
    #[rstest]
    fn a_program_without_a_structure_is_refused_by_name() {
        use crate::bounded_feature_program_v1::BoundedFeatureValueRefV1;

        use super::CanonicalFormErrorV1;

        let (_, program) = corpus_program("t3");
        let bound = |node: &str, port: &str, source: BoundedFeatureValueRefV1| {
            let mut program = program.clone();
            program
                .nodes
                .iter_mut()
                .find(|candidate| candidate.node_id == node)
                .and_then(|candidate| {
                    candidate
                        .input_bindings
                        .iter_mut()
                        .find(|binding| binding.port_id == port)
                })
                .expect("t3 binds the port")
                .source = source;
            CanonicalBoundedFeatureProgramFormV1::of(&program).map(|_| ())
        };

        assert_eq!(
            bound(
                "dev",
                "b",
                BoundedFeatureValueRefV1::NodeOutput {
                    node_id: "missing".to_owned(),
                    port_id: "value".to_owned(),
                }
            ),
            Err(CanonicalFormErrorV1::UnknownNode("missing".to_owned()))
        );
        assert_eq!(
            bound(
                "c_low",
                "b",
                BoundedFeatureValueRefV1::Constant {
                    constant_id: "missing".to_owned(),
                }
            ),
            Err(CanonicalFormErrorV1::UnknownConstant("missing".to_owned()))
        );
        assert_eq!(
            bound(
                "n_pos",
                "condition",
                BoundedFeatureValueRefV1::PriorState {
                    state_id: "missing".to_owned(),
                }
            ),
            Err(CanonicalFormErrorV1::UnknownState("missing".to_owned()))
        );
        // `m` feeds `dev`, so binding `m` to `dev` closes a loop, met again at `m`, the first node.
        assert_eq!(
            bound(
                "m",
                "value",
                BoundedFeatureValueRefV1::NodeOutput {
                    node_id: "dev".to_owned(),
                    port_id: "value".to_owned(),
                }
            ),
            Err(CanonicalFormErrorV1::NodeCycle("m".to_owned()))
        );
    }

    /// Two state cells of one kind, seed and size are told apart by the node that writes each, so
    /// a node reading the other one is another program. In `g2` the upper and lower levels of the
    /// first gap are such a pair.
    #[rstest]
    fn a_prior_state_is_told_apart_by_its_writer() {
        let (_, program) = corpus_program("g2");
        let repointed = transform::prior_state_repointed(&program, "lo_1_1", "when_true", "up1");
        assert_ne!(form(&repointed), form(&program));
    }
}
