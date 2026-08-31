//! Canonical Market Data FRAME sample-projection contracts.
//!
//! Issuance consumes only unchanged V1 frame/binding evidence and already verified native
//! sample/timeframe readbacks. Public authority artifacts have no public constructor and
//! deliberately implement neither `Clone` nor `Deserialize`.
#![allow(
    dead_code,
    reason = "crate-private FRAME projection custody is consumed by the separately integrated PostgreSQL owner"
)]

use std::fmt::Display;

use async_trait::async_trait;
use sha2::{Digest as _, Sha256};

use super::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleReadbackV1,
        BarScheduleUnitV1, authority as bar_schedule_authority,
    },
    sample_fact::{StoredSampleReadbackV1, TimeframeProjectionReceiptV1},
    strategy_input_binding::{
        StrategyInputBindingReceipt, StrategyInputEventFrameReceipt, StrategyInputEventKind,
        StrategyInputEventValueReceipt,
    },
};

const FRAME_EVIDENCE_HEADER_LEN: usize = 40;
const FRAME_EVIDENCE_ENTRY_LEN: usize = 96;
const RECEIPT_HEADER_LEN: usize = 41;
const RECEIPT_ENTRY_LEN: usize = 612;
const FRAME_EVIDENCE_HEADER_LEN_V3: usize = 41;
const RECEIPT_HEADER_LEN_V3: usize = 42;
const COORDINATE_LEN: usize = 308;
const FRAME_KIND: u8 = 0x01;
const JOINED_CUT_KIND: u8 = 0x02;
const BAR_LIFECYCLE_KIND: u8 = 0x02;

const FRAME_EVIDENCE_DOMAIN: &[u8] = b"market-data.strategy-input-frame-evidence.identity.v2\0";
const RECEIPT_DOMAIN: &[u8] = b"market-data.sample-projection-receipt.v2\0";
const FRAME_EVIDENCE_DOMAIN_V3: &[u8] = b"market-data.strategy-input-frame-evidence.identity.v3\0";
const RECEIPT_DOMAIN_V3: &[u8] = b"market-data.sample-projection-receipt.v3\0";
const COORDINATE_DOMAIN: &[u8] = b"strategy.input.sample-coordinate.v1\0";

type Identity = [u8; 32];

/// Untrusted content-addressed locator for one historical V2 sample projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedStrategyInputSampleProjectionLocatorV2 {
    receipt_digest: Identity,
}

impl UntrustedStrategyInputSampleProjectionLocatorV2 {
    /// Creates a locator from caller-supplied bytes. This confers no custody authority.
    #[must_use]
    pub const fn from_untrusted(receipt_digest: Identity) -> Self {
        Self { receipt_digest }
    }

    #[must_use]
    pub const fn receipt_digest(&self) -> Identity {
        self.receipt_digest
    }
}

/// Opaque historical projection promoted only after admission and native custody verification.
///
/// This value deliberately implements neither `Clone` nor `Deserialize` and has no public
/// constructor. Its bytes are the exact canonical bytes stored by Market Data.
///
/// ```compile_fail
/// use vibe_data::owner::sample_projection::StrategyInputSampleProjectionReadbackV2;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<StrategyInputSampleProjectionReadbackV2>();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::sample_projection::StrategyInputSampleProjectionReadbackV2;
/// let _: StrategyInputSampleProjectionReadbackV2 = serde_json::from_slice(b"{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::sample_projection::StrategyInputSampleProjectionReadbackV2;
/// let _ = StrategyInputSampleProjectionReadbackV2 {
///     receipt_digest: [1; 32], subject_identity: [2; 32], component_count: 1,
///     canonical_bytes: vec![].into_boxed_slice(),
/// };
/// ```
#[derive(Debug)]
pub struct StrategyInputSampleProjectionReadbackV2 {
    receipt_digest: Identity,
    subject_identity: Identity,
    component_count: u32,
    canonical_bytes: Box<[u8]>,
}

impl StrategyInputSampleProjectionReadbackV2 {
    #[must_use]
    pub const fn receipt_digest(&self) -> Identity {
        self.receipt_digest
    }

    #[must_use]
    pub const fn subject_identity(&self) -> Identity {
        self.subject_identity
    }

    #[must_use]
    pub const fn component_count(&self) -> u32 {
        self.component_count
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(super) fn from_postgres_verified(
        proof: super::postgres::StrategyInputSampleProjectionPostgresProofV2,
    ) -> Self {
        let decoded = proof.into_decoded();
        Self {
            receipt_digest: decoded.digest,
            subject_identity: decoded.subject_identity,
            component_count: decoded.component_count,
            canonical_bytes: decoded.bytes,
        }
    }
}

/// Redacted fail-closed error for the public projection resolver.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("Market Data sample projection is unavailable")]
pub struct StrategyInputSampleProjectionResolveErrorV2;

mod sealed {
    pub trait Sealed {}
}

impl sealed::Sealed for super::postgres::MarketDataReadPostgres {}

/// Sealed fixed resolver for one exact, admission-verified historical V2 projection.
///
/// ```compile_fail
/// use vibe_data::owner::sample_projection::StrategyInputSampleProjectionResolverV2;
/// struct ForgedResolver;
/// impl StrategyInputSampleProjectionResolverV2 for ForgedResolver {}
/// ```
#[async_trait]
pub trait StrategyInputSampleProjectionResolverV2: sealed::Sealed + Send + Sync {
    async fn resolve_strategy_input_sample_projection_v2(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV2,
    ) -> Result<StrategyInputSampleProjectionReadbackV2, StrategyInputSampleProjectionResolveErrorV2>;
}

/// Additive identity over one complete unchanged V1 event frame.
#[derive(Debug)]
pub struct StrategyInputFrameEvidenceIdentityV2 {
    bytes: Box<[u8]>,
    identity: Identity,
}

impl StrategyInputFrameEvidenceIdentityV2 {
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub const fn identity(&self) -> Identity {
        self.identity
    }
}

/// Exact opaque FRAME projection receipt.
#[derive(Debug)]
pub struct StrategyInputSampleProjectionReceiptV2 {
    bytes: Box<[u8]>,
    digest: Identity,
    frame_evidence: StrategyInputFrameEvidenceIdentityV2,
    component_count: u32,
}

impl StrategyInputSampleProjectionReceiptV2 {
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub const fn digest(&self) -> Identity {
        self.digest
    }

    #[must_use]
    pub const fn frame_evidence(&self) -> &StrategyInputFrameEvidenceIdentityV2 {
        &self.frame_evidence
    }

    #[must_use]
    pub const fn component_count(&self) -> u32 {
        self.component_count
    }
}

/// Owner-local sources for one role in a complete V1 FRAME projection.
pub(crate) struct StrategyInputSampleProjectionSourceV2<'a> {
    pub(crate) binding: &'a StrategyInputBindingReceipt,
    pub(crate) timeframe: &'a TimeframeProjectionReceiptV1,
    pub(crate) sample: &'a StoredSampleReadbackV1,
}

/// Owner-local sources for one role in a complete V3 BAR projection.
pub(crate) struct StrategyInputSampleProjectionSourceV3<'a> {
    pub(crate) binding: &'a StrategyInputBindingReceipt,
    pub(crate) timeframe: &'a TimeframeProjectionReceiptV1,
    pub(crate) sample: &'a StoredSampleReadbackV1,
    pub(crate) schedule: &'a BarScheduleReadbackV1,
}

/// Prepared bytes handed to the durable Owner without exposing construction authority.
#[derive(Debug)]
pub(crate) struct PreparedStrategyInputSampleProjectionV2 {
    receipt: StrategyInputSampleProjectionReceiptV2,
}

impl PreparedStrategyInputSampleProjectionV2 {
    pub(crate) const fn receipt_digest(&self) -> Identity {
        self.receipt.digest
    }

    pub(crate) const fn kind_tag(&self) -> u8 {
        FRAME_KIND
    }

    pub(crate) const fn subject_identity(&self) -> Identity {
        self.receipt.frame_evidence.identity
    }

    pub(crate) const fn component_count(&self) -> u32 {
        self.receipt.component_count
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.receipt.bytes
    }
}

/// Structurally decoded bytes without durable Owner-custody authority.
///
/// A matching caller-supplied digest proves content addressing only. The PostgreSQL Owner is the
/// sole module allowed to promote this value to a custody-bearing historical readback after it has
/// verified the immutable row, its custody digest, and its indexed identity columns.
#[derive(Debug)]
pub(super) struct DecodedStrategyInputSampleProjectionV2 {
    bytes: Box<[u8]>,
    digest: Identity,
    subject_identity: Identity,
    component_count: u32,
    components: Box<[DecodedStrategyInputSampleProjectionComponentV2]>,
}

#[derive(Debug)]
pub(super) struct DecodedStrategyInputSampleProjectionComponentV2 {
    role_identity: Identity,
    binding_receipt_digest: Identity,
    timeframe_projection_digest: Identity,
    sample_identity: Identity,
    sample_receipt_digest: Identity,
    coordinate: [u8; COORDINATE_LEN],
}

impl DecodedStrategyInputSampleProjectionV2 {
    pub(super) const fn receipt_digest(&self) -> Identity {
        self.digest
    }

    pub(super) const fn kind_tag(&self) -> u8 {
        FRAME_KIND
    }

    pub(super) const fn subject_identity(&self) -> Identity {
        self.subject_identity
    }

    pub(super) const fn component_count(&self) -> u32 {
        self.component_count
    }

    pub(super) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(super) fn components(&self) -> &[DecodedStrategyInputSampleProjectionComponentV2] {
        &self.components
    }
}

impl DecodedStrategyInputSampleProjectionComponentV2 {
    pub(super) const fn timeframe_projection_digest(&self) -> Identity {
        self.timeframe_projection_digest
    }

    pub(super) const fn sample_receipt_digest(&self) -> Identity {
        self.sample_receipt_digest
    }
}

/// Additive identity over one complete V1 BAR frame with an explicit lifecycle discriminator.
#[derive(Debug)]
pub(crate) struct StrategyInputFrameEvidenceIdentityV3 {
    bytes: Box<[u8]>,
    identity: Identity,
}

impl StrategyInputFrameEvidenceIdentityV3 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn identity(&self) -> Identity {
        self.identity
    }
}

/// Exact opaque V3 BAR projection receipt.
#[derive(Debug)]
pub(crate) struct StrategyInputSampleProjectionReceiptV3 {
    bytes: Box<[u8]>,
    digest: Identity,
    frame_evidence: StrategyInputFrameEvidenceIdentityV3,
    component_count: u32,
}

impl StrategyInputSampleProjectionReceiptV3 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn digest(&self) -> Identity {
        self.digest
    }

    pub(crate) const fn frame_evidence(&self) -> &StrategyInputFrameEvidenceIdentityV3 {
        &self.frame_evidence
    }

    pub(crate) const fn component_count(&self) -> u32 {
        self.component_count
    }
}

/// Prepared V3 BAR bytes handed to the durable Owner without exposing construction authority.
#[derive(Debug)]
pub(crate) struct PreparedStrategyInputSampleProjectionV3 {
    receipt: StrategyInputSampleProjectionReceiptV3,
    schedule_dependencies: Box<[StrategyInputSampleProjectionScheduleDependencyV3]>,
}

/// Move-only schedule authority retained outside the stable V3 canonical codec.
#[derive(Debug)]
pub(super) struct StrategyInputSampleProjectionScheduleDependencyV3 {
    role_identity: Identity,
    binding_receipt_digest: Identity,
    schedule_readback_identity: Identity,
    schedule_fact_digest: Identity,
    schedule_cut_identity: Identity,
    schedule_cut_digest: Identity,
    schedule_receipt_identity: Identity,
}

impl PreparedStrategyInputSampleProjectionV3 {
    pub(crate) const fn receipt_digest(&self) -> Identity {
        self.receipt.digest
    }

    pub(crate) const fn kind_tag(&self) -> u8 {
        FRAME_KIND
    }

    pub(crate) const fn lifecycle_kind(&self) -> StrategyInputEventKind {
        StrategyInputEventKind::Bar
    }

    pub(crate) const fn lifecycle_tag(&self) -> u8 {
        BAR_LIFECYCLE_KIND
    }

    pub(crate) const fn subject_identity(&self) -> Identity {
        self.receipt.frame_evidence.identity
    }

    pub(crate) const fn component_count(&self) -> u32 {
        self.receipt.component_count
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.receipt.bytes
    }

    pub(super) fn schedule_dependencies(
        &self,
    ) -> &[StrategyInputSampleProjectionScheduleDependencyV3] {
        &self.schedule_dependencies
    }
}

impl StrategyInputSampleProjectionScheduleDependencyV3 {
    pub(super) const fn role_identity(&self) -> Identity {
        self.role_identity
    }

    pub(super) const fn binding_receipt_digest(&self) -> Identity {
        self.binding_receipt_digest
    }

    pub(super) const fn schedule_readback_identity(&self) -> Identity {
        self.schedule_readback_identity
    }

    pub(super) const fn schedule_fact_digest(&self) -> Identity {
        self.schedule_fact_digest
    }

    pub(super) const fn schedule_cut_identity(&self) -> Identity {
        self.schedule_cut_identity
    }

    pub(super) const fn schedule_cut_digest(&self) -> Identity {
        self.schedule_cut_digest
    }

    pub(super) const fn schedule_receipt_identity(&self) -> Identity {
        self.schedule_receipt_identity
    }
}

/// Structurally decoded V3 BAR bytes without durable Owner-custody authority.
#[derive(Debug)]
pub(super) struct DecodedStrategyInputSampleProjectionV3 {
    bytes: Box<[u8]>,
    digest: Identity,
    kind_tag: u8,
    lifecycle_kind: StrategyInputEventKind,
    lifecycle_tag: u8,
    subject_identity: Identity,
    component_count: u32,
    components: Box<[DecodedStrategyInputSampleProjectionComponentV3]>,
}

#[derive(Debug)]
pub(super) struct DecodedStrategyInputSampleProjectionComponentV3 {
    lifecycle_kind: StrategyInputEventKind,
    role_identity: Identity,
    binding_receipt_digest: Identity,
    timeframe_projection_digest: Identity,
    sample_identity: Identity,
    sample_receipt_digest: Identity,
    coordinate: [u8; COORDINATE_LEN],
}

impl DecodedStrategyInputSampleProjectionV3 {
    pub(super) const fn receipt_digest(&self) -> Identity {
        self.digest
    }

    pub(super) const fn kind_tag(&self) -> u8 {
        self.kind_tag
    }

    pub(super) const fn lifecycle_kind(&self) -> StrategyInputEventKind {
        self.lifecycle_kind
    }

    pub(super) const fn lifecycle_tag(&self) -> u8 {
        self.lifecycle_tag
    }

    pub(super) const fn subject_identity(&self) -> Identity {
        self.subject_identity
    }

    pub(super) const fn component_count(&self) -> u32 {
        self.component_count
    }

    pub(super) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(super) fn components(&self) -> &[DecodedStrategyInputSampleProjectionComponentV3] {
        &self.components
    }
}

impl DecodedStrategyInputSampleProjectionComponentV3 {
    pub(super) const fn role_identity(&self) -> Identity {
        self.role_identity
    }

    pub(super) const fn binding_receipt_digest(&self) -> Identity {
        self.binding_receipt_digest
    }

    pub(super) const fn timeframe_projection_digest(&self) -> Identity {
        self.timeframe_projection_digest
    }

    pub(super) const fn sample_receipt_digest(&self) -> Identity {
        self.sample_receipt_digest
    }
}

/// Fail-closed FRAME projection preparation or stored-codec error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StrategyInputSampleProjectionUnavailable {
    InvalidLength,
    InvalidSchema,
    ReservedNonZero,
    UnsupportedKind,
    EmptyFrame,
    CountMismatch,
    NonCanonicalOrder,
    ZeroIdentity,
    DigestMismatch,
    EvidenceMismatch,
    BindingMismatch,
    TimeframeMismatch,
    SampleMismatch,
}

impl Display for StrategyInputSampleProjectionUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for StrategyInputSampleProjectionUnavailable {}

/// Prepares one complete point-event FRAME projection from verified Owner artifacts.
pub(crate) fn prepare_strategy_input_sample_projection_frame_v2(
    frame: &StrategyInputEventFrameReceipt,
    sources: &[StrategyInputSampleProjectionSourceV2<'_>],
) -> Result<PreparedStrategyInputSampleProjectionV2, StrategyInputSampleProjectionUnavailable> {
    if frame.trigger().lifecycle().kind() != StrategyInputEventKind::Event {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let frame_evidence = prepare_frame_evidence(frame)?;
    let values = frame.values();
    if values.len() != sources.len() {
        return Err(StrategyInputSampleProjectionUnavailable::CountMismatch);
    }
    let component_count = u32::try_from(values.len())
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let capacity = RECEIPT_HEADER_LEN
        .checked_add(
            RECEIPT_ENTRY_LEN
                .checked_mul(values.len())
                .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?,
        )
        .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let mut bytes = Vec::with_capacity(capacity);
    put_u16(&mut bytes, 2);
    put_u16(&mut bytes, 0);
    bytes.push(FRAME_KIND);
    bytes.extend_from_slice(&frame_evidence.identity);
    put_u32(&mut bytes, component_count);

    let mut previous_role = None;

    for (value, source) in values.iter().zip(sources) {
        let role = *value.input_role_identity().as_bytes();
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);
        let coordinate = project_component(frame, value, source)?;
        let coordinate_digest = sha256(COORDINATE_DOMAIN, &coordinate);

        bytes.extend_from_slice(&role);
        bytes.extend_from_slice(value.binding_receipt_digest().as_bytes());
        bytes.extend_from_slice(&frame_evidence.identity);
        bytes.extend_from_slice(frame.trigger().digest().as_bytes());
        bytes.extend_from_slice(&frame.trigger().lifecycle().event_identity());
        bytes.extend_from_slice(value.digest().as_bytes());
        bytes.extend_from_slice(&source.timeframe.digest());
        bytes.extend_from_slice(&source.sample.receipt().sample_identity());
        bytes.extend_from_slice(&source.sample.receipt().digest());
        bytes.extend_from_slice(&coordinate_digest);
        bytes.extend_from_slice(&coordinate);
    }
    debug_assert_eq!(bytes.len(), capacity);
    let digest = sha256(RECEIPT_DOMAIN, &bytes);
    Ok(PreparedStrategyInputSampleProjectionV2 {
        receipt: StrategyInputSampleProjectionReceiptV2 {
            bytes: bytes.into_boxed_slice(),
            digest,
            frame_evidence,
            component_count,
        },
    })
}

/// Prepares one complete BAR FRAME projection with an explicit lifecycle discriminator.
pub(crate) fn prepare_strategy_input_sample_projection_bar_v3(
    frame: &StrategyInputEventFrameReceipt,
    sources: &[StrategyInputSampleProjectionSourceV3<'_>],
) -> Result<PreparedStrategyInputSampleProjectionV3, StrategyInputSampleProjectionUnavailable> {
    if frame.trigger().lifecycle().kind() != StrategyInputEventKind::Bar {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let frame_evidence = prepare_frame_evidence_v3(frame)?;
    let values = frame.values();
    if values.len() != sources.len() {
        return Err(StrategyInputSampleProjectionUnavailable::CountMismatch);
    }
    let component_count = u32::try_from(values.len())
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let capacity = RECEIPT_HEADER_LEN_V3
        .checked_add(
            RECEIPT_ENTRY_LEN
                .checked_mul(values.len())
                .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?,
        )
        .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let mut bytes = Vec::with_capacity(capacity);
    put_u16(&mut bytes, 3);
    put_u16(&mut bytes, 0);
    bytes.push(FRAME_KIND);
    bytes.push(BAR_LIFECYCLE_KIND);
    bytes.extend_from_slice(&frame_evidence.identity);
    put_u32(&mut bytes, component_count);

    let mut previous_role = None;
    let mut schedule_dependencies = Vec::with_capacity(values.len());
    for (value, source) in values.iter().zip(sources) {
        let role = *value.input_role_identity().as_bytes();
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);
        let v2_source = StrategyInputSampleProjectionSourceV2 {
            binding: source.binding,
            timeframe: source.timeframe,
            sample: source.sample,
        };
        let schedule_dependency = prepare_schedule_dependency_v3(role, source)?;
        let coordinate = project_component(frame, value, &v2_source)?;
        let coordinate_digest = sha256(COORDINATE_DOMAIN, &coordinate);

        bytes.extend_from_slice(&role);
        bytes.extend_from_slice(value.binding_receipt_digest().as_bytes());
        bytes.extend_from_slice(&frame_evidence.identity);
        bytes.extend_from_slice(frame.trigger().digest().as_bytes());
        bytes.extend_from_slice(&frame.trigger().lifecycle().event_identity());
        bytes.extend_from_slice(value.digest().as_bytes());
        bytes.extend_from_slice(&source.timeframe.digest());
        bytes.extend_from_slice(&source.sample.receipt().sample_identity());
        bytes.extend_from_slice(&source.sample.receipt().digest());
        bytes.extend_from_slice(&coordinate_digest);
        bytes.extend_from_slice(&coordinate);
        schedule_dependencies.push(schedule_dependency);
    }
    debug_assert_eq!(bytes.len(), capacity);
    let digest = sha256(RECEIPT_DOMAIN_V3, &bytes);
    Ok(PreparedStrategyInputSampleProjectionV3 {
        receipt: StrategyInputSampleProjectionReceiptV3 {
            bytes: bytes.into_boxed_slice(),
            digest,
            frame_evidence,
            component_count,
        },
        schedule_dependencies: schedule_dependencies.into_boxed_slice(),
    })
}

fn prepare_schedule_dependency_v3(
    role_identity: Identity,
    source: &StrategyInputSampleProjectionSourceV3<'_>,
) -> Result<
    StrategyInputSampleProjectionScheduleDependencyV3,
    StrategyInputSampleProjectionUnavailable,
> {
    if !bar_schedule_authority::verify_readback(source.schedule) {
        return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
    }
    let fact = source.schedule.fact();
    if schedule_timeframe_spec_bytes_v3(source.schedule)?
        != source.timeframe.spec().canonical_bytes().as_slice()
    {
        return Err(StrategyInputSampleProjectionUnavailable::TimeframeMismatch);
    }
    let receipt = source.sample.receipt();
    let event_effective = i128::from(receipt.event_effective());
    if fact.canonical_instrument() != source.binding.locator().instrument()
        || fact.cut_effective_instant() != event_effective
        || event_effective < fact.effective_from()
        || fact
            .effective_until()
            .is_some_and(|until| event_effective >= until)
        || fact.market_semantics_identity() != source.binding.locator().market_semantics_identity()
        || *fact.market_semantics_identity().as_bytes() != receipt.market_semantics_identity()
        || fact.instrument_master_digest().as_bytes()
            != &source.sample.fact().instrument_master_digest()
        || fact.schedule_source_frontier().as_bytes()
            != &source.sample.fact().source_frontier_digest()
        || fact.schedule_correction_frontier().as_bytes()
            != &source.sample.fact().correction_frontier_digest()
    {
        return Err(StrategyInputSampleProjectionUnavailable::SampleMismatch);
    }

    let schedule_cut_identity = *source.schedule.cut.identity.as_bytes();
    Ok(StrategyInputSampleProjectionScheduleDependencyV3 {
        role_identity,
        binding_receipt_digest: *source.binding.digest().as_bytes(),
        schedule_readback_identity: *source.schedule.identity().as_bytes(),
        schedule_fact_digest: *fact.digest().as_bytes(),
        schedule_cut_identity,
        schedule_cut_digest: schedule_cut_identity,
        schedule_receipt_identity: *source.schedule.receipt_identity().as_bytes(),
    })
}

fn schedule_timeframe_spec_bytes_v3(
    schedule: &BarScheduleReadbackV1,
) -> Result<Vec<u8>, StrategyInputSampleProjectionUnavailable> {
    let fact = schedule.fact();
    let (kind, unit) = match (fact.kind(), fact.unit()) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => (0x02, 0x01),
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => (0x02, 0x02),
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => (0x02, 0x03),
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay) => (0x03, 0x04),
        _ => return Err(StrategyInputSampleProjectionUnavailable::TimeframeMismatch),
    };
    let label = match fact.label() {
        BarScheduleLabelV1::IntervalOpen => 0x01,
        BarScheduleLabelV1::IntervalClose => 0x02,
    };
    let partial = match fact.completion() {
        BarScheduleCompletionV1::CompleteOnly => 0x01,
    };
    let mut bytes = Vec::with_capacity(140);
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    bytes.push(kind);
    put_u32(&mut bytes, fact.step());
    bytes.push(unit);
    bytes.extend_from_slice(fact.anchor_identity().as_bytes());
    bytes.extend_from_slice(fact.calendar_identity().as_bytes());
    bytes.extend_from_slice(fact.session_identity().as_bytes());
    bytes.extend_from_slice(fact.time_zone_identity().as_bytes());
    bytes.push(label);
    bytes.push(partial);
    debug_assert_eq!(bytes.len(), 140);
    Ok(bytes)
}

/// Decodes exact FRAME bytes without conferring durable Owner-custody authority.
pub(super) fn decode_strategy_input_sample_projection_v2(
    bytes: &[u8],
    expected_digest: Identity,
) -> Result<DecodedStrategyInputSampleProjectionV2, StrategyInputSampleProjectionUnavailable> {
    if sha256(RECEIPT_DOMAIN, bytes) != expected_digest {
        return Err(StrategyInputSampleProjectionUnavailable::DigestMismatch);
    }

    if bytes.len() < RECEIPT_HEADER_LEN
        || !(bytes.len() - RECEIPT_HEADER_LEN).is_multiple_of(RECEIPT_ENTRY_LEN)
    {
        return Err(StrategyInputSampleProjectionUnavailable::InvalidLength);
    }
    let mut decoder = Decoder::new(bytes);
    decoder.schema(2)?;
    if decoder.u8()? != FRAME_KIND {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let subject_identity = decoder.identity_nonzero()?;
    let component_count = decoder.u32()?;
    if component_count == 0 {
        return Err(StrategyInputSampleProjectionUnavailable::EmptyFrame);
    }
    let count = usize::try_from(component_count)
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let expected_len = RECEIPT_HEADER_LEN
        .checked_add(
            RECEIPT_ENTRY_LEN
                .checked_mul(count)
                .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?,
        )
        .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    if bytes.len() != expected_len {
        return Err(StrategyInputSampleProjectionUnavailable::CountMismatch);
    }

    let mut evidence_entries = Vec::with_capacity(count * FRAME_EVIDENCE_ENTRY_LEN);
    let mut components = Vec::with_capacity(count);
    let mut trigger_digest = None;
    let mut previous_role = None;

    for _ in 0..count {
        let role = decoder.identity_nonzero()?;
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);
        let binding_digest = decoder.identity_nonzero()?;
        let entry_frame_evidence = decoder.identity_nonzero()?;
        if entry_frame_evidence != subject_identity {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let entry_trigger = decoder.identity_nonzero()?;
        if trigger_digest
            .replace(entry_trigger)
            .is_some_and(|prior| prior != entry_trigger)
        {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let role_bound_event_identity = decoder.identity16_nonzero()?;
        if role_bound_event_identity != entry_trigger[..16] {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let value_digest = decoder.identity_nonzero()?;
        let timeframe_projection_digest = decoder.identity_nonzero()?;
        let sample_identity = decoder.identity_nonzero()?;
        let sample_receipt_digest = decoder.identity_nonzero()?;
        let coordinate_digest = decoder.identity_nonzero()?;
        let coordinate: [u8; COORDINATE_LEN] = decoder
            .take(COORDINATE_LEN)?
            .try_into()
            .expect("fixed coordinate width");
        verify_coordinate(
            &coordinate,
            coordinate_digest,
            role,
            binding_digest,
            sample_identity,
            sample_receipt_digest,
        )?;
        evidence_entries.extend_from_slice(&role);
        evidence_entries.extend_from_slice(&binding_digest);
        evidence_entries.extend_from_slice(&value_digest);
        components.push(DecodedStrategyInputSampleProjectionComponentV2 {
            role_identity: role,
            binding_receipt_digest: binding_digest,
            timeframe_projection_digest,
            sample_identity,
            sample_receipt_digest,
            coordinate,
        });
    }
    decoder.end()?;
    let trigger_digest =
        trigger_digest.ok_or(StrategyInputSampleProjectionUnavailable::EmptyFrame)?;
    let evidence_bytes = frame_evidence_bytes(trigger_digest, component_count, &evidence_entries);
    if sha256(FRAME_EVIDENCE_DOMAIN, &evidence_bytes) != subject_identity {
        return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
    }

    Ok(DecodedStrategyInputSampleProjectionV2 {
        bytes: bytes.to_vec().into_boxed_slice(),
        digest: expected_digest,
        subject_identity,
        component_count,
        components: components.into_boxed_slice(),
    })
}

/// Decodes exact V3 BAR bytes without conferring durable Owner-custody authority.
pub(super) fn decode_strategy_input_sample_projection_v3(
    bytes: &[u8],
    expected_digest: Identity,
) -> Result<DecodedStrategyInputSampleProjectionV3, StrategyInputSampleProjectionUnavailable> {
    if sha256(RECEIPT_DOMAIN_V3, bytes) != expected_digest {
        return Err(StrategyInputSampleProjectionUnavailable::DigestMismatch);
    }

    if bytes.len() < RECEIPT_HEADER_LEN_V3
        || !(bytes.len() - RECEIPT_HEADER_LEN_V3).is_multiple_of(RECEIPT_ENTRY_LEN)
    {
        return Err(StrategyInputSampleProjectionUnavailable::InvalidLength);
    }
    let mut decoder = Decoder::new(bytes);
    decoder.schema(3)?;
    let kind_tag = decoder.u8()?;
    if kind_tag != FRAME_KIND {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let lifecycle_tag = decoder.u8()?;
    if lifecycle_tag != BAR_LIFECYCLE_KIND {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let lifecycle_kind = StrategyInputEventKind::Bar;
    let subject_identity = decoder.identity_nonzero()?;
    let component_count = decoder.u32()?;
    if component_count == 0 {
        return Err(StrategyInputSampleProjectionUnavailable::EmptyFrame);
    }
    let count = usize::try_from(component_count)
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let expected_len = RECEIPT_HEADER_LEN_V3
        .checked_add(
            RECEIPT_ENTRY_LEN
                .checked_mul(count)
                .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?,
        )
        .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    if bytes.len() != expected_len {
        return Err(StrategyInputSampleProjectionUnavailable::CountMismatch);
    }

    let mut evidence_entries = Vec::with_capacity(count * FRAME_EVIDENCE_ENTRY_LEN);
    let mut components = Vec::with_capacity(count);
    let mut trigger_digest = None;
    let mut previous_role = None;

    for _ in 0..count {
        let role = decoder.identity_nonzero()?;
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);
        let binding_digest = decoder.identity_nonzero()?;
        let entry_frame_evidence = decoder.identity_nonzero()?;
        if entry_frame_evidence != subject_identity {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let entry_trigger = decoder.identity_nonzero()?;
        if trigger_digest
            .replace(entry_trigger)
            .is_some_and(|prior| prior != entry_trigger)
        {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let role_bound_event_identity = decoder.identity16_nonzero()?;
        if role_bound_event_identity != entry_trigger[..16] {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        let value_digest = decoder.identity_nonzero()?;
        let timeframe_projection_digest = decoder.identity_nonzero()?;
        let sample_identity = decoder.identity_nonzero()?;
        let sample_receipt_digest = decoder.identity_nonzero()?;
        let coordinate_digest = decoder.identity_nonzero()?;
        let coordinate: [u8; COORDINATE_LEN] = decoder
            .take(COORDINATE_LEN)?
            .try_into()
            .expect("fixed coordinate width");
        verify_coordinate(
            &coordinate,
            coordinate_digest,
            role,
            binding_digest,
            sample_identity,
            sample_receipt_digest,
        )?;
        evidence_entries.extend_from_slice(&role);
        evidence_entries.extend_from_slice(&binding_digest);
        evidence_entries.extend_from_slice(&value_digest);
        components.push(DecodedStrategyInputSampleProjectionComponentV3 {
            lifecycle_kind,
            role_identity: role,
            binding_receipt_digest: binding_digest,
            timeframe_projection_digest,
            sample_identity,
            sample_receipt_digest,
            coordinate,
        });
    }
    decoder.end()?;
    let trigger_digest =
        trigger_digest.ok_or(StrategyInputSampleProjectionUnavailable::EmptyFrame)?;
    let evidence_bytes =
        frame_evidence_bytes_v3(trigger_digest, component_count, &evidence_entries);

    if sha256(FRAME_EVIDENCE_DOMAIN_V3, &evidence_bytes) != subject_identity {
        return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
    }

    Ok(DecodedStrategyInputSampleProjectionV3 {
        bytes: bytes.to_vec().into_boxed_slice(),
        digest: expected_digest,
        kind_tag,
        lifecycle_kind,
        lifecycle_tag,
        subject_identity,
        component_count,
        components: components.into_boxed_slice(),
    })
}

pub(super) fn verify_decoded_projection_component_native_v2(
    component: &DecodedStrategyInputSampleProjectionComponentV2,
    timeframe: &TimeframeProjectionReceiptV1,
    sample: &StoredSampleReadbackV1,
) -> Result<(), StrategyInputSampleProjectionUnavailable> {
    if !timeframe.is_point_event()
        || timeframe.digest() != component.timeframe_projection_digest
        || timeframe.binding_receipt_digest() != component.binding_receipt_digest
        || sample.receipt().sample_identity() != component.sample_identity
        || sample.receipt().digest() != component.sample_receipt_digest
        || sample.receipt().timeframe_identity() != timeframe.timeframe_identity()
        || coordinate_from_native_receipt(
            component.role_identity,
            component.binding_receipt_digest,
            sample.receipt(),
        )? != component.coordinate
    {
        return Err(StrategyInputSampleProjectionUnavailable::SampleMismatch);
    }
    Ok(())
}

pub(super) fn verify_decoded_projection_component_native_v3(
    component: &DecodedStrategyInputSampleProjectionComponentV3,
    timeframe: &TimeframeProjectionReceiptV1,
    sample: &StoredSampleReadbackV1,
) -> Result<(), StrategyInputSampleProjectionUnavailable> {
    if component.lifecycle_kind != StrategyInputEventKind::Bar
        || !timeframe.is_bar()
        || timeframe.digest() != component.timeframe_projection_digest
        || timeframe.binding_receipt_digest() != component.binding_receipt_digest
        || sample.receipt().sample_identity() != component.sample_identity
        || sample.receipt().digest() != component.sample_receipt_digest
        || sample.receipt().timeframe_identity() != timeframe.timeframe_identity()
        || coordinate_from_native_receipt(
            component.role_identity,
            component.binding_receipt_digest,
            sample.receipt(),
        )? != component.coordinate
    {
        return Err(StrategyInputSampleProjectionUnavailable::SampleMismatch);
    }
    Ok(())
}

fn prepare_frame_evidence(
    frame: &StrategyInputEventFrameReceipt,
) -> Result<StrategyInputFrameEvidenceIdentityV2, StrategyInputSampleProjectionUnavailable> {
    let values = frame.values();
    if values.is_empty() {
        return Err(StrategyInputSampleProjectionUnavailable::EmptyFrame);
    }
    let count = u32::try_from(values.len())
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let mut entries = Vec::with_capacity(values.len() * FRAME_EVIDENCE_ENTRY_LEN);
    let mut previous_role = None;

    for value in values {
        let role = *value.input_role_identity().as_bytes();
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);

        if value.trigger_digest() != frame.trigger().digest()
            || value.observation_batch_digest() != frame.trigger().observation_batch_digest()
        {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        entries.extend_from_slice(&role);
        entries.extend_from_slice(value.binding_receipt_digest().as_bytes());
        entries.extend_from_slice(value.digest().as_bytes());
    }
    let bytes = frame_evidence_bytes(*frame.trigger().digest().as_bytes(), count, &entries);
    debug_assert_eq!(bytes.len(), FRAME_EVIDENCE_HEADER_LEN + entries.len());
    let identity = sha256(FRAME_EVIDENCE_DOMAIN, &bytes);
    Ok(StrategyInputFrameEvidenceIdentityV2 {
        bytes: bytes.into_boxed_slice(),
        identity,
    })
}

fn prepare_frame_evidence_v3(
    frame: &StrategyInputEventFrameReceipt,
) -> Result<StrategyInputFrameEvidenceIdentityV3, StrategyInputSampleProjectionUnavailable> {
    if frame.trigger().lifecycle().kind() != StrategyInputEventKind::Bar {
        return Err(StrategyInputSampleProjectionUnavailable::UnsupportedKind);
    }
    let values = frame.values();
    if values.is_empty() {
        return Err(StrategyInputSampleProjectionUnavailable::EmptyFrame);
    }
    let count = u32::try_from(values.len())
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)?;
    let mut entries = Vec::with_capacity(values.len() * FRAME_EVIDENCE_ENTRY_LEN);
    let mut previous_role = None;

    for value in values {
        let role = *value.input_role_identity().as_bytes();
        if previous_role.is_some_and(|previous| previous >= role) {
            return Err(StrategyInputSampleProjectionUnavailable::NonCanonicalOrder);
        }
        previous_role = Some(role);

        if value.trigger_digest() != frame.trigger().digest()
            || value.observation_batch_digest() != frame.trigger().observation_batch_digest()
        {
            return Err(StrategyInputSampleProjectionUnavailable::EvidenceMismatch);
        }
        entries.extend_from_slice(&role);
        entries.extend_from_slice(value.binding_receipt_digest().as_bytes());
        entries.extend_from_slice(value.digest().as_bytes());
    }
    let bytes = frame_evidence_bytes_v3(*frame.trigger().digest().as_bytes(), count, &entries);
    debug_assert_eq!(bytes.len(), FRAME_EVIDENCE_HEADER_LEN_V3 + entries.len());
    let identity = sha256(FRAME_EVIDENCE_DOMAIN_V3, &bytes);
    Ok(StrategyInputFrameEvidenceIdentityV3 {
        bytes: bytes.into_boxed_slice(),
        identity,
    })
}

fn project_component(
    frame: &StrategyInputEventFrameReceipt,
    value: &StrategyInputEventValueReceipt,
    source: &StrategyInputSampleProjectionSourceV2<'_>,
) -> Result<[u8; COORDINATE_LEN], StrategyInputSampleProjectionUnavailable> {
    let trigger = frame.trigger();
    let lifecycle = trigger.lifecycle();
    let binding = source.binding;
    let timeframe = source.timeframe;
    let fact = source.sample.fact();
    let receipt = source.sample.receipt();
    let role = *value.input_role_identity().as_bytes();
    let binding_digest = *binding.digest().as_bytes();

    if role != *binding.locator().input_role_identity().as_bytes()
        || binding_digest != *value.binding_receipt_digest().as_bytes()
        || *value.trigger_digest().as_bytes() != *trigger.digest().as_bytes()
    {
        return Err(StrategyInputSampleProjectionUnavailable::BindingMismatch);
    }

    let compatible_timeframe = match lifecycle.kind() {
        StrategyInputEventKind::Event => timeframe.is_point_event(),
        StrategyInputEventKind::Bar => timeframe.is_bar(),
    };

    if !compatible_timeframe
        || timeframe.binding_receipt_digest() != binding_digest
        || timeframe.timeframe_identity() != receipt.timeframe_identity()
    {
        return Err(StrategyInputSampleProjectionUnavailable::TimeframeMismatch);
    }

    if fact.snapshot_identity() != *trigger.snapshot_identity().as_bytes()
        || fact.snapshot_fact_digest() != *trigger.snapshot_fact_digest().as_bytes()
        || fact.observation_batch_digest() != *trigger.observation_batch_digest().as_bytes()
        || value.observation_batch_digest() != trigger.observation_batch_digest()
        || fact.sample_identity() != receipt.sample_identity()
        || fact.fact_digest() != receipt.fact_digest()
        || fact.timeframe_identity() != receipt.timeframe_identity()
        || fact.owner_event_identity() != receipt.owner_event_identity()
        || fact.canonical_row_digest() != receipt.canonical_row_digest()
        || lifecycle.logical_time() != receipt.logical_time()
        || lifecycle.event_time() != receipt.event_effective()
        || lifecycle.owner_sequence() != receipt.owner_sequence()
        || *value.canonical_row_digest().as_bytes() != receipt.canonical_row_digest()
        || *value.source_binding_lineage_root().as_bytes() != receipt.source_binding_lineage_root()
        || value.source_binding_lineage_version() != receipt.source_binding_lineage_version()
        || value.correction_sequence() != receipt.owner_sequence()
        || *value.market_semantics_identity().as_bytes() != receipt.market_semantics_identity()
        || *binding.locator().source_binding_lineage_root().as_bytes()
            != receipt.source_binding_lineage_root()
        || *binding.locator().market_semantics_identity().as_bytes()
            != receipt.market_semantics_identity()
    {
        return Err(StrategyInputSampleProjectionUnavailable::SampleMismatch);
    }

    coordinate_from_native_receipt(role, binding_digest, receipt)
}

fn coordinate_from_native_receipt(
    role: Identity,
    binding_digest: Identity,
    receipt: &super::sample_fact::SampleReceiptV1,
) -> Result<[u8; COORDINATE_LEN], StrategyInputSampleProjectionUnavailable> {
    let mut bytes = Vec::with_capacity(COORDINATE_LEN);
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&role);
    bytes.extend_from_slice(&receipt.timeframe_identity());
    bytes.extend_from_slice(&receipt.owner_event_identity());
    bytes.extend_from_slice(&receipt.sample_identity());
    put_u64(&mut bytes, receipt.logical_time());
    put_u64(&mut bytes, receipt.event_effective());
    put_u64(&mut bytes, receipt.owner_sequence());
    bytes.extend_from_slice(&binding_digest);
    bytes.extend_from_slice(&receipt.canonical_row_digest());
    bytes.extend_from_slice(&receipt.source_binding_lineage_root());
    put_u64(&mut bytes, receipt.source_binding_lineage_version());
    bytes.extend_from_slice(&receipt.market_semantics_identity());
    bytes.extend_from_slice(&receipt.digest());
    bytes
        .try_into()
        .map_err(|_| StrategyInputSampleProjectionUnavailable::InvalidLength)
}

fn verify_coordinate(
    bytes: &[u8],
    expected_digest: Identity,
    expected_role: Identity,
    expected_binding: Identity,
    expected_sample: Identity,
    expected_receipt: Identity,
) -> Result<(), StrategyInputSampleProjectionUnavailable> {
    if sha256(COORDINATE_DOMAIN, bytes) != expected_digest {
        return Err(StrategyInputSampleProjectionUnavailable::DigestMismatch);
    }
    let mut decoder = Decoder::new(bytes);
    decoder.schema(1)?;
    let role = decoder.identity_nonzero()?;
    let _timeframe = decoder.identity_nonzero()?;
    let _owner_event = decoder.identity16_nonzero()?;
    let sample = decoder.identity_nonzero()?;
    let _logical_time = decoder.u64()?;
    let _event_effective = decoder.u64()?;
    let _owner_sequence = decoder.u64()?;
    let binding = decoder.identity_nonzero()?;
    let _row = decoder.identity_nonzero()?;
    let _lineage = decoder.identity_nonzero()?;
    let _lineage_version = decoder.u64()?;
    let _market_semantics = decoder.identity_nonzero()?;
    let receipt = decoder.identity_nonzero()?;
    decoder.end()?;

    if role != expected_role
        || binding != expected_binding
        || sample != expected_sample
        || receipt != expected_receipt
    {
        return Err(StrategyInputSampleProjectionUnavailable::SampleMismatch);
    }
    Ok(())
}

fn frame_evidence_bytes(trigger_digest: Identity, count: u32, entries: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(FRAME_EVIDENCE_HEADER_LEN + entries.len());
    put_u16(&mut bytes, 2);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&trigger_digest);
    put_u32(&mut bytes, count);
    bytes.extend_from_slice(entries);
    bytes
}

fn frame_evidence_bytes_v3(trigger_digest: Identity, count: u32, entries: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(FRAME_EVIDENCE_HEADER_LEN_V3 + entries.len());
    put_u16(&mut bytes, 3);
    put_u16(&mut bytes, 0);
    bytes.push(BAR_LIFECYCLE_KIND);
    bytes.extend_from_slice(&trigger_digest);
    put_u32(&mut bytes, count);
    bytes.extend_from_slice(entries);
    bytes
}

fn sha256(domain: &[u8], bytes: &[u8]) -> Identity {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn put_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], StrategyInputSampleProjectionUnavailable> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(StrategyInputSampleProjectionUnavailable::InvalidLength)?;
        self.offset = end;
        Ok(value)
    }

    fn schema(&mut self, expected: u16) -> Result<(), StrategyInputSampleProjectionUnavailable> {
        if self.u16()? != expected {
            return Err(StrategyInputSampleProjectionUnavailable::InvalidSchema);
        }

        if self.u16()? != 0 {
            return Err(StrategyInputSampleProjectionUnavailable::ReservedNonZero);
        }
        Ok(())
    }

    fn u8(&mut self) -> Result<u8, StrategyInputSampleProjectionUnavailable> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, StrategyInputSampleProjectionUnavailable> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("fixed width"),
        ))
    }

    fn u32(&mut self) -> Result<u32, StrategyInputSampleProjectionUnavailable> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("fixed width"),
        ))
    }

    fn u64(&mut self) -> Result<u64, StrategyInputSampleProjectionUnavailable> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed width"),
        ))
    }

    fn identity_nonzero(&mut self) -> Result<Identity, StrategyInputSampleProjectionUnavailable> {
        let identity: Identity = self.take(32)?.try_into().expect("fixed width");
        if identity == [0; 32] {
            return Err(StrategyInputSampleProjectionUnavailable::ZeroIdentity);
        }
        Ok(identity)
    }

    fn identity16_nonzero(&mut self) -> Result<[u8; 16], StrategyInputSampleProjectionUnavailable> {
        let identity: [u8; 16] = self.take(16)?.try_into().expect("fixed width");
        if identity == [0; 16] {
            return Err(StrategyInputSampleProjectionUnavailable::ZeroIdentity);
        }
        Ok(identity)
    }

    fn end(&self) -> Result<(), StrategyInputSampleProjectionUnavailable> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(StrategyInputSampleProjectionUnavailable::InvalidLength)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::owner::{
        bar_schedule::{
            BarScheduleReadbackV1, authority as bar_schedule_authority,
            prepare_bar_schedule_commit_v1,
        },
        sample_fact::tests::{
            bar_postgres_schedule_fixture_v1, bar_projection_fixture_v2, foreign_bar_schedule_v1,
            point_event_projection_fixture_v2, point_event_projection_fixture_variant_v2,
        },
        source_binding::BindingDigest,
    };
    use rstest::rstest;

    fn fixture() -> PreparedStrategyInputSampleProjectionV2 {
        let (binding, frame, timeframe, sample) = point_event_projection_fixture_v2();
        prepare_strategy_input_sample_projection_frame_v2(
            &frame,
            &[StrategyInputSampleProjectionSourceV2 {
                binding: &binding,
                timeframe: &timeframe,
                sample: &sample,
            }],
        )
        .expect("complete point-event FRAME projection")
    }

    fn bar_fixture_v3() -> PreparedStrategyInputSampleProjectionV3 {
        let (binding, frame, timeframe, sample) = bar_projection_fixture_v2();
        let schedule = bar_schedule(5, [71; 32]);
        prepare_strategy_input_sample_projection_bar_v3(
            &frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule: &schedule,
            }],
        )
        .expect("complete BAR FRAME projection")
    }

    fn bar_schedule(step: u32, store_generation: Identity) -> BarScheduleReadbackV1 {
        let mut fixture = bar_postgres_schedule_fixture_v1();
        fixture.schedule_proposal.step = step;
        let prepared = prepare_bar_schedule_commit_v1(
            fixture.schedule_proposal,
            &fixture.binding,
            &fixture.batch,
            &fixture.instrument_master,
        )
        .expect("valid BAR schedule");
        let receipt = bar_schedule_authority::build_receipt(
            &prepared.fact,
            &prepared.cut,
            BindingDigest::from_untrusted_bytes(store_generation),
            1,
        )
        .expect("valid schedule receipt");
        bar_schedule_authority::build_readback(prepared.fact, prepared.cut, receipt)
            .expect("valid schedule readback")
    }

    pub(crate) fn recomputed_coordinate_mutation_fixture_v2() -> (Vec<u8>, [u8; 32]) {
        let prepared = fixture();
        let mut bytes = prepared.canonical_bytes().to_vec();
        let coordinate_start = RECEIPT_HEADER_LEN + 304;
        let coordinate_digest_start = coordinate_start - 32;
        let logical_time_offset = coordinate_start + 116;
        bytes[logical_time_offset] ^= 1;
        let coordinate_digest = sha256(COORDINATE_DOMAIN, &bytes[coordinate_start..]);
        bytes[coordinate_digest_start..coordinate_start].copy_from_slice(&coordinate_digest);
        let receipt_digest = sha256(RECEIPT_DOMAIN, &bytes);
        assert!(decode_strategy_input_sample_projection_v2(&bytes, receipt_digest).is_ok());
        (bytes, receipt_digest)
    }

    #[rstest]
    fn frame_projection_is_exact_and_structural_decode_recomputes_evidence() {
        let prepared = fixture();
        assert_eq!(prepared.kind_tag(), 0x01);
        assert_eq!(prepared.component_count(), 1);
        assert_eq!(prepared.canonical_bytes().len(), 653);
        let stored = decode_strategy_input_sample_projection_v2(
            prepared.canonical_bytes(),
            prepared.receipt_digest(),
        )
        .expect("exact stored FRAME projection");
        assert_eq!(stored.kind_tag(), prepared.kind_tag());
        assert_eq!(stored.subject_identity(), prepared.subject_identity());
        assert_eq!(stored.component_count(), prepared.component_count());
        assert_eq!(stored.canonical_bytes(), prepared.canonical_bytes());
        assert_eq!(stored.receipt_digest(), prepared.receipt_digest());
    }

    #[rstest]
    fn v2_remains_event_only_and_v3_bar_requires_bar_timeframe() {
        let (bar_binding, bar_frame, bar_timeframe, bar_sample) = bar_projection_fixture_v2();
        let bar_schedule = bar_schedule(5, [71; 32]);
        assert_eq!(
            prepare_strategy_input_sample_projection_frame_v2(
                &bar_frame,
                &[StrategyInputSampleProjectionSourceV2 {
                    binding: &bar_binding,
                    timeframe: &bar_timeframe,
                    sample: &bar_sample,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::UnsupportedKind
        );

        let prepared_v2 = fixture();
        let decoded_v2 = decode_strategy_input_sample_projection_v2(
            prepared_v2.canonical_bytes(),
            prepared_v2.receipt_digest(),
        )
        .expect("valid event-only V2 projection");
        assert_eq!(
            verify_decoded_projection_component_native_v2(
                &decoded_v2.components()[0],
                &bar_timeframe,
                &bar_sample,
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::SampleMismatch
        );

        let prepared = prepare_strategy_input_sample_projection_bar_v3(
            &bar_frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &bar_binding,
                timeframe: &bar_timeframe,
                sample: &bar_sample,
                schedule: &bar_schedule,
            }],
        )
        .expect("V3 BAR lifecycle and BAR native timeframe");
        assert_eq!(prepared.component_count(), 1);
        assert_eq!(prepared.kind_tag(), FRAME_KIND);
        assert_eq!(prepared.lifecycle_kind(), StrategyInputEventKind::Bar);

        let (_, _, event_timeframe, _) = point_event_projection_fixture_v2();
        assert_eq!(
            prepare_strategy_input_sample_projection_bar_v3(
                &bar_frame,
                &[StrategyInputSampleProjectionSourceV3 {
                    binding: &bar_binding,
                    timeframe: &event_timeframe,
                    sample: &bar_sample,
                    schedule: &bar_schedule,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::TimeframeMismatch
        );

        let (event_binding, event_frame, _, event_sample) = point_event_projection_fixture_v2();
        assert_eq!(
            prepare_strategy_input_sample_projection_bar_v3(
                &event_frame,
                &[StrategyInputSampleProjectionSourceV3 {
                    binding: &event_binding,
                    timeframe: &bar_timeframe,
                    sample: &event_sample,
                    schedule: &bar_schedule,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::UnsupportedKind
        );
    }

    #[rstest]
    fn v3_bar_codec_retains_lifecycle_and_cannot_cross_reinterpret_v2() {
        let prepared_v2 = fixture();
        let prepared_v3 = bar_fixture_v3();
        assert_eq!(prepared_v3.canonical_bytes().len(), 654);

        let decoded = decode_strategy_input_sample_projection_v3(
            prepared_v3.canonical_bytes(),
            prepared_v3.receipt_digest(),
        )
        .expect("exact stored V3 BAR projection");
        assert_eq!(decoded.kind_tag(), FRAME_KIND);
        assert_eq!(decoded.lifecycle_kind(), StrategyInputEventKind::Bar);
        assert_eq!(decoded.lifecycle_tag(), BAR_LIFECYCLE_KIND);
        assert_eq!(decoded.subject_identity(), prepared_v3.subject_identity());
        assert_eq!(decoded.component_count(), prepared_v3.component_count());
        assert_eq!(decoded.canonical_bytes(), prepared_v3.canonical_bytes());
        assert_eq!(decoded.receipt_digest(), prepared_v3.receipt_digest());
        assert_eq!(prepared_v3.schedule_dependencies().len(), 1);
        assert_eq!(decoded.components().len(), 1);
        assert_eq!(
            prepared_v3.schedule_dependencies()[0].role_identity(),
            decoded.components()[0].role_identity()
        );
        assert_eq!(
            prepared_v3.schedule_dependencies()[0].binding_receipt_digest(),
            decoded.components()[0].binding_receipt_digest()
        );

        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                prepared_v3.canonical_bytes(),
                sha256(RECEIPT_DOMAIN, prepared_v3.canonical_bytes()),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::InvalidLength
        );
        assert_eq!(
            decode_strategy_input_sample_projection_v3(
                prepared_v2.canonical_bytes(),
                sha256(RECEIPT_DOMAIN_V3, prepared_v2.canonical_bytes()),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::InvalidLength
        );
    }

    #[rstest]
    fn v3_bar_retains_exact_schedule_dependency_outside_stable_codec() {
        let (binding, frame, timeframe, sample) = bar_projection_fixture_v2();
        let first_schedule = bar_schedule(5, [71; 32]);
        let second_schedule = bar_schedule(5, [72; 32]);
        let first = prepare_strategy_input_sample_projection_bar_v3(
            &frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule: &first_schedule,
            }],
        )
        .expect("first exact schedule custody");
        let second = prepare_strategy_input_sample_projection_bar_v3(
            &frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule: &second_schedule,
            }],
        )
        .expect("second shape-identical schedule custody");

        assert_eq!(first.canonical_bytes().len(), 654);
        assert_eq!(first.canonical_bytes(), second.canonical_bytes());
        assert_eq!(first.receipt_digest(), second.receipt_digest());
        let first_dependency = &first.schedule_dependencies()[0];
        let second_dependency = &second.schedule_dependencies()[0];
        assert_ne!(
            first_dependency.schedule_readback_identity(),
            second_dependency.schedule_readback_identity()
        );
        assert_ne!(
            first_dependency.schedule_receipt_identity(),
            second_dependency.schedule_receipt_identity()
        );
        assert_eq!(
            first_dependency.schedule_fact_digest(),
            second_dependency.schedule_fact_digest()
        );
        assert_eq!(
            first_dependency.schedule_cut_identity(),
            second_dependency.schedule_cut_identity()
        );
        assert_eq!(
            first_dependency.schedule_cut_digest(),
            first_dependency.schedule_cut_identity()
        );
    }

    #[rstest]
    fn v3_bar_rejects_shape_mismatched_schedule_timeframe_splice() {
        let (binding, frame, timeframe, sample) = bar_projection_fixture_v2();
        let mismatched_schedule = bar_schedule(10, [73; 32]);
        assert_eq!(
            prepare_strategy_input_sample_projection_bar_v3(
                &frame,
                &[StrategyInputSampleProjectionSourceV3 {
                    binding: &binding,
                    timeframe: &timeframe,
                    sample: &sample,
                    schedule: &mismatched_schedule,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::TimeframeMismatch
        );
    }

    #[rstest]
    #[case([81; 32], [7; 32], [11; 32])]
    #[case([9; 32], [82; 32], [11; 32])]
    #[case([9; 32], [7; 32], [83; 32])]
    #[case([81; 32], [82; 32], [83; 32])]
    fn v3_bar_rejects_shape_identical_foreign_authority_schedule_splice(
        #[case] instrument_master_digest: Identity,
        #[case] source_frontier: Identity,
        #[case] correction_frontier: Identity,
    ) {
        let (binding, frame, timeframe, sample) = bar_projection_fixture_v2();
        let foreign_schedule = foreign_bar_schedule_v1(
            BindingDigest::from_untrusted_bytes(instrument_master_digest),
            BindingDigest::from_untrusted_bytes(source_frontier),
            BindingDigest::from_untrusted_bytes(correction_frontier),
        );
        assert!(bar_schedule_authority::verify_readback(&foreign_schedule));

        assert_eq!(
            prepare_strategy_input_sample_projection_bar_v3(
                &frame,
                &[StrategyInputSampleProjectionSourceV3 {
                    binding: &binding,
                    timeframe: &timeframe,
                    sample: &sample,
                    schedule: &foreign_schedule,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::SampleMismatch
        );
    }

    #[rstest]
    fn v3_bar_codec_rejects_lifecycle_tamper_and_native_event_reinterpretation() {
        let (bar_binding, bar_frame, bar_timeframe, bar_sample) = bar_projection_fixture_v2();
        let bar_schedule = bar_schedule(5, [71; 32]);
        let prepared = prepare_strategy_input_sample_projection_bar_v3(
            &bar_frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &bar_binding,
                timeframe: &bar_timeframe,
                sample: &bar_sample,
                schedule: &bar_schedule,
            }],
        )
        .expect("valid BAR projection");
        let mut bytes = prepared.canonical_bytes().to_vec();
        bytes[5] = 0x01;
        let digest = sha256(RECEIPT_DOMAIN_V3, &bytes);
        assert_eq!(
            decode_strategy_input_sample_projection_v3(&bytes, digest).unwrap_err(),
            StrategyInputSampleProjectionUnavailable::UnsupportedKind
        );

        let decoded = decode_strategy_input_sample_projection_v3(
            prepared.canonical_bytes(),
            prepared.receipt_digest(),
        )
        .expect("valid V3 BAR projection");
        verify_decoded_projection_component_native_v3(
            &decoded.components()[0],
            &bar_timeframe,
            &bar_sample,
        )
        .expect("decoded BAR and durable native BAR dependencies agree");
        let (_, _, event_timeframe, event_sample) = point_event_projection_fixture_v2();
        assert_eq!(
            verify_decoded_projection_component_native_v3(
                &decoded.components()[0],
                &event_timeframe,
                &event_sample,
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::SampleMismatch
        );
    }

    #[rstest]
    fn preparation_rejects_partial_and_cross_spliced_owner_evidence() {
        let (binding, frame, timeframe, sample) = point_event_projection_fixture_v2();
        assert_eq!(
            prepare_strategy_input_sample_projection_frame_v2(&frame, &[]).unwrap_err(),
            StrategyInputSampleProjectionUnavailable::CountMismatch
        );

        let (_, _, _, other_sample) = point_event_projection_fixture_variant_v2(
            11,
            2,
            31,
            BindingDigest::from_untrusted_bytes([22; 32]),
        );
        assert_eq!(
            prepare_strategy_input_sample_projection_frame_v2(
                &frame,
                &[StrategyInputSampleProjectionSourceV2 {
                    binding: &binding,
                    timeframe: &timeframe,
                    sample: &other_sample,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::SampleMismatch
        );

        let (other_binding, _, other_timeframe, _) = point_event_projection_fixture_variant_v2(
            10,
            1,
            30,
            BindingDigest::from_untrusted_bytes([23; 32]),
        );
        assert_eq!(
            prepare_strategy_input_sample_projection_frame_v2(
                &frame,
                &[StrategyInputSampleProjectionSourceV2 {
                    binding: &binding,
                    timeframe: &other_timeframe,
                    sample: &sample,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::TimeframeMismatch
        );
        assert_eq!(
            prepare_strategy_input_sample_projection_frame_v2(
                &frame,
                &[StrategyInputSampleProjectionSourceV2 {
                    binding: &other_binding,
                    timeframe: &other_timeframe,
                    sample: &sample,
                }],
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::BindingMismatch
        );
    }

    #[rstest]
    fn stored_codec_rejects_header_count_order_length_and_digest_mutations() {
        let prepared = fixture();
        let valid = prepared.canonical_bytes();

        for (offset, expected) in [
            (0, StrategyInputSampleProjectionUnavailable::InvalidSchema),
            (2, StrategyInputSampleProjectionUnavailable::ReservedNonZero),
            (4, StrategyInputSampleProjectionUnavailable::UnsupportedKind),
            (
                5,
                StrategyInputSampleProjectionUnavailable::EvidenceMismatch,
            ),
        ] {
            let mut bytes = valid.to_vec();
            bytes[offset] ^= 1;
            let digest = sha256(RECEIPT_DOMAIN, &bytes);
            assert_eq!(
                decode_strategy_input_sample_projection_v2(&bytes, digest).unwrap_err(),
                expected
            );
        }

        let mut joined_cut = valid.to_vec();
        joined_cut[4] = JOINED_CUT_KIND;
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &joined_cut,
                sha256(RECEIPT_DOMAIN, &joined_cut),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::UnsupportedKind
        );

        let mut zero_count = valid.to_vec();
        zero_count[37..41].copy_from_slice(&0_u32.to_le_bytes());
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &zero_count,
                sha256(RECEIPT_DOMAIN, &zero_count),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::EmptyFrame
        );
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &valid[..valid.len() - 1],
                sha256(RECEIPT_DOMAIN, &valid[..valid.len() - 1]),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::InvalidLength
        );
        let mut trailing = valid.to_vec();
        trailing.push(0);
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &trailing,
                sha256(RECEIPT_DOMAIN, &trailing),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::InvalidLength
        );
        assert_eq!(
            decode_strategy_input_sample_projection_v2(valid, [0; 32]).unwrap_err(),
            StrategyInputSampleProjectionUnavailable::DigestMismatch
        );

        let entry = &valid[RECEIPT_HEADER_LEN..];
        let mut duplicate = valid.to_vec();
        duplicate[37..41].copy_from_slice(&2_u32.to_le_bytes());
        duplicate.extend_from_slice(entry);
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &duplicate,
                sha256(RECEIPT_DOMAIN, &duplicate),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::NonCanonicalOrder
        );

        let mut reordered = duplicate;
        reordered[RECEIPT_HEADER_LEN + RECEIPT_ENTRY_LEN] = 21;
        assert_eq!(
            decode_strategy_input_sample_projection_v2(
                &reordered,
                sha256(RECEIPT_DOMAIN, &reordered),
            )
            .unwrap_err(),
            StrategyInputSampleProjectionUnavailable::NonCanonicalOrder
        );
    }

    #[rstest]
    fn stored_codec_rejects_each_entry_and_coordinate_cross_binding_mutation() {
        let prepared = fixture();
        let valid = prepared.canonical_bytes();
        // Every fixed entry field, plus every coordinate field, is covered against the historical
        // receipt identity. Separate tests above prove that recomputing a different outer digest
        // cannot bypass the structural and evidence cross-bindings.
        let offsets = [
            41, 73, 105, 137, 169, 185, 217, 249, 281, 313, // entry fields
            345, 347, 349, 381, 413, 429, 461, 469, 477, 485, 517, 549, 581, 589,
            621, // coordinate
        ];

        for offset in offsets {
            let mut bytes = valid.to_vec();
            bytes[offset] ^= 1;
            assert!(
                decode_strategy_input_sample_projection_v2(&bytes, prepared.receipt_digest())
                    .is_err(),
                "offset {offset} must fail closed"
            );
        }
    }
}
