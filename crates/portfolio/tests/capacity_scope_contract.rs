use rstest::rstest;
use vibe_portfolio::owner::capacity_scope::{
    CAPACITY_SCOPE_SCHEMA_VERSION, CapacityScopeFailure, CapacityScopeMaturity, CapacityScopeMode,
    CapacityScopeResolution, UntrustedCapacityScopeRequest, resolve_capacity_scope,
};

type RequestMutation = Box<dyn Fn(&mut UntrustedCapacityScopeRequest)>;

fn request(mode: CapacityScopeMode) -> UntrustedCapacityScopeRequest {
    UntrustedCapacityScopeRequest {
        schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
        request_identity: "capacity-scope-request-alpha".to_string(),
        account_namespace: "account-alpha".to_string(),
        mode,
        economic_pool_identity: "economic-pool-alpha".to_string(),
        expected_capacity_scope_identity: "sha256:capacity-scope-alpha".to_string(),
        expected_registry_cut_identity: "sha256:registry-cut-alpha".to_string(),
        expected_source_binding_identity: "source-binding-alpha".to_string(),
        expected_adapter_binding_identity: "adapter-binding-alpha".to_string(),
        expected_membership_proof_identity: "sha256:membership-proof-alpha".to_string(),
        expected_proof_frontier_identity: "capacity-proof-frontier-alpha".to_string(),
        expected_proof_frontier_sequence: 7,
        projection_at_epoch_ms: 10_000,
    }
}

#[rstest]
#[case(CapacityScopeMode::Paper)]
#[case(CapacityScopeMode::Live)]
fn external_owner_shaped_request_remains_discovery_unavailable(#[case] mode: CapacityScopeMode) {
    let request = request(mode);
    let CapacityScopeResolution::Unavailable(unavailable) = resolve_capacity_scope(&request) else {
        panic!("external caller must not mint a BOUND Capacity Scope");
    };
    assert_eq!(unavailable.schema_version(), CAPACITY_SCOPE_SCHEMA_VERSION);
    assert_eq!(unavailable.maturity(), CapacityScopeMaturity::Discovery);
    assert_eq!(unavailable.fingerprint(), &request.fingerprint());
    assert_eq!(
        unavailable.failures(),
        &[CapacityScopeFailure::OwnerResolveUnavailable]
    );
}

#[rstest]
fn every_scope_binding_and_frontier_coordinate_changes_request_digest() {
    let original = request(CapacityScopeMode::Paper);
    let original_digest = original.fingerprint().semantic_digest().to_string();
    let mutations: Vec<RequestMutation> = vec![
        Box::new(|value| value.schema_version += 1),
        Box::new(|value| value.request_identity.push_str("-changed")),
        Box::new(|value| value.account_namespace.push_str("-changed")),
        Box::new(|value| value.mode = CapacityScopeMode::Live),
        Box::new(|value| value.economic_pool_identity.push_str("-changed")),
        Box::new(|value| {
            value.expected_capacity_scope_identity.push_str("-changed");
        }),
        Box::new(|value| value.expected_registry_cut_identity.push_str("-changed")),
        Box::new(|value| {
            value.expected_source_binding_identity.push_str("-changed");
        }),
        Box::new(|value| {
            value.expected_adapter_binding_identity.push_str("-changed");
        }),
        Box::new(|value| {
            value
                .expected_membership_proof_identity
                .push_str("-changed");
        }),
        Box::new(|value| {
            value.expected_proof_frontier_identity.push_str("-changed");
        }),
        Box::new(|value| value.expected_proof_frontier_sequence += 1),
        Box::new(|value| value.projection_at_epoch_ms += 1),
    ];

    for mutate in mutations {
        let mut changed = original.clone();
        mutate(&mut changed);
        assert_ne!(changed.fingerprint().semantic_digest(), original_digest);
    }
}
