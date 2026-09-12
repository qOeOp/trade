//! Strategy Factory handoff for Backtest-owned Native Replay preparation.
//!
//! The resolver is sealed to Strategy Factory implementations. It returns one move-only execution
//! bundle together with producer-owned observation bytes; Backtest can reconcile and persist those
//! bytes, but callers cannot manufacture a positive preparation handoff.

use std::{future::Future, pin::Pin};

use vibe_backtest_owner_contracts::{CanonicalDigestV2, ObservationComponentV2, OpaqueIdentityV2};

use crate::{
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
};

/// Exact producer bytes and meaning retained for one requested Replay component.
pub struct NativeReplayOwnerObservationV2 {
    component: ObservationComponentV2,
    producer_namespace: OpaqueIdentityV2,
    producer_reference: OpaqueIdentityV2,
    canonical_bytes: Vec<u8>,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
}

impl NativeReplayOwnerObservationV2 {
    #[allow(
        dead_code,
        reason = "the sealed production resolver is the immediate successor of this handoff contract"
    )]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_owner_resolution(
        component: ObservationComponentV2,
        producer_namespace: OpaqueIdentityV2,
        producer_reference: OpaqueIdentityV2,
        canonical_bytes: Vec<u8>,
        observed_meaning_identity: OpaqueIdentityV2,
        observed_meaning_digest: CanonicalDigestV2,
    ) -> Self {
        Self {
            component,
            producer_namespace,
            producer_reference,
            canonical_bytes,
            observed_meaning_identity,
            observed_meaning_digest,
        }
    }

    #[must_use]
    pub fn into_parts(
        self,
    ) -> (
        ObservationComponentV2,
        OpaqueIdentityV2,
        OpaqueIdentityV2,
        Vec<u8>,
        OpaqueIdentityV2,
        CanonicalDigestV2,
    ) {
        (
            self.component,
            self.producer_namespace,
            self.producer_reference,
            self.canonical_bytes,
            self.observed_meaning_identity,
            self.observed_meaning_digest,
        )
    }
}

/// Move-only complete Strategy Factory handoff consumed by the Backtest preparation Owner.
pub struct NativeReplayExecutionPreparationV2 {
    request: SealedExploratoryReplayReadbackV2,
    execution: ReplayTargetSetExecutionBundleV1,
    component_observations: Vec<NativeReplayOwnerObservationV2>,
    semantic_trace_reference: OpaqueIdentityV2,
    deterministic_fill_seed: u64,
    instance_identity: OpaqueIdentityV2,
}

impl NativeReplayExecutionPreparationV2 {
    #[allow(
        dead_code,
        reason = "the sealed production resolver is the immediate successor of this handoff contract"
    )]
    pub(crate) fn from_owner_resolution(
        request: SealedExploratoryReplayReadbackV2,
        execution: ReplayTargetSetExecutionBundleV1,
        component_observations: Vec<NativeReplayOwnerObservationV2>,
        semantic_trace_reference: OpaqueIdentityV2,
        deterministic_fill_seed: u64,
        instance_identity: OpaqueIdentityV2,
    ) -> Self {
        Self {
            request,
            execution,
            component_observations,
            semantic_trace_reference,
            deterministic_fill_seed,
            instance_identity,
        }
    }

    #[must_use]
    pub fn into_parts(
        self,
    ) -> (
        SealedExploratoryReplayReadbackV2,
        ReplayTargetSetExecutionBundleV1,
        Vec<NativeReplayOwnerObservationV2>,
        OpaqueIdentityV2,
        u64,
        OpaqueIdentityV2,
    ) {
        (
            self.request,
            self.execution,
            self.component_observations,
            self.semantic_trace_reference,
            self.deterministic_fill_seed,
            self.instance_identity,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("Strategy Factory Native Replay preparation is unavailable")]
pub struct NativeReplayExecutionPreparationErrorV2;

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Owner-only resolver for one exact request-to-execution preparation cut.
pub trait NativeReplayExecutionPreparationResolverV2: sealed::Sealed + Send + Sync {
    fn resolve_native_replay_execution_preparation_v2<'a>(
        &'a self,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        attempt_identity: &'a OpaqueIdentityV2,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        NativeReplayExecutionPreparationV2,
                        NativeReplayExecutionPreparationErrorV2,
                    >,
                > + 'a,
        >,
    >;
}
