//! Static, fail-closed Strategy Governance owner core.
//!
//! This crate deliberately does not include Product Edge, Qualification,
//! Portfolio, Execution, or Runtime adapters. Adapter payloads enter as
//! [`UntrustedDecisionEvidence`]. The public core currently has no source-Owner
//! admission capability, so it can only fail closed; future repository-native
//! adapters may construct the crate-private admission seam after canonical
//! Owner-store reread. A governance authorization never proves that Runtime
//! applied it.
//!
//! External crates also cannot install a Runtime receipt resolver. Until a future dependency
//! design lets Governance reread a Runtime Owner-private store receipt directly, even an exactly
//! matching public readback remains untrusted and projects `APPLICATION_UNKNOWN`:
//!
//! ```compile_fail
//! use vibe_strategy_governance::RuntimeApplicationSource;
//!
//! struct ForgedRuntimeSource;
//! impl RuntimeApplicationSource for ForgedRuntimeSource {}
//! ```
//!
//! ```compile_fail
//! use vibe_strategy_governance::GovernanceCore;
//!
//! let core = GovernanceCore::new();
//! core.view_from_runtime_source();
//! ```

mod authority;
mod digest;
mod lifecycle_receipt_read;
mod model;
mod store;

pub use digest::Digest;
pub use lifecycle_receipt_read::{
    CurrentLifecycleReceiptReadback, LifecycleReceiptReadError, UntrustedLifecycleReceiptLocator,
};
pub use model::{
    AccountId, ActivationCondition, AdapterBindingId, AllowedIntentClass, ApplicationStatus,
    ArtifactId, AuthorizationMode, AuthorizedGenerationDecision, CandidateId, CapacityScopeId,
    DecisionFrontierId, EconomicConditionsVersion, EligibilityState, ExecutionMode, ExecutionScope,
    FactRef, GenerationId, GovernanceDecisionView, LifecycleAction, LifecycleRequest,
    LifecycleRequestId, LifecycleRequestReceipt, ManifestId, PrincipalId,
    QualificationSourceFrontier, ReceiptStatus, RejectionReason, RequestScopeId,
    RevalidationBoundary, RuntimeApplicationDisposition, RuntimeReceiptId, SemanticIdentity,
    ShellBindingId, TimeEvidence, TimeSourceFrontierId, UntrustedAdapterBindingReadback,
    UntrustedArtifactReadback, UntrustedAuthorizationLineageReadback,
    UntrustedAutonomousPolicyReadback, UntrustedCapacityViewReadback, UntrustedDecisionEvidence,
    UntrustedEligibilityReadback, UntrustedRuntimeApplicationReadback, VerifiedAdapterBinding,
    VerifiedArtifact, VerifiedAuthorizationLineage, VerifiedAutonomousPolicy, VerifiedCapacityView,
    VerifiedEligibility, VerifiedRuntimeApplicationReceipt, ViewAvailability, ViewFreshness,
};
pub use store::{GovernanceCore, StoreError};

#[cfg(test)]
mod tests;
