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

pub(crate) async fn materialize_public_table(
    pool: &PgPool,
    relation_name: &str,
    create_statement: &'static str,
) -> Result<(), sqlx::Error> {
    if !pre_cutover_materialization_is_admitted(pool).await? {
        return Err(sqlx::Error::Protocol(format!(
            "public R&D relation {relation_name} cannot be materialized outside the explicit pre-cutover phase"
        )));
    }
    sqlx::query(create_statement).execute(pool).await?;
    Ok(())
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
        require_existing_public_table(pool, spec).await?;
    }
    Ok(())
}

pub(crate) async fn verify_materialized_public_tables(
    pool: &PgPool,
    specs: &[PublicTableSpec],
) -> Result<(), sqlx::Error> {
    if !pre_cutover_materialization_is_admitted(pool).await? {
        return Err(sqlx::Error::Protocol(
            "pre-cutover R&D schema verification is unavailable".to_owned(),
        ));
    }
    for spec in specs {
        require_existing_public_table(pool, spec).await?;
    }
    Ok(())
}

async fn require_existing_public_table(
    pool: &PgPool,
    spec: &PublicTableSpec,
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
           AND (SELECT count(*)=7 AND count(DISTINCT acl.privilege_type)=7
                  AND bool_and(acl.grantee=relation.relowner AND acl.grantor=relation.relowner AND NOT acl.is_grantable)
                  AND bool_and(acl.privilege_type IN ('INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
                  FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL)
          FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relname=$1",
    )
    .bind(spec.name)
    .fetch_optional(pool)
    .await?;
    if relation_is_exact != Some(true) {
        return incompatible(spec.name, "custody or relation options");
    }

    let columns = sqlx::query(
        "SELECT attribute.attname,
                pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) AS data_type,
                attribute.attnotnull,
                pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid,true) AS default_expression
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
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
                CASE WHEN constraint_fact.contype='f' THEN constraint_fact.confupdtype::text||constraint_fact.confdeltype::text||constraint_fact.confmatchtype::text ELSE '' END||':'||
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

#[cfg(test)]
mod tests {
    #[test]
    fn runtime_validation_is_read_only_and_exact() {
        let source = include_str!("schema_materialization.rs");
        let runtime = source
            .split("async fn require_existing_public_table(")
            .nth(1)
            .expect("runtime validator")
            .split("#[derive(Eq")
            .next()
            .expect("runtime validator boundary");
        assert!(!runtime.contains("CREATE TABLE"));
        for required in [
            "column manifest",
            "constraint manifest",
            "index manifest",
            "pg_catalog.aclexplode",
        ] {
            assert!(runtime.contains(required), "missing {required}");
        }
    }
}
