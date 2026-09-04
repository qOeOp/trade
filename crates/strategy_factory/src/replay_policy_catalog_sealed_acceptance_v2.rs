//! Signed Replay Policy Catalog setup for the compile-time sealed acceptance graph.
//!
//! This module does not expose a Catalog writer. It submits one fixed signed request through the
//! same authenticated administrator boundary used by the product bootstrap command.

use sqlx::PgPool;

use crate::{ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2};

/// Creates or exact-resolves the fixed Catalog genesis required by sealed acceptance consumers.
pub async fn ensure_replay_policy_catalog_fixture_v2(
    pool: &PgPool,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    crate::replay_policy_catalog_postgres_v2::ensure_authenticated_sealed_acceptance_fixture_v1(
        pool,
    )
    .await
}
