//! Canonical, typed Bounded Feature Program V1 structure.
//!
//! This module validates caller-proposed Research meaning. Its private-field result is structural
//! evidence only: it is not an R&D Owner seal, a build receipt, an Artifact, or execution authority.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::{
    CatalogAvailabilityRuleV1, CatalogClockRuleV1, CatalogInputRuleV1, CatalogOutputRuleV1,
    CatalogParameterRuleV1, CatalogRowKindV1, CatalogScaleRuleV1, CatalogStateRuleV1,
    CatalogUnitRuleV1, PrimitiveCatalogV1, PrimitiveOperationV1, RoundingMode,
};

use crate::strategy_design_v2::{PluginManifestV2, StrategyDesignV2, ValueTypeV2};
use crate::strategy_plan_v2::{
    StrategyDesignPreparationV2, plugin_manifest_digest, prepare_strategy_design_v2,
    strategy_input_role_identity_v2,
};

pub const BOUNDED_FEATURE_PROGRAM_SCHEMA_V1: u16 = 1;
pub const BOUNDED_FEATURE_PROGRAM_SEMANTIC_VERSION_V1: u16 = 1;
pub const BOUNDED_FEATURE_CATALOG_SEMANTIC_VERSION_V1: u16 = 1;
pub const BOUNDED_FEATURE_PLUGIN_ABI_V1: u16 = 3;
pub const BOUNDED_FEATURE_NUMERIC_FAILURE_V1: &str = "bfp.numeric.failure.no-state-change.v1";
pub const OWNER_SAMPLE_COORDINATE_SOURCE_V1: &str = "strategy.value-ref.owner-sample-coordinate.v1";
const DOMAIN: &[u8] = b"strategy.bounded-feature-program.v1\0";
const MAGIC: &[u8; 8] = b"BFP1\x01\0\0\0";
const MAX_ID_BYTES: usize = 255;
const MAX_TEXT_BYTES: usize = 1024;

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureClockV1 {
    Trigger {
        input_role_id: String,
    },
    Sample {
        input_role_id: String,
        source_semantic_id: String,
    },
}

impl BoundedFeatureClockV1 {
    fn role(&self) -> &str {
        match self {
            Self::Trigger { input_role_id } | Self::Sample { input_role_id, .. } => input_role_id,
        }
    }

    fn tag(&self) -> u8 {
        match self {
            Self::Trigger { .. } => 1,
            Self::Sample { .. } => 2,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureValueTypeV1 {
    FixedI128 { unit: String, scale: u8 },
    Boolean,
    OwnerSampleCoordinate { input_role_identity: BindingDigest },
    I32,
    I64,
    U64,
    PositionIntentV1,
    TargetVariantV1,
    ProtectionVariantV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BoundedFeatureAvailabilityV1 {
    Ready,
    WarmingReady,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureInputV1 {
    pub owner_semantic_id: String,
    pub fact_type_semantic_id: String,
    pub input_role_id: String,
    pub input_role_identity: BindingDigest,
    pub timeframe: String,
    pub unit: String,
    pub scale: u8,
    pub static_binding_receipt_digest: BindingDigest,
    pub value_port_semantic_id: String,
    pub update_clock: BoundedFeatureClockV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureConstantValueV1 {
    FixedI128 {
        coefficient: i128,
        unit: String,
        scale: u8,
    },
    Boolean {
        value: bool,
    },
    I32 {
        value: i32,
    },
    I64 {
        value: i64,
    },
    U64 {
        value: u64,
    },
    PositionIntentV1 {
        semantic_id: String,
    },
    TargetVariantV1 {
        semantic_id: String,
    },
    ProtectionVariantV1 {
        semantic_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureConstantV1 {
    pub constant_id: String,
    pub value: BoundedFeatureConstantValueV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureValueRefV1 {
    InputValue { input_role_id: String },
    InputCoordinate { input_role_id: String },
    Constant { constant_id: String },
    PriorState { state_id: String },
    NodeOutput { node_id: String, port_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureInputBindingV1 {
    pub port_id: String,
    pub source: BoundedFeatureValueRefV1,
    pub require_ready: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureOutputPortV1 {
    pub port_id: String,
    pub value_type: BoundedFeatureValueTypeV1,
    pub availability: BoundedFeatureAvailabilityV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BoundedFeatureRoundingV1 {
    TowardZero,
    NearestTiesToEven,
}

impl BoundedFeatureRoundingV1 {
    fn kernel(self) -> RoundingMode {
        match self {
            Self::TowardZero => RoundingMode::TowardZero,
            Self::NearestTiesToEven => RoundingMode::NearestTiesToEven,
        }
    }

    fn tag(self) -> u8 {
        match self {
            Self::TowardZero => 1,
            Self::NearestTiesToEven => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BoundedFeaturePredicateV1 {
    Less,
    LessOrEqual,
    Equal,
    NotEqual,
    GreaterOrEqual,
    Greater,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureParametersV1 {
    None,
    OutputScale {
        output_scale: u8,
        rounding: BoundedFeatureRoundingV1,
    },
    ComparisonPredicate {
        predicate: BoundedFeaturePredicateV1,
    },
    Period {
        period: u32,
        rounding: Option<BoundedFeatureRoundingV1>,
    },
    Window {
        window: u32,
        rounding: Option<BoundedFeatureRoundingV1>,
    },
    Lag {
        offset: u32,
        declared_max_lag: u32,
    },
    RangeFraction {
        numerator: u32,
        denominator: u32,
        output_scale: u8,
        rounding: BoundedFeatureRoundingV1,
    },
    PeriodAndOutputScale {
        period: u32,
        output_scale: u8,
        rounding: BoundedFeatureRoundingV1,
    },
    WindowAndOutputScale {
        window: u32,
        output_scale: u8,
        rounding: Option<BoundedFeatureRoundingV1>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BoundedFeatureInitialStateV1 {
    CanonicalEmpty,
    Constant { constant_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureStateKindV1 {
    Primitive,
    Strategy {
        value_type: BoundedFeatureValueTypeV1,
        source_port_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureStateCellV1 {
    pub state_id: String,
    pub writer_node_id: String,
    pub state_kind: BoundedFeatureStateKindV1,
    pub initial: BoundedFeatureInitialStateV1,
    pub max_bytes: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureNodeV1 {
    pub node_id: String,
    pub primitive_semantic_id: String,
    pub input_bindings: Vec<BoundedFeatureInputBindingV1>,
    pub output_ports: Vec<BoundedFeatureOutputPortV1>,
    pub parameters: BoundedFeatureParametersV1,
    pub state_id: Option<String>,
    pub update_clock: Option<BoundedFeatureClockV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureTerminalOutputV1 {
    pub manifest_port_id: String,
    pub lifecycle_semantic_id: String,
    pub source: BoundedFeatureValueRefV1,
    pub conversion: BoundedFeatureTerminalConversionV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureProposalFrameV1 {
    pub terminal_outputs: Vec<BoundedFeatureTerminalOutputV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureProposalDecisionBranchV1 {
    pub priority: u16,
    pub predicate: BoundedFeatureValueRefV1,
    pub frame: BoundedFeatureProposalFrameV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureProposalDecisionTableV1 {
    pub branches: Vec<BoundedFeatureProposalDecisionBranchV1>,
    pub default_frame: BoundedFeatureProposalFrameV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BoundedFeatureWarmupPostStateV1 {
    AdvancedCurrentEvent,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureWarmupContractV1 {
    pub position_intent_semantic_id: String,
    pub target_variant_semantic_id: String,
    pub target_position_units: i64,
    pub target_weight_micros: i32,
    pub rebalance_sequence: u64,
    pub reconciliation_target_units: i64,
    pub protection_variant_semantic_id: String,
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub trailing_distance_ticks: u64,
    pub trailing_stop_ticks: i64,
    pub post_state: BoundedFeatureWarmupPostStateV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BoundedFeatureTerminalConversionV1 {
    Exact,
    FixedCoefficientToI32 { unit: String, scale: u8 },
    FixedCoefficientToI64 { unit: String, scale: u8 },
    FixedCoefficientToU64 { unit: String, scale: u8 },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureBoundsV1 {
    pub max_nodes: u16,
    pub max_edges: u16,
    pub max_depth: u16,
    pub max_ports: u16,
    pub max_constants: u16,
    pub max_fan_out: u16,
    pub max_lag: u32,
    pub max_window: u32,
    pub max_state_cells: u16,
    pub max_decision_branches: u16,
    pub max_state_bytes: u32,
    pub max_source_bytes: u32,
    pub max_wasm_bytes: u32,
    pub max_fuel: u64,
    pub max_linear_memory_bytes: u32,
    pub max_invocations_per_event: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedFeatureProgramProposalV1 {
    pub schema_version: u16,
    pub semantic_version: u16,
    pub research_request_identity: BindingDigest,
    pub intent_identity: BindingDigest,
    pub intent_digest: BindingDigest,
    pub design_identity: BindingDigest,
    pub design_digest: BindingDigest,
    pub plugin_semantic_id: String,
    pub plugin_manifest_digest: BindingDigest,
    pub catalog_semantic_version: u16,
    pub catalog_digest: BindingDigest,
    pub first_party_sdk_source_digest: BindingDigest,
    pub inputs: Vec<BoundedFeatureInputV1>,
    pub constants: Vec<BoundedFeatureConstantV1>,
    pub state_cells: Vec<BoundedFeatureStateCellV1>,
    pub nodes: Vec<BoundedFeatureNodeV1>,
    pub proposal_decision_table: BoundedFeatureProposalDecisionTableV1,
    pub warmup: BoundedFeatureWarmupContractV1,
    pub bounds: BoundedFeatureBoundsV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalBoundedFeatureProgramV1 {
    program: BoundedFeatureProgramProposalV1,
    state_layout: CanonicalBoundedFeatureStateLayoutV1,
    canonical_bytes: Vec<u8>,
    digest: BindingDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CanonicalBoundedFeatureStateLayoutV1 {
    slots: Vec<CanonicalBoundedFeatureStateSlotV1>,
    total_bytes: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CanonicalBoundedFeatureStateSlotV1 {
    state_id: String,
    offset: u32,
    width: u32,
    initial_bytes: Option<Vec<u8>>,
}

impl CanonicalBoundedFeatureStateLayoutV1 {
    pub(crate) fn slots(&self) -> &[CanonicalBoundedFeatureStateSlotV1] {
        &self.slots
    }

    pub(crate) const fn total_bytes(&self) -> u32 {
        self.total_bytes
    }
}

impl CanonicalBoundedFeatureStateSlotV1 {
    pub(crate) fn state_id(&self) -> &str {
        &self.state_id
    }

    pub(crate) const fn offset(&self) -> u32 {
        self.offset
    }

    pub(crate) const fn width(&self) -> u32 {
        self.width
    }

    /// `None` means the primitive's existing canonical empty state for its declared parameters.
    pub(crate) fn initial_bytes(&self) -> Option<&[u8]> {
        self.initial_bytes.as_deref()
    }
}

impl CanonicalBoundedFeatureProgramV1 {
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
    pub fn program(&self) -> &BoundedFeatureProgramProposalV1 {
        &self.program
    }

    pub(crate) fn state_layout(&self) -> &CanonicalBoundedFeatureStateLayoutV1 {
        &self.state_layout
    }

    pub fn encode_into(&self, destination: &mut [u8]) -> Result<(), BoundedFeatureProgramErrorV1> {
        if destination.len() != self.canonical_bytes.len() {
            return Err(BoundedFeatureProgramErrorV1::InvalidDestinationLength);
        }
        destination.copy_from_slice(&self.canonical_bytes);
        Ok(())
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum BoundedFeatureProgramErrorV1 {
    #[error("unsupported Bounded Feature Program schema or identity")]
    Identity,
    #[error("invalid or inconsistent finite resource bounds")]
    Bounds,
    #[error("invalid Design or PluginManifest binding")]
    Design,
    #[error("invalid input or manifest port binding")]
    Input,
    #[error("invalid constant")]
    Constant,
    #[error("unknown or invalid primitive contract")]
    Primitive,
    #[error("invalid typed edge")]
    Type,
    #[error("invalid state or clock ownership")]
    State,
    #[error("invalid graph topology or reachability")]
    Graph,
    #[error("invalid terminal lifecycle output")]
    Terminal,
    #[error("malformed or noncanonical bytes")]
    NonCanonical,
    #[error("invalid destination length")]
    InvalidDestinationLength,
}

pub fn prepare_bounded_feature_program_v1(
    mut proposal: BoundedFeatureProgramProposalV1,
    design: &StrategyDesignV2,
    catalog: PrimitiveCatalogV1,
) -> Result<CanonicalBoundedFeatureProgramV1, BoundedFeatureProgramErrorV1> {
    validate_identity(&proposal, design, catalog)?;
    canonicalize_collections(&mut proposal)?;
    validate_bounds(&proposal)?;
    let manifest = bound_manifest(&proposal, design)?;
    let values = validate_inputs_and_constants(&proposal, design, manifest, catalog)?;
    let graph = validate_graph(&proposal, catalog, values)?;
    validate_terminals(
        &proposal,
        manifest,
        catalog,
        &graph.values,
        &graph.atomic_coordinate_pairs,
    )?;
    let state_layout = canonical_state_layout(&proposal, &graph.values)?;
    let canonical_bytes = encode_program(&proposal)?;
    let digest = BindingDigest::from_untrusted_bytes(domain_digest(&canonical_bytes));
    let value = CanonicalBoundedFeatureProgramV1 {
        program: proposal,
        state_layout,
        canonical_bytes,
        digest,
    };
    validate_canonical_state_layout(value.state_layout())?;
    Ok(value)
}

pub fn parse_bounded_feature_program_v1(
    canonical_bytes: &[u8],
    design: &StrategyDesignV2,
    catalog: PrimitiveCatalogV1,
) -> Result<CanonicalBoundedFeatureProgramV1, BoundedFeatureProgramErrorV1> {
    let proposal = Decoder::new(canonical_bytes).program()?;
    let value = prepare_bounded_feature_program_v1(proposal, design, catalog)?;
    if value.canonical_bytes != canonical_bytes {
        return Err(BoundedFeatureProgramErrorV1::NonCanonical);
    }
    Ok(value)
}

fn validate_identity(
    proposal: &BoundedFeatureProgramProposalV1,
    design: &StrategyDesignV2,
    catalog: PrimitiveCatalogV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    if proposal.schema_version != BOUNDED_FEATURE_PROGRAM_SCHEMA_V1
        || proposal.semantic_version != BOUNDED_FEATURE_PROGRAM_SEMANTIC_VERSION_V1
        || proposal.catalog_semantic_version != BOUNDED_FEATURE_CATALOG_SEMANTIC_VERSION_V1
        || proposal.catalog_digest.as_bytes() != &catalog.identity()
        || proposal.first_party_sdk_source_digest.as_bytes() == &[0; 32]
        || proposal.research_request_identity != design.research_request_identity
        || proposal.intent_identity != design.intent_identity
        || proposal.intent_digest != design.intent_digest
    {
        return Err(BoundedFeatureProgramErrorV1::Identity);
    }
    match prepare_strategy_design_v2(design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity,
            design_digest,
        } if design_identity == proposal.design_identity
            && design_digest == proposal.design_digest => {}
        _ => return Err(BoundedFeatureProgramErrorV1::Design),
    }
    Ok(())
}

fn bound_manifest<'a>(
    proposal: &BoundedFeatureProgramProposalV1,
    design: &'a StrategyDesignV2,
) -> Result<&'a PluginManifestV2, BoundedFeatureProgramErrorV1> {
    valid_id(&proposal.plugin_semantic_id)?;
    let mut matches = design
        .plugins
        .iter()
        .filter(|p| p.semantic_id == proposal.plugin_semantic_id);
    let manifest = matches.next().ok_or(BoundedFeatureProgramErrorV1::Design)?;
    if matches.next().is_some()
        || manifest.abi_version != BOUNDED_FEATURE_PLUGIN_ABI_V1
        || manifest.failure_semantic_id != BOUNDED_FEATURE_NUMERIC_FAILURE_V1
        || plugin_manifest_digest(manifest) != proposal.plugin_manifest_digest
        || proposal.bounds.max_fuel != manifest.max_fuel
        || proposal.bounds.max_linear_memory_bytes != manifest.max_linear_memory_bytes
        || proposal.bounds.max_invocations_per_event != manifest.max_invocations_per_event
        || manifest.state.value_type != ValueTypeV2::Bytes
        || manifest.state.max_bytes != proposal.bounds.max_state_bytes
    {
        return Err(BoundedFeatureProgramErrorV1::Design);
    }
    Ok(manifest)
}

fn canonicalize_collections(
    proposal: &mut BoundedFeatureProgramProposalV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    proposal
        .inputs
        .sort_by_key(|v| (*v.input_role_identity.as_bytes(), v.input_role_id.clone()));
    proposal
        .constants
        .sort_by(|a, b| a.constant_id.as_bytes().cmp(b.constant_id.as_bytes()));
    proposal
        .state_cells
        .sort_by(|a, b| a.state_id.as_bytes().cmp(b.state_id.as_bytes()));
    let sort_frame = |frame: &mut BoundedFeatureProposalFrameV1| {
        frame.terminal_outputs.sort_by(|a, b| {
            a.manifest_port_id
                .as_bytes()
                .cmp(b.manifest_port_id.as_bytes())
        });
    };
    for branch in &mut proposal.proposal_decision_table.branches {
        sort_frame(&mut branch.frame);
    }
    proposal
        .proposal_decision_table
        .branches
        .sort_by_key(|branch| branch.priority);
    sort_frame(&mut proposal.proposal_decision_table.default_frame);
    for node in &mut proposal.nodes {
        node.input_bindings
            .sort_by(|a, b| a.port_id.as_bytes().cmp(b.port_id.as_bytes()));
        node.output_ports
            .sort_by(|a, b| a.port_id.as_bytes().cmp(b.port_id.as_bytes()));
    }
    proposal.nodes = canonical_topological_nodes(&proposal.nodes)?;
    Ok(())
}

fn canonical_topological_nodes(
    nodes: &[BoundedFeatureNodeV1],
) -> Result<Vec<BoundedFeatureNodeV1>, BoundedFeatureProgramErrorV1> {
    let mut by_id = BTreeMap::new();
    for node in nodes {
        valid_id(&node.node_id)?;
        if by_id.insert(node.node_id.as_str(), node).is_some() {
            return Err(BoundedFeatureProgramErrorV1::Graph);
        }
    }
    let mut dependencies: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut consumers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for node in nodes {
        let deps = dependencies.entry(&node.node_id).or_default();
        for input in &node.input_bindings {
            if let BoundedFeatureValueRefV1::NodeOutput { node_id, .. } = &input.source {
                if node_id == &node.node_id || !by_id.contains_key(node_id.as_str()) {
                    return Err(BoundedFeatureProgramErrorV1::Graph);
                }
                deps.insert(node_id);
                consumers.entry(node_id).or_default().push(&node.node_id);
            }
        }
    }
    let mut ready: BTreeSet<&str> = dependencies
        .iter()
        .filter_map(|(id, deps)| deps.is_empty().then_some(*id))
        .collect();
    let mut ordered = Vec::with_capacity(nodes.len());
    while let Some(id) = ready.pop_first() {
        ordered.push((*by_id[id]).clone());
        for dependent in consumers.get(id).into_iter().flatten() {
            let deps = dependencies
                .get_mut(dependent)
                .ok_or(BoundedFeatureProgramErrorV1::Graph)?;
            deps.remove(id);
            if deps.is_empty() {
                ready.insert(dependent);
            }
        }
    }
    if ordered.len() != nodes.len() {
        return Err(BoundedFeatureProgramErrorV1::Graph);
    }
    Ok(ordered)
}

fn validate_bounds(
    proposal: &BoundedFeatureProgramProposalV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let b = &proposal.bounds;
    if b.max_nodes == 0
        || b.max_edges == 0
        || b.max_depth == 0
        || b.max_ports == 0
        || b.max_constants == 0
        || b.max_fan_out == 0
        || b.max_lag == 0
        || b.max_window == 0
        || b.max_state_cells == 0
        || b.max_decision_branches == 0
        || b.max_state_bytes == 0
        || b.max_source_bytes == 0
        || b.max_wasm_bytes == 0
        || b.max_fuel == 0
        || b.max_linear_memory_bytes == 0
        || b.max_invocations_per_event == 0
        || proposal.nodes.len() > usize::from(b.max_nodes)
        || proposal.constants.len() > usize::from(b.max_constants)
        || proposal.state_cells.len() > usize::from(b.max_state_cells)
        || proposal.proposal_decision_table.branches.len() > usize::from(b.max_decision_branches)
        || proposal.nodes.len() > 64
        || proposal.inputs.len() > 64
        || proposal.constants.len() > 64
        || b.max_decision_branches > 64
        || b.max_edges > 512
        || b.max_ports > 512
        || b.max_depth > 64
        || b.max_fan_out > 64
        || b.max_lag > 65_535
        || b.max_window > 65_536
        || b.max_state_bytes > 1_048_576
        || b.max_source_bytes > 4 * 1024 * 1024
        || b.max_wasm_bytes > 16 * 1024 * 1024
        || b.max_fuel > 10_000_000
        || b.max_linear_memory_bytes > 16 * 1024 * 1024
        || b.max_invocations_per_event > 32
    {
        return Err(BoundedFeatureProgramErrorV1::Bounds);
    }
    Ok(())
}

#[derive(Clone)]
struct ValueInfo {
    value_type: BoundedFeatureValueTypeV1,
    availability: BoundedFeatureAvailabilityV1,
}

#[derive(Default)]
struct AtomicCoordinatePairs {
    coordinate_by_value: BTreeMap<String, String>,
    coordinate_outputs: BTreeSet<String>,
}

impl AtomicCoordinatePairs {
    fn record(&mut self, node_id: &str) -> Result<(), BoundedFeatureProgramErrorV1> {
        let coordinate = format!("n:{node_id}:coordinate");
        let value = format!("n:{node_id}:value");
        if self
            .coordinate_by_value
            .insert(value, coordinate.clone())
            .is_some()
            || !self.coordinate_outputs.insert(coordinate)
        {
            return Err(BoundedFeatureProgramErrorV1::Graph);
        }
        Ok(())
    }

    fn is_coordinate(&self, key: &str) -> bool {
        self.coordinate_outputs.contains(key)
    }

    fn coordinate_for_value(&self, key: &str) -> Option<&str> {
        self.coordinate_by_value.get(key).map(String::as_str)
    }
}

struct ValidatedGraph {
    values: BTreeMap<String, ValueInfo>,
    atomic_coordinate_pairs: AtomicCoordinatePairs,
}

fn consume_graph_value(
    consumed: &mut BTreeMap<String, u16>,
    key: &str,
    pairs: &AtomicCoordinatePairs,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    for consumed_key in std::iter::once(key).chain(pairs.coordinate_for_value(key)) {
        let count = consumed.entry(consumed_key.to_owned()).or_default();
        *count = count
            .checked_add(1)
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
    }
    Ok(())
}

fn validate_inputs_and_constants(
    proposal: &BoundedFeatureProgramProposalV1,
    design: &StrategyDesignV2,
    manifest: &PluginManifestV2,
    catalog: PrimitiveCatalogV1,
) -> Result<BTreeMap<String, ValueInfo>, BoundedFeatureProgramErrorV1> {
    let manifest_ports: BTreeMap<_, _> = manifest
        .input_ports
        .iter()
        .map(|p| (p.semantic_id.as_str(), p))
        .collect();
    let mut values = BTreeMap::new();
    let mut used_manifest_ports = BTreeSet::new();
    let mut role_ids = BTreeSet::new();
    for input in &proposal.inputs {
        for text in [
            &input.owner_semantic_id,
            &input.fact_type_semantic_id,
            &input.input_role_id,
            &input.timeframe,
            &input.unit,
            &input.value_port_semantic_id,
        ] {
            valid_text(text)?;
        }
        if input.scale > 38
            || input.update_clock.role() != input.input_role_id
            || !role_ids.insert(input.input_role_id.as_str())
        {
            return Err(BoundedFeatureProgramErrorV1::Input);
        }
        match &input.update_clock {
            BoundedFeatureClockV1::Trigger { .. } => {}
            BoundedFeatureClockV1::Sample {
                source_semantic_id, ..
            } => {
                let expected = format!(
                    "{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({})",
                    input.input_role_id
                );
                if source_semantic_id != &expected {
                    return Err(BoundedFeatureProgramErrorV1::Input);
                }
            }
        }
        let role = design
            .inputs
            .iter()
            .find(|v| v.semantic_id == input.input_role_id)
            .ok_or(BoundedFeatureProgramErrorV1::Input)?;
        if strategy_input_role_identity_v2(role) != input.input_role_identity
            || role.timeframe != input.timeframe
            || role.unit != input.unit
            || role.scale != input.scale
            || role.field_semantic_id != input.fact_type_semantic_id
            || role.value_type != ValueTypeV2::I128
            || input.static_binding_receipt_digest.as_bytes() == &[0; 32]
        {
            return Err(BoundedFeatureProgramErrorV1::Input);
        }
        let port = manifest_ports
            .get(input.value_port_semantic_id.as_str())
            .ok_or(BoundedFeatureProgramErrorV1::Input)?;
        if port.value_type != ValueTypeV2::I128
            || port.max_bytes != 16
            || !used_manifest_ports.insert(port.semantic_id.as_str())
        {
            return Err(BoundedFeatureProgramErrorV1::Input);
        }
        values.insert(
            format!("i:{}", input.input_role_id),
            ValueInfo {
                value_type: BoundedFeatureValueTypeV1::FixedI128 {
                    unit: input.unit.clone(),
                    scale: input.scale,
                },
                availability: BoundedFeatureAvailabilityV1::Ready,
            },
        );
        let expected = coordinate_port_id(input.input_role_identity);
        let port = manifest_ports
            .get(expected.as_str())
            .ok_or(BoundedFeatureProgramErrorV1::Input)?;
        if port.value_type != ValueTypeV2::Bytes
            || port.max_bytes != 308
            || !used_manifest_ports.insert(port.semantic_id.as_str())
        {
            return Err(BoundedFeatureProgramErrorV1::Input);
        }
        values.insert(
            format!("q:{}", input.input_role_id),
            ValueInfo {
                value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                    input_role_identity: input.input_role_identity,
                },
                availability: BoundedFeatureAvailabilityV1::Ready,
            },
        );
    }
    if used_manifest_ports.len() != manifest.input_ports.len() {
        return Err(BoundedFeatureProgramErrorV1::Input);
    }
    let mut constants = BTreeSet::new();
    for constant in &proposal.constants {
        valid_id(&constant.constant_id)?;
        if !constants.insert(constant.constant_id.as_str()) {
            return Err(BoundedFeatureProgramErrorV1::Constant);
        }
        let value_type = match &constant.value {
            BoundedFeatureConstantValueV1::FixedI128 { unit, scale, .. } => {
                valid_text(unit)?;
                if *scale > 38 {
                    return Err(BoundedFeatureProgramErrorV1::Constant);
                }
                BoundedFeatureValueTypeV1::FixedI128 {
                    unit: unit.clone(),
                    scale: *scale,
                }
            }
            BoundedFeatureConstantValueV1::Boolean { .. } => BoundedFeatureValueTypeV1::Boolean,
            BoundedFeatureConstantValueV1::I32 { .. } => BoundedFeatureValueTypeV1::I32,
            BoundedFeatureConstantValueV1::I64 { .. } => BoundedFeatureValueTypeV1::I64,
            BoundedFeatureConstantValueV1::U64 { .. } => BoundedFeatureValueTypeV1::U64,
            BoundedFeatureConstantValueV1::PositionIntentV1 { semantic_id } => {
                validate_lifecycle_constant(semantic_id, ValueTypeV2::PositionIntentV1, catalog)?;
                BoundedFeatureValueTypeV1::PositionIntentV1
            }
            BoundedFeatureConstantValueV1::TargetVariantV1 { semantic_id } => {
                validate_lifecycle_constant(semantic_id, ValueTypeV2::TargetVariantV1, catalog)?;
                BoundedFeatureValueTypeV1::TargetVariantV1
            }
            BoundedFeatureConstantValueV1::ProtectionVariantV1 { semantic_id } => {
                validate_lifecycle_constant(
                    semantic_id,
                    ValueTypeV2::ProtectionVariantV1,
                    catalog,
                )?;
                BoundedFeatureValueTypeV1::ProtectionVariantV1
            }
        };
        values.insert(
            format!("c:{}", constant.constant_id),
            ValueInfo {
                value_type,
                availability: BoundedFeatureAvailabilityV1::Ready,
            },
        );
    }
    Ok(values)
}

fn validate_lifecycle_constant(
    semantic_id: &str,
    value_type: ValueTypeV2,
    catalog: PrimitiveCatalogV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    valid_id(semantic_id)?;
    let row = catalog
        .row(semantic_id)
        .ok_or(BoundedFeatureProgramErrorV1::Constant)?;
    if row.kind != CatalogRowKindV1::LifecycleReference
        || lifecycle_value_type(semantic_id) != Some(value_type)
        || !is_lifecycle_variant_value(semantic_id, value_type)
    {
        return Err(BoundedFeatureProgramErrorV1::Constant);
    }
    Ok(())
}

fn is_lifecycle_variant_value(semantic_id: &str, value_type: ValueTypeV2) -> bool {
    match value_type {
        ValueTypeV2::PositionIntentV1 => matches!(
            semantic_id,
            "kernel.position.add.v1"
                | "kernel.position.enter.v1"
                | "kernel.position.exit.v1"
                | "kernel.position.hold.v1"
                | "kernel.position.reduce.v1"
        ),
        ValueTypeV2::TargetVariantV1 => matches!(
            semantic_id,
            "kernel.target.keep.v1"
                | "kernel.target.position.v1"
                | "kernel.target.rebalance.v1"
                | "kernel.target.weight.v1"
        ),
        ValueTypeV2::ProtectionVariantV1 => matches!(
            semantic_id,
            "kernel.protection.clear.v1"
                | "kernel.protection.keep.v1"
                | "kernel.protection.replace.v1"
                | "kernel.protection.trailing-adjust.v1"
        ),
        _ => false,
    }
}

fn lifecycle_value_type(semantic_id: &str) -> Option<ValueTypeV2> {
    match semantic_id {
        "kernel.position.add.v1"
        | "kernel.position.enter.v1"
        | "kernel.position.exit.v1"
        | "kernel.position.hold.v1"
        | "kernel.position.reduce.v1" => Some(ValueTypeV2::PositionIntentV1),
        "kernel.target.keep.v1"
        | "kernel.target.position.v1"
        | "kernel.target.rebalance.v1"
        | "kernel.target.weight.v1" => Some(ValueTypeV2::TargetVariantV1),
        "kernel.protection.clear.v1"
        | "kernel.protection.keep.v1"
        | "kernel.protection.replace.v1"
        | "kernel.protection.stop-loss.v1"
        | "kernel.protection.take-profit.v1"
        | "kernel.protection.trailing-adjust.v1" => Some(ValueTypeV2::ProtectionVariantV1),
        _ => None,
    }
}

fn validate_graph(
    proposal: &BoundedFeatureProgramProposalV1,
    catalog: PrimitiveCatalogV1,
    mut values: BTreeMap<String, ValueInfo>,
) -> Result<ValidatedGraph, BoundedFeatureProgramErrorV1> {
    let mut states = BTreeMap::new();
    let mut total_state_bytes = 0_u32;
    for state in &proposal.state_cells {
        valid_id(&state.state_id)?;
        valid_id(&state.writer_node_id)?;
        if state.max_bytes == 0 || states.insert(state.state_id.as_str(), state).is_some() {
            return Err(BoundedFeatureProgramErrorV1::State);
        }
        total_state_bytes = total_state_bytes
            .checked_add(state.max_bytes)
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
        if let BoundedFeatureStateKindV1::Strategy { value_type, .. } = &state.state_kind {
            let width =
                strategy_state_width(value_type).ok_or(BoundedFeatureProgramErrorV1::State)?;
            let BoundedFeatureInitialStateV1::Constant { constant_id } = &state.initial else {
                return Err(BoundedFeatureProgramErrorV1::State);
            };
            let initial = values
                .get(&format!("c:{constant_id}"))
                .ok_or(BoundedFeatureProgramErrorV1::State)?;
            if state.max_bytes != width
                || &initial.value_type != value_type
                || initial.availability != BoundedFeatureAvailabilityV1::Ready
            {
                return Err(BoundedFeatureProgramErrorV1::State);
            }
            values.insert(
                format!("s:{}", state.state_id),
                ValueInfo {
                    value_type: value_type.clone(),
                    availability: BoundedFeatureAvailabilityV1::Ready,
                },
            );
        } else if !matches!(state.initial, BoundedFeatureInitialStateV1::CanonicalEmpty) {
            return Err(BoundedFeatureProgramErrorV1::State);
        }
    }
    if total_state_bytes > proposal.bounds.max_state_bytes {
        return Err(BoundedFeatureProgramErrorV1::Bounds);
    }

    let node_positions: BTreeMap<_, _> = proposal
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.node_id.as_str(), index))
        .collect();
    let mut written_states = BTreeSet::<String>::new();
    let mut consumed = BTreeMap::<String, u16>::new();
    let mut depth = BTreeMap::<String, u16>::new();
    let mut edge_count = 0_u16;
    let mut port_count = 0_u16;
    let mut atomic_coordinate_pairs = AtomicCoordinatePairs::default();

    for (index, node) in proposal.nodes.iter().enumerate() {
        valid_id(&node.node_id)?;
        valid_id(&node.primitive_semantic_id)?;
        let row = catalog
            .row(&node.primitive_semantic_id)
            .ok_or(BoundedFeatureProgramErrorV1::Primitive)?;
        if row.kind != CatalogRowKindV1::Primitive {
            return Err(BoundedFeatureProgramErrorV1::Primitive);
        }
        let operation = row
            .operation
            .ok_or(BoundedFeatureProgramErrorV1::Primitive)?;
        let contract = row.contract();
        validate_parameters(
            &node.parameters,
            contract.parameters,
            row.rounding,
            &proposal.bounds,
        )?;

        let expected_inputs = expected_input_ports(operation, contract.input);
        if node.input_bindings.len() != expected_inputs.len()
            || node
                .input_bindings
                .iter()
                .map(|binding| binding.port_id.as_str())
                .ne(expected_inputs.iter().copied())
        {
            return Err(BoundedFeatureProgramErrorV1::Type);
        }

        let mut input_values = Vec::with_capacity(node.input_bindings.len());
        let mut node_depth = 1_u16;
        for binding in &node.input_bindings {
            valid_id(&binding.port_id)?;
            if let BoundedFeatureValueRefV1::NodeOutput { node_id, .. } = &binding.source {
                if node_positions
                    .get(node_id.as_str())
                    .copied()
                    .is_none_or(|position| position >= index)
                {
                    return Err(BoundedFeatureProgramErrorV1::Graph);
                }
                node_depth = node_depth.max(
                    depth
                        .get(node_id)
                        .copied()
                        .ok_or(BoundedFeatureProgramErrorV1::Graph)?
                        .checked_add(1)
                        .ok_or(BoundedFeatureProgramErrorV1::Bounds)?,
                );
            }
            let key = value_ref_key(&binding.source);
            if atomic_coordinate_pairs.is_coordinate(&key) {
                return Err(BoundedFeatureProgramErrorV1::Type);
            }
            let value = values.get(&key).ok_or(BoundedFeatureProgramErrorV1::Type)?;
            if binding.require_ready
                != (value.availability == BoundedFeatureAvailabilityV1::WarmingReady)
            {
                return Err(BoundedFeatureProgramErrorV1::Type);
            }
            consume_graph_value(&mut consumed, &key, &atomic_coordinate_pairs)?;
            input_values.push(value.clone());
        }
        if node_depth > proposal.bounds.max_depth {
            return Err(BoundedFeatureProgramErrorV1::Bounds);
        }
        depth.insert(node.node_id.clone(), node_depth);
        edge_count = edge_count
            .checked_add(
                u16::try_from(node.input_bindings.len())
                    .map_err(|_| BoundedFeatureProgramErrorV1::Bounds)?,
            )
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;

        validate_clock_and_state(
            node,
            contract.clock,
            contract.state,
            &states,
            &mut written_states,
            &proposal.bounds,
        )?;
        validate_input_types(contract.input, &input_values)?;
        let output_types = derive_output_types(node, operation, contract, &input_values, proposal)?;
        let expected_outputs = expected_output_ports(contract.output);
        if node.output_ports.len() != expected_outputs.len()
            || node
                .output_ports
                .iter()
                .map(|port| port.port_id.as_str())
                .ne(expected_outputs.iter().copied())
            || output_types.len() != node.output_ports.len()
        {
            return Err(BoundedFeatureProgramErrorV1::Type);
        }
        for (port, expected) in node.output_ports.iter().zip(output_types) {
            valid_id(&port.port_id)?;
            if port.value_type != expected.value_type || port.availability != expected.availability
            {
                return Err(BoundedFeatureProgramErrorV1::Type);
            }
            values.insert(format!("n:{}:{}", node.node_id, port.port_id), expected);
        }
        if contract.output == CatalogOutputRuleV1::AvailableFixedAndCoordinate {
            atomic_coordinate_pairs.record(&node.node_id)?;
        }
        port_count = port_count
            .checked_add(
                u16::try_from(node.input_bindings.len() + node.output_ports.len())
                    .map_err(|_| BoundedFeatureProgramErrorV1::Bounds)?,
            )
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
    }

    for state in &proposal.state_cells {
        match &state.state_kind {
            BoundedFeatureStateKindV1::Primitive => {
                if !written_states.contains(state.state_id.as_str()) {
                    return Err(BoundedFeatureProgramErrorV1::State);
                }
            }
            BoundedFeatureStateKindV1::Strategy {
                source_port_id,
                value_type,
            } => {
                valid_id(source_port_id)?;
                let value = values
                    .get(&format!("n:{}:{}", state.writer_node_id, source_port_id))
                    .ok_or(BoundedFeatureProgramErrorV1::State)?;
                if atomic_coordinate_pairs
                    .is_coordinate(&format!("n:{}:{}", state.writer_node_id, source_port_id))
                {
                    return Err(BoundedFeatureProgramErrorV1::State);
                }
                if &value.value_type != value_type
                    || value.availability != BoundedFeatureAvailabilityV1::Ready
                    || !written_states.insert(state.state_id.clone())
                {
                    return Err(BoundedFeatureProgramErrorV1::State);
                }
                consume_graph_value(
                    &mut consumed,
                    &format!("n:{}:{}", state.writer_node_id, source_port_id),
                    &atomic_coordinate_pairs,
                )?;
            }
        }
    }
    let mut consume_decision_ref = |source: &BoundedFeatureValueRefV1| {
        let key = value_ref_key(source);
        if atomic_coordinate_pairs.is_coordinate(&key) {
            return Err(BoundedFeatureProgramErrorV1::Terminal);
        }
        consume_graph_value(&mut consumed, &key, &atomic_coordinate_pairs)?;
        edge_count = edge_count
            .checked_add(1)
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
        Ok::<_, BoundedFeatureProgramErrorV1>(())
    };
    for branch in &proposal.proposal_decision_table.branches {
        consume_decision_ref(&branch.predicate)?;
        for terminal in &branch.frame.terminal_outputs {
            consume_decision_ref(&terminal.source)?;
        }
    }
    for terminal in &proposal
        .proposal_decision_table
        .default_frame
        .terminal_outputs
    {
        consume_decision_ref(&terminal.source)?;
    }
    for state in &proposal.state_cells {
        if let BoundedFeatureInitialStateV1::Constant { constant_id } = &state.initial {
            *consumed.entry(format!("c:{constant_id}")).or_default() += 1;
        }
    }
    for key in values
        .keys()
        .filter(|key| key.starts_with("i:") || key.starts_with("c:"))
    {
        if !consumed.contains_key(key) {
            return Err(BoundedFeatureProgramErrorV1::State);
        }
    }
    if edge_count > proposal.bounds.max_edges || port_count > proposal.bounds.max_ports {
        return Err(BoundedFeatureProgramErrorV1::Bounds);
    }
    if consumed
        .values()
        .any(|count| *count > proposal.bounds.max_fan_out)
    {
        return Err(BoundedFeatureProgramErrorV1::Bounds);
    }
    Ok(ValidatedGraph {
        values,
        atomic_coordinate_pairs,
    })
}

fn validate_terminals(
    proposal: &BoundedFeatureProgramProposalV1,
    manifest: &PluginManifestV2,
    catalog: PrimitiveCatalogV1,
    values: &BTreeMap<String, ValueInfo>,
    atomic_coordinate_pairs: &AtomicCoordinatePairs,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let manifest_ports: BTreeMap<_, _> = manifest
        .output_ports
        .iter()
        .map(|port| (port.semantic_id.as_str(), port))
        .collect();
    let mut consumers = BTreeSet::new();
    for node in &proposal.nodes {
        for binding in &node.input_bindings {
            consumers.insert(value_ref_key(&binding.source));
        }
    }
    for state in &proposal.state_cells {
        if let BoundedFeatureStateKindV1::Strategy { source_port_id, .. } = &state.state_kind {
            consumers.insert(format!("n:{}:{}", state.writer_node_id, source_port_id));
        }
    }
    let mut priorities = BTreeSet::new();
    for branch in &proposal.proposal_decision_table.branches {
        if !priorities.insert(branch.priority) {
            return Err(BoundedFeatureProgramErrorV1::Terminal);
        }
        let predicate_key = value_ref_key(&branch.predicate);
        let predicate = values
            .get(&predicate_key)
            .ok_or(BoundedFeatureProgramErrorV1::Terminal)?;
        if predicate.value_type != BoundedFeatureValueTypeV1::Boolean
            || predicate.availability != BoundedFeatureAvailabilityV1::Ready
        {
            return Err(BoundedFeatureProgramErrorV1::Terminal);
        }
        consumers.insert(predicate_key);
        validate_proposal_frame(
            &branch.frame,
            &manifest_ports,
            manifest.output_ports.len(),
            catalog,
            values,
            &mut consumers,
        )?;
    }
    validate_proposal_frame(
        &proposal.proposal_decision_table.default_frame,
        &manifest_ports,
        manifest.output_ports.len(),
        catalog,
        values,
        &mut consumers,
    )?;
    let coordinate_sidecars = consumers
        .iter()
        .filter_map(|key| atomic_coordinate_pairs.coordinate_for_value(key))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    consumers.extend(coordinate_sidecars);
    let warmup = &proposal.warmup;
    validate_lifecycle_constant(
        &warmup.position_intent_semantic_id,
        ValueTypeV2::PositionIntentV1,
        catalog,
    )?;
    validate_lifecycle_constant(
        &warmup.target_variant_semantic_id,
        ValueTypeV2::TargetVariantV1,
        catalog,
    )?;
    validate_lifecycle_constant(
        &warmup.protection_variant_semantic_id,
        ValueTypeV2::ProtectionVariantV1,
        catalog,
    )?;
    if warmup.position_intent_semantic_id != "kernel.position.hold.v1"
        || warmup.target_variant_semantic_id != "kernel.target.keep.v1"
        || warmup.protection_variant_semantic_id != "kernel.protection.keep.v1"
        || warmup.target_position_units != 0
        || warmup.target_weight_micros != 0
        || warmup.rebalance_sequence != 0
        || warmup.reconciliation_target_units != 0
        || warmup.stop_loss_ticks != 0
        || warmup.take_profit_ticks != 0
        || warmup.trailing_distance_ticks != 0
        || warmup.trailing_stop_ticks != 0
        || warmup.post_state != BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent
    {
        return Err(BoundedFeatureProgramErrorV1::Terminal);
    }
    for node in &proposal.nodes {
        for output in &node.output_ports {
            if !consumers.contains(&format!("n:{}:{}", node.node_id, output.port_id)) {
                return Err(BoundedFeatureProgramErrorV1::Graph);
            }
        }
    }
    Ok(())
}

fn validate_proposal_frame(
    frame: &BoundedFeatureProposalFrameV1,
    manifest_ports: &BTreeMap<&str, &crate::strategy_design_v2::PortContractV2>,
    manifest_output_count: usize,
    catalog: PrimitiveCatalogV1,
    values: &BTreeMap<String, ValueInfo>,
    consumers: &mut BTreeSet<String>,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let mut used_ports = BTreeSet::new();
    for terminal in &frame.terminal_outputs {
        valid_id(&terminal.manifest_port_id)?;
        valid_id(&terminal.lifecycle_semantic_id)?;
        let port = manifest_ports
            .get(terminal.manifest_port_id.as_str())
            .ok_or(BoundedFeatureProgramErrorV1::Terminal)?;
        let row = catalog
            .row(&terminal.lifecycle_semantic_id)
            .ok_or(BoundedFeatureProgramErrorV1::Terminal)?;
        let source_key = value_ref_key(&terminal.source);
        let value = values
            .get(&source_key)
            .ok_or(BoundedFeatureProgramErrorV1::Terminal)?;
        let lifecycle_type = lifecycle_value_type(&terminal.lifecycle_semantic_id);
        let semantic_matches_type = match port.value_type {
            ValueTypeV2::PositionIntentV1
            | ValueTypeV2::TargetVariantV1
            | ValueTypeV2::ProtectionVariantV1 => lifecycle_type == Some(port.value_type),
            ValueTypeV2::I32 | ValueTypeV2::I64 | ValueTypeV2::U64 | ValueTypeV2::I128 => {
                matches!(
                    lifecycle_type,
                    Some(ValueTypeV2::TargetVariantV1 | ValueTypeV2::ProtectionVariantV1)
                )
            }
            _ => false,
        };
        if row.kind != CatalogRowKindV1::LifecycleReference
            || !semantic_matches_type
            || value.availability != BoundedFeatureAvailabilityV1::Ready
            || !terminal_conversion_matches(
                &terminal.conversion,
                &value.value_type,
                port.value_type,
            )?
            || manifest_width(port.value_type) != Some(port.max_bytes)
            || !used_ports.insert(port.semantic_id.as_str())
        {
            return Err(BoundedFeatureProgramErrorV1::Terminal);
        }
        consumers.insert(source_key);
    }
    if used_ports.len() != manifest_output_count {
        return Err(BoundedFeatureProgramErrorV1::Terminal);
    }
    Ok(())
}

fn expected_input_ports(
    operation: PrimitiveOperationV1,
    rule: CatalogInputRuleV1,
) -> &'static [&'static str] {
    match rule {
        CatalogInputRuleV1::None => &[],
        CatalogInputRuleV1::Fixed
        | CatalogInputRuleV1::ClockedFixed
        | CatalogInputRuleV1::ClockedHigh
        | CatalogInputRuleV1::ClockedLow => &["value"],
        CatalogInputRuleV1::TwoFixed if operation == PrimitiveOperationV1::Fraction => {
            &["high", "low"]
        }
        CatalogInputRuleV1::TwoFixed => &["a", "b"],
        CatalogInputRuleV1::BooleanAndTwoFixed => &["condition", "when_false", "when_true"],
        CatalogInputRuleV1::Ohlc | CatalogInputRuleV1::ClockedOhlc => {
            &["close", "high", "low", "open"]
        }
    }
}

fn expected_output_ports(rule: CatalogOutputRuleV1) -> &'static [&'static str] {
    match rule {
        CatalogOutputRuleV1::Fixed
        | CatalogOutputRuleV1::Boolean
        | CatalogOutputRuleV1::AvailableFixed => &["value"],
        CatalogOutputRuleV1::AvailableFixedAndCoordinate => &["coordinate", "value"],
        CatalogOutputRuleV1::Policy | CatalogOutputRuleV1::LifecycleReference => &[],
    }
}

fn validate_input_types(
    rule: CatalogInputRuleV1,
    inputs: &[ValueInfo],
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let fixed = |value: &ValueInfo| {
        matches!(
            value.value_type,
            BoundedFeatureValueTypeV1::FixedI128 { .. }
        )
    };
    let valid = match rule {
        CatalogInputRuleV1::None => inputs.is_empty(),
        CatalogInputRuleV1::Fixed
        | CatalogInputRuleV1::ClockedFixed
        | CatalogInputRuleV1::ClockedHigh
        | CatalogInputRuleV1::ClockedLow => inputs.len() == 1 && fixed(&inputs[0]),
        CatalogInputRuleV1::TwoFixed => inputs.len() == 2 && inputs.iter().all(fixed),
        CatalogInputRuleV1::BooleanAndTwoFixed => {
            inputs.len() == 3
                && inputs[0].value_type == BoundedFeatureValueTypeV1::Boolean
                && inputs[1..].iter().all(fixed)
        }
        CatalogInputRuleV1::Ohlc | CatalogInputRuleV1::ClockedOhlc => {
            inputs.len() == 4 && inputs.iter().all(fixed)
        }
    };
    if valid {
        Ok(())
    } else {
        Err(BoundedFeatureProgramErrorV1::Type)
    }
}

fn derive_output_types(
    node: &BoundedFeatureNodeV1,
    _operation: PrimitiveOperationV1,
    contract: vibe_indicators_kernel::CatalogContractV1,
    inputs: &[ValueInfo],
    proposal: &BoundedFeatureProgramProposalV1,
) -> Result<Vec<ValueInfo>, BoundedFeatureProgramErrorV1> {
    let fixed_inputs: Vec<_> = inputs
        .iter()
        .filter_map(|value| match &value.value_type {
            BoundedFeatureValueTypeV1::FixedI128 { unit, scale } => Some((unit.as_str(), *scale)),
            _ => None,
        })
        .collect();
    let output_scale = declared_output_scale(&node.parameters)
        .or_else(|| fixed_inputs.first().map(|(_, scale)| *scale));
    let output_unit = match contract.unit {
        CatalogUnitRuleV1::EqualInputsBooleanOutput
        | CatalogUnitRuleV1::PreserveEqualInputs
        | CatalogUnitRuleV1::EqualBranches => {
            let first = fixed_inputs
                .first()
                .ok_or(BoundedFeatureProgramErrorV1::Type)?
                .0;
            if fixed_inputs.iter().any(|(unit, _)| unit != &first) {
                return Err(BoundedFeatureProgramErrorV1::Type);
            }
            first.to_owned()
        }
        CatalogUnitRuleV1::DimensionlessOutput => "dimensionless".to_owned(),
        CatalogUnitRuleV1::Product => format!("{}*{}", fixed_inputs[0].0, fixed_inputs[1].0),
        CatalogUnitRuleV1::Quotient => format!("{}/{}", fixed_inputs[0].0, fixed_inputs[1].0),
        CatalogUnitRuleV1::Policy | CatalogUnitRuleV1::LifecycleOwned => {
            return Err(BoundedFeatureProgramErrorV1::Primitive);
        }
    };
    match contract.scale {
        CatalogScaleRuleV1::EqualInputsDeclaredOutput
        | CatalogScaleRuleV1::EqualInputsBooleanOutput
        | CatalogScaleRuleV1::RetainEqualInputs => {
            let first = fixed_inputs
                .first()
                .ok_or(BoundedFeatureProgramErrorV1::Type)?
                .1;
            if fixed_inputs.iter().any(|(_, scale)| *scale != first) {
                return Err(BoundedFeatureProgramErrorV1::Type);
            }
        }
        CatalogScaleRuleV1::DeclaredOutput => {}
        CatalogScaleRuleV1::Policy | CatalogScaleRuleV1::LifecycleOwned => {
            return Err(BoundedFeatureProgramErrorV1::Primitive);
        }
    }
    let availability = match contract.availability {
        CatalogAvailabilityRuleV1::ReadyInputs | CatalogAvailabilityRuleV1::FirstSample => {
            BoundedFeatureAvailabilityV1::Ready
        }
        CatalogAvailabilityRuleV1::FullWindow
        | CatalogAvailabilityRuleV1::LagOffsetPlusOne
        | CatalogAvailabilityRuleV1::PeriodPlusOne
        | CatalogAvailabilityRuleV1::PreviousClose => BoundedFeatureAvailabilityV1::WarmingReady,
        CatalogAvailabilityRuleV1::Policy | CatalogAvailabilityRuleV1::LifecycleOwned => {
            return Err(BoundedFeatureProgramErrorV1::Primitive);
        }
    };
    let fixed = ValueInfo {
        value_type: BoundedFeatureValueTypeV1::FixedI128 {
            unit: output_unit,
            scale: output_scale.ok_or(BoundedFeatureProgramErrorV1::Type)?,
        },
        availability,
    };
    match contract.output {
        CatalogOutputRuleV1::Fixed | CatalogOutputRuleV1::AvailableFixed => Ok(vec![fixed]),
        CatalogOutputRuleV1::Boolean => Ok(vec![ValueInfo {
            value_type: BoundedFeatureValueTypeV1::Boolean,
            availability: BoundedFeatureAvailabilityV1::Ready,
        }]),
        CatalogOutputRuleV1::AvailableFixedAndCoordinate => {
            let clock = node
                .update_clock
                .as_ref()
                .ok_or(BoundedFeatureProgramErrorV1::State)?;
            let role = proposal
                .inputs
                .iter()
                .find(|input| input.input_role_id == clock.role())
                .ok_or(BoundedFeatureProgramErrorV1::State)?;
            Ok(vec![
                ValueInfo {
                    value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                        input_role_identity: role.input_role_identity,
                    },
                    availability,
                },
                fixed,
            ])
        }
        CatalogOutputRuleV1::Policy | CatalogOutputRuleV1::LifecycleReference => {
            Err(BoundedFeatureProgramErrorV1::Primitive)
        }
    }
}

fn validate_parameters(
    parameters: &BoundedFeatureParametersV1,
    rule: CatalogParameterRuleV1,
    catalog_rounding: Option<RoundingMode>,
    bounds: &BoundedFeatureBoundsV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let rounding_matches =
        |rounding: BoundedFeatureRoundingV1| Some(rounding.kernel()) == catalog_rounding;
    let valid = match (rule, parameters) {
        (CatalogParameterRuleV1::None, BoundedFeatureParametersV1::None) => true,
        (
            CatalogParameterRuleV1::OutputScale,
            BoundedFeatureParametersV1::OutputScale {
                output_scale,
                rounding,
            },
        ) => *output_scale <= 38 && rounding_matches(*rounding),
        (
            CatalogParameterRuleV1::ComparisonPredicate,
            BoundedFeatureParametersV1::ComparisonPredicate { .. },
        ) => true,
        (
            CatalogParameterRuleV1::Period,
            BoundedFeatureParametersV1::Period { period, rounding },
        ) => {
            *period > 0
                && *period <= bounds.max_window
                && match (catalog_rounding, rounding) {
                    (None, None) => true,
                    (Some(expected), Some(actual)) => actual.kernel() == expected,
                    _ => false,
                }
        }
        (
            CatalogParameterRuleV1::Window,
            BoundedFeatureParametersV1::Window { window, rounding },
        ) => {
            *window > 0
                && *window <= bounds.max_window
                && rounding.is_none()
                && catalog_rounding.is_none()
        }
        (
            CatalogParameterRuleV1::LagAndMaximum,
            BoundedFeatureParametersV1::Lag {
                offset,
                declared_max_lag,
            },
        ) => *offset > 0 && *offset <= *declared_max_lag && *declared_max_lag <= bounds.max_lag,
        (
            CatalogParameterRuleV1::OutputScaleAndReducedFraction,
            BoundedFeatureParametersV1::RangeFraction {
                numerator,
                denominator,
                output_scale,
                rounding,
            },
        ) => {
            *denominator > 0
                && *numerator <= *denominator
                && gcd(*numerator, *denominator) == 1
                && *output_scale <= 38
                && rounding_matches(*rounding)
        }
        (
            CatalogParameterRuleV1::PeriodAndOutputScale,
            BoundedFeatureParametersV1::PeriodAndOutputScale {
                period,
                output_scale,
                rounding,
            },
        ) => {
            *period > 0
                && *period <= bounds.max_window
                && *output_scale <= 38
                && rounding_matches(*rounding)
        }
        (
            CatalogParameterRuleV1::WindowAndOutputScale,
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window,
                output_scale,
                rounding,
            },
        ) => {
            *window > 0
                && *window <= bounds.max_window
                && *output_scale <= 38
                && match (catalog_rounding, rounding) {
                    (None, None) => true,
                    (Some(expected), Some(actual)) => actual.kernel() == expected,
                    _ => false,
                }
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(BoundedFeatureProgramErrorV1::Primitive)
    }
}

fn validate_clock_and_state<'a>(
    node: &BoundedFeatureNodeV1,
    clock_rule: CatalogClockRuleV1,
    state_rule: CatalogStateRuleV1,
    states: &BTreeMap<&'a str, &'a BoundedFeatureStateCellV1>,
    written_states: &mut BTreeSet<String>,
    bounds: &BoundedFeatureBoundsV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    match clock_rule {
        CatalogClockRuleV1::None if node.update_clock.is_none() => {}
        CatalogClockRuleV1::OneDeclaredTriggerOrSample if node.update_clock.is_some() => {}
        _ => return Err(BoundedFeatureProgramErrorV1::State),
    }
    match state_rule {
        CatalogStateRuleV1::None if node.state_id.is_none() => Ok(()),
        CatalogStateRuleV1::Smoothing
        | CatalogStateRuleV1::Window
        | CatalogStateRuleV1::Bar
        | CatalogStateRuleV1::Rsi => {
            let state_id = node
                .state_id
                .as_deref()
                .ok_or(BoundedFeatureProgramErrorV1::State)?;
            let state = states
                .get(state_id)
                .ok_or(BoundedFeatureProgramErrorV1::State)?;
            if state.writer_node_id != node.node_id
                || !matches!(state.state_kind, BoundedFeatureStateKindV1::Primitive)
                || !written_states.insert(state_id.to_owned())
                || state.max_bytes != expected_state_bytes(state_rule, &node.parameters, bounds)?
            {
                return Err(BoundedFeatureProgramErrorV1::State);
            }
            Ok(())
        }
        _ => Err(BoundedFeatureProgramErrorV1::State),
    }
}

fn expected_state_bytes(
    rule: CatalogStateRuleV1,
    parameters: &BoundedFeatureParametersV1,
    bounds: &BoundedFeatureBoundsV1,
) -> Result<u32, BoundedFeatureProgramErrorV1> {
    let window_bytes = |window: u32| 20_u32.checked_add(324_u32.checked_mul(window)?);
    let value = match (rule, parameters) {
        (CatalogStateRuleV1::Smoothing, BoundedFeatureParametersV1::Period { .. }) => Some(352),
        (CatalogStateRuleV1::Bar, _) => Some(400),
        (CatalogStateRuleV1::Window, BoundedFeatureParametersV1::Lag { offset, .. }) => {
            offset.checked_add(1).and_then(window_bytes)
        }
        (
            CatalogStateRuleV1::Window,
            BoundedFeatureParametersV1::Window { window, .. }
            | BoundedFeatureParametersV1::WindowAndOutputScale { window, .. },
        ) => window_bytes(*window),
        (
            CatalogStateRuleV1::Rsi,
            BoundedFeatureParametersV1::PeriodAndOutputScale { period, .. },
        ) => period
            .checked_add(1)
            .and_then(|value| 324_u32.checked_mul(value))
            .and_then(|value| 404_u32.checked_add(value)),
        _ => None,
    }
    .ok_or(BoundedFeatureProgramErrorV1::State)?;
    if value > bounds.max_state_bytes {
        Err(BoundedFeatureProgramErrorV1::Bounds)
    } else {
        Ok(value)
    }
}

fn strategy_state_width(value_type: &BoundedFeatureValueTypeV1) -> Option<u32> {
    match value_type {
        BoundedFeatureValueTypeV1::Boolean => Some(1),
        BoundedFeatureValueTypeV1::I32 => Some(4),
        BoundedFeatureValueTypeV1::I64 | BoundedFeatureValueTypeV1::U64 => Some(8),
        BoundedFeatureValueTypeV1::FixedI128 { .. } => Some(16),
        BoundedFeatureValueTypeV1::OwnerSampleCoordinate { .. } => Some(308),
        BoundedFeatureValueTypeV1::PositionIntentV1
        | BoundedFeatureValueTypeV1::TargetVariantV1
        | BoundedFeatureValueTypeV1::ProtectionVariantV1 => None,
    }
}

fn canonical_state_layout(
    proposal: &BoundedFeatureProgramProposalV1,
    values: &BTreeMap<String, ValueInfo>,
) -> Result<CanonicalBoundedFeatureStateLayoutV1, BoundedFeatureProgramErrorV1> {
    let constants: BTreeMap<_, _> = proposal
        .constants
        .iter()
        .map(|constant| (constant.constant_id.as_str(), &constant.value))
        .collect();
    let mut slots = Vec::with_capacity(proposal.state_cells.len());
    let mut offset = 0_u32;
    for state in &proposal.state_cells {
        let initial_bytes = match &state.state_kind {
            BoundedFeatureStateKindV1::Primitive => None,
            BoundedFeatureStateKindV1::Strategy { value_type, .. } => {
                let BoundedFeatureInitialStateV1::Constant { constant_id } = &state.initial else {
                    return Err(BoundedFeatureProgramErrorV1::State);
                };
                let value = constants
                    .get(constant_id.as_str())
                    .ok_or(BoundedFeatureProgramErrorV1::State)?;
                let bytes = encode_state_constant(value, value_type)?;
                if bytes.len() != state.max_bytes as usize
                    || values
                        .get(&format!("c:{constant_id}"))
                        .is_none_or(|info| &info.value_type != value_type)
                {
                    return Err(BoundedFeatureProgramErrorV1::State);
                }
                Some(bytes)
            }
        };
        slots.push(CanonicalBoundedFeatureStateSlotV1 {
            state_id: state.state_id.clone(),
            offset,
            width: state.max_bytes,
            initial_bytes,
        });
        offset = offset
            .checked_add(state.max_bytes)
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
    }
    Ok(CanonicalBoundedFeatureStateLayoutV1 {
        slots,
        total_bytes: offset,
    })
}

fn validate_canonical_state_layout(
    layout: &CanonicalBoundedFeatureStateLayoutV1,
) -> Result<(), BoundedFeatureProgramErrorV1> {
    let mut expected_offset = 0_u32;
    let mut previous_state_id: Option<&[u8]> = None;
    for slot in layout.slots() {
        if previous_state_id.is_some_and(|previous| previous >= slot.state_id().as_bytes())
            || slot.offset() != expected_offset
            || slot.width() == 0
            || slot
                .initial_bytes()
                .is_some_and(|bytes| bytes.len() != slot.width() as usize)
        {
            return Err(BoundedFeatureProgramErrorV1::State);
        }
        previous_state_id = Some(slot.state_id().as_bytes());
        expected_offset = expected_offset
            .checked_add(slot.width())
            .ok_or(BoundedFeatureProgramErrorV1::Bounds)?;
    }
    if expected_offset != layout.total_bytes() {
        return Err(BoundedFeatureProgramErrorV1::State);
    }
    Ok(())
}

fn encode_state_constant(
    value: &BoundedFeatureConstantValueV1,
    value_type: &BoundedFeatureValueTypeV1,
) -> Result<Vec<u8>, BoundedFeatureProgramErrorV1> {
    let bytes = match (value, value_type) {
        (
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient,
                unit,
                scale,
            },
            BoundedFeatureValueTypeV1::FixedI128 {
                unit: expected_unit,
                scale: expected_scale,
            },
        ) if unit == expected_unit && scale == expected_scale => coefficient.to_le_bytes().to_vec(),
        (BoundedFeatureConstantValueV1::Boolean { value }, BoundedFeatureValueTypeV1::Boolean) => {
            vec![u8::from(*value)]
        }
        (BoundedFeatureConstantValueV1::I32 { value }, BoundedFeatureValueTypeV1::I32) => {
            value.to_le_bytes().to_vec()
        }
        (BoundedFeatureConstantValueV1::I64 { value }, BoundedFeatureValueTypeV1::I64) => {
            value.to_le_bytes().to_vec()
        }
        (BoundedFeatureConstantValueV1::U64 { value }, BoundedFeatureValueTypeV1::U64) => {
            value.to_le_bytes().to_vec()
        }
        _ => return Err(BoundedFeatureProgramErrorV1::State),
    };
    Ok(bytes)
}

fn declared_output_scale(parameters: &BoundedFeatureParametersV1) -> Option<u8> {
    match parameters {
        BoundedFeatureParametersV1::OutputScale { output_scale, .. }
        | BoundedFeatureParametersV1::RangeFraction { output_scale, .. }
        | BoundedFeatureParametersV1::PeriodAndOutputScale { output_scale, .. }
        | BoundedFeatureParametersV1::WindowAndOutputScale { output_scale, .. } => {
            Some(*output_scale)
        }
        _ => None,
    }
}

fn value_ref_key(value: &BoundedFeatureValueRefV1) -> String {
    match value {
        BoundedFeatureValueRefV1::InputValue { input_role_id } => format!("i:{input_role_id}"),
        BoundedFeatureValueRefV1::InputCoordinate { input_role_id } => format!("q:{input_role_id}"),
        BoundedFeatureValueRefV1::Constant { constant_id } => format!("c:{constant_id}"),
        BoundedFeatureValueRefV1::PriorState { state_id } => format!("s:{state_id}"),
        BoundedFeatureValueRefV1::NodeOutput { node_id, port_id } => {
            format!("n:{node_id}:{port_id}")
        }
    }
}

fn bfp_type_to_manifest(value: &BoundedFeatureValueTypeV1) -> Option<ValueTypeV2> {
    match value {
        BoundedFeatureValueTypeV1::FixedI128 { .. } => Some(ValueTypeV2::I128),
        BoundedFeatureValueTypeV1::Boolean => None,
        BoundedFeatureValueTypeV1::OwnerSampleCoordinate { .. } => Some(ValueTypeV2::Bytes),
        BoundedFeatureValueTypeV1::I32 => Some(ValueTypeV2::I32),
        BoundedFeatureValueTypeV1::I64 => Some(ValueTypeV2::I64),
        BoundedFeatureValueTypeV1::U64 => Some(ValueTypeV2::U64),
        BoundedFeatureValueTypeV1::PositionIntentV1 => Some(ValueTypeV2::PositionIntentV1),
        BoundedFeatureValueTypeV1::TargetVariantV1 => Some(ValueTypeV2::TargetVariantV1),
        BoundedFeatureValueTypeV1::ProtectionVariantV1 => Some(ValueTypeV2::ProtectionVariantV1),
    }
}

fn terminal_conversion_matches(
    conversion: &BoundedFeatureTerminalConversionV1,
    source: &BoundedFeatureValueTypeV1,
    target: ValueTypeV2,
) -> Result<bool, BoundedFeatureProgramErrorV1> {
    let exact_fixed = |unit: &str, scale: u8| {
        valid_text(unit)?;
        Ok(
            matches!(source, BoundedFeatureValueTypeV1::FixedI128 { unit: source_unit, scale: source_scale }
            if source_unit == unit && *source_scale == scale && scale == 0),
        )
    };
    match conversion {
        BoundedFeatureTerminalConversionV1::Exact => {
            Ok(bfp_type_to_manifest(source) == Some(target))
        }
        BoundedFeatureTerminalConversionV1::FixedCoefficientToI32 { unit, scale } => {
            Ok(target == ValueTypeV2::I32 && exact_fixed(unit, *scale)?)
        }
        BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 { unit, scale } => {
            Ok(target == ValueTypeV2::I64 && exact_fixed(unit, *scale)?)
        }
        BoundedFeatureTerminalConversionV1::FixedCoefficientToU64 { unit, scale } => {
            Ok(target == ValueTypeV2::U64 && exact_fixed(unit, *scale)?)
        }
    }
}

fn manifest_width(value: ValueTypeV2) -> Option<u32> {
    match value {
        ValueTypeV2::I32 => Some(4),
        ValueTypeV2::I64 | ValueTypeV2::U64 => Some(8),
        ValueTypeV2::I128 => Some(16),
        ValueTypeV2::PositionIntentV1 => lifecycle_manifest_width(ValueTypeV2::PositionIntentV1),
        ValueTypeV2::TargetVariantV1 => lifecycle_manifest_width(ValueTypeV2::TargetVariantV1),
        ValueTypeV2::ProtectionVariantV1 => {
            lifecycle_manifest_width(ValueTypeV2::ProtectionVariantV1)
        }
        _ => None,
    }
}

fn lifecycle_manifest_width(value_type: ValueTypeV2) -> Option<u32> {
    const IDS: &[&str] = &[
        "kernel.position.add.v1",
        "kernel.position.enter.v1",
        "kernel.position.exit.v1",
        "kernel.position.hold.v1",
        "kernel.position.reduce.v1",
        "kernel.protection.clear.v1",
        "kernel.protection.keep.v1",
        "kernel.protection.replace.v1",
        "kernel.protection.stop-loss.v1",
        "kernel.protection.take-profit.v1",
        "kernel.protection.trailing-adjust.v1",
        "kernel.target.keep.v1",
        "kernel.target.position.v1",
        "kernel.target.rebalance.v1",
        "kernel.target.weight.v1",
    ];
    IDS.iter()
        .copied()
        .filter(|semantic_id| lifecycle_value_type(semantic_id) == Some(value_type))
        .map(|semantic_id| semantic_id.len() as u32)
        .max()
}

const fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a
}

fn coordinate_port_id(identity: BindingDigest) -> String {
    let mut value = String::with_capacity(100);
    value.push_str("strategy.input.sample-coordinate.v1.");
    for byte in identity.as_bytes() {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    value
}

fn valid_id(value: &str) -> Result<(), BoundedFeatureProgramErrorV1> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        Err(BoundedFeatureProgramErrorV1::NonCanonical)
    } else {
        Ok(())
    }
}

fn valid_text(value: &str) -> Result<(), BoundedFeatureProgramErrorV1> {
    if value.is_empty()
        || value.len() > MAX_TEXT_BYTES
        || !value.is_ascii()
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        Err(BoundedFeatureProgramErrorV1::NonCanonical)
    } else {
        Ok(())
    }
}

fn domain_digest(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn encode_program(
    program: &BoundedFeatureProgramProposalV1,
) -> Result<Vec<u8>, BoundedFeatureProgramErrorV1> {
    let mut writer = CanonicalWriter::new();
    writer.raw(MAGIC);
    writer.u16(program.schema_version);
    writer.u16(program.semantic_version);
    for digest in [
        program.research_request_identity,
        program.intent_identity,
        program.intent_digest,
        program.design_identity,
        program.design_digest,
    ] {
        writer.digest(digest);
    }
    writer.text(&program.plugin_semantic_id)?;
    writer.digest(program.plugin_manifest_digest);
    writer.u16(program.catalog_semantic_version);
    writer.digest(program.catalog_digest);
    writer.digest(program.first_party_sdk_source_digest);

    writer.sequence(&program.inputs, |writer, input| {
        writer.text(&input.owner_semantic_id)?;
        writer.text(&input.fact_type_semantic_id)?;
        writer.text(&input.input_role_id)?;
        writer.digest(input.input_role_identity);
        writer.text(&input.timeframe)?;
        writer.text(&input.unit)?;
        writer.u8(input.scale);
        writer.digest(input.static_binding_receipt_digest);
        writer.text(&input.value_port_semantic_id)?;
        writer.clock(&input.update_clock)
    })?;
    writer.sequence(&program.constants, |writer, constant| {
        writer.text(&constant.constant_id)?;
        writer.constant(&constant.value)
    })?;
    writer.sequence(&program.state_cells, |writer, state| {
        writer.text(&state.state_id)?;
        writer.text(&state.writer_node_id)?;
        writer.state_kind(&state.state_kind)?;
        writer.initial(&state.initial)?;
        writer.u32(state.max_bytes);
        Ok(())
    })?;
    writer.sequence(&program.nodes, |writer, node| {
        writer.text(&node.node_id)?;
        writer.text(&node.primitive_semantic_id)?;
        writer.sequence(&node.input_bindings, |writer, binding| {
            writer.text(&binding.port_id)?;
            writer.value_ref(&binding.source)?;
            writer.boolean(binding.require_ready);
            Ok(())
        })?;
        writer.sequence(&node.output_ports, |writer, port| {
            writer.text(&port.port_id)?;
            writer.value_type(&port.value_type)?;
            writer.u8(match port.availability {
                BoundedFeatureAvailabilityV1::Ready => 1,
                BoundedFeatureAvailabilityV1::WarmingReady => 2,
            });
            Ok(())
        })?;
        writer.parameters(&node.parameters);
        writer.optional_text(node.state_id.as_deref())?;
        writer.optional_clock(node.update_clock.as_ref())
    })?;
    writer.sequence(
        &program.proposal_decision_table.branches,
        |writer, branch| {
            writer.u16(branch.priority);
            writer.value_ref(&branch.predicate)?;
            writer.proposal_frame(&branch.frame)
        },
    )?;
    writer.proposal_frame(&program.proposal_decision_table.default_frame)?;
    writer.text(&program.warmup.position_intent_semantic_id)?;
    writer.text(&program.warmup.target_variant_semantic_id)?;
    writer.i64(program.warmup.target_position_units);
    writer.i32(program.warmup.target_weight_micros);
    writer.u64(program.warmup.rebalance_sequence);
    writer.i64(program.warmup.reconciliation_target_units);
    writer.text(&program.warmup.protection_variant_semantic_id)?;
    writer.i64(program.warmup.stop_loss_ticks);
    writer.i64(program.warmup.take_profit_ticks);
    writer.u64(program.warmup.trailing_distance_ticks);
    writer.i64(program.warmup.trailing_stop_ticks);
    writer.u8(match program.warmup.post_state {
        BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent => 1,
    });
    writer.bounds(&program.bounds);
    Ok(writer.finish())
}

struct CanonicalWriter {
    bytes: Vec<u8>,
}

impl CanonicalWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(2048),
        }
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.raw(&value.to_le_bytes());
    }
    fn i64(&mut self, value: i64) {
        self.raw(&value.to_le_bytes());
    }
    fn i128(&mut self, value: i128) {
        self.raw(&value.to_le_bytes());
    }
    fn boolean(&mut self, value: bool) {
        self.u8(u8::from(value));
    }
    fn digest(&mut self, value: BindingDigest) {
        self.raw(value.as_bytes());
    }
    fn text(&mut self, value: &str) -> Result<(), BoundedFeatureProgramErrorV1> {
        valid_text(value)?;
        self.u16(
            u16::try_from(value.len()).map_err(|_| BoundedFeatureProgramErrorV1::NonCanonical)?,
        );
        self.raw(value.as_bytes());
        Ok(())
    }
    fn optional_text(&mut self, value: Option<&str>) -> Result<(), BoundedFeatureProgramErrorV1> {
        self.boolean(value.is_some());
        if let Some(value) = value {
            self.text(value)?;
        }
        Ok(())
    }
    fn sequence<T>(
        &mut self,
        values: &[T],
        mut encode: impl FnMut(&mut Self, &T) -> Result<(), BoundedFeatureProgramErrorV1>,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        self.u16(u16::try_from(values.len()).map_err(|_| BoundedFeatureProgramErrorV1::Bounds)?);
        for value in values {
            encode(self, value)?;
        }
        Ok(())
    }
    fn clock(&mut self, value: &BoundedFeatureClockV1) -> Result<(), BoundedFeatureProgramErrorV1> {
        self.u8(value.tag());
        self.text(value.role())?;
        if let BoundedFeatureClockV1::Sample {
            source_semantic_id, ..
        } = value
        {
            self.text(source_semantic_id)?;
        }
        Ok(())
    }
    fn optional_clock(
        &mut self,
        value: Option<&BoundedFeatureClockV1>,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        self.boolean(value.is_some());
        if let Some(value) = value {
            self.clock(value)?;
        }
        Ok(())
    }
    fn value_type(
        &mut self,
        value: &BoundedFeatureValueTypeV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureValueTypeV1::FixedI128 { unit, scale } => {
                self.u8(1);
                self.text(unit)?;
                self.u8(*scale);
            }
            BoundedFeatureValueTypeV1::Boolean => self.u8(2),
            BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                input_role_identity,
            } => {
                self.u8(3);
                self.digest(*input_role_identity);
            }
            BoundedFeatureValueTypeV1::I32 => self.u8(4),
            BoundedFeatureValueTypeV1::I64 => self.u8(5),
            BoundedFeatureValueTypeV1::U64 => self.u8(6),
            BoundedFeatureValueTypeV1::PositionIntentV1 => self.u8(7),
            BoundedFeatureValueTypeV1::TargetVariantV1 => self.u8(8),
            BoundedFeatureValueTypeV1::ProtectionVariantV1 => self.u8(9),
        }
        Ok(())
    }
    fn constant(
        &mut self,
        value: &BoundedFeatureConstantValueV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient,
                unit,
                scale,
            } => {
                self.u8(1);
                self.i128(*coefficient);
                self.text(unit)?;
                self.u8(*scale);
            }
            BoundedFeatureConstantValueV1::Boolean { value } => {
                self.u8(2);
                self.boolean(*value);
            }
            BoundedFeatureConstantValueV1::I32 { value } => {
                self.u8(3);
                self.i32(*value);
            }
            BoundedFeatureConstantValueV1::I64 { value } => {
                self.u8(4);
                self.i64(*value);
            }
            BoundedFeatureConstantValueV1::U64 { value } => {
                self.u8(5);
                self.u64(*value);
            }
            BoundedFeatureConstantValueV1::PositionIntentV1 { semantic_id } => {
                self.u8(6);
                self.text(semantic_id)?;
            }
            BoundedFeatureConstantValueV1::TargetVariantV1 { semantic_id } => {
                self.u8(7);
                self.text(semantic_id)?;
            }
            BoundedFeatureConstantValueV1::ProtectionVariantV1 { semantic_id } => {
                self.u8(8);
                self.text(semantic_id)?;
            }
        }
        Ok(())
    }
    fn value_ref(
        &mut self,
        value: &BoundedFeatureValueRefV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureValueRefV1::InputValue { input_role_id } => {
                self.u8(1);
                self.text(input_role_id)?;
            }
            BoundedFeatureValueRefV1::InputCoordinate { input_role_id } => {
                self.u8(2);
                self.text(input_role_id)?;
            }
            BoundedFeatureValueRefV1::Constant { constant_id } => {
                self.u8(3);
                self.text(constant_id)?;
            }
            BoundedFeatureValueRefV1::PriorState { state_id } => {
                self.u8(4);
                self.text(state_id)?;
            }
            BoundedFeatureValueRefV1::NodeOutput { node_id, port_id } => {
                self.u8(5);
                self.text(node_id)?;
                self.text(port_id)?;
            }
        }
        Ok(())
    }
    fn initial(
        &mut self,
        value: &BoundedFeatureInitialStateV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureInitialStateV1::CanonicalEmpty => self.u8(1),
            BoundedFeatureInitialStateV1::Constant { constant_id } => {
                self.u8(2);
                self.text(constant_id)?;
            }
        }
        Ok(())
    }
    fn state_kind(
        &mut self,
        value: &BoundedFeatureStateKindV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureStateKindV1::Primitive => self.u8(1),
            BoundedFeatureStateKindV1::Strategy {
                value_type,
                source_port_id,
            } => {
                self.u8(2);
                self.value_type(value_type)?;
                self.text(source_port_id)?;
            }
        }
        Ok(())
    }
    fn terminal_conversion(
        &mut self,
        value: &BoundedFeatureTerminalConversionV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        match value {
            BoundedFeatureTerminalConversionV1::Exact => self.u8(0),
            BoundedFeatureTerminalConversionV1::FixedCoefficientToI32 { unit, scale } => {
                self.u8(1);
                self.text(unit)?;
                self.u8(*scale);
            }
            BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 { unit, scale } => {
                self.u8(2);
                self.text(unit)?;
                self.u8(*scale);
            }
            BoundedFeatureTerminalConversionV1::FixedCoefficientToU64 { unit, scale } => {
                self.u8(3);
                self.text(unit)?;
                self.u8(*scale);
            }
        }
        Ok(())
    }
    fn parameters(&mut self, value: &BoundedFeatureParametersV1) {
        let rounding = |writer: &mut Self, value: BoundedFeatureRoundingV1| writer.u8(value.tag());
        let optional_rounding = |writer: &mut Self, value: Option<BoundedFeatureRoundingV1>| {
            writer.boolean(value.is_some());
            if let Some(value) = value {
                writer.u8(value.tag());
            }
        };
        match value {
            BoundedFeatureParametersV1::None => self.u8(0),
            BoundedFeatureParametersV1::OutputScale {
                output_scale,
                rounding: mode,
            } => {
                self.u8(1);
                self.u8(*output_scale);
                rounding(self, *mode);
            }
            BoundedFeatureParametersV1::ComparisonPredicate { predicate } => {
                self.u8(2);
                self.u8(match predicate {
                    BoundedFeaturePredicateV1::Less => 1,
                    BoundedFeaturePredicateV1::LessOrEqual => 2,
                    BoundedFeaturePredicateV1::Equal => 3,
                    BoundedFeaturePredicateV1::NotEqual => 4,
                    BoundedFeaturePredicateV1::GreaterOrEqual => 5,
                    BoundedFeaturePredicateV1::Greater => 6,
                });
            }
            BoundedFeatureParametersV1::Period {
                period,
                rounding: mode,
            } => {
                self.u8(3);
                self.u32(*period);
                optional_rounding(self, *mode);
            }
            BoundedFeatureParametersV1::Window {
                window,
                rounding: mode,
            } => {
                self.u8(4);
                self.u32(*window);
                optional_rounding(self, *mode);
            }
            BoundedFeatureParametersV1::Lag {
                offset,
                declared_max_lag,
            } => {
                self.u8(5);
                self.u32(*offset);
                self.u32(*declared_max_lag);
            }
            BoundedFeatureParametersV1::RangeFraction {
                numerator,
                denominator,
                output_scale,
                rounding: mode,
            } => {
                self.u8(6);
                self.u32(*numerator);
                self.u32(*denominator);
                self.u8(*output_scale);
                rounding(self, *mode);
            }
            BoundedFeatureParametersV1::PeriodAndOutputScale {
                period,
                output_scale,
                rounding: mode,
            } => {
                self.u8(7);
                self.u32(*period);
                self.u8(*output_scale);
                rounding(self, *mode);
            }
            BoundedFeatureParametersV1::WindowAndOutputScale {
                window,
                output_scale,
                rounding: mode,
            } => {
                self.u8(8);
                self.u32(*window);
                self.u8(*output_scale);
                optional_rounding(self, *mode);
            }
        }
    }
    fn bounds(&mut self, value: &BoundedFeatureBoundsV1) {
        for field in [
            value.max_nodes,
            value.max_edges,
            value.max_depth,
            value.max_ports,
            value.max_constants,
            value.max_fan_out,
            value.max_state_cells,
            value.max_decision_branches,
            value.max_invocations_per_event,
        ] {
            self.u16(field);
        }
        for field in [
            value.max_lag,
            value.max_window,
            value.max_state_bytes,
            value.max_source_bytes,
            value.max_wasm_bytes,
            value.max_linear_memory_bytes,
        ] {
            self.u32(field);
        }
        self.u64(value.max_fuel);
    }
    fn proposal_frame(
        &mut self,
        frame: &BoundedFeatureProposalFrameV1,
    ) -> Result<(), BoundedFeatureProgramErrorV1> {
        self.sequence(&frame.terminal_outputs, |writer, terminal| {
            writer.text(&terminal.manifest_port_id)?;
            writer.text(&terminal.lifecycle_semantic_id)?;
            writer.value_ref(&terminal.source)?;
            writer.terminal_conversion(&terminal.conversion)
        })
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }
    fn program(mut self) -> Result<BoundedFeatureProgramProposalV1, BoundedFeatureProgramErrorV1> {
        if self.take(MAGIC.len())? != MAGIC {
            return Err(BoundedFeatureProgramErrorV1::NonCanonical);
        }
        let schema_version = self.u16()?;
        let semantic_version = self.u16()?;
        let research_request_identity = self.digest()?;
        let intent_identity = self.digest()?;
        let intent_digest = self.digest()?;
        let design_identity = self.digest()?;
        let design_digest = self.digest()?;
        let plugin_semantic_id = self.text()?;
        let plugin_manifest_digest = self.digest()?;
        let catalog_semantic_version = self.u16()?;
        let catalog_digest = self.digest()?;
        let first_party_sdk_source_digest = self.digest()?;
        let inputs = self.sequence(|decoder| {
            Ok(BoundedFeatureInputV1 {
                owner_semantic_id: decoder.text()?,
                fact_type_semantic_id: decoder.text()?,
                input_role_id: decoder.text()?,
                input_role_identity: decoder.digest()?,
                timeframe: decoder.text()?,
                unit: decoder.text()?,
                scale: decoder.u8()?,
                static_binding_receipt_digest: decoder.digest()?,
                value_port_semantic_id: decoder.text()?,
                update_clock: decoder.clock()?,
            })
        })?;
        let constants = self.sequence(|decoder| {
            Ok(BoundedFeatureConstantV1 {
                constant_id: decoder.text()?,
                value: decoder.constant()?,
            })
        })?;
        let state_cells = self.sequence(|decoder| {
            Ok(BoundedFeatureStateCellV1 {
                state_id: decoder.text()?,
                writer_node_id: decoder.text()?,
                state_kind: decoder.state_kind()?,
                initial: decoder.initial()?,
                max_bytes: decoder.u32()?,
            })
        })?;
        let nodes = self.sequence(|decoder| {
            Ok(BoundedFeatureNodeV1 {
                node_id: decoder.text()?,
                primitive_semantic_id: decoder.text()?,
                input_bindings: decoder.sequence(|decoder| {
                    Ok(BoundedFeatureInputBindingV1 {
                        port_id: decoder.text()?,
                        source: decoder.value_ref()?,
                        require_ready: decoder.boolean()?,
                    })
                })?,
                output_ports: decoder.sequence(|decoder| {
                    Ok(BoundedFeatureOutputPortV1 {
                        port_id: decoder.text()?,
                        value_type: decoder.value_type()?,
                        availability: match decoder.u8()? {
                            1 => BoundedFeatureAvailabilityV1::Ready,
                            2 => BoundedFeatureAvailabilityV1::WarmingReady,
                            _ => return Err(BoundedFeatureProgramErrorV1::NonCanonical),
                        },
                    })
                })?,
                parameters: decoder.parameters()?,
                state_id: decoder.optional_text()?,
                update_clock: decoder.optional_clock()?,
            })
        })?;
        let branches = self.sequence(|decoder| {
            Ok(BoundedFeatureProposalDecisionBranchV1 {
                priority: decoder.u16()?,
                predicate: decoder.value_ref()?,
                frame: decoder.proposal_frame()?,
            })
        })?;
        let proposal_decision_table = BoundedFeatureProposalDecisionTableV1 {
            branches,
            default_frame: self.proposal_frame()?,
        };
        let warmup = BoundedFeatureWarmupContractV1 {
            position_intent_semantic_id: self.text()?,
            target_variant_semantic_id: self.text()?,
            target_position_units: self.i64()?,
            target_weight_micros: self.i32()?,
            rebalance_sequence: self.u64()?,
            reconciliation_target_units: self.i64()?,
            protection_variant_semantic_id: self.text()?,
            stop_loss_ticks: self.i64()?,
            take_profit_ticks: self.i64()?,
            trailing_distance_ticks: self.u64()?,
            trailing_stop_ticks: self.i64()?,
            post_state: match self.u8()? {
                1 => BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent,
                _ => return Err(BoundedFeatureProgramErrorV1::NonCanonical),
            },
        };
        let bounds = self.bounds()?;
        if self.cursor != self.bytes.len() {
            return Err(BoundedFeatureProgramErrorV1::NonCanonical);
        }
        Ok(BoundedFeatureProgramProposalV1 {
            schema_version,
            semantic_version,
            research_request_identity,
            intent_identity,
            intent_digest,
            design_identity,
            design_digest,
            plugin_semantic_id,
            plugin_manifest_digest,
            catalog_semantic_version,
            catalog_digest,
            first_party_sdk_source_digest,
            inputs,
            constants,
            state_cells,
            nodes,
            proposal_decision_table,
            warmup,
            bounds,
        })
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], BoundedFeatureProgramErrorV1> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(BoundedFeatureProgramErrorV1::NonCanonical)?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or(BoundedFeatureProgramErrorV1::NonCanonical)?;
        self.cursor = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, BoundedFeatureProgramErrorV1> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, BoundedFeatureProgramErrorV1> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, BoundedFeatureProgramErrorV1> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, BoundedFeatureProgramErrorV1> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, BoundedFeatureProgramErrorV1> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, BoundedFeatureProgramErrorV1> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn i128(&mut self) -> Result<i128, BoundedFeatureProgramErrorV1> {
        Ok(i128::from_le_bytes(self.take(16)?.try_into().unwrap()))
    }
    fn boolean(&mut self) -> Result<bool, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn digest(&mut self) -> Result<BindingDigest, BoundedFeatureProgramErrorV1> {
        Ok(BindingDigest::from_untrusted_bytes(
            self.take(32)?.try_into().unwrap(),
        ))
    }
    fn text(&mut self) -> Result<String, BoundedFeatureProgramErrorV1> {
        let length = usize::from(self.u16()?);
        let bytes = self.take(length)?;
        let value = std::str::from_utf8(bytes)
            .map_err(|_| BoundedFeatureProgramErrorV1::NonCanonical)?
            .to_owned();
        valid_text(&value)?;
        Ok(value)
    }
    fn optional_text(&mut self) -> Result<Option<String>, BoundedFeatureProgramErrorV1> {
        if self.boolean()? {
            Ok(Some(self.text()?))
        } else {
            Ok(None)
        }
    }
    fn sequence<T>(
        &mut self,
        mut decode: impl FnMut(&mut Self) -> Result<T, BoundedFeatureProgramErrorV1>,
    ) -> Result<Vec<T>, BoundedFeatureProgramErrorV1> {
        let length = usize::from(self.u16()?);
        let mut values = Vec::with_capacity(length);
        for _ in 0..length {
            values.push(decode(self)?);
        }
        Ok(values)
    }
    fn clock(&mut self) -> Result<BoundedFeatureClockV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureClockV1::Trigger {
                input_role_id: self.text()?,
            }),
            2 => Ok(BoundedFeatureClockV1::Sample {
                input_role_id: self.text()?,
                source_semantic_id: self.text()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn optional_clock(
        &mut self,
    ) -> Result<Option<BoundedFeatureClockV1>, BoundedFeatureProgramErrorV1> {
        if self.boolean()? {
            Ok(Some(self.clock()?))
        } else {
            Ok(None)
        }
    }
    fn value_type(&mut self) -> Result<BoundedFeatureValueTypeV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureValueTypeV1::FixedI128 {
                unit: self.text()?,
                scale: self.u8()?,
            }),
            2 => Ok(BoundedFeatureValueTypeV1::Boolean),
            3 => Ok(BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                input_role_identity: self.digest()?,
            }),
            4 => Ok(BoundedFeatureValueTypeV1::I32),
            5 => Ok(BoundedFeatureValueTypeV1::I64),
            6 => Ok(BoundedFeatureValueTypeV1::U64),
            7 => Ok(BoundedFeatureValueTypeV1::PositionIntentV1),
            8 => Ok(BoundedFeatureValueTypeV1::TargetVariantV1),
            9 => Ok(BoundedFeatureValueTypeV1::ProtectionVariantV1),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn constant(&mut self) -> Result<BoundedFeatureConstantValueV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureConstantValueV1::FixedI128 {
                coefficient: self.i128()?,
                unit: self.text()?,
                scale: self.u8()?,
            }),
            2 => Ok(BoundedFeatureConstantValueV1::Boolean {
                value: self.boolean()?,
            }),
            3 => Ok(BoundedFeatureConstantValueV1::I32 { value: self.i32()? }),
            4 => Ok(BoundedFeatureConstantValueV1::I64 { value: self.i64()? }),
            5 => Ok(BoundedFeatureConstantValueV1::U64 { value: self.u64()? }),
            6 => Ok(BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: self.text()?,
            }),
            7 => Ok(BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: self.text()?,
            }),
            8 => Ok(BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                semantic_id: self.text()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn value_ref(&mut self) -> Result<BoundedFeatureValueRefV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureValueRefV1::InputValue {
                input_role_id: self.text()?,
            }),
            2 => Ok(BoundedFeatureValueRefV1::InputCoordinate {
                input_role_id: self.text()?,
            }),
            3 => Ok(BoundedFeatureValueRefV1::Constant {
                constant_id: self.text()?,
            }),
            4 => Ok(BoundedFeatureValueRefV1::PriorState {
                state_id: self.text()?,
            }),
            5 => Ok(BoundedFeatureValueRefV1::NodeOutput {
                node_id: self.text()?,
                port_id: self.text()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn initial(&mut self) -> Result<BoundedFeatureInitialStateV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureInitialStateV1::CanonicalEmpty),
            2 => Ok(BoundedFeatureInitialStateV1::Constant {
                constant_id: self.text()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn state_kind(&mut self) -> Result<BoundedFeatureStateKindV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureStateKindV1::Primitive),
            2 => Ok(BoundedFeatureStateKindV1::Strategy {
                value_type: self.value_type()?,
                source_port_id: self.text()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn terminal_conversion(
        &mut self,
    ) -> Result<BoundedFeatureTerminalConversionV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            0 => Ok(BoundedFeatureTerminalConversionV1::Exact),
            1 => Ok(BoundedFeatureTerminalConversionV1::FixedCoefficientToI32 {
                unit: self.text()?,
                scale: self.u8()?,
            }),
            2 => Ok(BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 {
                unit: self.text()?,
                scale: self.u8()?,
            }),
            3 => Ok(BoundedFeatureTerminalConversionV1::FixedCoefficientToU64 {
                unit: self.text()?,
                scale: self.u8()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn rounding(&mut self) -> Result<BoundedFeatureRoundingV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            1 => Ok(BoundedFeatureRoundingV1::TowardZero),
            2 => Ok(BoundedFeatureRoundingV1::NearestTiesToEven),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn optional_rounding(
        &mut self,
    ) -> Result<Option<BoundedFeatureRoundingV1>, BoundedFeatureProgramErrorV1> {
        if self.boolean()? {
            Ok(Some(self.rounding()?))
        } else {
            Ok(None)
        }
    }
    fn parameters(&mut self) -> Result<BoundedFeatureParametersV1, BoundedFeatureProgramErrorV1> {
        match self.u8()? {
            0 => Ok(BoundedFeatureParametersV1::None),
            1 => Ok(BoundedFeatureParametersV1::OutputScale {
                output_scale: self.u8()?,
                rounding: self.rounding()?,
            }),
            2 => Ok(BoundedFeatureParametersV1::ComparisonPredicate {
                predicate: match self.u8()? {
                    1 => BoundedFeaturePredicateV1::Less,
                    2 => BoundedFeaturePredicateV1::LessOrEqual,
                    3 => BoundedFeaturePredicateV1::Equal,
                    4 => BoundedFeaturePredicateV1::NotEqual,
                    5 => BoundedFeaturePredicateV1::GreaterOrEqual,
                    6 => BoundedFeaturePredicateV1::Greater,
                    _ => return Err(BoundedFeatureProgramErrorV1::NonCanonical),
                },
            }),
            3 => Ok(BoundedFeatureParametersV1::Period {
                period: self.u32()?,
                rounding: self.optional_rounding()?,
            }),
            4 => Ok(BoundedFeatureParametersV1::Window {
                window: self.u32()?,
                rounding: self.optional_rounding()?,
            }),
            5 => Ok(BoundedFeatureParametersV1::Lag {
                offset: self.u32()?,
                declared_max_lag: self.u32()?,
            }),
            6 => Ok(BoundedFeatureParametersV1::RangeFraction {
                numerator: self.u32()?,
                denominator: self.u32()?,
                output_scale: self.u8()?,
                rounding: self.rounding()?,
            }),
            7 => Ok(BoundedFeatureParametersV1::PeriodAndOutputScale {
                period: self.u32()?,
                output_scale: self.u8()?,
                rounding: self.rounding()?,
            }),
            8 => Ok(BoundedFeatureParametersV1::WindowAndOutputScale {
                window: self.u32()?,
                output_scale: self.u8()?,
                rounding: self.optional_rounding()?,
            }),
            _ => Err(BoundedFeatureProgramErrorV1::NonCanonical),
        }
    }
    fn bounds(&mut self) -> Result<BoundedFeatureBoundsV1, BoundedFeatureProgramErrorV1> {
        Ok(BoundedFeatureBoundsV1 {
            max_nodes: self.u16()?,
            max_edges: self.u16()?,
            max_depth: self.u16()?,
            max_ports: self.u16()?,
            max_constants: self.u16()?,
            max_fan_out: self.u16()?,
            max_state_cells: self.u16()?,
            max_decision_branches: self.u16()?,
            max_invocations_per_event: self.u16()?,
            max_lag: self.u32()?,
            max_window: self.u32()?,
            max_state_bytes: self.u32()?,
            max_source_bytes: self.u32()?,
            max_wasm_bytes: self.u32()?,
            max_linear_memory_bytes: self.u32()?,
            max_fuel: self.u64()?,
        })
    }
    fn proposal_frame(
        &mut self,
    ) -> Result<BoundedFeatureProposalFrameV1, BoundedFeatureProgramErrorV1> {
        Ok(BoundedFeatureProposalFrameV1 {
            terminal_outputs: self.sequence(|decoder| {
                Ok(BoundedFeatureTerminalOutputV1 {
                    manifest_port_id: decoder.text()?,
                    lifecycle_semantic_id: decoder.text()?,
                    source: decoder.value_ref()?,
                    conversion: decoder.terminal_conversion()?,
                })
            })?,
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputFactClassV2, InputRoleV2, InputScopeV2,
        LifecycleKindV2, ParameterV2, PluginStateContractV2, PortBindingV2, PortContractV2,
        ProposalWiringV2, ReactionGraphV2, ResourceBoundsV2, STRATEGY_DESIGN_SCHEMA_V2,
        StateCellV2, StateWriteV2, TypedConstantV2, ValueRefV2,
    };

    const PLUGIN: &str = "research.plugin.bfp.v1";
    const TIMER_PLUGIN: &str = "research.plugin.timer-fixture.v1";
    const INPUT: &str = "research.input.close.v1";
    const STATE: &str = "research.state.bfp.v1";
    const TIMER_STATE: &str = "research.state.timer-fixture.v1";
    const NODE: &str = "research.node.bfp.v1";
    const POST_STATE: &str = "plugin.state.post.v1";
    const OUTPUTS: [(&str, ValueTypeV2); 11] = [
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

    fn node_output(node_id: &str, port_id: &str) -> ValueRefV2 {
        ValueRefV2::NodeOutput {
            node_id: node_id.into(),
            port_id: port_id.into(),
        }
    }

    fn proposal_wiring(node_id: &str) -> ProposalWiringV2 {
        ProposalWiringV2 {
            position_intent: node_output(node_id, OUTPUTS[0].0),
            target_variant: node_output(node_id, OUTPUTS[1].0),
            target_position_units: node_output(node_id, OUTPUTS[2].0),
            target_weight_micros: node_output(node_id, OUTPUTS[3].0),
            rebalance_sequence: node_output(node_id, OUTPUTS[4].0),
            reconciliation_target_units: node_output(node_id, OUTPUTS[5].0),
            protection_variant: node_output(node_id, OUTPUTS[6].0),
            stop_loss_ticks: node_output(node_id, OUTPUTS[7].0),
            take_profit_ticks: node_output(node_id, OUTPUTS[8].0),
            trailing_distance_ticks: node_output(node_id, OUTPUTS[9].0),
            trailing_stop_ticks: node_output(node_id, OUTPUTS[10].0),
            member_target_set: None,
        }
    }

    fn design_reaction(kind: LifecycleKindV2, node_id: &str) -> ReactionGraphV2 {
        let input_role_identity = strategy_input_role_identity_v2(&InputRoleV2 {
            semantic_id: INPUT.into(),
            fact_class: InputFactClassV2::MarketData,
            instrument: "AAPL.XNAS".into(),
            scope: InputScopeV2::ExactInstrument,
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
            channel: "MARKET".into(),
            timeframe: "1M".into(),
            unit: "PRICE".into(),
            scale: 2,
            value_type: ValueTypeV2::I128,
        });
        let coordinate_port = coordinate_port_id(input_role_identity);
        let compute = ComputeNodeV2 {
            semantic_id: node_id.into(),
            plugin_semantic_id: PLUGIN.into(),
            input_bindings: vec![
                PortBindingV2 {
                    port_id: "input.close.v1".into(),
                    source: ValueRefV2::Input {
                        input_id: INPUT.into(),
                    },
                },
                PortBindingV2 {
                    port_id: coordinate_port,
                    source: ValueRefV2::OwnerSampleCoordinate {
                        input_id: INPUT.into(),
                        source_semantic_id: format!("{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({INPUT})"),
                    },
                },
            ],
            pre_state: ValueRefV2::PriorState {
                state_id: STATE.into(),
            },
            output_port_ids: OUTPUTS.iter().map(|(id, _)| (*id).to_owned()).collect(),
            post_state_port_id: POST_STATE.into(),
        };
        ReactionGraphV2 {
            kind,
            nodes: vec![compute],
            state_writes: vec![StateWriteV2 {
                state_id: STATE.into(),
                source: node_output(node_id, POST_STATE),
            }],
            proposal: Some(proposal_wiring(node_id)),
        }
    }

    fn timer_reaction() -> ReactionGraphV2 {
        let node_id = "research.node.timer-fixture.v1";
        ReactionGraphV2 {
            kind: LifecycleKindV2::Timer,
            nodes: vec![ComputeNodeV2 {
                semantic_id: node_id.into(),
                plugin_semantic_id: TIMER_PLUGIN.into(),
                input_bindings: vec![PortBindingV2 {
                    port_id: "input.timer-close.v1".into(),
                    source: ValueRefV2::Parameter {
                        parameter_id: "research.parameter.timer-close.v1".into(),
                    },
                }],
                pre_state: ValueRefV2::PriorState {
                    state_id: TIMER_STATE.into(),
                },
                output_port_ids: OUTPUTS.iter().map(|(id, _)| (*id).to_owned()).collect(),
                post_state_port_id: "timer.state.post.v1".into(),
            }],
            state_writes: vec![StateWriteV2 {
                state_id: TIMER_STATE.into(),
                source: node_output(node_id, "timer.state.post.v1"),
            }],
            proposal: Some(proposal_wiring(node_id)),
        }
    }

    fn design() -> StrategyDesignV2 {
        let input = InputRoleV2 {
            semantic_id: INPUT.into(),
            fact_class: InputFactClassV2::MarketData,
            instrument: "AAPL.XNAS".into(),
            scope: InputScopeV2::ExactInstrument,
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
            channel: "MARKET".into(),
            timeframe: "1M".into(),
            unit: "PRICE".into(),
            scale: 2,
            value_type: ValueTypeV2::I128,
        };
        let coordinate_port = coordinate_port_id(strategy_input_role_identity_v2(&input));
        let manifest = PluginManifestV2 {
            semantic_id: PLUGIN.into(),
            abi_version: BOUNDED_FEATURE_PLUGIN_ABI_V1,
            input_ports: vec![
                PortContractV2 {
                    semantic_id: "input.close.v1".into(),
                    value_type: ValueTypeV2::I128,
                    max_bytes: 16,
                },
                PortContractV2 {
                    semantic_id: coordinate_port.clone(),
                    value_type: ValueTypeV2::Bytes,
                    max_bytes: 308,
                },
            ],
            output_ports: OUTPUTS
                .iter()
                .map(|(semantic_id, value_type)| PortContractV2 {
                    semantic_id: (*semantic_id).into(),
                    value_type: *value_type,
                    max_bytes: manifest_width(*value_type).unwrap(),
                })
                .collect(),
            state: PluginStateContractV2 {
                pre_port_id: "plugin.state.pre.v1".into(),
                post_port_id: POST_STATE.into(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 4096,
            },
            capability_ids: vec!["research.bfp.v1".into()],
            max_fuel: 100_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.into(),
        };
        let timer_manifest = PluginManifestV2 {
            semantic_id: TIMER_PLUGIN.into(),
            abi_version: 2,
            input_ports: vec![PortContractV2 {
                semantic_id: "input.timer-close.v1".into(),
                value_type: ValueTypeV2::I128,
                max_bytes: 16,
            }],
            output_ports: OUTPUTS
                .iter()
                .map(|(semantic_id, value_type)| PortContractV2 {
                    semantic_id: (*semantic_id).into(),
                    value_type: *value_type,
                    max_bytes: manifest_width(*value_type).unwrap(),
                })
                .collect(),
            state: PluginStateContractV2 {
                pre_port_id: "timer.state.pre.v1".into(),
                post_port_id: "timer.state.post.v1".into(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 64,
            },
            capability_ids: vec!["research.bfp.v1".into()],
            max_fuel: 100_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".into(),
        };
        StrategyDesignV2 {
            schema_version: STRATEGY_DESIGN_SCHEMA_V2,
            research_request_identity: digest(1),
            intent_identity: digest(2),
            intent_digest: digest(3),
            inputs: vec![input],
            joins: vec![],
            parameters: vec![ParameterV2 {
                semantic_id: "research.parameter.timer-close.v1".into(),
                value_type: ValueTypeV2::I128,
                value: TypedConstantV2::I128 { value: 0 },
                unit: "PRICE".into(),
            }],
            state: vec![
                StateCellV2 {
                    semantic_id: STATE.into(),
                    value_type: ValueTypeV2::Bytes,
                    initial: TypedConstantV2::Bytes { value: vec![] },
                    max_bytes: 4096,
                },
                StateCellV2 {
                    semantic_id: TIMER_STATE.into(),
                    value_type: ValueTypeV2::Bytes,
                    initial: TypedConstantV2::Bytes { value: vec![] },
                    max_bytes: 64,
                },
            ],
            reactions: vec![
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Start,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
                design_reaction(LifecycleKindV2::Bar, NODE),
                design_reaction(LifecycleKindV2::Event, "research.node.bfp.event.v1"),
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Fill,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
                timer_reaction(),
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Stop,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
            ],
            capabilities: vec![CapabilityDeclarationV2 {
                semantic_id: "research.bfp.v1".into(),
                version: 1,
                dependencies: vec![],
            }],
            plugins: vec![manifest, timer_manifest],
            resources: ResourceBoundsV2 {
                max_inputs: 1,
                max_nodes_per_reaction: 1,
                max_dependency_edges: 256,
                max_state_bytes: 4160,
                max_plugin_calls_per_event: 1,
            },
            falsifier: "the frozen BFP cannot produce the declared lifecycle outputs".into(),
        }
    }

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn constant(id: &str, value: BoundedFeatureConstantValueV1) -> BoundedFeatureConstantV1 {
        BoundedFeatureConstantV1 {
            constant_id: id.into(),
            value,
        }
    }

    fn terminal(port: &str, lifecycle: &str, constant_id: &str) -> BoundedFeatureTerminalOutputV1 {
        BoundedFeatureTerminalOutputV1 {
            manifest_port_id: port.into(),
            lifecycle_semantic_id: lifecycle.into(),
            source: BoundedFeatureValueRefV1::Constant {
                constant_id: constant_id.into(),
            },
            conversion: BoundedFeatureTerminalConversionV1::Exact,
        }
    }

    pub(crate) fn candidate() -> (
        StrategyDesignV2,
        BoundedFeatureProgramProposalV1,
        PrimitiveCatalogV1,
    ) {
        let design = design();
        let catalog = PrimitiveCatalogV1::verify().unwrap();
        let (design_identity, design_digest) = match prepare_strategy_design_v2(&design) {
            StrategyDesignPreparationV2::Prepared {
                design_identity,
                design_digest,
            } => (design_identity, design_digest),
            other => panic!("fixture Design must prepare: {other:?}"),
        };
        let role_identity = strategy_input_role_identity_v2(&design.inputs[0]);
        let constants = vec![
            constant(
                "threshold",
                BoundedFeatureConstantValueV1::FixedI128 {
                    coefficient: 100,
                    unit: "PRICE".into(),
                    scale: 2,
                },
            ),
            constant(
                "position",
                BoundedFeatureConstantValueV1::PositionIntentV1 {
                    semantic_id: "kernel.position.enter.v1".into(),
                },
            ),
            constant(
                "target",
                BoundedFeatureConstantValueV1::TargetVariantV1 {
                    semantic_id: "kernel.target.position.v1".into(),
                },
            ),
            constant(
                "target-position",
                BoundedFeatureConstantValueV1::I64 { value: 1 },
            ),
            constant(
                "target-weight",
                BoundedFeatureConstantValueV1::I32 { value: 0 },
            ),
            constant("rebalance", BoundedFeatureConstantValueV1::U64 { value: 1 }),
            constant(
                "reconciliation",
                BoundedFeatureConstantValueV1::I64 { value: 1 },
            ),
            constant(
                "protection",
                BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                    semantic_id: "kernel.protection.replace.v1".into(),
                },
            ),
            constant(
                "stop-loss",
                BoundedFeatureConstantValueV1::I64 { value: 90 },
            ),
            constant(
                "take-profit",
                BoundedFeatureConstantValueV1::I64 { value: 120 },
            ),
            constant(
                "trailing-distance",
                BoundedFeatureConstantValueV1::U64 { value: 5 },
            ),
            constant(
                "trailing-stop",
                BoundedFeatureConstantValueV1::I64 { value: 95 },
            ),
            constant(
                "initial-condition",
                BoundedFeatureConstantValueV1::Boolean { value: false },
            ),
        ];
        let lifecycle = [
            "kernel.position.enter.v1",
            "kernel.target.position.v1",
            "kernel.target.position.v1",
            "kernel.target.weight.v1",
            "kernel.target.rebalance.v1",
            "kernel.target.position.v1",
            "kernel.protection.replace.v1",
            "kernel.protection.stop-loss.v1",
            "kernel.protection.take-profit.v1",
            "kernel.protection.trailing-adjust.v1",
            "kernel.protection.trailing-adjust.v1",
        ];
        let constant_ids = [
            "position",
            "target",
            "target-position",
            "target-weight",
            "rebalance",
            "reconciliation",
            "protection",
            "stop-loss",
            "take-profit",
            "trailing-distance",
            "trailing-stop",
        ];
        let manifest = &design.plugins[0];
        let frame = BoundedFeatureProposalFrameV1 {
            terminal_outputs: manifest
                .output_ports
                .iter()
                .zip(lifecycle)
                .zip(constant_ids)
                .map(|((port, lifecycle), constant_id)| {
                    terminal(&port.semantic_id, lifecycle, constant_id)
                })
                .rev()
                .collect(),
        };
        let proposal = BoundedFeatureProgramProposalV1 {
            schema_version: BOUNDED_FEATURE_PROGRAM_SCHEMA_V1,
            semantic_version: BOUNDED_FEATURE_PROGRAM_SEMANTIC_VERSION_V1,
            research_request_identity: design.research_request_identity,
            intent_identity: design.intent_identity,
            intent_digest: design.intent_digest,
            design_identity,
            design_digest,
            plugin_semantic_id: PLUGIN.into(),
            plugin_manifest_digest: plugin_manifest_digest(manifest),
            catalog_semantic_version: BOUNDED_FEATURE_CATALOG_SEMANTIC_VERSION_V1,
            catalog_digest: BindingDigest::from_untrusted_bytes(catalog.identity()),
            first_party_sdk_source_digest:
                crate::bounded_feature_program_lowerer_v1::first_party_bfp_sdk_source_digest_v1(),
            inputs: vec![BoundedFeatureInputV1 {
                owner_semantic_id: "market-data.owner.v1".into(),
                fact_type_semantic_id: design.inputs[0].field_semantic_id.clone(),
                input_role_id: INPUT.into(),
                input_role_identity: role_identity,
                timeframe: "1M".into(),
                unit: "PRICE".into(),
                scale: 2,
                static_binding_receipt_digest: digest(8),
                value_port_semantic_id: "input.close.v1".into(),
                update_clock: BoundedFeatureClockV1::Trigger {
                    input_role_id: INPUT.into(),
                },
            }],
            constants,
            state_cells: vec![BoundedFeatureStateCellV1 {
                state_id: "condition-state".into(),
                writer_node_id: "compare".into(),
                state_kind: BoundedFeatureStateKindV1::Strategy {
                    value_type: BoundedFeatureValueTypeV1::Boolean,
                    source_port_id: "value".into(),
                },
                initial: BoundedFeatureInitialStateV1::Constant {
                    constant_id: "initial-condition".into(),
                },
                max_bytes: 1,
            }],
            nodes: vec![BoundedFeatureNodeV1 {
                node_id: "compare".into(),
                primitive_semantic_id: "bfp.fixed-i128.compare.equal-scale.v1".into(),
                input_bindings: vec![
                    BoundedFeatureInputBindingV1 {
                        port_id: "b".into(),
                        source: BoundedFeatureValueRefV1::Constant {
                            constant_id: "threshold".into(),
                        },
                        require_ready: false,
                    },
                    BoundedFeatureInputBindingV1 {
                        port_id: "a".into(),
                        source: BoundedFeatureValueRefV1::InputValue {
                            input_role_id: INPUT.into(),
                        },
                        require_ready: false,
                    },
                ],
                output_ports: vec![BoundedFeatureOutputPortV1 {
                    port_id: "value".into(),
                    value_type: BoundedFeatureValueTypeV1::Boolean,
                    availability: BoundedFeatureAvailabilityV1::Ready,
                }],
                parameters: BoundedFeatureParametersV1::ComparisonPredicate {
                    predicate: BoundedFeaturePredicateV1::Greater,
                },
                state_id: None,
                update_clock: None,
            }],
            proposal_decision_table: BoundedFeatureProposalDecisionTableV1 {
                branches: vec![
                    BoundedFeatureProposalDecisionBranchV1 {
                        priority: 20,
                        predicate: BoundedFeatureValueRefV1::Constant {
                            constant_id: "initial-condition".into(),
                        },
                        frame: frame.clone(),
                    },
                    BoundedFeatureProposalDecisionBranchV1 {
                        priority: 10,
                        predicate: BoundedFeatureValueRefV1::NodeOutput {
                            node_id: "compare".into(),
                            port_id: "value".into(),
                        },
                        frame: frame.clone(),
                    },
                ],
                default_frame: frame,
            },
            warmup: BoundedFeatureWarmupContractV1 {
                position_intent_semantic_id: "kernel.position.hold.v1".into(),
                target_variant_semantic_id: "kernel.target.keep.v1".into(),
                target_position_units: 0,
                target_weight_micros: 0,
                rebalance_sequence: 0,
                reconciliation_target_units: 0,
                protection_variant_semantic_id: "kernel.protection.keep.v1".into(),
                stop_loss_ticks: 0,
                take_profit_ticks: 0,
                trailing_distance_ticks: 0,
                trailing_stop_ticks: 0,
                post_state: BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent,
            },
            bounds: BoundedFeatureBoundsV1 {
                max_nodes: 8,
                max_edges: 64,
                max_depth: 8,
                max_ports: 64,
                max_constants: 32,
                max_fan_out: 8,
                max_lag: 64,
                max_window: 64,
                max_state_cells: 8,
                max_decision_branches: 8,
                max_state_bytes: 4096,
                max_source_bytes: 1_048_576,
                max_wasm_bytes: 4_194_304,
                max_fuel: manifest.max_fuel,
                max_linear_memory_bytes: manifest.max_linear_memory_bytes,
                max_invocations_per_event: manifest.max_invocations_per_event,
            },
        };
        (design, proposal, catalog)
    }

    fn swing_candidate(
        primitive_semantic_id: &str,
    ) -> (
        StrategyDesignV2,
        BoundedFeatureProgramProposalV1,
        PrimitiveCatalogV1,
    ) {
        let (design, mut proposal, catalog) = candidate();
        let input_role_identity = proposal.inputs[0].input_role_identity;
        let parameters = BoundedFeatureParametersV1::Window {
            window: 2,
            rounding: None,
        };
        let state_bytes =
            expected_state_bytes(CatalogStateRuleV1::Window, &parameters, &proposal.bounds)
                .unwrap();
        proposal.state_cells.push(BoundedFeatureStateCellV1 {
            state_id: "swing-state".into(),
            writer_node_id: "swing".into(),
            state_kind: BoundedFeatureStateKindV1::Primitive,
            initial: BoundedFeatureInitialStateV1::CanonicalEmpty,
            max_bytes: state_bytes,
        });
        proposal.nodes.push(BoundedFeatureNodeV1 {
            node_id: "swing".into(),
            primitive_semantic_id: primitive_semantic_id.into(),
            input_bindings: vec![BoundedFeatureInputBindingV1 {
                port_id: "value".into(),
                source: BoundedFeatureValueRefV1::InputValue {
                    input_role_id: INPUT.into(),
                },
                require_ready: false,
            }],
            output_ports: vec![
                BoundedFeatureOutputPortV1 {
                    port_id: "coordinate".into(),
                    value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                        input_role_identity,
                    },
                    availability: BoundedFeatureAvailabilityV1::WarmingReady,
                },
                BoundedFeatureOutputPortV1 {
                    port_id: "value".into(),
                    value_type: BoundedFeatureValueTypeV1::FixedI128 {
                        unit: "PRICE".into(),
                        scale: 2,
                    },
                    availability: BoundedFeatureAvailabilityV1::WarmingReady,
                },
            ],
            parameters,
            state_id: Some("swing-state".into()),
            update_clock: Some(BoundedFeatureClockV1::Trigger {
                input_role_id: INPUT.into(),
            }),
        });
        let compare = proposal
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "compare")
            .unwrap();
        let input = compare
            .input_bindings
            .iter_mut()
            .find(|binding| binding.port_id == "a")
            .unwrap();
        input.source = BoundedFeatureValueRefV1::NodeOutput {
            node_id: "swing".into(),
            port_id: "value".into(),
        };
        input.require_ready = true;
        (design, proposal, catalog)
    }

    #[test]
    fn canonical_program_round_trips_and_reorders_schema_collections() {
        let (design, proposal, catalog) = candidate();
        let prepared = prepare_bounded_feature_program_v1(proposal, &design, catalog).unwrap();
        assert_eq!(
            prepared.program().proposal_decision_table.branches[0].priority,
            10
        );
        assert_eq!(
            prepared
                .program()
                .proposal_decision_table
                .default_frame
                .terminal_outputs[0]
                .manifest_port_id,
            "proposal.position-intent.v1"
        );
        let parsed =
            parse_bounded_feature_program_v1(prepared.canonical_bytes(), &design, catalog).unwrap();
        assert_eq!(parsed.digest(), prepared.digest());
        assert_eq!(parsed.canonical_bytes(), prepared.canonical_bytes());
    }

    #[test]
    fn canonical_decoder_rejects_trailing_bytes_and_tampered_manifest_binding() {
        let (design, proposal, catalog) = candidate();
        let prepared =
            prepare_bounded_feature_program_v1(proposal.clone(), &design, catalog).unwrap();
        let mut trailing = prepared.canonical_bytes().to_vec();
        trailing.push(0);
        assert_eq!(
            parse_bounded_feature_program_v1(&trailing, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::NonCanonical)
        );
        let mut tampered = proposal;
        tampered.plugin_manifest_digest = digest(77);
        assert_eq!(
            prepare_bounded_feature_program_v1(tampered, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Design)
        );
    }

    #[test]
    fn decision_branches_canonicalize_by_priority_and_priority_is_meaning() {
        let (design, proposal, catalog) = candidate();
        let mut reordered = proposal.clone();
        reordered.proposal_decision_table.branches.reverse();
        let canonical = prepare_bounded_feature_program_v1(proposal, &design, catalog).unwrap();
        let reordered = prepare_bounded_feature_program_v1(reordered, &design, catalog).unwrap();
        assert_eq!(canonical.canonical_bytes(), reordered.canonical_bytes());

        let (_, mut changed, _) = candidate();
        changed.proposal_decision_table.branches[0].priority = 10;
        changed.proposal_decision_table.branches[1].priority = 20;
        let changed = prepare_bounded_feature_program_v1(changed, &design, catalog).unwrap();
        assert_ne!(canonical.canonical_bytes(), changed.canonical_bytes());
    }

    #[test]
    fn decision_table_rejects_duplicate_priority_bad_predicate_and_partial_frame() {
        let (design, mut proposal, catalog) = candidate();
        proposal.proposal_decision_table.branches[1].priority = 20;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );

        let (_, mut proposal, _) = candidate();
        proposal.proposal_decision_table.branches[0].predicate =
            BoundedFeatureValueRefV1::Constant {
                constant_id: "threshold".into(),
            };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );

        let (_, mut proposal, _) = candidate();
        proposal
            .proposal_decision_table
            .default_frame
            .terminal_outputs
            .pop();
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );
    }

    #[test]
    fn state_layout_is_sorted_fixed_width_and_encodes_initial_constants() {
        let (design, mut proposal, catalog) = candidate();
        proposal.constants.push(constant(
            "initial-second",
            BoundedFeatureConstantValueV1::Boolean { value: true },
        ));
        proposal.state_cells.push(BoundedFeatureStateCellV1 {
            state_id: "a-condition-state".into(),
            writer_node_id: "compare".into(),
            state_kind: BoundedFeatureStateKindV1::Strategy {
                value_type: BoundedFeatureValueTypeV1::Boolean,
                source_port_id: "value".into(),
            },
            initial: BoundedFeatureInitialStateV1::Constant {
                constant_id: "initial-second".into(),
            },
            max_bytes: 1,
        });
        let prepared = prepare_bounded_feature_program_v1(proposal, &design, catalog).unwrap();
        let layout = prepared.state_layout();
        assert_eq!(layout.total_bytes(), 2);
        assert_eq!(layout.slots().len(), 2);
        assert_eq!(layout.slots()[0].state_id(), "a-condition-state");
        assert_eq!(layout.slots()[0].offset(), 0);
        assert_eq!(layout.slots()[0].width(), 1);
        assert_eq!(layout.slots()[0].initial_bytes(), Some(&[1][..]));
        assert_eq!(layout.slots()[1].state_id(), "condition-state");
        assert_eq!(layout.slots()[1].offset(), 1);
        assert_eq!(layout.slots()[1].initial_bytes(), Some(&[0][..]));

        let (_, mut invalid, _) = candidate();
        invalid.state_cells[0].max_bytes = 2;
        assert_eq!(
            prepare_bounded_feature_program_v1(invalid, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::State)
        );

        assert_eq!(
            strategy_state_width(&BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                input_role_identity: digest(9),
            }),
            Some(308)
        );
        assert_eq!(
            strategy_state_width(&BoundedFeatureValueTypeV1::PositionIntentV1),
            None
        );

        let (_, mut empty, _) = candidate();
        empty.state_cells.clear();
        let empty = prepare_bounded_feature_program_v1(empty, &design, catalog).unwrap();
        assert_eq!(empty.state_layout().total_bytes(), 0);
        assert!(empty.state_layout().slots().is_empty());
    }

    #[test]
    fn decision_sources_count_toward_edges_and_fanout() {
        let (design, mut proposal, catalog) = candidate();
        proposal.bounds.max_edges = 36;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Bounds)
        );

        let (_, mut proposal, _) = candidate();
        proposal.bounds.max_fan_out = 2;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Bounds)
        );
    }

    #[test]
    fn caller_cannot_forge_sample_clock_source_or_lifecycle_constant() {
        let (design, mut proposal, catalog) = candidate();
        proposal.inputs[0].update_clock = BoundedFeatureClockV1::Sample {
            input_role_id: INPUT.into(),
            source_semantic_id: "caller.coordinate.v1".into(),
        };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Input)
        );

        let (_, mut proposal, _) = candidate();
        let BoundedFeatureConstantValueV1::PositionIntentV1 { semantic_id } = &mut proposal
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == "position")
            .unwrap()
            .value
        else {
            unreachable!()
        };
        *semantic_id = "caller.position.enter.v1".into();
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Constant)
        );
    }

    #[test]
    fn terminal_integer_conversion_is_explicit_exact_and_unit_bound() {
        let (design, mut proposal, catalog) = candidate();
        proposal
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == "target-position")
            .unwrap()
            .value = BoundedFeatureConstantValueV1::FixedI128 {
            coefficient: 1,
            unit: "TICKS".into(),
            scale: 0,
        };
        for branch in &mut proposal.proposal_decision_table.branches {
            let terminal = branch
                .frame
                .terminal_outputs
                .iter_mut()
                .find(|terminal| terminal.manifest_port_id == "proposal.target-position.v1")
                .unwrap();
            terminal.conversion = BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 {
                unit: "TICKS".into(),
                scale: 0,
            };
        }
        let terminal = proposal
            .proposal_decision_table
            .default_frame
            .terminal_outputs
            .iter_mut()
            .find(|terminal| terminal.manifest_port_id == "proposal.target-position.v1")
            .unwrap();
        terminal.conversion = BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 {
            unit: "TICKS".into(),
            scale: 0,
        };
        assert!(prepare_bounded_feature_program_v1(proposal.clone(), &design, catalog).is_ok());

        let terminal = proposal
            .proposal_decision_table
            .default_frame
            .terminal_outputs
            .iter_mut()
            .find(|terminal| terminal.manifest_port_id == "proposal.target-position.v1")
            .unwrap();
        terminal.conversion = BoundedFeatureTerminalConversionV1::FixedCoefficientToI64 {
            unit: "PRICE".into(),
            scale: 0,
        };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );
    }

    #[test]
    fn every_input_role_requires_exact_owner_coordinate_even_when_it_is_the_trigger() {
        let (mut design, proposal, catalog) = candidate();
        assert!(matches!(
            proposal.inputs[0].update_clock,
            BoundedFeatureClockV1::Trigger { .. }
        ));
        design.plugins[0]
            .input_ports
            .retain(|port| port.value_type != ValueTypeV2::Bytes);
        assert!(matches!(
            validate_inputs_and_constants(&proposal, &design, &design.plugins[0], catalog),
            Err(BoundedFeatureProgramErrorV1::Input)
        ));
    }

    #[test]
    fn warmup_contract_is_the_complete_zeroed_keep_frame_with_advanced_state() {
        let (design, mut proposal, catalog) = candidate();
        proposal.warmup.stop_loss_ticks = 1;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );

        let (design, mut proposal, catalog) = candidate();
        proposal.warmup.target_variant_semantic_id = "kernel.target.position.v1".into();
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );
    }

    #[test]
    fn lifecycle_variants_are_closed_and_manifest_widths_cover_ascii_semantics() {
        let (design, mut proposal, catalog) = candidate();
        let BoundedFeatureConstantValueV1::ProtectionVariantV1 { semantic_id } = &mut proposal
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == "protection")
            .unwrap()
            .value
        else {
            unreachable!()
        };
        *semantic_id = "kernel.protection.stop-loss.v1".into();
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Constant)
        );

        assert_eq!(
            manifest_width(ValueTypeV2::PositionIntentV1),
            Some("kernel.position.reduce.v1".len() as u32)
        );
        assert_eq!(
            manifest_width(ValueTypeV2::TargetVariantV1),
            Some("kernel.target.rebalance.v1".len() as u32)
        );
        assert_eq!(
            manifest_width(ValueTypeV2::ProtectionVariantV1),
            Some("kernel.protection.trailing-adjust.v1".len() as u32)
        );
    }

    #[test]
    fn swing_value_consumes_its_coordinate_sidecar_as_one_ready_gated_pair() {
        for primitive in [
            "bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1",
            "bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1",
        ] {
            let (design, proposal, catalog) = swing_candidate(primitive);
            let prepared = prepare_bounded_feature_program_v1(proposal, &design, catalog).unwrap();
            let swing = prepared
                .program()
                .nodes
                .iter()
                .find(|node| node.node_id == "swing")
                .unwrap();
            assert_eq!(
                swing
                    .output_ports
                    .iter()
                    .map(|port| (port.port_id.as_str(), port.availability))
                    .collect::<Vec<_>>(),
                vec![
                    ("coordinate", BoundedFeatureAvailabilityV1::WarmingReady),
                    ("value", BoundedFeatureAvailabilityV1::WarmingReady),
                ]
            );
        }
    }

    #[test]
    fn swing_pair_rejects_unguarded_value_and_independent_coordinate_references() {
        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1");
        proposal
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "compare")
            .unwrap()
            .input_bindings
            .iter_mut()
            .find(|binding| binding.port_id == "a")
            .unwrap()
            .require_ready = false;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Type)
        );

        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1");
        let input = proposal
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "compare")
            .unwrap()
            .input_bindings
            .iter_mut()
            .find(|binding| binding.port_id == "a")
            .unwrap();
        input.source = BoundedFeatureValueRefV1::NodeOutput {
            node_id: "swing".into(),
            port_id: "coordinate".into(),
        };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Type)
        );

        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1");
        proposal.proposal_decision_table.branches[0].predicate =
            BoundedFeatureValueRefV1::NodeOutput {
                node_id: "swing".into(),
                port_id: "coordinate".into(),
            };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );

        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1");
        let terminal = &mut proposal
            .proposal_decision_table
            .default_frame
            .terminal_outputs[0];
        terminal.source = BoundedFeatureValueRefV1::NodeOutput {
            node_id: "swing".into(),
            port_id: "coordinate".into(),
        };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Terminal)
        );
    }

    #[test]
    fn swing_pair_rejects_availability_mismatch_state_sink_and_unconsumed_value() {
        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1");
        proposal
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "swing")
            .unwrap()
            .output_ports[0]
            .availability = BoundedFeatureAvailabilityV1::Ready;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Type)
        );

        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1");
        let state = proposal
            .state_cells
            .iter_mut()
            .find(|state| state.state_id == "condition-state")
            .unwrap();
        state.writer_node_id = "swing".into();
        state.state_kind = BoundedFeatureStateKindV1::Strategy {
            value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                input_role_identity: proposal.inputs[0].input_role_identity,
            },
            source_port_id: "coordinate".into(),
        };
        state.max_bytes = 308;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::State)
        );

        let (design, mut proposal, catalog) =
            swing_candidate("bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1");
        let input = proposal
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "compare")
            .unwrap()
            .input_bindings
            .iter_mut()
            .find(|binding| binding.port_id == "a")
            .unwrap();
        input.source = BoundedFeatureValueRefV1::InputValue {
            input_role_id: INPUT.into(),
        };
        input.require_ready = false;
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Graph)
        );
    }

    #[test]
    fn graph_rejects_cycles_and_unconsumed_outputs_before_encoding() {
        let (design, mut proposal, catalog) = candidate();
        proposal.nodes[0].input_bindings[0].source = BoundedFeatureValueRefV1::NodeOutput {
            node_id: "compare".into(),
            port_id: "value".into(),
        };
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Graph)
        );

        let (_, mut proposal, _) = candidate();
        proposal.state_cells.clear();
        for branch in &mut proposal.proposal_decision_table.branches {
            branch.predicate = BoundedFeatureValueRefV1::Constant {
                constant_id: "initial-condition".into(),
            };
        }
        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design, catalog),
            Err(BoundedFeatureProgramErrorV1::Graph)
        );
    }
}
