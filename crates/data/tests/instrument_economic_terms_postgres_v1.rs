use vibe_data::owner::{
    instrument_economic_terms_postgres_owner_from_environment_v1,
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresErrorV1,
    instrument_economic_terms_v1::{
        InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicDecimalV1,
        InstrumentEconomicTermsFactV1, InstrumentEconomicTermsInputV1,
        InstrumentEconomicTermsLocatorV1, InstrumentMarginMeaningV1,
    },
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

fn fact() -> InstrumentEconomicTermsFactV1 {
    InstrumentEconomicTermsFactV1::seal(InstrumentEconomicTermsInputV1 {
        schema_version: 1,
        instrument_identity: "BTCUSDT-PERP".into(),
        instrument_public_fact_digest: [1; 32],
        venue_identity: "BINANCE".into(),
        account_scope_identity: "RDQ-MARGIN".into(),
        account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
        valid_from_ns: 100,
        valid_until_ns_exclusive: 200,
        source_identity: "fee-schedule-1".into(),
        source_digest: [2; 32],
        provenance_digest: [3; 32],
        revision: 1,
        quote_currency: "USDT".into(),
        fee_currency: "USDT".into(),
        maker_fee: InstrumentEconomicDecimalV1 {
            mantissa: 2,
            scale: 4,
        },
        taker_fee: InstrumentEconomicDecimalV1 {
            mantissa: 4,
            scale: 4,
        },
        initial_margin: InstrumentEconomicDecimalV1 {
            mantissa: 1,
            scale: 1,
        },
        maintenance_margin: InstrumentEconomicDecimalV1 {
            mantissa: 5,
            scale: 2,
        },
        margin_meaning: InstrumentMarginMeaningV1::StandardNotionalRate,
    })
    .unwrap()
}

#[tokio::test]
#[ignore = "requires INSTRUMENT_OWNER_DATABASE_URL"]
async fn atomic_exact_replay_restart_tamper_and_acl_fail_closed() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let mutation = database.mutation();
    let pool = mutation
        .pool(CanonicalOwnerTestRoleV1::InstrumentOwner)
        .clone();
    let owner = instrument_economic_terms_postgres_owner_from_environment_v1()
        .await
        .unwrap();
    let fact = fact();
    let first = owner.issue(&fact).await.unwrap();
    let replay = owner.issue(&fact).await.unwrap();
    assert_eq!(first.locator(), replay.locator());
    assert_eq!(
        first.fact().canonical_bytes(),
        replay.fact().canonical_bytes()
    );
    let restarted = instrument_economic_terms_postgres_owner_from_environment_v1()
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let wrong =
        InstrumentEconomicTermsLocatorV1::from_identities(first.locator().fact_identity(), [9; 32])
            .unwrap();
    assert_eq!(
        restarted.resolve(wrong).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::UnknownLocator)
    );
    let mut conflicting = fact.input().clone();
    conflicting.maker_fee.mantissa = 3;
    assert_eq!(
        restarted
            .issue(&InstrumentEconomicTermsFactV1::seal(conflicting).unwrap())
            .await,
        Err(InstrumentEconomicTermsPostgresErrorV1::MeaningConflict)
    );

    let row_counts_before: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET meaning_identity=$1 WHERE fact_identity=$2")
        .bind([8_u8; 32].as_slice())
        .bind(first.locator().fact_identity().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    let mut displaced_meaning_conflict = fact.input().clone();
    displaced_meaning_conflict.maker_fee.mantissa = 3;
    assert_eq!(
        restarted
            .issue(&InstrumentEconomicTermsFactV1::seal(displaced_meaning_conflict).unwrap(),)
            .await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    let row_counts_after: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_counts_before, row_counts_after);
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET meaning_identity=$1 WHERE fact_identity=$2")
        .bind(fact.meaning_identity().as_slice())
        .bind(first.locator().fact_identity().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let mut second_input = fact.input().clone();
    second_input.instrument_identity = "ETHUSDT-PERP".into();
    let second = restarted
        .issue(&InstrumentEconomicTermsFactV1::seal(second_input).unwrap())
        .await
        .unwrap();
    let deleted_second_receipt: (Vec<u8>, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT receipt_identity,receipt_bytes,custody_digest FROM instrument_owner_private.economic_terms_receipts_v1 WHERE fact_identity=$1",
    )
    .bind(second.locator().fact_identity().as_slice())
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM instrument_owner_private.economic_terms_receipts_v1 WHERE fact_identity=$1",
    )
    .bind(second.locator().fact_identity().as_slice())
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    sqlx::query("INSERT INTO instrument_owner_private.economic_terms_receipts_v1(receipt_identity,fact_identity,receipt_bytes,custody_digest) VALUES($1,$2,$3,$4)")
        .bind(&deleted_second_receipt.0)
        .bind(second.locator().fact_identity().as_slice())
        .bind(&deleted_second_receipt.1)
        .bind(&deleted_second_receipt.2)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let deleted_second_fact: (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT fact_identity,meaning_identity,fact_bytes,custody_digest FROM instrument_owner_private.economic_terms_facts_v1 WHERE fact_identity=$1",
    )
    .bind(second.locator().fact_identity().as_slice())
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT vibe_test_admin.delete_instrument_economic_fact_as_replica_v1($1,$2)")
        .bind(mutation.marker_identity())
        .bind(second.locator().fact_identity().as_slice())
        .execute(database.owner_topology_admin_pool())
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    sqlx::query("INSERT INTO instrument_owner_private.economic_terms_facts_v1(fact_identity,meaning_identity,fact_bytes,custody_digest) VALUES($1,$2,$3,$4)")
        .bind(&deleted_second_fact.0)
        .bind(&deleted_second_fact.1)
        .bind(&deleted_second_fact.2)
        .bind(&deleted_second_fact.3)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let deleted_receipt: (Vec<u8>, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT receipt_identity,receipt_bytes,custody_digest FROM instrument_owner_private.economic_terms_receipts_v1 WHERE fact_identity=$1",
    )
    .bind(first.locator().fact_identity().as_slice())
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM instrument_owner_private.economic_terms_receipts_v1 WHERE fact_identity=$1",
    )
    .bind(first.locator().fact_identity().as_slice())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET meaning_identity=$1 WHERE fact_identity=$2")
        .bind([7_u8; 32].as_slice())
        .bind(first.locator().fact_identity().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    let orphan_row_counts_before: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut orphan_displaced_meaning_conflict = fact.input().clone();
    orphan_displaced_meaning_conflict.maker_fee.mantissa = 3;
    assert_eq!(
        restarted
            .issue(
                &InstrumentEconomicTermsFactV1::seal(orphan_displaced_meaning_conflict).unwrap(),
            )
            .await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    let orphan_row_counts_after: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(orphan_row_counts_before, orphan_row_counts_after);
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET meaning_identity=$1 WHERE fact_identity=$2")
        .bind(fact.meaning_identity().as_slice())
        .bind(first.locator().fact_identity().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO instrument_owner_private.economic_terms_receipts_v1(receipt_identity,fact_identity,receipt_bytes,custody_digest) VALUES($1,$2,$3,$4)")
        .bind(&deleted_receipt.0)
        .bind(first.locator().fact_identity().as_slice())
        .bind(&deleted_receipt.1)
        .bind(&deleted_receipt.2)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let counts_before_suppressed_receipt: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE FUNCTION instrument_owner_private.suppress_economic_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER suppress_economic_receipt_v1 BEFORE INSERT ON instrument_owner_private.economic_terms_receipts_v1 FOR EACH ROW EXECUTE FUNCTION instrument_owner_private.suppress_economic_receipt_v1()",
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut suppressed_receipt_input = fact.input().clone();
    suppressed_receipt_input.instrument_identity = "XRPUSDT-PERP".into();
    assert_eq!(
        restarted
            .issue(&InstrumentEconomicTermsFactV1::seal(suppressed_receipt_input).unwrap())
            .await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
    let counts_after_suppressed_receipt: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM instrument_owner_private.economic_terms_facts_v1),(SELECT count(*) FROM instrument_owner_private.economic_terms_receipts_v1)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        counts_before_suppressed_receipt,
        counts_after_suppressed_receipt
    );
    sqlx::query(
        "DROP TRIGGER suppress_economic_receipt_v1 ON instrument_owner_private.economic_terms_receipts_v1",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DROP FUNCTION instrument_owner_private.suppress_economic_receipt_v1()")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("GRANT SELECT(fact_bytes) ON instrument_owner_private.economic_terms_facts_v1 TO instrument_economic_intruder")
        .execute(&pool)
        .await
        .unwrap();
    let derived_column_select: bool = sqlx::query_scalar("SELECT has_column_privilege('instrument_economic_intruder','instrument_owner_private.economic_terms_facts_v1','fact_bytes','SELECT')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(derived_column_select);
    let derived_table_select: bool = sqlx::query_scalar("SELECT has_table_privilege('instrument_economic_intruder','instrument_owner_private.economic_terms_facts_v1','SELECT')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!derived_table_select);
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
    sqlx::query("REVOKE SELECT(fact_bytes) ON instrument_owner_private.economic_terms_facts_v1 FROM instrument_economic_intruder")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );
    sqlx::query("GRANT INSERT ON instrument_owner_private.economic_terms_facts_v1 TO instrument_economic_intruder")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
    sqlx::query("REVOKE INSERT ON instrument_owner_private.economic_terms_facts_v1 FROM instrument_economic_intruder")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "SELECT vibe_test_admin.set_instrument_economic_builtin_membership_v1($1,'instrument_economic_intruder',true)",
    )
        .bind(mutation.marker_identity())
        .execute(database.owner_topology_admin_pool())
        .await
        .unwrap();
    let derived_insert: bool = sqlx::query_scalar("SELECT has_table_privilege('instrument_economic_intruder','instrument_owner_private.economic_terms_facts_v1','INSERT')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(derived_insert);
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
    sqlx::query(
        "SELECT vibe_test_admin.set_instrument_economic_builtin_membership_v1($1,'instrument_economic_intruder',false)",
    )
        .bind(mutation.marker_identity())
        .execute(database.owner_topology_admin_pool())
        .await
        .unwrap();
    sqlx::query(
        "SELECT vibe_test_admin.set_instrument_economic_builtin_membership_v1($1,'instrument_economic_noinherit_intruder',true)",
    )
        .bind(mutation.marker_identity())
        .execute(database.owner_topology_admin_pool())
        .await
        .unwrap();
    let immediate_insert: bool = sqlx::query_scalar("SELECT has_table_privilege('instrument_economic_noinherit_intruder','instrument_owner_private.economic_terms_facts_v1','INSERT')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!immediate_insert);
    let can_set_role: bool = sqlx::query_scalar(
        "SELECT pg_has_role('instrument_economic_noinherit_intruder','pg_write_all_data','SET')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(can_set_role);
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
    sqlx::query(
        "SELECT vibe_test_admin.set_instrument_economic_builtin_membership_v1($1,'instrument_economic_noinherit_intruder',false)",
    )
        .bind(mutation.marker_identity())
        .execute(database.owner_topology_admin_pool())
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let original_custody: Vec<u8> = sqlx::query_scalar(
        "SELECT custody_digest FROM instrument_owner_private.economic_terms_facts_v1 WHERE fact_identity=$1",
    )
    .bind(first.locator().fact_identity().as_slice())
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET custody_digest=decode(repeat('00',32),'hex') WHERE fact_identity=$1")
        .bind(first.locator().fact_identity().as_slice()).execute(&pool).await.unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET custody_digest=$1 WHERE fact_identity=$2")
        .bind(&original_custody)
        .bind(first.locator().fact_identity().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    sqlx::query("CREATE SCHEMA instrument_economic_inheritance_intruder")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE instrument_economic_inheritance_intruder.facts_child_v1 (LIKE instrument_owner_private.economic_terms_facts_v1 INCLUDING ALL)")
        .execute(&pool)
        .await
        .unwrap();
    let mut topology_guard = pool.begin().await.unwrap();
    sqlx::query(
        "LOCK TABLE instrument_owner_private.economic_terms_facts_v1 IN SHARE ROW EXCLUSIVE MODE",
    )
    .execute(&mut *topology_guard)
    .await
    .unwrap();
    let mut topology_mutator = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL lock_timeout='100ms'")
        .execute(&mut *topology_mutator)
        .await
        .unwrap();
    let blocked = sqlx::query("ALTER TABLE instrument_economic_inheritance_intruder.facts_child_v1 INHERIT instrument_owner_private.economic_terms_facts_v1")
        .execute(&mut *topology_mutator)
        .await
        .unwrap_err();
    assert!(matches!(
        blocked.as_database_error().and_then(|e| e.code()),
        Some(code) if code == "55P03"
    ));
    topology_mutator.rollback().await.unwrap();
    topology_guard.rollback().await.unwrap();
    sqlx::query("ALTER TABLE instrument_economic_inheritance_intruder.facts_child_v1 INHERIT instrument_owner_private.economic_terms_facts_v1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
}
