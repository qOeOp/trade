use rstest::rstest;

use crate::server::*;

#[rstest]
fn default_unavailable_contract_maps_to_service_unavailable_without_positive_projection() {
    let contract = default_unavailable_response("request-1");
    assert!(contract.receipt_identity.is_none());
    assert!(contract.artifact.is_none());
    assert_eq!(
        composer_response(StatusCode::SERVICE_UNAVAILABLE, contract).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[rstest]
fn caller_evidence_body_is_detected_while_an_empty_command_is_not() {
    assert!(!develop_composer_body_injects_evidence(b" \n\t"));
    assert!(develop_composer_body_injects_evidence(
        br#"{"module_bytes":"caller-selected"}"#
    ));
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
fn a2_run_dto_accepts_only_the_research_locator() {
    let parsed: SourceResearchComposerLocatorV2 =
        serde_json::from_slice(br#"{"research_request_locator":"research-1"}"#)
            .expect("locator-only DTO");
    assert_eq!(parsed.research_request_locator, "research-1");
    assert!(
        serde_json::from_slice::<SourceResearchComposerLocatorV2>(
            br#"{"research_request_locator":"research-1","design":{}}"#,
        )
        .is_err()
    );
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
fn a2_locator_decode_enforces_the_transport_byte_bound_without_rewriting_identity() {
    for locator in [
        "research/request v2".to_owned(),
        "x".repeat(256),
        "\u{754c}".repeat(85),
    ] {
        let request = serde_json::json!({"research_request_locator": locator});
        let parsed: SourceResearchComposerLocatorV2 =
            serde_json::from_value(request).expect("bounded locator");
        assert_eq!(parsed.research_request_locator, locator);
    }

    for locator in [
        String::new(),
        " \t\n".to_owned(),
        "x".repeat(257),
        "\u{754c}".repeat(86),
    ] {
        assert!(
            serde_json::from_value::<SourceResearchComposerLocatorV2>(
                serde_json::json!({"research_request_locator": locator})
            )
            .is_err()
        );
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
fn a2_execution_count_json_has_only_the_exact_contract_keys() {
    let value = serde_json::to_value(DevelopComposerA0ExecutionsV1 {
        schema_version: 1,
        a0_executions: 7,
    })
    .expect("A0 execution response");
    assert_eq!(
        value,
        serde_json::json!({"schema_version": 1, "a0_executions": 7})
    );
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest::rstest]
fn acceptance_routes_accept_only_closed_control_selectors() {
    let request: SourceResearchComposerAcceptanceRunV2 = serde_json::from_slice(
        br#"{"research_request_locator":"research-1","control":{"kind":"FailAfter","selector":"AfterDesign"}}"#,
    )
    .expect("closed write boundary");
    assert!(matches!(
        request.control,
        SourceResearchComposerAcceptanceControlV2::FailAfter(
            vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerAcceptanceWriteBoundaryV2::AfterDesign
        )
    ));
    assert!(
        serde_json::from_slice::<SourceResearchComposerAcceptanceRunV2>(
            br#"{"research_request_locator":"research-1","control":{"kind":"FailAfter","selector":"AfterArbitrarySql"}}"#,
        )
        .is_err()
    );
    assert!(
        serde_json::from_slice::<SourceResearchComposerAcceptanceResolveV2>(
            br#"{"tamper":"ArbitraryField"}"#,
        )
        .is_err()
    );
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest::rstest]
fn acceptance_fault_controls_require_the_explicit_runtime_gate() {
    assert_eq!(
        admit_sealed_acceptance_fault_control(false),
        Err(StatusCode::NOT_FOUND)
    );
    assert_eq!(admit_sealed_acceptance_fault_control(true), Ok(()));

    let source = include_str!("server.rs");

    for (handler, next_item) in [
        (
            "async fn read_sealed_develop_composer_for_acceptance",
            "async fn run_develop_composer_with_acceptance_control",
        ),
        (
            "async fn run_develop_composer_with_acceptance_control",
            "async fn resolve_develop_composer_with_acceptance_tamper",
        ),
        (
            "async fn resolve_develop_composer_with_acceptance_tamper",
            "fn admit_sealed_acceptance_fault_control",
        ),
    ] {
        let body = source
            .split(handler)
            .nth(1)
            .expect("acceptance handler")
            .split(next_item)
            .next()
            .expect("bounded acceptance handler");
        assert!(
            body.contains("admit_sealed_acceptance_fault_control(state.allow_acceptance_faults)")
        );
    }
}

#[rstest]
fn default_readback_contract_is_unavailable_without_positive_projection() {
    let contract = default_unavailable_response("request-1");
    assert_eq!(contract.request_identity, "request-1");
    assert_eq!(
        contract.disposition,
        vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(contract.receipt_identity.is_none());
    assert!(contract.artifact.is_none());
    assert_eq!(
        composer_response(StatusCode::SERVICE_UNAVAILABLE, contract).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[rstest]
fn public_success_contract_maps_to_ok() {
    let response = DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2.to_owned(),
        disposition: DevelopComposerOperationDispositionV2::Success,
        receipt_identity: None,
        artifact: None,
        coordinate: None,
        reason: None,
    };
    assert_eq!(
        composer_operation_response(response).status(),
        StatusCode::OK
    );
}
