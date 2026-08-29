//! Deterministic, effect-free Strategy Design V2 reaction-graph compiler.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::{ABI_VERSION, lifecycle_v1, lifecycle_v2};
#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_data::owner::{
    sealed_acceptance::SealedAcceptanceStrategyInputUniverseFrame,
    strategy_input_binding::StrategyInputUniverseSelectionReceipt,
};
use vibe_data::owner::{
    source_binding::BindingDigest, strategy_input_binding::StrategyInputBindingReceipt,
};

use crate::strategy_design_v2::*;

pub const STRATEGY_PLAN_SCHEMA_V2: u16 = 2;
const MAX_COLLECTION: usize = 64;
const MAX_EDGES: usize = 512;
const MAX_STATE_BYTES: u32 = 1_048_576;
const MAX_PLUGIN_PORT_BYTES: u32 = 65_536;
const MAX_PLUGIN_MEMORY_BYTES: u32 = 16 * 1024 * 1024;
const MAX_PLUGIN_FUEL: u64 = 10_000_000;
const MAX_PLUGIN_INVOCATIONS: u16 = 32;
const PLUGIN_ABI_V2: u16 = 2;
const PLUGIN_FAILURE_V1: &str = "strategy.plugin.failure.unsupported.v1";
const PLUGIN_EXPORT_V2: &str = "strategy.plugin.compute.v2";
const DURABLE_CODEC_MAGIC_V2: &[u8; 4] = b"RDC2";
const DURABLE_CODEC_VERSION_V2: u16 = 1;
const DURABLE_CODEC_HEADER_BYTES_V2: usize = 6;
const MAX_DURABLE_BYTES_V2: usize = 32 * 1024 * 1024;
const MAX_DURABLE_DEPTH_V2: usize = 64;
const MAX_DURABLE_NODES_V2: usize = 262_144;
const MAX_DURABLE_ITEMS_V2: usize = 262_144;
const MAX_DURABLE_COLLECTION_V2: usize = 131_072;
const MAX_DURABLE_STRING_BYTES_V2: usize = 1024 * 1024;
const MAX_DURABLE_BYTE_STRING_V2: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StrategyCompilationV2 {
    Compiled(Box<StrategyPlanV2>),
    Unsupported(CompilationIssueV2),
    NeedsResearchRefinement(CompilationIssueV2),
}

#[cfg(test)]
mod durable_codec_v2_tests {
    use rstest::rstest;

    use super::*;

    #[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
    struct Fixture {
        name: String,
        bytes: Vec<u8>,
        values: Vec<u64>,
    }

    #[rstest]
    fn durable_codec_envelope_roundtrips_normal_values() {
        let fixture = Fixture {
            name: "canonical".to_owned(),
            bytes: vec![0, 1, 2, 255],
            values: vec![256, 1024],
        };
        let bytes = durable_encode(&fixture);
        assert_eq!(bytes.get(..4), Some(DURABLE_CODEC_MAGIC_V2.as_slice()));
        assert_eq!(durable_decode::<Fixture>(&bytes), Ok(fixture));
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[rstest]
    fn durable_plan_requires_current_exact_owner_universe_evidence() {
        let design = crate::program_host_v2_tests::universe_design();
        let frame =
            vibe_data::owner::sealed_acceptance::issue_strategy_input_universe_frame().unwrap();
        let current = VerifiedStrategyInputBindingsV2::from_sealed_universe(&frame);
        let implementations = plugin_implementation_receipts_for_test(&design, 71);
        let StrategyCompilationV2::Compiled(mut plan) =
            compile_strategy_design_v2_for_universe(design, &frame, &implementations)
        else {
            panic!("Owner universe fixture compiles")
        };
        let valid_bytes = plan.durable_bytes();
        assert_eq!(
            StrategyPlanV2::parse_and_revalidate_durable(&valid_bytes, current.clone()),
            Ok((*plan).clone())
        );

        let mut reordered = (*plan).clone();
        reordered
            .universe_selection
            .as_mut()
            .unwrap()
            .members
            .swap(0, 1);
        assert!(
            StrategyPlanV2::parse_and_revalidate_durable(
                &reordered.durable_bytes(),
                current.clone(),
            )
            .is_err()
        );

        let mut changed_selection_receipt = (*plan).clone();
        changed_selection_receipt
            .universe_selection
            .as_mut()
            .unwrap()
            .selection_receipt_digest = BindingDigest::from_untrusted_bytes([97; 32]);
        assert!(
            StrategyPlanV2::parse_and_revalidate_durable(
                &changed_selection_receipt.durable_bytes(),
                current.clone(),
            )
            .is_err()
        );

        plan.universe_bindings[0].members[0].binding_digest =
            BindingDigest::from_untrusted_bytes([98; 32]);
        assert!(
            StrategyPlanV2::parse_and_revalidate_durable(&plan.durable_bytes(), current).is_err()
        );
    }

    #[rstest]
    fn durable_codec_rejects_depth_bomb_before_recursing_unboundedly() {
        let mut bytes = envelope();
        for _ in 0..=MAX_DURABLE_DEPTH_V2 {
            bytes.push(7);
            bytes.extend(1_u32.to_le_bytes());
        }
        bytes.push(0);
        assert!(DurableValueV2::decode_exact(&bytes).is_err());
    }

    #[rstest]
    fn durable_codec_rejects_huge_declared_collection_before_allocation() {
        let mut bytes = envelope();
        bytes.push(7);
        bytes.extend(u32::MAX.to_le_bytes());
        assert!(DurableValueV2::decode_exact(&bytes).is_err());
    }

    #[rstest]
    fn durable_codec_rejects_huge_string_and_byte_string_before_allocation() {
        for (tag, length) in [
            (6, MAX_DURABLE_STRING_BYTES_V2 + 1),
            (9, MAX_DURABLE_BYTE_STRING_V2 + 1),
        ] {
            let mut bytes = envelope();
            bytes.push(tag);
            bytes.extend(
                u32::try_from(length)
                    .expect("test budget fits u32")
                    .to_le_bytes(),
            );
            assert!(DurableValueV2::decode_exact(&bytes).is_err());
        }
    }

    #[rstest]
    fn durable_codec_rejects_node_budget_bomb() {
        let child_count = MAX_DURABLE_NODES_V2 / 2;
        let mut bytes = envelope();
        bytes.push(7);
        bytes.extend(
            u32::try_from(child_count)
                .expect("test budget fits u32")
                .to_le_bytes(),
        );

        for _ in 0..child_count {
            bytes.push(7);
            bytes.extend(1_u32.to_le_bytes());
            bytes.push(0);
        }
        assert!(DurableValueV2::decode_exact(&bytes).is_err());
    }

    #[rstest]
    fn durable_codec_rejects_magic_version_and_trailing_bytes() {
        let canonical = durable_encode(&Fixture {
            name: "v".to_owned(),
            bytes: vec![1],
            values: vec![2],
        });
        let mut bad_magic = canonical.clone();
        bad_magic[0] ^= 1;
        assert!(durable_decode::<Fixture>(&bad_magic).is_err());

        let mut bad_version = canonical.clone();
        bad_version[4..6].copy_from_slice(&(DURABLE_CODEC_VERSION_V2 + 1).to_le_bytes());
        assert!(durable_decode::<Fixture>(&bad_version).is_err());

        let mut trailing = canonical;
        trailing.push(0);
        assert!(durable_decode::<Fixture>(&trailing).is_err());
    }

    fn envelope() -> Vec<u8> {
        let mut bytes = DURABLE_CODEC_MAGIC_V2.to_vec();
        bytes.extend(DURABLE_CODEC_VERSION_V2.to_le_bytes());
        bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CompilationIssueV2 {
    pub coordinate: String,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StrategyDesignPreparationV2 {
    Prepared {
        design_identity: BindingDigest,
        design_digest: BindingDigest,
    },
    Unsupported(CompilationIssueV2),
    NeedsResearchRefinement(CompilationIssueV2),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedStrategyInputBindingsV2 {
    projections: Vec<BindingProjectionV2>,
    universe_selection: Option<UniverseSelectionProjectionV2>,
    universe_bindings: Vec<UniverseRoleBindingProjectionV2>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct UniverseMemberProjectionV2 {
    member_key: String,
    instrument: String,
}

impl UniverseMemberProjectionV2 {
    pub(crate) fn member_key(&self) -> &str {
        &self.member_key
    }
    pub(crate) fn instrument(&self) -> &str {
        &self.instrument
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct UniverseSelectionProjectionV2 {
    selection_identity: BindingDigest,
    selection_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    market_semantics_identity: BindingDigest,
    selection_receipt_digest: BindingDigest,
    members: Vec<UniverseMemberProjectionV2>,
}

impl UniverseSelectionProjectionV2 {
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    fn from_owner_receipt(receipt: &StrategyInputUniverseSelectionReceipt) -> Self {
        Self {
            selection_identity: receipt.selection_identity(),
            selection_digest: receipt.selection_digest(),
            instrument_master_digest: receipt.instrument_master_digest(),
            source_binding_lineage_root: receipt.source_binding_lineage_root(),
            market_semantics_identity: receipt.market_semantics_identity(),
            selection_receipt_digest: receipt.digest(),
            members: receipt
                .members()
                .iter()
                .map(|member| UniverseMemberProjectionV2 {
                    member_key: member.member_key().to_owned(),
                    instrument: member.instrument().to_owned(),
                })
                .collect(),
        }
    }
    pub(crate) const fn selection_identity(&self) -> BindingDigest {
        self.selection_identity
    }
    pub(crate) const fn selection_digest(&self) -> BindingDigest {
        self.selection_digest
    }
    pub(crate) const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }
    pub(crate) const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub(crate) const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub(crate) const fn selection_receipt_digest(&self) -> BindingDigest {
        self.selection_receipt_digest
    }
    pub(crate) fn members(&self) -> &[UniverseMemberProjectionV2] {
        &self.members
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct UniverseMemberBindingProjectionV2 {
    member_key: String,
    instrument: String,
    binding_digest: BindingDigest,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct UniverseRoleBindingProjectionV2 {
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
    members: Vec<UniverseMemberBindingProjectionV2>,
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
fn project_sealed_universe_bindings(
    authority: &SealedAcceptanceStrategyInputUniverseFrame,
) -> Vec<UniverseRoleBindingProjectionV2> {
    let mut projections = authority
        .role_bindings()
        .iter()
        .map(|role| UniverseRoleBindingProjectionV2 {
            research_request_identity: role.research_request_identity(),
            strategy_design_identity: role.strategy_design_identity(),
            input_role_identity: role.input_role_identity(),
            members: authority
                .values()
                .iter()
                .filter(|value| value.input_role_identity() == role.input_role_identity())
                .map(|value| UniverseMemberBindingProjectionV2 {
                    member_key: value.member_key().to_owned(),
                    instrument: value.instrument().to_owned(),
                    binding_digest: value.binding_digest(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();

    for projection in &mut projections {
        projection.members.sort();
    }
    projections.sort();
    projections
}

impl VerifiedStrategyInputBindingsV2 {
    pub(crate) fn from_owner_receipts(receipts: &[StrategyInputBindingReceipt]) -> Self {
        Self {
            projections: receipts.iter().map(project_receipt).collect(),
            universe_selection: None,
            universe_bindings: vec![],
        }
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    pub(crate) fn from_sealed_universe(
        authority: &SealedAcceptanceStrategyInputUniverseFrame,
    ) -> Self {
        Self {
            projections: vec![],
            universe_selection: Some(UniverseSelectionProjectionV2::from_owner_receipt(
                authority.selection(),
            )),
            universe_bindings: project_sealed_universe_bindings(authority),
        }
    }

    #[allow(
        dead_code,
        reason = "consumed by the crate-local Develop Composer before its durable composition root"
    )]
    pub(crate) fn receipt_digests(&self) -> Vec<BindingDigest> {
        self.projections
            .iter()
            .map(BindingProjectionV2::receipt_digest)
            .collect()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct PluginCapabilityVersionV2 {
    semantic_id: String,
    version: u16,
}

impl PluginCapabilityVersionV2 {
    pub fn semantic_id(&self) -> &str {
        &self.semantic_id
    }

    pub const fn version(&self) -> u16 {
        self.version
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct PluginImplementationReceiptV2 {
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    module_identity: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
    export_identity: String,
    abi_version: u16,
    capability_versions: Vec<PluginCapabilityVersionV2>,
    receipt_digest: BindingDigest,
}

impl PluginImplementationReceiptV2 {
    pub fn plugin_semantic_id(&self) -> &str {
        &self.plugin_semantic_id
    }

    pub const fn implementation_capsule_digest(&self) -> BindingDigest {
        self.implementation_capsule_digest
    }

    pub const fn manifest_digest(&self) -> BindingDigest {
        self.manifest_digest
    }

    pub const fn source_entry_digest(&self) -> BindingDigest {
        self.source_entry_digest
    }

    pub const fn module_digest(&self) -> BindingDigest {
        self.module_digest
    }

    pub const fn module_identity(&self) -> BindingDigest {
        self.module_identity
    }

    pub const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.verified_build_receipt_digest
    }

    pub fn export_identity(&self) -> &str {
        &self.export_identity
    }

    pub const fn abi_version(&self) -> u16 {
        self.abi_version
    }

    pub fn capability_versions(&self) -> &[PluginCapabilityVersionV2] {
        &self.capability_versions
    }

    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StrategyPlanV2 {
    schema_version: u16,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    binding_digest: BindingDigest,
    capability_closure: Vec<String>,
    primitive_abi_version: u16,
    plugin_abi_versions: Vec<u16>,
    lifecycle_schema_version: u16,
    checkpoint_schema_version: u16,
    kernel_semantics_id: String,
    resources: ResourceBoundsV2,
    canonical_design: CanonicalDesignV2,
    bindings: Vec<BindingProjectionV2>,
    universe_selection: Option<UniverseSelectionProjectionV2>,
    universe_bindings: Vec<UniverseRoleBindingProjectionV2>,
    plugin_implementations: Vec<PluginImplementationReceiptV2>,
    plugin_implementation_digest: BindingDigest,
    lowering_digest: BindingDigest,
}

impl StrategyPlanV2 {
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    pub const fn design_digest(&self) -> BindingDigest {
        self.design_digest
    }

    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    pub const fn intent_digest(&self) -> BindingDigest {
        self.intent_digest
    }

    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    pub const fn binding_digest(&self) -> BindingDigest {
        self.binding_digest
    }

    pub fn capability_closure(&self) -> &[String] {
        &self.capability_closure
    }

    pub const fn primitive_abi_version(&self) -> u16 {
        self.primitive_abi_version
    }

    pub fn plugin_abi_versions(&self) -> &[u16] {
        &self.plugin_abi_versions
    }

    pub const fn lifecycle_schema_version(&self) -> u16 {
        self.lifecycle_schema_version
    }

    pub const fn checkpoint_schema_version(&self) -> u16 {
        self.checkpoint_schema_version
    }

    pub fn kernel_semantics_id(&self) -> &str {
        &self.kernel_semantics_id
    }

    pub const fn resources(&self) -> &ResourceBoundsV2 {
        &self.resources
    }

    pub fn input_roles(&self) -> &[InputRoleV2] {
        &self.canonical_design.inputs
    }

    pub(crate) fn universe_selection(&self) -> Option<&UniverseSelectionProjectionV2> {
        self.universe_selection.as_ref()
    }

    pub(crate) fn universe_binding_digest(
        &self,
        input_role_identity: BindingDigest,
        member_key: &str,
        instrument: &str,
    ) -> Option<BindingDigest> {
        self.universe_bindings
            .iter()
            .find(|role| role.input_role_identity == input_role_identity)
            .and_then(|role| {
                role.members.iter().find(|member| {
                    member.member_key == member_key && member.instrument == instrument
                })
            })
            .map(|member| member.binding_digest)
    }

    pub(crate) fn input_bindings(&self) -> &[BindingProjectionV2] {
        &self.bindings
    }

    pub fn reactions(&self) -> &[ReactionGraphV2] {
        &self.canonical_design.reactions
    }

    pub fn canonical_plugin_manifests(&self) -> &[PluginManifestV2] {
        &self.canonical_design.plugins
    }

    pub fn plugin_implementations(&self) -> &[PluginImplementationReceiptV2] {
        &self.plugin_implementations
    }

    pub const fn plugin_implementation_digest(&self) -> BindingDigest {
        self.plugin_implementation_digest
    }

    pub const fn lowering_digest(&self) -> BindingDigest {
        self.lowering_digest
    }

    pub fn contains_capability(&self, semantic_id: &str) -> bool {
        self.capability_closure
            .binary_search_by(|value| value.as_str().cmp(semantic_id))
            .is_ok()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("StrategyPlanV2 contains only infallible values")
    }

    pub fn canonical_plan_digest(&self) -> BindingDigest {
        digest(b"strategy.plan.canonical.v2\0", &self.canonical_bytes())
    }

    /// Canonical private durable representation. JSON remains a read-only projection.
    pub(crate) fn durable_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    /// Strictly parses and recompiles a durable Plan without trusting stored derived fields.
    pub(crate) fn parse_and_revalidate_durable(
        bytes: &[u8],
        current_bindings: VerifiedStrategyInputBindingsV2,
    ) -> Result<Self, String> {
        let decoded = durable_decode_plan(bytes)?;
        if decoded.durable_bytes() != bytes {
            return Err("canonical Plan bytes are not the unique durable encoding".to_owned());
        }
        let canonical = canonicalize(decoded.canonical_design.clone().into_design())
            .map_err(|_| "canonical Plan Design no longer validates".to_owned())?;
        let design_bytes =
            serde_json::to_vec(&canonical).expect("canonical Design serialization remains total");
        let design_digest = digest(b"strategy.design.v2\0", &design_bytes);
        let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
        let rebuilt = match compile_canonical(
            canonical,
            design_identity,
            design_digest,
            current_bindings.projections,
            current_bindings.universe_selection,
            current_bindings.universe_bindings,
            decoded.plugin_implementations.clone(),
        ) {
            StrategyCompilationV2::Compiled(plan) => *plan,
            _ => return Err("canonical Plan failed compiler revalidation".to_owned()),
        };

        if rebuilt != decoded {
            return Err("canonical Plan derived fields do not match recompilation".to_owned());
        }
        Ok(decoded)
    }

    pub(crate) fn canonical_design_durable_bytes(&self) -> Vec<u8> {
        durable_encode(&self.canonical_design)
    }
}

pub(crate) fn durable_encode(value: &impl Serialize) -> Vec<u8> {
    let value = serde_json::to_value(value).expect("durable value serialization is total");
    let mut bytes = Vec::with_capacity(DURABLE_CODEC_HEADER_BYTES_V2 + 256);
    bytes.extend(DURABLE_CODEC_MAGIC_V2);
    bytes.extend(DURABLE_CODEC_VERSION_V2.to_le_bytes());
    DurableValueV2::from_json(value).encode_to(&mut bytes);
    assert!(
        bytes.len() <= MAX_DURABLE_BYTES_V2,
        "bounded Strategy V2 durable value exceeds codec budget"
    );
    bytes
}

fn durable_decode_plan(bytes: &[u8]) -> Result<StrategyPlanV2, String> {
    let mut value = DurableValueV2::decode_exact(bytes)?;
    let mut i128_constants = BTreeMap::new();
    value.replace_i128_constants(&mut i128_constants)?;
    let json = serde_json::to_vec(&value.into_json()?)
        .map_err(|e| format!("canonical typed bridge encode failed: {e}"))?;
    let mut plan: StrategyPlanV2 =
        serde_json::from_slice(&json).map_err(|e| format!("canonical typed decode failed: {e}"))?;

    for parameter in &mut plan.canonical_design.parameters {
        if let Some(value) = i128_constants.remove(parameter.semantic_id.as_str()) {
            parameter.value = TypedConstantV2::I128 { value };
        }
    }

    for state in &mut plan.canonical_design.state {
        if let Some(value) = i128_constants.remove(state.semantic_id.as_str()) {
            state.initial = TypedConstantV2::I128 { value };
        }
    }

    if !i128_constants.is_empty() {
        return Err(
            "durable i128 constant did not bind a canonical parameter or state cell".to_owned(),
        );
    }
    Ok(plan)
}

pub(crate) fn durable_decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    let value = DurableValueV2::decode_exact(bytes)?;
    let json = serde_json::to_vec(&value.into_json()?)
        .map_err(|e| format!("canonical typed bridge encode failed: {e}"))?;
    serde_json::from_slice(&json).map_err(|e| format!("canonical typed decode failed: {e}"))
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DurableValueV2 {
    Null,
    Bool(bool),
    I64(i64),
    U64(u64),
    I128([u8; 16]),
    String(String),
    Bytes(Vec<u8>),
    Array(Vec<Self>),
    Object(Vec<(String, Self)>),
}

impl DurableValueV2 {
    fn encode_to(&self, bytes: &mut Vec<u8>) {
        match self {
            Self::Null => bytes.push(0),
            Self::Bool(false) => bytes.push(1),
            Self::Bool(true) => bytes.push(2),
            Self::I64(value) => {
                bytes.push(3);
                bytes.extend(value.to_le_bytes());
            }
            Self::U64(value) => {
                bytes.push(4);
                bytes.extend(value.to_le_bytes());
            }
            Self::I128(value) => {
                bytes.push(5);
                bytes.extend(value);
            }
            Self::String(value) => {
                bytes.push(6);
                encode_len(bytes, value.len());
                bytes.extend(value.as_bytes());
            }
            Self::Bytes(value) => {
                bytes.push(9);
                encode_len(bytes, value.len());
                bytes.extend(value);
            }
            Self::Array(values) => {
                bytes.push(7);
                encode_len(bytes, values.len());
                for value in values {
                    value.encode_to(bytes);
                }
            }
            Self::Object(values) => {
                bytes.push(8);
                encode_len(bytes, values.len());
                for (key, value) in values {
                    encode_len(bytes, key.len());
                    bytes.extend(key.as_bytes());
                    value.encode_to(bytes);
                }
            }
        }
    }

    fn decode_exact(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_DURABLE_BYTES_V2 {
            return Err("canonical durable bytes exceed the total byte budget".to_owned());
        }

        if bytes.len() < DURABLE_CODEC_HEADER_BYTES_V2
            || bytes.get(..DURABLE_CODEC_MAGIC_V2.len()) != Some(DURABLE_CODEC_MAGIC_V2)
        {
            return Err("canonical durable codec magic mismatch".to_owned());
        }
        let version = u16::from_le_bytes(
            bytes[4..6]
                .try_into()
                .map_err(|_| "canonical durable codec header is truncated".to_owned())?,
        );

        if version != DURABLE_CODEC_VERSION_V2 {
            return Err("canonical durable codec version mismatch".to_owned());
        }
        let mut cursor = DURABLE_CODEC_HEADER_BYTES_V2;
        let mut budget = DurableDecodeBudgetV2::default();
        let value = Self::decode(bytes, &mut cursor, 0, &mut budget)?;
        if cursor != bytes.len() {
            return Err("canonical durable bytes contain trailing data".to_owned());
        }
        let mut canonical = Vec::with_capacity(bytes.len());
        canonical.extend(DURABLE_CODEC_MAGIC_V2);
        canonical.extend(DURABLE_CODEC_VERSION_V2.to_le_bytes());
        value.encode_to(&mut canonical);
        if canonical != bytes {
            return Err("canonical durable bytes are not the unique encoding".to_owned());
        }
        Ok(value)
    }

    fn decode(
        bytes: &[u8],
        cursor: &mut usize,
        depth: usize,
        budget: &mut DurableDecodeBudgetV2,
    ) -> Result<Self, String> {
        if depth > MAX_DURABLE_DEPTH_V2 {
            return Err("canonical durable nesting exceeds the depth budget".to_owned());
        }
        budget.consume_node()?;
        let tag = read_exact(bytes, cursor, 1)?[0];
        Ok(match tag {
            0 => Self::Null,
            1 => Self::Bool(false),
            2 => Self::Bool(true),
            3 => Self::I64(i64::from_le_bytes(read_array(bytes, cursor)?)),
            4 => Self::U64(u64::from_le_bytes(read_array(bytes, cursor)?)),
            5 => Self::I128(read_array(bytes, cursor)?),
            6 => Self::String(read_string(bytes, cursor)?),
            7 => {
                let length = read_collection_len(bytes, cursor)?;
                budget.consume_items(length)?;
                let mut values = Vec::with_capacity(length);
                for _ in 0..length {
                    values.push(Self::decode(bytes, cursor, depth + 1, budget)?);
                }
                Self::Array(values)
            }
            8 => {
                let length = read_collection_len(bytes, cursor)?;
                budget.consume_items(length)?;
                let mut values = Vec::with_capacity(length);
                for _ in 0..length {
                    values.push((
                        read_string(bytes, cursor)?,
                        Self::decode(bytes, cursor, depth + 1, budget)?,
                    ));
                }

                if values.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
                    return Err("canonical durable object keys are not strictly ordered".to_owned());
                }
                Self::Object(values)
            }
            9 => Self::Bytes(read_byte_string(bytes, cursor)?),
            _ => return Err("canonical durable bytes contain an unknown tag".to_owned()),
        })
    }

    fn from_json(value: serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(value) => Self::Bool(value),
            serde_json::Value::Number(value) => {
                if let Some(value) = value.as_i64() {
                    Self::I64(value)
                } else if let Some(value) = value.as_u64() {
                    Self::U64(value)
                } else {
                    let value = value
                        .to_string()
                        .parse::<i128>()
                        .expect("Strategy V2 contains no floating-point values");
                    Self::I128(value.to_le_bytes())
                }
            }
            serde_json::Value::String(value) => Self::String(value),
            serde_json::Value::Array(values) => {
                let bytes = values
                    .iter()
                    .map(serde_json::Value::as_u64)
                    .map(|value| value.and_then(|value| u8::try_from(value).ok()))
                    .collect::<Option<Vec<_>>>();
                bytes.map_or_else(
                    || Self::Array(values.into_iter().map(Self::from_json).collect()),
                    Self::Bytes,
                )
            }
            serde_json::Value::Object(values) => {
                let is_i128 =
                    values.get("kind").and_then(serde_json::Value::as_str) == Some("I128");
                Self::Object(
                    values
                        .into_iter()
                        .map(|(key, value)| {
                            if is_i128 && key == "value" {
                                let value = value
                                    .as_i64()
                                    .map(i128::from)
                                    .or_else(|| value.as_u64().map(i128::from))
                                    .unwrap_or_else(|| {
                                        value
                                            .to_string()
                                            .parse::<i128>()
                                            .expect("typed I128 constant")
                                    });
                                (key, Self::I128(value.to_le_bytes()))
                            } else {
                                (key, Self::from_json(value))
                            }
                        })
                        .collect(),
                )
            }
        }
    }

    fn replace_i128_constants(
        &mut self,
        constants: &mut BTreeMap<String, i128>,
    ) -> Result<(), String> {
        match self {
            Self::Array(values) => {
                for value in values {
                    value.replace_i128_constants(constants)?;
                }
            }
            Self::Object(values) => {
                let semantic_id = values.iter().find_map(|(key, value)| {
                    if key == "semantic_id" {
                        match value {
                            Self::String(value) => Some(value.clone()),
                            _ => None,
                        }
                    } else {
                        None
                    }
                });

                for (key, value) in values.iter_mut() {
                    if matches!(key.as_str(), "value" | "initial")
                        && let Self::Object(constant) = value
                    {
                        let is_i128 = constant.iter().any(|(key, value)| {
                            key == "kind" && matches!(value, Self::String(kind) if kind == "I128")
                        });

                        if is_i128 {
                            let identity = semantic_id.clone().ok_or_else(|| {
                                "durable I128 constant has no semantic identity".to_owned()
                            })?;
                            let encoded = constant
                                .iter_mut()
                                .find(|(key, _)| key == "value")
                                .ok_or_else(|| "durable I128 constant has no value".to_owned())?;
                            let Self::I128(bytes) = encoded.1 else {
                                return Err("durable I128 constant encoding mismatch".to_owned());
                            };

                            if constants
                                .insert(identity, i128::from_le_bytes(bytes))
                                .is_some()
                            {
                                return Err("duplicate durable I128 semantic identity".to_owned());
                            }
                            encoded.1 = Self::I64(0);

                            if let Some((_, Self::String(kind))) =
                                constant.iter_mut().find(|(key, _)| key == "kind")
                            {
                                *kind = "I64".to_owned();
                            }
                            continue;
                        }
                    }
                    value.replace_i128_constants(constants)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn into_json(self) -> Result<serde_json::Value, String> {
        Ok(match self {
            Self::Null => serde_json::Value::Null,
            Self::Bool(value) => serde_json::Value::Bool(value),
            Self::I64(value) => serde_json::Value::Number(value.into()),
            Self::U64(value) => serde_json::Value::Number(value.into()),
            Self::I128(bytes) => serde_json::Value::Number(
                serde_json::Number::from_i128(i128::from_le_bytes(bytes)).ok_or_else(|| {
                    "durable i128 is outside the canonical JSON integer domain".to_owned()
                })?,
            ),
            Self::String(value) => serde_json::Value::String(value),
            Self::Bytes(values) => serde_json::Value::Array(
                values
                    .into_iter()
                    .map(|value| serde_json::Value::Number(value.into()))
                    .collect(),
            ),
            Self::Array(values) => serde_json::Value::Array(
                values
                    .into_iter()
                    .map(Self::into_json)
                    .collect::<Result<_, _>>()?,
            ),
            Self::Object(values) => serde_json::Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| Ok((key, value.into_json()?)))
                    .collect::<Result<_, String>>()?,
            ),
        })
    }
}

#[derive(Default)]
struct DurableDecodeBudgetV2 {
    nodes: usize,
    items: usize,
}

impl DurableDecodeBudgetV2 {
    fn consume_node(&mut self) -> Result<(), String> {
        self.nodes = self
            .nodes
            .checked_add(1)
            .ok_or_else(|| "canonical durable node budget overflow".to_owned())?;
        if self.nodes > MAX_DURABLE_NODES_V2 {
            return Err("canonical durable value exceeds the node budget".to_owned());
        }
        Ok(())
    }

    fn consume_items(&mut self, length: usize) -> Result<(), String> {
        self.items = self
            .items
            .checked_add(length)
            .ok_or_else(|| "canonical durable item budget overflow".to_owned())?;
        if self.items > MAX_DURABLE_ITEMS_V2 {
            return Err("canonical durable value exceeds the item budget".to_owned());
        }
        Ok(())
    }
}

fn encode_len(bytes: &mut Vec<u8>, length: usize) {
    let length = u32::try_from(length).expect("bounded Strategy V2 durable collection");
    bytes.extend(length.to_le_bytes());
}

fn read_len(bytes: &[u8], cursor: &mut usize) -> Result<usize, String> {
    Ok(u32::from_le_bytes(read_array(bytes, cursor)?) as usize)
}

fn read_collection_len(bytes: &[u8], cursor: &mut usize) -> Result<usize, String> {
    let length = read_len(bytes, cursor)?;
    if length > MAX_DURABLE_COLLECTION_V2 {
        return Err("canonical durable collection exceeds its length budget".to_owned());
    }

    if length > bytes.len().saturating_sub(*cursor) {
        return Err("canonical durable collection length exceeds remaining bytes".to_owned());
    }
    Ok(length)
}

fn read_string(bytes: &[u8], cursor: &mut usize) -> Result<String, String> {
    let length = read_len(bytes, cursor)?;
    if length > MAX_DURABLE_STRING_BYTES_V2 {
        return Err("canonical durable string exceeds its byte budget".to_owned());
    }
    String::from_utf8(read_exact(bytes, cursor, length)?.to_vec())
        .map_err(|_| "canonical durable string is not UTF-8".to_owned())
}

fn read_byte_string(bytes: &[u8], cursor: &mut usize) -> Result<Vec<u8>, String> {
    let length = read_len(bytes, cursor)?;
    if length > MAX_DURABLE_BYTE_STRING_V2 {
        return Err("canonical durable byte string exceeds its byte budget".to_owned());
    }
    Ok(read_exact(bytes, cursor, length)?.to_vec())
}

fn read_array<const N: usize>(bytes: &[u8], cursor: &mut usize) -> Result<[u8; N], String> {
    read_exact(bytes, cursor, N)?
        .try_into()
        .map_err(|_| "canonical durable fixed field is truncated".to_owned())
}

fn read_exact<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "canonical durable cursor overflow".to_owned())?;
    let value = bytes
        .get(*cursor..end)
        .ok_or_else(|| "canonical durable bytes are truncated".to_owned())?;
    *cursor = end;
    Ok(value)
}

#[allow(dead_code)] // Consumed by the admitted Artifact/Host successor module.
pub(crate) struct StrategyPlanExecutionViewV2<'a> {
    pub(crate) parameters: &'a [ParameterV2],
    pub(crate) initial_state: &'a [StateCellV2],
    pub(crate) reactions: &'a [ReactionGraphV2],
    pub(crate) plugin_contracts: &'a [PluginManifestV2],
    pub(crate) capability_versions: &'a [CapabilityDeclarationV2],
    pub(crate) sealed_bindings: &'a [BindingProjectionV2],
    pub(crate) plugin_implementations: &'a [PluginImplementationReceiptV2],
}

impl StrategyPlanV2 {
    #[allow(dead_code)] // Consumed by the admitted Artifact/Host successor module.
    pub(crate) fn execution_view(&self) -> StrategyPlanExecutionViewV2<'_> {
        StrategyPlanExecutionViewV2 {
            parameters: &self.canonical_design.parameters,
            initial_state: &self.canonical_design.state,
            reactions: &self.canonical_design.reactions,
            plugin_contracts: &self.canonical_design.plugins,
            capability_versions: &self.canonical_design.capabilities,
            sealed_bindings: &self.bindings,
            plugin_implementations: &self.plugin_implementations,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct CanonicalDesignV2 {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    inputs: Vec<InputRoleV2>,
    joins: Vec<InputJoinV2>,
    parameters: Vec<ParameterV2>,
    state: Vec<StateCellV2>,
    reactions: Vec<ReactionGraphV2>,
    capabilities: Vec<CapabilityDeclarationV2>,
    plugins: Vec<PluginManifestV2>,
    resources: ResourceBoundsV2,
    falsifier: String,
}

impl CanonicalDesignV2 {
    fn into_design(self) -> StrategyDesignV2 {
        StrategyDesignV2 {
            schema_version: self.schema_version,
            research_request_identity: self.research_request_identity,
            intent_identity: self.intent_identity,
            intent_digest: self.intent_digest,
            inputs: self.inputs,
            joins: self.joins,
            parameters: self.parameters,
            state: self.state,
            reactions: self.reactions,
            capabilities: self.capabilities,
            plugins: self.plugins,
            resources: self.resources,
            falsifier: self.falsifier,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub(crate) struct BindingProjectionV2 {
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
    receipt_digest: BindingDigest,
    selection_identity: BindingDigest,
    field_semantic_id: String,
    data_kind: String,
    source_binding_lineage_root: BindingDigest,
    correction_stream_identity: String,
    instrument: String,
    channel: String,
    timeframe: String,
    unit: String,
    scale: u8,
    market_semantics_identity: BindingDigest,
}

#[allow(dead_code)] // Read-only handoff to the admitted Artifact/Host successor module.
impl BindingProjectionV2 {
    pub(crate) const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub(crate) const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }

    pub(crate) const fn input_role_identity(&self) -> BindingDigest {
        self.input_role_identity
    }

    pub(crate) const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    pub(crate) fn field_semantic_id(&self) -> &str {
        &self.field_semantic_id
    }

    pub(crate) fn data_kind(&self) -> &str {
        &self.data_kind
    }

    pub(crate) const fn selection_identity(&self) -> BindingDigest {
        self.selection_identity
    }
    pub(crate) const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub(crate) fn correction_stream_identity(&self) -> &str {
        &self.correction_stream_identity
    }

    pub(crate) fn instrument(&self) -> &str {
        &self.instrument
    }

    pub(crate) fn channel(&self) -> &str {
        &self.channel
    }

    pub(crate) fn timeframe(&self) -> &str {
        &self.timeframe
    }

    pub(crate) fn unit(&self) -> &str {
        &self.unit
    }

    pub(crate) const fn scale(&self) -> u8 {
        self.scale
    }

    pub(crate) const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
}

#[derive(Serialize)]
struct LoweringProjectionV2<'a> {
    design: BindingDigest,
    bindings: BindingDigest,
    universe_selection: Option<&'a UniverseSelectionProjectionV2>,
    plugin_implementations: BindingDigest,
    capabilities: &'a [String],
    primitive_abi: u16,
    plugin_abis: &'a [u16],
    lifecycle: u16,
    checkpoint: u16,
}

#[derive(Serialize)]
struct PluginImplementationReceiptBodyV2<'a> {
    plugin_semantic_id: &'a str,
    manifest_digest: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    module_identity: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
    export_identity: &'a str,
    abi_version: u16,
    capability_versions: &'a [PluginCapabilityVersionV2],
}

#[derive(Clone, Copy)]
struct VerifiedPluginBuildDigestsV2 {
    implementation_capsule: BindingDigest,
    source_entry: BindingDigest,
    module: BindingDigest,
    build_receipt: BindingDigest,
}

#[allow(dead_code)]
pub(crate) fn issue_plugin_implementation_receipt_v2(
    plugin: &PluginManifestV2,
    capabilities: &[CapabilityDeclarationV2],
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
) -> Option<PluginImplementationReceiptV2> {
    let declared = capabilities
        .iter()
        .map(|capability| (capability.semantic_id.as_str(), capability.version))
        .collect::<BTreeMap<_, _>>();
    let versions = plugin
        .capability_ids
        .iter()
        .map(|semantic_id| {
            Some(PluginCapabilityVersionV2 {
                semantic_id: semantic_id.clone(),
                version: *declared.get(semantic_id.as_str())?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(issue_plugin_implementation_receipt(
        plugin,
        VerifiedPluginBuildDigestsV2 {
            implementation_capsule: implementation_capsule_digest,
            source_entry: source_entry_digest,
            module: module_digest,
            build_receipt: verified_build_receipt_digest,
        },
        PLUGIN_EXPORT_V2.to_owned(),
        plugin.abi_version,
        versions,
    ))
}

fn issue_plugin_implementation_receipt(
    plugin: &PluginManifestV2,
    build: VerifiedPluginBuildDigestsV2,
    export_identity: String,
    abi_version: u16,
    mut capability_versions: Vec<PluginCapabilityVersionV2>,
) -> PluginImplementationReceiptV2 {
    capability_versions.sort();
    let plugin_semantic_id = plugin.semantic_id.clone();
    let manifest_digest = plugin_manifest_digest(plugin);
    let module_identity =
        plugin_module_identity(&plugin_semantic_id, manifest_digest, build.module);
    let mut receipt = PluginImplementationReceiptV2 {
        plugin_semantic_id,
        manifest_digest,
        implementation_capsule_digest: build.implementation_capsule,
        source_entry_digest: build.source_entry,
        module_digest: build.module,
        module_identity,
        verified_build_receipt_digest: build.build_receipt,
        export_identity,
        abi_version,
        capability_versions,
        receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
    };
    receipt.receipt_digest = plugin_implementation_receipt_digest(&receipt);
    receipt
}

pub(crate) fn plugin_implementation_receipt_digest(
    receipt: &PluginImplementationReceiptV2,
) -> BindingDigest {
    let body = PluginImplementationReceiptBodyV2 {
        plugin_semantic_id: &receipt.plugin_semantic_id,
        manifest_digest: receipt.manifest_digest,
        implementation_capsule_digest: receipt.implementation_capsule_digest,
        source_entry_digest: receipt.source_entry_digest,
        module_digest: receipt.module_digest,
        module_identity: receipt.module_identity,
        verified_build_receipt_digest: receipt.verified_build_receipt_digest,
        export_identity: &receipt.export_identity,
        abi_version: receipt.abi_version,
        capability_versions: &receipt.capability_versions,
    };
    digest(
        b"strategy.plugin.implementation.receipt.v2\0",
        &serde_json::to_vec(&body).expect("implementation receipt serialization"),
    )
}

pub(crate) fn plugin_manifest_digest(plugin: &PluginManifestV2) -> BindingDigest {
    let mut canonical = plugin.clone();
    canonical.input_ports.sort();
    canonical.output_ports.sort();
    canonical.capability_ids.sort();
    digest(
        b"strategy.plugin.manifest.v2\0",
        &serde_json::to_vec(&canonical).expect("canonical plugin manifest serialization"),
    )
}

pub(crate) fn plugin_module_identity(
    plugin_semantic_id: &str,
    manifest_digest: BindingDigest,
    module_digest: BindingDigest,
) -> BindingDigest {
    let identity = (plugin_semantic_id, manifest_digest, module_digest);
    digest(
        b"strategy.plugin.module.identity.v2\0",
        &serde_json::to_vec(&identity).expect("plugin module identity serialization"),
    )
}

type OutputKey = (String, String);

struct GraphValidation<'a> {
    inputs: BTreeMap<&'a str, ValueTypeV2>,
    input_fact_classes: BTreeMap<&'a str, InputFactClassV2>,
    input_scopes: BTreeMap<&'a str, &'a InputScopeV2>,
    parameters: BTreeMap<&'a str, ValueTypeV2>,
    state: BTreeMap<&'a str, ValueTypeV2>,
    plugins: BTreeMap<&'a str, &'a PluginManifestV2>,
    node_reactions: BTreeMap<&'a str, LifecycleKindV2>,
    produced_outputs: BTreeSet<OutputKey>,
    consumed_outputs: BTreeSet<OutputKey>,
    consumed_inputs: BTreeSet<String>,
    consumed_parameters: BTreeSet<String>,
    consumed_prior_state: BTreeSet<String>,
    state_owners: BTreeMap<String, String>,
    edges: usize,
}

pub fn compile_strategy_design_v2(
    design: StrategyDesignV2,
    receipts: &[StrategyInputBindingReceipt],
    plugin_implementations: &[PluginImplementationReceiptV2],
) -> StrategyCompilationV2 {
    compile_strategy_design_v2_with_verified_bindings(
        design,
        VerifiedStrategyInputBindingsV2::from_owner_receipts(receipts),
        plugin_implementations,
    )
}

/// Compiles the fixed bounded universe vertical from its non-fabricable sealed Owner authority.
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub fn compile_strategy_design_v2_for_universe(
    design: StrategyDesignV2,
    authority: &SealedAcceptanceStrategyInputUniverseFrame,
    plugin_implementations: &[PluginImplementationReceiptV2],
) -> StrategyCompilationV2 {
    compile_strategy_design_v2_with_verified_bindings(
        design,
        VerifiedStrategyInputBindingsV2::from_sealed_universe(authority),
        plugin_implementations,
    )
}

pub(crate) fn compile_strategy_design_v2_with_verified_bindings(
    design: StrategyDesignV2,
    bindings: VerifiedStrategyInputBindingsV2,
    plugin_implementations: &[PluginImplementationReceiptV2],
) -> StrategyCompilationV2 {
    let canonical = match canonicalize(design) {
        Ok(value) => value,
        Err(result) => return result,
    };
    let design_bytes = serde_json::to_vec(&canonical).expect("canonical design serialization");
    let design_digest = digest(b"strategy.design.v2\0", &design_bytes);
    let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
    compile_canonical(
        canonical,
        design_identity,
        design_digest,
        bindings.projections,
        bindings.universe_selection,
        bindings.universe_bindings,
        plugin_implementations.to_vec(),
    )
}

/// Canonicalizes the complete graph before an Owner issues input-binding receipts.
pub fn prepare_strategy_design_v2(design: &StrategyDesignV2) -> StrategyDesignPreparationV2 {
    let canonical = match canonicalize(design.clone()) {
        Ok(value) => value,
        Err(StrategyCompilationV2::Unsupported(issue)) => {
            return StrategyDesignPreparationV2::Unsupported(issue);
        }
        Err(StrategyCompilationV2::NeedsResearchRefinement(issue)) => {
            return StrategyDesignPreparationV2::NeedsResearchRefinement(issue);
        }
        Err(StrategyCompilationV2::Compiled(_)) => unreachable!("canonicalization cannot compile"),
    };
    let bytes = serde_json::to_vec(&canonical).expect("canonical design serialization");
    let design_digest = digest(b"strategy.design.v2\0", &bytes);
    let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
    StrategyDesignPreparationV2::Prepared {
        design_identity,
        design_digest,
    }
}

/// Derives the exact typed role identity Market Data seals into its receipt.
pub fn strategy_input_role_identity_v2(input: &InputRoleV2) -> BindingDigest {
    role_identity(input)
}

fn canonicalize(mut design: StrategyDesignV2) -> Result<CanonicalDesignV2, StrategyCompilationV2> {
    if design.schema_version != STRATEGY_DESIGN_SCHEMA_V2 {
        return Err(unsupported(
            "schema_version",
            "unsupported StrategyDesign version",
        ));
    }

    if design.falsifier.trim().is_empty() {
        return Err(refinement("falsifier", "Research must freeze a falsifier"));
    }

    for (coordinate, value) in [
        ("inputs", design.inputs.len()),
        ("joins", design.joins.len()),
        ("parameters", design.parameters.len()),
        ("state", design.state.len()),
        ("reactions", design.reactions.len()),
        ("capabilities", design.capabilities.len()),
        ("plugins", design.plugins.len()),
    ] {
        if value > MAX_COLLECTION {
            return Err(unsupported(coordinate, "collection bound exceeded"));
        }
    }
    validate_resource_bounds(&design.resources)?;
    canonicalize_collections(&mut design);
    unique_by(&design.inputs, |value| &value.semantic_id, "inputs")?;
    unique_by(&design.joins, |value| &value.semantic_id, "joins")?;
    unique_by(&design.parameters, |value| &value.semantic_id, "parameters")?;
    unique_by(&design.state, |value| &value.semantic_id, "state")?;
    unique_by(
        &design.capabilities,
        |value| &value.semantic_id,
        "capabilities",
    )?;
    unique_by(&design.plugins, |value| &value.semantic_id, "plugins")?;
    validate_declarations(&design)?;
    validate_capability_closure(&design)?;
    validate_reaction_graphs(&design)?;
    Ok(CanonicalDesignV2 {
        schema_version: design.schema_version,
        research_request_identity: design.research_request_identity,
        intent_identity: design.intent_identity,
        intent_digest: design.intent_digest,
        inputs: design.inputs,
        joins: design.joins,
        parameters: design.parameters,
        state: design.state,
        reactions: design.reactions,
        capabilities: design.capabilities,
        plugins: design.plugins,
        resources: design.resources,
        falsifier: design.falsifier,
    })
}

fn canonicalize_collections(design: &mut StrategyDesignV2) {
    for join in &mut design.joins {
        join.inputs.sort();
    }

    for capability in &mut design.capabilities {
        capability.dependencies.sort();
    }

    for plugin in &mut design.plugins {
        plugin.input_ports.sort();
        plugin.output_ports.sort();
        plugin.capability_ids.sort();
    }

    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            node.input_bindings.sort();
            node.output_port_ids.sort();
        }
        reaction.state_writes.sort();
    }
    design.inputs.sort();
    design.joins.sort();
    design.parameters.sort();
    design.state.sort();
    design.reactions.sort();
    design.capabilities.sort();
    design.plugins.sort();
}

fn validate_declarations(design: &StrategyDesignV2) -> Result<(), StrategyCompilationV2> {
    if design.inputs.is_empty() {
        return Err(refinement(
            "inputs",
            "at least one typed Owner-bound input is required",
        ));
    }

    if design.inputs.len() > usize::from(design.resources.max_inputs) {
        return Err(unsupported("resources.max_inputs", "input bound exceeded"));
    }

    if design.inputs.iter().any(|input| {
        input.semantic_id.is_empty()
            || (input.scope == InputScopeV2::ExactInstrument && input.instrument.is_empty())
            || (input.scope == InputScopeV2::UniverseMembers && !input.instrument.is_empty())
            || input.field_semantic_id.is_empty()
            || input.channel.is_empty()
            || input.timeframe.is_empty()
            || input.unit.is_empty()
    }) {
        return Err(refinement(
            "inputs",
            "input roles require complete typed semantic coordinates",
        ));
    }

    if design.inputs.iter().any(|input| {
        input.fact_class == InputFactClassV2::MarketData && input.value_type != ValueTypeV2::I128
    }) {
        return Err(unsupported(
            "inputs.value_type",
            "Market Data fixed-point receipt values require the exact I128 representation",
        ));
    }
    let state_bytes = design
        .state
        .iter()
        .try_fold(0_u32, |total, cell| total.checked_add(cell.max_bytes))
        .ok_or_else(|| unsupported("state.max_bytes", "state byte sum overflow"))?;
    if state_bytes > design.resources.max_state_bytes {
        return Err(unsupported(
            "resources.max_state_bytes",
            "state cells exceed the declared bound",
        ));
    }

    for parameter in &design.parameters {
        if parameter.semantic_id.is_empty()
            || parameter.unit.is_empty()
            || parameter.value_type != parameter.value.value_type()
            || !constant_semantic_is_supported(&parameter.value)
        {
            return Err(unsupported(
                "parameters",
                "parameter identity or typed constant mismatch",
            ));
        }
    }

    for cell in &design.state {
        if cell.semantic_id.is_empty()
            || cell.max_bytes == 0
            || cell.value_type != cell.initial.value_type()
            || constant_size(&cell.initial) > cell.max_bytes
            || !constant_semantic_is_supported(&cell.initial)
        {
            return Err(unsupported(
                "state",
                "state initial value, type, or bound is invalid",
            ));
        }
    }
    validate_joins(design)?;
    for plugin in &design.plugins {
        validate_plugin_manifest(plugin)?;
    }
    Ok(())
}

fn validate_joins(design: &StrategyDesignV2) -> Result<(), StrategyCompilationV2> {
    if !design.joins.is_empty() {
        return Err(unsupported(
            "joins",
            "StrategyDesignV2 joins are not lowered by this compiler profile",
        ));
    }
    Ok(())
}

fn validate_plugin_manifest(plugin: &PluginManifestV2) -> Result<(), StrategyCompilationV2> {
    if plugin.semantic_id.is_empty()
        || plugin.abi_version != PLUGIN_ABI_V2
        || plugin.failure_semantic_id != PLUGIN_FAILURE_V1
        || plugin.input_ports.is_empty()
        || plugin.output_ports.is_empty()
        || plugin.state.pre_port_id.is_empty()
        || plugin.state.post_port_id.is_empty()
        || plugin.state.pre_port_id == plugin.state.post_port_id
        || plugin.state.max_bytes == 0
        || plugin.state.max_bytes > MAX_PLUGIN_PORT_BYTES
        || plugin.state.max_bytes < minimum_value_bytes(plugin.state.value_type)
        || plugin.max_fuel == 0
        || plugin.max_fuel > MAX_PLUGIN_FUEL
        || plugin.max_linear_memory_bytes == 0
        || plugin.max_linear_memory_bytes > MAX_PLUGIN_MEMORY_BYTES
        || plugin.max_invocations_per_event == 0
        || plugin.max_invocations_per_event > MAX_PLUGIN_INVOCATIONS
    {
        return Err(unsupported(
            &format!("plugins.{}", plugin.semantic_id),
            "plugin ABI, state, or resource contract is unsupported",
        ));
    }
    unique_by(
        &plugin.input_ports,
        |value| &value.semantic_id,
        "plugins.input_ports",
    )?;

    if plugin
        .capability_ids
        .windows(2)
        .any(|pair| pair[0] == pair[1])
    {
        return Err(unsupported(
            "plugins.capability_ids",
            "plugin capability IDs must be unique",
        ));
    }
    unique_by(
        &plugin.output_ports,
        |value| &value.semantic_id,
        "plugins.output_ports",
    )?;
    let mut all_ports = BTreeSet::new();

    for port in plugin.input_ports.iter().chain(&plugin.output_ports) {
        if port.semantic_id.is_empty()
            || port.max_bytes == 0
            || port.max_bytes > MAX_PLUGIN_PORT_BYTES
            || port.max_bytes < minimum_value_bytes(port.value_type)
            || !all_ports.insert(port.semantic_id.as_str())
        {
            return Err(unsupported(
                "plugins.ports",
                "plugin ports must be unique, named, typed, and bounded",
            ));
        }
    }

    if all_ports.contains(plugin.state.pre_port_id.as_str())
        || all_ports.contains(plugin.state.post_port_id.as_str())
    {
        return Err(unsupported(
            "plugins.state",
            "plugin state ports must be distinct from value ports",
        ));
    }
    Ok(())
}

fn validate_capability_closure(design: &StrategyDesignV2) -> Result<(), StrategyCompilationV2> {
    let graph = design
        .capabilities
        .iter()
        .map(|value| (value.semantic_id.as_str(), value.dependencies.as_slice()))
        .collect::<BTreeMap<_, _>>();

    if design
        .capabilities
        .iter()
        .any(|value| value.semantic_id.is_empty() || value.version == 0)
    {
        return Err(unsupported(
            "capabilities",
            "capabilities must have stable IDs and non-zero versions",
        ));
    }

    if design
        .capabilities
        .iter()
        .any(|value| value.dependencies.windows(2).any(|pair| pair[0] == pair[1]))
    {
        return Err(unsupported(
            "capabilities.dependencies",
            "capability dependency IDs must be unique",
        ));
    }
    validate_dag(&graph, "capabilities")?;
    let mut reachable = BTreeSet::new();
    let mut frontier = design
        .plugins
        .iter()
        .flat_map(|plugin| plugin.capability_ids.iter().map(String::as_str))
        .collect::<Vec<_>>();

    while let Some(capability) = frontier.pop() {
        if reachable.insert(capability) {
            let Some(dependencies) = graph.get(capability) else {
                return Err(unsupported(
                    "plugins.capability_ids",
                    "plugin references an undeclared capability",
                ));
            };
            frontier.extend(dependencies.iter().map(String::as_str));
        }
    }

    for plugin in &design.plugins {
        if plugin.capability_ids.is_empty()
            || plugin
                .capability_ids
                .iter()
                .any(|value| !graph.contains_key(value.as_str()))
        {
            return Err(unsupported(
                "plugins.capability_ids",
                "plugin capability closure is incomplete or undeclared",
            ));
        }
    }

    if reachable.len() != graph.len() {
        return Err(unsupported(
            "capability_closure",
            "declared capability is not reachable from a plugin manifest",
        ));
    }
    Ok(())
}

fn validate_reaction_graphs(design: &StrategyDesignV2) -> Result<(), StrategyCompilationV2> {
    let required = [
        LifecycleKindV2::Start,
        LifecycleKindV2::Bar,
        LifecycleKindV2::Event,
        LifecycleKindV2::Fill,
        LifecycleKindV2::Timer,
        LifecycleKindV2::Stop,
    ];

    if design.reactions.len() != required.len()
        || design
            .reactions
            .iter()
            .map(|value| value.kind)
            .collect::<BTreeSet<_>>()
            .len()
            != required.len()
    {
        return Err(refinement(
            "reactions",
            "START/BAR/EVENT/FILL/TIMER/STOP must each have one explicit reaction graph",
        ));
    }

    if design
        .inputs
        .iter()
        .any(|input| input.scope == InputScopeV2::UniverseMembers)
        && design.reactions.iter().any(|reaction| {
            matches!(reaction.kind, LifecycleKindV2::Bar | LifecycleKindV2::Event)
                && reaction.nodes.len() != 1
        })
    {
        return Err(unsupported(
            "reactions.nodes",
            "the bounded universe BAR/EVENT vertical requires exactly one compute node and guest invocation",
        ));
    }
    let mut node_reactions = BTreeMap::new();
    let mut used_plugins = BTreeSet::new();

    for reaction in &design.reactions {
        if reaction.nodes.len() > usize::from(design.resources.max_nodes_per_reaction)
            || reaction.nodes.len() > usize::from(design.resources.max_plugin_calls_per_event)
        {
            return Err(unsupported(
                "resources.max_nodes_per_reaction",
                "reaction node bound exceeded",
            ));
        }

        for node in &reaction.nodes {
            used_plugins.insert(node.plugin_semantic_id.as_str());
            if node.semantic_id.is_empty()
                || node_reactions
                    .insert(node.semantic_id.as_str(), reaction.kind)
                    .is_some()
            {
                return Err(unsupported(
                    "reactions.nodes",
                    "compute node IDs must be globally unique and non-empty",
                ));
            }
        }
    }

    if used_plugins.len() != design.plugins.len()
        || design
            .plugins
            .iter()
            .any(|plugin| !used_plugins.contains(plugin.semantic_id.as_str()))
    {
        return Err(unsupported(
            "plugins",
            "every plugin manifest must be consumed by a reaction compute node",
        ));
    }
    let mut validation = GraphValidation {
        inputs: design
            .inputs
            .iter()
            .map(|value| (value.semantic_id.as_str(), value.value_type))
            .collect(),
        input_fact_classes: design
            .inputs
            .iter()
            .map(|value| (value.semantic_id.as_str(), value.fact_class))
            .collect(),
        input_scopes: design
            .inputs
            .iter()
            .map(|value| (value.semantic_id.as_str(), &value.scope))
            .collect(),
        parameters: design
            .parameters
            .iter()
            .map(|value| (value.semantic_id.as_str(), value.value_type))
            .collect(),
        state: design
            .state
            .iter()
            .map(|value| (value.semantic_id.as_str(), value.value_type))
            .collect(),
        plugins: design
            .plugins
            .iter()
            .map(|value| (value.semantic_id.as_str(), value))
            .collect(),
        node_reactions,
        produced_outputs: BTreeSet::new(),
        consumed_outputs: BTreeSet::new(),
        consumed_inputs: BTreeSet::new(),
        consumed_parameters: BTreeSet::new(),
        consumed_prior_state: BTreeSet::new(),
        state_owners: BTreeMap::new(),
        edges: 0,
    };

    for reaction in &design.reactions {
        validate_reaction(reaction, &mut validation)?;
    }

    if validation.produced_outputs != validation.consumed_outputs {
        return Err(unsupported(
            "reactions.nodes.outputs",
            "every node output and post-state value must have a typed consumer",
        ));
    }

    if validation.consumed_inputs.len() != validation.inputs.len() {
        return Err(unsupported(
            "inputs",
            "every sealed Owner input must reach a compute node",
        ));
    }

    if validation.consumed_parameters.len() != validation.parameters.len() {
        return Err(unsupported(
            "parameters",
            "every declared parameter must reach a compute node",
        ));
    }

    if validation.consumed_prior_state.len() != validation.state.len()
        || validation.state_owners.len() != validation.state.len()
    {
        return Err(unsupported(
            "state",
            "every state cell requires one plugin owner and a typed PriorState-to-StateWrite back edge",
        ));
    }

    if validation.edges > usize::from(design.resources.max_dependency_edges) {
        return Err(unsupported(
            "resources.max_dependency_edges",
            "typed graph edge bound exceeded",
        ));
    }
    Ok(())
}

fn validate_reaction(
    reaction: &ReactionGraphV2,
    validation: &mut GraphValidation<'_>,
) -> Result<(), StrategyCompilationV2> {
    match reaction.kind {
        LifecycleKindV2::Bar | LifecycleKindV2::Event | LifecycleKindV2::Timer
            if reaction.proposal.is_none() =>
        {
            return Err(refinement(
                "reactions.proposal",
                "BAR/EVENT/TIMER require complete ProposalV1 wiring",
            ));
        }
        LifecycleKindV2::Start | LifecycleKindV2::Fill | LifecycleKindV2::Stop
            if reaction.proposal.is_some() =>
        {
            return Err(unsupported(
                "reactions.proposal",
                "START/FILL/STOP forbid strategy proposals",
            ));
        }
        _ => {}
    }

    if reaction.kind == LifecycleKindV2::Fill
        && (!reaction.nodes.is_empty() || !reaction.state_writes.is_empty())
    {
        return Err(unsupported(
            "reactions.FILL",
            "FILL is fixed to kernel.fill.reconcile.v1",
        ));
    }

    if matches!(
        reaction.kind,
        LifecycleKindV2::Start | LifecycleKindV2::Stop
    ) && (!reaction.nodes.is_empty() || !reaction.state_writes.is_empty())
    {
        return Err(unsupported(
            "reactions.kernel_lifecycle",
            "START/STOP are kernel-only and forbid compute nodes or state writes",
        ));
    }
    let mut visible = BTreeMap::<String, BTreeMap<String, ValueTypeV2>>::new();
    let mut nodes = BTreeMap::<String, &ComputeNodeV2>::new();
    let mut plugin_invocations = BTreeMap::<&str, u16>::new();
    for node in &reaction.nodes {
        let count = plugin_invocations
            .entry(node.plugin_semantic_id.as_str())
            .or_default();
        *count = count.saturating_add(1);
        let limit = validation
            .plugins
            .get(node.plugin_semantic_id.as_str())
            .map_or(0, |manifest| manifest.max_invocations_per_event);
        if *count > limit {
            return Err(unsupported(
                "reactions.nodes",
                "plugin invocation count exceeds its manifest bound",
            ));
        }
        validate_node(reaction.kind, node, &visible, validation)?;
        let manifest = validation.plugins[node.plugin_semantic_id.as_str()];
        let mut outputs = manifest
            .output_ports
            .iter()
            .map(|port| (port.semantic_id.clone(), port.value_type))
            .collect::<BTreeMap<_, _>>();
        outputs.insert(
            manifest.state.post_port_id.clone(),
            manifest.state.value_type,
        );

        for port in outputs.keys() {
            validation
                .produced_outputs
                .insert((node.semantic_id.clone(), port.clone()));
        }
        visible.insert(node.semantic_id.clone(), outputs);
        nodes.insert(node.semantic_id.clone(), node);
    }
    let mut written_state = BTreeSet::new();
    for write in &reaction.state_writes {
        if !written_state.insert(write.state_id.as_str()) {
            return Err(unsupported(
                "reactions.state_writes",
                "state cell has multiple writers in the same reaction",
            ));
        }
        validate_state_write(reaction.kind, write, &visible, &nodes, validation)?;
    }

    if let Some(proposal) = &reaction.proposal {
        for (field, reference, expected) in proposal.fields() {
            let actual = resolve_reference(
                reaction.kind,
                reference,
                &visible,
                validation,
                &format!("reactions.proposal.{field}"),
            )?;

            if actual != expected {
                return Err(unsupported(
                    &format!("reactions.proposal.{field}"),
                    "ProposalV1 field type mismatch",
                ));
            }
        }
    }
    Ok(())
}

fn validate_node(
    reaction: LifecycleKindV2,
    node: &ComputeNodeV2,
    visible: &BTreeMap<String, BTreeMap<String, ValueTypeV2>>,
    validation: &mut GraphValidation<'_>,
) -> Result<(), StrategyCompilationV2> {
    let manifest = validation
        .plugins
        .get(node.plugin_semantic_id.as_str())
        .copied()
        .ok_or_else(|| unsupported("reactions.nodes.plugin", "undeclared plugin compute node"))?;
    if node.input_bindings.len() != manifest.input_ports.len()
        || node.output_port_ids.len() != manifest.output_ports.len()
        || node.post_state_port_id != manifest.state.post_port_id
    {
        return Err(unsupported(
            "reactions.nodes.ports",
            "plugin call does not bind every exact manifest port",
        ));
    }

    for (binding, port) in node.input_bindings.iter().zip(&manifest.input_ports) {
        if binding.port_id != port.semantic_id {
            return Err(unsupported(
                "reactions.nodes.input_ports",
                "plugin input port is missing, duplicated, or reordered after canonicalization",
            ));
        }
        let actual = resolve_reference(
            reaction,
            &binding.source,
            visible,
            validation,
            "reactions.nodes.input",
        )?;

        if actual != port.value_type {
            return Err(unsupported(
                "reactions.nodes.input",
                "plugin input ValueType mismatch",
            ));
        }
    }
    let expected_outputs = manifest
        .output_ports
        .iter()
        .map(|port| port.semantic_id.as_str())
        .collect::<Vec<_>>();

    if node
        .output_port_ids
        .iter()
        .map(String::as_str)
        .ne(expected_outputs)
    {
        return Err(unsupported(
            "reactions.nodes.output_ports",
            "plugin output port set is incomplete or duplicated",
        ));
    }
    let pre_state = resolve_reference(
        reaction,
        &node.pre_state,
        visible,
        validation,
        "reactions.nodes.pre_state",
    )?;

    if pre_state != manifest.state.value_type {
        return Err(unsupported(
            "reactions.nodes.pre_state",
            "plugin pre-state ValueType mismatch",
        ));
    }
    Ok(())
}

fn validate_state_write(
    reaction: LifecycleKindV2,
    write: &StateWriteV2,
    visible: &BTreeMap<String, BTreeMap<String, ValueTypeV2>>,
    nodes: &BTreeMap<String, &ComputeNodeV2>,
    validation: &mut GraphValidation<'_>,
) -> Result<(), StrategyCompilationV2> {
    let expected = validation
        .state
        .get(write.state_id.as_str())
        .copied()
        .ok_or_else(|| unsupported("reactions.state_writes", "undeclared state cell"))?;
    let ValueRefV2::NodeOutput { node_id, port_id } = &write.source else {
        return Err(unsupported(
            "reactions.state_writes",
            "StateWrite must consume one plugin post-state output",
        ));
    };
    let node = nodes.get(node_id).ok_or_else(|| {
        unsupported(
            "reactions.state_writes",
            "state writer references a foreign or missing node",
        )
    })?;
    let manifest = validation.plugins[node.plugin_semantic_id.as_str()];
    if port_id != &manifest.state.post_port_id
        || node.post_state_port_id != *port_id
        || node.pre_state
            != (ValueRefV2::PriorState {
                state_id: write.state_id.clone(),
            })
    {
        return Err(unsupported(
            "reactions.state_writes",
            "only an exact PriorState/plugin-post-state/StateWrite back edge is legal",
        ));
    }
    let actual = resolve_reference(
        reaction,
        &write.source,
        visible,
        validation,
        "reactions.state_writes",
    )?;

    if actual != expected {
        return Err(unsupported(
            "reactions.state_writes",
            "state writer ValueType mismatch",
        ));
    }

    match validation.state_owners.get(write.state_id.as_str()) {
        Some(owner) if owner != &node.plugin_semantic_id => {
            return Err(unsupported(
                "reactions.state_writes",
                "state cell has a different plugin owner",
            ));
        }
        Some(_) => {}
        None => {
            validation
                .state_owners
                .insert(write.state_id.clone(), node.plugin_semantic_id.clone());
        }
    }
    Ok(())
}

fn resolve_reference(
    reaction: LifecycleKindV2,
    reference: &ValueRefV2,
    visible: &BTreeMap<String, BTreeMap<String, ValueTypeV2>>,
    validation: &mut GraphValidation<'_>,
    coordinate: &str,
) -> Result<ValueTypeV2, StrategyCompilationV2> {
    validation.edges = validation.edges.saturating_add(1);

    match reference {
        ValueRefV2::Input { input_id }
        | ValueRefV2::UniverseMemberInput {
            input_id,
            member_ordinal: _,
        } => {
            let fact_class = validation
                .input_fact_classes
                .get(input_id.as_str())
                .copied()
                .ok_or_else(|| unsupported(coordinate, "missing input authority class"))?;
            if reaction == LifecycleKindV2::Timer {
                return Err(unsupported(
                    coordinate,
                    "TIMER input authority is unavailable until a Time/Scheduler Owner contract exists",
                ));
            }

            if matches!(reaction, LifecycleKindV2::Bar | LifecycleKindV2::Event)
                && fact_class != InputFactClassV2::MarketData
            {
                return Err(unsupported(
                    coordinate,
                    "BAR/EVENT inputs require the admitted Market Data Owner frame contract",
                ));
            }
            let value_type = validation
                .inputs
                .get(input_id.as_str())
                .copied()
                .ok_or_else(|| unsupported(coordinate, "missing typed input producer"))?;

            match reference {
                ValueRefV2::Input { .. }
                    if !matches!(
                        validation.input_scopes.get(input_id.as_str()),
                        Some(InputScopeV2::ExactInstrument)
                    ) =>
                {
                    return Err(unsupported(
                        coordinate,
                        "universe-member roles require an explicit member coordinate",
                    ));
                }
                ValueRefV2::UniverseMemberInput { member_ordinal, .. }
                    if *member_ordinal >= lifecycle_v2::TARGET_SET_MEMBER_COUNT as u8
                        || validation.input_scopes.get(input_id.as_str())
                            != Some(&&InputScopeV2::UniverseMembers) =>
                {
                    return Err(unsupported(
                        coordinate,
                        "invalid universe-member input coordinate",
                    ));
                }
                _ => {}
            }
            validation.consumed_inputs.insert(input_id.clone());
            Ok(value_type)
        }
        ValueRefV2::Parameter { parameter_id } => {
            let value_type = validation
                .parameters
                .get(parameter_id.as_str())
                .copied()
                .ok_or_else(|| unsupported(coordinate, "missing typed parameter producer"))?;
            validation.consumed_parameters.insert(parameter_id.clone());
            Ok(value_type)
        }
        ValueRefV2::PriorState { state_id } => {
            let value_type = validation
                .state
                .get(state_id.as_str())
                .copied()
                .ok_or_else(|| unsupported(coordinate, "missing typed prior-state producer"))?;
            validation.consumed_prior_state.insert(state_id.clone());
            Ok(value_type)
        }
        ValueRefV2::LifecycleContext { field } => Ok(field.value_type()),
        ValueRefV2::NodeOutput { node_id, port_id } => {
            if validation.node_reactions.get(node_id.as_str()) != Some(&reaction) {
                return Err(unsupported(
                    coordinate,
                    "cross-reaction ephemeral node reference",
                ));
            }
            let value_type = visible
                .get(node_id)
                .and_then(|ports| ports.get(port_id))
                .copied()
                .ok_or_else(|| {
                    unsupported(
                        coordinate,
                        "forward, cyclic, or missing node-output reference",
                    )
                })?;
            validation
                .consumed_outputs
                .insert((node_id.clone(), port_id.clone()));
            Ok(value_type)
        }
    }
}

fn compile_canonical(
    canonical: CanonicalDesignV2,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    mut bindings: Vec<BindingProjectionV2>,
    universe_selection: Option<UniverseSelectionProjectionV2>,
    mut universe_bindings: Vec<UniverseRoleBindingProjectionV2>,
    mut plugin_implementations: Vec<PluginImplementationReceiptV2>,
) -> StrategyCompilationV2 {
    let has_exact_roles = canonical
        .inputs
        .iter()
        .any(|input| input.scope == InputScopeV2::ExactInstrument);
    let has_universe_roles = canonical
        .inputs
        .iter()
        .any(|input| input.scope == InputScopeV2::UniverseMembers);
    if has_exact_roles && has_universe_roles {
        return unsupported(
            "inputs.scope",
            "exact-instrument and universe-member roles cannot be mixed",
        );
    }

    if has_universe_roles != universe_selection.is_some() {
        return unsupported(
            "inputs.scope",
            if has_universe_roles {
                "universe-member roles require an Owner-sealed UniverseSelection receipt"
            } else {
                "an Owner-sealed UniverseSelection receipt requires universe-member roles"
            },
        );
    }
    bindings.sort();
    if bindings
        .windows(2)
        .any(|pair| pair[0].input_role_identity == pair[1].input_role_identity)
    {
        return unsupported("bindings", "duplicate Owner binding receipt");
    }
    let expected = canonical
        .inputs
        .iter()
        .map(|input| (role_identity(input), input))
        .collect::<BTreeMap<_, _>>();

    if has_exact_roles && expected.len() != bindings.len() {
        return unsupported(
            "bindings",
            "Owner receipts do not exactly cover declared inputs",
        );
    }

    if has_universe_roles && !bindings.is_empty() {
        return unsupported(
            "bindings",
            "universe-member roles do not accept singular binding receipts",
        );
    }
    universe_bindings.sort();
    if !has_universe_roles && !universe_bindings.is_empty() {
        return unsupported(
            "universe_bindings",
            "universe binding authority requires universe-member roles",
        );
    }

    if has_universe_roles {
        let Some(selection) = universe_selection.as_ref() else {
            return unsupported(
                "universe_bindings",
                "universe bindings require an Owner-sealed selection",
            );
        };
        let expected_members = selection
            .members
            .iter()
            .map(|member| (member.member_key.as_str(), member.instrument.as_str()))
            .collect::<BTreeSet<_>>();

        if universe_bindings.len() != expected.len()
            || universe_bindings
                .windows(2)
                .any(|pair| pair[0].input_role_identity == pair[1].input_role_identity)
        {
            return unsupported(
                "universe_bindings",
                "sealed Owner universe bindings do not exactly cover declared roles",
            );
        }

        for binding in &universe_bindings {
            if binding.research_request_identity != canonical.research_request_identity
                || binding.strategy_design_identity != design_identity
                || !expected.contains_key(&binding.input_role_identity)
            {
                return unsupported(
                    "universe_bindings.design_or_request_identity",
                    "sealed Owner universe binding belongs to another Design, Research request, or role",
                );
            }
            let actual_members = binding
                .members
                .iter()
                .map(|member| (member.member_key.as_str(), member.instrument.as_str()))
                .collect::<BTreeSet<_>>();

            if binding.members.len() != expected_members.len()
                || actual_members != expected_members
                || binding.members.iter().any(|member| {
                    member.binding_digest == BindingDigest::from_untrusted_bytes([0; 32])
                })
            {
                return unsupported(
                    "universe_bindings.members",
                    "sealed Owner universe bindings do not exactly cover selected member-role coordinates",
                );
            }
        }
    }
    let mut market_semantics = universe_selection
        .as_ref()
        .map(|selection| selection.market_semantics_identity);

    for binding in &bindings {
        let Some(input) = expected.get(&binding.input_role_identity) else {
            return unsupported(
                "bindings.input_role_identity",
                "receipt binds an undeclared role",
            );
        };

        if binding.research_request_identity != canonical.research_request_identity
            || binding.strategy_design_identity != design_identity
        {
            return unsupported(
                "bindings.design_or_request_identity",
                "sealed Owner receipt binds another Design or Research request",
            );
        }

        if input.fact_class != InputFactClassV2::MarketData {
            return unsupported(
                "inputs.fact_class",
                "no sealed receipt adapter exists for this Owner class",
            );
        }

        if input.scope != InputScopeV2::ExactInstrument {
            return unsupported(
                "bindings",
                "singular receipt cannot bind a universe-member role",
            );
        }

        if binding.field_semantic_id != input.field_semantic_id
            || binding.instrument != input.instrument
            || binding.channel != input.channel
            || binding.timeframe != input.timeframe
            || binding.unit != input.unit
            || binding.scale != input.scale
        {
            return unsupported(
                &format!("bindings.{}", input.semantic_id),
                "sealed Owner receipt meaning mismatch",
            );
        }

        match market_semantics {
            None => market_semantics = Some(binding.market_semantics_identity),
            Some(value) if value == binding.market_semantics_identity => {}
            Some(_) => {
                return unsupported(
                    "bindings.market_semantics_identity",
                    "mixed Market Semantics Compatibility identities",
                );
            }
        }
    }

    if has_exact_roles
        && let Err(value) = validate_binding_trigger_reachability(&canonical, &bindings)
    {
        return value;
    }
    let bound_instrument_count = bindings
        .iter()
        .map(BindingProjectionV2::instrument)
        .collect::<BTreeSet<_>>()
        .len();

    if has_exact_roles
        && (bound_instrument_count == 0
            || bound_instrument_count > lifecycle_v2::TARGET_SET_MEMBER_COUNT)
    {
        return unsupported(
            "bindings.instrument",
            "V2 currently admits one canonical instrument or the exact two-member universe vertical",
        );
    }

    if bound_instrument_count > 1 {
        return unsupported(
            "bindings.instrument",
            "multiple instruments require an Owner-sealed UniverseSelection receipt",
        );
    }

    if let Some(selection) = &universe_selection {
        let selected = selection
            .members
            .iter()
            .map(|member| member.instrument.as_str())
            .collect::<BTreeSet<_>>();

        if selection.members.len() != lifecycle_v2::TARGET_SET_MEMBER_COUNT
            || selected.len() != lifecycle_v2::TARGET_SET_MEMBER_COUNT
            || selection.market_semantics_identity == BindingDigest::from_untrusted_bytes([0; 32])
            || selection.source_binding_lineage_root == BindingDigest::from_untrusted_bytes([0; 32])
        {
            return unsupported(
                "universe_selection",
                "Owner selection does not exactly bind the Plan member set and authority cuts",
            );
        }
    }

    if let Err(value) =
        validate_universe_target_set_contract(&canonical, universe_selection.is_some())
    {
        return value;
    }
    let shared_kernel = universe_selection.is_some();
    let Some(market_semantics_identity) = market_semantics else {
        return refinement("inputs", "at least one exact Owner receipt is required");
    };
    let binding_bytes =
        serde_json::to_vec(&(&bindings, &universe_bindings)).expect("binding serialization");
    let binding_digest = digest(b"strategy.plan.bindings.v2\0", &binding_bytes);
    let plugin_implementation_digest =
        match validate_plugin_implementations(&canonical, &mut plugin_implementations) {
            Ok(value) => value,
            Err(value) => return value,
        };
    let mut capability_closure = canonical
        .capabilities
        .iter()
        .map(|value| value.semantic_id.clone())
        .collect::<Vec<_>>();
    capability_closure.extend(
        [
            lifecycle_v1::KERNEL_SEMANTICS_ID,
            lifecycle_v1::ENTER_SEMANTIC_ID,
            lifecycle_v1::ADD_SEMANTIC_ID,
            lifecycle_v1::REDUCE_SEMANTIC_ID,
            lifecycle_v1::EXIT_SEMANTIC_ID,
            lifecycle_v1::HOLD_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            lifecycle_v1::TARGET_WEIGHT_SEMANTIC_ID,
            lifecycle_v1::TARGET_REBALANCE_SEMANTIC_ID,
            lifecycle_v1::STOP_LOSS_SEMANTIC_ID,
            lifecycle_v1::TAKE_PROFIT_SEMANTIC_ID,
            lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID,
            lifecycle_v1::FILL_RECONCILE_SEMANTIC_ID,
        ]
        .into_iter()
        .map(str::to_owned),
    );

    if shared_kernel {
        capability_closure.extend(
            [
                lifecycle_v2::KERNEL_SEMANTICS_ID,
                lifecycle_v2::TARGET_SET_SEMANTIC_ID,
            ]
            .into_iter()
            .map(str::to_owned),
        );
    }
    capability_closure.sort();
    capability_closure.dedup();
    let plugin_abi_versions = canonical
        .plugins
        .iter()
        .map(|value| value.abi_version)
        .collect::<Vec<_>>();
    let lifecycle_schema_version = if shared_kernel {
        lifecycle_v2::TARGET_SET_SCHEMA_VERSION
    } else {
        lifecycle_v1::LIFECYCLE_SCHEMA_VERSION
    };
    let checkpoint_schema_version = lifecycle_schema_version;
    let kernel_semantics_id = if shared_kernel {
        lifecycle_v2::KERNEL_SEMANTICS_ID
    } else {
        lifecycle_v1::KERNEL_SEMANTICS_ID
    };
    let lowering = LoweringProjectionV2 {
        design: design_identity,
        bindings: binding_digest,
        universe_selection: universe_selection.as_ref(),
        plugin_implementations: plugin_implementation_digest,
        capabilities: &capability_closure,
        primitive_abi: ABI_VERSION,
        plugin_abis: &plugin_abi_versions,
        lifecycle: lifecycle_schema_version,
        checkpoint: checkpoint_schema_version,
    };
    let lowering_digest = digest(
        b"strategy.plan.lowering.v2\0",
        &serde_json::to_vec(&lowering).expect("lowering serialization"),
    );
    StrategyCompilationV2::Compiled(Box::new(StrategyPlanV2 {
        schema_version: STRATEGY_PLAN_SCHEMA_V2,
        design_identity,
        design_digest,
        research_request_identity: canonical.research_request_identity,
        intent_identity: canonical.intent_identity,
        intent_digest: canonical.intent_digest,
        market_semantics_identity,
        binding_digest,
        capability_closure,
        primitive_abi_version: ABI_VERSION,
        plugin_abi_versions,
        lifecycle_schema_version,
        checkpoint_schema_version,
        kernel_semantics_id: kernel_semantics_id.to_owned(),
        resources: canonical.resources.clone(),
        canonical_design: canonical,
        bindings,
        universe_selection,
        universe_bindings,
        plugin_implementations,
        plugin_implementation_digest,
        lowering_digest,
    }))
}

fn validate_universe_target_set_contract(
    design: &CanonicalDesignV2,
    is_universe: bool,
) -> Result<(), StrategyCompilationV2> {
    if is_universe {
        let fields = design
            .inputs
            .iter()
            .map(|input| input.field_semantic_id.as_str())
            .collect::<BTreeSet<_>>();

        if design.inputs.len() != 2
            || fields
                != BTreeSet::from([
                    "MARKET_DATA.BAR.OPEN.PRICE.V1",
                    "MARKET_DATA.BAR.CLOSE.PRICE.V1",
                ])
            || design.inputs.iter().any(|input| {
                input.scope != InputScopeV2::UniverseMembers
                    || input.fact_class != InputFactClassV2::MarketData
                    || input.channel != "MARKET"
                    || input.timeframe != "1D"
                    || input.unit != "PRICE"
                    || input.scale != 2
                    || input.value_type != ValueTypeV2::I128
            })
        {
            return Err(unsupported(
                "inputs.scope",
                "the current universe vertical requires exactly one fixed OPEN and one fixed CLOSE member role",
            ));
        }
    }

    for reaction in &design.reactions {
        let Some(proposal) = &reaction.proposal else {
            continue;
        };

        if proposal.member_target_set.is_some() != is_universe {
            return Err(if is_universe {
                refinement(
                    &format!("reactions.{:?}.proposal.member_target_set", reaction.kind),
                    "the exact two-member vertical requires one complete instrument target set",
                )
            } else {
                unsupported(
                    &format!("reactions.{:?}.proposal.member_target_set", reaction.kind),
                    "member target sets require the exact two-member Owner-bound universe",
                )
            });
        }

        if is_universe && matches!(reaction.kind, LifecycleKindV2::Bar | LifecycleKindV2::Event) {
            let mut coordinates = BTreeSet::new();

            for node in &reaction.nodes {
                for binding in &node.input_bindings {
                    if let ValueRefV2::UniverseMemberInput {
                        input_id,
                        member_ordinal,
                    } = &binding.source
                    {
                        coordinates.insert((input_id.as_str(), *member_ordinal));
                    }
                }
            }
            let expected = design
                .inputs
                .iter()
                .flat_map(|input| {
                    [
                        (input.semantic_id.as_str(), 0_u8),
                        (input.semantic_id.as_str(), 1_u8),
                    ]
                })
                .collect::<BTreeSet<_>>();

            if coordinates != expected {
                return Err(unsupported(
                    &format!("reactions.{:?}.inputs", reaction.kind),
                    "a universe reaction must consume every declared role for both Owner-canonical members",
                ));
            }
        }
    }
    Ok(())
}

fn validate_binding_trigger_reachability(
    design: &CanonicalDesignV2,
    bindings: &[BindingProjectionV2],
) -> Result<(), StrategyCompilationV2> {
    for reaction in &design.reactions {
        let mut input_ids = BTreeSet::new();
        let mut add = |reference: &ValueRefV2| match reference {
            ValueRefV2::Input { input_id } | ValueRefV2::UniverseMemberInput { input_id, .. } => {
                input_ids.insert(input_id.clone());
            }
            _ => {}
        };

        for node in &reaction.nodes {
            for binding in &node.input_bindings {
                add(&binding.source);
            }
            add(&node.pre_state);
        }

        for write in &reaction.state_writes {
            add(&write.source);
        }

        if let Some(proposal) = &reaction.proposal {
            for (_, reference, _) in proposal.fields() {
                add(reference);
            }
        }
        let mut selections = BTreeSet::new();
        let mut frame_anchor = None;

        for input_id in input_ids {
            let input = design
                .inputs
                .iter()
                .find(|input| input.semantic_id == input_id)
                .expect("canonical graph validation resolved every input");
            let binding = bindings
                .iter()
                .find(|binding| binding.input_role_identity == role_identity(input))
                .expect("exact binding coverage was already validated");
            if !selections.insert(binding.selection_identity()) {
                return Err(unsupported(
                    &format!("reactions.{:?}.inputs", reaction.kind),
                    "one reaction cannot consume the same static Owner selection twice",
                ));
            }
            let anchor = (
                binding.source_binding_lineage_root(),
                binding.correction_stream_identity(),
                binding.market_semantics_identity(),
            );

            if frame_anchor.is_some_and(|prior| prior != anchor) {
                return Err(unsupported(
                    &format!("reactions.{:?}.inputs", reaction.kind),
                    "one reaction must consume one common Owner frame anchor",
                ));
            }
            frame_anchor = Some(anchor);
            let owner_trigger = match binding.data_kind.as_str() {
                "BAR" => LifecycleKindV2::Bar,
                "QUOTE" | "TRADE" | "REFERENCE" | "ECONOMIC" | "SCALAR" => LifecycleKindV2::Event,
                _ => {
                    return Err(unsupported(
                        &format!("bindings.{}.data_kind", input.semantic_id),
                        "Owner data kind cannot issue an admitted runtime trigger",
                    ));
                }
            };

            if reaction.kind != owner_trigger {
                return Err(unsupported(
                    &format!("reactions.{:?}.inputs", reaction.kind),
                    "Owner data kind cannot issue this reaction trigger",
                ));
            }
        }
    }
    Ok(())
}

fn validate_plugin_implementations(
    canonical: &CanonicalDesignV2,
    receipts: &mut Vec<PluginImplementationReceiptV2>,
) -> Result<BindingDigest, StrategyCompilationV2> {
    receipts.sort();
    if receipts
        .windows(2)
        .any(|pair| pair[0].plugin_semantic_id == pair[1].plugin_semantic_id)
    {
        return Err(unsupported(
            "plugin_implementations",
            "duplicate plugin implementation receipt",
        ));
    }

    if receipts.len() != canonical.plugins.len() {
        return Err(unsupported(
            "plugin_implementations",
            "implementation receipts do not exactly cover canonical plugins",
        ));
    }
    let plugins = canonical
        .plugins
        .iter()
        .map(|plugin| (plugin.semantic_id.as_str(), plugin))
        .collect::<BTreeMap<_, _>>();
    let capabilities = canonical
        .capabilities
        .iter()
        .map(|capability| (capability.semantic_id.as_str(), capability.version))
        .collect::<BTreeMap<_, _>>();

    for receipt in receipts.iter() {
        let expected_receipt_digest = plugin_implementation_receipt_digest(receipt);
        if receipt.receipt_digest != expected_receipt_digest {
            return Err(unsupported(
                "plugin_implementations.receipt_digest",
                "plugin implementation receipt digest mismatch",
            ));
        }

        if [
            receipt.implementation_capsule_digest,
            receipt.source_entry_digest,
            receipt.module_digest,
            receipt.verified_build_receipt_digest,
        ]
        .contains(&BindingDigest::from_untrusted_bytes([0; 32]))
        {
            return Err(unsupported(
                "plugin_implementations.content_digests",
                "capsule, source-entry, module, and build receipt digests must be nonzero",
            ));
        }
        let Some(plugin) = plugins.get(receipt.plugin_semantic_id.as_str()) else {
            return Err(unsupported(
                "plugin_implementations.plugin_semantic_id",
                "implementation receipt binds a foreign plugin semantic ID",
            ));
        };
        let expected_manifest_digest = plugin_manifest_digest(plugin);
        if receipt.manifest_digest != expected_manifest_digest {
            return Err(unsupported(
                "plugin_implementations.manifest_digest",
                "implementation receipt manifest digest does not match the canonical manifest",
            ));
        }
        let expected_module_identity = plugin_module_identity(
            &receipt.plugin_semantic_id,
            expected_manifest_digest,
            receipt.module_digest,
        );

        if receipt.module_identity != expected_module_identity {
            return Err(unsupported(
                "plugin_implementations.module_identity",
                "module identity is not the compiler-derived identity",
            ));
        }

        if receipt.export_identity != PLUGIN_EXPORT_V2 {
            return Err(unsupported(
                "plugin_implementations.export_identity",
                "implementation receipt binds another V2 export identity",
            ));
        }

        if receipt.abi_version != plugin.abi_version {
            return Err(unsupported(
                "plugin_implementations.abi_version",
                "implementation receipt ABI does not match the plugin manifest",
            ));
        }
        let expected_versions = plugin
            .capability_ids
            .iter()
            .map(|semantic_id| PluginCapabilityVersionV2 {
                semantic_id: semantic_id.clone(),
                version: capabilities[semantic_id.as_str()],
            })
            .collect::<Vec<_>>();

        if receipt.capability_versions != expected_versions
            || receipt
                .capability_versions
                .windows(2)
                .any(|pair| pair[0].semantic_id == pair[1].semantic_id)
        {
            return Err(unsupported(
                "plugin_implementations.capability_versions",
                "implementation receipt capability versions do not exactly match the manifest",
            ));
        }
    }
    let bytes = serde_json::to_vec(receipts).expect("implementation set serialization");
    Ok(digest(b"strategy.plan.plugin-implementations.v2\0", &bytes))
}

fn validate_resource_bounds(bounds: &ResourceBoundsV2) -> Result<(), StrategyCompilationV2> {
    if bounds.max_inputs == 0
        || usize::from(bounds.max_inputs) > MAX_COLLECTION
        || bounds.max_nodes_per_reaction == 0
        || usize::from(bounds.max_nodes_per_reaction) > MAX_COLLECTION
        || bounds.max_dependency_edges == 0
        || usize::from(bounds.max_dependency_edges) > MAX_EDGES
        || bounds.max_state_bytes == 0
        || bounds.max_state_bytes > MAX_STATE_BYTES
        || bounds.max_plugin_calls_per_event == 0
        || bounds.max_plugin_calls_per_event > MAX_PLUGIN_INVOCATIONS
    {
        return Err(unsupported(
            "resources",
            "resource profile is zero or exceeds compiler limits",
        ));
    }
    Ok(())
}

fn validate_dag(
    graph: &BTreeMap<&str, &[String]>,
    coordinate: &str,
) -> Result<(), StrategyCompilationV2> {
    fn visit<'a>(
        node: &'a str,
        graph: &BTreeMap<&'a str, &'a [String]>,
        active: &mut BTreeSet<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<(), ()> {
        if done.contains(node) {
            return Ok(());
        }

        if !active.insert(node) {
            return Err(());
        }

        for dependency in graph[node] {
            if !graph.contains_key(dependency.as_str()) {
                return Err(());
            }
            visit(dependency, graph, active, done)?;
        }
        active.remove(node);
        done.insert(node);
        Ok(())
    }
    let mut active = BTreeSet::new();
    let mut done = BTreeSet::new();
    for node in graph.keys() {
        if visit(node, graph, &mut active, &mut done).is_err() {
            return Err(unsupported(
                coordinate,
                "undeclared or cyclic capability dependency",
            ));
        }
    }
    Ok(())
}

fn constant_size(value: &TypedConstantV2) -> u32 {
    match value {
        TypedConstantV2::I32 { .. } => 4,
        TypedConstantV2::I64 { .. } | TypedConstantV2::U64 { .. } => 8,
        TypedConstantV2::I128 { .. } | TypedConstantV2::StableIdentity16 { .. } => 16,
        TypedConstantV2::Digest32 { .. } => 32,
        TypedConstantV2::Bytes { value } => u32::try_from(value.len()).unwrap_or(u32::MAX),
        TypedConstantV2::PositionIntentV1 { semantic_id }
        | TypedConstantV2::TargetVariantV1 { semantic_id }
        | TypedConstantV2::ProtectionVariantV1 { semantic_id } => {
            u32::try_from(semantic_id.len()).unwrap_or(u32::MAX)
        }
    }
}

const fn minimum_value_bytes(value_type: ValueTypeV2) -> u32 {
    match value_type {
        ValueTypeV2::I32 => 4,
        ValueTypeV2::I64 | ValueTypeV2::U64 => 8,
        ValueTypeV2::I128 | ValueTypeV2::StableIdentity16 => 16,
        ValueTypeV2::Digest32 => 32,
        ValueTypeV2::Bytes
        | ValueTypeV2::PositionIntentV1
        | ValueTypeV2::TargetVariantV1
        | ValueTypeV2::ProtectionVariantV1 => 1,
    }
}

fn constant_semantic_is_supported(value: &TypedConstantV2) -> bool {
    match value {
        TypedConstantV2::PositionIntentV1 { semantic_id } => [
            lifecycle_v1::ENTER_SEMANTIC_ID,
            lifecycle_v1::ADD_SEMANTIC_ID,
            lifecycle_v1::REDUCE_SEMANTIC_ID,
            lifecycle_v1::EXIT_SEMANTIC_ID,
            lifecycle_v1::HOLD_SEMANTIC_ID,
        ]
        .contains(&semantic_id.as_str()),
        TypedConstantV2::TargetVariantV1 { .. } | TypedConstantV2::ProtectionVariantV1 { .. } => {
            false
        }
        _ => true,
    }
}

fn project_receipt(receipt: &StrategyInputBindingReceipt) -> BindingProjectionV2 {
    let locator = receipt.locator();
    BindingProjectionV2 {
        research_request_identity: locator.research_request_identity(),
        strategy_design_identity: locator.strategy_design_identity(),
        input_role_identity: locator.input_role_identity(),
        receipt_digest: receipt.digest(),
        selection_identity: locator.selection_identity(),
        field_semantic_id: locator.field_semantic_identity().to_owned(),
        data_kind: locator.data_kind().to_owned(),
        source_binding_lineage_root: locator.source_binding_lineage_root(),
        correction_stream_identity: locator.correction_stream_identity().to_owned(),
        instrument: locator.instrument().to_owned(),
        channel: locator.channel().to_owned(),
        timeframe: locator.timeframe().to_owned(),
        unit: locator.unit().to_owned(),
        scale: locator.scale(),
        market_semantics_identity: locator.market_semantics_identity(),
    }
}

fn role_identity(input: &InputRoleV2) -> BindingDigest {
    digest(
        b"strategy.design.input-role.v2\0",
        &serde_json::to_vec(input).expect("input serialization"),
    )
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn unique_by<T, F>(values: &[T], key: F, coordinate: &str) -> Result<(), StrategyCompilationV2>
where
    F: Fn(&T) -> &String,
{
    if values.windows(2).any(|pair| key(&pair[0]) == key(&pair[1])) {
        Err(unsupported(coordinate, "duplicate semantic ID"))
    } else {
        Ok(())
    }
}

fn unsupported(coordinate: &str, reason: &str) -> StrategyCompilationV2 {
    StrategyCompilationV2::Unsupported(CompilationIssueV2 {
        coordinate: coordinate.to_owned(),
        reason: reason.to_owned(),
    })
}

fn refinement(coordinate: &str, reason: &str) -> StrategyCompilationV2 {
    StrategyCompilationV2::NeedsResearchRefinement(CompilationIssueV2 {
        coordinate: coordinate.to_owned(),
        reason: reason.to_owned(),
    })
}

#[cfg(test)]
pub(crate) fn compile_with_binding_projections_for_test(
    design: StrategyDesignV2,
    bindings: Vec<(InputRoleV2, BindingDigest)>,
) -> StrategyCompilationV2 {
    let plugin_implementations = plugin_implementation_receipts_for_test(&design, 71);
    compile_with_binding_and_implementation_receipts_for_test(
        design,
        bindings,
        plugin_implementations,
    )
}

pub(crate) fn compile_with_binding_and_implementation_receipts_for_test(
    design: StrategyDesignV2,
    bindings: Vec<(InputRoleV2, BindingDigest)>,
    plugin_implementations: Vec<PluginImplementationReceiptV2>,
) -> StrategyCompilationV2 {
    let canonical = match canonicalize(design) {
        Ok(value) => value,
        Err(value) => return value,
    };
    let bytes = serde_json::to_vec(&canonical).expect("canonical design");
    let design_digest = digest(b"strategy.design.v2\0", &bytes);
    let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
    let projections = test_binding_projections(&canonical, design_identity, bindings);
    compile_canonical(
        canonical,
        design_identity,
        design_digest,
        projections,
        None,
        vec![],
        plugin_implementations,
    )
}

#[cfg(test)]
pub(crate) fn verified_strategy_input_bindings_for_test(
    design: &StrategyDesignV2,
    bindings: Vec<(InputRoleV2, BindingDigest)>,
) -> VerifiedStrategyInputBindingsV2 {
    let canonical = canonicalize(design.clone()).expect("test Design must canonicalize");
    let bytes = serde_json::to_vec(&canonical).expect("canonical design");
    let design_digest = digest(b"strategy.design.v2\0", &bytes);
    let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
    VerifiedStrategyInputBindingsV2 {
        projections: test_binding_projections(&canonical, design_identity, bindings),
        universe_selection: None,
        universe_bindings: vec![],
    }
}

fn test_binding_projections(
    canonical: &CanonicalDesignV2,
    design_identity: BindingDigest,
    bindings: Vec<(InputRoleV2, BindingDigest)>,
) -> Vec<BindingProjectionV2> {
    let market = BindingDigest::from_untrusted_bytes([9; 32]);
    bindings
        .into_iter()
        .map(|(input, receipt_digest)| {
            let data_kind = test_data_kind(&input.field_semantic_id).to_owned();
            let selection_identity = test_selection_identity(&input);
            BindingProjectionV2 {
                research_request_identity: canonical.research_request_identity,
                strategy_design_identity: design_identity,
                input_role_identity: role_identity(&input),
                receipt_digest,
                selection_identity,
                field_semantic_id: input.field_semantic_id,
                data_kind,
                source_binding_lineage_root: BindingDigest::from_untrusted_bytes([61; 32]),
                correction_stream_identity: "test-correction-stream".into(),
                instrument: input.instrument,
                channel: input.channel,
                timeframe: input.timeframe,
                unit: input.unit,
                scale: input.scale,
                market_semantics_identity: market,
            }
        })
        .collect()
}

fn test_data_kind(field_semantic_id: &str) -> &'static str {
    match field_semantic_id {
        "MARKET_DATA.BAR.CLOSE.PRICE.V1" | "MARKET_DATA.BAR.OPEN.PRICE.V1" => "BAR",
        "MARKET_DATA.TRADE.LAST.PRICE.V1" => "TRADE",
        _ => "UNSUPPORTED",
    }
}

fn test_selection_identity(input: &InputRoleV2) -> BindingDigest {
    digest(
        b"strategy.plan.test-selection.v2\0",
        &serde_json::to_vec(&(
            &input.field_semantic_id,
            &input.instrument,
            &input.channel,
            &input.timeframe,
            &input.unit,
            input.scale,
        ))
        .expect("test row serialization"),
    )
}

#[cfg(test)]
pub(crate) fn plugin_implementation_receipts_for_test(
    design: &StrategyDesignV2,
    seed: u8,
) -> Vec<PluginImplementationReceiptV2> {
    design
        .plugins
        .iter()
        .enumerate()
        .map(|(index, plugin)| {
            let implementation_seed = seed.saturating_add((index as u8).saturating_mul(4));
            issue_plugin_implementation_receipt_v2(
                plugin,
                &design.capabilities,
                BindingDigest::from_untrusted_bytes([implementation_seed; 32]),
                BindingDigest::from_untrusted_bytes([implementation_seed.saturating_add(1); 32]),
                BindingDigest::from_untrusted_bytes([implementation_seed.saturating_add(2); 32]),
                BindingDigest::from_untrusted_bytes([implementation_seed.saturating_add(3); 32]),
            )
            .expect("test plugin capabilities are declared")
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn issue_plugin_implementation_receipt_v2_for_test(
    plugin: &PluginManifestV2,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
    export_identity: &str,
    abi_version: u16,
    capability_versions: Vec<(String, u16)>,
) -> PluginImplementationReceiptV2 {
    issue_plugin_implementation_receipt(
        plugin,
        VerifiedPluginBuildDigestsV2 {
            implementation_capsule: implementation_capsule_digest,
            source_entry: source_entry_digest,
            module: module_digest,
            build_receipt: verified_build_receipt_digest,
        },
        export_identity.to_owned(),
        abi_version,
        capability_versions
            .into_iter()
            .map(|(semantic_id, version)| PluginCapabilityVersionV2 {
                semantic_id,
                version,
            })
            .collect(),
    )
}

#[cfg(test)]
pub(crate) fn corrupt_plugin_implementation_receipt_digest_for_test(
    receipt: &mut PluginImplementationReceiptV2,
) {
    receipt.receipt_digest = BindingDigest::from_untrusted_bytes([255; 32]);
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
pub(crate) fn corrupt_universe_binding_digest_for_test(plan: &mut StrategyPlanV2) {
    plan.universe_bindings[0].members[0].binding_digest =
        BindingDigest::from_untrusted_bytes([97; 32]);
}

#[cfg(test)]
pub(crate) fn rebind_plugin_manifest_digest_for_test(
    receipt: &mut PluginImplementationReceiptV2,
    manifest_digest: BindingDigest,
) {
    receipt.manifest_digest = manifest_digest;
    receipt.module_identity = plugin_module_identity(
        &receipt.plugin_semantic_id,
        receipt.manifest_digest,
        receipt.module_digest,
    );
    receipt.receipt_digest = plugin_implementation_receipt_digest(receipt);
}

#[cfg(test)]
pub(crate) fn rebind_plugin_module_identity_for_test(
    receipt: &mut PluginImplementationReceiptV2,
    module_identity: BindingDigest,
) {
    receipt.module_identity = module_identity;
    receipt.receipt_digest = plugin_implementation_receipt_digest(receipt);
}

#[cfg(test)]
mod canonical_row_reachability_tests {
    use rstest::rstest;

    use super::*;
    use crate::strategy_design_v2::{PortBindingV2, PortContractV2};
    use crate::strategy_design_v2_tests::{bindings, design};

    #[rstest]
    fn reaction_local_duplicate_rows_fail_before_plan_while_distinct_rows_compile() {
        let duplicate = design_with_second_bar_role("MARKET_DATA.BAR.CLOSE.PRICE.V1");
        let duplicate_bindings = bindings(&duplicate);
        assert!(matches!(
            compile_with_binding_projections_for_test(duplicate, duplicate_bindings),
            StrategyCompilationV2::Unsupported(issue)
                if issue.reason.contains("same static Owner selection twice")
        ));

        let distinct = design_with_second_bar_role("MARKET_DATA.BAR.OPEN.PRICE.V1");
        let distinct_bindings = bindings(&distinct);
        assert!(matches!(
            compile_with_binding_projections_for_test(distinct, distinct_bindings),
            StrategyCompilationV2::Compiled(_)
        ));

        let existing = design();
        let existing_bindings = bindings(&existing);
        assert!(matches!(
            compile_with_binding_projections_for_test(existing, existing_bindings),
            StrategyCompilationV2::Compiled(_)
        ));
    }

    #[rstest]
    fn reaction_local_roles_require_one_common_owner_frame_anchor() {
        assert!(matches!(
            compile_with_second_anchor_mutation(|binding| {
                binding.source_binding_lineage_root =
                    BindingDigest::from_untrusted_bytes([62; 32]);
            }),
            StrategyCompilationV2::Unsupported(issue)
                if issue.reason.contains("common Owner frame anchor")
        ));
        assert!(matches!(
            compile_with_second_anchor_mutation(|binding| {
                binding.correction_stream_identity = "other-correction-stream".into();
            }),
            StrategyCompilationV2::Unsupported(issue)
                if issue.reason.contains("common Owner frame anchor")
        ));
        assert!(matches!(
            compile_with_second_anchor_mutation(|binding| {
                binding.market_semantics_identity =
                    BindingDigest::from_untrusted_bytes([10; 32]);
            }),
            StrategyCompilationV2::Unsupported(issue)
                if issue.reason.contains("Market Semantics Compatibility")
        ));
    }

    fn compile_with_second_anchor_mutation(
        mutate: impl FnOnce(&mut BindingProjectionV2),
    ) -> StrategyCompilationV2 {
        let candidate = design_with_second_bar_role("MARKET_DATA.BAR.OPEN.PRICE.V1");
        let owner_bindings = bindings(&candidate);
        let plugin_implementations = plugin_implementation_receipts_for_test(&candidate, 71);
        let canonical = canonicalize(candidate).expect("test design canonicalizes");
        let bytes = serde_json::to_vec(&canonical).expect("canonical design");
        let design_digest = digest(b"strategy.design.v2\0", &bytes);
        let design_identity = digest(b"strategy.design.identity.v2\0", design_digest.as_bytes());
        let mut projections = test_binding_projections(&canonical, design_identity, owner_bindings);
        let second_role = canonical
            .inputs
            .iter()
            .find(|input| input.semantic_id == "research.input.second-bar.v1")
            .map(role_identity)
            .expect("second role exists");
        let binding = projections
            .iter_mut()
            .find(|binding| binding.input_role_identity == second_role)
            .expect("second role projection exists");
        mutate(binding);
        compile_canonical(
            canonical,
            design_identity,
            design_digest,
            projections,
            None,
            vec![],
            plugin_implementations,
        )
    }

    fn design_with_second_bar_role(field_semantic_id: &str) -> StrategyDesignV2 {
        let mut candidate = design();
        let mut second = candidate.inputs[0].clone();
        second.semantic_id = "research.input.second-bar.v1".into();
        second.field_semantic_id = field_semantic_id.into();
        candidate.inputs.push(second);
        candidate.plugins[0].input_ports.push(PortContractV2 {
            semantic_id: "input.second-bar.v1".into(),
            value_type: ValueTypeV2::I128,
            max_bytes: 16,
        });
        candidate.plugins[0].input_ports.sort();
        for reaction in &mut candidate.reactions {
            for node in &mut reaction.nodes {
                let source = if reaction.kind == LifecycleKindV2::Bar {
                    ValueRefV2::Input {
                        input_id: "research.input.second-bar.v1".into(),
                    }
                } else {
                    ValueRefV2::Parameter {
                        parameter_id: "research.parameter.timer-close.v1".into(),
                    }
                };
                node.input_bindings.push(PortBindingV2 {
                    port_id: "input.second-bar.v1".into(),
                    source,
                });
                node.input_bindings.sort();
            }
        }
        candidate
    }
}
