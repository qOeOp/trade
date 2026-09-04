//! Market Data-owned positive composition binding for Replay Market Facts V2.
//!
//! The public boundary accepts only one exact content-addressed binding locator. Positive
//! records are issued from already authenticated Owner evidence, cross-bind the complete role
//! registry and native dependency chain, and then reuse the unchanged Replay V2 issuer.

#![allow(
    dead_code,
    reason = "the sealed positive composition is candidate-private until store admission wires its resolver"
)]

use std::fmt::Display;

use serde::{Deserialize, Serialize};

use super::{
    ReplayMarketDependencyKindV2, ReplayMarketFactsErrorV2, ReplayMarketFactsReadbackV2,
    UntrustedReplayMarketFactsRequestV2,
    authority::{ReplayMarketFactsEvidenceV2, issue_replay_market_facts_v2},
};
use crate::owner::{
    pit_snapshot::UntrustedPitSnapshotLocator,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    strategy_design_role_set::StrategyDesignRoleSetLocatorV1,
};

const RECORD_DOMAIN: &[u8] = b"vibe.market-data.replay-composition-binding.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.replay-composition-binding-receipt.v1\0";
const SCHEMA_VERSION: u16 = 1;
const NATIVE_LOCATOR_COUNT: usize = 5;
const MAX_ROLES: usize = 4_096;

/// Fixed native authorities named by a positive composition binding.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u16)]
pub(crate) enum ReplayCompositionNativeLocatorKindV1 {
    PitSnapshot = 1,
    SourceBinding = 2,
    UniverseSelection = 3,
    InstrumentMaster = 4,
    MarketSemantics = 5,
}

/// Exact content-addressed reference authenticated by its native Owner before binding issuance.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReplayCompositionNativeLocatorV1 {
    pub(crate) kind: ReplayCompositionNativeLocatorKindV1,
    pub(crate) identity: BindingDigest,
    pub(crate) digest: BindingDigest,
}

/// One authenticated registry declaration and its exact issued binding.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReplayCompositionRoleEvidenceV1 {
    pub(crate) role_identity: BindingDigest,
    pub(crate) declaration_identity: BindingDigest,
    pub(crate) declaration_digest: BindingDigest,
    pub(crate) binding_identity: BindingDigest,
    pub(crate) binding_digest: BindingDigest,
}

/// Owner-private complete evidence. No public caller can construct a positive binding from it.
pub(crate) struct ReplayCompositionBindingEvidenceV1 {
    pub(crate) authenticated_strategy_design_identity: BindingDigest,
    pub(crate) authenticated_strategy_design_digest: BindingDigest,
    pub(crate) registry_identity: BindingDigest,
    pub(crate) registry_digest: BindingDigest,
    pub(crate) native_locators: Vec<ReplayCompositionNativeLocatorV1>,
    pub(crate) roles: Vec<ReplayCompositionRoleEvidenceV1>,
    pub(crate) census_identity: BindingDigest,
    pub(crate) census_digest: BindingDigest,
    pub(crate) census_roles: Vec<BindingDigest>,
    pub(crate) joined_cut_identity: BindingDigest,
    pub(crate) joined_cut_digest: BindingDigest,
    pub(crate) joined_cut_roles: Vec<(BindingDigest, BindingDigest)>,
    pub(crate) sample_projection_identity: BindingDigest,
    pub(crate) sample_projection_digest: BindingDigest,
    pub(crate) sample_projection_roles: Vec<(BindingDigest, BindingDigest)>,
    pub(crate) stable_correlation: BindingDigest,
}

/// Untrusted content-addressed locator. Copying these bytes grants no Owner authority.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionBindingLocatorV1 {
    binding_identity: BindingDigest,
    binding_digest: BindingDigest,
}

/// Exact request identity/meaning locator for one already-durable Market Data record.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionRequestLocatorV1 {
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
}

impl ReplayCompositionRequestLocatorV1 {
    #[must_use]
    pub const fn from_untrusted(
        request_identity: BindingDigest,
        request_meaning_digest: BindingDigest,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
        }
    }

    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }
}

/// Exact identity/digest locator for one already-durable content-addressed record.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionContentLocatorV1 {
    identity: BindingDigest,
    digest: BindingDigest,
}

impl ReplayCompositionContentLocatorV1 {
    #[must_use]
    pub const fn from_untrusted(identity: BindingDigest, digest: BindingDigest) -> Self {
        Self { identity, digest }
    }

    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Locator-only W3 issuance command.
///
/// Every positive semantic coordinate and complete role count is derived from the fixed R&D
/// readback and exact Market Data custody. None can be supplied by the caller.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionBindingIssuanceRequestV1 {
    composer_locator: StrategyDesignRoleSetLocatorV1,
    pit_locator: UntrustedPitSnapshotLocator,
    source_binding_locator: UntrustedSourceBindingLocator,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    instrument_master_locator: ReplayCompositionRequestLocatorV1,
    universe_selection_locator: ReplayCompositionRequestLocatorV1,
    observation_census_locator: ReplayCompositionRequestLocatorV1,
    joined_cut_locator: ReplayCompositionContentLocatorV1,
    sample_projection_locator: ReplayCompositionContentLocatorV1,
    reference_fact_r0_locator: ReplayCompositionRequestLocatorV1,
    calendar_locator: ReplayCompositionRequestLocatorV1,
    session_locator: ReplayCompositionRequestLocatorV1,
    time_zone_locator: ReplayCompositionRequestLocatorV1,
    market_semantics_locator: ReplayCompositionRequestLocatorV1,
    correction_policy_locator: ReplayCompositionContentLocatorV1,
    corporate_action_locator: ReplayCompositionRequestLocatorV1,
}

impl ReplayCompositionBindingIssuanceRequestV1 {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) const fn from_test_fixture(
        composer_locator: StrategyDesignRoleSetLocatorV1,
        pit_locator: UntrustedPitSnapshotLocator,
        source_binding_locator: UntrustedSourceBindingLocator,
        replay_start_event_ns: i128,
        replay_end_event_ns_exclusive: i128,
        instrument_master_locator: ReplayCompositionRequestLocatorV1,
        universe_selection_locator: ReplayCompositionRequestLocatorV1,
        observation_census_locator: ReplayCompositionRequestLocatorV1,
        joined_cut_locator: ReplayCompositionContentLocatorV1,
        sample_projection_locator: ReplayCompositionContentLocatorV1,
        reference_fact_r0_locator: ReplayCompositionRequestLocatorV1,
        calendar_locator: ReplayCompositionRequestLocatorV1,
        session_locator: ReplayCompositionRequestLocatorV1,
        time_zone_locator: ReplayCompositionRequestLocatorV1,
        market_semantics_locator: ReplayCompositionRequestLocatorV1,
        correction_policy_locator: ReplayCompositionContentLocatorV1,
        corporate_action_locator: ReplayCompositionRequestLocatorV1,
    ) -> Self {
        Self {
            composer_locator,
            pit_locator,
            source_binding_locator,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
            instrument_master_locator,
            universe_selection_locator,
            observation_census_locator,
            joined_cut_locator,
            sample_projection_locator,
            reference_fact_r0_locator,
            calendar_locator,
            session_locator,
            time_zone_locator,
            market_semantics_locator,
            correction_policy_locator,
            corporate_action_locator,
        }
    }

    #[must_use]
    pub const fn composer_locator(&self) -> &StrategyDesignRoleSetLocatorV1 {
        &self.composer_locator
    }

    #[must_use]
    pub const fn pit_locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.pit_locator
    }

    #[must_use]
    pub const fn source_binding_locator(&self) -> &UntrustedSourceBindingLocator {
        &self.source_binding_locator
    }

    #[must_use]
    pub const fn replay_start_event_ns(&self) -> i128 {
        self.replay_start_event_ns
    }

    #[must_use]
    pub const fn replay_end_event_ns_exclusive(&self) -> i128 {
        self.replay_end_event_ns_exclusive
    }

    #[must_use]
    pub const fn instrument_master_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.instrument_master_locator
    }

    #[must_use]
    pub const fn universe_selection_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.universe_selection_locator
    }

    #[must_use]
    pub const fn observation_census_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.observation_census_locator
    }

    #[must_use]
    pub const fn joined_cut_locator(&self) -> ReplayCompositionContentLocatorV1 {
        self.joined_cut_locator
    }

    #[must_use]
    pub const fn sample_projection_locator(&self) -> ReplayCompositionContentLocatorV1 {
        self.sample_projection_locator
    }

    #[must_use]
    pub const fn reference_fact_r0_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.reference_fact_r0_locator
    }

    #[must_use]
    pub const fn calendar_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.calendar_locator
    }

    #[must_use]
    pub const fn session_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.session_locator
    }

    #[must_use]
    pub const fn time_zone_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.time_zone_locator
    }

    #[must_use]
    pub const fn market_semantics_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.market_semantics_locator
    }

    #[must_use]
    pub const fn correction_policy_locator(&self) -> ReplayCompositionContentLocatorV1 {
        self.correction_policy_locator
    }

    #[must_use]
    pub const fn corporate_action_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.corporate_action_locator
    }

    #[must_use]
    pub fn replay_request(&self) -> UntrustedReplayMarketFactsRequestV2 {
        UntrustedReplayMarketFactsRequestV2::new(
            self.pit_locator.clone(),
            self.replay_start_event_ns,
            self.replay_end_event_ns_exclusive,
        )
    }
}

impl ReplayCompositionBindingLocatorV1 {
    #[must_use]
    pub const fn from_untrusted(
        binding_identity: BindingDigest,
        binding_digest: BindingDigest,
    ) -> Self {
        Self {
            binding_identity,
            binding_digest,
        }
    }

    #[must_use]
    pub const fn binding_identity(&self) -> BindingDigest {
        self.binding_identity
    }

    #[must_use]
    pub const fn binding_digest(&self) -> BindingDigest {
        self.binding_digest
    }
}

/// Additive request that cannot omit or infer the exact composition binding.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedReplayMarketFactsCompositionRequestV1 {
    replay_v2_request: UntrustedReplayMarketFactsRequestV2,
    binding_locator: ReplayCompositionBindingLocatorV1,
}

impl UntrustedReplayMarketFactsCompositionRequestV1 {
    #[must_use]
    pub const fn new(
        replay_v2_request: UntrustedReplayMarketFactsRequestV2,
        binding_locator: ReplayCompositionBindingLocatorV1,
    ) -> Self {
        Self {
            replay_v2_request,
            binding_locator,
        }
    }

    #[must_use]
    pub const fn replay_v2_request(&self) -> &UntrustedReplayMarketFactsRequestV2 {
        &self.replay_v2_request
    }

    #[must_use]
    pub const fn binding_locator(&self) -> ReplayCompositionBindingLocatorV1 {
        self.binding_locator
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReplayCompositionRoleV1 {
    role_identity: BindingDigest,
    declaration_identity: BindingDigest,
    declaration_digest: BindingDigest,
    binding_identity: BindingDigest,
    binding_digest: BindingDigest,
}

/// Immutable Market Data composition record. It has no public constructor or deserializer.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayCompositionBindingV1 {
    replay_request_identity: BindingDigest,
    replay_request_digest: BindingDigest,
    pit_snapshot_identity: BindingDigest,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    strategy_design_identity: BindingDigest,
    strategy_design_digest: BindingDigest,
    registry_identity: BindingDigest,
    registry_digest: BindingDigest,
    native_locators: Box<[ReplayCompositionNativeLocatorV1]>,
    roles: Box<[ReplayCompositionRoleV1]>,
    census_identity: BindingDigest,
    census_digest: BindingDigest,
    joined_cut_identity: BindingDigest,
    joined_cut_digest: BindingDigest,
    sample_projection_identity: BindingDigest,
    sample_projection_digest: BindingDigest,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayCompositionBindingV1 {
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }

    #[must_use]
    pub const fn role_count(&self) -> usize {
        self.roles.len()
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn locator(&self) -> ReplayCompositionBindingLocatorV1 {
        ReplayCompositionBindingLocatorV1 {
            binding_identity: self.identity,
            binding_digest: self.identity,
        }
    }
}

/// Receipt for the exact binding record and stable correlation.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayCompositionBindingReceiptV1 {
    binding_identity: BindingDigest,
    binding_digest: BindingDigest,
    stable_correlation: BindingDigest,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayCompositionBindingReceiptV1 {
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Exact outbox payload. Its identity is the receipt identity; no second identity is invented.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayCompositionBindingOutboxV1 {
    identity: BindingDigest,
    payload: Box<[u8]>,
}

impl ReplayCompositionBindingOutboxV1 {
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    #[must_use]
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }
}

/// Move-only complete binding custody.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayCompositionBindingReadbackV1 {
    record: ReplayCompositionBindingV1,
    receipt: ReplayCompositionBindingReceiptV1,
    outbox: ReplayCompositionBindingOutboxV1,
}

impl ReplayCompositionBindingReadbackV1 {
    #[must_use]
    pub const fn record(&self) -> &ReplayCompositionBindingV1 {
        &self.record
    }

    #[must_use]
    pub const fn receipt(&self) -> &ReplayCompositionBindingReceiptV1 {
        &self.receipt
    }

    #[must_use]
    pub const fn outbox(&self) -> &ReplayCompositionBindingOutboxV1 {
        &self.outbox
    }
}

/// Serializable exact-byte view of an authenticated binding readback.
///
/// It deliberately implements no deserializer; API bytes do not become Market Data authority on
/// a round trip through an untrusted caller.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct ReplayCompositionBindingResponseV1 {
    locator: ReplayCompositionBindingLocatorV1,
    receipt_identity: BindingDigest,
    record_bytes: Box<[u8]>,
    receipt_bytes: Box<[u8]>,
    outbox_bytes: Box<[u8]>,
}

/// Exact authenticated W3 response for both binding and unchanged Replay V2 custody.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct ReplayCompositionIssuanceResponseV1 {
    binding: ReplayCompositionBindingResponseV1,
    replay_facts_identity: BindingDigest,
    replay_receipt_identity: BindingDigest,
    replay_facts_bytes: Box<[u8]>,
    replay_frontier_bytes: Box<[u8]>,
    replay_receipt_bytes: Box<[u8]>,
}

impl ReplayCompositionIssuanceResponseV1 {
    pub(crate) fn from_authenticated(
        binding: &ReplayCompositionBindingReadbackV1,
        replay: &ReplayMarketFactsReadbackV2,
    ) -> Self {
        Self {
            binding: ReplayCompositionBindingResponseV1::from_authenticated(binding),
            replay_facts_identity: replay.facts().identity(),
            replay_receipt_identity: replay.receipt().identity(),
            replay_facts_bytes: replay.facts().canonical_bytes().into(),
            replay_frontier_bytes: replay.facts().frontier().canonical_bytes().into(),
            replay_receipt_bytes: replay.receipt().canonical_bytes().into(),
        }
    }

    pub(crate) fn from_exact_storage(
        binding: &ReplayCompositionBindingReadbackV1,
        replay_facts_identity: BindingDigest,
        replay_receipt_identity: BindingDigest,
        replay_facts_bytes: &[u8],
        replay_frontier_bytes: &[u8],
        replay_receipt_bytes: &[u8],
    ) -> Self {
        Self {
            binding: ReplayCompositionBindingResponseV1::from_authenticated(binding),
            replay_facts_identity,
            replay_receipt_identity,
            replay_facts_bytes: replay_facts_bytes.into(),
            replay_frontier_bytes: replay_frontier_bytes.into(),
            replay_receipt_bytes: replay_receipt_bytes.into(),
        }
    }
}

impl ReplayCompositionBindingResponseV1 {
    pub(crate) fn from_authenticated(readback: &ReplayCompositionBindingReadbackV1) -> Self {
        Self {
            locator: readback.record().locator(),
            receipt_identity: readback.receipt().identity(),
            record_bytes: readback.record().canonical_bytes().into(),
            receipt_bytes: readback.receipt().canonical_bytes().into(),
            outbox_bytes: readback.outbox().payload().into(),
        }
    }

    #[must_use]
    pub const fn locator(&self) -> ReplayCompositionBindingLocatorV1 {
        self.locator
    }

    #[must_use]
    pub const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_identity
    }

    #[must_use]
    pub fn record_bytes(&self) -> &[u8] {
        &self.record_bytes
    }

    #[must_use]
    pub fn receipt_bytes(&self) -> &[u8] {
        &self.receipt_bytes
    }

    #[must_use]
    pub fn outbox_bytes(&self) -> &[u8] {
        &self.outbox_bytes
    }
}

pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

/// Sealed positive resolver. The only entry is the exact locator-bearing composition request.
#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait ReplayCompositionBindingResolverV1: resolver_seal::Sealed + Send + Sync {
    async fn resolve_replay_market_facts_composition_v1(
        &self,
        request: &UntrustedReplayMarketFactsCompositionRequestV1,
    ) -> Result<ReplayMarketFactsReadbackV2, ReplayCompositionBindingErrorV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayCompositionBindingErrorV1 {
    InvalidRequest,
    IncompleteComposition,
    NonCanonicalOrder,
    DependencyMismatch,
    DigestMismatch,
    UnknownBinding,
    AmbiguousBinding,
    LegacyUnbound,
    ReplayV2Unavailable,
}

impl Display for ReplayCompositionBindingErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ReplayCompositionBindingErrorV1 {}

pub(crate) fn issue_replay_composition_binding_v1(
    request: &UntrustedReplayMarketFactsRequestV2,
    mut evidence: ReplayCompositionBindingEvidenceV1,
) -> Result<ReplayCompositionBindingReadbackV1, ReplayCompositionBindingErrorV1> {
    validate_request(request)?;
    evidence.native_locators.sort_by_key(|locator| locator.kind);
    evidence.roles.sort_by_key(|role| role.role_identity);
    evidence.census_roles.sort();
    evidence.joined_cut_roles.sort();
    evidence.sample_projection_roles.sort();
    validate_evidence(request, &evidence)?;

    let roles = evidence
        .roles
        .iter()
        .map(|role| ReplayCompositionRoleV1 {
            role_identity: role.role_identity,
            declaration_identity: role.declaration_identity,
            declaration_digest: role.declaration_digest,
            binding_identity: role.binding_identity,
            binding_digest: role.binding_digest,
        })
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let mut record = ReplayCompositionBindingV1 {
        replay_request_identity: request.pit_locator().request_identity,
        replay_request_digest: request.pit_locator().request_digest,
        pit_snapshot_identity: request.pit_locator().snapshot_identity,
        replay_start_event_ns: request.replay_start_event_ns(),
        replay_end_event_ns_exclusive: request.replay_end_event_ns_exclusive(),
        strategy_design_identity: evidence.authenticated_strategy_design_identity,
        strategy_design_digest: evidence.authenticated_strategy_design_digest,
        registry_identity: evidence.registry_identity,
        registry_digest: evidence.registry_digest,
        native_locators: evidence.native_locators.into_boxed_slice(),
        roles,
        census_identity: evidence.census_identity,
        census_digest: evidence.census_digest,
        joined_cut_identity: evidence.joined_cut_identity,
        joined_cut_digest: evidence.joined_cut_digest,
        sample_projection_identity: evidence.sample_projection_identity,
        sample_projection_digest: evidence.sample_projection_digest,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    record.canonical_bytes = encode_record(&record).into_boxed_slice();
    record.identity = hash(RECORD_DOMAIN, &record.canonical_bytes);
    let mut receipt = ReplayCompositionBindingReceiptV1 {
        binding_identity: record.identity,
        binding_digest: record.identity,
        stable_correlation: evidence.stable_correlation,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    receipt.canonical_bytes = encode_receipt(&receipt).into_boxed_slice();
    receipt.identity = hash(RECEIPT_DOMAIN, &receipt.canonical_bytes);
    let outbox = ReplayCompositionBindingOutboxV1 {
        identity: receipt.identity,
        payload: receipt.canonical_bytes.clone(),
    };
    let readback = ReplayCompositionBindingReadbackV1 {
        record,
        receipt,
        outbox,
    };
    verify_replay_composition_binding_v1(&readback)
        .then_some(readback)
        .ok_or(ReplayCompositionBindingErrorV1::DigestMismatch)
}

pub(crate) fn compose_replay_market_facts_v2(
    request: &UntrustedReplayMarketFactsCompositionRequestV1,
    binding: &ReplayCompositionBindingReadbackV1,
    evidence: ReplayMarketFactsEvidenceV2,
) -> Result<ReplayMarketFactsReadbackV2, ReplayCompositionBindingErrorV1> {
    if !verify_replay_composition_binding_v1(binding)
        || request.binding_locator() != binding.record.locator()
    {
        return Err(ReplayCompositionBindingErrorV1::UnknownBinding);
    }
    let record = binding.record();
    let replay = request.replay_v2_request();
    if record.replay_request_identity != replay.pit_locator().request_identity
        || record.replay_request_digest != replay.pit_locator().request_digest
        || record.pit_snapshot_identity != replay.pit_locator().snapshot_identity
        || record.replay_start_event_ns != replay.replay_start_event_ns()
        || record.replay_end_event_ns_exclusive != replay.replay_end_event_ns_exclusive()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    validate_v2_evidence(record, &evidence)?;
    issue_replay_market_facts_v2(replay, evidence).map_err(map_v2_error)
}

#[must_use]
pub(crate) fn verify_replay_composition_binding_v1(
    readback: &ReplayCompositionBindingReadbackV1,
) -> bool {
    let record = readback.record();
    let receipt = readback.receipt();
    validate_record(record).is_ok()
        && record.canonical_bytes.as_ref() == encode_record(record)
        && record.identity == hash(RECORD_DOMAIN, &record.canonical_bytes)
        && receipt.binding_identity == record.identity
        && receipt.binding_digest == record.identity
        && nonzero(receipt.stable_correlation)
        && receipt.canonical_bytes.as_ref() == encode_receipt(receipt)
        && receipt.identity == hash(RECEIPT_DOMAIN, &receipt.canonical_bytes)
        && readback.outbox.identity == receipt.identity
        && readback.outbox.payload == receipt.canonical_bytes
}

pub(crate) fn decode_replay_composition_binding_v1(
    record_bytes: &[u8],
    receipt_bytes: &[u8],
    outbox_bytes: &[u8],
) -> Result<ReplayCompositionBindingReadbackV1, ReplayCompositionBindingErrorV1> {
    let mut record_decoder = BindingDecoderV1::new(record_bytes);
    record_decoder.header()?;
    let replay_request_identity = record_decoder.digest()?;
    let replay_request_digest = record_decoder.digest()?;
    let pit_snapshot_identity = record_decoder.digest()?;
    let replay_start_event_ns = record_decoder.i128()?;
    let replay_end_event_ns_exclusive = record_decoder.i128()?;
    let strategy_design_identity = record_decoder.digest()?;
    let strategy_design_digest = record_decoder.digest()?;
    let registry_identity = record_decoder.digest()?;
    let registry_digest = record_decoder.digest()?;
    let native_count = record_decoder.count(NATIVE_LOCATOR_COUNT)?;
    if native_count != NATIVE_LOCATOR_COUNT {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    let mut native_locators = Vec::with_capacity(native_count);

    for ordinal in 1_u16
        ..=u16::try_from(NATIVE_LOCATOR_COUNT)
            .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?
    {
        let raw_kind = record_decoder.u16()?;
        if raw_kind != ordinal {
            return Err(ReplayCompositionBindingErrorV1::NonCanonicalOrder);
        }
        let kind = match raw_kind {
            1 => ReplayCompositionNativeLocatorKindV1::PitSnapshot,
            2 => ReplayCompositionNativeLocatorKindV1::SourceBinding,
            3 => ReplayCompositionNativeLocatorKindV1::UniverseSelection,
            4 => ReplayCompositionNativeLocatorKindV1::InstrumentMaster,
            5 => ReplayCompositionNativeLocatorKindV1::MarketSemantics,
            _ => return Err(ReplayCompositionBindingErrorV1::IncompleteComposition),
        };
        native_locators.push(ReplayCompositionNativeLocatorV1 {
            kind,
            identity: record_decoder.digest()?,
            digest: record_decoder.digest()?,
        });
    }
    let role_count = record_decoder.count(MAX_ROLES)?;
    if role_count == 0 {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    let mut roles = Vec::with_capacity(role_count);
    for _ in 0..role_count {
        roles.push(ReplayCompositionRoleV1 {
            role_identity: record_decoder.digest()?,
            declaration_identity: record_decoder.digest()?,
            declaration_digest: record_decoder.digest()?,
            binding_identity: record_decoder.digest()?,
            binding_digest: record_decoder.digest()?,
        });
    }
    let census_identity = record_decoder.digest()?;
    let census_digest = record_decoder.digest()?;
    let joined_cut_identity = record_decoder.digest()?;
    let joined_cut_digest = record_decoder.digest()?;
    let sample_projection_identity = record_decoder.digest()?;
    let sample_projection_digest = record_decoder.digest()?;
    record_decoder.done()?;
    let record = ReplayCompositionBindingV1 {
        replay_request_identity,
        replay_request_digest,
        pit_snapshot_identity,
        replay_start_event_ns,
        replay_end_event_ns_exclusive,
        strategy_design_identity,
        strategy_design_digest,
        registry_identity,
        registry_digest,
        native_locators: native_locators.into_boxed_slice(),
        roles: roles.into_boxed_slice(),
        census_identity,
        census_digest,
        joined_cut_identity,
        joined_cut_digest,
        sample_projection_identity,
        sample_projection_digest,
        canonical_bytes: record_bytes.into(),
        identity: hash(RECORD_DOMAIN, record_bytes),
    };

    let mut receipt_decoder = BindingDecoderV1::new(receipt_bytes);
    receipt_decoder.header()?;
    let receipt = ReplayCompositionBindingReceiptV1 {
        binding_identity: receipt_decoder.digest()?,
        binding_digest: receipt_decoder.digest()?,
        stable_correlation: receipt_decoder.digest()?,
        canonical_bytes: receipt_bytes.into(),
        identity: hash(RECEIPT_DOMAIN, receipt_bytes),
    };
    receipt_decoder.done()?;
    let readback = ReplayCompositionBindingReadbackV1 {
        record,
        outbox: ReplayCompositionBindingOutboxV1 {
            identity: receipt.identity,
            payload: outbox_bytes.into(),
        },
        receipt,
    };
    verify_replay_composition_binding_v1(&readback)
        .then_some(readback)
        .ok_or(ReplayCompositionBindingErrorV1::DigestMismatch)
}

struct BindingDecoderV1<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> BindingDecoderV1<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take<const N: usize>(&mut self) -> Result<[u8; N], ReplayCompositionBindingErrorV1> {
        let end = self
            .offset
            .checked_add(N)
            .ok_or(ReplayCompositionBindingErrorV1::DigestMismatch)?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(ReplayCompositionBindingErrorV1::DigestMismatch)?;
        self.offset = end;
        bytes
            .try_into()
            .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)
    }

    fn u16(&mut self) -> Result<u16, ReplayCompositionBindingErrorV1> {
        Ok(u16::from_be_bytes(self.take()?))
    }

    fn u32(&mut self) -> Result<u32, ReplayCompositionBindingErrorV1> {
        Ok(u32::from_be_bytes(self.take()?))
    }

    fn i128(&mut self) -> Result<i128, ReplayCompositionBindingErrorV1> {
        Ok(i128::from_be_bytes(self.take()?))
    }

    fn digest(&mut self) -> Result<BindingDigest, ReplayCompositionBindingErrorV1> {
        Ok(BindingDigest::from_untrusted_bytes(self.take()?))
    }

    fn count(&mut self, maximum: usize) -> Result<usize, ReplayCompositionBindingErrorV1> {
        let count = usize::try_from(self.u32()?)
            .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        (count <= maximum)
            .then_some(count)
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)
    }

    fn header(&mut self) -> Result<(), ReplayCompositionBindingErrorV1> {
        if self.u16()? == SCHEMA_VERSION {
            Ok(())
        } else {
            Err(ReplayCompositionBindingErrorV1::DigestMismatch)
        }
    }

    fn done(&self) -> Result<(), ReplayCompositionBindingErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(ReplayCompositionBindingErrorV1::DigestMismatch)
        }
    }
}

fn validate_request(
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    if request.replay_start_event_ns() >= request.replay_end_event_ns_exclusive()
        || !nonzero(request.pit_locator().request_identity)
        || !nonzero(request.pit_locator().request_digest)
        || !nonzero(request.pit_locator().snapshot_identity)
        || !nonzero(request.pit_locator().fact_digest)
    {
        Err(ReplayCompositionBindingErrorV1::InvalidRequest)
    } else {
        Ok(())
    }
}

fn validate_evidence(
    request: &UntrustedReplayMarketFactsRequestV2,
    evidence: &ReplayCompositionBindingEvidenceV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let required = [
        ReplayCompositionNativeLocatorKindV1::PitSnapshot,
        ReplayCompositionNativeLocatorKindV1::SourceBinding,
        ReplayCompositionNativeLocatorKindV1::UniverseSelection,
        ReplayCompositionNativeLocatorKindV1::InstrumentMaster,
        ReplayCompositionNativeLocatorKindV1::MarketSemantics,
    ];

    if evidence.native_locators.len() != NATIVE_LOCATOR_COUNT
        || evidence
            .native_locators
            .iter()
            .map(|locator| locator.kind)
            .ne(required)
        || evidence
            .native_locators
            .iter()
            .any(|locator| !nonzero(locator.identity) || !nonzero(locator.digest))
        || !nonzero(evidence.authenticated_strategy_design_identity)
        || !nonzero(evidence.authenticated_strategy_design_digest)
        || !nonzero(evidence.registry_identity)
        || !nonzero(evidence.registry_digest)
        || !nonzero(evidence.census_identity)
        || !nonzero(evidence.census_digest)
        || !nonzero(evidence.joined_cut_identity)
        || !nonzero(evidence.joined_cut_digest)
        || !nonzero(evidence.sample_projection_identity)
        || !nonzero(evidence.sample_projection_digest)
        || !nonzero(evidence.stable_correlation)
        || evidence.roles.is_empty()
        || evidence.roles.len() > MAX_ROLES
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    let pit = evidence.native_locators[0];
    let source = evidence.native_locators[1];

    if pit.identity != request.pit_locator().snapshot_identity
        || pit.digest != request.pit_locator().fact_digest
        || source.identity != request.pit_locator().source_binding_identity
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }

    if evidence
        .roles
        .windows(2)
        .any(|pair| pair[0].role_identity >= pair[1].role_identity)
        || evidence.roles.iter().any(|role| {
            [
                role.role_identity,
                role.declaration_identity,
                role.declaration_digest,
                role.binding_identity,
                role.binding_digest,
            ]
            .into_iter()
            .any(|value| !nonzero(value))
        })
    {
        return Err(ReplayCompositionBindingErrorV1::NonCanonicalOrder);
    }
    let roles = evidence
        .roles
        .iter()
        .map(|role| role.role_identity)
        .collect::<Vec<_>>();
    let bindings = evidence
        .roles
        .iter()
        .map(|role| (role.role_identity, role.binding_digest))
        .collect::<Vec<_>>();

    if evidence.census_roles != roles
        || evidence.joined_cut_roles != bindings
        || evidence.sample_projection_roles != bindings
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    Ok(())
}

fn validate_record(
    record: &ReplayCompositionBindingV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    if record.native_locators.len() != NATIVE_LOCATOR_COUNT
        || record.roles.is_empty()
        || record.roles.len() > MAX_ROLES
        || record
            .roles
            .windows(2)
            .any(|pair| pair[0].role_identity >= pair[1].role_identity)
        || record.replay_start_event_ns >= record.replay_end_event_ns_exclusive
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    Ok(())
}

fn validate_v2_evidence(
    binding: &ReplayCompositionBindingV1,
    evidence: &ReplayMarketFactsEvidenceV2,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let find = |kind| {
        evidence
            .base_dependencies
            .iter()
            .find(|dependency| dependency.kind() == kind)
    };
    let native = |kind| {
        binding
            .native_locators
            .iter()
            .find(|locator| locator.kind == kind)
    };
    let pairs = [
        (
            ReplayMarketDependencyKindV2::PitSnapshotV1,
            ReplayCompositionNativeLocatorKindV1::PitSnapshot,
        ),
        (
            ReplayMarketDependencyKindV2::SourceBindingV1,
            ReplayCompositionNativeLocatorKindV1::SourceBinding,
        ),
        (
            ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
            ReplayCompositionNativeLocatorKindV1::InstrumentMaster,
        ),
        (
            ReplayMarketDependencyKindV2::UniverseSelectionV1,
            ReplayCompositionNativeLocatorKindV1::UniverseSelection,
        ),
    ];

    for (dependency_kind, native_kind) in pairs {
        let dependency =
            find(dependency_kind).ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let locator =
            native(native_kind).ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        if dependency.identity() != locator.identity || dependency.digest() != locator.digest {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
    }
    let chain = evidence.native_chain;
    if chain.observation_census.identity() != binding.census_identity
        || chain.observation_census.digest() != binding.census_digest
        || chain.joined_cut.identity() != binding.joined_cut_identity
        || chain.joined_cut.digest() != binding.joined_cut_digest
        || chain.sample_projection.identity() != binding.sample_projection_identity
        || chain.sample_projection.digest() != binding.sample_projection_digest
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    Ok(())
}

fn encode_record(record: &ReplayCompositionBindingV1) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&SCHEMA_VERSION.to_be_bytes());

    for value in [
        record.replay_request_identity,
        record.replay_request_digest,
        record.pit_snapshot_identity,
    ] {
        push_digest(&mut bytes, value);
    }
    bytes.extend_from_slice(&record.replay_start_event_ns.to_be_bytes());
    bytes.extend_from_slice(&record.replay_end_event_ns_exclusive.to_be_bytes());
    for value in [
        record.strategy_design_identity,
        record.strategy_design_digest,
        record.registry_identity,
        record.registry_digest,
    ] {
        push_digest(&mut bytes, value);
    }
    bytes.extend_from_slice(&(record.native_locators.len() as u32).to_be_bytes());
    for locator in &record.native_locators {
        bytes.extend_from_slice(&(locator.kind as u16).to_be_bytes());
        push_digest(&mut bytes, locator.identity);
        push_digest(&mut bytes, locator.digest);
    }
    bytes.extend_from_slice(&(record.roles.len() as u32).to_be_bytes());
    for role in &record.roles {
        for value in [
            role.role_identity,
            role.declaration_identity,
            role.declaration_digest,
            role.binding_identity,
            role.binding_digest,
        ] {
            push_digest(&mut bytes, value);
        }
    }

    for value in [
        record.census_identity,
        record.census_digest,
        record.joined_cut_identity,
        record.joined_cut_digest,
        record.sample_projection_identity,
        record.sample_projection_digest,
    ] {
        push_digest(&mut bytes, value);
    }
    bytes
}

fn encode_receipt(receipt: &ReplayCompositionBindingReceiptV1) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + 3 * 32);
    bytes.extend_from_slice(&SCHEMA_VERSION.to_be_bytes());
    push_digest(&mut bytes, receipt.binding_identity);
    push_digest(&mut bytes, receipt.binding_digest);
    push_digest(&mut bytes, receipt.stable_correlation);
    bytes
}

fn push_digest(bytes: &mut Vec<u8>, value: BindingDigest) {
    bytes.extend_from_slice(value.as_bytes());
}

fn hash(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

const fn zero() -> BindingDigest {
    BindingDigest::from_untrusted_bytes([0; 32])
}

fn nonzero(value: BindingDigest) -> bool {
    value.as_bytes() != &[0; 32]
}

fn map_v2_error(_error: ReplayMarketFactsErrorV2) -> ReplayCompositionBindingErrorV1 {
    ReplayCompositionBindingErrorV1::ReplayV2Unavailable
}
