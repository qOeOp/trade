use rstest::rstest;
use vibe_execution::recovery_frontier::{RecoveryFrontierLocator, RecoveryFrontierReadPort};
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

#[rstest]
fn direct_execution_recovery_consumer_preserves_overall_not_ready() {
    fn consume(port: &dyn RecoveryFrontierReadPort, locator: &RecoveryFrontierLocator) -> bool {
        RuntimeFoundation
            .observe_execution_recovery(port, locator)
            .is_some()
    }

    let _direct_consumer: fn(&dyn RecoveryFrontierReadPort, &RecoveryFrontierLocator) -> bool =
        consume;
    assert_eq!(
        RuntimeFoundation.status(),
        RuntimeFoundationStatus::NotReady
    );
    assert!(
        RuntimeFoundation.revalidate_after().contains(
            &RuntimeRevalidationDependency::GovernanceAuthorizedGenerationDecisionReadPort
        )
    );
    assert!(
        RuntimeFoundation
            .revalidate_after()
            .contains(&RuntimeRevalidationDependency::CanonicalRuntimeCustodyPort)
    );
    assert!(
        RuntimeFoundation
            .revalidate_after()
            .contains(&RuntimeRevalidationDependency::ArtifactCompatibilityRecoveryReadPort)
    );
}
