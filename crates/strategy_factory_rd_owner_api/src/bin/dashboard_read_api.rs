//! First-party Dashboard read API binary.
//!
//! The composition itself lives in the library so the ordered Owner chain can serve the exact
//! production router to a browser; this entry point only binds it to the deployment environment.

use vibe_strategy_factory_rd_owner_api::dashboard_read_api::{DashboardReadApiConfigV1, serve};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    serve(DashboardReadApiConfigV1::from_environment()?).await
}
