//! What still refuses a cross-Owner caller once the read face stops re-checking it.
//!
//! Every routine in `market_data_rd_api` is `SECURITY DEFINER`, so the caller's own table
//! privileges never participate: the function body runs as the schema owner and reaches
//! `market_data_private` whoever called it. Access is therefore decided entirely above the
//! function - schema `USAGE` and function `EXECUTE` - and there is no table ACL underneath to
//! catch a mistake at that layer.
//!
//! These two proofs describe that gate rather than check a change to it. The first says the
//! grant layer is SUFFICIENT: the incumbent caller reaches every routine. The second says it is
//! NECESSARY: a second Owner is refused, loudly, with `42501` rather than with the empty result
//! that a filtering predicate would return. Either one alone describes half a gate.
//!
//! The subject is `backtest_owner` and not a role invented for the purpose. A role named for
//! intrusion is never granted anything by anyone, so a proof written against it can never go red,
//! and a proof that cannot go red is worth exactly as much as no proof. `backtest_owner` is a real
//! Owner that a future handoff could plausibly be granted - so this goes red on the day someone
//! grants it, which is the day a person should look.
//!
//! The routine list is read from `pg_catalog`, never written down here. A thirteenth routine is
//! therefore covered the moment it is created, instead of the moment somebody remembers to add it.
//! No count appears in these proofs either. A lower bound of twelve would have asserted a second
//! thing nobody decided - that this face only ever grows - and `rd_strategy_input_custody.rs`
//! already drops a routine to change its signature. What the proofs guard against instead is
//! asking nothing: the schema must exist, and the enumeration must not come back empty.

use sqlx::{PgPool, Row};
use vibe_testkit::postgres::{
    CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1, assert_statement_is_refused,
};

/// The sealed read face this pair describes.
const READ_FACE_SCHEMA: &str = "market_data_rd_api";

/// The one caller the face is provisioned for.
const ADMITTED_CALLER: &str = "rd_owner";

/// The second Owner whose refusal proves the grant layer is load-bearing.
const REFUSED_CALLER: &str = "backtest_owner";


/// One routine of the face, as the live catalog reports it.
struct FaceRoutine {
    /// `schema.name(argtypes)`, unambiguous across overloads.
    signature: String,
    /// A call of this routine with a typed NULL for every argument.
    null_call: String,
}

/// Reads the face from the live catalog, and refuses to describe a face it cannot call.
///
/// The argument list is built from `proargtypes` rather than parsed out of a rendered signature.
/// `pg_get_function_identity_arguments` renders parameter names alongside their types - `p_pit
/// bytea` - so splitting its output produces a call that either fails to parse or, worse, parses
/// with the wrong arity. Casting each `proargtypes` entry through `format_type` spells any type
/// correctly, including one whose own name contains a space or a modifier.
async fn read_face(pool: &PgPool) -> Vec<FaceRoutine> {
    let schema_exists: bool =
        sqlx::query_scalar("SELECT pg_catalog.to_regnamespace($1) IS NOT NULL")
            .bind(READ_FACE_SCHEMA)
            .fetch_one(pool)
            .await
            .expect("the catalog answers whether a schema exists");
    assert!(
        schema_exists,
        "there is no schema named {READ_FACE_SCHEMA}; an empty enumeration below would read as a \
         face that grants nothing rather than as a face that is not there",
    );

    let rows = sqlx::query(
        "SELECT p.oid::pg_catalog.regprocedure::text AS signature,\
         n.nspname||'.'||pg_catalog.quote_ident(p.proname) AS callable_name,\
         COALESCE((SELECT pg_catalog.string_agg(\
           'NULL::'||pg_catalog.format_type(t.oid,NULL), ',' ORDER BY t.ord) \
           FROM pg_catalog.unnest(p.proargtypes) WITH ORDINALITY AS t(oid,ord)),'') \
           AS null_arguments \
         FROM pg_catalog.pg_proc p \
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace \
         WHERE n.nspname=$1 ORDER BY 1",
    )
    .bind(READ_FACE_SCHEMA)
    .fetch_all(pool)
    .await
    .expect("the read face is enumerable from the live catalog");

    assert!(
        !rows.is_empty(),
        "{READ_FACE_SCHEMA} reported no routines at all; a dropped face, a renamed schema, or a \
         database the migration never reached would otherwise let both authorization proofs pass \
         while asking nothing",
    );

    rows.into_iter()
        .map(|row| {
            let callable_name: String = row.get("callable_name");
            let null_arguments: String = row.get("null_arguments");
            FaceRoutine {
                signature: row.get("signature"),
                null_call: format!("SELECT * FROM {callable_name}({null_arguments})"),
            }
        })
        .collect()
}

/// The grant layer is SUFFICIENT: the incumbent caller still reaches every routine of the face.
///
/// It calls each routine rather than only reading `has_function_privilege`, because `EXECUTE` on
/// the routine is not the whole gate - `USAGE` on the schema is the other half, and a catalog
/// answer about one of them cannot report the loss of the other.
///
/// Every call passes typed NULLs, so it matches nothing and returns no rows. That is the whole
/// intended subject: an admitted caller is answered, a refused one raises. Row contents belong to
/// the entries that write the facts, not to a proof about who may ask.
#[tokio::test]
#[ignore = "requires the ordered Owner PostgreSQL chain"]
async fn market_data_rd_api_admits_the_rd_owner_through_the_grant_layer_alone() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let mutation = database.mutation();
    let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    let usage: bool =
        sqlx::query_scalar("SELECT pg_catalog.has_schema_privilege($1,$2,'USAGE')")
            .bind(ADMITTED_CALLER)
            .bind(READ_FACE_SCHEMA)
            .fetch_one(pool)
            .await
            .expect("schema privilege is readable");
    assert!(usage, "{ADMITTED_CALLER} lost USAGE on {READ_FACE_SCHEMA}");

    for routine in read_face(pool).await {
        let granted: bool =
            sqlx::query_scalar("SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE')")
                .bind(ADMITTED_CALLER)
                .bind(&routine.signature)
                .fetch_one(pool)
                .await
                .expect("function privilege is readable");
        assert!(
            granted,
            "{ADMITTED_CALLER} lost EXECUTE on {}",
            routine.signature,
        );

        // Rolled back unconditionally: these routines take row share locks, and the ordered chain
        // shares one database that is never reset between entries.
        let mut transaction = pool.begin().await.expect("caller-owned transaction");
        sqlx::query(sqlx::AssertSqlSafe(routine.null_call.clone()))
            .execute(&mut *transaction)
            .await
            .unwrap_or_else(|error| {
                panic!(
                    "{ADMITTED_CALLER} could not call {}: {error}",
                    routine.signature,
                )
            });
        let _ = transaction.rollback().await;
    }
}

/// The grant layer is NECESSARY: a second Owner is refused by it, and refused loudly.
///
/// `42501` is the whole point. A face that filtered the caller inside its body would answer this
/// same call with zero rows, and zero rows is what a caller also sees when the fact genuinely is
/// not there - so "I may not read this" and "there is nothing here" would become one observation,
/// on a path where the second is a legitimate, fail-closed answer.
///
/// The ACL check is not a restatement of the refusal. The refusal covers `backtest_owner`; the ACL
/// covers every role at once, so a grant issued to some third role - by a migration, a test, or a
/// hand-run statement - turns this red without anyone having predicted that role's name.
#[tokio::test]
#[ignore = "requires the ordered Owner PostgreSQL chain"]
async fn market_data_rd_api_refuses_the_backtest_owner_loudly_not_emptily() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let mutation = database.mutation();
    let pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
    let admitted = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    for routine in read_face(admitted).await {
        let granted: bool =
            sqlx::query_scalar("SELECT pg_catalog.has_function_privilege($1,$2,'EXECUTE')")
                .bind(REFUSED_CALLER)
                .bind(&routine.signature)
                .fetch_one(admitted)
                .await
                .expect("function privilege is readable");
        assert!(
            !granted,
            "{REFUSED_CALLER} holds EXECUTE on {}; the grant layer no longer refuses it",
            routine.signature,
        );

        assert_statement_is_refused(pool, &routine.null_call, "42501").await;
    }

    let unexpected_grantees: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT p.oid::pg_catalog.regprocedure::text||' -> '||\
         COALESCE(a.grantee::pg_catalog.regrole::text,'PUBLIC') \
         FROM pg_catalog.pg_proc p \
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace \
         CROSS JOIN LATERAL pg_catalog.aclexplode(\
           COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))) a \
         WHERE n.nspname=$1 AND a.grantee<>p.proowner \
           AND a.grantee IS DISTINCT FROM pg_catalog.to_regrole($2)::pg_catalog.oid \
         ORDER BY 1",
    )
    .bind(READ_FACE_SCHEMA)
    .bind(ADMITTED_CALLER)
    .fetch_all(admitted)
    .await
    .expect("the read face ACL is readable");

    assert!(
        unexpected_grantees.is_empty(),
        "{READ_FACE_SCHEMA} grants execution to a role other than its owner and \
         {ADMITTED_CALLER}: {unexpected_grantees:?}",
    );
}
