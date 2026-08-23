use crate::artifact_build::{ArtifactBuildError, ArtifactBuildRequestV1};

use serde::{Deserialize, Serialize};
use vibe_rd_artifact_invocation_custody::{
    ArtifactInvocationReservationMeaningV1, seal_invocation_reservation,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredInvocationClaimBindingV1 {
    pub(crate) request_identity: String,
    pub(crate) admission_identity: String,
    pub(crate) attempt_identity: String,
    pub(crate) claim_identity: String,
    pub(crate) claim_digest: String,
    pub(crate) invocation_admission_receipt_identity: String,
    pub(crate) invocation_admission_receipt_digest: String,
    pub(crate) claimed_state_digest: String,
    pub(crate) execution_custody_digest: String,
    pub(crate) reservation_identity: String,
    pub(crate) reservation_digest: String,
    pub(crate) reserved_at_epoch_ms: u64,
}

impl StoredInvocationClaimBindingV1 {
    pub(crate) fn seal_reservation(
        mut self,
        reserved_at_epoch_ms: u64,
        execution_custody_digest: String,
    ) -> Result<Self, ArtifactBuildError> {
        self.execution_custody_digest = execution_custody_digest;
        let seal = seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
            request_identity: &self.request_identity,
            admission_identity: &self.admission_identity,
            attempt_identity: &self.attempt_identity,
            claim_identity: &self.claim_identity,
            claim_digest: &self.claim_digest,
            invocation_admission_receipt_identity: &self.invocation_admission_receipt_identity,
            invocation_admission_receipt_digest: &self.invocation_admission_receipt_digest,
            claimed_state_digest: &self.claimed_state_digest,
            execution_custody_digest: &self.execution_custody_digest,
            reserved_at_epoch_ms,
        })
        .map_err(|e| ArtifactBuildError::Storage(e.to_string()))?;
        self.reservation_identity = seal.reservation_identity().to_string();
        self.reservation_digest = seal.reservation_digest().to_string();
        self.reserved_at_epoch_ms = reserved_at_epoch_ms;
        Ok(self)
    }

    pub(crate) fn is_complete(&self) -> bool {
        !self.request_identity.trim().is_empty()
            && !self.admission_identity.trim().is_empty()
            && !self.attempt_identity.trim().is_empty()
            && !self.claim_identity.trim().is_empty()
            && !self.claim_digest.trim().is_empty()
            && !self.invocation_admission_receipt_identity.trim().is_empty()
            && !self.invocation_admission_receipt_digest.trim().is_empty()
            && !self.claimed_state_digest.trim().is_empty()
            && !self.execution_custody_digest.trim().is_empty()
            && !self.reservation_identity.trim().is_empty()
            && !self.reservation_digest.trim().is_empty()
            && self.reserved_at_epoch_ms > 0
    }

    pub(crate) fn matches_request(&self, request: &ArtifactBuildRequestV1) -> bool {
        self.request_identity == request.build_request_identity
            && self.admission_identity == request.admission.admission_identity
            && self.attempt_identity == request.attempt_identity
    }
}
