use vibe_data::owner::{
    ResearchPitTerminalBootstrapFailure,
    sample_projection::{
        StrategyInputSampleProjectionKindV2, StrategyInputSampleProjectionReadbackV2,
        UntrustedStrategyInputSampleProjectionLocatorV2,
        UntrustedStrategyInputSampleProjectionLocatorV3,
    },
    strategy_input_binding::StrategyInputEventKind,
    strategy_input_sample_projection_resolver_v2_from_store_admission_lookup,
    strategy_input_sample_projection_resolver_v3_from_store_admission_lookup,
};

fn exact_v2_projection_discriminants(
    readback: &StrategyInputSampleProjectionReadbackV2,
) -> (StrategyInputSampleProjectionKindV2, StrategyInputEventKind) {
    (readback.kind(), readback.lifecycle())
}

#[tokio::test]
async fn sample_projection_public_startup_seam_is_disabled_by_default_and_fails_closed() {
    let _exact_discriminants = exact_v2_projection_discriminants;
    let locator = UntrustedStrategyInputSampleProjectionLocatorV2::from_untrusted([7; 32]);
    assert_eq!(locator.receipt_digest(), [7; 32]);

    let disabled =
        strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(|_| None)
            .await
            .unwrap();
    assert!(disabled.is_none());

    let invalid =
        strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(|name| {
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

#[tokio::test]
async fn v3_bar_projection_public_startup_seam_is_exact_disabled_and_fail_closed() {
    let locator = UntrustedStrategyInputSampleProjectionLocatorV3::from_untrusted([9; 32]);
    assert_eq!(locator.receipt_digest(), [9; 32]);

    let disabled =
        strategy_input_sample_projection_resolver_v3_from_store_admission_lookup(|_| None)
            .await
            .unwrap();
    assert!(disabled.is_none());

    let invalid =
        strategy_input_sample_projection_resolver_v3_from_store_admission_lookup(|name| {
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
        strategy_input_sample_projection_resolver_v3_from_store_admission_lookup(|name| {
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
