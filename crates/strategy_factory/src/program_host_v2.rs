//! Generic StrategyPlanV2 interpreter and failure-atomic lifecycle host.

use std::{collections::BTreeMap, rc::Rc};

use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v1::{
    self, CheckpointV1, EnvelopeAdmissionV1, LifecycleEnvelopeV1, LifecycleKernelV1,
    PositionIntentV1, ProtectionProposalV1, ProtectionStateV1, SemanticTraceV1, TargetProposalV1,
    TargetStateV1, UnsealedGuestProposalV1,
};
use strategy_factory_program_sdk::lifecycle_v2::{
    InstrumentTargetSetV2, MemberTargetV2, TARGET_SET_BYTES, TARGET_SET_MEMBER_COUNT,
};
use thiserror::Error;
use vibe_data::owner::{
    source_binding::BindingDigest,
    strategy_input_binding::{
        STRATEGY_INPUT_FIXED_I128_LE_V1, StrategyInputEventFrameReceipt, StrategyInputEventKind,
        StrategyInputUniverseFrameReceipt,
    },
};

use crate::{
    artifact_v2::{StrategyArtifactModuleV2, StrategyArtifactV2, StrategyArtifactV2Error},
    plugin_wire_v2::{
        PluginFrameKindV2, PluginFrameV2, TypedValueV2, aggregate_plugin_state_set_digest_v2,
    },
    program_runtime_v2::{ProgramPluginRuntimeV2, ProgramPluginRuntimeV2Error},
    strategy_design_v2::{
        InputFactClassV2, InputScopeV2, LifecycleContextV2, LifecycleKindV2, PluginManifestV2,
        TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{StrategyPlanV2, strategy_input_role_identity_v2},
};

const HOST_IDENTITY_DOMAIN: &[u8] = b"strategy.program-host.identity.v2\0";
const STRATEGY_STATE_DOMAIN: &[u8] = b"strategy.program-host.strategy-state.v2\0";
const INVOCATION_IDENTITY_DOMAIN: &[u8] = b"strategy.plugin.invocation.identity.v2\0";
const INTENT_IDENTITY_DOMAIN: &[u8] = b"strategy.lifecycle.intent.identity.v2\0";
const CHECKPOINT_DOMAIN: &[u8] = b"strategy.program-checkpoint.bundle.v2\0";
const MEMBER_KERNEL_IDENTITY_DOMAIN: &[u8] = b"strategy.shared-kernel.member.identity.v2\0";
const TARGET_SET_CAPABILITY_DOMAIN: &[u8] = b"strategy.shared-kernel.capability.v2\0";
const BACKTEST_PREPARED_TARGET_SET_DOMAIN: &[u8] = b"strategy.backtest.prepared-target-set.v2\0";
const CHECKPOINT_MAGIC: [u8; 4] = *b"SFCB";
const CHECKPOINT_CODEC_V2: u16 = 5;
const PROGRAM_HOST_SCHEMA_V2: u16 = 2;

#[derive(Clone, Debug, Eq, PartialEq)]
struct ProgramEventInputV2 {
    role_semantic_id: String,
    member_ordinal: Option<u8>,
    value: TypedValueV2,
    owner_event: OwnerEventEvidenceV2,
}

type ProgramInputMapV2<'a> = BTreeMap<(&'a str, Option<u8>), &'a TypedValueV2>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerEventEvidenceV2 {
    input_role_identity: BindingDigest,
    binding_receipt_digest: BindingDigest,
    event_receipt_digest: BindingDigest,
    trigger_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    scale: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SourceBindingLineageVersionV2 {
    root: BindingDigest,
    version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct UniverseFrameBindingV2 {
    selection_digest: BindingDigest,
    selection_receipt_digest: BindingDigest,
    frame_receipt_digest: BindingDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdmittedProgramEventV2 {
    envelope: LifecycleEnvelopeV1,
    inputs: Vec<ProgramEventInputV2>,
    identity: BindingDigest,
    source_binding_lineage: Option<SourceBindingLineageVersionV2>,
    universe_frame: Option<UniverseFrameBindingV2>,
}

impl AdmittedProgramEventV2 {
    pub(crate) const fn envelope(&self) -> LifecycleEnvelopeV1 {
        self.envelope
    }

    pub(crate) fn fixed_i128_input(&self, role_semantic_id: &str) -> Option<i128> {
        let input = self
            .inputs
            .iter()
            .find(|input| input.role_semantic_id == role_semantic_id)?;
        if input.value.value_type() != ValueTypeV2::I128 {
            return None;
        }
        let bytes = input.value.bytes().try_into().ok()?;
        Some(i128::from_le_bytes(bytes))
    }

    pub(crate) fn fixed_i128_member_input_scaled(
        &self,
        role_semantic_id: &str,
        member_ordinal: u8,
    ) -> Option<(i128, u8)> {
        let input = self.inputs.iter().find(|input| {
            input.role_semantic_id == role_semantic_id
                && input.member_ordinal == Some(member_ordinal)
        })?;

        if input.value.value_type() != ValueTypeV2::I128 {
            return None;
        }
        Some((
            i128::from_le_bytes(input.value.bytes().try_into().ok()?),
            input.owner_event.scale,
        ))
    }

    pub(crate) fn issue_for_plan_test(
        plan: &StrategyPlanV2,
        envelope: LifecycleEnvelopeV1,
        values: Vec<(&str, TypedValueV2)>,
    ) -> Self {
        let mut inputs = Vec::new();
        let trigger_digest = test_trigger_digest(envelope);

        for (role_semantic_id, value) in values {
            let role = plan
                .input_roles()
                .iter()
                .find(|role| role.semantic_id == role_semantic_id)
                .expect("test role belongs to Plan");
            let binding = plan
                .input_bindings()
                .iter()
                .find(|binding| {
                    binding.input_role_identity() == strategy_input_role_identity_v2(role)
                })
                .expect("test Plan carries sealed binding projection");
            let digest = test_event_receipt_digest(
                envelope,
                binding.receipt_digest(),
                binding.input_role_identity(),
                &value,
            );
            inputs.push(ProgramEventInputV2 {
                role_semantic_id: role_semantic_id.into(),
                member_ordinal: None,
                value,
                owner_event: OwnerEventEvidenceV2 {
                    input_role_identity: binding.input_role_identity(),
                    binding_receipt_digest: binding.receipt_digest(),
                    event_receipt_digest: digest,
                    trigger_digest,
                    observation_batch_digest: trigger_digest,
                    scale: binding.scale(),
                },
            });
        }
        inputs.sort_by(|left, right| {
            left.owner_event
                .input_role_identity
                .cmp(&right.owner_event.input_role_identity)
        });
        let source_binding_lineage = matches!(
            envelope.order_key.kind,
            lifecycle_v1::LifecycleKind::Bar | lifecycle_v1::LifecycleKind::Event
        )
        .then(|| SourceBindingLineageVersionV2 {
            root: plan
                .input_bindings()
                .first()
                .expect("market-data test Plan carries a binding")
                .source_binding_lineage_root(),
            version: 1,
        });
        let identity =
            admitted_event_identity(plan, envelope, &inputs, source_binding_lineage, None);
        Self {
            envelope,
            inputs,
            identity,
            source_binding_lineage,
            universe_frame: None,
        }
    }

    pub(crate) const fn admitted_identity(&self) -> BindingDigest {
        self.identity
    }

    #[cfg(test)]
    pub(crate) fn issue_for_plan_test_with_lineage(
        plan: &StrategyPlanV2,
        envelope: LifecycleEnvelopeV1,
        values: Vec<(&str, TypedValueV2)>,
        root: BindingDigest,
        version: u64,
    ) -> Self {
        let mut event = Self::issue_for_plan_test(plan, envelope, values);
        event.source_binding_lineage = Some(SourceBindingLineageVersionV2 { root, version });
        event.identity = admitted_event_identity(
            plan,
            event.envelope,
            &event.inputs,
            event.source_binding_lineage,
            event.universe_frame,
        );
        event
    }

    #[cfg(test)]
    pub(crate) fn corrupt_envelope_for_test(&mut self, envelope: LifecycleEnvelopeV1) {
        self.envelope = envelope;
    }

    #[cfg(test)]
    pub(crate) fn corrupt_trigger_for_test(&mut self) {
        self.inputs[0].owner_event.trigger_digest = BindingDigest::from_untrusted_bytes([0xa5; 32]);
    }
}

/// Admits one input-free lifecycle event issued by the isolated Backtest composition root.
///
/// Market-data events must continue through the Market Data Owner-sealed frame path. This seam is
/// deliberately limited to kernel-only `START`, Sim Exchange `FILL`, and `STOP` events.
pub(crate) fn admit_backtest_lifecycle_event_v2(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
) -> Result<AdmittedProgramEventV2, ProgramHostV2Error> {
    lifecycle_v1::encode_envelope_v1(envelope).map_err(|_| ProgramHostV2Error::InputCoverage)?;
    if !matches!(
        envelope.payload,
        lifecycle_v1::EnvelopePayloadV1::Start
            | lifecycle_v1::EnvelopePayloadV1::Fill(_)
            | lifecycle_v1::EnvelopePayloadV1::Stop
    ) {
        return Err(ProgramHostV2Error::InputCoverage);
    }
    let inputs = Vec::new();
    let identity = admitted_event_identity(plan, envelope, &inputs, None, None);
    Ok(AdmittedProgramEventV2 {
        envelope,
        inputs,
        identity,
        source_binding_lineage: None,
        universe_frame: None,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StrategyStateEntryV2 {
    semantic_id: String,
    value: TypedValueV2,
    max_bytes: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PluginStateEntryV2 {
    state_id: String,
    semantic_id: String,
    module_identity: BindingDigest,
    state: TypedValueV2,
    max_bytes: u32,
}

#[derive(Clone)]
struct MemberKernelV2 {
    instrument: String,
    kernel: LifecycleKernelV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct BoundTargetSetV2 {
    selection_identity: BindingDigest,
    frame_identity: BindingDigest,
    capability_identity: BindingDigest,
    target_set: InstrumentTargetSetV2,
}

enum EvaluatedProposalV2 {
    Single(lifecycle_v1::ProposalV1),
    Members(InstrumentTargetSetV2),
}

/// Host-owned, non-committed exactly-two-member Backtest proposal.
///
/// The contained host is a scratch clone. Callers may inspect only the canonical target set and
/// current member checkpoints. Only the Backtest adapter can seal the snapshot-bound
/// reconciliation capability that makes the scratch state committable.
pub(crate) struct PreparedBacktestTargetSetV2 {
    base_checkpoint_digest: BindingDigest,
    host_identity: BindingDigest,
    host_instance_token: Rc<()>,
    prepared_identity: BindingDigest,
    scratch: ProgramHostV2,
    envelope: LifecycleEnvelopeV1,
    admissions: Vec<EnvelopeAdmissionV1>,
    input_binding_digest: BindingDigest,
    source_binding_lineage: Option<SourceBindingLineageVersionV2>,
    target_set: InstrumentTargetSetV2,
    traces: Option<[SemanticTraceV1; TARGET_SET_MEMBER_COUNT]>,
}

impl PreparedBacktestTargetSetV2 {
    pub(crate) const fn canonical_target_set(&self) -> InstrumentTargetSetV2 {
        self.target_set
    }

    pub(crate) fn member_checkpoint(&self, ordinal: usize) -> Option<(&str, CheckpointV1)> {
        self.scratch
            .member_kernels
            .get(ordinal)
            .map(|member| (member.instrument.as_str(), member.kernel.checkpoint()))
    }

    pub(crate) fn reconcile_backtest_capability(
        mut self,
        capability: crate::program_host_backtest_target_set_v2::BacktestReconciliationCapabilityV2,
    ) -> Result<Self, ProgramHostV2Error> {
        let grid_targets = capability.verify_for(
            self.prepared_identity,
            &self.host_instance_token,
            self.target_set,
        )?;

        if self.traces.is_some() || self.admissions.len() != TARGET_SET_MEMBER_COUNT {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let strategy_digest = strategy_state_digest(&self.scratch.strategy_state);
        let plugin_digest = plugin_state_digest(&self.scratch.plugin_state);
        let proposal_plan = self.scratch.plan.clone();
        let mut traces = [SemanticTraceV1::default(); TARGET_SET_MEMBER_COUNT];

        for (index, ((member, admission), grid_target)) in self
            .scratch
            .member_kernels
            .iter_mut()
            .zip(self.admissions.drain(..))
            .zip(grid_targets)
            .enumerate()
        {
            let mut target = self.target_set.members[index];
            match target.target {
                lifecycle_v1::TargetProposalV1::Position(units)
                | lifecycle_v1::TargetProposalV1::RebalancePosition { units, .. } => {
                    if grid_target != units || target.reconciliation_target_units != Some(units) {
                        return Err(ProgramHostV2Error::InputCoverage);
                    }
                }
                lifecycle_v1::TargetProposalV1::WeightMicros(_)
                | lifecycle_v1::TargetProposalV1::RebalanceWeightMicros { .. } => {
                    if target.reconciliation_target_units.is_some() {
                        return Err(ProgramHostV2Error::InputCoverage);
                    }
                    target.reconciliation_target_units = Some(grid_target);
                }
                lifecycle_v1::TargetProposalV1::Keep => {
                    if target.reconciliation_target_units.is_some()
                        || grid_target != member.kernel.checkpoint().reconciled_position_units
                    {
                        return Err(ProgramHostV2Error::InputCoverage);
                    }
                }
            }
            let proposal = seal_member_proposal(
                &proposal_plan,
                self.envelope,
                &member.instrument,
                target,
                strategy_digest,
                plugin_digest,
            )?;
            let EnvelopeAdmissionV1::ProposalRequired(admitted) = admission else {
                return Err(ProgramHostV2Error::Checkpoint);
            };
            traces[index] = member
                .kernel
                .apply_admitted(admitted, Some(proposal))
                .map_err(ProgramHostV2Error::Kernel)?
                .trace;
        }
        self.scratch.pending_target_set = Some(BoundTargetSetV2 {
            selection_identity: target_set_selection_identity(&self.scratch.plan),
            frame_identity: self.input_binding_digest,
            capability_identity: target_set_capability_identity(&self.scratch.plan),
            target_set: self.target_set,
        });
        self.scratch.last_input_binding_digest = Some(self.input_binding_digest);
        if let Some(lineage) = self.source_binding_lineage {
            self.scratch
                .source_binding_lineage_version_frontier
                .insert(lineage.root, lineage.version);
        }
        self.scratch.checkpoint = self.scratch.encode_checkpoint()?;
        self.scratch.validate_checkpoint_roundtrip()?;
        self.traces = Some(traces);
        Ok(self)
    }

    pub(crate) fn member_traces(&self) -> Option<[SemanticTraceV1; TARGET_SET_MEMBER_COUNT]> {
        self.traces
    }

    pub(crate) const fn prepared_identity(&self) -> BindingDigest {
        self.prepared_identity
    }

    pub(crate) fn host_instance_token(&self) -> Rc<()> {
        Rc::clone(&self.host_instance_token)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProgramCheckpointBundleV2 {
    canonical: Box<[u8]>,
    digest: BindingDigest,
}

impl ProgramCheckpointBundleV2 {
    /// Returns canonical content-addressing bytes; bytes alone are not restore authority.
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical
    }
    /// Returns the Host-sealed digest stored with this opaque bundle.
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

pub struct ProgramHostV2 {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    host_identity: BindingDigest,
    host_instance_token: Rc<()>,
    kernel: LifecycleKernelV1,
    member_kernels: Vec<MemberKernelV2>,
    strategy_state: Vec<StrategyStateEntryV2>,
    plugin_state: Vec<PluginStateEntryV2>,
    checkpoint: ProgramCheckpointBundleV2,
    plugin_calls: u64,
    last_input_binding_digest: Option<BindingDigest>,
    source_binding_lineage_version_frontier: BTreeMap<BindingDigest, u64>,
    pending_target_set: Option<BoundTargetSetV2>,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ProgramHostV2Error {
    #[error("plan and artifact mismatch: {0}")]
    Artifact(String),
    #[error("caller input frame does not exactly cover Plan-declared Owner-bound roles")]
    InputCoverage,
    #[error("typed value mismatch at {0}")]
    Type(String),
    #[error("reaction graph resolution failed at {0}")]
    Graph(String),
    #[error(transparent)]
    Plugin(#[from] ProgramPluginRuntimeV2Error),
    #[error("lifecycle kernel rejected the event: {0:?}")]
    Kernel(lifecycle_v1::KernelFaultV1),
    #[error("checkpoint bundle is malformed or mismatched")]
    Checkpoint,
}

impl From<StrategyArtifactV2Error> for ProgramHostV2Error {
    fn from(value: StrategyArtifactV2Error) -> Self {
        Self::Artifact(value.to_string())
    }
}

pub(crate) fn admit_market_data_program_event_v2(
    plan: &StrategyPlanV2,
    frame: &StrategyInputEventFrameReceipt,
) -> Result<AdmittedProgramEventV2, ProgramHostV2Error> {
    let trigger = frame.trigger();
    let mut prior_role = None;

    for value in frame.values() {
        let role_identity = value.input_role_identity();
        if prior_role.is_some_and(|prior| prior >= role_identity)
            || value.trigger_digest() != trigger.digest()
            || value.observation_batch_digest() != trigger.observation_batch_digest()
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        prior_role = Some(role_identity);
    }
    let lifecycle = trigger.lifecycle();
    let kind = match lifecycle.kind() {
        StrategyInputEventKind::Bar => lifecycle_v1::LifecycleKind::Bar,
        StrategyInputEventKind::Event => lifecycle_v1::LifecycleKind::Event,
    };
    let payload = match kind {
        lifecycle_v1::LifecycleKind::Bar => lifecycle_v1::EnvelopePayloadV1::Bar,
        lifecycle_v1::LifecycleKind::Event => lifecycle_v1::EnvelopePayloadV1::Event,
        _ => return Err(ProgramHostV2Error::InputCoverage),
    };
    let order_key = lifecycle_v1::EventOrderKeyV1::new(
        lifecycle.logical_time(),
        lifecycle.event_time(),
        kind,
        lifecycle.owner_sequence(),
        lifecycle.event_identity(),
    )
    .map_err(ProgramHostV2Error::Kernel)?;
    let envelope =
        LifecycleEnvelopeV1::new_bound(order_key, payload).map_err(ProgramHostV2Error::Kernel)?;
    let required = reaction_input_roles(plan, kind)?;
    if required.len() != frame.values().len() {
        return Err(ProgramHostV2Error::InputCoverage);
    }
    let mut inputs = Vec::with_capacity(required.len());
    let mut source_binding_lineage = None;

    for role in required {
        let role_identity = strategy_input_role_identity_v2(role);
        let binding = plan
            .input_bindings()
            .iter()
            .find(|binding| binding.input_role_identity() == role_identity)
            .ok_or(ProgramHostV2Error::InputCoverage)?;
        let value = frame
            .values()
            .iter()
            .find(|value| value.input_role_identity() == role_identity)
            .ok_or(ProgramHostV2Error::InputCoverage)?;

        if value.binding_receipt_digest() != binding.receipt_digest()
            || value.value_type_semantic_id() != STRATEGY_INPUT_FIXED_I128_LE_V1
            || value.value_scale() != role.scale
            || value.trigger_digest() != trigger.digest()
            || value.observation_batch_digest() != trigger.observation_batch_digest()
            || value.source_binding_lineage_root() != binding.source_binding_lineage_root()
            || value.correction_stream_identity() != binding.correction_stream_identity()
            || value.market_semantics_identity() != binding.market_semantics_identity()
            || value.source_binding_lineage_version() == 0
            || value.correction_sequence() == 0
            || role.value_type != ValueTypeV2::I128
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let lineage = SourceBindingLineageVersionV2 {
            root: value.source_binding_lineage_root(),
            version: value.source_binding_lineage_version(),
        };

        if source_binding_lineage
            .replace(lineage)
            .is_some_and(|prior| prior != lineage)
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        inputs.push(ProgramEventInputV2 {
            role_semantic_id: role.semantic_id.clone(),
            member_ordinal: None,
            value: TypedValueV2::new(ValueTypeV2::I128, value.value_bytes().as_slice())
                .map_err(|_| ProgramHostV2Error::InputCoverage)?,
            owner_event: OwnerEventEvidenceV2 {
                input_role_identity: role_identity,
                binding_receipt_digest: value.binding_receipt_digest(),
                event_receipt_digest: value.digest(),
                trigger_digest: value.trigger_digest(),
                observation_batch_digest: value.observation_batch_digest(),
                scale: value.value_scale(),
            },
        });
    }
    let identity = admitted_event_identity(plan, envelope, &inputs, source_binding_lineage, None);
    Ok(AdmittedProgramEventV2 {
        envelope,
        inputs,
        identity,
        source_binding_lineage,
        universe_frame: None,
    })
}

pub(crate) fn admit_market_data_universe_program_event_v2(
    plan: &StrategyPlanV2,
    frame: &StrategyInputUniverseFrameReceipt,
) -> Result<AdmittedProgramEventV2, ProgramHostV2Error> {
    let projection = plan
        .universe_selection()
        .ok_or(ProgramHostV2Error::InputCoverage)?;
    let selection = frame.selection();
    if selection.selection_identity() != projection.selection_identity()
        || selection.selection_digest() != projection.selection_digest()
        || selection.instrument_master_digest() != projection.instrument_master_digest()
        || selection.source_binding_lineage_root() != projection.source_binding_lineage_root()
        || selection.market_semantics_identity() != projection.market_semantics_identity()
        || selection.digest() != projection.selection_receipt_digest()
        || selection.members().len() != projection.members().len()
        || selection
            .members()
            .iter()
            .zip(projection.members())
            .any(|(actual, expected)| {
                actual.member_key() != expected.member_key()
                    || actual.instrument() != expected.instrument()
            })
    {
        return Err(ProgramHostV2Error::InputCoverage);
    }
    let trigger = frame.trigger();
    let lifecycle = trigger.lifecycle();
    let kind = match lifecycle.kind() {
        StrategyInputEventKind::Bar => lifecycle_v1::LifecycleKind::Bar,
        StrategyInputEventKind::Event => lifecycle_v1::LifecycleKind::Event,
    };
    let payload = match kind {
        lifecycle_v1::LifecycleKind::Bar => lifecycle_v1::EnvelopePayloadV1::Bar,
        lifecycle_v1::LifecycleKind::Event => lifecycle_v1::EnvelopePayloadV1::Event,
        _ => return Err(ProgramHostV2Error::InputCoverage),
    };
    let order_key = lifecycle_v1::EventOrderKeyV1::new(
        lifecycle.logical_time(),
        lifecycle.event_time(),
        kind,
        lifecycle.owner_sequence(),
        lifecycle.event_identity(),
    )
    .map_err(ProgramHostV2Error::Kernel)?;
    let envelope =
        LifecycleEnvelopeV1::new_bound(order_key, payload).map_err(ProgramHostV2Error::Kernel)?;
    let required = reaction_input_roles(plan, kind)?;
    if frame.values().len() != required.len().saturating_mul(projection.members().len()) {
        return Err(ProgramHostV2Error::InputCoverage);
    }
    let mut prior = None;

    for value in frame.values() {
        let coordinate = (
            value.member_key(),
            value.instrument(),
            value.input_role_identity(),
        );

        if prior.is_some_and(|prior_coordinate| prior_coordinate >= coordinate)
            || value.trigger_digest() != trigger.digest()
            || value.observation_batch_digest() != trigger.observation_batch_digest()
            || value.source_binding_lineage_root() != projection.source_binding_lineage_root()
            || value.market_semantics_identity() != projection.market_semantics_identity()
            || !projection.members().iter().any(|member| {
                member.member_key() == value.member_key()
                    && member.instrument() == value.instrument()
            })
            || !required
                .iter()
                .any(|role| strategy_input_role_identity_v2(role) == value.input_role_identity())
            || plan.universe_binding_digest(
                value.input_role_identity(),
                value.member_key(),
                value.instrument(),
            ) != Some(value.binding_digest())
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        prior = Some(coordinate);
    }

    for member in projection.members() {
        for role in &required {
            let role_identity = strategy_input_role_identity_v2(role);

            if frame
                .values()
                .iter()
                .filter(|value| {
                    value.member_key() == member.member_key()
                        && value.instrument() == member.instrument()
                        && value.input_role_identity() == role_identity
                })
                .count()
                != 1
            {
                return Err(ProgramHostV2Error::InputCoverage);
            }
        }
    }
    let mut inputs = Vec::with_capacity(frame.values().len());

    for (member_ordinal, member) in projection.members().iter().enumerate() {
        let member_ordinal =
            u8::try_from(member_ordinal).map_err(|_| ProgramHostV2Error::InputCoverage)?;

        for role in &required {
            let role_identity = strategy_input_role_identity_v2(role);
            let value = frame
                .values()
                .iter()
                .find(|value| {
                    value.member_key() == member.member_key()
                        && value.instrument() == member.instrument()
                        && value.input_role_identity() == role_identity
                })
                .ok_or(ProgramHostV2Error::InputCoverage)?;

            if value.value_type_semantic_id() != STRATEGY_INPUT_FIXED_I128_LE_V1
                || value.value_scale() != role.scale
                || role.value_type != ValueTypeV2::I128
            {
                return Err(ProgramHostV2Error::InputCoverage);
            }
            inputs.push(ProgramEventInputV2 {
                role_semantic_id: role.semantic_id.clone(),
                member_ordinal: Some(member_ordinal),
                value: TypedValueV2::new(ValueTypeV2::I128, value.value_bytes().as_slice())
                    .map_err(|_| ProgramHostV2Error::InputCoverage)?,
                owner_event: OwnerEventEvidenceV2 {
                    input_role_identity: role_identity,
                    binding_receipt_digest: value.binding_digest(),
                    event_receipt_digest: value.digest(),
                    trigger_digest: value.trigger_digest(),
                    observation_batch_digest: value.observation_batch_digest(),
                    scale: value.value_scale(),
                },
            });
        }
    }
    inputs.sort_by_key(|input| (input.member_ordinal, input.owner_event.input_role_identity));
    let universe_frame = Some(UniverseFrameBindingV2 {
        selection_digest: selection.selection_digest(),
        selection_receipt_digest: selection.digest(),
        frame_receipt_digest: frame.digest(),
    });
    let identity = admitted_event_identity(plan, envelope, &inputs, None, universe_frame);
    Ok(AdmittedProgramEventV2 {
        envelope,
        inputs,
        identity,
        source_binding_lineage: None,
        universe_frame,
    })
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
pub(crate) fn issue_backtest_universe_successor_for_test(
    plan: &StrategyPlanV2,
    frame: &StrategyInputUniverseFrameReceipt,
    logical_time_ns: u64,
    member_open_close: [[i128; 2]; TARGET_SET_MEMBER_COUNT],
) -> Result<AdmittedProgramEventV2, ProgramHostV2Error> {
    let mut event = admit_market_data_universe_program_event_v2(plan, frame)?;
    let prior = event.envelope.order_key;
    let identity_digest = domain_digest(
        b"strategy.backtest.test-successor-event.v2\0",
        &logical_time_ns.to_le_bytes(),
    );
    let event_identity = identity_digest.as_bytes()[..16]
        .try_into()
        .map_err(|_| ProgramHostV2Error::InputCoverage)?;
    let order_key = lifecycle_v1::EventOrderKeyV1::new(
        logical_time_ns,
        logical_time_ns,
        lifecycle_v1::LifecycleKind::Bar,
        prior
            .owner_sequence
            .checked_add(1)
            .ok_or(ProgramHostV2Error::InputCoverage)?,
        event_identity,
    )
    .map_err(ProgramHostV2Error::Kernel)?;
    event.envelope =
        LifecycleEnvelopeV1::new_bound(order_key, lifecycle_v1::EnvelopePayloadV1::Bar)
            .map_err(ProgramHostV2Error::Kernel)?;

    for input in &mut event.inputs {
        let ordinal = usize::from(
            input
                .member_ordinal
                .ok_or(ProgramHostV2Error::InputCoverage)?,
        );
        let value = match input.role_semantic_id.as_str() {
            "research.input.open.v1" => member_open_close[ordinal][0],
            "research.input.close.v1" => member_open_close[ordinal][1],
            _ => return Err(ProgramHostV2Error::InputCoverage),
        };
        input.value = TypedValueV2::new(ValueTypeV2::I128, value.to_le_bytes().as_slice())
            .map_err(|_| ProgramHostV2Error::InputCoverage)?;
        input.owner_event.event_receipt_digest = test_event_receipt_digest(
            event.envelope,
            input.owner_event.binding_receipt_digest,
            input.owner_event.input_role_identity,
            &input.value,
        );
    }
    event.identity = admitted_event_identity(
        plan,
        event.envelope,
        &event.inputs,
        event.source_binding_lineage,
        event.universe_frame,
    );
    Ok(event)
}

impl ProgramHostV2 {
    fn clone_for_scratch(&self) -> Self {
        Self {
            plan: self.plan.clone(),
            artifact: self.artifact.clone(),
            host_identity: self.host_identity,
            host_instance_token: Rc::clone(&self.host_instance_token),
            kernel: self.kernel,
            member_kernels: self.member_kernels.clone(),
            strategy_state: self.strategy_state.clone(),
            plugin_state: self.plugin_state.clone(),
            checkpoint: self.checkpoint.clone(),
            plugin_calls: self.plugin_calls,
            last_input_binding_digest: self.last_input_binding_digest,
            source_binding_lineage_version_frontier: self
                .source_binding_lineage_version_frontier
                .clone(),
            pending_target_set: self.pending_target_set,
        }
    }

    pub fn new(
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
    ) -> Result<Self, ProgramHostV2Error> {
        artifact.validate_for_plan(&plan)?;
        let host_identity = host_identity(&plan, &artifact);
        let strategy_state = plan
            .execution_view()
            .initial_state
            .iter()
            .map(|cell| {
                Ok(StrategyStateEntryV2 {
                    semantic_id: cell.semantic_id.clone(),
                    value: constant_value(&cell.initial)?,
                    max_bytes: cell.max_bytes,
                })
            })
            .collect::<Result<Vec<_>, ProgramHostV2Error>>()?;
        let plugin_state = initial_plugin_state(&plan, &artifact, &strategy_state)?;
        let strategy_digest = strategy_state_digest(&strategy_state);
        let plugin_digest = plugin_state_digest(&plugin_state);
        let identities = kernel_identities(&plan, &artifact, host_identity);
        let kernel = LifecycleKernelV1::new_with_state_digests(
            identities,
            *strategy_digest.as_bytes(),
            *plugin_digest.as_bytes(),
        )
        .map_err(ProgramHostV2Error::Kernel)?;
        let member_kernels = if let Some(selection) = plan.universe_selection() {
            selection
                .members()
                .iter()
                .map(|instrument| {
                    let instrument = instrument.instrument();
                    Ok(MemberKernelV2 {
                        instrument: instrument.to_owned(),
                        kernel: LifecycleKernelV1::new_with_state_digests(
                            member_kernel_identities(&plan, &artifact, host_identity, instrument),
                            *strategy_digest.as_bytes(),
                            *plugin_digest.as_bytes(),
                        )
                        .map_err(ProgramHostV2Error::Kernel)?,
                    })
                })
                .collect::<Result<Vec<_>, ProgramHostV2Error>>()?
        } else {
            Vec::new()
        };
        let mut host = Self {
            plan,
            artifact,
            host_identity,
            host_instance_token: Rc::new(()),
            kernel,
            member_kernels,
            strategy_state,
            plugin_state,
            checkpoint: ProgramCheckpointBundleV2 {
                canonical: Box::default(),
                digest: BindingDigest::from_untrusted_bytes([0; 32]),
            },
            plugin_calls: 0,
            last_input_binding_digest: None,
            source_binding_lineage_version_frontier: BTreeMap::new(),
            pending_target_set: None,
        };
        host.checkpoint = host.encode_checkpoint()?;
        host.validate_checkpoint_roundtrip()?;
        Ok(host)
    }

    /// Restores only from an opaque Host-issued checkpoint bundle.
    pub fn restore(
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        checkpoint: &ProgramCheckpointBundleV2,
    ) -> Result<Self, ProgramHostV2Error> {
        let bytes = checkpoint.canonical_bytes();
        let content_end = bytes
            .len()
            .checked_sub(32)
            .ok_or(ProgramHostV2Error::Checkpoint)?;

        if domain_digest(CHECKPOINT_DOMAIN, &bytes[..content_end]) != checkpoint.digest
            || bytes[content_end..] != *checkpoint.digest.as_bytes()
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let fresh = Self::new(plan, artifact)?;
        fresh.decode_checkpoint(bytes)
    }

    /// Admits and applies one Market Data Owner-sealed BAR or EVENT frame.
    pub fn apply_market_data_event(
        &mut self,
        frame: &StrategyInputEventFrameReceipt,
    ) -> Result<SemanticTraceV1, ProgramHostV2Error> {
        let event = admit_market_data_program_event_v2(&self.plan, frame)?;
        self.apply_event(&event)
    }

    /// Admits and applies one complete Owner-sealed exactly-two-member frame.
    pub fn apply_market_data_universe_event(
        &mut self,
        frame: &StrategyInputUniverseFrameReceipt,
    ) -> Result<SemanticTraceV1, ProgramHostV2Error> {
        let event = admit_market_data_universe_program_event_v2(&self.plan, frame)?;
        self.apply_event(&event)
    }

    /// Evaluates one complete universe frame on a scratch clone without advancing this host.
    #[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
    pub(crate) fn prepare_backtest_universe_event(
        &self,
        frame: &StrategyInputUniverseFrameReceipt,
    ) -> Result<PreparedBacktestTargetSetV2, ProgramHostV2Error> {
        let event = admit_market_data_universe_program_event_v2(&self.plan, frame)?;
        self.prepare_backtest_admitted_universe_event(&event)
    }

    pub(crate) fn prepare_backtest_admitted_universe_event(
        &self,
        event: &AdmittedProgramEventV2,
    ) -> Result<PreparedBacktestTargetSetV2, ProgramHostV2Error> {
        if admitted_event_identity(
            &self.plan,
            event.envelope,
            &event.inputs,
            event.source_binding_lineage,
            event.universe_frame,
        ) != event.identity
            || event.source_binding_lineage.is_some_and(|lineage| {
                lineage.version == 0
                    || self
                        .source_binding_lineage_version_frontier
                        .get(&lineage.root)
                        .is_some_and(|prior| lineage.version < *prior)
            })
            || event.envelope.order_key.kind != lifecycle_v1::LifecycleKind::Bar
            || self.member_kernels.len() != TARGET_SET_MEMBER_COUNT
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let input_map = self.validate_inputs(event.envelope, &event.inputs)?;
        let mut admissions = Vec::with_capacity(TARGET_SET_MEMBER_COUNT);

        for member in &self.member_kernels {
            let admission = member
                .kernel
                .admit_envelope(event.envelope)
                .map_err(ProgramHostV2Error::Kernel)?;
            if !matches!(admission, EnvelopeAdmissionV1::ProposalRequired(_)) {
                return Err(ProgramHostV2Error::InputCoverage);
            }
            admissions.push(admission);
        }
        let mut scratch = self.clone_for_scratch();
        let EvaluatedProposalV2::Members(target_set) =
            scratch.evaluate(event.envelope, &input_map)?
        else {
            return Err(ProgramHostV2Error::InputCoverage);
        };
        scratch.validate_member_target_set(event, target_set)?;
        let prepared_identity = backtest_prepared_target_set_identity(
            self.checkpoint.digest,
            event.identity,
            target_set,
        )?;
        Ok(PreparedBacktestTargetSetV2 {
            base_checkpoint_digest: self.checkpoint.digest,
            host_identity: self.host_identity,
            host_instance_token: Rc::clone(&self.host_instance_token),
            prepared_identity,
            scratch,
            envelope: event.envelope,
            admissions,
            input_binding_digest: event.identity,
            source_binding_lineage: event.source_binding_lineage,
            target_set,
            traces: None,
        })
    }

    /// Atomically swaps one fully reconciled scratch proposal into this running host.
    pub(crate) fn commit_prepared_backtest_target_set(
        &mut self,
        prepared: PreparedBacktestTargetSetV2,
    ) -> Result<[SemanticTraceV1; TARGET_SET_MEMBER_COUNT], ProgramHostV2Error> {
        if self.checkpoint.digest != prepared.base_checkpoint_digest
            || self.host_identity != prepared.host_identity
            || !Rc::ptr_eq(&self.host_instance_token, &prepared.host_instance_token)
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let traces = prepared.traces.ok_or(ProgramHostV2Error::Checkpoint)?;
        *self = prepared.scratch;
        Ok(traces)
    }

    /// Applies one native Backtest lifecycle fill to the exactly bound member kernel.
    pub(crate) fn apply_backtest_member_fill_event(
        &mut self,
        instrument: &str,
        event: &AdmittedProgramEventV2,
    ) -> Result<SemanticTraceV1, ProgramHostV2Error> {
        if admitted_event_identity(
            &self.plan,
            event.envelope,
            &event.inputs,
            event.source_binding_lineage,
            event.universe_frame,
        ) != event.identity
            || event.envelope.order_key.kind != lifecycle_v1::LifecycleKind::Fill
            || !event.inputs.is_empty()
            || event.source_binding_lineage.is_some()
            || event.universe_frame.is_some()
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let index = self
            .member_kernels
            .iter()
            .position(|member| member.instrument == instrument)
            .ok_or(ProgramHostV2Error::InputCoverage)?;
        let mut scratch = self.clone_for_scratch();
        let member = &mut scratch.member_kernels[index];
        let admission = member
            .kernel
            .admit_envelope(event.envelope)
            .map_err(ProgramHostV2Error::Kernel)?;
        let trace = match admission {
            EnvelopeAdmissionV1::Joined(outcome) => outcome.trace,
            EnvelopeAdmissionV1::NoProposal(admitted) => {
                member
                    .kernel
                    .apply_admitted(admitted, None)
                    .map_err(ProgramHostV2Error::Kernel)?
                    .trace
            }
            EnvelopeAdmissionV1::ProposalRequired(_) => {
                return Err(ProgramHostV2Error::InputCoverage);
            }
        };
        scratch.checkpoint = scratch.encode_checkpoint()?;
        scratch.validate_checkpoint_roundtrip()?;
        *self = scratch;
        Ok(trace)
    }

    pub fn apply_event(
        &mut self,
        event: &AdmittedProgramEventV2,
    ) -> Result<SemanticTraceV1, ProgramHostV2Error> {
        if admitted_event_identity(
            &self.plan,
            event.envelope,
            &event.inputs,
            event.source_binding_lineage,
            event.universe_frame,
        ) != event.identity
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }

        if event
            .source_binding_lineage
            .is_some_and(|lineage| lineage.version == 0)
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let envelope = event.envelope;
        let inputs = event.inputs.as_slice();
        let input_map = self.validate_inputs(envelope, inputs)?;
        let input_binding_digest = matches!(
            envelope.order_key.kind,
            lifecycle_v1::LifecycleKind::Bar
                | lifecycle_v1::LifecycleKind::Event
                | lifecycle_v1::LifecycleKind::Timer
        )
        .then_some(event.identity);
        if !self.member_kernels.is_empty() {
            if event.universe_frame.is_none()
                && matches!(
                    envelope.order_key.kind,
                    lifecycle_v1::LifecycleKind::Bar | lifecycle_v1::LifecycleKind::Event
                )
            {
                return Err(ProgramHostV2Error::InputCoverage);
            }
            return self.apply_shared_kernel_event(event, &input_map, input_binding_digest);
        }
        let admission = self
            .kernel
            .admit_envelope(envelope)
            .map_err(ProgramHostV2Error::Kernel)?;

        if let EnvelopeAdmissionV1::Joined(outcome) = admission {
            if input_binding_digest != self.last_input_binding_digest {
                return Err(ProgramHostV2Error::InputCoverage);
            }
            return Ok(outcome.trace);
        }

        if event.source_binding_lineage.is_some_and(|lineage| {
            self.source_binding_lineage_version_frontier
                .get(&lineage.root)
                .is_some_and(|prior| lineage.version < *prior)
        }) {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let mut scratch = self.clone_for_scratch();
        let outcome = match admission {
            EnvelopeAdmissionV1::Joined(_) => unreachable!("joined handled before scratch"),
            EnvelopeAdmissionV1::NoProposal(admitted) => scratch
                .kernel
                .apply_admitted(admitted, None)
                .map_err(ProgramHostV2Error::Kernel)?,
            EnvelopeAdmissionV1::ProposalRequired(admitted) => {
                let EvaluatedProposalV2::Single(proposal) =
                    scratch.evaluate(envelope, &input_map)?
                else {
                    return Err(ProgramHostV2Error::InputCoverage);
                };
                scratch
                    .kernel
                    .apply_admitted(admitted, Some(proposal))
                    .map_err(ProgramHostV2Error::Kernel)?
            }
        };
        scratch.last_input_binding_digest = input_binding_digest;
        if let Some(lineage) = event.source_binding_lineage {
            scratch
                .source_binding_lineage_version_frontier
                .insert(lineage.root, lineage.version);
        }
        scratch.checkpoint = scratch.encode_checkpoint()?;
        scratch.validate_checkpoint_roundtrip()?;
        *self = scratch;
        Ok(outcome.trace)
    }

    fn apply_shared_kernel_event(
        &mut self,
        event: &AdmittedProgramEventV2,
        inputs: &ProgramInputMapV2<'_>,
        input_binding_digest: Option<BindingDigest>,
    ) -> Result<SemanticTraceV1, ProgramHostV2Error> {
        if event.envelope.order_key.kind == lifecycle_v1::LifecycleKind::Fill {
            // The current Owner envelope has no canonical instrument coordinate. B3 Backtest (and
            // future Execution Runtime) must provide that sealed routing contract before fills can
            // advance one member of a combination.
            return Err(ProgramHostV2Error::InputCoverage);
        }

        if event.source_binding_lineage.is_some_and(|lineage| {
            self.source_binding_lineage_version_frontier
                .get(&lineage.root)
                .is_some_and(|prior| lineage.version < *prior)
        }) {
            return Err(ProgramHostV2Error::InputCoverage);
        }

        let mut admissions = Vec::with_capacity(self.member_kernels.len());
        let mut joined_trace = None;
        let mut joined_count = 0;

        for member in &self.member_kernels {
            match member
                .kernel
                .admit_envelope(event.envelope)
                .map_err(ProgramHostV2Error::Kernel)?
            {
                EnvelopeAdmissionV1::Joined(outcome) => {
                    if !admissions.is_empty() {
                        return Err(ProgramHostV2Error::Checkpoint);
                    }
                    joined_trace.get_or_insert(outcome.trace);
                    joined_count += 1;
                }
                admission => {
                    if joined_trace.is_some() {
                        return Err(ProgramHostV2Error::Checkpoint);
                    }
                    admissions.push(admission);
                }
            }
        }

        if let Some(trace) = joined_trace {
            if joined_count != self.member_kernels.len()
                || input_binding_digest != self.last_input_binding_digest
            {
                return Err(ProgramHostV2Error::InputCoverage);
            }
            return Ok(trace);
        }

        if admissions.len() != self.member_kernels.len() {
            return Err(ProgramHostV2Error::Checkpoint);
        }

        let mut scratch = self.clone_for_scratch();
        let proposal_required = admissions
            .iter()
            .all(|admission| matches!(admission, EnvelopeAdmissionV1::ProposalRequired(_)));
        let no_proposal = admissions
            .iter()
            .all(|admission| matches!(admission, EnvelopeAdmissionV1::NoProposal(_)));
        if !proposal_required && !no_proposal {
            return Err(ProgramHostV2Error::Checkpoint);
        }

        let target_set = if proposal_required {
            let EvaluatedProposalV2::Members(target_set) =
                scratch.evaluate(event.envelope, inputs)?
            else {
                return Err(ProgramHostV2Error::InputCoverage);
            };
            scratch.validate_member_target_set(event, target_set)?;
            Some(target_set)
        } else {
            None
        };

        let strategy_digest = strategy_state_digest(&scratch.strategy_state);
        let plugin_digest = plugin_state_digest(&scratch.plugin_state);
        let proposal_plan = scratch.plan.clone();
        let mut first_trace = None;

        for (index, (member, admission)) in scratch
            .member_kernels
            .iter_mut()
            .zip(admissions)
            .enumerate()
        {
            let proposal = if proposal_required {
                Some(seal_member_proposal(
                    &proposal_plan,
                    event.envelope,
                    &member.instrument,
                    target_set.ok_or(ProgramHostV2Error::InputCoverage)?.members[index],
                    strategy_digest,
                    plugin_digest,
                )?)
            } else {
                None
            };
            let outcome = match admission {
                EnvelopeAdmissionV1::ProposalRequired(admitted)
                | EnvelopeAdmissionV1::NoProposal(admitted) => member
                    .kernel
                    .apply_admitted(admitted, proposal)
                    .map_err(ProgramHostV2Error::Kernel)?,
                EnvelopeAdmissionV1::Joined(_) => return Err(ProgramHostV2Error::Checkpoint),
            };
            first_trace.get_or_insert(outcome.trace);
        }

        if let Some(target_set) = target_set {
            scratch.pending_target_set = Some(BoundTargetSetV2 {
                selection_identity: target_set_selection_identity(&scratch.plan),
                frame_identity: event.identity,
                capability_identity: target_set_capability_identity(&scratch.plan),
                target_set,
            });
        }
        scratch.last_input_binding_digest = input_binding_digest;
        if let Some(lineage) = event.source_binding_lineage {
            scratch
                .source_binding_lineage_version_frontier
                .insert(lineage.root, lineage.version);
        }
        scratch.checkpoint = scratch.encode_checkpoint()?;
        scratch.validate_checkpoint_roundtrip()?;
        let trace = first_trace.ok_or(ProgramHostV2Error::Checkpoint)?;
        *self = scratch;
        Ok(trace)
    }

    fn validate_member_target_set(
        &self,
        event: &AdmittedProgramEventV2,
        target_set: InstrumentTargetSetV2,
    ) -> Result<(), ProgramHostV2Error> {
        if self.member_kernels.len() != TARGET_SET_MEMBER_COUNT
            || self
                .pending_target_set
                .is_some_and(|prior| target_set.sequence <= prior.target_set.sequence)
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }

        for (member, target) in self.member_kernels.iter().zip(target_set.members) {
            if member.instrument.as_bytes() != target.instrument.as_bytes() {
                return Err(ProgramHostV2Error::InputCoverage);
            }
        }

        if target_set_selection_identity(&self.plan) == BindingDigest::from_untrusted_bytes([0; 32])
            || target_set_capability_identity(&self.plan)
                == BindingDigest::from_untrusted_bytes([0; 32])
            || event.identity == BindingDigest::from_untrusted_bytes([0; 32])
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        Ok(())
    }

    pub const fn host_identity(&self) -> BindingDigest {
        self.host_identity
    }
    pub const fn checkpoint(&self) -> &ProgramCheckpointBundleV2 {
        &self.checkpoint
    }
    pub const fn plugin_calls(&self) -> u64 {
        self.plugin_calls
    }
    pub fn kernel_checkpoint(&self) -> CheckpointV1 {
        self.member_kernels.first().map_or_else(
            || self.kernel.checkpoint(),
            |member| member.kernel.checkpoint(),
        )
    }

    pub fn canonical_member_target_set(&self) -> Option<InstrumentTargetSetV2> {
        self.pending_target_set.map(|bound| bound.target_set)
    }

    pub(crate) fn member_checkpoints_for_backtest(&self) -> Vec<(&str, CheckpointV1)> {
        self.member_kernels
            .iter()
            .map(|member| (member.instrument.as_str(), member.kernel.checkpoint()))
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn state_pair_for_test(&self, state_id: &str) -> (&[u8], &[u8]) {
        let strategy = self
            .strategy_state
            .iter()
            .find(|state| state.semantic_id == state_id)
            .expect("test strategy state");
        let plugin = self
            .plugin_state
            .iter()
            .find(|state| state.state_id == state_id)
            .expect("test plugin state");
        (strategy.value.bytes(), plugin.state.bytes())
    }

    #[cfg(test)]
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    pub(crate) fn member_checkpoints_for_test(&self) -> Vec<(&str, CheckpointV1)> {
        self.member_kernels
            .iter()
            .map(|member| (member.instrument.as_str(), member.kernel.checkpoint()))
            .collect()
    }

    fn validate_inputs<'a>(
        &self,
        envelope: LifecycleEnvelopeV1,
        inputs: &'a [ProgramEventInputV2],
    ) -> Result<ProgramInputMapV2<'a>, ProgramHostV2Error> {
        if !matches!(
            envelope.order_key.kind,
            lifecycle_v1::LifecycleKind::Bar
                | lifecycle_v1::LifecycleKind::Event
                | lifecycle_v1::LifecycleKind::Timer
        ) {
            return if inputs.is_empty() {
                Ok(BTreeMap::new())
            } else {
                Err(ProgramHostV2Error::InputCoverage)
            };
        }
        let declared = reaction_input_roles(&self.plan, envelope.order_key.kind)?;
        let universe = self.plan.universe_selection().is_some();
        let expected_len = if universe {
            declared.len().saturating_mul(TARGET_SET_MEMBER_COUNT)
        } else {
            declared.len()
        };

        if inputs.len() != expected_len {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let mut values = BTreeMap::new();
        let mut frame = None;

        for input in inputs {
            let role = declared
                .iter()
                .find(|role| role.semantic_id == input.role_semantic_id)
                .ok_or(ProgramHostV2Error::InputCoverage)?;
            let role_identity = strategy_input_role_identity_v2(role);
            let binding = (!universe)
                .then(|| {
                    self.plan
                        .input_bindings()
                        .iter()
                        .find(|binding| binding.input_role_identity() == role_identity)
                })
                .flatten();

            if role.value_type != input.value.value_type()
                || (!universe
                    && input.owner_event.binding_receipt_digest
                        != binding
                            .ok_or(ProgramHostV2Error::InputCoverage)?
                            .receipt_digest())
                || input.owner_event.binding_receipt_digest
                    == BindingDigest::from_untrusted_bytes([0; 32])
                || input.owner_event.input_role_identity != role_identity
                || input.owner_event.scale != role.scale
                || (universe && input.member_ordinal.is_none_or(|ordinal| ordinal >= 2))
                || (!universe && input.member_ordinal.is_some())
                || frame
                    .replace((
                        input.owner_event.trigger_digest,
                        input.owner_event.observation_batch_digest,
                    ))
                    .is_some_and(|prior| {
                        prior
                            != (
                                input.owner_event.trigger_digest,
                                input.owner_event.observation_batch_digest,
                            )
                    })
                || values
                    .insert(
                        (input.role_semantic_id.as_str(), input.member_ordinal),
                        &input.value,
                    )
                    .is_some()
            {
                return Err(ProgramHostV2Error::InputCoverage);
            }
        }

        if declared.iter().any(|role| {
            if universe {
                (0..2).any(|ordinal| {
                    !values.contains_key(&(role.semantic_id.as_str(), Some(ordinal)))
                })
            } else {
                !values.contains_key(&(role.semantic_id.as_str(), None))
            }
        }) {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        Ok(values)
    }

    fn evaluate(
        &mut self,
        envelope: LifecycleEnvelopeV1,
        inputs: &ProgramInputMapV2<'_>,
    ) -> Result<EvaluatedProposalV2, ProgramHostV2Error> {
        // Treat the immutable package as untrusted again at the public consumption boundary.
        self.artifact.validate_for_plan(&self.plan)?;
        let kind = lifecycle_kind_v2(envelope.order_key.kind);
        let reaction = self
            .plan
            .reactions()
            .iter()
            .find(|reaction| reaction.kind == kind)
            .cloned()
            .ok_or_else(|| ProgramHostV2Error::Graph("reaction".into()))?;
        let mut outputs = BTreeMap::<(String, String), TypedValueV2>::new();
        let prior_strategy_digest = strategy_state_digest(&self.strategy_state);
        let prior_plugin_digest = plugin_state_digest(&self.plugin_state);

        for (call_index, node) in reaction.nodes.iter().enumerate() {
            let manifest = self.manifest(&node.plugin_semantic_id)?.clone();
            let module = self.module(&node.plugin_semantic_id)?.clone();
            let mut frame_values = Vec::with_capacity(manifest.input_ports.len());
            for port in &manifest.input_ports {
                let binding = node
                    .input_bindings
                    .iter()
                    .find(|binding| binding.port_id == port.semantic_id)
                    .ok_or_else(|| ProgramHostV2Error::Graph(node.semantic_id.clone()))?;
                frame_values.push(self.resolve(
                    &binding.source,
                    inputs,
                    &outputs,
                    envelope,
                    prior_strategy_digest,
                    prior_plugin_digest,
                )?);
            }
            let state = self.resolve(
                &node.pre_state,
                inputs,
                &outputs,
                envelope,
                prior_strategy_digest,
                prior_plugin_digest,
            )?;

            if state.value_type() != manifest.state.value_type
                || state.bytes().len() > manifest.state.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Type(format!(
                    "{}.pre_state",
                    node.semantic_id
                )));
            }
            let invocation_identity = invocation_identity(
                envelope,
                &node.semantic_id,
                module.module_identity(),
                call_index as u16,
            );
            let input = PluginFrameV2 {
                kind: PluginFrameKindV2::Input,
                manifest_digest: module.manifest_digest(),
                module_identity: module.module_identity(),
                invocation_identity,
                values: frame_values,
                state,
            };
            let output = ProgramPluginRuntimeV2::invoke(&module, &manifest, &input)?;
            self.plugin_calls = self
                .plugin_calls
                .checked_add(1)
                .ok_or_else(|| ProgramHostV2Error::Graph("plugin_calls".into()))?;

            for (contract, value) in manifest.output_ports.iter().zip(output.values) {
                outputs.insert(
                    (node.semantic_id.clone(), contract.semantic_id.clone()),
                    value,
                );
            }
            outputs.insert(
                (node.semantic_id.clone(), node.post_state_port_id.clone()),
                output.state.clone(),
            );
        }

        for write in &reaction.state_writes {
            let value = self.resolve(
                &write.source,
                inputs,
                &outputs,
                envelope,
                prior_strategy_digest,
                prior_plugin_digest,
            )?;
            let state = self
                .strategy_state
                .iter_mut()
                .find(|state| state.semantic_id == write.state_id)
                .ok_or_else(|| ProgramHostV2Error::Graph(write.state_id.clone()))?;

            if value.value_type() != state.value.value_type()
                || value.bytes().len() > state.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Type(write.state_id.clone()));
            }
            state.value = value;
        }

        for plugin in &mut self.plugin_state {
            let state = self
                .strategy_state
                .iter()
                .find(|state| state.semantic_id == plugin.state_id)
                .ok_or_else(|| ProgramHostV2Error::Graph(plugin.state_id.clone()))?;
            if state.value.value_type() != plugin.state.value_type()
                || state.value.bytes().len() > plugin.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Type(plugin.state_id.clone()));
            }
            plugin.state = state.value.clone();
        }
        let wiring = reaction
            .proposal
            .as_ref()
            .ok_or_else(|| ProgramHostV2Error::Graph("proposal".into()))?;
        let strategy_digest = strategy_state_digest(&self.strategy_state);
        let plugin_digest = plugin_state_digest(&self.plugin_state);

        if let Some(reference) = &wiring.member_target_set {
            let value = self.resolve(
                reference,
                inputs,
                &outputs,
                envelope,
                strategy_digest,
                plugin_digest,
            )?;

            if value.value_type() != ValueTypeV2::Bytes || value.bytes().len() != TARGET_SET_BYTES {
                return Err(ProgramHostV2Error::Type(
                    "proposal.member_target_set".into(),
                ));
            }
            return InstrumentTargetSetV2::decode(value.bytes())
                .map(EvaluatedProposalV2::Members)
                .map_err(|_| ProgramHostV2Error::Graph("proposal.member_target_set".into()));
        }
        let guest = proposal_from_wiring(
            self,
            wiring,
            inputs,
            &outputs,
            envelope,
            strategy_digest,
            plugin_digest,
        )?;
        let intent = intent_identity(&self.plan, envelope);
        lifecycle_v1::seal_guest_proposal_with_derived_digest_v1(
            guest,
            intent,
            *strategy_digest.as_bytes(),
            *plugin_digest.as_bytes(),
        )
        .map(EvaluatedProposalV2::Single)
        .map_err(|_| ProgramHostV2Error::Graph("proposal.seal".into()))
    }

    fn resolve(
        &self,
        reference: &ValueRefV2,
        inputs: &ProgramInputMapV2<'_>,
        outputs: &BTreeMap<(String, String), TypedValueV2>,
        envelope: LifecycleEnvelopeV1,
        strategy_digest: BindingDigest,
        plugin_digest: BindingDigest,
    ) -> Result<TypedValueV2, ProgramHostV2Error> {
        match reference {
            ValueRefV2::Input { input_id } => inputs
                .get(&(input_id.as_str(), None))
                .copied()
                .cloned()
                .ok_or_else(|| ProgramHostV2Error::Graph(input_id.clone())),
            ValueRefV2::UniverseMemberInput {
                input_id,
                member_ordinal,
            } => inputs
                .get(&(input_id.as_str(), Some(*member_ordinal)))
                .copied()
                .cloned()
                .ok_or_else(|| ProgramHostV2Error::Graph(input_id.clone())),
            ValueRefV2::Parameter { parameter_id } => self
                .plan
                .execution_view()
                .parameters
                .iter()
                .find(|value| value.semantic_id == *parameter_id)
                .map(|value| constant_value(&value.value))
                .transpose()?
                .ok_or_else(|| ProgramHostV2Error::Graph(parameter_id.clone())),
            ValueRefV2::PriorState { state_id } => self
                .strategy_state
                .iter()
                .find(|state| state.semantic_id == *state_id)
                .map(|state| state.value.clone())
                .ok_or_else(|| ProgramHostV2Error::Graph(state_id.clone())),
            ValueRefV2::NodeOutput { node_id, port_id } => outputs
                .get(&(node_id.clone(), port_id.clone()))
                .cloned()
                .ok_or_else(|| ProgramHostV2Error::Graph(format!("{node_id}.{port_id}"))),
            ValueRefV2::LifecycleContext { field } => Ok(match field {
                LifecycleContextV2::IntentIdentity => {
                    TypedValueV2::stable_identity(intent_identity(&self.plan, envelope))
                }
                LifecycleContextV2::EnvelopeDigest => TypedValueV2::digest(
                    BindingDigest::from_untrusted_bytes(envelope.envelope_digest),
                ),
                LifecycleContextV2::CurrentPositionUnits => {
                    TypedValueV2::i64(self.kernel.checkpoint().reconciled_position_units)
                }
                LifecycleContextV2::RebalanceSequence => {
                    TypedValueV2::u64(rebalance_sequence(self.kernel.checkpoint().target))
                }
                LifecycleContextV2::StrategyStateDigest => TypedValueV2::digest(strategy_digest),
                LifecycleContextV2::PluginStateDigest => TypedValueV2::digest(plugin_digest),
            }),
        }
    }

    fn manifest(&self, semantic_id: &str) -> Result<&PluginManifestV2, ProgramHostV2Error> {
        self.plan
            .canonical_plugin_manifests()
            .iter()
            .find(|manifest| manifest.semantic_id == semantic_id)
            .ok_or_else(|| ProgramHostV2Error::Graph(semantic_id.into()))
    }
    fn module(&self, semantic_id: &str) -> Result<&StrategyArtifactModuleV2, ProgramHostV2Error> {
        self.artifact
            .modules()
            .iter()
            .find(|module| module.plugin_semantic_id() == semantic_id)
            .ok_or_else(|| ProgramHostV2Error::Graph(semantic_id.into()))
    }

    fn encode_checkpoint(&self) -> Result<ProgramCheckpointBundleV2, ProgramHostV2Error> {
        let mut bytes = Vec::new();
        bytes.extend(CHECKPOINT_MAGIC);
        bytes.extend(CHECKPOINT_CODEC_V2.to_le_bytes());
        bytes.extend(PROGRAM_HOST_SCHEMA_V2.to_le_bytes());

        for digest in [
            self.plan.design_identity(),
            self.plan.design_digest(),
            self.plan.canonical_plan_digest(),
            self.artifact.identity(),
            self.artifact.profile().profile_identity(),
            self.host_identity,
            self.artifact.profile().lifecycle_kernel_identity(),
            self.plan.market_semantics_identity(),
        ] {
            bytes.extend(digest.as_bytes());
        }
        bytes.extend((lifecycle_v1::CHECKPOINT_BYTES as u32).to_le_bytes());
        bytes.extend(self.kernel.checkpoint().encode());
        bytes.extend(
            u16::try_from(self.member_kernels.len())
                .map_err(|_| ProgramHostV2Error::Checkpoint)?
                .to_le_bytes(),
        );

        for member in &self.member_kernels {
            encode_string(&mut bytes, &member.instrument)?;
            bytes.extend((lifecycle_v1::CHECKPOINT_BYTES as u32).to_le_bytes());
            bytes.extend(member.kernel.checkpoint().encode());
        }

        match self.pending_target_set {
            Some(bound) => {
                bytes.push(1);
                bytes.extend(bound.selection_identity.as_bytes());
                bytes.extend(bound.frame_identity.as_bytes());
                bytes.extend(bound.capability_identity.as_bytes());
                bytes.extend(
                    bound
                        .target_set
                        .encode()
                        .map_err(|_| ProgramHostV2Error::Checkpoint)?,
                );
            }
            None => {
                bytes.push(0);
                bytes.extend([0; 3 * 32 + TARGET_SET_BYTES]);
            }
        }
        bytes.extend(
            u16::try_from(self.strategy_state.len())
                .map_err(|_| ProgramHostV2Error::Checkpoint)?
                .to_le_bytes(),
        );

        for state in &self.strategy_state {
            encode_named_value(&mut bytes, &state.semantic_id, &state.value)?;
        }
        bytes.extend(
            u16::try_from(self.plugin_state.len())
                .map_err(|_| ProgramHostV2Error::Checkpoint)?
                .to_le_bytes(),
        );

        for state in &self.plugin_state {
            encode_string(&mut bytes, &state.semantic_id)?;
            bytes.extend(state.module_identity.as_bytes());
            encode_value(&mut bytes, &state.state)?;
        }
        bytes.extend(self.plugin_calls.to_le_bytes());

        match self.last_input_binding_digest {
            Some(digest) => {
                bytes.push(1);
                bytes.extend(digest.as_bytes());
            }
            None => {
                bytes.push(0);
                bytes.extend([0; 32]);
            }
        }
        bytes.extend(
            u16::try_from(self.source_binding_lineage_version_frontier.len())
                .map_err(|_| ProgramHostV2Error::Checkpoint)?
                .to_le_bytes(),
        );

        for (root, version) in &self.source_binding_lineage_version_frontier {
            if *version == 0 {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            bytes.extend(root.as_bytes());
            bytes.extend(version.to_le_bytes());
        }
        let digest = domain_digest(CHECKPOINT_DOMAIN, &bytes);
        bytes.extend(digest.as_bytes());
        Ok(ProgramCheckpointBundleV2 {
            canonical: bytes.into(),
            digest,
        })
    }

    fn decode_checkpoint(&self, bytes: &[u8]) -> Result<Self, ProgramHostV2Error> {
        if bytes.len()
            < 8 + 8 * 32
                + 4
                + lifecycle_v1::CHECKPOINT_BYTES
                + 2
                + 1
                + 3 * 32
                + TARGET_SET_BYTES
                + 2
                + 2
                + 8
                + 33
                + 2
                + 32
            || bytes[..4] != CHECKPOINT_MAGIC
            || read_u16(bytes, 4)? != CHECKPOINT_CODEC_V2
            || read_u16(bytes, 6)? != PROGRAM_HOST_SCHEMA_V2
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let content_end = bytes.len() - 32;
        let expected_digest = domain_digest(CHECKPOINT_DOMAIN, &bytes[..content_end]);
        if bytes[content_end..] != *expected_digest.as_bytes() {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let expected = [
            self.plan.design_identity(),
            self.plan.design_digest(),
            self.plan.canonical_plan_digest(),
            self.artifact.identity(),
            self.artifact.profile().profile_identity(),
            self.host_identity,
            self.artifact.profile().lifecycle_kernel_identity(),
            self.plan.market_semantics_identity(),
        ];
        let mut cursor = 8;
        for digest in expected {
            if bytes.get(cursor..cursor + 32) != Some(digest.as_bytes()) {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            cursor += 32;
        }

        if read_u32(bytes, cursor)? as usize != lifecycle_v1::CHECKPOINT_BYTES {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        cursor += 4;
        let kernel_checkpoint = CheckpointV1::decode(
            bytes
                .get(cursor..cursor + lifecycle_v1::CHECKPOINT_BYTES)
                .ok_or(ProgramHostV2Error::Checkpoint)?,
        )
        .map_err(|_| ProgramHostV2Error::Checkpoint)?;
        cursor += lifecycle_v1::CHECKPOINT_BYTES;
        let member_count = usize::from(read_u16(bytes, cursor)?);
        cursor += 2;

        if member_count != self.member_kernels.len()
            || !matches!(member_count, 0 | TARGET_SET_MEMBER_COUNT)
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let mut member_checkpoints = Vec::with_capacity(member_count);

        for expected in &self.member_kernels {
            let (instrument, next) = decode_string(bytes, cursor)?;
            cursor = next;
            if instrument != expected.instrument
                || read_u32(bytes, cursor)? as usize != lifecycle_v1::CHECKPOINT_BYTES
            {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            cursor += 4;
            let checkpoint = CheckpointV1::decode(
                bytes
                    .get(cursor..cursor + lifecycle_v1::CHECKPOINT_BYTES)
                    .ok_or(ProgramHostV2Error::Checkpoint)?,
            )
            .map_err(|_| ProgramHostV2Error::Checkpoint)?;
            cursor += lifecycle_v1::CHECKPOINT_BYTES;
            member_checkpoints.push((instrument, checkpoint));
        }
        let pending_target_set = match bytes
            .get(cursor..cursor + 1 + 3 * 32 + TARGET_SET_BYTES)
            .ok_or(ProgramHostV2Error::Checkpoint)?
        {
            [0, rest @ ..] if rest.iter().all(|byte| *byte == 0) => None,
            [1, rest @ ..] => {
                let selection_identity = BindingDigest::from_untrusted_bytes(read_array(rest, 0)?);
                let frame_identity = BindingDigest::from_untrusted_bytes(read_array(rest, 32)?);
                let capability_identity =
                    BindingDigest::from_untrusted_bytes(read_array(rest, 64)?);
                let target_set = InstrumentTargetSetV2::decode(&rest[96..])
                    .map_err(|_| ProgramHostV2Error::Checkpoint)?;

                if selection_identity != target_set_selection_identity(&self.plan)
                    || capability_identity != target_set_capability_identity(&self.plan)
                    || frame_identity == BindingDigest::from_untrusted_bytes([0; 32])
                {
                    return Err(ProgramHostV2Error::Checkpoint);
                }
                Some(BoundTargetSetV2 {
                    selection_identity,
                    frame_identity,
                    capability_identity,
                    target_set,
                })
            }
            _ => return Err(ProgramHostV2Error::Checkpoint),
        };
        cursor += 1 + 3 * 32 + TARGET_SET_BYTES;
        let strategy_count = usize::from(read_u16(bytes, cursor)?);
        cursor += 2;

        if strategy_count != self.strategy_state.len() {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let mut strategy_state = Vec::with_capacity(strategy_count);
        for expected in &self.strategy_state {
            let (name, value, next) = decode_named_value(bytes, cursor)?;
            cursor = next;

            if name != expected.semantic_id
                || value.value_type() != expected.value.value_type()
                || value.bytes().len() > expected.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            strategy_state.push(StrategyStateEntryV2 {
                semantic_id: name,
                value,
                max_bytes: expected.max_bytes,
            });
        }
        let plugin_count = usize::from(read_u16(bytes, cursor)?);
        cursor += 2;

        if plugin_count != self.plugin_state.len() {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let mut plugin_state = Vec::with_capacity(plugin_count);
        for expected in &self.plugin_state {
            let (name, next) = decode_string(bytes, cursor)?;
            cursor = next;
            let module_identity = BindingDigest::from_untrusted_bytes(read_array(bytes, cursor)?);
            cursor += 32;
            let (state, next) = decode_value(bytes, cursor)?;
            cursor = next;

            if name != expected.semantic_id
                || module_identity != expected.module_identity
                || state.value_type() != expected.state.value_type()
                || state.bytes().len() > expected.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            plugin_state.push(PluginStateEntryV2 {
                state_id: expected.state_id.clone(),
                semantic_id: name,
                module_identity,
                state,
                max_bytes: expected.max_bytes,
            });
        }
        let plugin_calls = read_u64(bytes, cursor)?;
        cursor += 8;
        let last_input_binding_digest = match bytes
            .get(cursor..cursor + 33)
            .ok_or(ProgramHostV2Error::Checkpoint)?
        {
            [0, digest @ ..] if digest == [0; 32] => None,
            [1, digest @ ..] => Some(BindingDigest::from_untrusted_bytes(
                digest
                    .try_into()
                    .map_err(|_| ProgramHostV2Error::Checkpoint)?,
            )),
            _ => return Err(ProgramHostV2Error::Checkpoint),
        };
        cursor += 33;
        let lineage_count = usize::from(read_u16(bytes, cursor)?);
        cursor += 2;
        let mut source_binding_lineage_version_frontier = BTreeMap::new();

        for _ in 0..lineage_count {
            let root = BindingDigest::from_untrusted_bytes(read_array(bytes, cursor)?);
            cursor += 32;
            let version = read_u64(bytes, cursor)?;
            cursor += 8;

            if version == 0
                || source_binding_lineage_version_frontier
                    .insert(root, version)
                    .is_some()
            {
                return Err(ProgramHostV2Error::Checkpoint);
            }
        }

        if cursor != content_end {
            return Err(ProgramHostV2Error::Checkpoint);
        }

        if member_count == 0
            && (kernel_checkpoint.strategy_state_digest
                != *strategy_state_digest(&strategy_state).as_bytes()
                || kernel_checkpoint.plugin_state_digest
                    != *plugin_state_digest(&plugin_state).as_bytes())
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        let kernel = LifecycleKernelV1::restore(
            kernel_identities(&self.plan, &self.artifact, self.host_identity),
            kernel_checkpoint,
        )
        .map_err(ProgramHostV2Error::Kernel)?;
        let mut member_kernels = Vec::with_capacity(member_checkpoints.len());
        for (instrument, checkpoint) in member_checkpoints {
            if checkpoint.strategy_state_digest
                != *strategy_state_digest(&strategy_state).as_bytes()
                || checkpoint.plugin_state_digest != *plugin_state_digest(&plugin_state).as_bytes()
            {
                return Err(ProgramHostV2Error::Checkpoint);
            }
            member_kernels.push(MemberKernelV2 {
                kernel: LifecycleKernelV1::restore(
                    member_kernel_identities(
                        &self.plan,
                        &self.artifact,
                        self.host_identity,
                        &instrument,
                    ),
                    checkpoint,
                )
                .map_err(ProgramHostV2Error::Kernel)?,
                instrument,
            });
        }
        let restored = Self {
            plan: self.plan.clone(),
            artifact: self.artifact.clone(),
            host_identity: self.host_identity,
            host_instance_token: Rc::clone(&self.host_instance_token),
            kernel,
            member_kernels,
            strategy_state,
            plugin_state,
            checkpoint: ProgramCheckpointBundleV2 {
                canonical: bytes.into(),
                digest: expected_digest,
            },
            plugin_calls,
            last_input_binding_digest,
            source_binding_lineage_version_frontier,
            pending_target_set,
        };

        if restored.encode_checkpoint()?.canonical.as_ref() != bytes {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        Ok(restored)
    }

    fn validate_checkpoint_roundtrip(&self) -> Result<(), ProgramHostV2Error> {
        let restored = self.decode_checkpoint(self.checkpoint.canonical_bytes())?;
        if restored.kernel.checkpoint() != self.kernel.checkpoint()
            || restored
                .member_kernels
                .iter()
                .map(|member| (&member.instrument, member.kernel.checkpoint()))
                .ne(self
                    .member_kernels
                    .iter()
                    .map(|member| (&member.instrument, member.kernel.checkpoint())))
            || restored.strategy_state != self.strategy_state
            || restored.plugin_state != self.plugin_state
            || restored.checkpoint != self.checkpoint
            || restored.last_input_binding_digest != self.last_input_binding_digest
            || restored.source_binding_lineage_version_frontier
                != self.source_binding_lineage_version_frontier
            || restored.pending_target_set != self.pending_target_set
        {
            return Err(ProgramHostV2Error::Checkpoint);
        }
        Ok(())
    }
}

fn proposal_from_wiring(
    host: &ProgramHostV2,
    wiring: &crate::strategy_design_v2::ProposalWiringV2,
    inputs: &ProgramInputMapV2<'_>,
    outputs: &BTreeMap<(String, String), TypedValueV2>,
    envelope: LifecycleEnvelopeV1,
    strategy_digest: BindingDigest,
    plugin_digest: BindingDigest,
) -> Result<UnsealedGuestProposalV1, ProgramHostV2Error> {
    let resolve = |reference: &ValueRefV2| {
        host.resolve(
            reference,
            inputs,
            outputs,
            envelope,
            strategy_digest,
            plugin_digest,
        )
    };
    let position = match semantic(&resolve(&wiring.position_intent)?)? {
        lifecycle_v1::HOLD_SEMANTIC_ID => PositionIntentV1::Hold,
        lifecycle_v1::ENTER_SEMANTIC_ID => PositionIntentV1::Enter,
        lifecycle_v1::ADD_SEMANTIC_ID => PositionIntentV1::Add,
        lifecycle_v1::REDUCE_SEMANTIC_ID => PositionIntentV1::Reduce,
        lifecycle_v1::EXIT_SEMANTIC_ID => PositionIntentV1::Exit,
        _ => return Err(ProgramHostV2Error::Graph("proposal.position_intent".into())),
    };
    let target_variant_value = resolve(&wiring.target_variant)?;
    let target_variant = semantic(&target_variant_value)?;
    let target_position = exact_i64(&resolve(&wiring.target_position_units)?)?;
    let target_weight = exact_i32(&resolve(&wiring.target_weight_micros)?)?;
    let sequence = exact_u64(&resolve(&wiring.rebalance_sequence)?)?;
    let target = match target_variant {
        "kernel.target.keep.v1" => TargetProposalV1::Keep,
        lifecycle_v1::TARGET_POSITION_SEMANTIC_ID => TargetProposalV1::Position(target_position),
        lifecycle_v1::TARGET_WEIGHT_SEMANTIC_ID => TargetProposalV1::WeightMicros(target_weight),
        lifecycle_v1::TARGET_REBALANCE_SEMANTIC_ID => TargetProposalV1::RebalancePosition {
            sequence,
            units: target_position,
        },
        _ => return Err(ProgramHostV2Error::Graph("proposal.target_variant".into())),
    };
    let reconciliation = exact_i64(&resolve(&wiring.reconciliation_target_units)?)?;
    let reconciliation = (target != TargetProposalV1::Keep).then_some(reconciliation);
    let protection_variant_value = resolve(&wiring.protection_variant)?;
    let protection_variant = semantic(&protection_variant_value)?;
    let protection = match protection_variant {
        "kernel.protection.keep.v1" => ProtectionProposalV1::Keep,
        "kernel.protection.clear.v1" => ProtectionProposalV1::Clear,
        lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID => ProtectionProposalV1::AdjustTrailing {
            stop_ticks: exact_i64(&resolve(&wiring.trailing_stop_ticks)?)?,
        },
        "kernel.protection.replace.v1" => ProtectionProposalV1::Replace(ProtectionStateV1 {
            stop_loss_ticks: positive_i64(exact_i64(&resolve(&wiring.stop_loss_ticks)?)?),
            take_profit_ticks: positive_i64(exact_i64(&resolve(&wiring.take_profit_ticks)?)?),
            trailing_distance_ticks: positive_u64(exact_u64(&resolve(
                &wiring.trailing_distance_ticks,
            )?)?),
            trailing_stop_ticks: positive_i64(exact_i64(&resolve(&wiring.trailing_stop_ticks)?)?),
        }),
        _ => {
            return Err(ProgramHostV2Error::Graph(
                "proposal.protection_variant".into(),
            ));
        }
    };
    UnsealedGuestProposalV1::new(position, target, reconciliation, protection)
        .map_err(|_| ProgramHostV2Error::Graph("proposal".into()))
}

fn constant_value(value: &TypedConstantV2) -> Result<TypedValueV2, ProgramHostV2Error> {
    let result = match value {
        TypedConstantV2::I32 { value } => Ok(TypedValueV2::i32(*value)),
        TypedConstantV2::I64 { value } => Ok(TypedValueV2::i64(*value)),
        TypedConstantV2::U64 { value } => Ok(TypedValueV2::u64(*value)),
        TypedConstantV2::I128 { value } => Ok(TypedValueV2::i128(*value)),
        TypedConstantV2::Bytes { value } => TypedValueV2::new(ValueTypeV2::Bytes, value.as_slice()),
        TypedConstantV2::Digest32 { value } => Ok(TypedValueV2::digest(*value)),
        TypedConstantV2::StableIdentity16 { value } => Ok(TypedValueV2::stable_identity(*value)),
        TypedConstantV2::PositionIntentV1 { semantic_id } => {
            TypedValueV2::new(ValueTypeV2::PositionIntentV1, semantic_id.as_bytes())
        }
        TypedConstantV2::TargetVariantV1 { semantic_id } => {
            TypedValueV2::new(ValueTypeV2::TargetVariantV1, semantic_id.as_bytes())
        }
        TypedConstantV2::ProtectionVariantV1 { semantic_id } => {
            TypedValueV2::new(ValueTypeV2::ProtectionVariantV1, semantic_id.as_bytes())
        }
    };
    result.map_err(|e| ProgramHostV2Error::Type(e.to_string()))
}

fn initial_plugin_state(
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    strategy_state: &[StrategyStateEntryV2],
) -> Result<Vec<PluginStateEntryV2>, ProgramHostV2Error> {
    strategy_state
        .iter()
        .map(|state| {
            let (reaction, write) = plan
                .reactions()
                .iter()
                .find_map(|reaction| {
                    reaction
                        .state_writes
                        .iter()
                        .find(|write| write.state_id == state.semantic_id)
                        .map(|write| (reaction, write))
                })
                .ok_or_else(|| ProgramHostV2Error::Graph(state.semantic_id.clone()))?;
            let ValueRefV2::NodeOutput { node_id, port_id } = &write.source else {
                return Err(ProgramHostV2Error::Graph(state.semantic_id.clone()));
            };
            let node = reaction
                .nodes
                .iter()
                .find(|node| node.semantic_id == *node_id && node.post_state_port_id == *port_id)
                .ok_or_else(|| ProgramHostV2Error::Graph(state.semantic_id.clone()))?;
            let manifest = plan
                .canonical_plugin_manifests()
                .iter()
                .find(|manifest| manifest.semantic_id == node.plugin_semantic_id)
                .ok_or_else(|| ProgramHostV2Error::Graph(node.plugin_semantic_id.clone()))?;
            let module = artifact
                .modules()
                .iter()
                .find(|module| module.plugin_semantic_id() == node.plugin_semantic_id)
                .ok_or_else(|| ProgramHostV2Error::Graph(node.plugin_semantic_id.clone()))?;

            if state.value.value_type() != manifest.state.value_type
                || state.value.bytes().len() > manifest.state.max_bytes as usize
            {
                return Err(ProgramHostV2Error::Type(state.semantic_id.clone()));
            }
            Ok(PluginStateEntryV2 {
                state_id: state.semantic_id.clone(),
                semantic_id: manifest.semantic_id.clone(),
                module_identity: module.module_identity(),
                state: state.value.clone(),
                max_bytes: manifest.state.max_bytes,
            })
        })
        .collect()
}

fn strategy_state_digest(states: &[StrategyStateEntryV2]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(STRATEGY_STATE_DOMAIN);
    for state in states {
        hasher.update((state.semantic_id.len() as u32).to_le_bytes());
        hasher.update(state.semantic_id.as_bytes());
        hasher.update([type_tag(state.value.value_type())]);
        hasher.update((state.value.bytes().len() as u32).to_le_bytes());
        hasher.update(state.value.bytes());
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}
fn plugin_state_digest(states: &[PluginStateEntryV2]) -> BindingDigest {
    aggregate_plugin_state_set_digest_v2(states.iter().map(|state| {
        (
            state.semantic_id.as_str(),
            state.module_identity,
            state.state.bytes(),
        )
    }))
}
fn host_identity(plan: &StrategyPlanV2, artifact: &StrategyArtifactV2) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(PROGRAM_HOST_SCHEMA_V2.to_le_bytes());
    bytes.extend(plan.canonical_plan_digest().as_bytes());
    bytes.extend(artifact.identity().as_bytes());
    bytes.extend(artifact.profile().profile_identity().as_bytes());
    domain_digest(HOST_IDENTITY_DOMAIN, &bytes)
}
fn kernel_identities(
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    host: BindingDigest,
) -> lifecycle_v1::KernelIdentitiesV1 {
    lifecycle_v1::KernelIdentitiesV1 {
        design_digest: *plan.design_digest().as_bytes(),
        plan_digest: *plan.canonical_plan_digest().as_bytes(),
        artifact_digest: *artifact.identity().as_bytes(),
        program_host_digest: *host.as_bytes(),
        kernel_digest: *artifact.profile().lifecycle_kernel_identity().as_bytes(),
        plugin_digest: *artifact.profile().runtime_profile_identity().as_bytes(),
        market_semantics_digest: *plan.market_semantics_identity().as_bytes(),
    }
}
fn member_kernel_identities(
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    host: BindingDigest,
    instrument: &str,
) -> lifecycle_v1::KernelIdentitiesV1 {
    let mut identities = kernel_identities(plan, artifact, host);
    let mut bytes = Vec::new();
    bytes.extend(host.as_bytes());
    bytes.extend((instrument.len() as u32).to_le_bytes());
    bytes.extend(instrument.as_bytes());
    identities.program_host_digest =
        *domain_digest(MEMBER_KERNEL_IDENTITY_DOMAIN, &bytes).as_bytes();
    identities
}

fn seal_member_proposal(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
    instrument: &str,
    member: MemberTargetV2,
    strategy_digest: BindingDigest,
    plugin_digest: BindingDigest,
) -> Result<lifecycle_v1::ProposalV1, ProgramHostV2Error> {
    let guest = UnsealedGuestProposalV1::new(
        member.position,
        member.target,
        member.reconciliation_target_units,
        member.protection,
    )
    .map_err(|_| ProgramHostV2Error::Graph("proposal.member_target_set".into()))?;
    lifecycle_v1::seal_guest_proposal_with_derived_digest_v1(
        guest,
        member_intent_identity(plan, envelope, instrument),
        *strategy_digest.as_bytes(),
        *plugin_digest.as_bytes(),
    )
    .map_err(|_| ProgramHostV2Error::Graph("proposal.member_target_set.seal".into()))
}

fn member_intent_identity(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
    instrument: &str,
) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(INTENT_IDENTITY_DOMAIN);
    hasher.update(plan.intent_identity().as_bytes());
    hasher.update(envelope.envelope_digest);
    hasher.update((instrument.len() as u32).to_le_bytes());
    hasher.update(instrument.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    digest[..16].try_into().expect("fixed digest prefix")
}

fn target_set_selection_identity(plan: &StrategyPlanV2) -> BindingDigest {
    plan.universe_selection()
        .map_or(BindingDigest::from_untrusted_bytes([0; 32]), |selection| {
            selection.selection_identity()
        })
}

fn target_set_capability_identity(plan: &StrategyPlanV2) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(plan.plugin_implementation_digest().as_bytes());
    for capability in plan.capability_closure() {
        bytes.extend((capability.len() as u32).to_le_bytes());
        bytes.extend(capability.as_bytes());
    }
    domain_digest(TARGET_SET_CAPABILITY_DOMAIN, &bytes)
}

fn backtest_prepared_target_set_identity(
    checkpoint: BindingDigest,
    input_binding: BindingDigest,
    target_set: InstrumentTargetSetV2,
) -> Result<BindingDigest, ProgramHostV2Error> {
    let mut bytes = Vec::new();
    bytes.extend(checkpoint.as_bytes());
    bytes.extend(input_binding.as_bytes());
    bytes.extend(
        target_set
            .encode()
            .map_err(|_| ProgramHostV2Error::InputCoverage)?,
    );
    Ok(domain_digest(BACKTEST_PREPARED_TARGET_SET_DOMAIN, &bytes))
}
fn invocation_identity(
    envelope: LifecycleEnvelopeV1,
    node: &str,
    module: BindingDigest,
    ordinal: u16,
) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(INVOCATION_IDENTITY_DOMAIN);
    hasher.update(envelope.envelope_digest);
    hasher.update((node.len() as u32).to_le_bytes());
    hasher.update(node.as_bytes());
    hasher.update(module.as_bytes());
    hasher.update(ordinal.to_le_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    digest[..16].try_into().expect("fixed digest prefix")
}
fn intent_identity(plan: &StrategyPlanV2, envelope: LifecycleEnvelopeV1) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(INTENT_IDENTITY_DOMAIN);
    hasher.update(plan.intent_identity().as_bytes());
    hasher.update(envelope.envelope_digest);
    let digest: [u8; 32] = hasher.finalize().into();
    digest[..16].try_into().expect("fixed digest prefix")
}
fn lifecycle_kind_v2(kind: lifecycle_v1::LifecycleKind) -> LifecycleKindV2 {
    match kind {
        lifecycle_v1::LifecycleKind::Start => LifecycleKindV2::Start,
        lifecycle_v1::LifecycleKind::Bar => LifecycleKindV2::Bar,
        lifecycle_v1::LifecycleKind::Event => LifecycleKindV2::Event,
        lifecycle_v1::LifecycleKind::Fill => LifecycleKindV2::Fill,
        lifecycle_v1::LifecycleKind::Timer => LifecycleKindV2::Timer,
        lifecycle_v1::LifecycleKind::Stop => LifecycleKindV2::Stop,
    }
}

fn reaction_input_roles(
    plan: &StrategyPlanV2,
    kind: lifecycle_v1::LifecycleKind,
) -> Result<Vec<&crate::strategy_design_v2::InputRoleV2>, ProgramHostV2Error> {
    let reaction = plan
        .reactions()
        .iter()
        .find(|reaction| reaction.kind == lifecycle_kind_v2(kind))
        .ok_or_else(|| ProgramHostV2Error::Graph("reaction".into()))?;
    let mut ids = std::collections::BTreeSet::new();
    let mut add = |reference: &ValueRefV2| match reference {
        ValueRefV2::Input { input_id } | ValueRefV2::UniverseMemberInput { input_id, .. } => {
            ids.insert(input_id.clone());
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
    let roles = plan
        .input_roles()
        .iter()
        .filter(|role| ids.contains(&role.semantic_id))
        .collect::<Vec<_>>();

    if roles.len() != ids.len()
        || (kind == lifecycle_v1::LifecycleKind::Timer && !roles.is_empty())
        || (matches!(
            kind,
            lifecycle_v1::LifecycleKind::Bar | lifecycle_v1::LifecycleKind::Event
        ) && roles
            .iter()
            .any(|role| role.fact_class != InputFactClassV2::MarketData))
        || roles.iter().any(|role| {
            matches!(role.scope, InputScopeV2::UniverseMembers)
                != plan.universe_selection().is_some()
        })
    {
        return Err(ProgramHostV2Error::InputCoverage);
    }
    Ok(roles)
}

fn admitted_event_identity(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
    inputs: &[ProgramEventInputV2],
    source_binding_lineage: Option<SourceBindingLineageVersionV2>,
    universe_frame: Option<UniverseFrameBindingV2>,
) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(plan.canonical_plan_digest().as_bytes());
    bytes.extend(envelope.envelope_digest);
    for input in inputs {
        bytes.extend((input.role_semantic_id.len() as u32).to_le_bytes());
        bytes.extend(input.role_semantic_id.as_bytes());
        bytes.push(input.member_ordinal.unwrap_or(u8::MAX));
        bytes.extend(input.owner_event.trigger_digest.as_bytes());
        bytes.extend(input.owner_event.binding_receipt_digest.as_bytes());
        bytes.extend(input.owner_event.event_receipt_digest.as_bytes());
    }

    match source_binding_lineage {
        Some(lineage) => {
            bytes.push(1);
            bytes.extend(lineage.root.as_bytes());
            bytes.extend(lineage.version.to_le_bytes());
        }
        None => {
            bytes.push(0);
            bytes.extend([0; 40]);
        }
    }

    match universe_frame {
        Some(binding) => {
            bytes.push(1);
            bytes.extend(binding.selection_digest.as_bytes());
            bytes.extend(binding.selection_receipt_digest.as_bytes());
            bytes.extend(binding.frame_receipt_digest.as_bytes());
        }
        None => {
            bytes.push(0);
            bytes.extend([0; 96]);
        }
    }
    domain_digest(b"strategy.program-host.admitted-event.v3\0", &bytes)
}
fn rebalance_sequence(target: TargetStateV1) -> u64 {
    match target {
        TargetStateV1::RebalancePosition { sequence, .. }
        | TargetStateV1::RebalanceWeightMicros { sequence, .. } => sequence,
        _ => 0,
    }
}
fn semantic(value: &TypedValueV2) -> Result<&str, ProgramHostV2Error> {
    std::str::from_utf8(value.bytes()).map_err(|_| ProgramHostV2Error::Type("semantic".into()))
}
fn exact_i32(value: &TypedValueV2) -> Result<i32, ProgramHostV2Error> {
    Ok(i32::from_le_bytes(
        value
            .bytes()
            .try_into()
            .map_err(|_| ProgramHostV2Error::Type("i32".into()))?,
    ))
}
fn exact_i64(value: &TypedValueV2) -> Result<i64, ProgramHostV2Error> {
    Ok(i64::from_le_bytes(
        value
            .bytes()
            .try_into()
            .map_err(|_| ProgramHostV2Error::Type("i64".into()))?,
    ))
}
fn exact_u64(value: &TypedValueV2) -> Result<u64, ProgramHostV2Error> {
    Ok(u64::from_le_bytes(
        value
            .bytes()
            .try_into()
            .map_err(|_| ProgramHostV2Error::Type("u64".into()))?,
    ))
}
fn positive_i64(value: i64) -> Option<i64> {
    (value > 0).then_some(value)
}
fn positive_u64(value: u64) -> Option<u64> {
    (value > 0).then_some(value)
}
fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn test_event_receipt_digest(
    envelope: LifecycleEnvelopeV1,
    binding_receipt_digest: BindingDigest,
    input_role_identity: BindingDigest,
    value: &TypedValueV2,
) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(envelope.envelope_digest);
    bytes.extend(binding_receipt_digest.as_bytes());
    bytes.extend(input_role_identity.as_bytes());
    bytes.push(type_tag(value.value_type()));
    bytes.extend((value.bytes().len() as u32).to_le_bytes());
    bytes.extend(value.bytes());
    domain_digest(b"strategy.program-host.test-event-receipt.v2\0", &bytes)
}

fn test_trigger_digest(envelope: LifecycleEnvelopeV1) -> BindingDigest {
    domain_digest(
        b"strategy.program-host.test-trigger-receipt.v2\0",
        &envelope.envelope_digest,
    )
}

#[cfg(test)]
pub(crate) fn corrupt_checkpoint_bytes_for_test(checkpoint: &mut ProgramCheckpointBundleV2) {
    checkpoint.canonical[100] ^= 1;
}

#[cfg(test)]
pub(crate) fn corrupt_last_plugin_state_and_reseal_for_test(
    checkpoint: &mut ProgramCheckpointBundleV2,
) {
    let bytes = &mut checkpoint.canonical;
    let content_end = bytes.len() - 32;
    bytes[content_end - 42] ^= 1;
    let digest = domain_digest(CHECKPOINT_DOMAIN, &bytes[..content_end]);
    bytes[content_end..].copy_from_slice(digest.as_bytes());
}

fn encode_named_value(
    bytes: &mut Vec<u8>,
    name: &str,
    value: &TypedValueV2,
) -> Result<(), ProgramHostV2Error> {
    encode_string(bytes, name)?;
    encode_value(bytes, value)
}
fn encode_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), ProgramHostV2Error> {
    bytes.extend(
        u16::try_from(value.len())
            .map_err(|_| ProgramHostV2Error::Checkpoint)?
            .to_le_bytes(),
    );
    bytes.extend(value.as_bytes());
    Ok(())
}
fn encode_value(bytes: &mut Vec<u8>, value: &TypedValueV2) -> Result<(), ProgramHostV2Error> {
    bytes.push(type_tag(value.value_type()));
    bytes.extend(
        u32::try_from(value.bytes().len())
            .map_err(|_| ProgramHostV2Error::Checkpoint)?
            .to_le_bytes(),
    );
    bytes.extend(value.bytes());
    Ok(())
}
fn decode_named_value(
    bytes: &[u8],
    cursor: usize,
) -> Result<(String, TypedValueV2, usize), ProgramHostV2Error> {
    let (name, cursor) = decode_string(bytes, cursor)?;
    let (value, cursor) = decode_value(bytes, cursor)?;
    Ok((name, value, cursor))
}
fn decode_string(bytes: &[u8], cursor: usize) -> Result<(String, usize), ProgramHostV2Error> {
    let len = usize::from(read_u16(bytes, cursor)?);
    let start = cursor + 2;
    let end = start
        .checked_add(len)
        .ok_or(ProgramHostV2Error::Checkpoint)?;
    let value = std::str::from_utf8(
        bytes
            .get(start..end)
            .ok_or(ProgramHostV2Error::Checkpoint)?,
    )
    .map_err(|_| ProgramHostV2Error::Checkpoint)?
    .to_owned();
    Ok((value, end))
}
fn decode_value(bytes: &[u8], cursor: usize) -> Result<(TypedValueV2, usize), ProgramHostV2Error> {
    let value_type = decode_type_tag(*bytes.get(cursor).ok_or(ProgramHostV2Error::Checkpoint)?)
        .ok_or(ProgramHostV2Error::Checkpoint)?;
    let len = read_u32(bytes, cursor + 1)? as usize;
    let start = cursor + 5;
    let end = start
        .checked_add(len)
        .ok_or(ProgramHostV2Error::Checkpoint)?;
    let value = TypedValueV2::new(
        value_type,
        bytes
            .get(start..end)
            .ok_or(ProgramHostV2Error::Checkpoint)?,
    )
    .map_err(|_| ProgramHostV2Error::Checkpoint)?;
    Ok((value, end))
}
const fn type_tag(value: ValueTypeV2) -> u8 {
    match value {
        ValueTypeV2::I32 => 1,
        ValueTypeV2::I64 => 2,
        ValueTypeV2::U64 => 3,
        ValueTypeV2::I128 => 4,
        ValueTypeV2::Bytes => 5,
        ValueTypeV2::Digest32 => 6,
        ValueTypeV2::StableIdentity16 => 7,
        ValueTypeV2::PositionIntentV1 => 8,
        ValueTypeV2::TargetVariantV1 => 9,
        ValueTypeV2::ProtectionVariantV1 => 10,
    }
}
const fn decode_type_tag(value: u8) -> Option<ValueTypeV2> {
    match value {
        1 => Some(ValueTypeV2::I32),
        2 => Some(ValueTypeV2::I64),
        3 => Some(ValueTypeV2::U64),
        4 => Some(ValueTypeV2::I128),
        5 => Some(ValueTypeV2::Bytes),
        6 => Some(ValueTypeV2::Digest32),
        7 => Some(ValueTypeV2::StableIdentity16),
        8 => Some(ValueTypeV2::PositionIntentV1),
        9 => Some(ValueTypeV2::TargetVariantV1),
        10 => Some(ValueTypeV2::ProtectionVariantV1),
        _ => None,
    }
}
fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], ProgramHostV2Error> {
    bytes
        .get(offset..offset + N)
        .and_then(|value| value.try_into().ok())
        .ok_or(ProgramHostV2Error::Checkpoint)
}
fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramHostV2Error> {
    Ok(u16::from_le_bytes(read_array(bytes, offset)?))
}
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramHostV2Error> {
    Ok(u32::from_le_bytes(read_array(bytes, offset)?))
}
fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramHostV2Error> {
    Ok(u64::from_le_bytes(read_array(bytes, offset)?))
}
