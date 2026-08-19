use vibe_strategy_factory::artifact_build_sandbox::{run, socket_from_environment};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    run(&socket_from_environment()).await
}
