//! Additive BAR `FRAME/JOINED_CUT` projection over exact V3 Owner custody.

#![allow(
    dead_code,
    reason = "V4 preparation remains Owner-private until its first admitted W3 consumer"
)]

use async_trait::async_trait;
use sha2::{Digest, Sha256};

use super::{
    sample_projection::DecodedStrategyInputSampleProjectionV3,
    strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1,
};

pub(super) const SCHEMA_V4: u16 = 4;
pub(super) const FRAME_KIND_V4: u8 = 1;
pub(super) const JOINED_CUT_KIND_V4: u8 = 2;
pub(super) const BAR_LIFECYCLE_V4: u8 = 2;
pub(super) const HEADER_LEN_V4: usize = 74;
pub(super) const COMPONENT_LEN_V4: usize = 612;
pub(super) const V3_HEADER_LEN: usize = 42;
const RECEIPT_DOMAIN_V4: &[u8] = b"market-data.sample-projection-receipt.v4\0";
const SCHEDULE_SET_DOMAIN_V4: &[u8] = b"market-data.sample-projection-schedule-dependency-set.v4\0";

pub type StrategyInputSampleProjectionIdentityV4 = [u8; 32];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum StrategyInputSampleProjectionKindV4 {
    Frame = FRAME_KIND_V4,
    JoinedCut = JOINED_CUT_KIND_V4,
}

impl StrategyInputSampleProjectionKindV4 {
    const fn tag(self) -> u8 {
        self as u8
    }

    fn from_tag(tag: u8) -> Result<Self, StrategyInputSampleProjectionErrorV4> {
        match tag {
            FRAME_KIND_V4 => Ok(Self::Frame),
            JOINED_CUT_KIND_V4 => Ok(Self::JoinedCut),
            _ => Err(StrategyInputSampleProjectionErrorV4::UnsupportedKind),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedStrategyInputSampleProjectionLocatorV4 {
    receipt_digest: StrategyInputSampleProjectionIdentityV4,
}

impl UntrustedStrategyInputSampleProjectionLocatorV4 {
    #[must_use]
    pub const fn from_untrusted(receipt_digest: StrategyInputSampleProjectionIdentityV4) -> Self {
        Self { receipt_digest }
    }

    #[must_use]
    pub const fn receipt_digest(&self) -> StrategyInputSampleProjectionIdentityV4 {
        self.receipt_digest
    }
}

#[derive(Debug)]
pub struct StrategyInputSampleProjectionReadbackV4 {
    decoded: DecodedStrategyInputSampleProjectionV4,
}

impl StrategyInputSampleProjectionReadbackV4 {
    #[must_use]
    pub const fn receipt_digest(&self) -> StrategyInputSampleProjectionIdentityV4 {
        self.decoded.receipt_digest
    }

    #[must_use]
    pub const fn kind(&self) -> StrategyInputSampleProjectionKindV4 {
        self.decoded.kind
    }

    #[must_use]
    pub const fn subject_identity(&self) -> StrategyInputSampleProjectionIdentityV4 {
        self.decoded.subject_identity
    }

    #[must_use]
    pub const fn schedule_dependency_set_digest(&self) -> StrategyInputSampleProjectionIdentityV4 {
        self.decoded.schedule_dependency_set_digest
    }

    #[must_use]
    pub const fn component_count(&self) -> u32 {
        self.decoded.component_count
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.decoded.canonical_bytes
    }

    pub(super) const fn from_verified(decoded: DecodedStrategyInputSampleProjectionV4) -> Self {
        Self { decoded }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("Market Data V4 BAR sample projection is unavailable")]
pub struct StrategyInputSampleProjectionResolveErrorV4;

pub(super) mod sealed {
    pub trait Sealed {}
}

#[async_trait]
pub trait StrategyInputSampleProjectionResolverV4: sealed::Sealed + Send + Sync {
    async fn resolve_strategy_input_sample_projection_v4(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV4,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionResolveErrorV4>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ScheduleDependencyV4 {
    pub(super) source_projection_digest: [u8; 32],
    pub(super) role_identity: [u8; 32],
    pub(super) binding_receipt_digest: [u8; 32],
    pub(super) timeframe_projection_digest: [u8; 32],
    pub(super) schedule_readback_identity: [u8; 32],
    pub(super) schedule_fact_digest: [u8; 32],
    pub(super) schedule_cut_identity: [u8; 32],
    pub(super) schedule_cut_digest: [u8; 32],
    pub(super) schedule_receipt_identity: [u8; 32],
}

#[derive(Debug)]
pub(super) struct VerifiedV3ProjectionSourceV4<'a> {
    pub(super) projection: &'a DecodedStrategyInputSampleProjectionV3,
    pub(super) dependencies: &'a [ScheduleDependencyV4],
}

#[derive(Debug)]
pub(crate) struct PreparedStrategyInputSampleProjectionV4 {
    decoded: DecodedStrategyInputSampleProjectionV4,
    dependencies: Box<[ScheduleDependencyV4]>,
}

impl PreparedStrategyInputSampleProjectionV4 {
    pub(crate) const fn receipt_digest(&self) -> [u8; 32] {
        self.decoded.receipt_digest
    }

    pub(crate) const fn kind(&self) -> StrategyInputSampleProjectionKindV4 {
        self.decoded.kind
    }

    pub(crate) const fn subject_identity(&self) -> [u8; 32] {
        self.decoded.subject_identity
    }

    pub(crate) const fn schedule_dependency_set_digest(&self) -> [u8; 32] {
        self.decoded.schedule_dependency_set_digest
    }

    pub(crate) const fn component_count(&self) -> u32 {
        self.decoded.component_count
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.decoded.canonical_bytes
    }

    pub(super) fn dependencies(&self) -> &[ScheduleDependencyV4] {
        &self.dependencies
    }
}

#[derive(Debug)]
pub(super) struct DecodedStrategyInputSampleProjectionV4 {
    canonical_bytes: Box<[u8]>,
    receipt_digest: [u8; 32],
    kind: StrategyInputSampleProjectionKindV4,
    subject_identity: [u8; 32],
    schedule_dependency_set_digest: [u8; 32],
    component_count: u32,
}

impl DecodedStrategyInputSampleProjectionV4 {
    pub(super) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(super) const fn kind(&self) -> StrategyInputSampleProjectionKindV4 {
        self.kind
    }

    pub(super) const fn subject_identity(&self) -> [u8; 32] {
        self.subject_identity
    }

    pub(super) const fn schedule_dependency_set_digest(&self) -> [u8; 32] {
        self.schedule_dependency_set_digest
    }

    pub(super) const fn component_count(&self) -> u32 {
        self.component_count
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StrategyInputSampleProjectionErrorV4 {
    InvalidLength,
    InvalidSchema,
    ReservedNonZero,
    UnsupportedKind,
    UnsupportedLifecycle,
    EmptyProjection,
    CountMismatch,
    NonCanonicalOrder,
    SubjectMismatch,
    ComponentMismatch,
    ScheduleDependencyMismatch,
    DigestMismatch,
    StoreUnavailable,
    StoreUntrusted,
    IdentityConflict,
    CommitInterrupted,
    ResponseLost,
    UnknownIdentity,
}

pub(super) fn prepare_frame_v4(
    source: VerifiedV3ProjectionSourceV4<'_>,
) -> Result<PreparedStrategyInputSampleProjectionV4, StrategyInputSampleProjectionErrorV4> {
    prepare_v4(
        StrategyInputSampleProjectionKindV4::Frame,
        source.projection.subject_identity(),
        None,
        &[source],
    )
}

pub(super) fn prepare_joined_cut_v4(
    joined_cut: &StrategyInputJoinedCutReceiptV1,
    sources: &[VerifiedV3ProjectionSourceV4<'_>],
) -> Result<PreparedStrategyInputSampleProjectionV4, StrategyInputSampleProjectionErrorV4> {
    if !joined_cut.has_valid_digest() || joined_cut.components().len() < 2 {
        return Err(StrategyInputSampleProjectionErrorV4::SubjectMismatch);
    }
    prepare_v4(
        StrategyInputSampleProjectionKindV4::JoinedCut,
        *joined_cut.digest().as_bytes(),
        Some(joined_cut),
        sources,
    )
}

fn prepare_v4(
    kind: StrategyInputSampleProjectionKindV4,
    subject_identity: [u8; 32],
    joined_cut: Option<&StrategyInputJoinedCutReceiptV1>,
    sources: &[VerifiedV3ProjectionSourceV4<'_>],
) -> Result<PreparedStrategyInputSampleProjectionV4, StrategyInputSampleProjectionErrorV4> {
    if sources.is_empty() || subject_identity == [0; 32] {
        return Err(StrategyInputSampleProjectionErrorV4::EmptyProjection);
    }
    let mut component_bytes = Vec::new();
    let mut dependencies = Vec::new();
    for source in sources {
        let projection = source.projection;
        if projection.kind_tag() != FRAME_KIND_V4
            || projection.lifecycle_tag() != BAR_LIFECYCLE_V4
            || projection.component_count() as usize != source.dependencies.len()
        {
            return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
        }
        let bytes = projection.canonical_bytes();
        let entries = bytes
            .get(V3_HEADER_LEN..)
            .ok_or(StrategyInputSampleProjectionErrorV4::InvalidLength)?;
        if entries.len() != COMPONENT_LEN_V4 * source.dependencies.len() {
            return Err(StrategyInputSampleProjectionErrorV4::InvalidLength);
        }
        for ((decoded, dependency), exact) in projection
            .components()
            .iter()
            .zip(source.dependencies)
            .zip(entries.chunks_exact(COMPONENT_LEN_V4))
        {
            if dependency.source_projection_digest != projection.receipt_digest()
                || decoded.role_identity() != dependency.role_identity
                || decoded.binding_receipt_digest() != dependency.binding_receipt_digest
                || decoded.timeframe_projection_digest() != dependency.timeframe_projection_digest
                || exact.get(..32) != Some(decoded.role_identity().as_slice())
                || exact.get(32..64) != Some(decoded.binding_receipt_digest().as_slice())
                || exact.get(176..208) != Some(decoded.timeframe_projection_digest().as_slice())
                || exact.get(208..240) != Some(decoded.sample_identity().as_slice())
                || exact.get(240..272) != Some(decoded.sample_receipt_digest().as_slice())
                || exact.get(272..304).is_none()
                || exact.get(304..612) != Some(decoded.coordinate().as_slice())
            {
                return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
            }
            component_bytes.extend_from_slice(exact);
            dependencies.push(*dependency);
        }
    }
    if dependencies.is_empty() || dependencies.len() > u32::MAX as usize {
        return Err(StrategyInputSampleProjectionErrorV4::EmptyProjection);
    }
    dependencies.sort_by_key(|dependency| dependency.role_identity);
    if dependencies
        .windows(2)
        .any(|pair| pair[0].role_identity >= pair[1].role_identity)
    {
        return Err(StrategyInputSampleProjectionErrorV4::NonCanonicalOrder);
    }
    let mut exact_components = component_bytes
        .chunks_exact(COMPONENT_LEN_V4)
        .map(<[u8; COMPONENT_LEN_V4]>::try_from)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?;
    exact_components.sort_by_key(|entry| <[u8; 32]>::try_from(&entry[..32]).unwrap_or([0; 32]));
    if let Some(joined) = joined_cut {
        if joined.components().len() != exact_components.len() {
            return Err(StrategyInputSampleProjectionErrorV4::CountMismatch);
        }
        for (joined_component, exact) in joined.components().iter().zip(&exact_components) {
            let values = joined_component.frame().values();
            let [value] = values else {
                return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
            };
            if value.input_role_identity().as_bytes() != &exact[..32]
                || value.binding_receipt_digest().as_bytes() != &exact[32..64]
                || joined_component.frame().trigger().digest().as_bytes() != &exact[96..128]
                || value.digest().as_bytes() != &exact[144..176]
            {
                return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
            }
        }
    }
    let schedule_dependency_set_digest = schedule_set_digest(&dependencies);
    let component_count = u32::try_from(exact_components.len())
        .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?;
    let mut bytes = Vec::with_capacity(HEADER_LEN_V4 + COMPONENT_LEN_V4 * exact_components.len());
    bytes.extend_from_slice(&SCHEMA_V4.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.push(kind.tag());
    bytes.push(BAR_LIFECYCLE_V4);
    bytes.extend_from_slice(&subject_identity);
    bytes.extend_from_slice(&schedule_dependency_set_digest);
    bytes.extend_from_slice(&component_count.to_le_bytes());
    for component in exact_components {
        bytes.extend_from_slice(&component);
    }
    let receipt_digest = digest(RECEIPT_DOMAIN_V4, &bytes);
    Ok(PreparedStrategyInputSampleProjectionV4 {
        decoded: DecodedStrategyInputSampleProjectionV4 {
            canonical_bytes: bytes.into_boxed_slice(),
            receipt_digest,
            kind,
            subject_identity,
            schedule_dependency_set_digest,
            component_count,
        },
        dependencies: dependencies.into_boxed_slice(),
    })
}

pub(super) fn decode_v4(
    bytes: &[u8],
    expected_digest: [u8; 32],
) -> Result<DecodedStrategyInputSampleProjectionV4, StrategyInputSampleProjectionErrorV4> {
    if bytes.len() < HEADER_LEN_V4 {
        return Err(StrategyInputSampleProjectionErrorV4::InvalidLength);
    }
    if u16::from_le_bytes([bytes[0], bytes[1]]) != SCHEMA_V4 {
        return Err(StrategyInputSampleProjectionErrorV4::InvalidSchema);
    }
    if bytes[2..4] != [0, 0] {
        return Err(StrategyInputSampleProjectionErrorV4::ReservedNonZero);
    }
    let kind = StrategyInputSampleProjectionKindV4::from_tag(bytes[4])?;
    if bytes[5] != BAR_LIFECYCLE_V4 {
        return Err(StrategyInputSampleProjectionErrorV4::UnsupportedLifecycle);
    }
    let subject_identity = bytes[6..38]
        .try_into()
        .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?;
    let schedule_dependency_set_digest = bytes[38..70]
        .try_into()
        .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?;
    let component_count = u32::from_le_bytes(
        bytes[70..74]
            .try_into()
            .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?,
    );
    if component_count == 0
        || (kind == StrategyInputSampleProjectionKindV4::JoinedCut && component_count < 2)
        || bytes.len() != HEADER_LEN_V4 + COMPONENT_LEN_V4 * component_count as usize
    {
        return Err(StrategyInputSampleProjectionErrorV4::CountMismatch);
    }
    let mut previous = None;
    for component in bytes[HEADER_LEN_V4..].chunks_exact(COMPONENT_LEN_V4) {
        let role: [u8; 32] = component[..32]
            .try_into()
            .map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?;
        if role == [0; 32] || previous.is_some_and(|prior| prior >= role) {
            return Err(StrategyInputSampleProjectionErrorV4::NonCanonicalOrder);
        }
        previous = Some(role);
    }
    let actual = digest(RECEIPT_DOMAIN_V4, bytes);
    if actual != expected_digest {
        return Err(StrategyInputSampleProjectionErrorV4::DigestMismatch);
    }
    Ok(DecodedStrategyInputSampleProjectionV4 {
        canonical_bytes: bytes.to_vec().into_boxed_slice(),
        receipt_digest: actual,
        kind,
        subject_identity,
        schedule_dependency_set_digest,
        component_count,
    })
}

pub(super) fn schedule_set_digest(dependencies: &[ScheduleDependencyV4]) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(8 + dependencies.len() * 288);
    bytes.extend_from_slice(&SCHEMA_V4.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&(dependencies.len() as u32).to_le_bytes());
    for dependency in dependencies {
        bytes.extend_from_slice(&dependency.source_projection_digest);
        bytes.extend_from_slice(&dependency.role_identity);
        bytes.extend_from_slice(&dependency.binding_receipt_digest);
        bytes.extend_from_slice(&dependency.timeframe_projection_digest);
        bytes.extend_from_slice(&dependency.schedule_readback_identity);
        bytes.extend_from_slice(&dependency.schedule_fact_digest);
        bytes.extend_from_slice(&dependency.schedule_cut_identity);
        bytes.extend_from_slice(&dependency.schedule_cut_digest);
        bytes.extend_from_slice(&dependency.schedule_receipt_identity);
    }
    digest(SCHEDULE_SET_DOMAIN_V4, &bytes)
}

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{
        sample_fact::tests::{bar_projection_fixture_v2, foreign_bar_schedule_v1},
        sample_projection::{
            StrategyInputSampleProjectionSourceV3, decode_strategy_input_sample_projection_v3,
            prepare_strategy_input_sample_projection_bar_v3,
        },
        source_binding::BindingDigest,
    };
    use rstest::rstest;

    fn frame_fixture() -> (
        DecodedStrategyInputSampleProjectionV3,
        Vec<ScheduleDependencyV4>,
    ) {
        let (binding, frame, timeframe, sample) = bar_projection_fixture_v2();
        let schedule = foreign_bar_schedule_v1(
            BindingDigest::from_untrusted_bytes(sample.fact().instrument_master_digest()),
            BindingDigest::from_untrusted_bytes(sample.fact().source_frontier_digest()),
            BindingDigest::from_untrusted_bytes(sample.fact().correction_frontier_digest()),
        );
        let prepared = prepare_strategy_input_sample_projection_bar_v3(
            &frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule: &schedule,
            }],
        )
        .unwrap();
        let dependency = &prepared.schedule_dependencies()[0];
        let projection = decode_strategy_input_sample_projection_v3(
            prepared.canonical_bytes(),
            prepared.receipt_digest(),
        )
        .unwrap();
        let dependencies = vec![ScheduleDependencyV4 {
            source_projection_digest: projection.receipt_digest(),
            role_identity: dependency.role_identity(),
            binding_receipt_digest: dependency.binding_receipt_digest(),
            timeframe_projection_digest: projection.components()[0].timeframe_projection_digest(),
            schedule_readback_identity: dependency.schedule_readback_identity(),
            schedule_fact_digest: dependency.schedule_fact_digest(),
            schedule_cut_identity: dependency.schedule_cut_identity(),
            schedule_cut_digest: dependency.schedule_cut_digest(),
            schedule_receipt_identity: dependency.schedule_receipt_identity(),
        }];
        (projection, dependencies)
    }

    #[rstest]
    fn frame_codec_binds_exact_v3_component_and_schedule_set() {
        let (projection, dependencies) = frame_fixture();
        let prepared = prepare_frame_v4(VerifiedV3ProjectionSourceV4 {
            projection: &projection,
            dependencies: &dependencies,
        })
        .unwrap();
        assert_eq!(
            prepared.receipt_digest(),
            [
                0x53, 0x37, 0x5b, 0x9d, 0xcc, 0xb4, 0x0f, 0x9b, 0x27, 0x7e, 0x90, 0xff, 0x5a, 0x8e,
                0x26, 0x1a, 0x8e, 0x48, 0xf8, 0xeb, 0xa1, 0xab, 0xea, 0x5c, 0x16, 0xf6, 0xf6, 0x13,
                0x00, 0x34, 0x2f, 0x42,
            ]
        );
        assert_eq!(prepared.kind(), StrategyInputSampleProjectionKindV4::Frame);
        assert_eq!(prepared.component_count(), 1);
        assert_eq!(
            prepared.canonical_bytes().len(),
            HEADER_LEN_V4 + COMPONENT_LEN_V4
        );
        assert_eq!(
            prepared.schedule_dependency_set_digest(),
            schedule_set_digest(&dependencies)
        );
        let decoded = decode_v4(prepared.canonical_bytes(), prepared.receipt_digest()).unwrap();
        assert_eq!(decoded.component_count(), 1);
        assert_eq!(
            &prepared.canonical_bytes()[HEADER_LEN_V4..],
            &projection.canonical_bytes()[V3_HEADER_LEN..]
        );
    }

    #[rstest]
    fn schedule_or_component_substitution_changes_or_rejects_identity() {
        let (projection, mut dependencies) = frame_fixture();
        let original = prepare_frame_v4(VerifiedV3ProjectionSourceV4 {
            projection: &projection,
            dependencies: &dependencies,
        })
        .unwrap();
        dependencies[0].schedule_cut_digest[0] ^= 1;
        let changed = prepare_frame_v4(VerifiedV3ProjectionSourceV4 {
            projection: &projection,
            dependencies: &dependencies,
        })
        .unwrap();
        assert_ne!(original.receipt_digest(), changed.receipt_digest());
        let mut corrupt = original.canonical_bytes().to_vec();
        corrupt[HEADER_LEN_V4 + 144] ^= 1;
        assert_eq!(
            decode_v4(&corrupt, original.receipt_digest()).unwrap_err(),
            StrategyInputSampleProjectionErrorV4::DigestMismatch
        );
    }

    #[rstest]
    fn decoder_rejects_kind_lifecycle_reserved_count_and_trailing_bytes() {
        let (projection, dependencies) = frame_fixture();
        let prepared = prepare_frame_v4(VerifiedV3ProjectionSourceV4 {
            projection: &projection,
            dependencies: &dependencies,
        })
        .unwrap();
        for (offset, value, expected) in [
            (2, 1, StrategyInputSampleProjectionErrorV4::ReservedNonZero),
            (4, 9, StrategyInputSampleProjectionErrorV4::UnsupportedKind),
            (
                5,
                1,
                StrategyInputSampleProjectionErrorV4::UnsupportedLifecycle,
            ),
        ] {
            let mut bytes = prepared.canonical_bytes().to_vec();
            bytes[offset] = value;
            assert_eq!(
                decode_v4(&bytes, prepared.receipt_digest()).unwrap_err(),
                expected
            );
        }
        let mut trailing = prepared.canonical_bytes().to_vec();
        trailing.push(0);
        assert_eq!(
            decode_v4(&trailing, prepared.receipt_digest()).unwrap_err(),
            StrategyInputSampleProjectionErrorV4::CountMismatch
        );
    }
}
