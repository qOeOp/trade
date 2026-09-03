use sqlx::PgPool;

pub(crate) async fn pre_cutover_materialization_is_admitted(
    pool: &PgPool,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT session_user='rd_owner'
           AND current_user='rd_owner'
           AND pg_catalog.pg_get_userbyid(database.datdba)='rd_owner'
           AND pg_catalog.pg_get_userbyid(namespace.nspowner)='rd_owner'
           AND pg_catalog.has_schema_privilege(current_user,'public','USAGE,CREATE')
           AND pg_catalog.to_regnamespace('replay_policy_catalog_private') IS NULL
           AND pg_catalog.to_regnamespace('composer_private') IS NULL
          FROM pg_catalog.pg_database database
          JOIN pg_catalog.pg_namespace namespace ON namespace.nspname='public'
         WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(pool)
    .await
}

pub(crate) async fn materialize_or_require_existing_public_table(
    pool: &PgPool,
    relation_name: &str,
    create_statement: &'static str,
) -> Result<(), sqlx::Error> {
    let existing_is_exact: Option<bool> = sqlx::query_scalar(
        "SELECT relation.relkind='r'
           AND relation.relpersistence='p'
           AND pg_catalog.pg_get_userbyid(relation.relowner)='rd_owner'
          FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relname=$1",
    )
    .bind(relation_name)
    .fetch_optional(pool)
    .await?;

    match existing_is_exact {
        Some(true) => Ok(()),
        Some(false) => Err(sqlx::Error::Protocol(format!(
            "public R&D relation {relation_name} has incompatible custody"
        ))),
        None if pre_cutover_materialization_is_admitted(pool).await? => {
            sqlx::query(create_statement).execute(pool).await?;
            Ok(())
        }
        None => Err(sqlx::Error::Protocol(format!(
            "public R&D relation {relation_name} was not materialized before custody cutover"
        ))),
    }
}
