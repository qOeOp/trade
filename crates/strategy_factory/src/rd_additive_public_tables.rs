//! Gives a store that has already cut over custody every R&D public table a newer build added
//! after that cutover, without reopening the pre-cutover window.

use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

/// Creates each additive R&D table - the strategy catalog's and the backtest run registry's - only
/// if it is purely absent, refusing by name (and touching nothing) if a same-named relation exists
/// and is not already its exact shape.
///
/// `owner_database_url` must authenticate as `rd_owner`, which creates and so owns every new
/// table; `migrator_database_url` as `rd_schema_migrator`, which holds nothing beyond `EXECUTE` on
/// the two SECURITY DEFINER functions that open and close the one window `rd_owner` needs
/// (`product/rd-workbench/postgres-init/10-migrate-authority-custody.sh`'s
/// `rd_schema_migration_api` schema). The window is closed even when creating a table inside it
/// fails, since a lingering grant on `rd_owner` is the worse outcome to leave unreported; if
/// closing it also fails, that failure is what this function returns.
///
/// # Errors
///
/// Returns an error when either connection cannot be opened, when opening or closing the window
/// is refused (the wrong role, or run before cutover), or when a same-named relation already
/// exists and does not match its manifest exactly - that refusal names the relation and leaves it
/// untouched.
pub async fn migrate_additively(
    owner_database_url: &str,
    migrator_database_url: &str,
) -> Result<(), sqlx::Error> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(owner_database_url, PostgresTls::Disabled)
        .await?;
    let migrator_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(migrator_database_url, PostgresTls::Disabled)
        .await?;
    crate::schema_materialization::open_additive_table_create_window(&migrator_pool).await?;
    let migration = migrate_every_table(&owner_pool).await;
    crate::schema_materialization::close_additive_table_create_window(&migrator_pool)
        .await
        .and(migration)
}

async fn migrate_every_table(owner_pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    crate::strategy_catalog_postgres_v1::migrate_additive(owner_pool).await?;
    crate::backtest_run_registry_postgres_v1::migrate_additive(owner_pool).await
}
