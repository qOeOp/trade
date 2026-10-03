use sqlx::{PgPool, Row};

#[derive(Clone, Copy)]
pub(crate) struct ColumnSpec {
    pub(crate) name: &'static str,
    pub(crate) data_type: &'static str,
    pub(crate) not_null: bool,
    pub(crate) default_expression: Option<&'static str>,
}

#[derive(Clone, Copy)]
pub(crate) struct IndexSpec {
    pub(crate) keys: &'static str,
    pub(crate) unique: bool,
    pub(crate) primary: bool,
    pub(crate) expression: Option<&'static str>,
    pub(crate) predicate: Option<&'static str>,
}

pub(crate) struct PublicTableSpec {
    pub(crate) name: &'static str,
    pub(crate) runtime_read_grantees: &'static [&'static str],
    pub(crate) columns: &'static [ColumnSpec],
    /// Semantic constraint signatures produced by the catalog query below.
    pub(crate) constraints: &'static [&'static str],
    pub(crate) indexes: &'static [IndexSpec],
}

pub(crate) const fn required(name: &'static str, data_type: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type,
        not_null: true,
        default_expression: None,
    }
}

pub(crate) const fn optional(name: &'static str, data_type: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type,
        not_null: false,
        default_expression: None,
    }
}

pub(crate) const fn defaulted(
    name: &'static str,
    data_type: &'static str,
    default_expression: &'static str,
) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type,
        not_null: true,
        default_expression: Some(default_expression),
    }
}

pub(crate) const fn primary_index(keys: &'static str) -> IndexSpec {
    IndexSpec {
        keys,
        unique: true,
        primary: true,
        expression: None,
        predicate: None,
    }
}

pub(crate) const fn unique_index(keys: &'static str) -> IndexSpec {
    IndexSpec {
        keys,
        unique: true,
        primary: false,
        expression: None,
        predicate: None,
    }
}

/// Proof that the database was in the explicit pre-cutover phase when the gate read it.
///
/// Only [`pre_cutover_materialization_is_admitted`] can build one: the field is private to this
/// module. A migration that takes it as a parameter can therefore only be reached from behind the
/// gate, and a call from `connect` or any other runtime entry does not compile.
///
/// That is what keeps R&D materialization from interleaving with a fenced readback. It does not take
/// the Backtest topology fence, and it alters relations the run report reads under that fence; it
/// runs only before cutover, when no such readback can exist, and this type makes "only before
/// cutover" a compile-time fact rather than a property someone has to remember.
#[derive(Debug)]
pub(crate) struct PreCutoverMaterializationAdmitted {
    _gate_only: (),
}

#[cfg(test)]
impl PreCutoverMaterializationAdmitted {
    /// For a test that migrates its own disposable database directly. Absent from every non-test
    /// build, so it cannot stand in for the gate anywhere a report could be reading.
    pub(crate) fn for_a_disposable_test_database() -> Self {
        Self { _gate_only: () }
    }
}

pub(crate) async fn pre_cutover_materialization_is_admitted(
    pool: &PgPool,
) -> Result<Option<PreCutoverMaterializationAdmitted>, sqlx::Error> {
    let admitted: bool = sqlx::query_scalar(
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
    .await?;
    Ok(admitted.then_some(PreCutoverMaterializationAdmitted { _gate_only: () }))
}

pub(crate) async fn materialize_public_table(
    pool: &PgPool,
    relation_name: &str,
    create_statement: &'static str,
) -> Result<(), sqlx::Error> {
    if pre_cutover_materialization_is_admitted(pool)
        .await?
        .is_none()
    {
        return Err(sqlx::Error::Protocol(format!(
            "public R&D relation {relation_name} cannot be materialized outside the explicit pre-cutover phase"
        )));
    }
    sqlx::query(create_statement).execute(pool).await?;
    Ok(())
}

/// Opens the window [`migrate_additive_public_table`] needs: calls
/// `rd_schema_migration_api.grant_additive_table_create_v1()` on a connection authenticated as
/// `rd_schema_migrator`, which runs with `rd_database_owner`'s privilege (the actual owner of
/// `public`) rather than the caller's, so `rd_owner` gains `CREATE` on `public` without either
/// role ever holding membership in the other - the custody topology
/// `10-migrate-authority-custody.sh` enforces requires `rd_owner` to have no membership edge at
/// all, which is exactly what `ALTER TABLE ... OWNER TO rd_owner` would otherwise need.
///
/// # Errors
///
/// Propagates a connection or query failure, including one connected as any role other than
/// `rd_schema_migrator` (the function is not reachable from any other role) or before cutover
/// (the two private custody schemas do not exist yet, and this is not the pre-cutover path).
pub(crate) async fn open_additive_table_create_window(
    migrator_pool: &PgPool,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT rd_schema_migration_api.grant_additive_table_create_v1()")
        .execute(migrator_pool)
        .await?;
    Ok(())
}

/// Closes the window [`open_additive_table_create_window`] opened, the same way, in reverse.
/// Idempotent: calling it when the window is already closed is a no-op, so a caller may call it
/// unconditionally during cleanup without first checking whether the matching open succeeded.
///
/// # Errors
///
/// Propagates a connection or query failure.
pub(crate) async fn close_additive_table_create_window(
    migrator_pool: &PgPool,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT rd_schema_migration_api.revoke_additive_table_create_v1()")
        .execute(migrator_pool)
        .await?;
    Ok(())
}

/// Gives an already cut-over store one table a newer build added, without reopening the
/// pre-cutover window.
///
/// Additive only: a relation that is already exactly `spec` (a previous run of this same call, or
/// a store that already had it) is a no-op; a same-named relation that is anything else - a
/// column added, a constraint changed, a table some other feature made - is refused by name and
/// left untouched. `create_statement` and `post_create_statements` must produce the exact bytes
/// [`require_existing_public_table`] already verifies for the pre-cutover path, because this
/// function re-runs that same check on what it just created before returning.
///
/// `pool` must authenticate as `rd_owner` and must already be inside the window
/// [`open_additive_table_create_window`] opens, for the one transaction this function commits:
/// the new relation is created by - and so is owned by - `rd_owner` directly, with no ownership
/// transfer step, so a crash mid-way leaves nothing behind for the next run to trip over.
///
/// # Errors
///
/// Propagates a connection or query failure, and refuses by name (without creating or altering
/// anything) when a relation named `spec.name` already exists and does not match `spec`.
pub(crate) async fn migrate_additive_public_table(
    pool: &PgPool,
    spec: &PublicTableSpec,
    create_statement: &'static str,
    post_create_statements: &[&'static str],
) -> Result<(), sqlx::Error> {
    let exists: bool =
        sqlx::query_scalar("SELECT pg_catalog.to_regclass('public.'||$1) IS NOT NULL")
            .bind(spec.name)
            .fetch_one(pool)
            .await?;

    if exists {
        return require_existing_public_table(pool, spec, spec.runtime_read_grantees)
            .await
            .map_err(|e| {
                sqlx::Error::Protocol(format!(
                    "public R&D relation {} already exists and is not a pure addition, so it was \
                     left untouched: {e}",
                    spec.name
                ))
            });
    }

    let mut transaction = pool.begin().await?;
    sqlx::query(create_statement)
        .execute(&mut *transaction)
        .await?;

    for statement in post_create_statements {
        sqlx::query(*statement).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    require_existing_public_table(pool, spec, spec.runtime_read_grantees).await
}

pub(crate) async fn require_existing_public_tables(
    pool: &PgPool,
    specs: &[PublicTableSpec],
) -> Result<(), sqlx::Error> {
    let runtime_custody_is_admitted: bool = sqlx::query_scalar(
        "SELECT session_user='rd_owner' AND current_user='rd_owner'
           AND pg_catalog.pg_get_userbyid(database.datdba)='rd_database_owner'
           AND pg_catalog.pg_get_userbyid(public_namespace.nspowner)='rd_database_owner'
           AND NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE')
           AND pg_catalog.pg_get_userbyid(catalog_namespace.nspowner)='replay_policy_catalog_owner'
           AND pg_catalog.pg_get_userbyid(composer_namespace.nspowner)='composer_owner'
          FROM pg_catalog.pg_database database
          JOIN pg_catalog.pg_namespace public_namespace ON public_namespace.nspname='public'
          JOIN pg_catalog.pg_namespace catalog_namespace ON catalog_namespace.nspname='replay_policy_catalog_private'
          JOIN pg_catalog.pg_namespace composer_namespace ON composer_namespace.nspname='composer_private'
         WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(pool)
    .await?;

    if !runtime_custody_is_admitted {
        return Err(sqlx::Error::Protocol(
            "runtime R&D schema validation requires the completed custody cutover".to_owned(),
        ));
    }

    for spec in specs {
        require_existing_public_table(pool, spec, spec.runtime_read_grantees).await?;
    }
    Ok(())
}

/// Verifies the same immutable relation manifest for a capability that exposes
/// only Owner reads, without requiring the later runtime-role cutover to have
/// happened already.
pub(crate) async fn require_existing_public_tables_for_readback(
    pool: &PgPool,
    specs: &[PublicTableSpec],
) -> Result<(), sqlx::Error> {
    for spec in specs {
        match require_existing_public_table(pool, spec, &[]).await {
            Ok(()) => {}
            Err(sqlx::Error::Protocol(_)) if !spec.runtime_read_grantees.is_empty() => {
                require_existing_public_table(pool, spec, spec.runtime_read_grantees).await?;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

pub(crate) async fn verify_materialized_public_tables(
    pool: &PgPool,
    specs: &[PublicTableSpec],
) -> Result<(), sqlx::Error> {
    if pre_cutover_materialization_is_admitted(pool)
        .await?
        .is_none()
    {
        return Err(sqlx::Error::Protocol(
            "pre-cutover R&D schema verification is unavailable".to_owned(),
        ));
    }

    for spec in specs {
        require_existing_public_table(pool, spec, &[]).await?;
    }
    Ok(())
}

async fn require_existing_public_table(
    pool: &PgPool,
    spec: &PublicTableSpec,
    runtime_read_grantees: &[&str],
) -> Result<(), sqlx::Error> {
    let relation_is_exact: Option<bool> = sqlx::query_scalar(
        "SELECT relation.relkind='r'
           AND relation.relpersistence='p'
           AND pg_catalog.pg_get_userbyid(relation.relowner)='rd_owner'
           AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
           AND relation.reloptions IS NULL AND relation.reltablespace=0
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy WHERE policy.polrelid=relation.oid)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=relation.oid AND rewrite.rulename<>'_RETURN')
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance WHERE inheritance.inhrelid=relation.oid OR inheritance.inhparent=relation.oid)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid=relation.oid)
           AND (SELECT count(*)=7+cardinality($2::text[])
                  AND count(*) FILTER (WHERE acl.grantee=relation.relowner)=7
                  AND count(DISTINCT acl.privilege_type) FILTER (WHERE acl.grantee=relation.relowner)=7
                  AND bool_and(acl.grantor=relation.relowner AND NOT acl.is_grantable)
                  AND bool_and(
                    (acl.grantee=relation.relowner AND acl.privilege_type IN ('INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
                    OR (pg_catalog.pg_get_userbyid(acl.grantee)=ANY($2::text[]) AND acl.privilege_type='SELECT')
                  )
                  AND count(*) FILTER (WHERE acl.grantee<>relation.relowner)=cardinality($2::text[])
                  AND count(DISTINCT pg_catalog.pg_get_userbyid(acl.grantee)) FILTER (WHERE acl.grantee<>relation.relowner)=cardinality($2::text[])
                  FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL)
          FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relname=$1",
    )
    .bind(spec.name)
    .bind(runtime_read_grantees)
    .fetch_optional(pool)
    .await?;

    if relation_is_exact != Some(true) {
        let exists: bool =
            sqlx::query_scalar("SELECT pg_catalog.to_regclass('public.'||$1) IS NOT NULL")
                .bind(spec.name)
                .fetch_one(pool)
                .await?;
        return if exists {
            incompatible(spec.name, "custody or relation options")
        } else {
            missing(spec.name)
        };
    }

    let columns = sqlx::query(
        "SELECT attribute.attname,
                pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) AS data_type,
                attribute.attnotnull,
                attribute.attcollation=attribute_type.typcollation AS collation_is_canonical,
                pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid,true) AS default_expression
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
           JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid=attribute.atttypid
           LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=relation.oid AND default_fact.adnum=attribute.attnum
          WHERE namespace.nspname='public' AND relation.relname=$1
          ORDER BY attribute.attnum",
    )
    .bind(spec.name)
    .fetch_all(pool)
    .await?;

    if columns.len() != spec.columns.len()
        || columns.iter().zip(spec.columns).any(|(actual, expected)| {
            actual.get::<String, _>("attname") != expected.name
                || actual.get::<String, _>("data_type") != expected.data_type
                || actual.get::<bool, _>("attnotnull") != expected.not_null
                || !actual.get::<bool, _>("collation_is_canonical")
                || actual
                    .get::<Option<String>, _>("default_expression")
                    .as_deref()
                    != expected.default_expression
        })
    {
        return incompatible(spec.name, "column manifest");
    }

    let mut constraints = sqlx::query_scalar::<_, String>(
        "SELECT constraint_fact.contype::text||':'||
                COALESCE((SELECT pg_catalog.string_agg(attribute.attname,',' ORDER BY key_fact.ordinality)
                            FROM pg_catalog.unnest(constraint_fact.conkey) WITH ORDINALITY key_fact(attnum,ordinality)
                            JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=constraint_fact.conrelid AND attribute.attnum=key_fact.attnum),'')||':'||
                COALESCE(target_namespace.nspname||'.'||target.relname||'('||
                  (SELECT pg_catalog.string_agg(attribute.attname,',' ORDER BY key_fact.ordinality)
                     FROM pg_catalog.unnest(constraint_fact.confkey) WITH ORDINALITY key_fact(attnum,ordinality)
                     JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=constraint_fact.confrelid AND attribute.attnum=key_fact.attnum)||')','')||':'||
                CASE WHEN constraint_fact.contype='f' THEN constraint_fact.confupdtype::text||':'||constraint_fact.confdeltype::text||':'||constraint_fact.confmatchtype::text ELSE '' END||':'||
                constraint_fact.condeferrable::text||':'||constraint_fact.condeferred::text||':'||constraint_fact.convalidated::text||':'||
                COALESCE(pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid,false),'')
           FROM pg_catalog.pg_constraint constraint_fact
           JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           LEFT JOIN pg_catalog.pg_class target ON target.oid=constraint_fact.confrelid
           LEFT JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid=target.relnamespace
          WHERE namespace.nspname='public' AND relation.relname=$1",
    )
    .bind(spec.name)
    .fetch_all(pool)
    .await?;

    constraints.sort();
    let mut expected_constraints = spec.constraints.to_vec();
    expected_constraints.sort_unstable();

    if constraints
        .iter()
        .map(String::as_str)
        .ne(expected_constraints)
    {
        return incompatible(spec.name, "constraint manifest");
    }

    let indexes = sqlx::query(
        "SELECT index_fact.indisunique,index_fact.indisprimary,
                (SELECT pg_catalog.string_agg(COALESCE(attribute.attname,'#expression#'),',' ORDER BY key_fact.ordinality)
                   FROM pg_catalog.unnest(index_fact.indkey::smallint[]) WITH ORDINALITY key_fact(attnum,ordinality)
                   LEFT JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum) AS keys,
                pg_catalog.pg_get_expr(index_fact.indexprs,index_fact.indrelid,true) AS expression,
                pg_catalog.pg_get_expr(index_fact.indpred,index_fact.indrelid,true) AS predicate,
                index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive
                  AND NOT index_fact.indnullsnotdistinct
                  AND index_relation.relpersistence='p' AND index_relation.reltablespace=0
                  AND index_relation.reloptions IS NULL
                  AND pg_catalog.pg_get_userbyid(index_relation.relowner)='rd_owner'
                  AND index_method.amname='btree'
                  AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pg_catalog.unnest(index_fact.indcollation::oid[]) WITH ORDINALITY collation_key(collation_oid,ordinality)
                    JOIN pg_catalog.pg_attribute index_attribute ON index_attribute.attrelid=index_relation.oid AND index_attribute.attnum=collation_key.ordinality
                    JOIN pg_catalog.pg_type index_type ON index_type.oid=index_attribute.atttypid
                    WHERE collation_key.collation_oid<>index_attribute.attcollation
                       OR index_attribute.attcollation<>index_type.typcollation
                  )
                  AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AS options_are_exact
           FROM pg_catalog.pg_index index_fact
           JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid
           JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam
          WHERE namespace.nspname='public' AND relation.relname=$1",
    )
    .bind(spec.name)
    .fetch_all(pool)
    .await?;
    let mut actual_indexes = indexes
        .iter()
        .map(|row| {
            if !row.get::<bool, _>("options_are_exact") {
                return None;
            }
            Some(IndexShape {
                keys: row.get("keys"),
                unique: row.get("indisunique"),
                primary: row.get("indisprimary"),
                expression: row.get("expression"),
                predicate: row.get("predicate"),
            })
        })
        .collect::<Option<Vec<_>>>();
    let Some(ref mut actual_indexes) = actual_indexes else {
        return incompatible(spec.name, "index options");
    };
    actual_indexes.sort();
    let mut expected_indexes = spec
        .indexes
        .iter()
        .map(|index| IndexShape {
            keys: index.keys.to_owned(),
            unique: index.unique,
            primary: index.primary,
            expression: index.expression.map(str::to_owned),
            predicate: index.predicate.map(str::to_owned),
        })
        .collect::<Vec<_>>();
    expected_indexes.sort();
    if actual_indexes != &expected_indexes {
        return incompatible(spec.name, "index manifest");
    }
    Ok(())
}

#[derive(Eq, Ord, PartialEq, PartialOrd)]
struct IndexShape {
    keys: String,
    unique: bool,
    primary: bool,
    expression: Option<String>,
    predicate: Option<String>,
}

fn incompatible(relation_name: &str, aspect: &str) -> Result<(), sqlx::Error> {
    Err(sqlx::Error::Protocol(format!(
        "public R&D relation {relation_name} has incompatible {aspect}"
    )))
}

/// A relation the runtime manifest requires does not exist at all, as opposed to existing with
/// the wrong shape (`incompatible`). This is what a store sees for a table a newer build added
/// before running its post-cutover migration (`migrate_additive_public_table`), or before the
/// pre-cutover materializer ever ran at all; the two have the same fix, in that order.
fn missing(relation_name: &str) -> Result<(), sqlx::Error> {
    Err(sqlx::Error::Protocol(format!(
        "public R&D relation {relation_name} does not exist: run the pre-cutover materializer on \
         a fresh store, or the post-cutover additive table migration on one already cut over"
    )))
}

#[cfg(test)]
mod tests {
    use super::{
        ColumnSpec, PublicTableSpec, close_additive_table_create_window,
        migrate_additive_public_table, open_additive_table_create_window, primary_index,
        require_existing_public_tables_for_readback, required,
    };
    use rstest::rstest;
    use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

    /// Two single-connection pools over the same disposable database, one narrowed by `SET
    /// SESSION AUTHORIZATION` to each role the real deployment splits this migration across.
    /// `max_connections(1)` makes each pool exactly one physical session, so the narrowing holds
    /// for every statement run through it afterward.
    async fn role_pool(database_url: &str, role: &str) -> sqlx::PgPool {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .connect_url(database_url, PostgresTls::Disabled)
            .await
            .unwrap();
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "SET SESSION AUTHORIZATION {role}"
        )))
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[rstest]
    #[tokio::test]
    #[ignore = "requires an explicitly supplied disposable PostgreSQL database"]
    async fn additive_migration_creates_once_and_refuses_a_mismatch_untouched() {
        const NAME: &str = "rbm_additive_migration_probe_v1";
        const CREATE: &str =
            "CREATE TABLE IF NOT EXISTS rbm_additive_migration_probe_v1 (id BIGINT PRIMARY KEY)";
        const REVOKE: &str =
            "REVOKE ALL ON TABLE public.rbm_additive_migration_probe_v1 FROM PUBLIC";
        const COLUMNS: &[ColumnSpec] = &[required("id", "bigint")];
        const INDEXES: &[super::IndexSpec] = &[primary_index("id")];
        let spec = PublicTableSpec {
            name: NAME,
            runtime_read_grantees: &[],
            columns: COLUMNS,
            constraints: &["p:id:::false:false:true:"],
            indexes: INDEXES,
        };

        // `RD_SCHEMA_MIGRATION_TEST_DATABASE_URL` must name a genuinely fresh disposable
        // PostgreSQL: a superuser connection to a database that holds none of the roles, schema
        // or table this test sets up and creates, so nothing here ever drops, truncates or
        // deletes anything that could have been someone else's.
        let database_url = std::env::var("RD_SCHEMA_MIGRATION_TEST_DATABASE_URL")
            .expect("RD_SCHEMA_MIGRATION_TEST_DATABASE_URL must be explicitly supplied");
        let setup_pool = sqlx::postgres::PgPoolOptions::new()
            .connect_url(&database_url, PostgresTls::Disabled)
            .await
            .unwrap();
        // The connecting (superuser) role sets this disposable database up exactly as the real
        // custody migration does: `rd_database_owner` owns `public` and the SECURITY DEFINER
        // functions, `rd_schema_migrator` may only call them, and `rd_owner` holds nothing beyond
        // what those functions grant it for the duration of the window.
        for statement in [
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rd_database_owner') \
             THEN CREATE ROLE rd_database_owner NOLOGIN; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rd_owner') THEN \
             CREATE ROLE rd_owner LOGIN; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rd_schema_migrator') \
             THEN CREATE ROLE rd_schema_migrator LOGIN NOINHERIT; END IF; END $$",
            "ALTER SCHEMA public OWNER TO rd_database_owner",
            "REVOKE CREATE ON SCHEMA public FROM rd_owner",
            "CREATE SCHEMA IF NOT EXISTS rd_schema_migration_api AUTHORIZATION rd_database_owner",
            "CREATE OR REPLACE FUNCTION rd_schema_migration_api.grant_additive_table_create_v1() \
             RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp \
             AS $f$BEGIN EXECUTE 'GRANT CREATE ON SCHEMA public TO rd_owner'; END$f$",
            "ALTER FUNCTION rd_schema_migration_api.grant_additive_table_create_v1() OWNER TO \
             rd_database_owner",
            "GRANT EXECUTE ON FUNCTION rd_schema_migration_api.grant_additive_table_create_v1() \
             TO rd_schema_migrator",
            "CREATE OR REPLACE FUNCTION rd_schema_migration_api.revoke_additive_table_create_v1() \
             RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp \
             AS $f$BEGIN EXECUTE 'REVOKE CREATE ON SCHEMA public FROM rd_owner'; END$f$",
            "ALTER FUNCTION rd_schema_migration_api.revoke_additive_table_create_v1() OWNER TO \
             rd_database_owner",
            "GRANT EXECUTE ON FUNCTION rd_schema_migration_api.revoke_additive_table_create_v1() \
             TO rd_schema_migrator",
            "GRANT USAGE ON SCHEMA rd_schema_migration_api TO rd_schema_migrator",
        ] {
            sqlx::query(statement).execute(&setup_pool).await.unwrap();
        }

        let migrator_pool = role_pool(&database_url, "rd_schema_migrator").await;
        let owner_pool = role_pool(&database_url, "rd_owner").await;

        open_additive_table_create_window(&migrator_pool)
            .await
            .expect("rd_schema_migrator may call the grant function");
        migrate_additive_public_table(&owner_pool, &spec, CREATE, &[REVOKE])
            .await
            .expect("the table does not exist yet, so this creates it");
        close_additive_table_create_window(&migrator_pool)
            .await
            .expect("closing the window is always admitted");

        let owner: String = sqlx::query_scalar(
            "SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class \
             WHERE relname=$1",
        )
        .bind(NAME)
        .fetch_one(&setup_pool)
        .await
        .unwrap();
        assert_eq!(
            owner, "rd_owner",
            "rd_owner created the table directly, so it is already the owner"
        );
        let rd_owner_can_create: bool =
            sqlx::query_scalar("SELECT has_schema_privilege('rd_owner','public','CREATE')")
                .fetch_one(&setup_pool)
                .await
                .unwrap();
        assert!(
            !rd_owner_can_create,
            "closing the window must leave rd_owner exactly as unprivileged as before"
        );
        let rd_owner_is_a_member_of_anyone: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership \
             WHERE membership.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rd_owner') \
             OR membership.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rd_owner'))",
        )
        .fetch_one(&setup_pool)
        .await
        .unwrap();
        assert!(
            !rd_owner_is_a_member_of_anyone,
            "the custody topology this migration must not disturb requires rd_owner to have no \
             membership edge at all"
        );

        open_additive_table_create_window(&migrator_pool)
            .await
            .unwrap();
        migrate_additive_public_table(&owner_pool, &spec, CREATE, &[REVOKE])
            .await
            .expect("a second call is a no-op: the table already matches exactly");
        close_additive_table_create_window(&migrator_pool)
            .await
            .unwrap();

        sqlx::query("ALTER TABLE public.rbm_additive_migration_probe_v1 ADD COLUMN drifted TEXT")
            .execute(&setup_pool)
            .await
            .unwrap();

        open_additive_table_create_window(&migrator_pool)
            .await
            .unwrap();
        let refused = migrate_additive_public_table(&owner_pool, &spec, CREATE, &[REVOKE])
            .await
            .expect_err("a same-named relation that drifted from the manifest is refused");
        close_additive_table_create_window(&migrator_pool)
            .await
            .unwrap();
        assert!(refused.to_string().contains("is not a pure addition"));
        let columns: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_catalog.pg_attribute \
             WHERE attrelid='public.rbm_additive_migration_probe_v1'::regclass \
               AND attnum>0 AND NOT attisdropped",
        )
        .fetch_one(&setup_pool)
        .await
        .unwrap();
        assert_eq!(
            columns, 2,
            "the refusal left the drifted table exactly as it was"
        );
    }

    #[rstest]
    fn runtime_validation_is_read_only_and_exact() {
        let source = include_str!("schema_materialization.rs");
        assert!(
            source
                .contains("require_existing_public_table(pool, spec, spec.runtime_read_grantees)")
        );
        assert!(source.contains("require_existing_public_table(pool, spec, &[])"));
        let runtime = source
            .split("async fn require_existing_public_table(")
            .nth(1)
            .expect("runtime validator")
            .split("#[derive(Eq")
            .next()
            .expect("runtime validator boundary");
        assert!(!runtime.contains("CREATE TABLE"));
        assert!(!runtime.contains("has_table_privilege(current_user,relation.oid,'SELECT')"));

        for required in [
            "column manifest",
            "constraint manifest",
            "index manifest",
            "pg_catalog.aclexplode",
            "cardinality($2::text[])",
            "acl.privilege_type='SELECT'",
            "attribute.attcollation=attribute_type.typcollation",
            "index_attribute.attcollation<>index_type.typcollation",
            "collation_key.collation_oid<>index_attribute.attcollation",
        ] {
            assert!(runtime.contains(required), "missing {required}");
        }
    }

    #[tokio::test]
    #[ignore = "requires an explicitly supplied disposable PostgreSQL database"]
    async fn readback_accepts_only_declared_exact_acl_topologies() {
        const COLUMNS: &[ColumnSpec] = &[required("id", "bigint")];
        let database_url = std::env::var("RD_SCHEMA_READBACK_ACL_TEST_DATABASE_URL")
            .expect("RD_SCHEMA_READBACK_ACL_TEST_DATABASE_URL must be explicitly supplied");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_url(&database_url, PostgresTls::Disabled)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE public.rbm_schema_readback_acl_probe_v1 (id bigint NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let specs = [PublicTableSpec {
            name: "rbm_schema_readback_acl_probe_v1",
            runtime_read_grantees: &["rd_schema_reader"],
            columns: COLUMNS,
            constraints: &[],
            indexes: &[],
        }];

        require_existing_public_tables_for_readback(&pool, &specs)
            .await
            .unwrap();
        sqlx::query(
            "GRANT SELECT ON TABLE public.rbm_schema_readback_acl_probe_v1 TO rd_schema_reader",
        )
        .execute(&pool)
        .await
        .unwrap();
        require_existing_public_tables_for_readback(&pool, &specs)
            .await
            .unwrap();
        sqlx::query("GRANT UPDATE ON TABLE public.rbm_schema_readback_acl_probe_v1 TO PUBLIC")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            require_existing_public_tables_for_readback(&pool, &specs)
                .await
                .is_err()
        );
    }
}
