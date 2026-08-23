use crate::model::{
    UntrustedAdapterBindingReadback, UntrustedArtifactReadback,
    UntrustedAuthorizationLineageReadback, UntrustedAutonomousPolicyReadback,
    UntrustedCapacityViewReadback, UntrustedEligibilityReadback,
    UntrustedRuntimeApplicationReadback,
};

#[cfg(test)]
pub(crate) fn qualification_frontiers_match(
    qualification_frontier: &crate::QualificationSourceFrontier,
    time_source_frontier: &crate::QualificationSourceFrontier,
    readback: &UntrustedEligibilityReadback,
) -> bool {
    &readback.qualification_frontier == qualification_frontier
        && readback.time.source_frontier.as_str() == time_source_frontier.as_str()
}

/// Sealed source-Owner admission seam.
///
/// The repository-native F0 contract will replace the unavailable production
/// implementation. This trait intentionally stays crate-private: an adapter or
/// request caller cannot implement it and approve its own readbacks.
pub(crate) trait OwnerAdmission: Send + Sync {
    fn available(&self) -> bool;
    fn artifact(&self, readback: &UntrustedArtifactReadback) -> bool;
    #[allow(
        dead_code,
        reason = "legacy unit fixtures exercise fail-close decision comparators"
    )]
    fn eligibility(&self, readback: &UntrustedEligibilityReadback) -> bool;
    fn capacity(&self, readback: &UntrustedCapacityViewReadback) -> bool;
    fn adapter_binding(&self, readback: &UntrustedAdapterBindingReadback) -> bool;
    fn authorization_lineage(&self, readback: &UntrustedAuthorizationLineageReadback) -> bool;
    fn autonomous_policy(&self, readback: &UntrustedAutonomousPolicyReadback) -> bool;
    fn runtime_application(&self, readback: &UntrustedRuntimeApplicationReadback) -> bool;
}

#[derive(Debug, Default)]
pub(crate) struct UnavailableOwnerAdmission;

impl OwnerAdmission for UnavailableOwnerAdmission {
    fn available(&self) -> bool {
        false
    }

    fn artifact(&self, _readback: &UntrustedArtifactReadback) -> bool {
        false
    }

    fn eligibility(&self, _readback: &UntrustedEligibilityReadback) -> bool {
        false
    }

    fn capacity(&self, _readback: &UntrustedCapacityViewReadback) -> bool {
        false
    }

    fn adapter_binding(&self, _readback: &UntrustedAdapterBindingReadback) -> bool {
        false
    }

    fn authorization_lineage(&self, _readback: &UntrustedAuthorizationLineageReadback) -> bool {
        false
    }

    fn autonomous_policy(&self, _readback: &UntrustedAutonomousPolicyReadback) -> bool {
        false
    }

    fn runtime_application(&self, _readback: &UntrustedRuntimeApplicationReadback) -> bool {
        false
    }
}
