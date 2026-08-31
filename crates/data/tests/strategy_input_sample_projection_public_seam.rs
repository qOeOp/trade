use vibe_data::owner::{
    ResearchPitTerminalBootstrapFailure,
    sample_projection::UntrustedStrategyInputSampleProjectionLocatorV2,
    strategy_input_sample_projection_resolver_v2_from_store_admission_lookup,
};

#[tokio::test]
async fn sample_projection_public_startup_seam_is_disabled_by_default_and_fails_closed() {
    let locator = UntrustedStrategyInputSampleProjectionLocatorV2::from_untrusted([7; 32]);
    assert_eq!(locator.receipt_digest(), [7; 32]);

    let disabled = strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(|_| None)
        .await
        .unwrap();
    assert!(disabled.is_none());

    let invalid = strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(|name| {
        (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(|| "unknown".to_string())
    })
    .await
    .err()
    .expect("unknown mode must fail closed");
    assert_eq!(
        invalid.failure(),
        ResearchPitTerminalBootstrapFailure::InvalidMode
    );

    let incomplete =
        strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(|name| {
            (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(|| "required".to_string())
        })
        .await
        .err()
        .expect("incomplete required scope must fail closed");
    assert_eq!(
        incomplete.failure(),
        ResearchPitTerminalBootstrapFailure::MissingRequiredIdentity
    );
}
