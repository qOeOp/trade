use std::{error::Error, fmt::Display};

use crate::{
    AuthorizedGenerationDecision, Digest, FactRef, GenerationId, LifecycleRequestId,
    LifecycleRequestReceipt, PrincipalId, ReceiptStatus, RequestScopeId, TimeEvidence,
};

/// Untrusted lookup coordinates for the current Governance lifecycle receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedLifecycleReceiptLocator {
    pub request_id: LifecycleRequestId,
    pub generation_id: GenerationId,
    pub decision_digest: Digest,
    pub membership_digest: Digest,
    pub principal_id: PrincipalId,
    pub request_scope_id: RequestScopeId,
    pub authorization_lineage_ref: FactRef,
    pub autonomous_policy_ref: FactRef,
}

impl UntrustedLifecycleReceiptLocator {
    /// Creates lookup coordinates from a previously observed decision.
    ///
    /// The returned locator remains untrusted. A read succeeds only after the
    /// Governance Owner rereads its canonical receipt and current authority.
    #[must_use]
    pub fn from_decision(decision: &AuthorizedGenerationDecision) -> Self {
        Self {
            request_id: decision.request_id().clone(),
            generation_id: decision.generation_id().clone(),
            decision_digest: decision.decision_digest(),
            membership_digest: decision.contender_membership_digest(),
            principal_id: decision.principal_id().clone(),
            request_scope_id: decision.request_scope_id().clone(),
            authorization_lineage_ref: decision.authorization_lineage_ref().clone(),
            autonomous_policy_ref: decision.autonomous_policy_ref().clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LifecycleReceiptReadError {
    UnknownReceipt,
    ReceiptNotAccepted,
    NotCurrentGenerationHead,
    GenerationMismatch,
    MembershipMismatch,
    AuthorityMismatch,
    Stale,
    OwnerAdmissionUnavailable,
}

impl Display for LifecycleReceiptReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl Error for LifecycleReceiptReadError {}

/// Borrowed proof that Governance reread one canonical lifecycle receipt.
///
/// This proves currentness only at [`Self::projected_at`]; it is not continuing
/// authority and exposes no `CURRENT` or `AVAILABLE` projection. The readback
/// cannot outlive or replace the Owner core that issued it. Every later use must
/// perform a new read, which revalidates the canonical generation head and all
/// retained authority cuts.
#[derive(Debug)]
pub struct CurrentLifecycleReceiptReadback<'owner> {
    pub(crate) receipt: &'owner LifecycleRequestReceipt,
    pub(crate) decision: &'owner AuthorizedGenerationDecision,
    pub(crate) readback_digest: Digest,
    pub(crate) projection_time: TimeEvidence,
}

impl CurrentLifecycleReceiptReadback<'_> {
    #[must_use]
    pub fn request_id(&self) -> &LifecycleRequestId {
        self.receipt.request_id()
    }

    #[must_use]
    pub fn generation_id(&self) -> &GenerationId {
        self.decision.generation_id()
    }

    #[must_use]
    pub const fn receipt_status(&self) -> ReceiptStatus {
        self.receipt.status()
    }

    #[must_use]
    pub const fn decision_digest(&self) -> Digest {
        self.decision.decision_digest()
    }

    #[must_use]
    pub fn membership_digest(&self) -> Digest {
        self.decision.contender_membership_digest()
    }

    #[must_use]
    pub const fn readback_digest(&self) -> Digest {
        self.readback_digest
    }

    #[must_use]
    pub const fn projected_at(&self) -> u64 {
        self.projection_time.observed_at
    }
}
