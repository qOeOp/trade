use rstest::rstest;
use vibe_runtime::{RuntimeFoundation, RuntimeFoundationStatus, RuntimeRevalidationDependency};

#[rstest]
fn direct_consumer_observes_not_ready_and_exact_revalidation_dependencies() {
    let runtime = RuntimeFoundation;

    assert_eq!(runtime.status(), RuntimeFoundationStatus::NotReady);
    assert_eq!(
        runtime.revalidate_after(),
        [
            RuntimeRevalidationDependency::GovernanceAuthorizedGenerationDecisionReadPort,
            RuntimeRevalidationDependency::CanonicalRuntimeCustodyPort,
            RuntimeRevalidationDependency::ArtifactCompatibilityRecoveryReadPort,
            RuntimeRevalidationDependency::ExecutionRecoveryFrontierReadPort,
        ]
    );
}
