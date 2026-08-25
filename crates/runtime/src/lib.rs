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

use std::fmt::Debug;

use vibe_execution::{
    adapter_binding::PaperMode,
    recovery_frontier::{
        RecoveryFrontierAvailability, RecoveryFrontierDisposition, RecoveryFrontierLocator,
        RecoveryFrontierReadPort, SealedRecoveryFrontier,
    },
};

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

/// Historical read-only observation of one Execution recovery dependency.
///
/// The wrapped evidence is owned and sealed by Execution. This observation has no public
/// constructor, conversion, cloning, or deserialization path. It is not a Runtime readiness fact,
/// Recovery Case, closure, application receipt, or permission to resume a generation.
///
/// ```compile_fail
/// use vibe_runtime::ExecutionRecoveryDependencyObservationV1;
///
/// let _forged = ExecutionRecoveryDependencyObservationV1(/* private sealed readback */);
/// ```
pub struct ExecutionRecoveryDependencyObservationV1(SealedRecoveryFrontier);

impl Debug for ExecutionRecoveryDependencyObservationV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ExecutionRecoveryDependencyObservationV1([REDACTED])")
    }
}

impl ExecutionRecoveryDependencyObservationV1 {
    /// Returns the schema version proven by Execution.
    pub fn schema_version(&self) -> u32 {
        self.0.schema_version()
    }

    /// Returns the canonical Execution Owner identity.
    pub fn owner_identity(&self) -> &str {
        &self.0.locator().owner_identity
    }

    /// Returns the exact Execution custody-node identity.
    pub fn owner_node_identity(&self) -> &str {
        &self.0.locator().owner_node_identity
    }

    /// Returns the canonical recovery-frontier fact kind.
    pub fn fact_kind(&self) -> &str {
        &self.0.locator().fact_kind
    }

    /// Returns the exact PAPER mode proven by Execution.
    pub fn mode(&self) -> PaperMode {
        self.0.mode()
    }

    /// Returns the exact Execution Scope identity.
    pub fn execution_scope_identity(&self) -> &str {
        self.0.execution_scope_identity()
    }

    /// Returns the canonical PAPER account namespace.
    pub fn account_namespace(&self) -> &str {
        self.0.account_namespace()
    }

    /// Returns the canonical PAPER effect namespace.
    pub fn effect_namespace(&self) -> &str {
        self.0.effect_namespace()
    }

    /// Returns the monotonic recovery generation.
    pub fn recovery_generation(&self) -> u64 {
        self.0.recovery_generation()
    }

    /// Returns the exact Execution fact identity.
    pub fn fact_identity(&self) -> &str {
        &self.0.locator().fact_identity
    }

    /// Returns the exact Execution content digest.
    pub fn content_digest(&self) -> &str {
        &self.0.locator().content_digest
    }

    /// Returns the native recovery-frontier stream identity.
    pub fn frontier_stream_identity(&self) -> &str {
        &self.0.locator().frontier.stream_identity
    }

    /// Returns the native recovery-frontier cut identity.
    pub fn frontier_cut_identity(&self) -> &str {
        &self.0.locator().frontier.cut_identity
    }

    /// Returns the native recovery-frontier sequence.
    pub fn frontier_sequence(&self) -> u64 {
        self.0.locator().frontier.sequence
    }

    /// Returns the exact availability proven by Execution.
    pub fn availability(&self) -> RecoveryFrontierAvailability {
        self.0.availability()
    }

    /// Returns the exact recovery disposition proven by Execution.
    pub fn disposition(&self) -> RecoveryFrontierDisposition {
        self.0.disposition()
    }

    /// Returns the Recovery Case identity for a `KNOWN_CLOSED` disposition.
    pub fn recovery_case_identity(&self) -> Option<&str> {
        self.0.recovery_case_identity()
    }

    /// Returns the immutable `KNOWN_CLOSED` identity when applicable.
    pub fn known_closed_identity(&self) -> Option<&str> {
        self.0.known_closed_identity()
    }

    /// Returns the inclusive effective time.
    pub fn effective_at_epoch_ms(&self) -> u64 {
        self.0.effective_at_epoch_ms()
    }

    /// Returns the Execution observation time.
    pub fn observed_at_epoch_ms(&self) -> u64 {
        self.0.observed_at_epoch_ms()
    }

    /// Returns the exclusive freshness bound.
    pub fn exclusive_valid_through_epoch_ms(&self) -> u64 {
        self.0.exclusive_valid_through_epoch_ms()
    }

    /// Returns the time-evidence clock epoch.
    pub fn clock_epoch(&self) -> u64 {
        self.0.clock_epoch()
    }
}

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

    /// Resolves one exact current PAPER recovery frontier directly from Execution.
    ///
    /// Every Execution error, including unavailable, stale, rolled-back, and partial recovery,
    /// fails closed as no observation. An observation does not change Runtime's `NOT_READY` status.
    #[must_use]
    pub fn observe_execution_recovery(
        &self,
        port: &dyn RecoveryFrontierReadPort,
        locator: &RecoveryFrontierLocator,
    ) -> Option<ExecutionRecoveryDependencyObservationV1> {
        port.resolve_current(locator)
            .ok()
            .map(ExecutionRecoveryDependencyObservationV1)
    }
}
