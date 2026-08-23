//! Fail-closed Runtime Owner foundation status.
//!
//! This lower-maturity crate exposes no authoritative Runtime fact or custody.
//! It reports `NOT_READY` until the canonical Runtime custody and direct Owner
//! source ports required by the Runtime architecture are available. It exposes
//! no strategy deployment, process control, provider, intent, order, credential,
//! network, or trading-effect surface.

#![deny(unsafe_code)]
#![deny(missing_debug_implementations)]
#![deny(rustdoc::broken_intra_doc_links)]

/// Non-authoritative maturity state of the Runtime foundation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RuntimeFoundationStatus {
    /// Runtime cannot create or restore an authoritative Strategy Instance.
    NotReady,
}

/// Exact dependency whose arrival requires Runtime foundation revalidation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RuntimeRevalidationDependency {
    /// Governance must expose a sealed authorized-generation-decision read port.
    GovernanceAuthorizedGenerationDecisionReadPort,
    /// Runtime must own canonical durable create-or-join custody.
    CanonicalRuntimeCustodyPort,
    /// Artifact must expose an authoritative compatibility recovery read port.
    ArtifactCompatibilityRecoveryReadPort,
    /// Execution must expose an authoritative recovery frontier read port.
    ExecutionRecoveryFrontierReadPort,
}

const REVALIDATE_AFTER: [RuntimeRevalidationDependency; 4] = [
    RuntimeRevalidationDependency::GovernanceAuthorizedGenerationDecisionReadPort,
    RuntimeRevalidationDependency::CanonicalRuntimeCustodyPort,
    RuntimeRevalidationDependency::ArtifactCompatibilityRecoveryReadPort,
    RuntimeRevalidationDependency::ExecutionRecoveryFrontierReadPort,
];

/// Direct, non-authoritative Runtime foundation API.
///
/// This value is only a static capability/status projection. It is not a
/// Runtime Readiness Fact and cannot prove an instance, generation,
/// checkpoint, application, Risk, Execution, or trading state.
#[derive(Clone, Copy, Debug, Default)]
pub struct RuntimeFoundation;

impl RuntimeFoundation {
    /// Returns the only currently admitted public foundation status.
    #[must_use]
    pub const fn status(&self) -> RuntimeFoundationStatus {
        RuntimeFoundationStatus::NotReady
    }

    /// Returns every exact dependency that must trigger revalidation.
    #[must_use]
    pub const fn revalidate_after(&self) -> &'static [RuntimeRevalidationDependency] {
        &REVALIDATE_AFTER
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{RuntimeFoundation, RuntimeFoundationStatus};

    #[rstest]
    fn foundation_remains_not_ready() {
        assert_eq!(
            RuntimeFoundation.status(),
            RuntimeFoundationStatus::NotReady
        );
    }
}
