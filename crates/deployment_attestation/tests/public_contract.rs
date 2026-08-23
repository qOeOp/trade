use std::path::Path;

use rstest::rstest;
use vibe_deployment_attestation::verify_strategy_factory_formation;

#[rstest]
fn public_entrypoint_accepts_only_the_bundle_path_and_fails_closed_when_unavailable() {
    let evidence = verify_strategy_factory_formation(Path::new(
        "/definitely/not/a/deployment-attestation-bundle",
    ));
    assert!(!evidence.is_verified());
    assert!(
        evidence
            .rejection_error()
            .starts_with("native producer verification rejected: ")
    );
}
