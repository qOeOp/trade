//! Gives a store that has already cut over custody any R&D public table a newer build added
//! after that cutover, without reopening the pre-cutover window.
//!
//! Connects twice: as `RD_OWNER_DATABASE_URL`, which creates and so owns every new table, and as
//! `RD_SCHEMA_MIGRATOR_DATABASE_URL`, the dedicated principal that may only call the two SECURITY
//! DEFINER functions opening and closing the window `rd_owner` needs to do that
//! (`postgres-init/10-migrate-authority-custody.sh`'s `rd_schema_migration_api` schema). Every
//! table it may add is compiled into this binary, one call per Owner module that declares one,
//! mirroring how `--materialize-schema` calls each module's pre-cutover materializer in turn. A
//! table that is already present and exactly matches its manifest is a no-op; one that is present
//! under the same name but does not match is refused by name, and is left untouched.
//!
//! Runs on every default `docker compose up` (not gated behind `authority-admin`), after
//! `authority-custody-migrate`, the same way `authority-schema-materialize` does.

use vibe_strategy_factory_rd_owner_api::required_env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    require_no_arguments(std::env::args().skip(1))?;
    let owner_database_url = required_env("RD_OWNER_DATABASE_URL")?;
    let migrator_database_url = required_env("RD_SCHEMA_MIGRATOR_DATABASE_URL")?;
    vibe_strategy_factory::rd_additive_public_tables::migrate_additively(
        &owner_database_url,
        &migrator_database_url,
    )
    .await
    .map_err(|e| anyhow::anyhow!("R&D additive table migration was not accepted: {e}"))?;
    println!(
        "{}",
        serde_json::json!({"migrated": "additive-public-tables"})
    );
    Ok(())
}

fn require_no_arguments(mut arguments: impl Iterator<Item = String>) -> anyhow::Result<()> {
    if arguments.next().is_some() {
        anyhow::bail!("the additive table migration accepts no command-line arguments");
    }
    Ok(())
}
