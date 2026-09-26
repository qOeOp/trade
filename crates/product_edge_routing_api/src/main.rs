//! Product Edge operation routing read API binary.
//!
//! The composition lives in the library so the ordered Owner chain serves the exact production
//! router; this entry point only binds it to the deployment environment.

use vibe_product_edge_routing_api::{RoutingReadApiConfigV1, serve};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    serve(RoutingReadApiConfigV1::from_environment()?).await
}
