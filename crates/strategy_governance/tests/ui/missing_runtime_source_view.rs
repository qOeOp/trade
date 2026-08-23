use vibe_strategy_governance::GovernanceCore;

fn main() {
    let core = GovernanceCore::new();
    core.view_from_runtime_source();
}
