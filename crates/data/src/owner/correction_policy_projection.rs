//! Private deterministic projection of Source Binding correction lineage for Replay.

#![allow(dead_code, reason = "Replay W3 is the fixed future consumer")]

mod authority;
mod codec;

use super::{
    reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1,
    source_binding::{BindingDigest, SourceBindingOwnerReadback},
};

pub(crate) type CorrectionPolicyProjectionIdentityV1 = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CorrectionPolicyProjectionErrorV1 {
    InvalidInput,
    DependencyMismatch,
    LineageGap,
    LineageRegression,
    LineageBranch,
    CrossSourceSplice,
    FrontierGap,
    FrontierRegression,
    StreamChanged,
    ClockCoordinateMismatch,
    InvalidInterval,
    CapacityExceeded,
    CorruptCanonicalBytes,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorrectionPolicyProjectionV1 {
    stream_identity: Box<[u8]>,
    sequence: u64,
    successor_only: bool,
    source_binding_identity: BindingDigest,
    source_binding_fact_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    correction_frontier_digest: BindingDigest,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    clock_head_identity: BindingDigest,
    clock_head_digest: BindingDigest,
    r0_coordinate_identity: BindingDigest,
    r0_coordinate_digest: BindingDigest,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl CorrectionPolicyProjectionV1 {
    pub(crate) fn stream_identity(&self) -> &[u8] {
        &self.stream_identity
    }
    pub(crate) const fn sequence(&self) -> u64 {
        self.sequence
    }
    pub(crate) const fn successor_only(&self) -> bool {
        self.successor_only
    }
    pub(crate) const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }
    pub(crate) const fn source_binding_fact_digest(&self) -> BindingDigest {
        self.source_binding_fact_digest
    }
    pub(crate) const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub(crate) const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    pub(crate) const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }
    pub(crate) const fn effective_from_ns(&self) -> i128 {
        self.effective_from_ns
    }
    pub(crate) const fn effective_until_ns(&self) -> Option<i128> {
        self.effective_until_ns
    }
    pub(crate) const fn provider_available_ns(&self) -> i128 {
        self.provider_available_ns
    }
    pub(crate) const fn retrieval_ns(&self) -> i128 {
        self.retrieval_ns
    }
    pub(crate) const fn correction_publication_ns(&self) -> i128 {
        self.correction_publication_ns
    }
    pub(crate) const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub(crate) const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
    pub(crate) const fn clock_head_identity(&self) -> BindingDigest {
        self.clock_head_identity
    }
    pub(crate) const fn clock_head_digest(&self) -> BindingDigest {
        self.clock_head_digest
    }
    pub(crate) const fn r0_coordinate_identity(&self) -> BindingDigest {
        self.r0_coordinate_identity
    }
    pub(crate) const fn r0_coordinate_digest(&self) -> BindingDigest {
        self.r0_coordinate_digest
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

#[derive(Clone, Copy)]
pub(crate) struct CorrectionPolicyAuthenticatedInputsV1<'a> {
    pub(crate) source_binding: &'a SourceBindingOwnerReadback,
    pub(crate) coordinates: &'a VerifiedReferenceFactCoordinatesV1,
    pub(crate) r0_coordinate_identity: BindingDigest,
    pub(crate) r0_coordinate_digest: BindingDigest,
}

pub(crate) fn project_first_v1(
    inputs: CorrectionPolicyAuthenticatedInputsV1<'_>,
) -> Result<CorrectionPolicyProjectionV1, CorrectionPolicyProjectionErrorV1> {
    authority::project_first_v1(inputs)
}

pub(crate) fn project_successor_v1(
    prior: &CorrectionPolicyProjectionV1,
    inputs: CorrectionPolicyAuthenticatedInputsV1<'_>,
) -> Result<
    (CorrectionPolicyProjectionV1, CorrectionPolicyProjectionV1),
    CorrectionPolicyProjectionErrorV1,
> {
    authority::project_successor_v1(prior, inputs)
}

#[cfg(test)]
mod tests;
