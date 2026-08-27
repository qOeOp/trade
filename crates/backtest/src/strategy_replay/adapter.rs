use std::{collections::BTreeMap, error::Error, fmt::Display};

use strategy_factory_program_sdk::lifecycle_v1::{
    FillDispositionV1, FillSideV1, LifecycleKind, PositionIntentV1, ProposalV1, SemanticTraceV1,
    TargetProposalV1, TargetSemanticV1, TargetStateV1, encode_envelope_v1, encode_proposal_v1,
};

use super::{DigestV1, IdentityV1, digest, identity, is_zero};
use crate::strategy_replay::source::{
    LifecycleSourceEvidenceV1, NormalizedLifecycleEventV1, SourceNormalizationFaultV1,
    StrategyReplaySourceV1, fill_side_from_delta, order_tuple, valid_terminal_cumulative,
};

const CLIENT_IDENTITY_DOMAIN: &[u8] = b"backtest.strategy-replay.client-identity.v1\0";
const ORDER_IDENTITY_DOMAIN: &[u8] = b"backtest.strategy-replay.order-identity.v1\0";
const RESTART_BUNDLE_DOMAIN: &[u8] = b"backtest.strategy-replay.restart-bundle.v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConsumedProgramIdentitiesV1 {
    pub design_digest: DigestV1,
    pub plan_digest: DigestV1,
    pub artifact_digest: DigestV1,
    pub runtime_profile_digest: DigestV1,
    pub program_host_digest: DigestV1,
    pub kernel_digest: DigestV1,
    pub plugin_set_digest: DigestV1,
    pub market_semantics_digest: DigestV1,
}

impl ConsumedProgramIdentitiesV1 {
    fn validate(self) -> Result<(), AdapterFaultV1> {
        let values = [
            self.design_digest,
            self.plan_digest,
            self.artifact_digest,
            self.runtime_profile_digest,
            self.program_host_digest,
            self.kernel_digest,
            self.plugin_set_digest,
            self.market_semantics_digest,
        ];

        if values.iter().any(|value| is_zero(value)) {
            Err(AdapterFaultV1::MissingConsumedIdentity)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostLifecycleOutcomeV1 {
    semantic_intent: Option<ProposalV1>,
    semantic_trace: SemanticTraceV1,
    checkpoint_before_digest: DigestV1,
    checkpoint_after_digest: DigestV1,
    restart_bundle_bytes: Vec<u8>,
    restart_bundle_digest: DigestV1,
}

impl HostLifecycleOutcomeV1 {
    /// Builds a host-sealed outcome after checking its proposal and restart bundle.
    ///
    /// # Errors
    ///
    /// Returns an error when a digest is absent, a proposal is malformed, or the restart bytes do
    /// not match the declared digest.
    pub fn new(
        semantic_intent: Option<ProposalV1>,
        semantic_trace: SemanticTraceV1,
        checkpoint_before_digest: DigestV1,
        checkpoint_after_digest: DigestV1,
        restart_bundle_bytes: Vec<u8>,
        restart_bundle_digest: DigestV1,
    ) -> Result<Self, AdapterFaultV1> {
        if is_zero(&checkpoint_before_digest)
            || is_zero(&checkpoint_after_digest)
            || restart_bundle_bytes.is_empty()
            || is_zero(&restart_bundle_digest)
        {
            return Err(AdapterFaultV1::MalformedHostOutcome);
        }
        let expected = digest(RESTART_BUNDLE_DOMAIN, &[&restart_bundle_bytes]);
        if expected != restart_bundle_digest {
            return Err(AdapterFaultV1::MalformedHostOutcome);
        }

        if let Some(proposal) = semantic_intent {
            encode_proposal_v1(proposal).map_err(|_| AdapterFaultV1::MalformedHostOutcome)?;
        }
        Ok(Self {
            semantic_intent,
            semantic_trace,
            checkpoint_before_digest,
            checkpoint_after_digest,
            restart_bundle_bytes,
            restart_bundle_digest,
        })
    }

    #[must_use]
    pub fn restart_bundle_digest(bytes: &[u8]) -> DigestV1 {
        digest(RESTART_BUNDLE_DOMAIN, &[bytes])
    }

    #[must_use]
    pub const fn semantic_intent(&self) -> Option<ProposalV1> {
        self.semantic_intent
    }

    #[must_use]
    pub const fn semantic_trace(&self) -> SemanticTraceV1 {
        self.semantic_trace
    }

    #[must_use]
    pub const fn checkpoint_before_digest(&self) -> DigestV1 {
        self.checkpoint_before_digest
    }

    #[must_use]
    pub const fn checkpoint_after_digest(&self) -> DigestV1 {
        self.checkpoint_after_digest
    }

    #[must_use]
    pub fn restart_bundle_bytes(&self) -> &[u8] {
        &self.restart_bundle_bytes
    }

    #[must_use]
    pub const fn declared_restart_bundle_digest(&self) -> DigestV1 {
        self.restart_bundle_digest
    }
}

pub trait LifecycleProgramHost {
    type Fault: Error + Send + Sync + 'static;

    fn consumed_identities(&self) -> ConsumedProgramIdentitiesV1;

    /// Consumes one normalized event without owning or submitting an order.
    ///
    /// # Errors
    ///
    /// Returns the host's sealed failure without granting the adapter an order output.
    fn consume(
        &mut self,
        event: &NormalizedLifecycleEventV1,
    ) -> Result<HostLifecycleOutcomeV1, Self::Fault>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(
    clippy::struct_field_names,
    reason = "the suffix distinguishes the three different identity authorities"
)]
pub struct SimulatedOrderAssociationV1 {
    client_identity: IdentityV1,
    order_identity: IdentityV1,
    intent_identity: IdentityV1,
}

impl SimulatedOrderAssociationV1 {
    #[must_use]
    pub const fn client_identity(&self) -> IdentityV1 {
        self.client_identity
    }

    #[must_use]
    pub const fn order_identity(&self) -> IdentityV1 {
        self.order_identity
    }

    #[must_use]
    pub const fn intent_identity(&self) -> IdentityV1 {
        self.intent_identity
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SimulatedOrderIntentV1 {
    association: SimulatedOrderAssociationV1,
    side: FillSideV1,
    delta_units: i64,
    requested_units: u64,
    reduce_only: bool,
    proposal_digest: DigestV1,
}

impl SimulatedOrderIntentV1 {
    #[must_use]
    pub const fn association(&self) -> SimulatedOrderAssociationV1 {
        self.association
    }

    #[must_use]
    pub const fn side(&self) -> FillSideV1 {
        self.side
    }

    #[must_use]
    pub const fn delta_units(&self) -> i64 {
        self.delta_units
    }

    #[must_use]
    pub const fn requested_units(&self) -> u64 {
        self.requested_units
    }

    #[must_use]
    pub const fn reduce_only(&self) -> bool {
        self.reduce_only
    }

    #[must_use]
    pub const fn proposal_digest(&self) -> DigestV1 {
        self.proposal_digest
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SimExchangeFillObservationV1 {
    association: SimulatedOrderAssociationV1,
    side: FillSideV1,
    disposition: FillDispositionV1,
    cumulative_filled_units: u64,
    logical_time_ns: u64,
    event_time_ns: u64,
    owner_sequence: u64,
    source: LifecycleSourceEvidenceV1,
}

impl SimExchangeFillObservationV1 {
    #[must_use]
    pub const fn association(&self) -> SimulatedOrderAssociationV1 {
        self.association
    }

    pub(crate) const fn intent_identity(&self) -> IdentityV1 {
        self.association.intent_identity
    }

    pub(crate) const fn side(&self) -> FillSideV1 {
        self.side
    }

    pub(crate) const fn disposition(&self) -> FillDispositionV1 {
        self.disposition
    }

    pub(crate) const fn cumulative_filled_units(&self) -> u64 {
        self.cumulative_filled_units
    }

    pub(crate) const fn logical_time_ns(&self) -> u64 {
        self.logical_time_ns
    }

    pub(crate) const fn event_time_ns(&self) -> u64 {
        self.event_time_ns
    }

    pub(crate) const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }

    pub(crate) const fn source_evidence(&self) -> LifecycleSourceEvidenceV1 {
        self.source
    }
}

#[derive(Clone, Debug)]
#[allow(
    dead_code,
    reason = "private replay evidence is retained for the future engine-owned reconciler"
)]
pub(crate) struct ReplayRecordV1 {
    pub event: NormalizedLifecycleEventV1,
    pub outcome: HostLifecycleOutcomeV1,
    pub association: Option<SimulatedOrderAssociationV1>,
}

#[derive(Clone, Debug)]
struct TrackedOrderV1 {
    intent: SimulatedOrderIntentV1,
    last_cumulative_filled_units: u64,
    terminal: bool,
}

#[derive(Debug)]
#[allow(
    dead_code,
    reason = "private result bindings remain sealed until engine-owned reconciliation exists"
)]
pub struct StrategyReplayAdapterV1<H> {
    pub(crate) request_digest: DigestV1,
    pub(crate) replay_digest: DigestV1,
    pub(crate) simulator_digest: DigestV1,
    pub(crate) cost_model_digest: DigestV1,
    pub(crate) host: H,
    pub(crate) consumed_identities: ConsumedProgramIdentitiesV1,
    pub(crate) records: Vec<ReplayRecordV1>,
    last_order: Option<(u64, u64, u8, u64, IdentityV1)>,
    replayed: BTreeMap<IdentityV1, (NormalizedLifecycleEventV1, Option<SimulatedOrderIntentV1>)>,
    orders: BTreeMap<IdentityV1, TrackedOrderV1>,
}

impl<H: LifecycleProgramHost> StrategyReplayAdapterV1<H> {
    /// Creates an adapter bound to one replay and the host's consumed identities.
    ///
    /// # Errors
    ///
    /// Returns an error when a required replay or consumed-program identity is absent.
    pub fn new(
        request_digest: DigestV1,
        replay_digest: DigestV1,
        simulator_digest: DigestV1,
        cost_model_digest: DigestV1,
        host: H,
    ) -> Result<Self, AdapterFaultV1> {
        if [
            request_digest,
            replay_digest,
            simulator_digest,
            cost_model_digest,
        ]
        .iter()
        .any(|value| is_zero(value))
        {
            return Err(AdapterFaultV1::MissingReplayIdentity);
        }
        let consumed_identities = host.consumed_identities();
        consumed_identities.validate()?;
        Ok(Self {
            request_digest,
            replay_digest,
            simulator_digest,
            cost_model_digest,
            host,
            consumed_identities,
            records: Vec::new(),
            last_order: None,
            replayed: BTreeMap::new(),
            orders: BTreeMap::new(),
        })
    }

    /// Consumes one event and returns only a typed simulated-order intent, when present.
    ///
    /// # Errors
    ///
    /// Returns an error before host invocation for malformed/conflicting order, or after host
    /// invocation when its sealed output cannot be validated or mapped without crossing zero.
    pub fn consume(
        &mut self,
        event: NormalizedLifecycleEventV1,
    ) -> Result<Option<SimulatedOrderIntentV1>, AdapterFaultV1> {
        encode_envelope_v1(event.envelope()).map_err(|_| AdapterFaultV1::MalformedEvent)?;
        let identity = event.envelope().order_key.event_identity;
        if let Some((existing, output)) = self.replayed.get(&identity) {
            if existing == &event {
                return Ok(*output);
            }
            return Err(AdapterFaultV1::ConflictingEventIdentity);
        }
        let current_order = order_tuple(event.envelope().order_key);
        if self.last_order.is_some_and(|last| current_order <= last) {
            return Err(AdapterFaultV1::OrderingRegression);
        }

        let outcome = self
            .host
            .consume(&event)
            .map_err(|e| AdapterFaultV1::Host(e.to_string()))?;
        validate_host_outcome(&event, &outcome)?;
        let order = outcome
            .semantic_intent
            .map(|proposal| self.map_intent(proposal, &outcome.semantic_trace))
            .transpose()?
            .flatten();
        let association = order.map(|value| value.association);

        if let Some(order) = order {
            if self.orders.contains_key(&order.association.order_identity) {
                return Err(AdapterFaultV1::DuplicateOrderIdentity);
            }
            self.orders.insert(
                order.association.order_identity,
                TrackedOrderV1 {
                    intent: order,
                    last_cumulative_filled_units: 0,
                    terminal: false,
                },
            );
        }
        self.records.push(ReplayRecordV1 {
            event: event.clone(),
            outcome,
            association,
        });
        self.last_order = Some(current_order);
        self.replayed.insert(identity, (event, order));
        Ok(order)
    }

    /// Consumes a source that has already been canonically ordered.
    ///
    /// # Errors
    ///
    /// Returns the first event or host boundary failure.
    pub fn consume_source(
        &mut self,
        source: &StrategyReplaySourceV1,
    ) -> Result<Vec<SimulatedOrderIntentV1>, AdapterFaultV1> {
        let mut orders = Vec::new();

        for event in source.events() {
            if let Some(order) = self.consume(event.clone())? {
                orders.push(order);
            }
        }
        Ok(orders)
    }

    #[allow(clippy::too_many_arguments)]
    /// Seals one Sim Exchange observation against an adapter-created order association.
    ///
    /// # Errors
    ///
    /// Returns an error for an unknown/terminal order, a cumulative regression, or an invalid
    /// partial/full/reject/cancel terminal.
    pub fn seal_fill_observation(
        &mut self,
        order_identity: IdentityV1,
        disposition: FillDispositionV1,
        cumulative_filled_units: u64,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
        source: LifecycleSourceEvidenceV1,
    ) -> Result<SimExchangeFillObservationV1, AdapterFaultV1> {
        let tracked = self
            .orders
            .get(&order_identity)
            .ok_or(AdapterFaultV1::UnknownOrderIdentity)?;

        if tracked.terminal
            || cumulative_filled_units < tracked.last_cumulative_filled_units
            || !valid_terminal_cumulative(
                disposition,
                cumulative_filled_units,
                tracked.intent.requested_units,
            )
            || matches!(disposition, FillDispositionV1::PartiallyFilled)
                && cumulative_filled_units <= tracked.last_cumulative_filled_units
            || matches!(disposition, FillDispositionV1::Rejected)
                && (cumulative_filled_units != 0 || tracked.last_cumulative_filled_units != 0)
            || matches!(disposition, FillDispositionV1::Canceled)
                && cumulative_filled_units != tracked.last_cumulative_filled_units
        {
            return Err(AdapterFaultV1::InvalidFillObservation);
        }
        let observation = SimExchangeFillObservationV1 {
            association: tracked.intent.association,
            side: tracked.intent.side,
            disposition,
            cumulative_filled_units,
            logical_time_ns,
            event_time_ns,
            owner_sequence,
            source,
        };
        let event = NormalizedLifecycleEventV1::fill(self.replay_digest, &observation)
            .map_err(|_| AdapterFaultV1::MalformedEvent)?;
        encode_envelope_v1(event.envelope()).map_err(|_| AdapterFaultV1::MalformedEvent)?;
        let identity = event.envelope().order_key.event_identity;
        if let Some((existing, _)) = self.replayed.get(&identity) {
            return Err(if existing == &event {
                AdapterFaultV1::OrderingRegression
            } else {
                AdapterFaultV1::ConflictingEventIdentity
            });
        }
        let current_order = order_tuple(event.envelope().order_key);
        if self.last_order.is_some_and(|last| current_order <= last) {
            return Err(AdapterFaultV1::OrderingRegression);
        }

        let tracked = self
            .orders
            .get_mut(&order_identity)
            .ok_or(AdapterFaultV1::UnknownOrderIdentity)?;
        tracked.last_cumulative_filled_units = cumulative_filled_units;
        tracked.terminal = !matches!(disposition, FillDispositionV1::PartiallyFilled);
        Ok(observation)
    }

    /// Converts a sealed Sim Exchange observation into the exact SDK fill envelope.
    ///
    /// # Errors
    ///
    /// Returns an error when the observation cannot form a canonical lifecycle envelope.
    pub fn fill_event(
        &self,
        observation: &SimExchangeFillObservationV1,
    ) -> Result<NormalizedLifecycleEventV1, SourceNormalizationFaultV1> {
        NormalizedLifecycleEventV1::fill(self.replay_digest, observation)
    }

    fn map_intent(
        &self,
        proposal: ProposalV1,
        trace: &SemanticTraceV1,
    ) -> Result<Option<SimulatedOrderIntentV1>, AdapterFaultV1> {
        if proposal.position == PositionIntentV1::Hold {
            if proposal.reconciliation_target_units.is_some() {
                return Err(AdapterFaultV1::InvalidTargetDelta);
            }
            return Ok(None);
        }
        let current = trace.position_before_units;
        let target = proposal
            .reconciliation_target_units
            .ok_or(AdapterFaultV1::InvalidTargetDelta)?;
        let delta = target
            .checked_sub(current)
            .ok_or(AdapterFaultV1::InvalidTargetDelta)?;
        if delta == 0 {
            return Err(AdapterFaultV1::InvalidTargetDelta);
        }
        let valid = match proposal.position {
            PositionIntentV1::Enter => current == 0 && target != 0,
            PositionIntentV1::Add => {
                current != 0
                    && target.signum() == current.signum()
                    && target.unsigned_abs() > current.unsigned_abs()
            }
            PositionIntentV1::Reduce => {
                current != 0
                    && target != 0
                    && target.signum() == current.signum()
                    && target.unsigned_abs() < current.unsigned_abs()
            }
            PositionIntentV1::Exit => current != 0 && target == 0,
            PositionIntentV1::Hold => false,
        };

        if !valid {
            return Err(AdapterFaultV1::InvalidTargetDelta);
        }
        let requested_units = delta.unsigned_abs();
        let client_identity = identity(
            CLIENT_IDENTITY_DOMAIN,
            &[&self.replay_digest, &proposal.intent_identity],
        );
        let order_identity = identity(
            ORDER_IDENTITY_DOMAIN,
            &[
                &self.replay_digest,
                &proposal.intent_identity,
                &proposal.proposal_digest,
            ],
        );
        Ok(Some(SimulatedOrderIntentV1 {
            association: SimulatedOrderAssociationV1 {
                client_identity,
                order_identity,
                intent_identity: proposal.intent_identity,
            },
            side: fill_side_from_delta(delta),
            delta_units: delta,
            requested_units,
            reduce_only: matches!(
                proposal.position,
                PositionIntentV1::Reduce | PositionIntentV1::Exit
            ),
            proposal_digest: proposal.proposal_digest,
        }))
    }
}

fn validate_host_outcome(
    event: &NormalizedLifecycleEventV1,
    outcome: &HostLifecycleOutcomeV1,
) -> Result<(), AdapterFaultV1> {
    let trace = outcome.semantic_trace;
    if trace.order_key != Some(event.envelope().order_key)
        || trace.envelope_digest != event.envelope().envelope_digest
        || trace.schema_version == 0
    {
        return Err(AdapterFaultV1::MalformedHostOutcome);
    }
    let proposal_required = matches!(
        event.envelope().order_key.kind,
        LifecycleKind::Bar | LifecycleKind::Event | LifecycleKind::Timer
    );

    if proposal_required != outcome.semantic_intent.is_some() {
        return Err(AdapterFaultV1::MalformedHostOutcome);
    }

    match outcome.semantic_intent {
        Some(proposal)
            if trace.proposal_digest == proposal.proposal_digest
                && trace.position_intent == proposal.position
                && target_state_matches(trace.target, proposal.target)
                && trace.target_semantic == target_semantic(proposal.target)
                && trace.strategy_state_digest == proposal.strategy_state_digest
                && trace.plugin_state_digest == proposal.plugin_state_digest => {}
        None if is_zero(&trace.proposal_digest) => {}
        _ => return Err(AdapterFaultV1::MalformedHostOutcome),
    }
    Ok(())
}

fn target_state_matches(trace: TargetStateV1, proposal: TargetProposalV1) -> bool {
    proposal == TargetProposalV1::Keep || trace == TargetStateV1::from(proposal)
}

const fn target_semantic(target: TargetProposalV1) -> TargetSemanticV1 {
    match target {
        TargetProposalV1::Keep => TargetSemanticV1::None,
        TargetProposalV1::Position(_) => TargetSemanticV1::Position,
        TargetProposalV1::WeightMicros(_) => TargetSemanticV1::Weight,
        TargetProposalV1::RebalancePosition { .. }
        | TargetProposalV1::RebalanceWeightMicros { .. } => TargetSemanticV1::Rebalance,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterFaultV1 {
    MissingReplayIdentity,
    MissingConsumedIdentity,
    MalformedEvent,
    OrderingRegression,
    ConflictingEventIdentity,
    MalformedHostOutcome,
    InvalidTargetDelta,
    DuplicateOrderIdentity,
    UnknownOrderIdentity,
    InvalidFillObservation,
    Host(String),
}

impl Display for AdapterFaultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "strategy replay adapter fault: {self:?}")
    }
}

impl Error for AdapterFaultV1 {}
