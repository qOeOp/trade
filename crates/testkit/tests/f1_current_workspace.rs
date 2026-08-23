use rstest::rstest;
use vibe_scanner::OpaqueId;
use vibe_strategy_governance::LifecycleRequestId;

#[rstest]
fn scanner_and_governance_contracts_resolve_from_the_root_workspace() {
    let contract_types = [
        std::any::type_name::<OpaqueId>(),
        std::any::type_name::<LifecycleRequestId>(),
    ];

    assert!(contract_types.iter().all(|name| !name.is_empty()));
}
