//! Compile-time sealed Replay Policy Catalog fixture.
//!
//! This module exists only in the non-default sealed acceptance build. It exposes no runtime
//! selector, caller-supplied policy, or production seed.

use sqlx::PgPool;

/// Creates the fixed Catalog record and advances its head, or verifies the identical existing fact.
pub async fn ensure_replay_policy_catalog_fixture_v2(pool: &PgPool) -> anyhow::Result<()> {
    crate::replay_policy_catalog_postgres_v2::ensure_sealed_acceptance_fixture(pool)
        .await
        .map_err(anyhow::Error::new)
}
